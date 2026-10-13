import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalIso } from "../src/datetime.ts";

test("toLocalIso converts Guava's datetime object to a local ISO string", () => {
  assert.equal(toLocalIso({ day: 18, month: 10, year: 2026, hour: 18, minute: 0 }), "2026-10-18T18:00");
  assert.equal(toLocalIso({ day: 3, month: 2, year: 2027, hour: 9, minute: 5 }), "2027-02-03T09:05");
});

test("toLocalIso accepts that object serialized as JSON (plans saved before the fix)", () => {
  assert.equal(toLocalIso('{"day":18,"month":10,"year":2026,"hour":18,"minute":0}'), "2026-10-18T18:00");
});

test("toLocalIso treats a missing time as midnight", () => {
  assert.equal(toLocalIso({ day: 18, month: 10, year: 2026 }), "2026-10-18T00:00");
});

test("toLocalIso returns null for anything that is not a datetime object", () => {
  assert.equal(toLocalIso("next Friday-ish"), null);
  assert.equal(toLocalIso("2026-10-18T18:00"), null);
  assert.equal(toLocalIso(null), null);
  assert.equal(toLocalIso({ day: 18 }), null);
  assert.equal(toLocalIso("{not json"), null);
});
