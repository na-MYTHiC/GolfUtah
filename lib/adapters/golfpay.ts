import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";
import { politeFetch } from "./http";

/**
 * GolfPay adapter — written against a probe of The Barn Golf Club
 * (Pleasant View, UT) on 2026-08-15, not from a guess. See
 * scripts/golfpay-probe.ts, which produced every fact below.
 *
 * Endpoint: GET https://golfpay.co/api/tee-times
 * Query:    date=MM/DD/YYYY, course_id=<id>, tsid=<tee sheet id>,
 *           number_of_holes=9|18, source=, price_class_id=
 * Response: { data: { times: [ ... ] } }
 *
 * Auth: none. The capture carried a laravel_session cookie and a matching
 * X-CSRF-TOKEN, which is what Laravel usually demands — but the endpoint
 * answers cold, and that was checked before this file was written. If it
 * starts returning 419, that's the CSRF gate closing and this becomes a
 * much more expensive adapter (a page load per course per refresh to
 * mint a token).
 *
 * ONE REQUEST PER HOLE COUNT. There is no "all" value for
 * number_of_holes; 9 and 18 are separate sheets that overlap in time —
 * The Barn offers the same 12:40 as either. So a course-day costs two
 * requests, where ForeUp and Chronogolf cost one.
 *
 * Course.externalId is "<courseSlug>:<courseId>:<tsid>", e.g.
 * "the-barn-golf-club-ogden-ut-84414:1466:20". The slug is only used to
 * build the course-level fallback link; the API is addressed by the
 * numbers.
 */

const SITE = "https://golfpay.co";
const API = `${SITE}/api/tee-times`;

interface RawTeeTime {
  /** "YYYY-MM-DD HH:mm:ss", already course-local. */
  local_tee_time: string;
  date: string;
  number_of_holes: string; // "9" | "18"
  /**
   * Spots still open. The response has no explicit count — this is the
   * only field that varies with availability, confirmed by it reading
   * 4 / 2 / 1 across a real sheet rather than 4 everywhere.
   */
  max_allowed_golfers: number;
  min_allowed_golfers: number;
  is_cart_included: boolean;
  /** Dollars, as strings. "17.72". */
  regular_golfer_green_fee: string;
  regular_golfer_cart_fee: string;
  regular_price: string;
  /**
   * NOT a bookability flag, despite the name.
   *
   * It looked like one — the single junk row in the sample carried it.
   * But The Barn's 18-hole sheet had 25 rows with it set, priced
   * identically to the 12 without ($52.21 / $35.43 / $50.35 / $33.57).
   * Filtering on it would have hidden two thirds of the course's
   * inventory. It is read here only so the next person doesn't have to
   * re-derive that.
   */
  is_online_block: boolean;
  actions?: {
    /** Deep link carrying course_id, tee_time_ts and hole count. */
    createBookingUrl?: string;
  };
}

interface RawResponse {
  data?: { times?: RawTeeTime[] };
}

interface GolfPayIds {
  slug: string;
  courseId: string;
  tsid: string;
}

export function parseExternalId(externalId: string): GolfPayIds {
  const [slug, courseId, tsid] = externalId.split(":");
  if (!slug || !courseId || !tsid) {
    throw new Error(
      `Invalid GolfPay externalId "${externalId}" — expected ` +
        `"<courseSlug>:<courseId>:<tsid>", e.g. ` +
        `"the-barn-golf-club-ogden-ut-84414:1466:20"`
    );
  }
  return { slug, courseId, tsid };
}

/** GolfPay wants MM/DD/YYYY, unlike its own YYYY-MM-DD responses. */
function toGolfPayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

export function golfPayCourseUrl(slug: string, date?: string): string {
  const params = new URLSearchParams({ sort: "time" });
  if (date) params.set("date", date);
  return `${SITE}/course/${slug}?${params}`;
}

/**
 * Whether a row describes a real transaction.
 *
 * Every sheet sampled carried exactly one row where the price, the green
 * fee and the cart fee were all "1.0" — $1 golf, at the last slot of the
 * day, in both the 9 and 18 hole responses. That is a fixture, not a
 * price, and letting it through would make The Barn the cheapest course
 * in the app and fire the "usually $52" deal marker against it.
 *
 * Rather than invent a price floor — a guess about what a course may
 * charge — this checks the row against itself. A genuine row's price is
 * its green fee plus its cart fee:
 *
 *   cart row:  26.11 = 17.72 + 8.39   ok
 *   walk row:  17.72 = 17.72 + 0      ok
 *   junk row:   1.00 ≠  1.00 + 1.00   dropped
 *
 * A row that can't account for its own total isn't describing something
 * a golfer could buy.
 */
