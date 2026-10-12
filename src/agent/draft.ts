import type { EventBasics, EventType, PlaceResult, PlanItemKind } from "../types.ts";
import type { ComponentSpec } from "./playbooks.ts";

/** Everything known about one call's plan while the call is in progress. */
export interface PlanDraft {
  type?: EventType;
  basics: Partial<EventBasics>;
  preferences: Record<string, string>;
  components: ComponentSpec[];
  componentIndex: number;
  options: Partial<Record<PlanItemKind, PlaceResult[]>>;
  picks: Partial<Record<PlanItemKind, PlaceResult>>;
  /** Components that already used their one "none of these" re-search. */
  refined: PlanItemKind[];
  redoUsed: boolean;
  /** Component indexes still to re-pick during the one redo; null when not redoing. */
  redoQueue: number[] | null;
  /** Bumped for every pick/confirm task so task IDs and field keys never repeat. */
  attempt: number;
  saved: boolean;
  callerPhone: string | null;
}

export function newDraft(callerPhone: string | null): PlanDraft {
  return {
    basics: {},
    preferences: {},
    components: [],
    componentIndex: 0,
    options: {},
    picks: {},
    refined: [],
    redoUsed: false,
    redoQueue: null,
    attempt: 0,
    saved: false,
    callerPhone,
  };
}
