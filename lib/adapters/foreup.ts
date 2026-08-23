import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";
import { politeFetch, BROWSER_UA } from "./http";

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
  /**
   * Usually "Front" or "Back", but it's the *sheet's* name and courses
   * are free to call it anything — "Teesheet 1" and similar show up.
   * Normalized by sideOf() rather than passed through.
   */
  teesheet_side_name: string;
  booking_class_id: number;
  // Note: the response also carries `start_front`, which looks like a
  // YYYYMMDDHHMM stamp but disagrees with `time` on the month (e.g.
  // 202607150645 alongside "2026-08-15 06:45"). Don't use it — `time` is
  // the field the booking UI actually displays.
}

interface ForeUpIds {
  courseId: number;
  /** First schedule — the one whose booking page seeds the session. */
  scheduleId: number;
  /** Every schedule for this course, `scheduleId` included. */
  scheduleIds: number[];
  /** Optional — see parseExternalId. */
  bookingClassId?: number;
  /** Every booking class to ask for; empty when none was captured. */
  bookingClassIds: number[];
}

/**
 * Accepts "<courseId>:<scheduleId>" or
 * "<courseId>:<scheduleId>:<bookingClassId>", and the schedule part may
 * be a comma-separated list: "19501:1759,1760:1208".
 *
 * A COURSE CAN HAVE MORE THAN ONE TEE SHEET, and one id only ever sees
 * one of them. Valley View's booking page opens on a choice between 18
 * holes and 9 holes; those are separate ForeUp schedules with separate
 * ids, not two views of one sheet. Seeding a single id published half
 * the course, with nothing to indicate the other half existed.
 *
 * That also explains a time appearing in the app that could not be
 * found on the course's own site: the slot was real, on the sheet we
 * were reading, while the site had opened on the other sheet. The
 * per-slot link carried the right schedule, which is why following it
 * landed on the time.
 *
 * Every id is fetched and the rows merged.
 *
 * THE BOOKING CLASS TAKES A LIST TOO, and this is the one that bit.
 * Valley View publishes its 18-hole round and its nine as two classes
 * on one sheet:
 *
 *   19501:1759:1208   24 rows, all 18 holes
 *   19501:1759:1209   67 rows, all 9 holes
 *
 * Seeding 1208 alone published 24 of 91 daily slots and no nines at
 * all — and left a golfer comparing the app against the course's own
 * page, which opens on a different class, wondering where the times
 * came from. "19501:1759:1208,1209" asks for both.
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
 *
 * ON SOME INSTALLS IT ISN'T OPTIONAL AT ALL. Davis Park (19500:1757)
 * returns an empty array to a request with no booking_class — cold and
 * with a session, on every date tried — and the full sheet once
 * booking_class=2094 is included. So the failure mode isn't always a
 * truncated morning; it can be a course that looks like it has published
 * nothing. If a ForeUp course shows no times at all, this is the first
 * thing to check.
 */
