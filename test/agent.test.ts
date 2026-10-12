import { test } from "node:test";
import assert from "node:assert/strict";
import * as guava from "@guava-ai/guava-sdk";
import { MockCall } from "@guava-ai/guava-sdk";
import { createAgent, type AgentDeps } from "../src/agent/agent.ts";
import type { PlacesQuery } from "../src/services/places.ts";
import type { EventPlan, PlaceResult } from "../src/types.ts";

type SetTask = { command_type: "set-task"; task_id: string; objective: string; action_items: Array<{ key?: string; choices?: string[] }> };
type AnyCommand = { command_type: string; instruction?: string };

const commands = (call: MockCall) => call.commands as unknown as AnyCommand[];
const tasks = (call: MockCall): SetTask[] =>
  commands(call).filter((c) => c.command_type === "set-task") as unknown as SetTask[];
const lastTask = (call: MockCall): SetTask => tasks(call).at(-1)!;
/** Task IDs carry a per-attempt suffix ("pick:dinner#3"); compare on the name before it. */
const lastTaskName = (call: MockCall): string => lastTask(call).task_id.split("#")[0]!;
const instructions = (call: MockCall): string[] =>
  commands(call).flatMap((c) => (c.command_type === "send-instruction" && c.instruction ? [c.instruction] : []));

const CALLER = "+15551234567";
const phoneCall = () =>
  new MockCall({ callInfo: { call_type: "pstn", from_number: CALLER, to_number: "+12402514603", caller_id: null } });

function setup(overrides: Partial<AgentDeps> = {}) {
  const created: Omit<EventPlan, "id">[] = [];
  const sent: string[][] = [];
  const searches: PlacesQuery[] = [];
  const deps: AgentDeps = {
    store: { create: (plan) => { created.push(plan); return { id: "BLUE-FALCON-42", ...plan }; } },
    search: async (query) => {
      searches.push(query);
      return [
        { name: `${query.kind} one`, address: `1 ${query.kind} St`, sample: false },
        { name: `${query.kind} two`, address: `2 ${query.kind} St`, sample: false },
      ] satisfies PlaceResult[];
    },
    sms: { sendSms: async (from, to, message) => void sent.push([from, to, message]) },
    agentNumber: "+12402514603",
    publicBaseUrl: "http://localhost:3000",
    now: () => new Date("2026-10-12T12:00:00Z"),
    logger: guava.getConsoleLogger("off"),
    ...overrides,
  };
  return { agent: createAgent(deps), created, sent, searches };
}

async function complete(agent: guava.Agent, call: MockCall, taskId: string, fieldValues: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(fieldValues)) call.setField(key, value);
  await agent.handlers.onTaskComplete(taskId, call);
}

/** Answer the current pick or confirm task: its first field gets `choice`, its second (if any) `refine`. */
async function answer(agent: guava.Agent, call: MockCall, choice: string, refine?: string) {
  const task = lastTask(call);
  const [choiceKey, refineKey] = task.action_items.map((item) => item.key!);
  call.setField(choiceKey!, choice);
  if (refine !== undefined && refineKey) call.setField(refineKey, refine);
  await agent.handlers.onTaskComplete(task.task_id, call);
}

async function pickFirstOfEach(agent: guava.Agent, call: MockCall, kinds: string[]) {
  for (const kind of kinds) {
    assert.equal(lastTaskName(call), `pick:${kind}`);
    await answer(agent, call, `${kind} one`);
  }
}

async function throughDetails(agent: guava.Agent, call: MockCall, type: string, details: Record<string, unknown>) {
  await agent.handlers.onCallStart(call);
  await complete(agent, call, "triage", { event_type: type, event_datetime: "2026-10-20T19:00", area: "Austin, TX", budget: "$300" });
  const detailsTaskId = lastTask(call).task_id;
  await complete(agent, call, detailsTaskId, details);
}

const endEvent = {} as unknown as guava.BotSessionEnded;

