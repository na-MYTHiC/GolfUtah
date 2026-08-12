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
 *
 * On why this is Google rather than GolfPass or 18Birdies, which would
 * be the better reading: neither publishes an API, and both put their
 * review content behind terms that forbid scraping it. Google's Places
 * API is the one source of golfer reviews that can be used as intended
 * — so its reviews are shown with the attribution its terms require,
 * and the things reviews are bad at (difficulty, layout, conditioning)
 * come from lib/course-profiles.ts instead.
 */

const API = "https://places.googleapis.com/v1/places:searchText";

/** Ratings barely move; cache hard to stay well inside free-tier quota. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PlaceReview {
  rating: number;
  text: string;
  author: string;
  /** Google requires reviews be shown with their relative time. */
  when: string;
}

export interface PlaceInfo {
  rating: number; // 1-5
  reviewCount: number;
  mapsUrl?: string;
  /** Google's own one-line description of the place, when it has one. */
  summary?: string;
  /** Up to five, newest-and-most-relevant as Google orders them. */
  reviews?: PlaceReview[];
  /**
   * Google's opaque handle for the first photo. Not a URL — fetching the
   * image needs the API key, which is why the download happens at build
   * time (see downloadPhoto) rather than from the browser.
   */
  photoName?: string;
}

const cache = new Map<string, { at: number; value: PlaceInfo | null }>();

interface PlacesResponse {
  places?: {
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    editorialSummary?: { text?: string };
    photos?: { name?: string }[];
    reviews?: {
      rating?: number;
      text?: { text?: string };
      authorAttribution?: { displayName?: string };
      relativePublishTimeDescription?: string;
    }[];
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
        // Reviews and editorial summary move this to the Enterprise SKU,
        // which is still inside the free monthly credit at this volume
        // (43 courses, once per build, cached 24h).
        "X-Goog-FieldMask": [
          "places.rating",
          "places.userRatingCount",
          "places.googleMapsUri",
          "places.editorialSummary",
          "places.reviews",
          "places.photos",
        ].join(","),
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
            summary: place.editorialSummary?.text,
            photoName: place.photos?.[0]?.name,
            reviews: (place.reviews ?? [])
              .map((r) => ({
                rating: r.rating ?? 0,
                text: (r.text?.text ?? "").trim(),
                author: r.authorAttribution?.displayName ?? "A golfer",
                when: r.relativePublishTimeDescription ?? "",
              }))
              .filter((r) => r.text.length > 0)
              .slice(0, 3),
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

/**
 * Downloads a place photo, resized, as raw bytes.
 *
 * Deliberately not a URL handed to the browser. Google's media endpoint
 * takes the API key as a query parameter, so linking to it directly
 * would publish the key in the page source of a public site — where
 * anyone could spend the quota. Fetching here means the key stays in the
 * build environment and the app ships plain JPEGs.
 *
 * 800px wide is enough for a retina thumbnail and small enough that
 * forty of them don't punish a phone on mobile data.
 */
export async function downloadPhoto(photoName: string): Promise<Buffer | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const url =
      `https://places.googleapis.com/v1/${photoName}/media` +
      `?maxWidthPx=800&skipHttpRedirect=false&key=${apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}
