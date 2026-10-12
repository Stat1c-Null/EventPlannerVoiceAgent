/**
 * Event planner: a Guava voice agent that plans and (simulated) books
 * dates, friends hangouts, and business events.
 *
 *   npm start       — answer calls on the Guava number and serve the web UI
 *   npm run chat    — text chat in the terminal
 */

import * as guava from "@guava-ai/guava-sdk";
import { createAgent } from "./src/agent/agent.ts";
import { loadConfig } from "./src/config.ts";
import { searchPlaces } from "./src/services/places.ts";
import { EventStore } from "./src/store/events.ts";
import { createWebServer } from "./src/web/server.ts";

const logger = guava.getDefaultLogger();
const config = loadConfig();
const store = new EventStore(config.dbPath);

createWebServer({ store, publicBaseUrl: config.publicBaseUrl }).listen(config.port, () => {
  logger.info("Web UI listening on http://localhost:%s", config.port);
});

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
