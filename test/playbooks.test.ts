import { test } from "node:test";
import assert from "node:assert/strict";
import { newDraft } from "../src/agent/draft.ts";
import { PLAYBOOKS, parseEventType } from "../src/agent/playbooks.ts";
import {
  LOOKS_GOOD,
  NONE_OF_THESE,
  changeChoice,
  confirmTask,
  detailsTask,
  pickFieldKey,
  pickTask,
  refineFieldKey,
  summarizeDraft,
  triageTask,
} from "../src/agent/tasks.ts";
import { buildPlan } from "../src/agent/plan.ts";
import type { PlaceResult } from "../src/types.ts";

type FieldLike = { item_type: string; key?: string; choices?: string[]; field_type?: string; required?: boolean };
const fields = (checklist: unknown[] | undefined): FieldLike[] =>
  (checklist ?? []).filter((item): item is FieldLike => typeof item === "object" && (item as FieldLike).item_type === "field");

const place = (name: string, extra: Partial<PlaceResult> = {}): PlaceResult => ({
  name, address: `${name} address`, sample: false, ...extra,
});

test("parseEventType maps the spoken choices and rejects anything else", () => {
  assert.equal(parseEventType("date"), "date");
  assert.equal(parseEventType(" Friends Hangout "), "friends");
  assert.equal(parseEventType("business event"), "business");
  assert.equal(parseEventType("wedding"), null);
});

test("triageTask asks for type, datetime, area, and optional budget", () => {
  const task = triageTask();
  assert.equal(task.taskId, "triage");
  const byKey = Object.fromEntries(fields(task.checklist).map((f) => [f.key, f]));
  assert.deepEqual(byKey.event_type?.choices, ["date", "friends hangout", "business event"]);
  assert.equal(byKey.event_datetime?.field_type, "datetime");
  assert.equal(byKey.area?.field_type, "text");
  assert.equal(byKey.budget?.required, false);
});

test("each playbook's details task asks only that playbook's questions", () => {
  const keys = (type: "date" | "friends" | "business") =>
    fields(detailsTask(PLAYBOOKS[type]).checklist).map((f) => f.key);
  assert.deepEqual(keys("date"), ["occasion", "food_preferences", "vibe", "wants_gift", "gift_interests"]);
  assert.deepEqual(keys("friends"), ["group_size", "vibe", "dietary"]);
  assert.deepEqual(keys("business"), ["headcount", "purpose", "room_needs", "dietary"]);
  assert.equal(detailsTask(PLAYBOOKS.business).taskId, "details:business");
});

test("components per playbook, with the date gift only when wanted", () => {
  const draft = newDraft(null);
  const kinds = (type: "date" | "friends" | "business") =>
    PLAYBOOKS[type].components.filter((c) => c.includeWhen?.(draft) ?? true).map((c) => c.kind);
  draft.preferences.wants_gift = "no";
  assert.deepEqual(kinds("date"), ["dinner", "activity", "parking"]);
  draft.preferences.wants_gift = "yes";
  assert.deepEqual(kinds("date"), ["dinner", "activity", "parking", "gift"]);
  assert.deepEqual(kinds("friends"), ["activity", "food", "parking"]);
  assert.deepEqual(kinds("business"), ["venue", "catering", "parking"]);
});

test("parking searches near the primary pick, falling back to the area", () => {
  const draft = newDraft(null);
  draft.basics.area = "Austin, TX";
  const parking = PLAYBOOKS.date.components.find((c) => c.kind === "parking")!;
  assert.equal(parking.query(draft), "parking near Austin, TX");
  draft.picks.dinner = place("Olive Grove", { address: "1 Main St" });
  assert.equal(parking.query(draft), "parking near 1 Main St");
});

