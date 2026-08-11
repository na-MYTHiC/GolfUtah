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
 * Verified against Sun Hills: for the same date, "18895:578" and
 * "18895:578:177" return the same slots at the same prices ($21 / $40 on
 * 2026-08-15), so omitting the param yields the public rate. (An earlier
 * price gap turned out to be weekday-vs-weekend — 2026-08-11 quotes
 * $19 / $36 — not the booking class.) That's one course, though; if a
 * course returns nothing or prices that look wrong, capture its
 * booking_class and add the third segment.
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

/** ForeUp's own booking page for this course/schedule. */
export function foreUpBookingUrl(courseId: number, scheduleId: number): string {
  return `https://foreupsoftware.com/index.php/booking/${courseId}/${scheduleId}#/teetimes`;
}

async function fetchOneDate(ids: ForeUpIds, date: string): Promise<RawTeeTime[]> {
  const params = new URLSearchParams({
    time: "all",
    date: toForeUpDate(date),
    holes: "all",
    players: "0",
    schedule_id: String(ids.scheduleId),
    "schedule_ids[]": String(ids.scheduleId),
    specials_only: "0",
    api_key: "",
  });
  if (ids.bookingClassId !== undefined) {
    params.set("booking_class", String(ids.bookingClassId));
  }

  const resp = await fetch(`${API_BASE}/times?${params}`, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      "x-fu-golfer-location": "foreup",
      referer: `https://foreupsoftware.com/index.php/booking/${ids.courseId}/${ids.scheduleId}`,
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
export function toNormalized(raw: RawTeeTime, bookingUrl: string): NormalizedTeeTime[] {
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
      // Cart fees are quoted separately and are usually optional, so the
      // headline price stays green-fee-only for comparability with other
      // platforms. `cartFee` isn't in the normalized shape yet.
      bookingUrl,
    }));
}

export const foreupAdapter: TeeTimeAdapter = {
  platform: "FOREUP",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const ids = parseExternalId(course.externalId);
    const bookingUrl = foreUpBookingUrl(ids.courseId, ids.scheduleId);

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const results: NormalizedTeeTime[] = [];
    for (const date of dates) {
      const raw = await fetchOneDate(ids, date);
      for (const slot of raw) {
        results.push(...toNormalized(slot, bookingUrl));
      }
    }
    return results;
  },
};
