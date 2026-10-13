import type { PlaceResult, PlanItemKind } from "../types.ts";
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
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Places API returned HTTP ${response.status}`);
    }
    return parsePlacesResponse(await response.json());
  } catch (err) {
    options.onError?.(err);
    return sampleResults(query.kind, query.area);
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
