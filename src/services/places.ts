import type { LatLng, PlaceResult, PlanItemKind } from "../types.ts";
import { sampleResults } from "./catalog.ts";

export const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// All four fields are billed at the same "Text Search Pro" tier.
export const PLACES_FIELD_MASK =
  "places.displayName,places.formattedAddress,places.googleMapsUri,places.location";
const RESULT_LIMIT = 3;
const DEFAULT_TIMEOUT_MS = 5000;

export interface PlacesQuery {
  text: string;
  kind: PlanItemKind;
  area: string;
  /** Google place type (Table A) that every result must have, e.g. "parking". */
  includedType?: string;
  /**
   * Only return places within NEARBY_RADIUS_METERS of this point, nearest first. `text` must
   * then be a plain category such as "parking": Google lets an address in the text override
   * location preferences.
   */
  near?: LatLng;
}

export const NEARBY_RADIUS_METERS = 600;
const METERS_PER_DEGREE_LAT = 111_320;

/** Places with a location first, nearest first; places without one keep their order at the end. */
function sortByDistance(results: PlaceResult[], center: LatLng): PlaceResult[] {
  // Equirectangular approximation: plenty accurate across a few hundred metres.
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const distance = (p: PlaceResult) =>
    p.location ? Math.hypot((p.location.lat - center.lat), (p.location.lng - center.lng) * cosLat) : Infinity;
  return [...results].sort((a, b) => distance(a) - distance(b));
}

/** Text Search only restricts to rectangles, so use the box that encloses the radius. */
function boxAround(center: LatLng, meters: number) {
  const dLat = meters / METERS_PER_DEGREE_LAT;
  const dLng = meters / (METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180));
  return {
    rectangle: {
      low: { latitude: center.lat - dLat, longitude: center.lng - dLng },
      high: { latitude: center.lat + dLat, longitude: center.lng + dLng },
    },
  };
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
      body: JSON.stringify({
        textQuery: query.text,
        pageSize: RESULT_LIMIT,
        // includedType alone only biases results; strict filtering drops other place types.
        ...(query.includedType ? { includedType: query.includedType, strictTypeFiltering: true } : {}),
        ...(query.near
          ? { locationRestriction: boxAround(query.near, NEARBY_RADIUS_METERS), rankPreference: "DISTANCE" }
          : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Places API returned HTTP ${response.status}`);
    }
    const results = parsePlacesResponse(await response.json());
    // rankPreference DISTANCE isn't strictly nearest-first in practice, so sort here too.
    return query.near ? sortByDistance(results, query.near) : results;
  } catch (err) {
    options.onError?.(err);
    return sampleResults(query.kind, query.area);
  }
}

export interface Locality {
  /** City name, e.g. "Alpharetta". */
  name: string;
  /** Google's formatted address, e.g. "Alpharetta, GA, USA". */
  formatted: string;
}

/**
 * Looks up the city a caller named, to fix speech-to-text misspellings ("Alfaretta" →
 * Alpharetta). Only city-type places count, so neighborhoods like "Buckhead" return null and
 * the caller's own words are kept. Null too without a key or on any error.
 */
export async function resolveLocality(text: string, options: PlacesOptions = {}): Promise<Locality | null> {
  if (!options.apiKey) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": options.apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: text, pageSize: 1, includedType: "locality", strictTypeFiltering: true }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Places API returned HTTP ${response.status}`);
    const body = (await response.json()) as { places?: Array<{ displayName?: { text?: unknown }; formattedAddress?: unknown }> };
    const place = body.places?.[0];
    const name = place?.displayName?.text;
    const formatted = place?.formattedAddress;
    return typeof name === "string" && typeof formatted === "string" ? { name, formatted } : null;
  } catch (err) {
    options.onError?.(err);
    return null;
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
      location?: { latitude?: unknown; longitude?: unknown };
    };
    const name = p.displayName?.text;
    const address = p.formattedAddress;
    if (typeof name !== "string" || typeof address !== "string") continue;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    results.push({
      name,
      address,
      mapsUrl: typeof p.googleMapsUri === "string" ? p.googleMapsUri : undefined,
      ...(typeof lat === "number" && typeof lng === "number" ? { location: { lat, lng } } : {}),
      sample: false,
    });
    if (results.length === RESULT_LIMIT) break;
  }
  return results;
}
