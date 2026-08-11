import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * ForeUp adapter — confirmed against a real capture from Sun Hills Golf
 * Course (Layton, UT). ForeUp is the most common platform among Utah
 * courses (25 of the 57 surveyed).
 *
 * Endpoint: GET https://foreupsoftware.com/index.php/api/booking/times
 * Query:    time=all, date=MM-DD-YYYY, holes=all, players=0,
 *           booking_class=<id>, schedule_id=<id>, schedule_ids[]=<id>,
 *           specials_only=0, api_key=(empty)
 * Response: a flat array of slot objects.
 *
 * Auth: none. The captured request sent an empty `api_key` param and an
 * empty `api-key` header and still returned data. A PHPSESSID cookie was
 * present but is not sent here — re-check this if requests start failing.
 *
 * Course.externalId is "<courseId>:<scheduleId>:<bookingClassId>", e.g.
 * "18895:578:177" for Sun Hills. All three are visible in the booking
 * page URL and the request query; bookingClassId also comes back on every
 * response row as `booking_class_id`. It selects the rate class (public
 * vs member), so it differs per course and must be captured per course.
 */

const API_BASE = "https://foreupsoftware.com/index.php/api/booking";

interface RawTeeTime {
  time: string; // "YYYY-MM-DD HH:mm", course-local
  course_id: number;
  course_name: string;
  schedule_id: number;
  /** 9, 18, or the string "9/18" when a slot can be booked either way. */
  holes: number | string;
  available_spots: number;
  available_spots_9: number;
  available_spots_18: number;
  green_fee: number; // dollars, per player
  green_fee_9: number;
  green_fee_18: number;
  cart_fee: number;
  cart_fee_9: number;
  cart_fee_18: number;
  teesheet_side_name: string; // "Front" | "Back"
  booking_class_id: number;
  // Note: the response also carries `start_front`, which looks like a
  // YYYYMMDDHHMM stamp but disagrees with `time` on the month (e.g.
  // 202607150645 alongside "2026-08-15 06:45"). Don't use it — `time` is
  // the field the booking UI actually displays.
}

interface ForeUpIds {
  courseId: number;
  scheduleId: number;
  /** Optional — see parseExternalId. */
  bookingClassId?: number;
}

/**
 * Accepts "<courseId>:<scheduleId>" or
 * "<courseId>:<scheduleId>:<bookingClassId>".
 *
 * The booking class is left optional on purpose: courseId and scheduleId
 * are both readable straight from a course's booking URL, but the booking
 * class is not — it only appears in the widget's own request. Requiring
 * it would mean a hand capture for every course.
 *
 * IMPORTANT: omitting it can return a *subset* of the tee sheet, not
 * just different prices. Sun Hills' own booking page ("Booking as:
 * Regular", class 177) lists times from 6:45am on 2026-08-15, while the
 * same request without booking_class starts at 11:06am. An earlier check
 * here compared only prices, saw them match, and wrongly concluded the
 * param was unnecessary — prices matching says nothing about which slots
 * are visible.
 *
 * So: capture booking_class per course. Without it the adapter still
 * works, but treat the result as possibly incomplete.
 */
export function parseExternalId(externalId: string): ForeUpIds {
  const [course, schedule, bookingClass] = externalId.split(":");
  const courseId = Number(course);
  const scheduleId = Number(schedule);

  if (!courseId || !scheduleId) {
    throw new Error(
      `Invalid ForeUp externalId "${externalId}" — expected ` +
        `"<courseId>:<scheduleId>" or "<courseId>:<scheduleId>:<bookingClassId>", ` +
        `e.g. "18895:578:177"`
    );
  }

  const bookingClassId = bookingClass ? Number(bookingClass) : undefined;
  if (bookingClass && !bookingClassId) {
    throw new Error(`Invalid ForeUp bookingClassId in "${externalId}"`);
  }

  return { courseId, scheduleId, bookingClassId };
}

/** ForeUp wants MM-DD-YYYY in the query, unlike its own YYYY-MM-DD responses. */
function toForeUpDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${month}-${day}-${year}`;
}

/**
 * ForeUp's booking page, optionally preselecting the day and round.
 *
 * Format confirmed from a real link:
 *   /index.php/booking/18895/578?date=08-11-2026&players=2&holes=18
 *     &schedule_id=578&booking_class_id=177#/teetimes
 *
 * Note the query string sits *before* the `#/teetimes` hash — putting it
 * after the hash does nothing. There's no `time` parameter: ForeUp
 * deep-links to a day's tee sheet, not an individual slot, so the best
 * we can do is land the golfer on the right date with the right filters
 * and let them pick their time from the list.
 */
