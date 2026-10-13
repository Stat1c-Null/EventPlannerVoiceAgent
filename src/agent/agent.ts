import * as guava from "@guava-ai/guava-sdk";
import { shareUrl } from "../config.ts";
import { toLocalIso } from "../datetime.ts";
import { formatUsd } from "../money.ts";
import type { Locality, PlacesQuery } from "../services/places.ts";
import { sendShareLink, type SmsSender } from "../services/sms.ts";
import type { EventStore } from "../store/events.ts";
import type { EventPlan, PlaceResult, PlanItemKind } from "../types.ts";
import { newDraft, type PlanDraft } from "./draft.ts";
import { buildPlan } from "./plan.ts";
import { PLAYBOOKS, parseEventType } from "./playbooks.ts";
import {
  changeChoice,
  confirmFieldKey,
  confirmTask,
  detailsTask,
  parseTaskId,
  pickFieldKey,
  pickTask,
  READY_TO_HANG_UP,
  refineFieldKey,
  spokenEventId,
  summarizeDraft,
  triageTask,
  wrapUpFieldKey,
  wrapUpTask,
} from "./tasks.ts";

export interface AgentDeps {
  store: Pick<EventStore, "create">;
  search: (query: PlacesQuery) => Promise<PlaceResult[]>;
  /** Corrects the spelling of the city the caller named; null keeps their words. */
  resolveArea?: (spoken: string) => Promise<Locality | null>;
  sms: SmsSender;
  agentNumber: string;
  publicBaseUrl: string;
  now?: () => Date;
  logger?: guava.Logger;
}

/** Field values can be strings, numbers, or structured values; normalize to trimmed text. */
function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const cleanQuery = (text: string): string => text.replace(/\s+/g, " ").trim();

