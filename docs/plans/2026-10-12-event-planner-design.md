# Event Planner Agent — Design Spec

Date: 2026-10-12
Status: Approved 2026-10-12

## 1. Goal

A Guava voice agent that plans an outing for the caller — where to eat or meet, what to do, where to park, and an optional gift — "books" everything (simulated), and hands back a short event ID. A small web UI shows the finished plan at a shareable link.

The conversation adapts at runtime to the event type. Supported types: **date**, **friends hangout**, **business event**.

### Success criteria

- One phone call produces a complete, saved `EventPlan` for each of the three event types.
- The questions asked differ by event type, driven by a playbook chosen at runtime.
- Suggestions come from the Google Places API when a key is set, and from a canned catalog otherwise.
- The caller hears the event ID and, when SMS works, receives a text with the link.
- `/e/<id>` renders the plan on a phone-sized screen.

### Decisions already made

| Topic | Decision |
|---|---|
| Bookings | All simulated. Mock confirmation codes, always marked `simulated: true` and described as such. |
| Suggestions | Google Places API (Text Search, New); canned fallback without a key or on error. |
| Architecture | Approach A: playbook-driven chain of Guava tasks. |
| Stack | One Node app: agent + `node:http` web server + `node:sqlite`. |
| Hand-off | Agent speaks the ID and texts the link via `Client.sendSms`; spoken-only if SMS fails. |

### Out of scope

Real payments or bookings, calendar invites, multi-day events, more than one city per event, user accounts, editing a plan from the web UI.

## 2. Repository layout

```
main.ts              Entry point: starts the web server and the agent (kept at the root for the Guava CLI)
src/
  config.ts          Environment configuration and share-link helper
  types.ts           Shared data types (EventPlan, PlanItem, PlaceResult)
  agent/
    agent.ts         createAgent(): Guava handlers, task chaining, per-call state
    draft.ts         PlanDraft (in-progress plan for one call)
    playbooks.ts     Playbook definitions for date / friends / business
    tasks.ts         Builds setTask arguments from a playbook + draft
    plan.ts          Turns a finished or abandoned draft into an EventPlan
  services/
    places.ts        Google Places Text Search + canned fallback
    catalog.ts       Canned fallback data
    booking.ts       Mock confirmation codes
    sms.ts           Sends the share link via Client.sendSms
  store/
    ids.ts           Speakable event ID generation and normalization
    events.ts        SQLite persistence
  web/
    main.ts          Web-server-only entry point
    server.ts        node:http server and routes
    render.ts        HTML rendering with escaping
scripts/
  roleplay.ts        On-demand live roleplay checks per event type
test/                node:test unit tests
docs/plans/          This spec
docs/implementation/ The implementation plan
```

The root `main.ts` stays the entry point (the Guava CLI scaffolded it there) but only wires modules together. `package.json` scripts:

- `start` — agent and web server in one process
- `chat` — same, with the agent in `agent.chat()` text mode
- `web` — web server only
- `test` — `node --test` over `test/`
- `typecheck` — `tsc`
- `roleplay` — `scripts/roleplay.ts <type>`

## 3. Agent

### 3.1 Conversation flow

Per-call state lives in an in-memory `Map<callId, PlanDraft>`. The call moves through these tasks:

1. **`triage`** — `event_type` (multiple choice: date, friends hangout, business event), `event_datetime` (datetime), `area` (text), `budget` (optional text).
2. **`details:<type>`** — playbook-specific fields (see 3.2).
3. **`pick:<component>`** — one task per playbook component, in playbook order:
   - Search Places with the playbook's query builder.
   - Put the top 3 results (name and address) in the task objective.
   - Ask a `multiple_choice` field whose choices are the result names plus "none of these".
   - A real search with zero results skips the component, and the agent says so.
   - Parking searches near the chosen primary venue's address.
   - Gift searches for a matching shop near the area and produces a mock order.
4. **`confirm`** — the agent reads back the plan. The caller confirms, or names one component to redo (at most one redo per call).
5. **`wrap-up`** — create mock confirmations, save the plan, send the SMS, say the ID, hang up.

Task transitions happen in `onTaskComplete` handlers that read fields with `call.getField` and call `call.setTask` for the next task.

### 3.2 Playbooks

A playbook is a plain data object:

```ts
interface Playbook {
  type: "date" | "friends" | "business";
  label: string;                       // spoken name, e.g. "date night"
  tone: string;                        // added to the task objective
  detailFields: FieldSpec[];           // questions for details:<type>
  components: ComponentSpec[];         // ordered pick:<component> steps
}
interface ComponentSpec {
  kind: PlanItemKind;
  optional?: boolean;                  // e.g. gift: asked whether wanted
  query(draft: PlanDraft): PlacesQuery;
}
```

| Type | Detail fields | Components |
|---|---|---|
| date | occasion, food preferences, vibe (romantic / casual / adventurous), wants gift, partner's interests (if gift) | dinner, activity, parking, gift (optional) |
| friends | group size, dietary needs, vibe (bars / games / outdoors) | activity, food, parking |
| business | headcount, purpose, private room or AV needs, dietary needs | venue, catering, parking |

