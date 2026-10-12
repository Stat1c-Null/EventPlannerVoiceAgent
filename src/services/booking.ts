import type { Confirmation, PlanItemKind } from "../types.ts";

const PREFIX: Record<PlanItemKind, string> = {
  dinner: "RSV",
  food: "RSV",
  activity: "TIX",
  venue: "VEN",
  catering: "CAT",
  parking: "PRK",
  gift: "GFT",
};

// No 0/O or 1/I so codes are easy to read aloud.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function mockConfirmation(
  kind: PlanItemKind,
  random: () => number = Math.random,
): Confirmation {
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  }
  return { code: `${PREFIX[kind]}-${suffix}`, simulated: true };
}
