import type { EventType, PlanItemKind } from "../types.ts";
import type { PlanDraft } from "./draft.ts";

export interface FieldSpec {
  key: string;
  description: string;
  fieldType: "text" | "integer" | "multiple_choice";
  choices?: string[];
  required?: boolean;
}

export interface ComponentSpec {
  kind: PlanItemKind;
  /** Spoken name, e.g. "dinner spot". */
  label: string;
  includeWhen?: (draft: PlanDraft) => boolean;
  query: (draft: PlanDraft) => string;
}

export interface Playbook {
  type: EventType;
  /** Spoken name, e.g. "date night". */
  label: string;
  /** Page title prefix, e.g. "Date night". */
  title: string;
  tone: string;
  detailFields: FieldSpec[];
  partySize: (draft: PlanDraft) => number | undefined;
  components: ComponentSpec[];
}

export const EVENT_TYPE_CHOICES: Record<string, EventType> = {
  "date": "date",
  "friends hangout": "friends",
  "business event": "business",
};

export function parseEventType(raw: string): EventType | null {
  return EVENT_TYPE_CHOICES[raw.trim().toLowerCase()] ?? null;
}

const pref = (draft: PlanDraft, key: string, fallback = ""): string =>
  draft.preferences[key] ?? fallback;

const area = (draft: PlanDraft): string => draft.basics.area ?? "";

const parkingNear = (kind: PlanItemKind) => (draft: PlanDraft): string =>
  `parking near ${draft.picks[kind]?.address ?? area(draft)}`;

const positiveInt = (raw: string | undefined): number | undefined => {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const FRIENDS_ACTIVITY: Record<string, string> = {
  bars: "cocktail bar",
  games: "bowling alley or arcade bar",
  outdoors: "outdoor activity",
};

export const PLAYBOOKS: Record<EventType, Playbook> = {
  date: {
    type: "date",
    label: "date night",
    title: "Date night",
    tone: "Warm and a little playful. Keep suggestions romantic but not cheesy.",
    detailFields: [
      { key: "occasion", fieldType: "text", description: "What the occasion is, such as a first date, an anniversary, or just a night out." },
      { key: "food_preferences", fieldType: "text", description: "Cuisines they love or foods either person avoids." },
      { key: "vibe", fieldType: "multiple_choice", choices: ["romantic", "casual", "adventurous"], description: "The vibe they want for the date." },
      { key: "wants_gift", fieldType: "multiple_choice", choices: ["yes", "no"], description: "Whether they want help getting a gift for their date." },
      { key: "gift_interests", fieldType: "text", required: false, description: "Only if they want a gift: what their date is into, such as flowers, books, or chocolate." },
    ],
    partySize: () => 2,
    components: [
      { kind: "dinner", label: "dinner spot", query: (d) => `${pref(d, "vibe", "romantic")} restaurant ${pref(d, "food_preferences")} in ${area(d)}` },
      { kind: "activity", label: "date activity", query: (d) => `${pref(d, "vibe", "fun")} date night activity in ${area(d)}` },
      { kind: "parking", label: "parking spot", query: parkingNear("dinner") },
      {
        kind: "gift",
        label: "gift shop",
        includeWhen: (d) => pref(d, "wants_gift") === "yes",
        query: (d) => `gift shop for ${pref(d, "gift_interests", "flowers")} in ${area(d)}`,
      },
    ],
  },
  friends: {
    type: "friends",
    label: "hangout with friends",
    title: "Friends hangout",
    tone: "Casual and upbeat. Favor places that work well for groups.",
    detailFields: [
      { key: "group_size", fieldType: "integer", description: "How many people are coming, including the caller." },
      { key: "vibe", fieldType: "multiple_choice", choices: ["bars", "games", "outdoors"], description: "What kind of hangout the group wants." },
      { key: "dietary", fieldType: "text", required: false, description: "Any dietary needs in the group." },
    ],
    partySize: (d) => positiveInt(d.preferences.group_size),
    components: [
      { kind: "activity", label: "group activity", query: (d) => `${FRIENDS_ACTIVITY[pref(d, "vibe")] ?? "fun group activity"} for groups in ${area(d)}` },
      { kind: "food", label: "food spot", query: (d) => `group friendly restaurant ${pref(d, "dietary")} in ${area(d)}` },
      { kind: "parking", label: "parking spot", query: parkingNear("activity") },
    ],
  },
  business: {
    type: "business",
    label: "business event",
    title: "Business event",
    tone: "Professional and efficient. Confirm practical details clearly.",
    detailFields: [
      { key: "headcount", fieldType: "integer", description: "How many people will attend." },
      { key: "purpose", fieldType: "text", description: "What the event is for, such as a client dinner, team offsite, or workshop." },
      { key: "room_needs", fieldType: "text", description: "Room needs such as a private room, projector, or whiteboard." },
      { key: "dietary", fieldType: "text", required: false, description: "Any dietary needs among attendees." },
    ],
    partySize: (d) => positiveInt(d.preferences.headcount),
    components: [
      { kind: "venue", label: "venue", query: (d) => `meeting venue with ${pref(d, "room_needs", "private room")} for ${pref(d, "headcount", "a group of")} people in ${area(d)}` },
      { kind: "catering", label: "caterer", query: (d) => `corporate catering ${pref(d, "dietary")} in ${area(d)}` },
      { kind: "parking", label: "parking spot", query: parkingNear("venue") },
    ],
  },
};
