import * as guava from "@guava-ai/guava-sdk";
import type { PlaceResult, PlanItemKind } from "../types.ts";
import type { PlanDraft } from "./draft.ts";
import { EVENT_TYPE_CHOICES, type ComponentSpec, type Playbook } from "./playbooks.ts";

export type TaskArgs = Parameters<guava.Call["setTask"]>[0];

export const NONE_OF_THESE = "none of these";
export const LOOKS_GOOD = "looks good";

// Pick and confirm tasks can run more than once per call (re-search, redo). Each attempt gets
// its own task ID and field keys because the SDK keeps one field map for the whole call.
export const pickFieldKey = (kind: PlanItemKind, attempt: number): string => `pick_${kind}_${attempt}`;
export const refineFieldKey = (kind: PlanItemKind, attempt: number): string => `refine_${kind}_${attempt}`;
export const confirmFieldKey = (attempt: number): string => `confirm_choice_${attempt}`;
export const changeChoice = (component: ComponentSpec): string => `change the ${component.label}`;

/** Splits "pick:dinner#3" into its name ("pick:dinner") and attempt (3). */
export function parseTaskId(taskId: string): { name: string; attempt: number } {
  const [name = "", attempt = "0"] = taskId.split("#");
  return { name, attempt: Number(attempt) };
}

export function triageTask(): TaskArgs {
  return {
    taskId: "triage",
    objective:
      "Find out what kind of event the caller wants to plan, plus when and where it happens and any budget.",
    checklist: [
      guava.Say("Hi! I'm your event planner. Tell me what you're planning and I'll find the spots, sort out parking, and book it."),
      guava.Field({
        key: "event_type",
        fieldType: "multiple_choice",
        choices: Object.keys(EVENT_TYPE_CHOICES),
        description: "What kind of event they are planning.",
      }),
      guava.Field({ key: "event_datetime", fieldType: "datetime", description: "When the event starts, date and time." }),
      guava.Field({ key: "area", fieldType: "text", description: "The city or neighborhood where it should happen." }),
      guava.Field({ key: "budget", fieldType: "text", required: false, description: "Their rough budget for the whole event, if they have one." }),
    ],
  };
}

export function detailsTask(playbook: Playbook): TaskArgs {
  return {
    taskId: `details:${playbook.type}`,
    objective: `Ask a few quick questions to plan a great ${playbook.label}. Tone: ${playbook.tone}`,
    checklist: playbook.detailFields.map((field) =>
      guava.Field({
        key: field.key,
        fieldType: field.fieldType,
        description: field.description,
        choices: field.choices,
        required: field.required ?? true,
      }),
    ),
  };
}

export function pickTask(
  component: ComponentSpec,
  options: PlaceResult[],
  round: 1 | 2,
  attempt: number,
): TaskArgs {
  const optionList = options.map((o, i) => `${i + 1}. ${o.name} — ${o.address}`).join("\n");
  const sampleNote = options.some((o) => o.sample)
    ? " These are sample suggestions, not real places, so tell the caller that."
    : "";
  const noneMeaning = round === 1 ? "they don't like any of them" : `they want to skip the ${component.label}`;
  return {
    taskId: `pick:${component.kind}#${attempt}`,
    objective:
      `Help the caller choose a ${component.label}. Briefly describe each option by name and area.${sampleNote}\n` +
      `Options:\n${optionList}`,
    checklist: [
      guava.Field({
        key: pickFieldKey(component.kind, attempt),
        fieldType: "multiple_choice",
        choices: [...options.map((o) => o.name), NONE_OF_THESE],
        description: `Which ${component.label} they want. Choose "${NONE_OF_THESE}" if ${noneMeaning}.`,
      }),
      ...(round === 1
        ? [
            guava.Field({
              key: refineFieldKey(component.kind, attempt),
              fieldType: "text",
              required: false,
              description: `Only if they chose "${NONE_OF_THESE}": what they would prefer instead.`,
            }),
          ]
        : []),
    ],
  };
}

export function confirmTask(summary: string, changeChoices: string[], attempt: number): TaskArgs {
  return {
    taskId: `confirm#${attempt}`,
    objective: `Read this plan back to the caller in a natural way and ask whether it looks good.\n${summary}`,
    checklist: [
      guava.Field({
        key: confirmFieldKey(attempt),
        fieldType: "multiple_choice",
        choices: [LOOKS_GOOD, ...changeChoices],
        description: "Whether the plan looks good, or which one part they want to change.",
      }),
    ],
  };
}

export function summarizeDraft(draft: PlanDraft): string {
  const lines = [`When: ${draft.basics.when ?? "not set"}`, `Where: ${draft.basics.area ?? "not set"}`];
  for (const component of draft.components) {
    const pick = draft.picks[component.kind];
    lines.push(pick ? `${component.label}: ${pick.name}, ${pick.address}` : `${component.label}: skipped`);
  }
  return lines.join("\n");
}
