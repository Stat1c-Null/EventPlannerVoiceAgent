import { loadConfig } from "../config.ts";
import { EventStore } from "../store/events.ts";
import { createWebServer } from "./server.ts";

const config = loadConfig();
const store = new EventStore(config.dbPath);

createWebServer({ store, publicBaseUrl: config.publicBaseUrl }).listen(config.port, () => {
  console.log(`Event planner web UI on http://localhost:${config.port}`);
});
