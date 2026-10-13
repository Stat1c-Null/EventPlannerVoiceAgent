import { toLocalIso } from "../datetime.ts";
import type { EventPlan, PlanItemKind } from "../types.ts";

const EVENT_HOURS = 3;
const MAX_LINE = 75;

const KIND_LABELS: Record<PlanItemKind, string> = {
  dinner: "Dinner",
  food: "Food",
  activity: "Activity",
  venue: "Venue",
  catering: "Catering",
  parking: "Parking",
  gift: "Gift",
};

/** RFC 5545 TEXT escaping. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 folding: continuation lines start with a space. */
function fold(line: string): string {
  if (line.length <= MAX_LINE) return line;
  const parts = [line.slice(0, MAX_LINE)];
  for (let i = MAX_LINE; i < line.length; i += MAX_LINE - 1) parts.push(` ${line.slice(i, i + MAX_LINE - 1)}`);
  return parts.join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats UTC-based date parts as an iCalendar date-time (floating unless `utc`). */
function icsTime(date: Date, utc = false): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}${utc ? "Z" : ""}`
  );
}

/**
 * A one-event calendar file for the plan, or null when the plan has no usable start time.
 * Times are "floating" (no time zone), so calendars show the event at the local time it was
 * planned for, wherever the viewer is.
 */
export function renderIcs(plan: EventPlan, shareLink: string, now: Date = new Date()): string | null {
  const iso = toLocalIso(plan.basics.when) ?? plan.basics.when;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  // Do the arithmetic in UTC so the 3-hour end time never shifts with the server's time zone.
  const start = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const end = new Date(start.getTime() + EVENT_HOURS * 60 * 60 * 1000);

  const first = plan.items[0];
  const itinerary = plan.items.map(
    (item) => `${KIND_LABELS[item.kind]}: ${item.name}, ${item.address} — ${item.confirmation.code} (simulated)`,
  );
  const description = [...itinerary, `Plan: ${shareLink}`].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Event Planner//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${plan.id}@event-planner`,
    `DTSTAMP:${icsTime(now, true)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${escapeText(plan.title)}`,
    ...(first ? [`LOCATION:${escapeText(`${first.name}, ${first.address}`)}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${shareLink}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