test("a date with a gift runs triage → details → 4 picks → confirm → saved, texted, hung up", async () => {
  const { agent, created, sent } = setup();
  const call = phoneCall();

  await agent.handlers.onCallStart(call);
  assert.equal(lastTask(call).task_id, "triage");

  await complete(agent, call, "triage", { event_type: "date", event_datetime: "2026-10-20T19:00", area: "Austin, TX" });
  assert.equal(lastTask(call).task_id, "details:date");

  await complete(agent, call, "details:date", {
    occasion: "anniversary", food_preferences: "italian", vibe: "romantic", wants_gift: "yes", gift_interests: "books",
  });

  await pickFirstOfEach(agent, call, ["dinner", "activity", "parking", "gift"]);

  assert.equal(lastTaskName(call), "confirm");
  await answer(agent, call, "looks good");

  assert.equal(created.length, 1);
  const plan = created[0]!;
  assert.equal(plan.status, "confirmed");
  assert.equal(plan.type, "date");
  assert.equal(plan.basics.partySize, 2);
  assert.equal(plan.callerPhone, CALLER);
  assert.deepEqual(plan.items.map((i) => i.kind), ["dinner", "activity", "parking", "gift"]);
  assert.ok(plan.items.every((i) => i.confirmation.simulated));

  assert.equal(sent.length, 1);
  assert.equal(sent[0]![1], CALLER);
  assert.ok(sent[0]![2]!.includes("http://localhost:3000/e/BLUE-FALCON-42"));

  const goodbye = instructions(call).at(-1)!;
  assert.ok(goodbye.includes("BLUE-FALCON-42"));
  assert.ok(goodbye.toLowerCase().includes("simulated"));
  assert.ok(goodbye.includes("texted"));
});

test("parking is searched near the chosen primary venue", async () => {
  const { agent, searches } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "business event", { headcount: 12, purpose: "client dinner", room_needs: "projector" });
  assert.equal(lastTaskName(call), "pick:venue");
  await answer(agent, call, "venue two");
  await answer(agent, call, "catering one");
  assert.equal(lastTaskName(call), "pick:parking");
  assert.equal(searches.at(-1)!.text, "parking near 2 venue St");
});

test("business events never ask about a gift and use headcount as party size", async () => {
  const { agent, created } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "business event", { headcount: 12, purpose: "offsite", room_needs: "private room" });
  await pickFirstOfEach(agent, call, ["venue", "catering", "parking"]);
  await answer(agent, call, "looks good");
  assert.deepEqual(created[0]!.items.map((i) => i.kind), ["venue", "catering", "parking"]);
  assert.equal(created[0]!.basics.partySize, 12);
});

test("'none of these' re-searches once with the refinement, then a second 'none' skips", async () => {
  const { agent, searches, created } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 6, vibe: "games" });
  assert.equal(lastTaskName(call), "pick:activity");

  await answer(agent, call, "none of these", "something with karaoke");
  assert.equal(lastTaskName(call), "pick:activity");
  assert.ok(searches.at(-1)!.text.endsWith("something with karaoke"));
  assert.equal(lastTask(call).action_items.length, 1);

  await answer(agent, call, "none of these");
  assert.equal(lastTaskName(call), "pick:food");

  await pickFirstOfEach(agent, call, ["food", "parking"]);
  await answer(agent, call, "looks good");
  assert.deepEqual(created[0]!.items.map((i) => i.kind), ["food", "parking"]);
});

test("a component with zero real results is skipped with a spoken note", async () => {
  const { agent } = setup({
    search: async (query) => (query.kind === "activity" ? [] : [{ name: "x", address: "1 X St", sample: false }]),
  });
  const call = phoneCall();
  await throughDetails(agent, call, "date", { vibe: "casual", wants_gift: "no" });
  await answer(agent, call, "x");
  assert.equal(lastTaskName(call), "pick:parking");
  assert.ok(instructions(call).some((i) => i.includes("date activity")));
});

test("confirm allows exactly one redo, then only 'looks good'", async () => {
  const { agent, created } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "date", { vibe: "romantic", wants_gift: "no" });
  await pickFirstOfEach(agent, call, ["dinner", "activity", "parking"]);
  assert.deepEqual(lastTask(call).action_items[0]!.choices, [
    "looks good", "change the dinner spot", "change the date activity", "change the parking spot",
  ]);

  await answer(agent, call, "change the date activity");
  assert.equal(lastTaskName(call), "pick:activity");
  await answer(agent, call, "activity two");

  assert.equal(lastTaskName(call), "confirm");
  assert.deepEqual(lastTask(call).action_items[0]!.choices, ["looks good"]);
  await answer(agent, call, "looks good");
  assert.equal(created[0]!.items[1]!.name, "activity two");
});

test("redoing the dinner also re-picks parking near the new dinner spot", async () => {
  const { agent, created, searches } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "date", { vibe: "romantic", wants_gift: "no" });
  await pickFirstOfEach(agent, call, ["dinner", "activity", "parking"]);

  await answer(agent, call, "change the dinner spot");
  assert.equal(lastTaskName(call), "pick:dinner");
  await answer(agent, call, "dinner two");

  assert.equal(lastTaskName(call), "pick:parking");
  assert.equal(searches.at(-1)!.text, "parking near 2 dinner St");
  await answer(agent, call, "parking two");

  assert.equal(lastTaskName(call), "confirm");
  assert.deepEqual(lastTask(call).action_items[0]!.choices, ["looks good"]);
  await answer(agent, call, "looks good");
  assert.deepEqual(
    created[0]!.items.map((i) => i.name),
    ["dinner two", "activity one", "parking two"],
  );
});

