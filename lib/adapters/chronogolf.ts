import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";
import { politeFetch } from "./http";

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

/**
 * The rounds to ask for, one request each.
 *
 * The widget sends holes=9,18 in a single call, and copying it is what
 * made the adapter over-report: that response carries every slot the
 * course could sell either round at, with no indication of which rounds
 * are actually on sale at each. Asking per round narrows it to what the
 * public can book.
 */
const ROUNDS: readonly (9 | 18)[] = [9, 18];

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
  page: number,
  holes: string
): Promise<{ body: RawResponse; total: number; perPage: number }> {
  const params = new URLSearchParams({
    start_date: date,
    course_ids: courseIds.join(","),
    holes,
    page: String(page),
  });

  const resp = await politeFetch(`${API}?${params}`, {
    label: "Chronogolf",
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

function toNormalized(
  raw: RawTeeTime,
  slug: string,
  dayUrl: string,
  /** The round this response was filtered to, and so the only one on offer. */
  holes: 9 | 18
): NormalizedTeeTime[] {
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

  // One row, for the round that was asked for.
  //
  // This used to expand each slot by raw.course.bookable_holes, which is
  // the course's capability rather than the slot's offer — and so
  // invented a row for every round the course *can* sell, bookable or
  // not. The caller now asks per round and the response is already
  // filtered to what is on sale, so the round is known rather than
  // guessed.
  return [
    {
      date: raw.date,
      time,
      holes,
      playersOpen: spots,
      // default_price carries its own `bookable_holes` saying which round
      // it's the rate for, and it is not always the round asked for: a
      // course whose default product is its nine quotes the nine even in
      // an 18-hole response. Pricing the eighteen from it would be
      // inventing a number, so an unpriced row shows "—" and a price
      // filter excludes it. That is now the only reason a price is
      // missing — the unbookable rounds are gone.
      price:
        raw.default_price && raw.default_price.bookable_holes === holes
          ? Math.round(raw.default_price.green_fee * 100)
          : undefined,
      // half_cart is a share of a cart between two players, which is what
      // a single golfer actually pays when riding.
      cartFee:
        raw.default_price?.half_cart != null && raw.default_price.bookable_holes === holes
          ? Math.round(raw.default_price.half_cart * 100)
          : undefined,
      rateName: raw.default_price?.affiliation_type,
      side,
      bookingUrl,
    },
  ];
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

      // Once per round, not once for both.
      //
      // `holes` is an availability filter, not a hint: holes=18 returns
      // only the slots where the public can actually book eighteen.
      // Verified against affiliation_types_availability on the per-slot
      // endpoint, 8 of 8 — see scripts/chronogolf-slot.ts --holes-filter.
      //
      // Asking holes=9,18 and expanding each slot by course.bookable_holes
      // was publishing rounds nobody could book. Old Mill offers 9 and 18
      // on paper, and at 7:50 the eighteen had an empty public
      // affiliation_types list: not a missing price, a round that is not
      // on sale. A tee time that fails when tapped is the worst thing
      // this app can show, and it was showing one for roughly half of
      // every dual-round sheet.
      //
      // Costs two list requests per course-day instead of one. That is
      // real against a host that starts refusing around 57 — which is why
      // build-data.ts narrows Chronogolf's day band to match. Staler and
      // right beats fresher and wrong.
      for (const holes of ROUNDS) {
        let page = 1;
        let seen = 0;

        for (;;) {
          const { body, total, perPage } = await fetchPage(courseIds, date, page, String(holes));
          if (body.status !== "open" || !Array.isArray(body.teetimes)) break;

          for (const raw of body.teetimes) {
            results.push(...toNormalized(raw, slug, dayUrl, holes));
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
    }

    return results;
  },
};

/** Exported for the parser test — not part of the adapter's interface. */
export const __test = { toNormalized, padTime, parseExternalId, sideOf };