Adding an event type means adding one playbook object. For a date, `partySize` is fixed at 2; for friends and business it comes from group size / headcount.

### 3.3 Data model

```ts
type PlanItemKind = "dinner" | "food" | "activity" | "venue" | "catering" | "parking" | "gift";

interface PlanItem {
  kind: PlanItemKind;
  name: string;
  address: string;
  mapsUrl?: string;
  time?: string;          // ISO datetime
  notes?: string;
  confirmation: { code: string; simulated: true };
}

interface EventPlan {
  id: string;             // e.g. "BLUE-FALCON-42"
  type: "date" | "friends" | "business";
  title: string;
  status: "confirmed" | "incomplete";
  basics: { when: string; area: string; partySize?: number; budget?: string };
  preferences: Record<string, string>;
  items: PlanItem[];
  callerPhone?: string;   // never returned by the web UI or API
  createdAt: string;
}
```

### 3.4 Storage

- `node:sqlite` (built into Node 24), file path from `EVENTS_DB_PATH`, default `./events.db` (git-ignored).
- Table `events(id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)`.
- IDs: `ADJECTIVE-NOUN-NN` from fixed word lists; regenerated on collision; lookups are case-insensitive (stored upper-case).
- `onSessionEnd` saves any unsaved draft with `status: "incomplete"`.

### 3.5 Services

- **places.ts** — `POST https://places.googleapis.com/v1/places:searchText` with `X-Goog-Api-Key` and `X-Goog-FieldMask: places.displayName,places.formattedAddress,places.googleMapsUri`. `pageSize: 3`. Rating and price level are deliberately excluded (Enterprise SKU billing).
  - No `GOOGLE_PLACES_API_KEY`, a non-2xx response, or a timeout (5 s) → canned results from `catalog.ts`, flagged `sample: true`, and the agent says they are sample suggestions.
- **booking.ts** — returns codes like `RSV-8F3K2` (reservation), `PRK-…` (parking), `GFT-…` (gift order). Always `simulated: true`.
- **sms.ts** — `new Client().sendSms(GUAVA_AGENT_NUMBER, callerPhone, text)`. The caller's number comes from `CallInfo.from_number` in `onCallReceived`. On failure or a missing number, it logs and returns `false`; the agent then only speaks the ID.

### 3.6 Configuration

| Variable | Purpose | Default |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Places search | unset → canned catalog |
| `GUAVA_AGENT_NUMBER` | SMS sender and `listenPhone` number | `+12402514603` |
| `PUBLIC_BASE_URL` | Base of share links | `http://localhost:3000` |
| `PORT` | Web server port | `3000` |
| `EVENTS_DB_PATH` | SQLite file | `./events.db` |

### 3.7 Error handling

- Places failure → fallback catalog; the call continues.
- SMS failure → spoken ID only.
- DB write failure → log the error; the agent apologizes, reads the plan back once, and gives no event ID. No SMS is sent.
- Caller rejects all 3 options → one re-search with the caller's refinement as extra query text, then accept the caller's choice or skip the component.
- Duplicate place names in one result set → deduplicated so multiple-choice answers stay unambiguous.

## 4. Web UI

### 4.1 Server

`node:http`, no framework. Server-rendered HTML with all dynamic values escaped. Runs in the agent process for `npm start`, or alone with `npm run web`.

| Route | Response |
|---|---|
| `GET /` | Home page with an event-ID input that navigates to `/e/<id>` |
| `GET /e/:id` | Plan page (case-insensitive ID) |
| `GET /api/events/:id` | Plan JSON without `callerPhone` |
| anything else | 404 page |

### 4.2 Plan page

- Header: title, event type badge, date and time, area, party size.
- Timeline: one card per item in time order — name, address, "Open in Maps" link, confirmation code with a "Simulated" badge.
- Parking and gift cards.
- "Copy link" button (the page's only JavaScript).
- Banner when `status` is `incomplete`.
- Mobile-first; follows the system light/dark preference; `<meta name="robots" content="noindex">`.

### 4.3 Sharing and privacy

- Share link: `${PUBLIC_BASE_URL}/e/<id>`. A localhost URL only works on the host machine; sharing to other devices needs a tunnel or deploy.
- Anyone with the ID can view the plan, and IDs are enumerable. Acceptable for a demo; not private. The caller's phone number is never rendered or returned.

## 5. Testing

- **Unit (`node:test`)** — playbook → task builder output per event type; ID format and collision retry; Places response parsing and fallback; store round-trip and case-insensitive lookup; HTML escaping; `callerPhone` absent from page and API.
- **Routes** — start the server on port 0 and request each route with `fetch`.
- **Conversation** — one `agent.roleplay()` scenario per event type, run on demand (uses live Guava sessions).
- **Manual** — `npm run chat`.

## 6. Build order

1. Store, IDs and data model.
2. Places service with fallback; booking; SMS.
3. Playbooks and task builder.
4. Agent wiring in `src/agent/main.ts`; roleplay checks.
5. Web server and plan page.
