import * as guava from "@guava-ai/guava-sdk";
import { shareUrl } from "../config.ts";
import type { PlacesQuery } from "../services/places.ts";
import { sendShareLink, type SmsSender } from "../services/sms.ts";
import type { EventStore } from "../store/events.ts";
import type { EventPlan, PlaceResult, PlanItemKind } from "../types.ts";
import { newDraft, type PlanDraft } from "./draft.ts";
import { buildPlan } from "./plan.ts";
import { PLAYBOOKS, parseEventType } from "./playbooks.ts";
import {
  changeChoice,
  confirmTask,
  detailsTask,
  pickFieldKey,
  pickTask,
  refineFieldKey,
  summarizeDraft,
  triageTask,
} from "./tasks.ts";

export interface AgentDeps {
  store: Pick<EventStore, "create">;
  search: (query: PlacesQuery) => Promise<PlaceResult[]>;
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

    const text = cleanQuery(`${component.query(draft)} ${refinement}`);
    const options = await deps.search({ text, kind: component.kind, area: draft.basics.area ?? "" });
    if (options.length === 0) {
      await call.sendInstruction(
        `Tell the caller you couldn't find a good ${component.label} for them, so you're skipping it.`,
      );
      delete draft.picks[component.kind];
      return advance(call, draft);
    }
    draft.options[component.kind] = options;
    const round = draft.refined.includes(component.kind) ? 2 : 1;
    await call.setTask(pickTask(component, options, round));
  }

  async function advance(call: guava.Call, draft: PlanDraft): Promise<void> {
    if (draft.redoing) {
      draft.redoing = false;
      return startConfirm(call, draft);
    }
    draft.componentIndex += 1;
    return startPick(call, draft);
  }

  async function startConfirm(call: guava.Call, draft: PlanDraft): Promise<void> {
    const changeChoices = draft.redoUsed ? [] : draft.components.map(changeChoice);
    await call.setTask(confirmTask(summarizeDraft(draft), changeChoices));
  }

  async function handleTriage(call: guava.Call, draft: PlanDraft): Promise<void> {
    const rawType = fieldText(await call.getField("event_type"));
    const type = parseEventType(rawType);
    if (!type) logger.warn("Unknown event type %s; using friends playbook", rawType);
    draft.type = type ?? "friends";
    const budget = fieldText(await call.getField("budget"));
    draft.basics = {
      when: fieldText(await call.getField("event_datetime")),
      area: fieldText(await call.getField("area")),
      ...(budget ? { budget } : {}),
    };
    await call.setTask(detailsTask(PLAYBOOKS[draft.type]));
  }

  async function handleDetails(call: guava.Call, draft: PlanDraft): Promise<void> {
    const playbook = PLAYBOOKS[draft.type ?? "friends"];
    for (const field of playbook.detailFields) {
      const value = fieldText(await call.getField(field.key));
      if (value) draft.preferences[field.key] = value;
    }
    const partySize = playbook.partySize(draft);
    if (partySize !== undefined) draft.basics.partySize = partySize;
    draft.components = playbook.components.filter((c) => c.includeWhen?.(draft) ?? true);
    draft.componentIndex = 0;
    await startPick(call, draft);
  }

  async function handlePick(call: guava.Call, draft: PlanDraft, kind: PlanItemKind): Promise<void> {
    const choice = fieldText(await call.getField(pickFieldKey(kind))).toLowerCase();
    const picked = draft.options[kind]?.find((o) => o.name.trim().toLowerCase() === choice);
    if (picked) {
      draft.picks[kind] = picked;
      return advance(call, draft);
    }
    if (!draft.refined.includes(kind)) {
      draft.refined.push(kind);
      return startPick(call, draft, fieldText(await call.getField(refineFieldKey(kind))));
    }
    delete draft.picks[kind];
    return advance(call, draft);
  }

  async function handleConfirm(call: guava.Call, draft: PlanDraft): Promise<void> {
    const answer = fieldText(await call.getField("confirm_choice")).toLowerCase();
    const index = draft.components.findIndex((c) => changeChoice(c) === answer);
    if (!draft.redoUsed && index >= 0) {
      const kind = draft.components[index]!.kind;
      draft.redoUsed = true;
      draft.redoing = true;
      draft.componentIndex = index;
      draft.refined = draft.refined.filter((k) => k !== kind);
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
      await call.hangup(
        "Apologize: the plan couldn't be saved because of a technical problem, so there is no event ID. " +
          `Read this plan back once so they can note it down, then say goodbye.\n${summarizeDraft(draft)}`,
      );
      return;
    }

    const eventId = saved.id;
    const link = shareUrl(deps.publicBaseUrl, eventId);
    const texted = await sendShareLink({
      sender: deps.sms,
      from: deps.agentNumber,
      to: draft.callerPhone,
      eventId,
      publicBaseUrl: deps.publicBaseUrl,
      onError: (err) => logger.warn("Sending SMS for %s failed: %s", eventId, err),
    });
    await call.hangup(
      "Tell the caller their plan is all set, and remind them the bookings are simulated for this demo. " +
        `Their event ID is ${eventId}; read it slowly, word by word. ` +
        (texted
          ? "Say you've texted them the link so they can share it."
          : `Tell them they can view and share it at ${link}.`),
    );
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
    if (taskId === "triage") return handleTriage(call, draft);
    if (taskId.startsWith("details:")) return handleDetails(call, draft);
    if (taskId.startsWith("pick:")) return handlePick(call, draft, taskId.slice("pick:".length) as PlanItemKind);
    if (taskId === "confirm") return handleConfirm(call, draft);
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
