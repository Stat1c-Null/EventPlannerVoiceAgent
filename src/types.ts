export type EventType = "date" | "friends" | "business";

export type PlanItemKind =
  | "dinner"
  | "food"
  | "activity"
  | "venue"
  | "catering"
  | "parking"
  | "gift";

export interface Confirmation {
  code: string;
  simulated: true;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlanItem {
  kind: PlanItemKind;
  name: string;
  address: string;
  mapsUrl?: string;
  location?: LatLng;
  time?: string;
  notes?: string;
  confirmation: Confirmation;
}

export interface EventBasics {
  when: string;
  area: string;
  partySize?: number;
  budget?: string;
}

export interface EventPlan {
  id: string;
  type: EventType;
  title: string;
  status: "confirmed" | "incomplete";
  basics: EventBasics;
  preferences: Record<string, string>;
  items: PlanItem[];
  callerPhone?: string;
  createdAt: string;
}

export interface PlaceResult {
  name: string;
  address: string;
  mapsUrl?: string;
  location?: LatLng;
  sample: boolean;
}
