import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * Chronogolf (Lightspeed Golf) — confirmed against a real capture from
 * Riverbend Golf Course (Riverton, UT) on 2026-08-12.
 *
 * Endpoint: GET https://www.chronogolf.com/marketplace/v2/teetimes
 *   ?start_date=YYYY-MM-DD
 *   &course_ids=<uuid>,<uuid>      (comma-separated, url-encoded as %2C)
 *   &holes=9,18
 *   &page=1
 *
 * Two things about that URL cost the other two adapters a round of wrong
 * data each, so they're worth stating plainly:
 *
 *  - Courses are addressed by **uuid**, not by the numeric `course.id`
 *    that also appears in the response, and not by the club slug in the
 *    booking page's address. An earlier note in this file guessed
 *    "numeric ids"; the capture says otherwise.
 *  - A club can expose several Chronogolf "courses" at once. Riverbend
 *    lists both "Riverbend" (18 holes) and "Riverbend back 9" (9 holes),
 *    and the club's own widget asks for both uuids in one request. So a
 *    GolfUtah course maps to a *list* of uuids, not one.
 *
 * Response: { status: "open", teetimes: [...] } plus pagination in the
 * response headers — `total` (10) and `per-page` (24).
 *
 * Auth: none. No Authorization header, no cookie, no api key.
 */

const API = "https://www.chronogolf.com/marketplace/v2/teetimes";
const BOOKING_BASE = "https://www.chronogolf.com/club";

/** The widget's own value — asks for both round lengths in one request. */
const HOLES_PARAM = "9,18";

/** Guard against a pagination bug turning into an unbounded loop. */
const MAX_PAGES = 20;

interface RawCourse {
  id: number;
  /** The id the API is actually addressed by. */
  uuid: string;
  name: string;
  holes: number;
  /** Round lengths bookable at this slot, e.g. [9] or [9, 18]. */
  bookable_holes: number[];
}

interface RawPrice {
  green_fee: number; // dollars, per player
  half_cart: number | null;
  one_person_cart: number | null;
  subtotal: number;
  /** Which round length green_fee is the rate for — not always the course's. */
  bookable_holes: number;
  affiliation_type: string; // "Regular" — Chronogolf's booking class
}

interface RawTeeTime {
  id: number;
  uuid: string;
  course: RawCourse;
  hole: number;
  has_cart: boolean;
  min_player_size: number;
  /** Spots still open — 1 and 2 observed on a partly booked sheet. */
  max_player_size: number;
  /** UTC. Do not use for display — see toNormalized(). */
  starts_at: string;
  /** Course-local, 24h, unpadded: "8:20", "13:20", "17:10". */
  start_time: string;
  date: string; // course-local "YYYY-MM-DD"
  has_deal: boolean;
  default_price?: RawPrice | null;
  format: string; // "normal"
  frozen: boolean;
}

interface RawResponse {
  status: string; // "open"
  teetimes: RawTeeTime[];
}

/**
 * externalId is "<clubSlug>:<uuid>[,<uuid>...]" — the slug for the
 * handoff link, the uuids for the API. Split on the first colon only;
 * uuids contain hyphens but never colons.
 */
function parseExternalId(externalId: string): { slug: string; courseIds: string[] } {
  const at = externalId.indexOf(":");
  const slug = at >= 0 ? externalId.slice(0, at) : "";
  const courseIds = (at >= 0 ? externalId.slice(at + 1) : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!slug || courseIds.length === 0) {
    throw new Error(
      `Invalid Chronogolf externalId "${externalId}" — expected ` +
        `"<clubSlug>:<courseUuid>[,<courseUuid>...]"`
    );
  }
  return { slug, courseIds };
}

/**
 * "8:20" -> "08:20". Chronogolf sends 24-hour time without padding the
 * hour, which sorts wrong as a string ("8:20" > "13:20") — every screen
 * in the app orders slots by comparing these, so the padding matters.
 */
