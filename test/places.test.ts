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

test("a query with a place type restricts results to that type", async () => {
  let body: unknown;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return jsonResponse({ places: [] });
  }) as typeof fetch;
  await searchPlaces(
    { text: "parking near 1 Main St", kind: "parking", area: "Austin, TX", includedType: "parking" },
    { apiKey: "k", fetchImpl },
  );
  assert.deepEqual(body, {
    textQuery: "parking near 1 Main St",
    pageSize: 3,
    includedType: "parking",
    strictTypeFiltering: true,
  });
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

test("the field mask asks for each place's location", () => {
  assert.ok(PLACES_FIELD_MASK.split(",").includes("places.location"));
});

test("parsePlacesResponse keeps a valid location and drops a malformed one", () => {
  const [withLocation, withoutLocation] = parsePlacesResponse({
    places: [
      { displayName: { text: "A" }, formattedAddress: "1 A St", location: { latitude: 33.75, longitude: -84.39 } },
      { displayName: { text: "B" }, formattedAddress: "1 B St", location: { latitude: "x" } },
    ],
  });
  assert.deepEqual(withLocation?.location, { lat: 33.75, lng: -84.39 });
  assert.equal(withoutLocation && "location" in withoutLocation, false);
});

test("parsePlacesResponse returns [] for non-object bodies", () => {
  assert.deepEqual(parsePlacesResponse(null), []);
  assert.deepEqual(parsePlacesResponse("nope"), []);
  assert.deepEqual(parsePlacesResponse({ places: "nope" }), []);
});