test("party size: 2 for a date, from answers for friends and business", () => {
  const draft = newDraft(null);
  assert.equal(PLAYBOOKS.date.partySize(draft), 2);
  draft.preferences.group_size = "6";
  draft.preferences.headcount = "twelve";
  assert.equal(PLAYBOOKS.friends.partySize(draft), 6);
  assert.equal(PLAYBOOKS.business.partySize(draft), undefined);
});

test("pickTask round 1 offers names plus 'none of these' and a refinement field", () => {
  const dinner = PLAYBOOKS.date.components[0]!;
  const task = pickTask(dinner, [place("A"), place("B")], 1);
  assert.equal(task.taskId, "pick:dinner");
  const [choice, refine] = fields(task.checklist);
  assert.equal(choice?.key, pickFieldKey("dinner"));
  assert.deepEqual(choice?.choices, ["A", "B", NONE_OF_THESE]);
  assert.equal(refine?.key, refineFieldKey("dinner"));
  assert.ok(task.objective?.includes("A address"));
  assert.ok(!task.objective?.includes("sample"));
});

test("pickTask round 2 has no refinement field; sample results are disclosed", () => {
  const dinner = PLAYBOOKS.date.components[0]!;
  const task = pickTask(dinner, [place("A", { sample: true })], 2);
  assert.deepEqual(fields(task.checklist).map((f) => f.key), [pickFieldKey("dinner")]);
  assert.ok(task.objective?.includes("sample"));
});

test("confirmTask offers 'looks good' plus the change choices", () => {
  const dinner = PLAYBOOKS.date.components[0]!;
  const task = confirmTask("summary text", [changeChoice(dinner)]);
  assert.equal(task.taskId, "confirm");
  assert.deepEqual(fields(task.checklist)[0]?.choices, [LOOKS_GOOD, "change the dinner spot"]);
  assert.ok(task.objective?.includes("summary text"));
});

test("summarizeDraft lists picks and skipped components", () => {
  const draft = newDraft(null);
  draft.basics = { when: "Friday 7pm", area: "Austin, TX" };
  draft.components = PLAYBOOKS.friends.components;
  draft.picks.activity = place("Starlight Lanes");
  const summary = summarizeDraft(draft);
  assert.ok(summary.includes("Friday 7pm"));
  assert.ok(summary.includes("group activity: Starlight Lanes, Starlight Lanes address"));
  assert.ok(summary.includes("food spot: skipped"));
});

test("buildPlan turns picks into simulated items in playbook order", () => {
  const draft = newDraft("+15551234567");
  draft.type = "date";
  draft.basics = { when: "2026-10-20T19:00", area: "Austin, TX", partySize: 2, budget: "$200" };
  draft.preferences = { gift_interests: "books" };
  draft.components = PLAYBOOKS.date.components;
  draft.picks.gift = place("Chapter One Books", { sample: true });
  draft.picks.dinner = place("Olive Grove", { mapsUrl: "https://maps.google.com/?cid=1" });

  const plan = buildPlan(draft, "confirmed", new Date("2026-10-12T12:00:00Z"));

  assert.equal(plan.title, "Date night in Austin, TX");
  assert.equal(plan.status, "confirmed");
  assert.equal(plan.callerPhone, "+15551234567");
  assert.equal(plan.createdAt, "2026-10-12T12:00:00.000Z");
  assert.deepEqual(plan.basics, { when: "2026-10-20T19:00", area: "Austin, TX", partySize: 2, budget: "$200" });
  assert.deepEqual(plan.items.map((i) => i.kind), ["dinner", "gift"]);
  assert.equal(plan.items[0]?.time, "2026-10-20T19:00");
  assert.equal(plan.items[0]?.mapsUrl, "https://maps.google.com/?cid=1");
  assert.equal(plan.items[1]?.time, undefined);
  assert.ok(plan.items[1]?.notes?.includes("Sample suggestion"));
  assert.ok(plan.items[1]?.notes?.includes("books"));
  assert.ok(plan.items.every((i) => i.confirmation.simulated));
});