function padTime(startTime: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

/**
 * Chronogolf models a back-nine start as its own course ("Riverbend back
 * 9") rather than as a flag on the slot, so the label has to come out of
 * the name. A club whose second course is a differently-named nine
 * (e.g. "North"/"South") gets no label rather than a guessed one.
 */
function sideOf(courseName: string): string | undefined {
  if (/\bback\b/i.test(courseName)) return "Back";
  if (/\bfront\b/i.test(courseName)) return "Front";
  return undefined;
}

async function fetchPage(
  courseIds: string[],
  date: string,
  page: number
): Promise<{ body: RawResponse; total: number; perPage: number }> {
  const params = new URLSearchParams({
    start_date: date,
    course_ids: courseIds.join(","),
    holes: HOLES_PARAM,
    page: String(page),
  });

  const resp = await fetch(`${API}?${params}`, {
    headers: {
      accept: "application/json",
      referer: "https://www.chronogolf.com/",
    },
  });

  if (!resp.ok) {
    throw new Error(`Chronogolf request failed: HTTP ${resp.status}`);
  }

  return {
    body: (await resp.json()) as RawResponse,
    total: Number(resp.headers.get("total")) || 0,
    perPage: Number(resp.headers.get("per-page")) || 0,
  };
}

function toNormalized(raw: RawTeeTime, bookingUrl: string): NormalizedTeeTime[] {
  // starts_at is UTC ("2026-08-12T14:20:00Z") for a slot the course calls
  // 8:20am. Reading the wrong one of these two fields is exactly the bug
  // that made Sun Hills show times that didn't exist — take the local one
  // the platform already computed rather than converting a UTC stamp
  // against an assumed zone.
  const time = padTime(raw.start_time);
  if (!time) return [];

  // A frozen slot is held by the pro shop, not bookable.
  if (raw.frozen) return [];

  const spots = Number.isFinite(raw.max_player_size) ? raw.max_player_size : 0;
  if (spots <= 0) return [];

  const side = sideOf(raw.course.name);

  // bookable_holes is per-slot: the 18-hole course sells both 9 and 18 at
  // the same time, which is two different rounds, so it's two rows.
  const lengths = (
    raw.course.bookable_holes?.length ? raw.course.bookable_holes : [raw.course.holes]
  ).filter((h): h is 9 | 18 => h === 9 || h === 18);

  return lengths.map((holes) => ({
    date: raw.date,
    time,
    holes,
    playersOpen: spots,
    // default_price carries its own `bookable_holes` saying which round
    // it's the rate for — $21 for 9 at Riverbend, with the 18-hole rate
    // not sent at all. Pricing the 18 from it would be inventing a
    // number; an unpriced slot shows "—" and is excluded by a price
    // filter, which is the honest outcome.
    price:
      raw.default_price && raw.default_price.bookable_holes === holes
        ? Math.round(raw.default_price.green_fee * 100)
        : undefined,
    side,
    bookingUrl,
  }));
}

/**
 * The club's own booking page, on the day requested.
 *
 * These parameters are copied from a real address bar rather than
 * inferred — including the empty `holes` and `coursesIds`, which the
 * widget emits when nothing is narrowed. The date is ISO here, unlike
 * ForeUp's MM-DD-YYYY.
 */
export function chronogolfBookingUrl(slug: string, date?: string): string {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  params.set("step", "teetimes");
  params.set("holes", "");
  params.set("coursesIds", "");
  params.set("deals", "false");
  params.set("groupSize", "0");
  return `${BOOKING_BASE}/${slug}?${params}`;
}

/**
 * Utah Chronogolf clubs still waiting on a capture — the Salt Lake City
 * and Salt Lake County municipals. Each needs the same two-second step
 * the user did for Riverbend: open the club page, DevTools -> Network ->
 * Fetch/XHR, and copy the `marketplace/v2/teetimes` request URL. The
 * `course_ids=` in it is the whole missing piece; the response body isn't
 * needed. scripts/chronogolf-add.ts turns a pasted URL into a seed entry.
 *
 * Slugs are only listed where one has actually been seen. The rest are
 * blank because Chronogolf slugs aren't derivable from a course name —
 * Riverbend is "riverbend-slco" and River Oaks is
 * "river-oaks-golf-course-utah".
 */
export const CHRONOGOLF_PENDING: { name: string; city: string; slug?: string }[] = [
  { name: "River Oaks Golf", city: "Sandy", slug: "river-oaks-golf-course-utah" },
  { name: "University of Utah Golf Club", city: "Salt Lake City", slug: "university-of-utah-golf-club" },
  { name: "Bonneville Golf Course", city: "Salt Lake City" },
  { name: "Forest Dale Golf Course", city: "Salt Lake City" },
  { name: "Glendale Golf Course", city: "Salt Lake City" },
  { name: "Mountain Dell Golf Course", city: "Salt Lake City" },
  { name: "Nibley Park Golf Course", city: "Salt Lake City" },
  { name: "Rose Park Golf Course", city: "Salt Lake City" },
  { name: "Meadow Brook Golf Course", city: "Taylorsville" },
  { name: "Mick Riley Golf Course", city: "Murray" },
  { name: "Mountain View Golf Course", city: "West Jordan" },
  { name: "Old Mill Golf Course", city: "Holladay" },
  { name: "South Mountain Golf Course", city: "Draper" },
];

export const chronogolfAdapter: TeeTimeAdapter = {
  platform: "CHRONOGOLF",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const { slug, courseIds } = parseExternalId(course.externalId);

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const results: NormalizedTeeTime[] = [];

    for (const date of dates) {
      // Built per date so each slot links to the day it belongs to.
      const bookingUrl = chronogolfBookingUrl(slug, date);

      // The parameter is `start_date`, which hints a range might be
      // accepted, but only a single-day request has been observed — so
      // one request per day, like the other two adapters.
      let page = 1;
      let seen = 0;

      for (;;) {
        const { body, total, perPage } = await fetchPage(courseIds, date, page);
        if (body.status !== "open" || !Array.isArray(body.teetimes)) break;

        for (const raw of body.teetimes) {
          results.push(...toNormalized(raw, bookingUrl));
        }

        seen += body.teetimes.length;
        // Stop on a short page even when the headers disagree — a wrong
        // total shouldn't spin, and an empty page never has a next one.
        if (body.teetimes.length === 0) break;
        if (perPage > 0 && body.teetimes.length < perPage) break;
        if (total > 0 && seen >= total) break;
        if (++page > MAX_PAGES) break;
      }
    }

    return results;
  },
};

/** Exported for the parser test — not part of the adapter's interface. */
export const __test = { toNormalized, padTime, parseExternalId, sideOf };