function isCoherent(raw: RawTeeTime): boolean {
  const price = Number(raw.regular_price);
  const green = Number(raw.regular_golfer_green_fee);
  const cart = Number(raw.regular_golfer_cart_fee);
  if (![price, green, cart].every(Number.isFinite)) return false;
  // A cent of slack: these arrive as decimal strings.
  return Math.abs(price - (green + cart)) < 0.011;
}

/** Dollars as a decimal string -> cents, or undefined if unusable. */
function toCents(dollars: string | undefined): number | undefined {
  const n = Number(dollars);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

/**
 * Collapses GolfPay's two rows per slot into one tee time.
 *
 * Every time appears twice, once with a cart and once without, carrying
 * the *same* green fee — 16:40 on The Barn's sheet is $26.11 with cart
 * and $17.72 walking, both reporting a 17.72 green fee and the cart row
 * adding 8.39. So the green fee and the cart price out cleanly, which is
 * exactly the shape the rest of the app wants: `price` is the green fee
 * alone and `cartFee` sits beside it.
 *
 * Emitting both rows instead would put the same tee time on screen twice
 * at two prices, and the cheaper one would win a "best price" badge for
 * being the walking rate.
 */
function collapse(rows: RawTeeTime[], fallbackUrl: string): NormalizedTeeTime | null {
  const usable = rows.filter(isCoherent);
  if (usable.length === 0) return null;

  const walking = usable.find((r) => !r.is_cart_included);
  const withCart = usable.find((r) => r.is_cart_included);
  const any = walking ?? withCart!;

  const [date, clock] = any.local_tee_time.split(" ");
  const time = clock?.slice(0, 5);
  if (!date || !time) return null;

  const holes = Number(any.number_of_holes) === 9 ? 9 : 18;

  // The green fee is on both rows; prefer the walking one, which quotes
  // it without a cart anywhere near it.
  const price = toCents(any.regular_golfer_green_fee);
  const cartFee = withCart ? toCents(withCart.regular_golfer_cart_fee) : undefined;

  return {
    date,
    time,
    holes,
    // Spots are per-row and identical across the pair in every sample;
    // the max is the safe read if they ever diverge.
    playersOpen: Math.max(...usable.map((r) => r.max_allowed_golfers || 0)),
    price,
    cartFee,
    // Deliberately absent: `price` is a green fee, never cart-inclusive.
    bookingUrl: (withCart ?? any).actions?.createBookingUrl ?? fallbackUrl,
  };
}

async function fetchSheet(
  ids: GolfPayIds,
  date: string,
  holes: 9 | 18
): Promise<RawTeeTime[]> {
  const params = new URLSearchParams({
    date: toGolfPayDate(date),
    course_id: ids.courseId,
    tsid: ids.tsid,
    source: "",
    price_class_id: "",
    number_of_holes: String(holes),
  });

  const resp = await politeFetch(`${API}?${params}`, {
    label: "GolfPay",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: golfPayCourseUrl(ids.slug, date),
      "x-requested-with": "XMLHttpRequest",
    },
  });

  if (!resp.ok) throw new Error(`GolfPay request failed: HTTP ${resp.status}`);

  const body = (await resp.json()) as RawResponse;
  return body.data?.times ?? [];
}

export const golfPayAdapter: TeeTimeAdapter = {
  platform: "GOLFPAY",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const ids = parseExternalId(course.externalId);

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const out: NormalizedTeeTime[] = [];

    for (const date of dates) {
      const fallback = golfPayCourseUrl(ids.slug, date);

      for (const holes of [9, 18] as const) {
        const rows = await fetchSheet(ids, date, holes);

        // Group by the slot itself. The response is not in time order —
        // row 0 and row 44 were both 18:30 — so nothing here may assume
        // adjacency.
        const byTime = new Map<string, RawTeeTime[]>();
        for (const raw of rows) {
          const key = raw.local_tee_time;
          byTime.set(key, [...(byTime.get(key) ?? []), raw]);
        }

        for (const group of byTime.values()) {
          const slot = collapse(group, fallback);
          if (slot && slot.playersOpen > 0) out.push(slot);
        }
      }
    }

    return out;
  },
};

export const __test = { collapse, isCoherent, parseExternalId, toGolfPayDate };
