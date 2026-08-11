/**
 * Course ratings from Google Places, when a key is configured.
 *
 * Entirely optional: without GOOGLE_PLACES_API_KEY every call returns
 * null and the UI simply omits ratings. Unlike weather (Open-Meteo, no
 * key), there's no keyless option here, and the app shouldn't be
 * unusable without a billing account.
 *
 * Set GOOGLE_PLACES_API_KEY in .env to enable. Uses the Places API (New)
 * Text Search, matching on course name + city.
 */

const API = "https://places.googleapis.com/v1/places:searchText";

/** Ratings barely move; cache hard to stay well inside free-tier quota. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PlaceInfo {
  rating: number; // 1-5
  reviewCount: number;
  mapsUrl?: string;
}

const cache = new Map<string, { at: number; value: PlaceInfo | null }>();

interface PlacesResponse {
  places?: {
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
  }[];
}

export function placesEnabled(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export async function getPlaceInfo(name: string, city?: string | null): Promise<PlaceInfo | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const query = city ? `${name}, ${city}, Utah` : `${name}, Utah`;
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const resp = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // Field mask is required, and keeps this on the cheaper SKU.
        "X-Goog-FieldMask": "places.rating,places.userRatingCount,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data: PlacesResponse = await resp.json();
    const place = data.places?.[0];
    const value: PlaceInfo | null =
      place?.rating != null
        ? {
            rating: place.rating,
            reviewCount: place.userRatingCount ?? 0,
            mapsUrl: place.googleMapsUri,
          }
        : null;

    cache.set(query, { at: Date.now(), value });
    return value;
  } catch {
    // Ratings are decoration; never let them break the page.
    cache.set(query, { at: Date.now(), value: null });
    return null;
  }
}
