# Event Planner Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Guava voice agent that plans a date, friends hangout, or business event over one call, "books" it (simulated), saves it under a speakable event ID, texts the link, and a small web UI that shows the plan at `/e/<id>`.

**Architecture:** A playbook per event type decides, at runtime, which questions the agent asks and which components (dinner, parking, gift, …) it picks. The agent chains Guava tasks (`triage` → `details:<type>` → `pick:<kind>`… → `confirm`) from one generic `onTaskComplete` handler, keeping per-call state in a `PlanDraft`. Plans go to SQLite via `node:sqlite`; a `node:http` server renders them.

**Tech Stack:** Node 24, TypeScript run with `tsx`, `@guava-ai/guava-sdk` 0.38.0, `node:sqlite`, `node:http`, `node:test`, Google Places API (Text Search, New).

**Spec:** `docs/plans/2026-10-12-event-planner-design.md`

## Global Constraints

- Node 24 or newer (`node:sqlite`, `--env-file-if-exists`). Verified locally: v24.19.0.
- Runtime dependencies stay `@guava-ai/guava-sdk` and `tsx` only. Dev dependencies added: `typescript`, `@types/node`. No web framework, no database library, no test framework.
- ES modules (`"type": "module"`); relative imports use the `.ts` extension.
- Every booking is simulated: `confirmation.simulated` is always `true`, the agent says so, and the web UI shows a "Simulated" badge.
- `callerPhone` is never rendered in HTML or returned by the JSON API.
- Places request: `POST https://places.googleapis.com/v1/places:searchText`, headers `X-Goog-Api-Key` and `X-Goog-FieldMask: places.displayName,places.formattedAddress,places.googleMapsUri`, body `{ textQuery, pageSize: 3 }`, 5 s timeout. No rating or price fields.
- Defaults: `GUAVA_AGENT_NUMBER=+12402514603`, `PUBLIC_BASE_URL=http://localhost:3000`, `PORT=3000`, `EVENTS_DB_PATH=./events.db`.
- **Never run `git commit`, `git push`, `git merge`, `git rebase`, or `git cherry-pick`.** The repository owner commits. Each task ends with a checkpoint where the owner reviews and commits.

## Review Focus

1. **Caller rejects every option** — "none of these" triggers one re-search with the caller's refinement; a second "none of these" skips the component instead of looping. Pinned in Task 6.
2. **Places returns nothing or duplicates** — zero real results skips the component with a spoken note; duplicate names are deduplicated so the multiple-choice answer maps to one place. Pinned in Tasks 3 and 6.
3. **Untrusted text reaching the page** — place names, caller answers, and Maps URLs come from outside; HTML must be escaped and non-`https:` Maps links dropped. Pinned in Task 8.
4. **Call ends early or twice** — a dropped call saves one `incomplete` plan; a finished call is not saved again when the session ends. Pinned in Task 6.
5. **Hand-off failures** — SMS failure, no caller number (WebRTC/chat), or a DB write failure must still end the call cleanly with an honest spoken message. Pinned in Task 6.

---

### Task 1: Tooling, shared types, and configuration

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore` (create if missing)
- Create: `src/types.ts`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/types.ts`: `EventType`, `PlanItemKind`, `Confirmation`, `PlanItem`, `EventBasics`, `EventPlan`, `PlaceResult` (exact shapes below).
  - `src/config.ts`: `interface AppConfig { placesApiKey?: string; agentNumber: string; publicBaseUrl: string; port: number; dbPath: string }`, `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`, `shareUrl(publicBaseUrl: string, eventId: string): string`.

- [ ] **Step 1: Install dev dependencies**

Run: `npm install --save-dev typescript @types/node@24`
Expected: `package.json` gains a `devDependencies` block with both packages.

- [ ] **Step 2: Replace the `scripts` block in `package.json`**

```json
  "scripts": {
    "start": "node --env-file-if-exists=.env --import tsx main.ts",
    "chat": "node --env-file-if-exists=.env --import tsx main.ts --chat",
    "web": "node --env-file-if-exists=.env --import tsx src/web/main.ts",
    "roleplay": "node --env-file-if-exists=.env --import tsx scripts/roleplay.ts",
    "test": "node --import tsx --test \"test/**/*.test.ts\"",
    "typecheck": "tsc"
  },
```

- [ ] **Step 3: Replace `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["main.ts", "src", "scripts", "test"]
}
```

- [ ] **Step 4: Make sure `.gitignore` contains these lines**

```
node_modules/
.env
*.db
*.db-journal
*.db-wal
*.db-shm
```

- [ ] **Step 5: Write the failing test** — `test/config.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, shareUrl } from "../src/config.ts";

test("loadConfig applies defaults when nothing is set", () => {
  assert.deepEqual(loadConfig({}), {
    placesApiKey: undefined,
    agentNumber: "+12402514603",
    publicBaseUrl: "http://localhost:3000",
    port: 3000,
    dbPath: "./events.db",
  });
});

test("loadConfig reads the environment and trims trailing slashes", () => {
  const config = loadConfig({
    GOOGLE_PLACES_API_KEY: "key-123",
    GUAVA_AGENT_NUMBER: "+15550001111",
    PUBLIC_BASE_URL: "https://plans.example.com//",
    PORT: "8080",
    EVENTS_DB_PATH: "/tmp/plans.db",
  });
  assert.equal(config.placesApiKey, "key-123");
  assert.equal(config.agentNumber, "+15550001111");
  assert.equal(config.publicBaseUrl, "https://plans.example.com");
  assert.equal(config.port, 8080);
  assert.equal(config.dbPath, "/tmp/plans.db");
});

test("loadConfig treats empty strings as unset", () => {
  const config = loadConfig({ GOOGLE_PLACES_API_KEY: "", PORT: "" });
  assert.equal(config.placesApiKey, undefined);
  assert.equal(config.port, 3000);
});

test("loadConfig rejects a PORT that is not a valid port number", () => {
  assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT/);
});

test("shareUrl builds the plan page link", () => {
  assert.equal(
    shareUrl("http://localhost:3000", "BLUE-FALCON-42"),
    "http://localhost:3000/e/BLUE-FALCON-42",
  );
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/config.ts'`.

- [ ] **Step 7: Create `src/types.ts`**

```ts
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

export interface PlanItem {
  kind: PlanItemKind;
  name: string;
  address: string;
  mapsUrl?: string;
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
  sample: boolean;
}
```

- [ ] **Step 8: Create `src/config.ts`**

```ts
export interface AppConfig {
  placesApiKey?: string;
  agentNumber: string;
  publicBaseUrl: string;
  port: number;
  dbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT || "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${env.PORT}"`);
  }
  return {
    placesApiKey: env.GOOGLE_PLACES_API_KEY || undefined,
    agentNumber: env.GUAVA_AGENT_NUMBER || "+12402514603",
    publicBaseUrl: (env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
    port,
    dbPath: env.EVENTS_DB_PATH || "./events.db",
  };
}

export function shareUrl(publicBaseUrl: string, eventId: string): string {
  return `${publicBaseUrl}/e/${encodeURIComponent(eventId)}`;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests.

- [ ] **Step 10: Checkpoint — owner reviews and commits** (`package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`, `src/config.ts`, `test/config.test.ts`). Do not run `git commit`.

---

### Task 2: Event IDs and SQLite store

**Files:**
- Create: `src/store/ids.ts`
- Create: `src/store/events.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Consumes: `EventPlan` from `src/types.ts`.
- Produces:
  - `src/store/ids.ts`: `EVENT_ID_PATTERN: RegExp`, `generateEventId(random?: () => number): string`, `normalizeEventId(raw: string): string`.
  - `src/store/events.ts`: `class EventStore { constructor(path: string); create(plan: Omit<EventPlan, "id">, random?: () => number): EventPlan; get(id: string): EventPlan | null; close(): void }`.

- [ ] **Step 1: Write the failing test** — `test/store.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/store/ids.ts'`.

- [ ] **Step 3: Create `src/store/ids.ts`**

```ts
const ADJECTIVES = [
  "AMBER", "BLUE", "BRAVE", "BRIGHT", "CALM", "CLEVER", "COSMIC", "CRISP",
  "DAPPER", "EAGER", "FANCY", "GOLDEN", "HAPPY", "JOLLY", "LIVELY", "LUCKY",
  "MELLOW", "MERRY", "NIMBLE", "PLUM", "QUIET", "RAPID", "ROSY", "RUBY",
  "SILVER", "SNAPPY", "SUNNY", "SWIFT", "TIDY", "VIVID", "WARM", "ZESTY",
];

const NOUNS = [
  "BADGER", "CANYON", "COMET", "CORAL", "CRANE", "DOLPHIN", "EMBER", "FALCON",
  "FERN", "GROVE", "HARBOR", "HERON", "LANTERN", "MAPLE", "MEADOW", "ORCHID",
  "OTTER", "PANDA", "PEBBLE", "PIER", "QUILL", "RAVEN", "RIVER", "ROBIN",
  "SPARROW", "SUMMIT", "TIGER", "TULIP", "VALLEY", "WALRUS", "WILLOW", "ZEBRA",
];

export const EVENT_ID_PATTERN = /^[A-Z]+-[A-Z]+-\d{2}$/;

export function generateEventId(random: () => number = Math.random): string {
  const pick = (words: string[]): string => words[Math.floor(random() * words.length)]!;
  const number = 10 + Math.floor(random() * 90);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${number}`;
}

export function normalizeEventId(raw: string): string {
  return raw.trim().toUpperCase();
}
```

- [ ] **Step 4: Create `src/store/events.ts`**

```ts
import { DatabaseSync } from "node:sqlite";
import type { EventPlan } from "../types.ts";
import { generateEventId, normalizeEventId } from "./ids.ts";

const MAX_ID_ATTEMPTS = 20;

