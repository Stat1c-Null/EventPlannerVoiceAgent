import { test } from "node:test";
import assert from "node:assert/strict";
import { renderIcs } from "../src/web/calendar.ts";
import type { EventPlan } from "../src/types.ts";

function plan(overrides: Partial<EventPlan> = {}): EventPlan {
  return {
    id: "BLUE-FALCON-42",
    type: "date",
    title: "Date night in Atlanta, Georgia",
    status: "confirmed",
    basics: { when: "2026-10-18T18:00", area: "Atlanta, Georgia", partySize: 2 },
    preferences: {},
    items: [
      { kind: "dinner", name: "Olive & Ember", address: "1 Peachtree St, Atlanta, GA", confirmation: { code: "RSV-ABCDE", simulated: true } },
      { kind: "parking", name: "Central Garage", address: "2 Peachtree St, Atlanta, GA", confirmation: { code: "PRK-FGHJK", simulated: true } },
    ],
    createdAt: "2026-10-12T12:00:00.000Z",
    ...overrides,
  };
}

const LINK = "http://localhost:3000/e/BLUE-FALCON-42";
const NOW = new Date("2026-10-12T12:34:56Z");
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

test("renderIcs builds a calendar event with CRLF line endings", () => {
  const ics = renderIcs(plan(), LINK, NOW)!;
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "every line must end with CRLF");
});

test("renderIcs starts at the plan's local time and lasts three hours", () => {
  const ics = unfold(renderIcs(plan(), LINK, NOW)!);
  assert.ok(ics.includes("\r\nDTSTART:20261018T180000\r\n"));
  assert.ok(ics.includes("\r\nDTEND:20261018T210000\r\n"));
  assert.ok(ics.includes("\r\nDTSTAMP:20261012T123456Z\r\n"));
  assert.ok(ics.includes("\r\nUID:BLUE-FALCON-42@event-planner\r\n"));
});

test("renderIcs rolls the end time over midnight", () => {
  const ics = renderIcs(plan({ basics: { when: "2026-10-18T22:30", area: "Atlanta" } }), LINK, NOW)!;
  assert.ok(ics.includes("\r\nDTEND:20261019T013000\r\n"));
});

test("renderIcs escapes text and includes location, itinerary and link", () => {
  const ics = unfold(renderIcs(plan(), LINK, NOW)!);
  assert.ok(ics.includes("\r\nSUMMARY:Date night in Atlanta\\, Georgia\r\n"));
  assert.ok(ics.includes("\r\nLOCATION:Olive & Ember\\, 1 Peachtree St\\, Atlanta\\, GA\r\n"));
  assert.ok(ics.includes("Dinner: Olive & Ember"));
  assert.ok(ics.includes("RSV-ABCDE (simulated)"));
  assert.ok(ics.includes(`\r\nURL:${LINK}\r\n`));
  assert.ok(ics.includes("\\n"), "description lines are joined with an escaped newline");
});

test("renderIcs folds lines longer than 75 characters", () => {
  const ics = renderIcs(plan({ title: "A".repeat(200) }), LINK, NOW)!;
  for (const line of ics.split("\r\n")) assert.ok(line.length <= 75, `line too long: ${line.length}`);
  assert.ok(unfold(ics).includes(`SUMMARY:${"A".repeat(200)}`));
});

test("renderIcs returns null when the plan has no usable start time", () => {
  assert.equal(renderIcs(plan({ basics: { when: "next Friday-ish", area: "Atlanta" } }), LINK, NOW), null);
});