export function parseExternalId(externalId: string): ForeUpIds {
  const [course, schedule, bookingClass] = externalId.split(":");
  const courseId = Number(course);
  const scheduleIds = (schedule ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!courseId || scheduleIds.length === 0) {
    throw new Error(
      `Invalid ForeUp externalId "${externalId}" — expected ` +
        `"<courseId>:<scheduleId>" or "<courseId>:<scheduleId>:<bookingClassId>", ` +
        `e.g. "18895:578:177". The schedule may be a list: "19501:1759,1760:1208"`
    );
  }
  if (schedule.split(",").length !== scheduleIds.length) {
    throw new Error(`Invalid ForeUp scheduleId in "${externalId}"`);
  }

  const bookingClassIds = (bookingClass ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (bookingClass && bookingClass.split(",").length !== bookingClassIds.length) {
    throw new Error(`Invalid ForeUp bookingClassId in "${externalId}"`);
  }

  return {
    courseId,
    scheduleId: scheduleIds[0],
    scheduleIds,
    bookingClassId: bookingClassIds[0],
    bookingClassIds,
  };
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

const UA = BROWSER_UA;

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

/**
 * In-flight session fetches, so N callers asking at once cost one page
 * load rather than N.
 *
 * This became load-bearing when the build started fetching several days
 * at a time: the cache is only populated once a response comes back, so
 * concurrent first-callers for the same course all missed it and all
 * loaded the booking page. That's the heaviest request this adapter
 * makes — a full HTML page, purely to be handed a cookie — and doing it
 * three times per course per run is exactly the sort of thing that gets
 * an aggregator noticed for the wrong reason.
 */
const inFlight = new Map<string, Promise<string | undefined>>();

async function getSession(ids: ForeUpIds, scheduleId: number): Promise<string | undefined> {
  const key = `${ids.courseId}:${scheduleId}`;
  const hit = sessions.get(key);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.cookie;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = fetchSession(ids, scheduleId, key).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function fetchSession(
  ids: ForeUpIds,
  scheduleId: number,
  key: string
): Promise<string | undefined> {
  try {
    const resp = await politeFetch(bookingPageUrl(ids.courseId, scheduleId), {
      label: "ForeUp session",
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

async function fetchOneDate(
  ids: ForeUpIds,
  date: string,
  scheduleId: number,
  bookingClassId: number | undefined
): Promise<RawTeeTime[]> {
  // Built in ForeUp's own parameter order rather than alphabetically or
  // by convenience — matching the real request exactly costs nothing and
  // removes a variable when results disagree with the course's page.
  const params = new URLSearchParams();
  params.set("time", "all");
  params.set("date", toForeUpDate(date));
  params.set("holes", "all");
  params.set("players", "0");
  if (bookingClassId !== undefined) {
    params.set("booking_class", String(bookingClassId));
  }
  params.set("schedule_id", String(scheduleId));
  params.append("schedule_ids[]", String(scheduleId));
  params.set("specials_only", "0");
  params.set("api_key", "");

  // Session is per course+schedule: the widget loads that schedule's own
  // booking page before asking for its times, and booking-class selection
  // is held against it server-side.
  const cookie = await getSession(ids, scheduleId);

  const resp = await politeFetch(`${API_BASE}/times?${params}`, {
    label: "ForeUp",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.5",
      // ForeUp's widget sends this header empty; mirrored rather than
      // omitted in case its presence is what's checked.
      "api-key": "",
      referer: bookingPageUrl(ids.courseId, scheduleId),
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
/**
 * Only a real nine gets a label.
 *
 * This field is the tee sheet's name, not a side, so a course that calls
 * its sheet "Teesheet 1" was putting that word in every row. Anything
 * that isn't recognisably a front or back nine is dropped — an unlabelled
 * slot reads fine, a mystery word doesn't.
 */
function sideOf(sheetName: string): string | undefined {
  if (/\bback\b/i.test(sheetName)) return "Back";
  if (/\bfront\b/i.test(sheetName)) return "Front";
  return undefined;
}

export function toNormalized(
  raw: RawTeeTime,
  ids: { courseId: number; scheduleId: number; bookingClassId?: number },
  /** The sheet this row was fetched from, for courses with several. */
  fromSchedule?: number,
  /** The class it was fetched under, likewise. */
  fromClass?: number
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
      // Quoted separately here and usually optional, so the headline
      // price stays green-fee-only and the cart is shown beside it.
      // Mixing the two is how a cart-inclusive price ends up looking
      // cheaper than a walking one.
      cartFee: o.cartFee > 0 ? Math.round(o.cartFee * 100) : undefined,
      side: sideOf(raw.teesheet_side_name),
      // Each slot gets its own link so the golfer lands on the right day
      // with the right round preselected, rather than on today's sheet.
      //
      // The row's own schedule_id, not the seeded one. A course with a
      // separate 9- and 18-hole sheet would otherwise send every link to
      // whichever sheet happened to be listed first — landing the golfer
      // on a day that genuinely has no such time, which is precisely the
      // "the app shows it but the site doesn't" report.
      bookingUrl: foreUpBookingUrl(ids.courseId, raw.schedule_id || fromSchedule || ids.scheduleId, {
        date,
        holes: o.holes,
        // The row's own class, for the same reason as the schedule: a
        // course whose nine and eighteen are separate classes would
        // otherwise send every link to whichever was seeded first, and
        // land the golfer on a sheet without the time they tapped.
        bookingClassId: raw.booking_class_id || fromClass || ids.bookingClassId,
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
    // Deduped across schedules. A course that lists the same slot on more
    // than one sheet would otherwise show it twice, and there's no way
    // for a golfer to tell those apart.
    const seen = new Set<string>();

    // No class captured still means one request, with none sent.
    const classes: (number | undefined)[] =
      ids.bookingClassIds.length > 0 ? ids.bookingClassIds : [undefined];

    for (const date of dates) {
      for (const scheduleId of ids.scheduleIds) {
        for (const bookingClassId of classes) {
          const raw = await fetchOneDate(ids, date, scheduleId, bookingClassId);
          for (const slot of raw) {
            for (const normalized of toNormalized(slot, ids, scheduleId, bookingClassId)) {
              const key = `${normalized.time}|${normalized.holes}|${normalized.side ?? ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push(normalized);
            }
          }
        }
      }
    }
    return results;
  },
};