export class EventStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
  }

  create(plan: Omit<EventPlan, "id">, random: () => number = Math.random): EventPlan {
    const insert = this.#db.prepare(
      "INSERT OR IGNORE INTO events (id, json, created_at) VALUES (?, ?, ?)",
    );
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const saved: EventPlan = { id: generateEventId(random), ...plan };
      const result = insert.run(saved.id, JSON.stringify(saved), saved.createdAt);
      if (Number(result.changes) === 1) return saved;
    }
    throw new Error(`Could not allocate a unique event ID after ${MAX_ID_ATTEMPTS} attempts`);
  }

  get(id: string): EventPlan | null {
    const row = this.#db
      .prepare("SELECT json FROM events WHERE id = ?")
      .get(normalizeEventId(id)) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as EventPlan) : null;
  }

  close(): void {
    this.#db.close();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all store and config tests. Node may print an `ExperimentalWarning` for `node:sqlite`; that is not a failure.

- [ ] **Step 6: Checkpoint — owner reviews and commits** (`src/store/`, `test/store.test.ts`). Do not run `git commit`.

---

### Task 3: Places search with sample fallback

**Files:**
- Create: `src/services/catalog.ts`
- Create: `src/services/places.ts`
- Test: `test/places.test.ts`

**Interfaces:**
- Consumes: `PlaceResult`, `PlanItemKind` from `src/types.ts`.
- Produces:
  - `src/services/catalog.ts`: `sampleResults(kind: PlanItemKind, area: string): PlaceResult[]` (3 results, `sample: true`).
  - `src/services/places.ts`: `PLACES_ENDPOINT`, `PLACES_FIELD_MASK`, `interface PlacesQuery { text: string; kind: PlanItemKind; area: string }`, `interface PlacesOptions { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number; onError?: (err: unknown) => void }`, `searchPlaces(query: PlacesQuery, options?: PlacesOptions): Promise<PlaceResult[]>`, `parsePlacesResponse(body: unknown): PlaceResult[]`.

- [ ] **Step 1: Write the failing test** — `test/places.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLACES_ENDPOINT,
  PLACES_FIELD_MASK,
  parsePlacesResponse,
  searchPlaces,
  type PlacesQuery,
} from "../src/services/places.ts";

const query: PlacesQuery = { text: "romantic restaurant in Austin, TX", kind: "dinner", area: "Austin, TX" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("without an API key, returns three sample results for the kind", async () => {
  const results = await searchPlaces(query, {});
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.sample));
  assert.ok(results.every((r) => r.address.includes("Austin, TX")));
});

test("sends the documented request and parses the response", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return jsonResponse({
      places: [
        {
          displayName: { text: "Olive Grove" },
          formattedAddress: "1 Main St, Austin, TX",
          googleMapsUri: "https://maps.google.com/?cid=1",
        },
      ],
    });
  }) as typeof fetch;

  const results = await searchPlaces(query, { apiKey: "key-123", fetchImpl });

  assert.equal(seenUrl, PLACES_ENDPOINT);
  assert.equal(seenInit?.method, "POST");
  const headers = seenInit?.headers as Record<string, string>;
  assert.equal(headers["X-Goog-Api-Key"], "key-123");
  assert.equal(headers["X-Goog-FieldMask"], PLACES_FIELD_MASK);
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    textQuery: "romantic restaurant in Austin, TX",
    pageSize: 3,
  });
  assert.deepEqual(results, [
    { name: "Olive Grove", address: "1 Main St, Austin, TX", mapsUrl: "https://maps.google.com/?cid=1", sample: false },
  ]);
});

test("a non-2xx response falls back to samples and reports the error", async () => {
  const errors: unknown[] = [];
  const fetchImpl = (async () => jsonResponse({ error: "denied" }, 403)) as typeof fetch;
  const results = await searchPlaces(query, { apiKey: "k", fetchImpl, onError: (e) => errors.push(e) });
  assert.ok(results.every((r) => r.sample));
  assert.equal(errors.length, 1);
});

test("a network error or timeout falls back to samples", async () => {
  const fetchImpl = (async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as typeof fetch;
  const results = await searchPlaces(query, { apiKey: "k", fetchImpl });
  assert.ok(results.every((r) => r.sample));
});

test("a real response with no places returns an empty list, not samples", async () => {
  const fetchImpl = (async () => jsonResponse({})) as typeof fetch;
  assert.deepEqual(await searchPlaces(query, { apiKey: "k", fetchImpl }), []);
});

test("parsePlacesResponse skips malformed entries, dedupes names, and caps at 3", () => {
  const results = parsePlacesResponse({
    places: [
      null,
      { displayName: { text: "No Address" } },
      { displayName: { text: "Cafe A" }, formattedAddress: "1 A St" },
      { displayName: { text: "cafe a" }, formattedAddress: "2 A St" },
      { displayName: { text: "Cafe B" }, formattedAddress: "1 B St", googleMapsUri: 42 },
      { displayName: { text: "Cafe C" }, formattedAddress: "1 C St" },
      { displayName: { text: "Cafe D" }, formattedAddress: "1 D St" },
    ],
  });
  assert.deepEqual(
    results.map((r) => [r.name, r.mapsUrl]),
    [["Cafe A", undefined], ["Cafe B", undefined], ["Cafe C", undefined]],
  );
});

test("parsePlacesResponse returns [] for non-object bodies", () => {
  assert.deepEqual(parsePlacesResponse(null), []);
  assert.deepEqual(parsePlacesResponse("nope"), []);
  assert.deepEqual(parsePlacesResponse({ places: "nope" }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/services/places.ts'`.

- [ ] **Step 3: Create `src/services/catalog.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/services/places.ts`**

```ts
import type { PlaceResult, PlanItemKind } from "../types.ts";
import { sampleResults } from "./catalog.ts";

export const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
export const PLACES_FIELD_MASK = "places.displayName,places.formattedAddress,places.googleMapsUri";
const RESULT_LIMIT = 3;
const DEFAULT_TIMEOUT_MS = 5000;

export interface PlacesQuery {
  text: string;
  kind: PlanItemKind;
  area: string;
}

export interface PlacesOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onError?: (err: unknown) => void;
}

export async function searchPlaces(
  query: PlacesQuery,
  options: PlacesOptions = {},
): Promise<PlaceResult[]> {
  if (!options.apiKey) return sampleResults(query.kind, query.area);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": options.apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query.text, pageSize: RESULT_LIMIT }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Places API returned HTTP ${response.status}`);
    }
    return parsePlacesResponse(await response.json());
  } catch (err) {
    options.onError?.(err);
    return sampleResults(query.kind, query.area);
  }
}

export function parsePlacesResponse(body: unknown): PlaceResult[] {
  if (typeof body !== "object" || body === null) return [];
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];

  const results: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    const p = (place ?? {}) as {
      displayName?: { text?: unknown };
      formattedAddress?: unknown;
      googleMapsUri?: unknown;
    };
    const name = p.displayName?.text;
    const address = p.formattedAddress;
    if (typeof name !== "string" || typeof address !== "string") continue;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name,
      address,
      mapsUrl: typeof p.googleMapsUri === "string" ? p.googleMapsUri : undefined,
      sample: false,
    });
    if (results.length === RESULT_LIMIT) break;
  }
  return results;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all places tests.

- [ ] **Step 6: Checkpoint — owner reviews and commits** (`src/services/catalog.ts`, `src/services/places.ts`, `test/places.test.ts`). Do not run `git commit`.

---

### Task 4: Mock bookings and SMS share link

**Files:**
- Create: `src/services/booking.ts`
- Create: `src/services/sms.ts`
- Test: `test/services.test.ts`

**Interfaces:**
- Consumes: `Confirmation`, `PlanItemKind` from `src/types.ts`; `shareUrl` from `src/config.ts`.
- Produces:
  - `src/services/booking.ts`: `mockConfirmation(kind: PlanItemKind, random?: () => number): Confirmation`.
  - `src/services/sms.ts`: `interface SmsSender { sendSms(fromNumber: string, toNumber: string, message: string): Promise<void> }`, `shareMessage(eventId: string, publicBaseUrl: string): string`, `interface ShareLinkArgs { sender: SmsSender; from: string; to: string | null; eventId: string; publicBaseUrl: string; onError?: (err: unknown) => void }`, `sendShareLink(args: ShareLinkArgs): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** — `test/services.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mockConfirmation } from "../src/services/booking.ts";
import { sendShareLink, shareMessage, type SmsSender } from "../src/services/sms.ts";

test("mockConfirmation uses a kind-specific prefix and is always simulated", () => {
  assert.match(mockConfirmation("dinner").code, /^RSV-[A-Z2-9]{5}$/);
  assert.match(mockConfirmation("parking").code, /^PRK-[A-Z2-9]{5}$/);
  assert.match(mockConfirmation("gift").code, /^GFT-[A-Z2-9]{5}$/);
  assert.equal(mockConfirmation("venue").simulated, true);
});

test("mockConfirmation handles the extremes of the random source", () => {
  assert.match(mockConfirmation("food", () => 0).code, /^RSV-A{5}$/);
  assert.match(mockConfirmation("food", () => 0.9999999).code, /^RSV-9{5}$/);
});

test("shareMessage contains the ID, the link, and the simulated notice", () => {
  const message = shareMessage("BLUE-FALCON-42", "http://localhost:3000");
  assert.ok(message.includes("BLUE-FALCON-42"));
  assert.ok(message.includes("http://localhost:3000/e/BLUE-FALCON-42"));
  assert.ok(message.toLowerCase().includes("simulated"));
});

test("sendShareLink sends from the agent number to the caller", async () => {
  const sent: string[][] = [];
  const sender: SmsSender = { sendSms: async (from, to, message) => void sent.push([from, to, message]) };
  const ok = await sendShareLink({
    sender, from: "+12402514603", to: "+15551234567", eventId: "BLUE-FALCON-42", publicBaseUrl: "http://localhost:3000",
  });
  assert.equal(ok, true);
  assert.deepEqual(sent.map(([from, to]) => [from, to]), [["+12402514603", "+15551234567"]]);
});