export function foreUpBookingUrl(
  courseId: number,
  scheduleId: number,
  opts: { date?: string; holes?: number; players?: number; bookingClassId?: number } = {}
): string {
  const base = `https://foreupsoftware.com/index.php/booking/${courseId}/${scheduleId}`;
  const params = new URLSearchParams();

  // ForeUp wants MM-DD-YYYY here, same as its API.
  if (opts.date) params.set("date", toForeUpDate(opts.date));
  if (opts.players) params.set("players", String(opts.players));
  if (opts.holes) params.set("holes", String(opts.holes));
  params.set("schedule_id", String(scheduleId));
  if (opts.bookingClassId !== undefined) {
    params.set("booking_class_id", String(opts.bookingClassId));
  }

  return `${base}?${params}#/teetimes`;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/**
 * PHPSESSID per course+schedule.
 *
 * A browser never calls the times endpoint cold: it loads
 * /index.php/booking/<courseId>/<scheduleId> first, which issues a
 * session, and only then does the widget fetch times. Booking class
 * selection appears to be held against that session server-side, which
 * would explain a request carrying booking_class=177 still coming back
 * with a truncated sheet. So establish a session the same way.
 */
const sessions = new Map<string, { cookie: string; at: number }>();
const SESSION_TTL_MS = 20 * 60 * 1000;

async function getSession(ids: ForeUpIds): Promise<string | undefined> {
  const key = `${ids.courseId}:${ids.scheduleId}`;
  const hit = sessions.get(key);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.cookie;

  try {
    const resp = await fetch(bookingPageUrl(ids.courseId, ids.scheduleId), {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
    });

    // getSetCookie keeps multiple Set-Cookie headers separate; a plain
    // get() would join them into one unusable string.
    const cookies = resp.headers
      .getSetCookie?.()
      .map((c) => c.split(";")[0])
      .filter(Boolean);

    if (cookies?.length) {
      const cookie = cookies.join("; ");
      sessions.set(key, { cookie, at: Date.now() });
      return cookie;
    }
  } catch {
    // No session is survivable — the request still usually returns data,
    // just possibly a different slice of it.
  }
  return undefined;
}

function bookingPageUrl(courseId: number, scheduleId: number): string {
  return `https://foreupsoftware.com/index.php/booking/${courseId}/${scheduleId}`;
}

async function fetchOneDate(ids: ForeUpIds, date: string): Promise<RawTeeTime[]> {
  // Built in ForeUp's own parameter order rather than alphabetically or
  // by convenience — matching the real request exactly costs nothing and
  // removes a variable when results disagree with the course's page.
  const params = new URLSearchParams();
  params.set("time", "all");
  params.set("date", toForeUpDate(date));
  params.set("holes", "all");
  params.set("players", "0");
  if (ids.bookingClassId !== undefined) {
    params.set("booking_class", String(ids.bookingClassId));
  }
  params.set("schedule_id", String(ids.scheduleId));
  params.append("schedule_ids[]", String(ids.scheduleId));
  params.set("specials_only", "0");
  params.set("api_key", "");

  const cookie = await getSession(ids);

  const resp = await fetch(`${API_BASE}/times?${params}`, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.5",
      // ForeUp's widget sends this header empty; mirrored rather than
      // omitted in case its presence is what's checked.
      "api-key": "",
      referer: bookingPageUrl(ids.courseId, ids.scheduleId),
      "user-agent": UA,
      "x-fu-golfer-location": "foreup",
      "x-requested-with": "XMLHttpRequest",
      ...(cookie ? { cookie } : {}),
    },
  });

  if (!resp.ok) {
    throw new Error(`ForeUp request failed: HTTP ${resp.status}`);
  }

  return resp.json();
}

/**
 * One raw slot can yield two normalized entries: when `holes` is "9/18"
 * the same tee time is bookable as either a 9- or an 18-hole round, at
 * different prices, so it's listed once per option rather than collapsed
 * into a single ambiguous row.
 */
export function toNormalized(
  raw: RawTeeTime,
  ids: { courseId: number; scheduleId: number; bookingClassId?: number }
): NormalizedTeeTime[] {
  const [date, time] = raw.time.split(" ");
  if (!date || !time) return [];

  const options: { holes: 9 | 18; spots: number; greenFee: number; cartFee: number }[] = [];
  const holes = String(raw.holes);

  if (holes === "9" || holes === "9/18") {
    options.push({
      holes: 9,
      spots: raw.available_spots_9,
      greenFee: raw.green_fee_9,
      cartFee: raw.cart_fee_9,
    });
  }
  if (holes === "18" || holes === "9/18") {
    options.push({
      holes: 18,
      spots: raw.available_spots_18,
      greenFee: raw.green_fee_18,
      cartFee: raw.cart_fee_18,
    });
  }

  return options
    // A zero here means "not bookable as this hole count" (either sold out
    // or not offered on this side), so it isn't worth surfacing.
    .filter((o) => o.spots > 0)
    .map((o) => ({
      date,
      time,
      holes: o.holes,
      playersOpen: o.spots,
      price: Math.round(o.greenFee * 100), // dollars -> cents
      side: raw.teesheet_side_name,
      // Cart fees are quoted separately and are usually optional, so the
      // headline price stays green-fee-only for comparability with other
      // platforms. `cartFee` isn't in the normalized shape yet.
      //
      // Each slot gets its own link so the golfer lands on the right day
      // with the right round preselected, rather than on today's sheet.
      bookingUrl: foreUpBookingUrl(ids.courseId, ids.scheduleId, {
        date,
        holes: o.holes,
        bookingClassId: ids.bookingClassId,
      }),
    }));
}

export const foreupAdapter: TeeTimeAdapter = {
  platform: "FOREUP",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const ids = parseExternalId(course.externalId);

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const results: NormalizedTeeTime[] = [];
    for (const date of dates) {
      const raw = await fetchOneDate(ids, date);
      for (const slot of raw) {
        results.push(...toNormalized(slot, ids));
      }
    }
    return results;
  },
};