export function createAgent(deps: AgentDeps): guava.Agent {
  const logger = deps.logger ?? guava.getDefaultLogger();
  const now = deps.now ?? (() => new Date());
  const drafts = new Map<string, PlanDraft>();

  const agent = new guava.Agent({
    purpose:
      "You are an upbeat event planner. You plan dates, hangouts with friends, and business " +
      "events for the caller, then book everything. All bookings in this demo are simulated; " +
      "never claim a real reservation or purchase was made.",
  });

  async function startPick(call: guava.Call, draft: PlanDraft, refinement = ""): Promise<void> {
    const component = draft.components[draft.componentIndex];
    if (!component) return startConfirm(call, draft);

    const base = {
      kind: component.kind,
      area: draft.basics.area ?? "",
      ...(component.placeType ? { includedType: component.placeType } : {}),
    };
    // Prefer places right next to the earlier pick (parking by the venue); fall back to the
    // address-based query when that pick has no coordinates or nothing is that close.
    const center = component.nearby?.center(draft);
    let options = center
      ? await deps.search({ ...base, text: cleanQuery(`${component.nearby!.text} ${refinement}`), near: center })
      : [];
    if (options.length === 0) {
      options = await deps.search({ ...base, text: cleanQuery(`${component.query(draft)} ${refinement}`) });
    }
    if (options.length === 0) {
      await call.sendInstruction(
        `Tell the caller you couldn't find a good ${component.label} for them, so you're skipping it.`,
      );
      delete draft.picks[component.kind];
      return advance(call, draft);
    }
    draft.options[component.kind] = options;
    const round = draft.refined.includes(component.kind) ? 2 : 1;
    draft.attempt += 1;
    await call.setTask(pickTask(component, options, round, draft.attempt));
  }

  async function advance(call: guava.Call, draft: PlanDraft): Promise<void> {
    if (draft.redoQueue) {
      const next = draft.redoQueue.shift();
      if (next !== undefined) {
        draft.componentIndex = next;
        return startPick(call, draft);
      }
      draft.redoQueue = null;
      return startConfirm(call, draft);
    }
    draft.componentIndex += 1;
    return startPick(call, draft);
  }

  async function startConfirm(call: guava.Call, draft: PlanDraft): Promise<void> {
    const changeChoices = draft.redoUsed ? [] : draft.components.map(changeChoice);
    draft.attempt += 1;
    await call.setTask(confirmTask(summarizeDraft(draft), changeChoices, draft.attempt));
  }

  async function handleTriage(call: guava.Call, draft: PlanDraft): Promise<void> {
    const rawType = fieldText(await call.getField("event_type"));
    const type = parseEventType(rawType);
    if (!type) logger.warn("Unknown event type %s; using friends playbook", rawType);
    draft.type = type ?? "friends";
    const rawBudget = await call.getField("budget");
    const budget = formatUsd(rawBudget) ?? fieldText(rawBudget);
    const when = await call.getField("event_datetime");
    const { area, corrected } = await resolveArea(fieldText(await call.getField("area")));
    draft.basics = {
      when: toLocalIso(when) ?? fieldText(when),
      area,
      ...(budget ? { budget } : {}),
    };
    await call.setTask(detailsTask(PLAYBOOKS[draft.type], corrected ? area : undefined));
  }

  /** Google's spelling of the city when one matches; `corrected` when that changes its name. */
  async function resolveArea(spoken: string): Promise<{ area: string; corrected: boolean }> {
    if (!spoken || !deps.resolveArea) return { area: spoken, corrected: false };
    let locality: Locality | null = null;
    try {
      locality = await deps.resolveArea(spoken);
    } catch (err) {
      logger.warn("Checking the city %s failed: %s", spoken, err);
    }
    if (!locality) return { area: spoken, corrected: false };
    const area = locality.formatted.replace(/, USA$/, "");
    const corrected = !spoken.toLowerCase().includes(locality.name.toLowerCase());
    if (corrected) logger.info("Corrected the city from %s to %s", spoken, area);
    return { area, corrected };
  }

  async function handleDetails(call: guava.Call, draft: PlanDraft): Promise<void> {
    const playbook = PLAYBOOKS[draft.type ?? "friends"];
    for (const field of playbook.detailFields) {
      const raw = fieldText(await call.getField(field.key));
      // Playbooks compare multiple-choice answers against their lower-case choices.
      const value = field.fieldType === "multiple_choice" ? raw.toLowerCase() : raw;
      if (value) draft.preferences[field.key] = value;
    }
    const partySize = playbook.partySize(draft);
    if (partySize !== undefined) draft.basics.partySize = partySize;
    draft.components = playbook.components.filter((c) => c.includeWhen?.(draft) ?? true);
    draft.componentIndex = 0;
    await startPick(call, draft);
  }

  async function handlePick(
    call: guava.Call,
    draft: PlanDraft,
    kind: PlanItemKind,
    attempt: number,
  ): Promise<void> {
    const choice = fieldText(await call.getField(pickFieldKey(kind, attempt))).toLowerCase();
    const picked = draft.options[kind]?.find((o) => o.name.trim().toLowerCase() === choice);
    if (picked) {
      draft.picks[kind] = picked;
      return advance(call, draft);
    }
    if (!draft.refined.includes(kind)) {
      draft.refined.push(kind);
      return startPick(call, draft, fieldText(await call.getField(refineFieldKey(kind, attempt))));
    }
    delete draft.picks[kind];
    return advance(call, draft);
  }

  async function handleConfirm(call: guava.Call, draft: PlanDraft, attempt: number): Promise<void> {
    const answer = fieldText(await call.getField(confirmFieldKey(attempt))).toLowerCase();
    const index = draft.components.findIndex((c) => changeChoice(c) === answer);
    if (!draft.redoUsed && index >= 0) {
      const kind = draft.components[index]!.kind;
      // Components that depend on the redone one (parking near the venue) are re-picked too.
      const dependents = draft.components.flatMap((c, i) => (c.dependsOn === kind ? [i] : []));
      const redoKinds = [index, ...dependents].map((i) => draft.components[i]!.kind);
      draft.redoUsed = true;
      draft.redoQueue = dependents;
      draft.componentIndex = index;
      draft.refined = draft.refined.filter((k) => !redoKinds.includes(k));
      return startPick(call, draft);
    }
    return finish(call, draft);
  }

  async function finish(call: guava.Call, draft: PlanDraft): Promise<void> {
    draft.saved = true;
    let saved: EventPlan | null = null;
    try {
      saved = deps.store.create(buildPlan(draft, "confirmed", now()));
    } catch (err) {
      logger.error("Saving plan for call %s failed: %s", call.id, err);
    }
    if (!saved) {
      draft.wrapUpScript =
        "I'm sorry, the plan couldn't be saved because of a technical problem, so there is no event ID. " +
        `Here's the plan so you can note it down. ${summarizeDraft(draft).replace(/\n/g, ". ")}.`;
      return startWrapUp(call, draft);
    }

    const eventId = saved.id;
    const link = shareUrl(deps.publicBaseUrl, eventId);
    logger.info("Event %s saved: %s", eventId, link);
    const texted = await sendShareLink({
      sender: deps.sms,
      from: deps.agentNumber,
      to: draft.callerPhone,
      eventId,
      publicBaseUrl: deps.publicBaseUrl,
      onError: (err) => logger.warn("Sending SMS for %s failed: %s", eventId, err),
    });
    const spoken = spokenEventId(eventId);
    draft.wrapUpScript =
      "Your plan is all set! Just so you know, every booking is simulated for this demo. " +
      `Your event ID is ${spoken}. Once more, that's ${spoken}. ` +
      (texted
        ? "I've also texted you the link so you can share it."
        : `You can view and share it at ${link}.`);
    return startWrapUp(call, draft);
  }

  async function startWrapUp(call: guava.Call, draft: PlanDraft): Promise<void> {
    draft.attempt += 1;
    await call.setTask(wrapUpTask(draft.wrapUpScript ?? "", draft.attempt));
  }

  async function handleWrapUp(call: guava.Call, draft: PlanDraft, attempt: number): Promise<void> {
    const answer = fieldText(await call.getField(wrapUpFieldKey(attempt))).toLowerCase();
    if (answer === READY_TO_HANG_UP) {
      await call.hangup("Thank the caller warmly and say goodbye.");
      return;
    }
    // Anything but an explicit "ready to hang up" keeps the caller on the line.
    return startWrapUp(call, draft);
  }

  agent.onCallStart(async (call) => {
    const info = call.callInfo;
    const phone = info.call_type === "pstn" ? info.from_number : null;
    drafts.set(call.id, newDraft(phone));
    await call.setTask(triageTask());
  });

  agent.onTaskComplete(async (call, taskId) => {
    const draft = drafts.get(call.id);
    if (!draft) {
      logger.warn("No plan draft for call %s (task %s)", call.id, taskId);
      return;
    }
    const { name, attempt } = parseTaskId(taskId);
    if (name === "triage") return handleTriage(call, draft);
    if (name.startsWith("details:")) return handleDetails(call, draft);
    if (name.startsWith("pick:")) return handlePick(call, draft, name.slice("pick:".length) as PlanItemKind, attempt);
    if (name === "confirm") return handleConfirm(call, draft, attempt);
    if (name === "wrap-up") return handleWrapUp(call, draft, attempt);
    logger.warn("Unexpected task %s on call %s", taskId, call.id);
  });

  agent.onSessionEnd(async (call) => {
    const draft = drafts.get(call.id);
    drafts.delete(call.id);
    if (!draft || draft.saved || !draft.type) return;
    try {
      const saved = deps.store.create(buildPlan(draft, "incomplete", now()));
      logger.info("Saved incomplete plan %s for call %s", saved.id, call.id);
    } catch (err) {
      logger.error("Saving incomplete plan for call %s failed: %s", call.id, err);
    }
  });

  return agent;
}
