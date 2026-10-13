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

test("renderPlan shows the basics as labelled tiles with a readable date and time", () => {
  const html = renderPlan(plan({ basics: { when: "2026-10-18T18:00", area: "Atlanta, Georgia", partySize: 2, budget: "$200" } }), "x");
  for (const label of ["When", "Where", "Group", "Budget"]) {
    assert.ok(html.includes(`<dt>${label}</dt>`), `missing tile ${label}`);
  }
  assert.ok(html.includes("Sunday, October 18, 2026"));
  assert.ok(html.includes("6:00 PM"));
  assert.ok(html.includes("<dd>2 people</dd>"));
  assert.ok(!html.includes("Atlanta, Georgia · "), "facts should not be a dot-separated line");
});

test("renderPlan formats a Guava datetime object saved as JSON by older plans", () => {
  const html = renderPlan(plan({ basics: { when: '{"day":18,"month":10,"year":2026,"hour":18,"minute":0}', area: "Atlanta, Georgia" } }), "x");
  assert.ok(html.includes("Sunday, October 18, 2026"));
  assert.ok(!html.includes("&quot;day&quot;"));
});

test("renderPlan shows a budget saved as text as a dollar amount", () => {
  const html = renderPlan(plan({ basics: { when: "2026-10-18T18:00", area: "Atlanta", budget: "about 200 dollars" } }), "x");
  assert.ok(html.includes("<dd>$200</dd>"));
});

test("renderPlan puts the share link and copy button together in a centered share section", () => {
  const link = "http://localhost:3000/e/BLUE-FALCON-42";
  const html = renderPlan(plan(), link);
  const share = /<section class="share">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
  assert.ok(share.includes(`<a class="share-link" href="${link}">`), share);
  assert.ok(share.includes('id="copy"'), share);
  assert.ok(/\.share\{[^}]*align-items:center/.test(html), "share section should center its contents");
  assert.ok(/\.share\{[^}]*margin:\s*40px/.test(html), "share section should be spaced away from the cards");
});

test("the page uses the purple accent instead of orange", () => {
  const html = renderPlan(plan(), "x");
  assert.ok(html.includes("--accent:#7c3aed"));
  assert.ok(!html.includes("#c2410c"));
});

test("renderPlan lays the items out as a timeline with an icon per item type", () => {
  const html = renderPlan(plan(), "x");
  const timeline = /<ol class="timeline">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
  assert.equal(timeline.match(/<li class="stop">/g)?.length, 2);
  assert.ok(timeline.includes("🍽️"), "dinner icon");
  assert.ok(timeline.includes("🅿️"), "parking icon");
  assert.ok(timeline.includes("7:00 PM"), "the dinner's time is shown on its stop");
});

test("renderPlan themes the page by event type", () => {
  assert.ok(renderPlan(plan(), "x").includes('<body class="theme-date">'));
  assert.ok(renderPlan(plan({ type: "friends" }), "x").includes('<body class="theme-friends">'));
  assert.ok(renderPlan(plan({ type: "business" }), "x").includes('<body class="theme-business">'));
  assert.ok(/\.theme-date\{[^}]*--tint:/.test(renderPlan(plan(), "x")));
});

test("renderPlan has a hero with the big date and a copyable event ID chip", () => {
  const html = renderPlan(plan(), "x");
  const hero = /<header class="hero">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "";
  assert.ok(hero.includes("<h1>Date night in Austin, TX</h1>"));
  assert.ok(/<p class="hero-date">Tuesday, October 20, 2026 · 7:00 PM<\/p>/.test(hero), hero);
  assert.ok(hero.includes('data-copy="BLUE-FALCON-42"'));
});

test("renderPlan shows an OpenStreetMap preview centered on the first located item", () => {
  const located = plan({
    items: [
      { kind: "dinner", name: "Olive Grove", address: "1 Main St", location: { lat: 30.26, lng: -97.74 }, confirmation: { code: "RSV-ABCDE", simulated: true } },
      { kind: "parking", name: "Garage", address: "2 Main St", location: { lat: 30.27, lng: -97.75 }, confirmation: { code: "PRK-FGHJK", simulated: true } },
    ],
  });
  const html = renderPlan(located, "x");
  const src = /<iframe[^>]*src="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.ok(src.startsWith("https://www.openstreetmap.org/export/embed.html?"), src);
  assert.ok(src.includes("marker=30.26,-97.74"), src);
  assert.ok(src.includes("bbox=-97.755,30.255,-97.735,30.275"), src);
});

test("renderPlan has no map without locations but still links walking directions", () => {
  const html = renderPlan(plan(), "x");
  assert.ok(!html.includes("<iframe"));
  assert.ok(
    html.includes(
      'href="https://www.google.com/maps/dir/?api=1&amp;origin=2%20Main%20St&amp;destination=1%20Main%20St&amp;travelmode=walking"',
    ),
  );
});

test("renderPlan has no directions link when there is no parking", () => {
  const html = renderPlan(plan({ items: [plan().items[0]!] }), "x");
  assert.ok(!html.includes("maps/dir"));
});

test("renderPlan offers an add-to-calendar download", () => {
  assert.ok(renderPlan(plan(), "x").includes('href="/e/BLUE-FALCON-42/calendar.ics"'));
});

test("renderPlan omits the group and budget tiles when unknown", () => {
  const html = renderPlan(plan({ basics: { when: "2026-10-18T18:00", area: "Atlanta" } }), "x");
  assert.ok(!html.includes("<dt>Group</dt>"));
  assert.ok(!html.includes("<dt>Budget</dt>"));
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
