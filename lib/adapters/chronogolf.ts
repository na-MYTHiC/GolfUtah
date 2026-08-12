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
 * Auth: none. No Authorization header, no cookie, no api key. A capture
 * taken while signed in carries a `_chronogolf_session` cookie, but the
 * tee-times request succeeds without it — nothing here sends one, and
 * nothing here should.
 *
 * Also seen but not used: GET /marketplace/v2/teesheet_notes
 * ?date=YYYY-MM-DD&course_ids=<uuid> — presumably the pro shop's notes
 * for the day (cart-path-only, aerification, frost delay), which would be
 * worth showing on a course page. Note it takes `date`, where tee times
 * take `start_date`. Unimplemented because only the request has been
 * seen, never a response, and there's no guessing the shape of one.
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

function toNormalized(raw: RawTeeTime, slug: string, dayUrl: string): NormalizedTeeTime[] {
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

  // Straight to this slot when its uuid is there, falling back to the
  // day's sheet — a handoff that lands on the right day is still useful,
  // and is what every other platform here manages.
  const bookingUrl = raw.uuid
    ? chronogolfTeeTimeUrl(slug, raw.date, raw.uuid)
    : dayUrl;

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
 * A link to one specific slot rather than to the day's sheet — the tap
 * lands on Chronogolf's "choose your options" step for that exact tee
 * time, skipping the hunt for it on a sheet that may have moved on.
 *
 * Verified, not inferred: a capture's referer showed the browser sitting
 * on
 *   /club/riverbend-slco?date=2026-08-12&step=options
 *     &teetime=82391ed2-6f10-490a-a26d-d81f5ac5b0af
 * and that uuid is byte-for-byte the `uuid` of the 8:20 back-nine slot in
 * the tee-times response for the same day. `teetime` takes the slot's
 * uuid, not its numeric `id`, matching how courses are addressed.
 *
 * Note this drops the sheet-level parameters — a slot is already a
 * course, a date, and a time, so there's nothing left to narrow.
 */
export function chronogolfTeeTimeUrl(
  slug: string,
  date: string,
  teeTimeUuid: string
): string {
  const params = new URLSearchParams({
    date,
    step: "options",
    teetime: teeTimeUuid,
  });
  return `${BOOKING_BASE}/${slug}?${params}`;
}

/**
 * Utah Chronogolf clubs still waiting on a capture. Empty: all fourteen
 * known ones are seeded in lib/courses.data.ts, resolved by
 * scripts/chronogolf-discover.ts rather than by hand.
 *
 * Add entries here if another Utah club turns up on Chronogolf, then run
 * the discover script to resolve its uuids.
 */
export const CHRONOGOLF_PENDING: { name: string; city: string; slug?: string }[] = [];

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
      // Fallback for a slot with no uuid; the usual case links to the
      // slot itself.
      const dayUrl = chronogolfBookingUrl(slug, date);

      // The parameter is `start_date`, which hints a range might be
      // accepted, but only a single-day request has been observed — so
      // one request per day, like the other two adapters.
      let page = 1;
      let seen = 0;

      for (;;) {
        const { body, total, perPage } = await fetchPage(courseIds, date, page);
        if (body.status !== "open" || !Array.isArray(body.teetimes)) break;

        for (const raw of body.teetimes) {
          results.push(...toNormalized(raw, slug, dayUrl));
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
