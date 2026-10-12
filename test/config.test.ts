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
