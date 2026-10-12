import { mockConfirmation } from "../services/booking.ts";
import type { EventPlan, PlanItem } from "../types.ts";
import type { PlanDraft } from "./draft.ts";
import { PLAYBOOKS } from "./playbooks.ts";

export function buildPlan(
  draft: PlanDraft,
  status: EventPlan["status"],
  now: Date,
  random: () => number = Math.random,
): Omit<EventPlan, "id"> {
  const type = draft.type ?? "friends";
  const area = draft.basics.area ?? "";
  const items: PlanItem[] = [];

  draft.components.forEach((component, index) => {
    const pick = draft.picks[component.kind];
    if (!pick) return;
    const notes = [
      pick.sample ? "Sample suggestion, not a real place" : "",
      component.kind === "gift"
        ? `Simulated gift order: ${draft.preferences.gift_interests ?? "a surprise"}`
        : "",
    ].filter(Boolean).join(". ");
    items.push({
      kind: component.kind,
      name: pick.name,
      address: pick.address,
      ...(pick.mapsUrl ? { mapsUrl: pick.mapsUrl } : {}),
      ...(index === 0 && draft.basics.when ? { time: draft.basics.when } : {}),
      ...(notes ? { notes } : {}),
      confirmation: mockConfirmation(component.kind, random),
    });
  });

  const title = PLAYBOOKS[type].title;
  return {
    type,
    title: area ? `${title} in ${area}` : title,
    status,
    basics: {
      when: draft.basics.when ?? "",
      area,
      ...(draft.basics.partySize !== undefined ? { partySize: draft.basics.partySize } : {}),
      ...(draft.basics.budget ? { budget: draft.basics.budget } : {}),
    },
    preferences: { ...draft.preferences },
    items,
    ...(draft.callerPhone ? { callerPhone: draft.callerPhone } : {}),
    createdAt: now.toISOString(),
  };
}
