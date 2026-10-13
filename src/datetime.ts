/**
 * Guava `datetime` fields arrive as `{ year, month, day, hour, minute }`. Converts that object
 * (or its JSON text, as stored by plans saved before this conversion existed) into a local
 * ISO string such as "2026-10-18T18:00". Returns null for anything else.
 */
export function toLocalIso(value: unknown): string | null {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!parsed.trim().startsWith("{")) return null;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { year, month, day, hour = 0, minute = 0 } = parsed as Record<string, unknown>;
  if (![year, month, day, hour, minute].every((n) => Number.isInteger(n))) return null;
  const pad = (n: unknown) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}