test("sendShareLink returns false without a caller number and sends nothing", async () => {
  let calls = 0;
  const sender: SmsSender = { sendSms: async () => void calls++ };
  const ok = await sendShareLink({
    sender, from: "+12402514603", to: null, eventId: "X-Y-10", publicBaseUrl: "http://localhost:3000",
  });
  assert.equal(ok, false);
  assert.equal(calls, 0);
});

test("sendShareLink returns false and reports the error when sending fails", async () => {
  const errors: unknown[] = [];
  const sender: SmsSender = { sendSms: async () => { throw new Error("SMS not enabled"); } };
  const ok = await sendShareLink({
    sender, from: "+12402514603", to: "+15551234567", eventId: "X-Y-10",
    publicBaseUrl: "http://localhost:3000", onError: (e) => errors.push(e),
  });
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/services/booking.ts'`.

- [ ] **Step 3: Create `src/services/booking.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/services/sms.ts`**

```ts
import { shareUrl } from "../config.ts";

export interface SmsSender {
  sendSms(fromNumber: string, toNumber: string, message: string): Promise<void>;
}

export interface ShareLinkArgs {
  sender: SmsSender;
  from: string;
  to: string | null;
  eventId: string;
  publicBaseUrl: string;
  onError?: (err: unknown) => void;
}

export function shareMessage(eventId: string, publicBaseUrl: string): string {
  return (
    `Your plan is ready! Event ID ${eventId}: ${shareUrl(publicBaseUrl, eventId)} ` +
    "(all bookings are simulated)"
  );
}

export async function sendShareLink(args: ShareLinkArgs): Promise<boolean> {
  if (!args.to) return false;
  try {
    await args.sender.sendSms(args.from, args.to, shareMessage(args.eventId, args.publicBaseUrl));
    return true;
  } catch (err) {
    args.onError?.(err);
    return false;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Checkpoint — owner reviews and commits** (`src/services/booking.ts`, `src/services/sms.ts`, `test/services.test.ts`). Do not run `git commit`.

---

### Task 5: Playbooks, plan draft, and task builders

**Files:**
- Create: `src/agent/draft.ts`
- Create: `src/agent/playbooks.ts`
- Create: `src/agent/tasks.ts`
- Create: `src/agent/plan.ts`
- Test: `test/playbooks.test.ts`

**Interfaces:**
- Consumes: types from `src/types.ts`; `mockConfirmation` from Task 4.
- Produces:
  - `src/agent/draft.ts`: `interface PlanDraft` (fields below), `newDraft(callerPhone: string | null): PlanDraft`.
  - `src/agent/playbooks.ts`: `interface FieldSpec`, `interface ComponentSpec { kind: PlanItemKind; label: string; includeWhen?: (draft: PlanDraft) => boolean; query: (draft: PlanDraft) => string }`, `interface Playbook`, `PLAYBOOKS: Record<EventType, Playbook>`, `EVENT_TYPE_CHOICES: Record<string, EventType>`, `parseEventType(raw: string): EventType | null`.
  - `src/agent/tasks.ts`: `type TaskArgs`, `NONE_OF_THESE`, `LOOKS_GOOD`, `pickFieldKey(kind)`, `refineFieldKey(kind)`, `changeChoice(component)`, `triageTask()`, `detailsTask(playbook)`, `pickTask(component, options, round)`, `confirmTask(summary, changeChoices)`, `summarizeDraft(draft)`.
  - `src/agent/plan.ts`: `buildPlan(draft: PlanDraft, status: EventPlan["status"], now: Date, random?: () => number): Omit<EventPlan, "id">`.

- [ ] **Step 1: Write the failing test** — `test/playbooks.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDraft } from "../src/agent/draft.ts";
import { PLAYBOOKS, parseEventType } from "../src/agent/playbooks.ts";
import {
  LOOKS_GOOD,
  NONE_OF_THESE,
  changeChoice,
  confirmTask,
  detailsTask,
  pickFieldKey,
  pickTask,
  refineFieldKey,
  summarizeDraft,
  triageTask,
} from "../src/agent/tasks.ts";
import { buildPlan } from "../src/agent/plan.ts";
import type { PlaceResult } from "../src/types.ts";

type FieldLike = { item_type: string; key?: string; choices?: string[]; field_type?: string; required?: boolean };
const fields = (checklist: unknown[] | undefined): FieldLike[] =>
  (checklist ?? []).filter((item): item is FieldLike => typeof item === "object" && (item as FieldLike).item_type === "field");

const place = (name: string, extra: Partial<PlaceResult> = {}): PlaceResult => ({
  name, address: `${name} address`, sample: false, ...extra,
});

test("parseEventType maps the spoken choices and rejects anything else", () => {
  assert.equal(parseEventType("date"), "date");
  assert.equal(parseEventType(" Friends Hangout "), "friends");
  assert.equal(parseEventType("business event"), "business");
  assert.equal(parseEventType("wedding"), null);
});

test("triageTask asks for type, datetime, area, and optional budget", () => {
  const task = triageTask();
  assert.equal(task.taskId, "triage");
  const byKey = Object.fromEntries(fields(task.checklist).map((f) => [f.key, f]));
  assert.deepEqual(byKey.event_type?.choices, ["date", "friends hangout", "business event"]);
  assert.equal(byKey.event_datetime?.field_type, "datetime");
  assert.equal(byKey.area?.field_type, "text");
  assert.equal(byKey.budget?.required, false);
});

test("each playbook's details task asks only that playbook's questions", () => {
  const keys = (type: "date" | "friends" | "business") =>
    fields(detailsTask(PLAYBOOKS[type]).checklist).map((f) => f.key);
  assert.deepEqual(keys("date"), ["occasion", "food_preferences", "vibe", "wants_gift", "gift_interests"]);
  assert.deepEqual(keys("friends"), ["group_size", "vibe", "dietary"]);
  assert.deepEqual(keys("business"), ["headcount", "purpose", "room_needs", "dietary"]);
  assert.equal(detailsTask(PLAYBOOKS.business).taskId, "details:business");
});

test("components per playbook, with the date gift only when wanted", () => {
  const draft = newDraft(null);
  const kinds = (type: "date" | "friends" | "business") =>
    PLAYBOOKS[type].components.filter((c) => c.includeWhen?.(draft) ?? true).map((c) => c.kind);
  draft.preferences.wants_gift = "no";
  assert.deepEqual(kinds("date"), ["dinner", "activity", "parking"]);
  draft.preferences.wants_gift = "yes";
  assert.deepEqual(kinds("date"), ["dinner", "activity", "parking", "gift"]);
  assert.deepEqual(kinds("friends"), ["activity", "food", "parking"]);
  assert.deepEqual(kinds("business"), ["venue", "catering", "parking"]);
});

test("parking searches near the primary pick, falling back to the area", () => {
  const draft = newDraft(null);
  draft.basics.area = "Austin, TX";
  const parking = PLAYBOOKS.date.components.find((c) => c.kind === "parking")!;
  assert.equal(parking.query(draft), "parking near Austin, TX");
  draft.picks.dinner = place("Olive Grove", { address: "1 Main St" });
  assert.equal(parking.query(draft), "parking near 1 Main St");
});

test("party size: 2 for a date, from answers for friends and business", () => {
  const draft = newDraft(null);
  assert.equal(PLAYBOOKS.date.partySize(draft), 2);
  draft.preferences.group_size = "6";
  draft.preferences.headcount = "twelve";
  assert.equal(PLAYBOOKS.friends.partySize(draft), 6);
  assert.equal(PLAYBOOKS.business.partySize(draft), undefined);
});

test("pickTask round 1 offers names plus 'none of these' and a refinement field", () => {
  const dinner = PLAYBOOKS.date.components[0]!;
  const task = pickTask(dinner, [place("A"), place("B")], 1);
  assert.equal(task.taskId, "pick:dinner");
  const [choice, refine] = fields(task.checklist);
  assert.equal(choice?.key, pickFieldKey("dinner"));
  assert.deepEqual(choice?.choices, ["A", "B", NONE_OF_THESE]);
  assert.equal(refine?.key, refineFieldKey("dinner"));
  assert.ok(task.objective?.includes("A address"));
  assert.ok(!task.objective?.includes("sample"));
});

test("pickTask round 2 has no refinement field; sample results are disclosed", () => {
  const dinner = PLAYBOOKS.date.components[0]!;
  const task = pickTask(dinner, [place("A", { sample: true })], 2);
  assert.deepEqual(fields(task.checklist).map((f) => f.key), [pickFieldKey("dinner")]);
  assert.ok(task.objective?.includes("sample"));
});

test("confirmTask offers 'looks good' plus the change choices", () => {
  const dinner = PLAYBOOKS.date.components[0]!;
  const task = confirmTask("summary text", [changeChoice(dinner)]);
  assert.equal(task.taskId, "confirm");
  assert.deepEqual(fields(task.checklist)[0]?.choices, [LOOKS_GOOD, "change the dinner spot"]);
  assert.ok(task.objective?.includes("summary text"));
});

test("summarizeDraft lists picks and skipped components", () => {
  const draft = newDraft(null);
  draft.basics = { when: "Friday 7pm", area: "Austin, TX" };
  draft.components = PLAYBOOKS.friends.components;
  draft.picks.activity = place("Starlight Lanes");
  const summary = summarizeDraft(draft);
  assert.ok(summary.includes("Friday 7pm"));
  assert.ok(summary.includes("group activity: Starlight Lanes, Starlight Lanes address"));
  assert.ok(summary.includes("food spot: skipped"));
});

test("buildPlan turns picks into simulated items in playbook order", () => {
  const draft = newDraft("+15551234567");
  draft.type = "date";
  draft.basics = { when: "2026-10-20T19:00", area: "Austin, TX", partySize: 2, budget: "$200" };
  draft.preferences = { gift_interests: "books" };
  draft.components = PLAYBOOKS.date.components;
  draft.picks.gift = place("Chapter One Books", { sample: true });
  draft.picks.dinner = place("Olive Grove", { mapsUrl: "https://maps.google.com/?cid=1" });

  const plan = buildPlan(draft, "confirmed", new Date("2026-10-12T12:00:00Z"));

  assert.equal(plan.title, "Date night in Austin, TX");
  assert.equal(plan.status, "confirmed");
  assert.equal(plan.callerPhone, "+15551234567");
  assert.equal(plan.createdAt, "2026-10-12T12:00:00.000Z");
  assert.deepEqual(plan.basics, { when: "2026-10-20T19:00", area: "Austin, TX", partySize: 2, budget: "$200" });
  assert.deepEqual(plan.items.map((i) => i.kind), ["dinner", "gift"]);
  assert.equal(plan.items[0]?.time, "2026-10-20T19:00");
  assert.equal(plan.items[0]?.mapsUrl, "https://maps.google.com/?cid=1");
  assert.equal(plan.items[1]?.time, undefined);
  assert.ok(plan.items[1]?.notes?.includes("Sample suggestion"));
  assert.ok(plan.items[1]?.notes?.includes("books"));
  assert.ok(plan.items.every((i) => i.confirmation.simulated));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/agent/draft.ts'`.

- [ ] **Step 3: Create `src/agent/draft.ts`**

```ts
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
  redoing: boolean;
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
    redoing: false,
    saved: false,
    callerPhone,
  };
}
```

- [ ] **Step 4: Create `src/agent/playbooks.ts`**

```ts
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
```

- [ ] **Step 5: Create `src/agent/tasks.ts`**

```ts
import * as guava from "@guava-ai/guava-sdk";
import type { PlaceResult, PlanItemKind } from "../types.ts";
import type { PlanDraft } from "./draft.ts";
import { EVENT_TYPE_CHOICES, type ComponentSpec, type Playbook } from "./playbooks.ts";

export type TaskArgs = Parameters<guava.Call["setTask"]>[0];

export const NONE_OF_THESE = "none of these";
export const LOOKS_GOOD = "looks good";

export const pickFieldKey = (kind: PlanItemKind): string => `pick_${kind}`;
export const refineFieldKey = (kind: PlanItemKind): string => `refine_${kind}`;
export const changeChoice = (component: ComponentSpec): string => `change the ${component.label}`;

export function triageTask(): TaskArgs {
  return {
    taskId: "triage",
    objective:
      "Find out what kind of event the caller wants to plan, plus when and where it happens and any budget.",
    checklist: [
      guava.Say("Hi! I'm your event planner. Tell me what you're planning and I'll find the spots, sort out parking, and book it."),
      guava.Field({
        key: "event_type",
        fieldType: "multiple_choice",
        choices: Object.keys(EVENT_TYPE_CHOICES),
        description: "What kind of event they are planning.",
      }),
      guava.Field({ key: "event_datetime", fieldType: "datetime", description: "When the event starts, date and time." }),
      guava.Field({ key: "area", fieldType: "text", description: "The city or neighborhood where it should happen." }),
      guava.Field({ key: "budget", fieldType: "text", required: false, description: "Their rough budget for the whole event, if they have one." }),
    ],
  };
}

export function detailsTask(playbook: Playbook): TaskArgs {
  return {
    taskId: `details:${playbook.type}`,
    objective: `Ask a few quick questions to plan a great ${playbook.label}. Tone: ${playbook.tone}`,
    checklist: playbook.detailFields.map((field) =>
      guava.Field({
        key: field.key,
        fieldType: field.fieldType,
        description: field.description,
        choices: field.choices,
        required: field.required ?? true,
      }),
    ),
  };
}

export function pickTask(component: ComponentSpec, options: PlaceResult[], round: 1 | 2): TaskArgs {
  const optionList = options.map((o, i) => `${i + 1}. ${o.name} — ${o.address}`).join("\n");
  const sampleNote = options.some((o) => o.sample)
    ? " These are sample suggestions, not real places, so tell the caller that."
    : "";
  const noneMeaning = round === 1 ? "they don't like any of them" : `they want to skip the ${component.label}`;
  return {
    taskId: `pick:${component.kind}`,
    objective:
      `Help the caller choose a ${component.label}. Briefly describe each option by name and area.${sampleNote}\n` +
      `Options:\n${optionList}`,
    checklist: [
      guava.Field({
        key: pickFieldKey(component.kind),
        fieldType: "multiple_choice",
        choices: [...options.map((o) => o.name), NONE_OF_THESE],
        description: `Which ${component.label} they want. Choose "${NONE_OF_THESE}" if ${noneMeaning}.`,
      }),
      ...(round === 1
        ? [
            guava.Field({
              key: refineFieldKey(component.kind),
              fieldType: "text",
              required: false,
              description: `Only if they chose "${NONE_OF_THESE}": what they would prefer instead.`,
            }),
          ]
        : []),
    ],
  };
}

export function confirmTask(summary: string, changeChoices: string[]): TaskArgs {
  return {
    taskId: "confirm",
    objective: `Read this plan back to the caller in a natural way and ask whether it looks good.\n${summary}`,
    checklist: [
      guava.Field({
        key: "confirm_choice",
        fieldType: "multiple_choice",
        choices: [LOOKS_GOOD, ...changeChoices],
        description: "Whether the plan looks good, or which one part they want to change.",
      }),
    ],
  };
}

export function summarizeDraft(draft: PlanDraft): string {
  const lines = [`When: ${draft.basics.when ?? "not set"}`, `Where: ${draft.basics.area ?? "not set"}`];
  for (const component of draft.components) {
    const pick = draft.picks[component.kind];
    lines.push(pick ? `${component.label}: ${pick.name}, ${pick.address}` : `${component.label}: skipped`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 6: Create `src/agent/plan.ts`**

```ts
import { mockConfirmation } from "../services/booking.ts";
import type { EventPlan, PlanItem } from "../types.ts";
import type { PlanDraft } from "./draft.ts";
import { PLAYBOOKS } from "./playbooks.ts";

export function buildPlan(
  draft: PlanDraft,
  status: EventPlan["status"],
  now: Date,
  random: () => number = Math.random,
): Omit<EventPlan, "id"> {
  const type = draft.type ?? "friends";
  const area = draft.basics.area ?? "";
  const items: PlanItem[] = [];

  draft.components.forEach((component, index) => {
    const pick = draft.picks[component.kind];
    if (!pick) return;
    const notes = [
      pick.sample ? "Sample suggestion, not a real place" : "",
      component.kind === "gift"
        ? `Simulated gift order: ${draft.preferences.gift_interests ?? "a surprise"}`
        : "",
    ].filter(Boolean).join(". ");
    items.push({
      kind: component.kind,
      name: pick.name,
      address: pick.address,
      ...(pick.mapsUrl ? { mapsUrl: pick.mapsUrl } : {}),
      ...(index === 0 && draft.basics.when ? { time: draft.basics.when } : {}),
      ...(notes ? { notes } : {}),
      confirmation: mockConfirmation(component.kind, random),
    });
  });

  const title = PLAYBOOKS[type].title;
  return {
    type,
    title: area ? `${title} in ${area}` : title,
    status,
    basics: {
      when: draft.basics.when ?? "",
      area,
      ...(draft.basics.partySize !== undefined ? { partySize: draft.basics.partySize } : {}),
      ...(draft.basics.budget ? { budget: draft.basics.budget } : {}),
    },
    preferences: { ...draft.preferences },
    items,
    ...(draft.callerPhone ? { callerPhone: draft.callerPhone } : {}),
    createdAt: now.toISOString(),
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Type-check**

Run: `npm run typecheck`
Expected: exits 0 with no output. If `tsc` reports `guava.Field` option types that differ from what is used here, fix the call site to match `node_modules/@guava-ai/guava-sdk/dist/src/action-item.d.ts`.

- [ ] **Step 9: Checkpoint — owner reviews and commits** (`src/agent/draft.ts`, `src/agent/playbooks.ts`, `src/agent/tasks.ts`, `src/agent/plan.ts`, `test/playbooks.test.ts`). Do not run `git commit`.

---

### Task 6: Agent conversation flow

**Files:**
- Create: `src/agent/agent.ts`
- Test: `test/agent.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5 — `EventStore#create`, `PlacesQuery`, `SmsSender`, `sendShareLink`, `shareUrl`, `newDraft`, `PLAYBOOKS`, `parseEventType`, task builders, `buildPlan`.
- Produces: `interface AgentDeps { store: Pick<EventStore, "create">; search: (query: PlacesQuery) => Promise<PlaceResult[]>; sms: SmsSender; agentNumber: string; publicBaseUrl: string; now?: () => Date; logger?: guava.Logger }`, `createAgent(deps: AgentDeps): guava.Agent`.

Testing approach: the SDK's `MockCall` records every command a handler sends (`call.commands`) and lets the test set field values (`call.setField`). Handlers are invoked directly through `agent.handlers` — no network.

- [ ] **Step 1: Write the failing test** — `test/agent.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as guava from "@guava-ai/guava-sdk";
import { MockCall } from "@guava-ai/guava-sdk";
import { createAgent, type AgentDeps } from "../src/agent/agent.ts";
import type { PlacesQuery } from "../src/services/places.ts";
import type { EventPlan, PlaceResult } from "../src/types.ts";

type SetTask = { command_type: "set-task"; task_id: string; objective: string; action_items: Array<{ key?: string; choices?: string[] }> };
type AnyCommand = { command_type: string; instruction?: string };

const commands = (call: MockCall) => call.commands as unknown as AnyCommand[];
const lastTask = (call: MockCall): SetTask =>
  commands(call).filter((c) => c.command_type === "set-task").at(-1) as unknown as SetTask;
const instructions = (call: MockCall): string[] =>
  commands(call).flatMap((c) => (c.command_type === "send-instruction" && c.instruction ? [c.instruction] : []));

const CALLER = "+15551234567";
const phoneCall = () =>
  new MockCall({ callInfo: { call_type: "pstn", from_number: CALLER, to_number: "+12402514603", caller_id: null } });

function setup(overrides: Partial<AgentDeps> = {}) {
  const created: Omit<EventPlan, "id">[] = [];
  const sent: string[][] = [];
  const searches: PlacesQuery[] = [];
  const deps: AgentDeps = {
    store: { create: (plan) => { created.push(plan); return { id: "BLUE-FALCON-42", ...plan }; } },
    search: async (query) => {
      searches.push(query);
      return [
        { name: `${query.kind} one`, address: `1 ${query.kind} St`, sample: false },
        { name: `${query.kind} two`, address: `2 ${query.kind} St`, sample: false },
      ] satisfies PlaceResult[];
    },
    sms: { sendSms: async (from, to, message) => void sent.push([from, to, message]) },
    agentNumber: "+12402514603",
    publicBaseUrl: "http://localhost:3000",
    now: () => new Date("2026-10-12T12:00:00Z"),
    logger: guava.getConsoleLogger("off"),
    ...overrides,
  };
  return { agent: createAgent(deps), created, sent, searches };
}

async function complete(agent: guava.Agent, call: MockCall, taskId: string, fieldValues: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(fieldValues)) call.setField(key, value);
  await agent.handlers.onTaskComplete(taskId, call);
}

async function throughDetails(agent: guava.Agent, call: MockCall, type: string, details: Record<string, unknown>) {
  await agent.handlers.onCallStart(call);
  await complete(agent, call, "triage", { event_type: type, event_datetime: "2026-10-20T19:00", area: "Austin, TX", budget: "$300" });
  const detailsTaskId = lastTask(call).task_id;
  await complete(agent, call, detailsTaskId, details);
}

const endEvent = {} as unknown as guava.BotSessionEnded;

test("a date with a gift runs triage → details → 4 picks → confirm → saved, texted, hung up", async () => {
  const { agent, created, sent } = setup();
  const call = phoneCall();

  await agent.handlers.onCallStart(call);
  assert.equal(lastTask(call).task_id, "triage");

  await complete(agent, call, "triage", { event_type: "date", event_datetime: "2026-10-20T19:00", area: "Austin, TX" });
  assert.equal(lastTask(call).task_id, "details:date");

  await complete(agent, call, "details:date", {
    occasion: "anniversary", food_preferences: "italian", vibe: "romantic", wants_gift: "yes", gift_interests: "books",
  });

  for (const kind of ["dinner", "activity", "parking", "gift"]) {
    assert.equal(lastTask(call).task_id, `pick:${kind}`);
    await complete(agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }

  assert.equal(lastTask(call).task_id, "confirm");
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });

  assert.equal(created.length, 1);
  const plan = created[0]!;
  assert.equal(plan.status, "confirmed");
  assert.equal(plan.type, "date");
  assert.equal(plan.basics.partySize, 2);
  assert.equal(plan.callerPhone, CALLER);
  assert.deepEqual(plan.items.map((i) => i.kind), ["dinner", "activity", "parking", "gift"]);
  assert.ok(plan.items.every((i) => i.confirmation.simulated));

  assert.equal(sent.length, 1);
  assert.equal(sent[0]![1], CALLER);
  assert.ok(sent[0]![2]!.includes("http://localhost:3000/e/BLUE-FALCON-42"));

  const goodbye = instructions(call).at(-1)!;
  assert.ok(goodbye.includes("BLUE-FALCON-42"));
  assert.ok(goodbye.toLowerCase().includes("simulated"));
  assert.ok(goodbye.includes("texted"));
});

test("parking is searched near the chosen primary venue", async () => {
  const { agent, searches } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "business event", { headcount: 12, purpose: "client dinner", room_needs: "projector" });
  assert.equal(lastTask(call).task_id, "pick:venue");
  await complete(agent, call, "pick:venue", { pick_venue: "venue two" });
  await complete(agent, call, "pick:catering", { pick_catering: "catering one" });
  assert.equal(lastTask(call).task_id, "pick:parking");
  assert.equal(searches.at(-1)!.text, "parking near 2 venue St");
});

test("business events never ask about a gift and use headcount as party size", async () => {
  const { agent, created } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "business event", { headcount: 12, purpose: "offsite", room_needs: "private room" });
  for (const kind of ["venue", "catering", "parking"]) {
    await complete(agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });
  assert.deepEqual(created[0]!.items.map((i) => i.kind), ["venue", "catering", "parking"]);
  assert.equal(created[0]!.basics.partySize, 12);
});

test("'none of these' re-searches once with the refinement, then a second 'none' skips", async () => {
  const { agent, searches, created } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 6, vibe: "games" });
  assert.equal(lastTask(call).task_id, "pick:activity");

  await complete(agent, call, "pick:activity", { pick_activity: "none of these", refine_activity: "something with karaoke" });
  assert.equal(lastTask(call).task_id, "pick:activity");
  assert.ok(searches.at(-1)!.text.endsWith("something with karaoke"));
  assert.deepEqual(lastTask(call).action_items.map((i) => i.key), ["pick_activity"]);

  await complete(agent, call, "pick:activity", { pick_activity: "none of these" });
  assert.equal(lastTask(call).task_id, "pick:food");

  await complete(agent, call, "pick:food", { pick_food: "food one" });
  await complete(agent, call, "pick:parking", { pick_parking: "parking one" });
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });
  assert.deepEqual(created[0]!.items.map((i) => i.kind), ["food", "parking"]);
});

test("a component with zero real results is skipped with a spoken note", async () => {
  const { agent } = setup({
    search: async (query) => (query.kind === "activity" ? [] : [{ name: "x", address: "1 X St", sample: false }]),
  });
  const call = phoneCall();
  await throughDetails(agent, call, "date", { vibe: "casual", wants_gift: "no" });
  await complete(agent, call, "pick:dinner", { pick_dinner: "x" });
  assert.equal(lastTask(call).task_id, "pick:parking");
  assert.ok(instructions(call).some((i) => i.includes("date activity")));
});

test("confirm allows exactly one redo, then only 'looks good'", async () => {
  const { agent, created } = setup();
  const call = phoneCall();
  await throughDetails(agent, call, "date", { vibe: "romantic", wants_gift: "no" });
  for (const kind of ["dinner", "activity", "parking"]) {
    await complete(agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }
  assert.deepEqual(lastTask(call).action_items[0]!.choices, [
    "looks good", "change the dinner spot", "change the date activity", "change the parking spot",
  ]);

  await complete(agent, call, "confirm", { confirm_choice: "change the dinner spot" });
  assert.equal(lastTask(call).task_id, "pick:dinner");
  await complete(agent, call, "pick:dinner", { pick_dinner: "dinner two" });

  assert.equal(lastTask(call).task_id, "confirm");
  assert.deepEqual(lastTask(call).action_items[0]!.choices, ["looks good"]);
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });
  assert.equal(created[0]!.items[0]!.name, "dinner two");
});

test("a dropped call saves one incomplete plan; a finished call is not saved twice", async () => {
  const dropped = setup();
  const droppedCall = phoneCall();
  await throughDetails(dropped.agent, droppedCall, "date", { vibe: "casual", wants_gift: "no" });
  await complete(dropped.agent, droppedCall, "pick:dinner", { pick_dinner: "dinner one" });
  await dropped.agent.handlers.onSessionEnd(droppedCall, endEvent);
  assert.equal(dropped.created.length, 1);
  assert.equal(dropped.created[0]!.status, "incomplete");
  assert.deepEqual(dropped.created[0]!.items.map((i) => i.kind), ["dinner"]);
  assert.equal(dropped.sent.length, 0);

  const finished = setup();
  const call = phoneCall();
  await throughDetails(finished.agent, call, "date", { vibe: "casual", wants_gift: "no" });
  for (const kind of ["dinner", "activity", "parking"]) {
    await complete(finished.agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }
  await complete(finished.agent, call, "confirm", { confirm_choice: "looks good" });
  await finished.agent.handlers.onSessionEnd(call, endEvent);
  assert.equal(finished.created.length, 1);
});

test("a call that ends before the event type is known saves nothing", async () => {
  const { agent, created } = setup();
  const call = phoneCall();
  await agent.handlers.onCallStart(call);
  await agent.handlers.onSessionEnd(call, endEvent);
  assert.equal(created.length, 0);
});

test("SMS failure still ends the call with the spoken ID and link", async () => {
  const { agent } = setup({ sms: { sendSms: async () => { throw new Error("SMS not enabled"); } } });
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "bars" });
  for (const kind of ["activity", "food", "parking"]) {
    await complete(agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });
  const goodbye = instructions(call).at(-1)!;
  assert.ok(goodbye.includes("BLUE-FALCON-42"));
  assert.ok(goodbye.includes("http://localhost:3000/e/BLUE-FALCON-42"));
  assert.ok(!goodbye.includes("texted"));
});

test("a WebRTC call has no caller number, so no SMS is attempted", async () => {
  const { agent, sent, created } = setup();
  const call = new MockCall({ callInfo: { call_type: "webrtc", webrtc_code: "abc" } });
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "outdoors" });
  for (const kind of ["activity", "food", "parking"]) {
    await complete(agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });
  assert.equal(sent.length, 0);
  assert.equal(created[0]!.callerPhone, undefined);
});

test("a DB failure ends the call honestly with no event ID and no SMS", async () => {
  const { agent, sent } = setup({ store: { create: () => { throw new Error("disk full"); } } });
  const call = phoneCall();
  await throughDetails(agent, call, "friends hangout", { group_size: 4, vibe: "bars" });
  for (const kind of ["activity", "food", "parking"]) {
    await complete(agent, call, `pick:${kind}`, { [`pick_${kind}`]: `${kind} one` });
  }
  await complete(agent, call, "confirm", { confirm_choice: "looks good" });
  const goodbye = instructions(call).at(-1)!;
  assert.ok(goodbye.toLowerCase().includes("couldn't be saved"));
  assert.ok(!goodbye.includes("BLUE-FALCON-42"));
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/agent/agent.ts'`.

- [ ] **Step 3: Create `src/agent/agent.ts`**

```ts
import * as guava from "@guava-ai/guava-sdk";
import { shareUrl } from "../config.ts";
import type { PlacesQuery } from "../services/places.ts";
import { sendShareLink, type SmsSender } from "../services/sms.ts";
import type { EventStore } from "../store/events.ts";
import type { EventPlan, PlaceResult, PlanItemKind } from "../types.ts";
import { newDraft, type PlanDraft } from "./draft.ts";
import { buildPlan } from "./plan.ts";
import { PLAYBOOKS, parseEventType } from "./playbooks.ts";
import {
  changeChoice,
  confirmTask,
  detailsTask,
  pickFieldKey,
  pickTask,
  refineFieldKey,
  summarizeDraft,
  triageTask,
} from "./tasks.ts";

export interface AgentDeps {
  store: Pick<EventStore, "create">;
  search: (query: PlacesQuery) => Promise<PlaceResult[]>;
  sms: SmsSender;
  agentNumber: string;
  publicBaseUrl: string;
  now?: () => Date;
  logger?: guava.Logger;
}

/** Field values can be strings, numbers, or structured values; normalize to trimmed text. */
function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

const cleanQuery = (text: string): string => text.replace(/\s+/g, " ").trim();

export function createAgent(deps: AgentDeps): guava.Agent {
  const logger = deps.logger ?? guava.getDefaultLogger();
  const now = deps.now ?? (() => new Date());
  const drafts = new Map<string, PlanDraft>();

  const agent = new guava.Agent({
    purpose:
      "You are an upbeat event planner. You plan dates, hangouts with friends, and business " +
      "events for the caller, then book everything. All bookings in this demo are simulated; " +
      "never claim a real reservation or purchase was made.",
  });

  async function startPick(call: guava.Call, draft: PlanDraft, refinement = ""): Promise<void> {
    const component = draft.components[draft.componentIndex];
    if (!component) return startConfirm(call, draft);

    const text = cleanQuery(`${component.query(draft)} ${refinement}`);
    const options = await deps.search({ text, kind: component.kind, area: draft.basics.area ?? "" });
    if (options.length === 0) {
      await call.sendInstruction(
        `Tell the caller you couldn't find a good ${component.label} for them, so you're skipping it.`,
      );
      delete draft.picks[component.kind];
      return advance(call, draft);
    }
    draft.options[component.kind] = options;
    const round = draft.refined.includes(component.kind) ? 2 : 1;
    await call.setTask(pickTask(component, options, round));
  }

  async function advance(call: guava.Call, draft: PlanDraft): Promise<void> {
    if (draft.redoing) {
      draft.redoing = false;
      return startConfirm(call, draft);
    }
    draft.componentIndex += 1;
    return startPick(call, draft);
  }

  async function startConfirm(call: guava.Call, draft: PlanDraft): Promise<void> {
    const changeChoices = draft.redoUsed ? [] : draft.components.map(changeChoice);
    await call.setTask(confirmTask(summarizeDraft(draft), changeChoices));
  }

  async function handleTriage(call: guava.Call, draft: PlanDraft): Promise<void> {
    const rawType = fieldText(await call.getField("event_type"));
    const type = parseEventType(rawType);
    if (!type) logger.warn("Unknown event type %s; using friends playbook", rawType);
    draft.type = type ?? "friends";
    const budget = fieldText(await call.getField("budget"));
    draft.basics = {
      when: fieldText(await call.getField("event_datetime")),
      area: fieldText(await call.getField("area")),
      ...(budget ? { budget } : {}),
    };
    await call.setTask(detailsTask(PLAYBOOKS[draft.type]));
  }

  async function handleDetails(call: guava.Call, draft: PlanDraft): Promise<void> {
    const playbook = PLAYBOOKS[draft.type ?? "friends"];
    for (const field of playbook.detailFields) {
      const value = fieldText(await call.getField(field.key));
      if (value) draft.preferences[field.key] = value;
    }
    const partySize = playbook.partySize(draft);
    if (partySize !== undefined) draft.basics.partySize = partySize;
    draft.components = playbook.components.filter((c) => c.includeWhen?.(draft) ?? true);
    draft.componentIndex = 0;
    await startPick(call, draft);
  }

  async function handlePick(call: guava.Call, draft: PlanDraft, kind: PlanItemKind): Promise<void> {
    const choice = fieldText(await call.getField(pickFieldKey(kind))).toLowerCase();
    const picked = draft.options[kind]?.find((o) => o.name.trim().toLowerCase() === choice);
    if (picked) {
      draft.picks[kind] = picked;
      return advance(call, draft);
    }
    if (!draft.refined.includes(kind)) {
      draft.refined.push(kind);
      return startPick(call, draft, fieldText(await call.getField(refineFieldKey(kind))));
    }
    delete draft.picks[kind];
    return advance(call, draft);
  }

  async function handleConfirm(call: guava.Call, draft: PlanDraft): Promise<void> {
    const answer = fieldText(await call.getField("confirm_choice")).toLowerCase();
    const index = draft.components.findIndex((c) => changeChoice(c) === answer);
    if (!draft.redoUsed && index >= 0) {
      const kind = draft.components[index]!.kind;
      draft.redoUsed = true;
      draft.redoing = true;
      draft.componentIndex = index;
      draft.refined = draft.refined.filter((k) => k !== kind);
      return startPick(call, draft);
    }
    return finish(call, draft);
  }

  async function finish(call: guava.Call, draft: PlanDraft): Promise<void> {
    draft.saved = true;
    let saved: EventPlan | null = null;
    try {
      saved = deps.store.create(buildPlan(draft, "confirmed", now()));
    } catch (err) {
      logger.error("Saving plan for call %s failed: %s", call.id, err);
    }
    if (!saved) {
      await call.hangup(
        "Apologize: the plan couldn't be saved because of a technical problem, so there is no event ID. " +
          `Read this plan back once so they can note it down, then say goodbye.\n${summarizeDraft(draft)}`,
      );
      return;
    }

    const eventId = saved.id;
    const link = shareUrl(deps.publicBaseUrl, eventId);
    const texted = await sendShareLink({
      sender: deps.sms,
      from: deps.agentNumber,
      to: draft.callerPhone,
      eventId,
      publicBaseUrl: deps.publicBaseUrl,
      onError: (err) => logger.warn("Sending SMS for %s failed: %s", eventId, err),
    });
    await call.hangup(
      "Tell the caller their plan is all set, and remind them the bookings are simulated for this demo. " +
        `Their event ID is ${eventId}; read it slowly, word by word. ` +
        (texted
          ? "Say you've texted them the link so they can share it."
          : `Tell them they can view and share it at ${link}.`),
    );
  }

  agent.onCallStart(async (call) => {
    const info = call.callInfo;
    const phone = info.call_type === "pstn" ? info.from_number : null;
    drafts.set(call.id, newDraft(phone));
    await call.setTask(triageTask());
  });

  agent.onTaskComplete(async (call, taskId) => {
    const draft = drafts.get(call.id);
    if (!draft) {
      logger.warn("No plan draft for call %s (task %s)", call.id, taskId);
      return;
    }
    if (taskId === "triage") return handleTriage(call, draft);
    if (taskId.startsWith("details:")) return handleDetails(call, draft);
    if (taskId.startsWith("pick:")) return handlePick(call, draft, taskId.slice("pick:".length) as PlanItemKind);
    if (taskId === "confirm") return handleConfirm(call, draft);
    logger.warn("Unexpected task %s on call %s", taskId, call.id);
  });

  agent.onSessionEnd(async (call) => {
    const draft = drafts.get(call.id);
    drafts.delete(call.id);
    if (!draft || draft.saved || !draft.type) return;
    try {
      const saved = deps.store.create(buildPlan(draft, "incomplete", now()));
      logger.info("Saved incomplete plan %s for call %s", saved.id, call.id);
    } catch (err) {
      logger.error("Saving incomplete plan for call %s failed: %s", call.id, err);
    }
  });

  return agent;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all agent tests.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: exits 0. If `call.callInfo` narrowing fails because `CallInfo` includes the `SIPCallInfo` class, keep the `info.call_type === "pstn"` check — it is the discriminant on all three variants.

- [ ] **Step 6: Checkpoint — owner reviews and commits** (`src/agent/agent.ts`, `test/agent.test.ts`). Do not run `git commit`.

---

### Task 7: Agent entry point, env example, and roleplay checks

**Files:**
- Modify: `main.ts` (replace the scaffolded docs-QA agent entirely)
- Create: `.env.example`
- Create: `scripts/roleplay.ts`

**Interfaces:**
- Consumes: `loadConfig`, `EventStore`, `searchPlaces`, `createAgent`.
- Produces: runnable `npm start`, `npm run chat`, `npm run roleplay -- <type>`.

- [ ] **Step 1: Replace `main.ts`**

```ts
/**
 * Event planner: a Guava voice agent that plans and (simulated) books
 * dates, friends hangouts, and business events.
 *
 *   npm start       — answer calls on the Guava number
 *   npm run chat    — text chat in the terminal
 */

import * as guava from "@guava-ai/guava-sdk";
import { createAgent } from "./src/agent/agent.ts";
import { loadConfig } from "./src/config.ts";
import { searchPlaces } from "./src/services/places.ts";
import { EventStore } from "./src/store/events.ts";

const logger = guava.getDefaultLogger();
const config = loadConfig();
const store = new EventStore(config.dbPath);

if (!config.placesApiKey) {
  logger.warn("GOOGLE_PLACES_API_KEY is not set; the agent will offer sample suggestions.");
}

const agent = createAgent({
  store,
  search: (query) =>
    searchPlaces(query, {
      apiKey: config.placesApiKey,
      onError: (err) => logger.warn("Places search failed, using samples: %s", err),
    }),
  sms: new guava.Client(),
  agentNumber: config.agentNumber,
  publicBaseUrl: config.publicBaseUrl,
  logger,
});

if (process.argv.includes("--chat")) {
  await agent.chat();
} else {
  await agent.listenPhone(config.agentNumber);
}
```

- [ ] **Step 2: Create `.env.example`**

```
# Copy to .env and fill in. All values are optional.
GOOGLE_PLACES_API_KEY=
GUAVA_AGENT_NUMBER=+12402514603
PUBLIC_BASE_URL=http://localhost:3000
PORT=3000
EVENTS_DB_PATH=./events.db
```

- [ ] **Step 3: Create `scripts/roleplay.ts`**

```ts
/**
 * Live roleplay check for one event type. Uses real Guava sessions (needs
 * Guava auth) and costs a session each run, so it is not part of `npm test`.
 *
 *   npm run roleplay -- date|friends|business
 */

import { createAgent } from "../src/agent/agent.ts";
import { loadConfig } from "../src/config.ts";
import { searchPlaces } from "../src/services/places.ts";
import { EventStore } from "../src/store/events.ts";
import type { EventType } from "../src/types.ts";

const SCENARIOS: Record<EventType, { prompt: string; pass: string[]; fail: string[] }> = {
  date: {
    prompt:
      "You are planning an anniversary date in Austin, Texas next Friday at 7pm. You love Italian food, " +
      "want a romantic vibe, and want a gift because your partner loves books. Pick the first option " +
      "every time and confirm the plan.",
    pass: [
      "The agent asked about the vibe or occasion of the date.",
      "The agent asked whether the caller wanted a gift.",
      "The agent gave the caller an event ID at the end.",
      "The agent said the bookings are simulated.",
    ],
    fail: ["The agent asked how many people are in the group."],
  },
  friends: {
    prompt:
      "You are planning a games night for 6 friends in Chicago this Saturday at 8pm. One friend is " +
      "vegetarian. Pick the first option every time and confirm the plan.",
    pass: [
      "The agent asked how many people are coming.",
      "The agent gave the caller an event ID at the end.",
      "The agent said the bookings are simulated.",
    ],
    fail: ["The agent offered to buy a gift."],
  },
  business: {
    prompt:
      "You are organizing a client dinner for 12 people in Seattle next Tuesday at 6pm. You need a " +
      "private room with a projector and your budget is about 2000 dollars. Pick the first option " +
      "every time and confirm the plan.",
    pass: [
      "The agent asked about room or equipment needs.",
      "The agent gave the caller an event ID at the end.",
      "The agent said the bookings are simulated.",
    ],
    fail: ["The agent offered to buy a gift."],
  },
};

const type = process.argv[2] as EventType | undefined;
if (!type || !(type in SCENARIOS)) {
  console.error("Usage: npm run roleplay -- date|friends|business");
  process.exit(1);
}

const config = loadConfig();
const agent = createAgent({
  store: new EventStore(":memory:"),
  search: (query) => searchPlaces(query, { apiKey: config.placesApiKey }),
  sms: { sendSms: async () => {} },
  agentNumber: config.agentNumber,
  publicBaseUrl: config.publicBaseUrl,
});

const scenario = SCENARIOS[type];
const session = await agent.roleplay(scenario.prompt);
console.log(session.getTranscript());
await session.evaluate({ passCriteria: scenario.pass, failCriteria: scenario.fail });
console.log(`Roleplay "${type}" passed.`);
```

- [ ] **Step 4: Type-check and run the unit tests**

Run: `npm run typecheck && npm test`
Expected: both exit 0.

- [ ] **Step 5: Manual smoke test in text chat**

Run: `npm run chat`
Expected: the agent greets you and asks what you're planning. Say "a date in Austin next Friday at 7", answer the questions, pick options, and confirm. The agent should read an event ID and say bookings are simulated. Exit with Ctrl-C. (Requires `guava login`; without a Places key the options are labeled as samples.)

- [ ] **Step 6: Live roleplay check (optional, uses Guava sessions)**

Run: `npm run roleplay -- date` (then `friends`, `business`)
Expected: a transcript prints, then `Roleplay "date" passed.`. If `session.evaluate` rejects, the process exits non-zero with the failing criterion — read the transcript to see whether the prompt or the playbook needs adjusting.

- [ ] **Step 7: Checkpoint — owner reviews and commits** (`main.ts`, `.env.example`, `scripts/roleplay.ts`). Do not run `git commit`.

---

### Task 8: Web UI rendering

**Files:**
- Create: `src/web/render.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `EventPlan`, `PlanItemKind` from `src/types.ts`.
- Produces: `type PublicPlan = Omit<EventPlan, "callerPhone">`, `publicPlan(plan: EventPlan): PublicPlan`, `escapeHtml(value: string): string`, `safeHttpsUrl(value: string | undefined): string | null`, `renderHome(): string`, `renderPlan(plan: EventPlan, shareLink: string): string`, `renderNotFound(): string`.

- [ ] **Step 1: Write the failing test** — `test/render.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  publicPlan,
  renderHome,
  renderNotFound,
  renderPlan,
  safeHttpsUrl,
} from "../src/web/render.ts";
import type { EventPlan } from "../src/types.ts";

function plan(overrides: Partial<EventPlan> = {}): EventPlan {
  return {
    id: "BLUE-FALCON-42",
    type: "date",
    title: "Date night in Austin, TX",
    status: "confirmed",
    basics: { when: "2026-10-20T19:00", area: "Austin, TX", partySize: 2 },
    preferences: {},
    items: [
      {
        kind: "dinner",
        name: "Olive Grove",
        address: "1 Main St",
        mapsUrl: "https://maps.google.com/?cid=1",
        time: "2026-10-20T19:00",
        confirmation: { code: "RSV-ABCDE", simulated: true },
      },
      {
        kind: "parking",
        name: "Central Garage",
        address: "2 Main St",
        confirmation: { code: "PRK-FGHJK", simulated: true },
      },
    ],
    callerPhone: "+15551234567",
    createdAt: "2026-10-12T12:00:00.000Z",
    ...overrides,
  };
}

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("safeHttpsUrl only allows https URLs", () => {
  assert.equal(safeHttpsUrl("https://maps.google.com/?cid=1"), "https://maps.google.com/?cid=1");
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpsUrl("http://example.com"), null);
  assert.equal(safeHttpsUrl("not a url"), null);
  assert.equal(safeHttpsUrl(undefined), null);
});

test("publicPlan removes the caller's phone number", () => {
  assert.equal("callerPhone" in publicPlan(plan()), false);
});

test("renderPlan shows items, codes, simulated badges, and the share link", () => {
  const html = renderPlan(plan(), "http://localhost:3000/e/BLUE-FALCON-42");
  assert.ok(html.includes("Date night in Austin, TX"));
  assert.ok(html.includes("Olive Grove"));
  assert.ok(html.includes("RSV-ABCDE"));
  assert.ok(html.includes("PRK-FGHJK"));
  assert.equal(html.match(/Simulated/g)?.length, 2);
  assert.ok(html.includes('href="https://maps.google.com/?cid=1"'));
  assert.ok(html.includes("http://localhost:3000/e/BLUE-FALCON-42"));
  assert.ok(html.includes('name="robots" content="noindex"'));
});

test("renderPlan never includes the caller's phone number", () => {
  assert.ok(!renderPlan(plan(), "x").includes("5551234567"));
});

test("renderPlan escapes untrusted text and drops unsafe map links", () => {
  const hostile = plan({
    title: "<script>alert(1)</script>",
    items: [
      {
        kind: "dinner",
        name: `<img src=x onerror="alert(1)">`,
        address: "1 Main St",
        mapsUrl: "javascript:alert(1)",
        confirmation: { code: "RSV-ABCDE", simulated: true },
      },
    ],
  });
  const html = renderPlan(hostile, "x");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("javascript:alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderPlan shows a banner for incomplete plans", () => {
  assert.ok(renderPlan(plan({ status: "incomplete" }), "x").includes("not finished"));
  assert.ok(!renderPlan(plan(), "x").includes("not finished"));
});

test("renderPlan copes with an unparseable time and no items", () => {
  const html = renderPlan(plan({ basics: { when: "next Friday-ish", area: "Austin" }, items: [] }), "x");
  assert.ok(html.includes("next Friday-ish"));
  assert.ok(html.includes("Nothing was booked"));
});

test("renderHome has an event ID form and renderNotFound links home", () => {
  assert.ok(renderHome().includes('action="/e"'));
  assert.ok(renderNotFound().includes('href="/"'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/web/render.ts'`.

- [ ] **Step 3: Create `src/web/render.ts`**

```ts
import type { EventPlan, PlanItem, PlanItemKind } from "../types.ts";

export type PublicPlan = Omit<EventPlan, "callerPhone">;

export function publicPlan(plan: EventPlan): PublicPlan {
  const { callerPhone: _callerPhone, ...rest } = plan;
  return rest;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

const TYPE_LABELS: Record<EventPlan["type"], string> = {
  date: "Date",
  friends: "Friends hangout",
  business: "Business event",
};

const KIND_LABELS: Record<PlanItemKind, string> = {
  dinner: "Dinner",
  food: "Food",
  activity: "Activity",
  venue: "Venue",
  catering: "Catering",
  parking: "Parking",
  gift: "Gift",
};

const STYLES = `
:root{--bg:#faf7f2;--card:#fff;--text:#1f1b16;--muted:#6b645b;--accent:#c2410c;--border:#e7e0d6;--badge:#fde7d8;--warn:#fef3c7}
@media (prefers-color-scheme: dark){:root{--bg:#171412;--card:#221e1b;--text:#f3ede6;--muted:#a89f94;--accent:#fb923c;--border:#3a332d;--badge:#3b2416;--warn:#3a2f12}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;line-height:1.2;margin:8px 0}
a{color:var(--accent)}
.muted{color:var(--muted)}
.badge{display:inline-block;background:var(--badge);color:var(--accent);border-radius:999px;padding:2px 10px;font-size:.8rem;font-weight:600}
.banner{background:var(--warn);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin:12px 0}
.card h2{font-size:1.1rem;margin:4px 0}
.kind{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
button,input{font:inherit;border-radius:10px;border:1px solid var(--border);padding:10px 14px;background:var(--card);color:var(--text)}
button{background:var(--accent);color:#fff;border:none;cursor:pointer}
form{display:flex;gap:8px;flex-wrap:wrap}
input{flex:1;min-width:0;text-transform:uppercase}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function formatWhen(when: string): string {
  const date = new Date(when);
  if (!when || Number.isNaN(date.getTime())) return when;
  return date.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
}

function renderItem(item: PlanItem): string {
  const maps = safeHttpsUrl(item.mapsUrl);
  return `<section class="card">
  <div class="kind">${escapeHtml(KIND_LABELS[item.kind])}${item.time ? ` · ${escapeHtml(formatWhen(item.time))}` : ""}</div>
  <h2>${escapeHtml(item.name)}</h2>
  <div class="muted">${escapeHtml(item.address)}</div>
  ${maps ? `<div><a href="${escapeHtml(maps)}" target="_blank" rel="noopener noreferrer">Open in Maps</a></div>` : ""}
  ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
  <p>Confirmation <span class="code">${escapeHtml(item.confirmation.code)}</span> <span class="badge">Simulated</span></p>
</section>`;
}

export function renderPlan(plan: EventPlan, shareLink: string): string {
  const facts = [
    formatWhen(plan.basics.when),
    plan.basics.area,
    plan.basics.partySize ? `${plan.basics.partySize} people` : "",
    plan.basics.budget ? `Budget: ${plan.basics.budget}` : "",
  ].filter(Boolean);

  const body = `
<span class="badge">${escapeHtml(TYPE_LABELS[plan.type])}</span>
<h1>${escapeHtml(plan.title)}</h1>
<p class="muted">${facts.map(escapeHtml).join(" · ")}</p>
<p class="muted">Event ID <span class="code">${escapeHtml(plan.id)}</span></p>
${plan.status === "incomplete" ? `<div class="banner">This plan is not finished — the call ended before everything was confirmed.</div>` : ""}
${plan.items.length > 0 ? plan.items.map(renderItem).join("\n") : `<p class="card">Nothing was booked for this event.</p>`}
<p><button type="button" id="copy" data-url="${escapeHtml(shareLink)}">Copy link</button></p>
<p class="muted">${escapeHtml(shareLink)}</p>
<script>
document.getElementById("copy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try { await navigator.clipboard.writeText(button.dataset.url); button.textContent = "Copied!"; }
  catch { button.textContent = button.dataset.url; }
});
</script>`;
  return page(plan.title, body);
}

export function renderHome(): string {
  return page(
    "Event Planner",
    `<h1>Event Planner</h1>
<p class="muted">Enter the event ID the agent gave you, like BLUE-FALCON-42.</p>
<form action="/e" method="get">
  <input name="id" placeholder="BLUE-FALCON-42" aria-label="Event ID" required autocomplete="off">
  <button type="submit">View plan</button>
</form>`,
  );
}

export function renderNotFound(): string {
  return page(
    "Plan not found",
    `<h1>Plan not found</h1>
<p class="muted">Check the event ID and try again.</p>
<p><a href="/">Look up another plan</a></p>`,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Checkpoint — owner reviews and commits** (`src/web/render.ts`, `test/render.test.ts`). Do not run `git commit`.

---

### Task 9: Web server, web entry point, and wiring into `npm start`

**Files:**
- Create: `src/web/server.ts`
- Create: `src/web/main.ts`
- Modify: `main.ts` (start the web server alongside the agent)
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `EventStore#get`, `normalizeEventId`, `shareUrl`, render functions from Task 8.
- Produces: `interface WebDeps { store: Pick<EventStore, "get">; publicBaseUrl: string }`, `createWebServer(deps: WebDeps): http.Server`.

- [ ] **Step 1: Write the failing test** — `test/server.test.ts`

```ts
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { EventStore } from "../src/store/events.ts";
import { createWebServer } from "../src/web/server.ts";

let server: Server;
let base = "";
let id = "";

before(async () => {
  const store = new EventStore(":memory:");
  id = store.create({
    type: "friends",
    title: "Friends hangout in Chicago",
    status: "confirmed",
    basics: { when: "2026-10-17T20:00", area: "Chicago", partySize: 6 },
    preferences: {},
    items: [{ kind: "activity", name: "Starlight Lanes", address: "1 Lake St", confirmation: { code: "TIX-ABCDE", simulated: true } }],
    callerPhone: "+15551234567",
    createdAt: "2026-10-12T12:00:00.000Z",
  }).id;
  server = createWebServer({ store, publicBaseUrl: "https://plans.example.com" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("GET / serves the lookup page", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.ok((await res.text()).includes('action="/e"'));
});

test("GET /e?id= redirects to the normalized plan URL", async () => {
  const res = await fetch(`${base}/e?id=${encodeURIComponent(`  ${id.toLowerCase()} `)}`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/e/${id}`);
});

test("GET /e?id= with an empty id redirects home", async () => {
  const res = await fetch(`${base}/e?id=`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});

test("GET /e/:id renders the plan, case-insensitively, with the public share link", async () => {
  const res = await fetch(`${base}/e/${id.toLowerCase()}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Starlight Lanes"));
  assert.ok(html.includes(`https://plans.example.com/e/${id}`));
  assert.ok(!html.includes("5551234567"));
});

test("GET /api/events/:id returns JSON without the phone number", async () => {
  const res = await fetch(`${base}/api/events/${id}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.id, id);
  assert.equal("callerPhone" in body, false);
});

test("unknown plans and malformed IDs return 404", async () => {
  assert.equal((await fetch(`${base}/e/NOPE-NOPE-00`)).status, 404);
  assert.equal((await fetch(`${base}/e/%E0%A4%A`)).status, 404);
  const api = await fetch(`${base}/api/events/NOPE-NOPE-00`);
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), { error: "not_found" });
});

test("unknown paths return 404 and non-GET methods return 405", async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  const post = await fetch(`${base}/e/${id}`, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

test("responses carry basic security headers", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/web/server.ts'`.

- [ ] **Step 3: Create `src/web/server.ts`**

```ts
import { createServer, type Server, type ServerResponse } from "node:http";
import { shareUrl } from "../config.ts";
import type { EventStore } from "../store/events.ts";
import { normalizeEventId } from "../store/ids.ts";
import type { EventPlan } from "../types.ts";
import { publicPlan, renderHome, renderNotFound, renderPlan } from "./render.ts";

export interface WebDeps {
  store: Pick<EventStore, "get">;
  publicBaseUrl: string;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
};

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": contentType, ...extraHeaders });
  res.end(body);
}

const html = (res: ServerResponse, status: number, body: string) =>
  send(res, status, "text/html; charset=utf-8", body);

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));

const redirect = (res: ServerResponse, location: string) =>
  send(res, 302, "text/plain; charset=utf-8", "", { Location: location });

function lookup(deps: WebDeps, encodedId: string): EventPlan | null {
  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  return deps.store.get(id);
}

function route(deps: WebDeps, method: string, rawUrl: string, res: ServerResponse): void {
  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }
  const url = new URL(rawUrl, "http://localhost");
  const path = url.pathname;

  if (path === "/") return html(res, 200, renderHome());

  if (path === "/e") {
    const id = normalizeEventId(url.searchParams.get("id") ?? "");
    return redirect(res, id ? `/e/${encodeURIComponent(id)}` : "/");
  }

  const pageMatch = /^\/e\/([^/]+)$/.exec(path);
  if (pageMatch) {
    const plan = lookup(deps, pageMatch[1]!);
    return plan
      ? html(res, 200, renderPlan(plan, shareUrl(deps.publicBaseUrl, plan.id)))
      : html(res, 404, renderNotFound());
  }

  const apiMatch = /^\/api\/events\/([^/]+)$/.exec(path);
  if (apiMatch) {
    const plan = lookup(deps, apiMatch[1]!);
    return plan ? json(res, 200, publicPlan(plan)) : json(res, 404, { error: "not_found" });
  }

  return html(res, 404, renderNotFound());
}

export function createWebServer(deps: WebDeps): Server {
  return createServer((req, res) => {
    try {
      route(deps, req.method ?? "GET", req.url ?? "/", res);
    } catch (err) {
      console.error("Web request failed:", err);
      if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "Internal server error");
      else res.end();
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Create `src/web/main.ts`** (web server only — view plans without running the agent)

```ts
import { loadConfig } from "../config.ts";
import { EventStore } from "../store/events.ts";
import { createWebServer } from "./server.ts";

const config = loadConfig();
const store = new EventStore(config.dbPath);

createWebServer({ store, publicBaseUrl: config.publicBaseUrl }).listen(config.port, () => {
  console.log(`Event planner web UI on http://localhost:${config.port}`);
});
```

- [ ] **Step 6: Start the web server from `main.ts`**

In `main.ts`, add this import after the existing `EventStore` import:

```ts
import { createWebServer } from "./src/web/server.ts";
```

and add this block directly after `const store = new EventStore(config.dbPath);`:

```ts
createWebServer({ store, publicBaseUrl: config.publicBaseUrl }).listen(config.port, () => {
  logger.info("Web UI listening on http://localhost:%s", config.port);
});
```

Also update the header comment's first usage line to:

```ts
 *   npm start       — answer calls on the Guava number and serve the web UI
```

- [ ] **Step 7: Type-check and run all tests**

Run: `npm run typecheck && npm test`
Expected: both exit 0.

- [ ] **Step 8: Manual end-to-end check**

1. Run `npm run chat`, plan any event, and note the event ID the agent reads out.
2. Open `http://localhost:3000/`, enter the ID in lower case, and submit.
Expected: the plan page shows each booked item with a "Simulated" badge; "Copy link" copies `http://localhost:3000/e/<ID>`; the page looks right at phone width (browser dev tools, 375 px) and in dark mode.

- [ ] **Step 9: Checkpoint — owner reviews and commits** (`src/web/server.ts`, `src/web/main.ts`, `main.ts`, `test/server.test.ts`). Do not run `git commit`.
