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

test("GET /e/:id/calendar.ics downloads a calendar file", async () => {
  const res = await fetch(`${base}/e/${id.toLowerCase()}/calendar.ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/calendar/);
  assert.equal(res.headers.get("content-disposition"), `attachment; filename="${id}.ics"`);
  const body = await res.text();
  assert.ok(body.includes("DTSTART:20261017T200000"));
  assert.ok(body.includes(`https://plans.example.com/e/${id}`));
});

test("calendar for an unknown plan returns 404", async () => {
  assert.equal((await fetch(`${base}/e/NOPE-NOPE-00/calendar.ics`)).status, 404);
});

test("the CSP allows only the OpenStreetMap embed as a frame", async () => {
  const csp = (await fetch(`${base}/`)).headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-src https:\/\/www\.openstreetmap\.org/);
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
