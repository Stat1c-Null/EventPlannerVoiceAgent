import type { PlaceResult, PlanItemKind } from "../types.ts";

const SAMPLE_NAMES: Record<PlanItemKind, string[]> = {
  dinner: ["The Candlelit Table", "Olive & Ember", "Harbor Lights Bistro"],
  food: ["Big Table Tacos", "Slice Society", "Noodle Commons"],
  activity: ["Starlight Lanes", "Riverside Escape Rooms", "Laugh Track Loft"],
  venue: ["Summit Conference Loft", "The Atrium Rooms", "Brickworks Event Hall"],
  catering: ["Fresh Plate Catering", "Boardroom Bites", "Green Fork Caterers"],
  parking: ["Central Street Garage", "Market Square Parking", "Plaza Lot B"],
  gift: ["Petal & Stem Florist", "Chapter One Books", "Sweet Ribbon Chocolates"],
};

export function sampleResults(kind: PlanItemKind, area: string): PlaceResult[] {
  const where = area.trim() || "your area";
  return SAMPLE_NAMES[kind].map((name) => ({
    name,
    address: `${where} (sample address)`,
    sample: true,
  }));
}
