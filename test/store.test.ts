import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENT_ID_PATTERN, generateEventId, normalizeEventId } from "../src/store/ids.ts";
import { EventStore } from "../src/store/events.ts";
import type { EventPlan } from "../src/types.ts";

function samplePlan(): Omit<EventPlan, "id"> {
  return {
    type: "date",
    title: "Date night in Austin, TX",
    status: "confirmed",
    basics: { when: "2026-10-20T19:00", area: "Austin, TX", partySize: 2 },
    preferences: { vibe: "romantic" },
    items: [],
    callerPhone: "+15551234567",
    createdAt: "2026-10-12T12:00:00.000Z",
  };
}

test("generateEventId produces ADJECTIVE-NOUN-NN", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateEventId(), EVENT_ID_PATTERN);
  }
});

test("generateEventId is deterministic for a given random source", () => {
  assert.equal(generateEventId(() => 0), generateEventId(() => 0));
  assert.match(generateEventId(() => 0.999999), EVENT_ID_PATTERN);
});

test("normalizeEventId trims and upper-cases", () => {
  assert.equal(normalizeEventId("  blue-falcon-42 "), "BLUE-FALCON-42");
});

test("normalizeEventId accepts an ID typed the way it was spoken", () => {
  assert.equal(normalizeEventId("blue falcon 42"), "BLUE-FALCON-42");
  assert.equal(normalizeEventId("Blue_Falcon - 42"), "BLUE-FALCON-42");
});

test("create assigns an ID and get returns the same plan, case-insensitively", () => {
  const store = new EventStore(":memory:");
  const saved = store.create(samplePlan());
  assert.match(saved.id, EVENT_ID_PATTERN);
  assert.deepEqual(store.get(saved.id.toLowerCase()), saved);
  store.close();
});

test("get returns null for an unknown ID", () => {
  const store = new EventStore(":memory:");
  assert.equal(store.get("NOPE-NOPE-00"), null);
  store.close();
});

test("create retries on an ID collision", () => {
  const store = new EventStore(":memory:");
  const first = store.create(samplePlan(), () => 0);
  // Three draws per ID: the first ID repeats, then a different one appears.
  const draws = [0, 0, 0, 0.5, 0.5, 0.5];
  const second = store.create(samplePlan(), () => draws.shift() ?? 0.5);
  assert.notEqual(second.id, first.id);
  store.close();
});

test("create throws when no unique ID can be found", () => {
  const store = new EventStore(":memory:");
  store.create(samplePlan(), () => 0);
  assert.throws(() => store.create(samplePlan(), () => 0), /unique event ID/);
  store.close();
});

test("plans persist across store instances on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "events-"));
  try {
    const path = join(dir, "events.db");
    const first = new EventStore(path);
    const saved = first.create(samplePlan());
    first.close();
    const second = new EventStore(path);
    assert.deepEqual(second.get(saved.id), saved);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