test("every pick and confirm attempt gets a fresh task ID and fresh field keys", async () => {
  const { agent } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "bars" });
  await answer(agent, call, "none of these", "rooftop");
  await pickFirstOfEach(agent, call, ["activity", "food", "parking"]);
  await answer(agent, call, "change the food spot");
  await answer(agent, call, "food two");

  const attempts = tasks(call).filter((t) => t.task_id !== "triage" && !t.task_id.startsWith("details:"));
  const ids = attempts.map((t) => t.task_id);
  const keys = attempts.flatMap((t) => t.action_items.map((i) => i.key));
  assert.equal(new Set(ids).size, ids.length, `task IDs repeat: ${ids.join(", ")}`);
  assert.equal(new Set(keys).size, keys.length, `field keys repeat: ${keys.join(", ")}`);
});

test("a redo ignores the refinement given in an earlier attempt", async () => {
  const { agent, searches } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "bars" });
  await answer(agent, call, "none of these", "rooftop");
  await pickFirstOfEach(agent, call, ["activity", "food", "parking"]);

  await answer(agent, call, "change the group activity");
  await answer(agent, call, "none of these");
  assert.equal(lastTaskName(call), "pick:activity");
  assert.ok(!searches.at(-1)!.text.includes("rooftop"), searches.at(-1)!.text);
});

test("multiple-choice detail answers are matched regardless of case", async () => {
  const { agent, searches } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "date", { vibe: "Romantic", wants_gift: "Yes", gift_interests: "books" });
  assert.equal(searches[0]!.text.startsWith("romantic restaurant"), true, searches[0]!.text);
  await pickFirstOfEach(agent, call, ["dinner", "activity", "parking", "gift"]);
  assert.equal(lastTaskName(call), "confirm");
});

test("a dropped call saves one incomplete plan; a finished call is not saved twice", async () => {
  const dropped = setup();
  const droppedCall = phoneCall();
  await throughDetails(dropped.agent, droppedCall, "date", { vibe: "casual", wants_gift: "no" });
  await answer(dropped.agent, droppedCall, "dinner one");
  await dropped.agent.handlers.onSessionEnd(droppedCall, endEvent);
  assert.equal(dropped.created.length, 1);
  assert.equal(dropped.created[0]!.status, "incomplete");
  assert.deepEqual(dropped.created[0]!.items.map((i) => i.kind), ["dinner"]);
  assert.equal(dropped.sent.length, 0);

  const finished = setup();
  const call = phoneCall();
  await throughDetails(finished.agent, call, "date", { vibe: "casual", wants_gift: "no" });
  await pickFirstOfEach(finished.agent, call, ["dinner", "activity", "parking"]);
  await answer(finished.agent, call, "looks good");
  await finished.agent.handlers.onSessionEnd(call, endEvent);
  assert.equal(finished.created.length, 1);
});

test("a call that ends before the event type is known saves nothing", async () => {
  const { agent, created } = setup();
  const call = phoneCall();
  await agent.handlers.onCallStart(call);
  await agent.handlers.onSessionEnd(call, endEvent);
  assert.equal(created.length, 0);
});

test("SMS failure still ends the call with the spoken ID and link", async () => {
  const { agent } = setup({ sms: { sendSms: async () => { throw new Error("SMS not enabled"); } } });
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "bars" });
  await pickFirstOfEach(agent, call, ["activity", "food", "parking"]);
  await answer(agent, call, "looks good");
  const goodbye = instructions(call).at(-1)!;
  assert.ok(goodbye.includes("BLUE-FALCON-42"));
  assert.ok(goodbye.includes("http://localhost:3000/e/BLUE-FALCON-42"));
  assert.ok(!goodbye.includes("texted"));
});

test("a WebRTC call has no caller number, so no SMS is attempted", async () => {
  const { agent, sent, created } = setup();
  const call = new MockCall({ callInfo: { call_type: "webrtc", webrtc_code: "abc" } });
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "outdoors" });
  await pickFirstOfEach(agent, call, ["activity", "food", "parking"]);
  await answer(agent, call, "looks good");
  assert.equal(sent.length, 0);
  assert.equal(created[0]!.callerPhone, undefined);
});

test("a DB failure ends the call honestly with no event ID and no SMS", async () => {
  const { agent, sent } = setup({ store: { create: () => { throw new Error("disk full"); } } });
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "bars" });
  await pickFirstOfEach(agent, call, ["activity", "food", "parking"]);
  await answer(agent, call, "looks good");
  const goodbye = instructions(call).at(-1)!;
  assert.ok(goodbye.toLowerCase().includes("couldn't be saved"));
  assert.ok(!goodbye.includes("BLUE-FALCON-42"));
  assert.equal(sent.length, 0);
});
