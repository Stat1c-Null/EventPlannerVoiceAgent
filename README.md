# Event Planner Agent

A voice agent that plans your outing for you. Call it, say what you're planning, and it finds the restaurant, the activity, parking nearby and (for dates) a gift shop, "books" everything, and gives you an event ID. Open the ID in the web UI to see the whole plan and share it.

Built with [Guava](https://goguava.ai) (voice agents) and the Google Places API.

> **All bookings are simulated.** Reservations, tickets, parking and gift orders get mock confirmation codes (e.g. `RSV-8F3K2`). The agent says so on the call, and the web page labels every booking "Simulated".

## What it does

The conversation changes with the type of event, using a **playbook** chosen at runtime:

| Event | The agent asks about | It plans |
|---|---|---|
| **Date** | occasion, food preferences, vibe, whether you want a gift and what they like | dinner, activity, parking, gift shop (optional) |
| **Friends hangout** | group size, vibe (bars / games / outdoors), dietary needs | activity, food, parking |
| **Business event** | headcount, purpose, room or AV needs, dietary needs | venue, catering, parking |

A call goes like this:

1. **Basics:** event type, date and time, city, and budget (in dollars). The city is checked with Google, so a misheard "Alfaretta" becomes **Alpharetta, GA**, and the agent confirms it with you.
2. **Questions specific to the event type**, from its playbook.
3. **Picks:** for each part of the plan the agent offers three real places. Say "none of these" and what you'd prefer for one more search; a second "none" skips that part. **Parking is searched within about 600 m of the venue you chose**, nearest first.
4. **Confirm:** the agent reads the plan back. You can change one part; changing the venue also re-picks the parking next to it.
5. **Wrap-up:** the plan is saved under an ID like `BLUE-FALCON-42`. The agent reads the ID **twice**, repeats it whenever you ask, and only hangs up once you say you're ready. The ID and link are also printed in the terminal.

If the call drops partway, whatever was planned so far is saved as an **incomplete** plan.

## Web UI

Every plan has a page at `/e/<EVENT-ID>`, made for phones, with automatic light/dark mode:

- **Header:** event type, title, the date in large type, and the event ID (click it to copy).
- **Fact tiles:** When, Where, Group, Budget.
- **Timeline** of the plan, with an icon per stop, its time, address, Google Maps link and confirmation code.
- **Getting there:** a map preview (OpenStreetMap) and walking directions from the parking to the venue (Google Maps).
- **Share:** the link, a **Copy link** button and **Add to calendar** (downloads an `.ics` file).
- **Color theme** per event type: rose for dates, teal for friends, slate for business.

The home page (`/`) has a box for the event ID. You can type it the way you heard it: `blue falcon 42` works.

## Getting started

### Requirements

- **Node.js 24 or newer.** The project uses Node's built-in SQLite. Check with `node --version`; Node 20 won't work.
- **A Guava account** with the CLI signed in (`guava login`) and a Guava phone number.
- **A Google Places API key** *(optional)*. Without one, the agent offers clearly labelled **sample** places so you can still try the whole flow.

### Setup

```bash
npm install
cp .env.example .env    # then edit .env
```

### Getting a Google Places API key

1. Create a project at <https://console.cloud.google.com/projectcreate>.
2. Link a billing account at <https://console.cloud.google.com/billing>. Google requires one even for free-tier use.
3. Enable **Places API (New)** at <https://console.cloud.google.com/apis/library/places.googleapis.com>.
4. Create a key at <https://console.cloud.google.com/apis/credentials> → **Create credentials → API key**.
5. Restrict the key to **Places API (New)** only.
6. Put it in `.env` as `GOOGLE_PLACES_API_KEY=...`.

Searches request only name, address, Maps link and location, all in Google's *Text Search Pro* tier. Check [Google Maps Platform pricing](https://mapsplatform.google.com/pricing) for current rates, and consider a budget alert in the Cloud console.

## Configuration

All settings are optional and live in `.env` (git-ignored):

| Variable | Purpose | Default |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Real place search and city spelling checks | unset: sample places |
| `GUAVA_AGENT_NUMBER` | Guava number to answer calls on and send SMS from | `+12402514603` |
| `PUBLIC_BASE_URL` | Base of share links, in SMS and on the page | `http://localhost:3000` |
| `PORT` | Web UI port | `3000` |
| `EVENTS_DB_PATH` | SQLite file for saved plans | `./events.db` |

## Running it

| Command | What it starts |
|---|---|
| `npm run chat` | The agent as a **text chat** in your terminal, plus the web UI. Easiest way to try it. |
| `npm start` | The agent answering **real phone calls** on your Guava number, plus the web UI |
| `npm run web` | Only the web UI, for viewing saved plans |
| `npm test` | The automated test suite |
| `npm run typecheck` | TypeScript type check |
| `npm run roleplay -- date` | A live test call where an AI plays the caller (`date`, `friends` or `business`). Uses real Guava sessions. |

Try it end to end:

1. Run `npm run chat` and plan something. Note the event ID it reads out, or copy it from the terminal.
2. Open <http://localhost:3000> and enter the ID.

After the chat ends the web server keeps running; stop it with **Ctrl-C**.

## Project layout

```
main.ts                 Entry point: starts the web UI and the agent (phone or --chat)
src/
  agent/
    agent.ts            The Guava agent: call flow, task chaining, per-call state
    playbooks.ts        Event types: their questions, plan parts and search queries
    tasks.ts            Builds each Guava task (triage, details, pick, confirm, wrap-up)
    draft.ts            In-progress plan for one call
    plan.ts             Turns a finished (or dropped) call into a saved plan
  services/
    places.ts           Google Places search, nearby parking, city spelling check
    catalog.ts          Sample places used without an API key
    booking.ts          Mock confirmation codes
    sms.ts              Texts the share link via Guava
  store/
    events.ts           SQLite storage for plans
    ids.ts              Speakable event IDs (BLUE-FALCON-42)
  web/
    server.ts           HTTP routes
    render.ts           Plan page, home page, 404
    calendar.ts         .ics calendar file
    main.ts             Web-UI-only entry point
  config.ts, types.ts, datetime.ts, money.ts
scripts/roleplay.ts     Live roleplay checks
test/                   Unit and route tests (node:test)
docs/                   Design spec and implementation plan
```

### Web routes

| Route | Returns |
|---|---|
| `GET /` | Event ID lookup page |
| `GET /e/:id` | The plan page |
| `GET /e/:id/calendar.ics` | Calendar file for the plan |
| `GET /api/events/:id` | The plan as JSON (the caller's phone number is never included) |

### Adding an event type

Add the new type's name to `EventType` in `src/types.ts`. Then add an entry to `PLAYBOOKS` in `src/agent/playbooks.ts` with:
- its follow-up questions (`detailFields`);
- the parts of the plan, each with a search query (`components`);
- how to work out the party size.

Finally, add the spoken choice to `EVENT_TYPE_CHOICES` in the same file, its label to `TYPE_LABELS` in `src/web/render.ts`, and a `.theme-<type>` color there too. `npm run typecheck` will point out anything you missed.

## Testing

```bash
npm test            # unit and route tests, no network or phone needed
npm run typecheck
```

The conversation tests drive the agent with Guava's `MockCall`, so every path of the flow is covered without placing a call: picks, "none of these", the redo, dropped calls, SMS and database failures, and hang-up confirmation. Use `npm run chat` or `npm run roleplay` to test against real Guava.

## Known limitations

- **Bookings are simulated.** Nothing is actually reserved or bought.
- **SMS needs registration.** Texting the link only works once SMS is enabled on your Guava number. US carriers require brand and campaign registration; see Guava's *Outbound & SMS Compliance* docs. Until then, sending fails (a warning is logged) and the agent reads the link out instead.
- **Share links are localhost by default.** A `http://localhost:3000` link only opens on your own computer. To share with others, run the web UI somewhere reachable (a tunnel or a deploy) and set `PUBLIC_BASE_URL`.
- **Plans are viewable by anyone who has the ID.** IDs are short so they're easy to say, which also means they can be guessed. Fine for a demo; don't put private details in plans.
- **The map shows one pin**, on the main venue, and only for plans made after locations were added.
- **Event times have no time zone.** They're shown and exported at the local time they were planned for.
