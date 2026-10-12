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
