import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * MemberSports adapter — confirmed against a real capture from Eaglewood
 * Golf Course (North Salt Lake, UT) on 2026-08-10.
 *
 * Endpoint: POST https://api.membersports.com/api/v1/golfclubs/onlineBookingTeeTimes
 * Body:     { configurationTypeId, date: "YYYY-MM-DD", golfClubGroupId,
 *             golfClubId, golfCourseId, groupSheetTypeId }
 * Response: array of { teeTime: number, items: RawItem[] } buckets, one
 *           per time-of-day slot. `teeTime` is **minutes since midnight**,
 *           not HHMM digits (e.g. 820 -> 13:40 / 1:40pm, NOT 8:20am) —
 *           confirmed by matching a live capture's raw values against the
 *           actual on-screen display for the same slots (see PR/commit
 *           notes). Do not "fix" this back to a digit-split without new
 *           evidence — that was the wrong assumption the first time.
 *
 * Course.externalId encodes both IDs MemberSports needs, as
 * "<golfClubId>:<golfCourseId>" (e.g. "15391:18901" for Eaglewood) — a
 * single Course only ever maps to one club+course pair.
 *
 * Auth: none needed. Confirmed via a fresh Incognito capture — the
 * request that succeeds (200 OK) sends literally `Authorization: Bearer
 * null`. The earlier capture's real-looking JWT (with a user's name in
 * it) was just whatever happened to be sitting in that browser's normal
 * profile; MemberSports doesn't actually require it for this endpoint.
 * Only `x-api-key` (a public value baked into their web app, same for
 * every visitor) is required.
 */

const API_BASE = "https://api.membersports.com/api/v1";

// Public client key baked into MemberSports' own web app JS bundle (same
// for every visitor) — not a per-user secret, safe to keep in source.
const X_API_KEY = "A9814038-9E19-4683-B171-5A06B39147FC";

interface RawTeeTimeItem {
  /**
   * NOT the number of open spots — it reads 0 on every slot, including
   * ones the course page shows as bookable. Use
   * maximumPlayersPerBooking - playerCount instead; see toNormalized.
   */
  availableCount: number;
  bookingNotAllowed: boolean;
  maximumPlayersPerBooking: number;
  golfClubId: number;
  golfCourseId: number;
  golfCourseNumberOfHoles: number;
  holesRequirementTypeId: number; // observed: 0 -> 18-hole rate, 1 -> 9-hole rate
  isBackNine: boolean;
  minimumNumberOfPlayers: number;
  name: string;
  playerCount: number;
  price: number; // dollars, per player
  teeTimeId: number;
}

interface RawTeeTimeBucket {
  teeTime: number; // minutes since midnight, e.g. 820 = 13:40 / 1:40pm
  items: RawTeeTimeItem[];
}

function parseCourseIds(externalId: string): { golfClubId: number; golfCourseId: number } {
  const [clubIdStr, courseIdStr] = externalId.split(":");
  const golfClubId = Number(clubIdStr);
  const golfCourseId = Number(courseIdStr);
  if (!golfClubId || !golfCourseId) {
    throw new Error(
      `Invalid MemberSports externalId "${externalId}" — expected "<golfClubId>:<golfCourseId>"`
    );
  }
  return { golfClubId, golfCourseId };
}

/**
 * MemberSports encodes time-of-day as minutes since midnight (e.g. 820 ->
 * 13:40 / 1:40pm) — confirmed against a real booking page's display, not
 * a digit-split of the raw number. See file header comment.
 */
function formatTeeTime(minutesSinceMidnight: number): string {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function fetchOneDate(
  golfClubId: number,
  golfCourseId: number,
  date: string
): Promise<RawTeeTimeBucket[]> {
  const resp = await fetch(`${API_BASE}/golfclubs/onlineBookingTeeTimes`, {
    method: "POST",
    headers: {
      accept: "application/json",
      // Confirmed real behavior, not a placeholder — see file header.
      authorization: "Bearer null",
      "content-type": "application/json; charset=UTF-8",
      origin: "https://app.membersports.com",
      referer: "https://app.membersports.com/",
      "x-api-key": X_API_KEY,
    },
    body: JSON.stringify({
      configurationTypeId: 0,
      date,
      golfClubGroupId: 0,
      golfClubId,
      golfCourseId,
      groupSheetTypeId: 0,
    }),
  });

  if (!resp.ok) {
    throw new Error(`MemberSports request failed: HTTP ${resp.status}`);
  }

  return resp.json();
}

/**
 * MemberSports' own booking page for a club+course, e.g.
 * https://app.membersports.com/tee-times/15391/18901/0 for Eaglewood —
 * pattern confirmed by matching that public URL against the golfClubId /
 * golfCourseId from our own capture of the same course.
 *
 * Lands on the course's tee sheet rather than its marketing homepage,
 * which is a better handoff. Still course+date level, not slot level —
 * we haven't found a URL form that preselects a specific tee time.
 */
export function memberSportsBookingUrl(golfClubId: number, golfCourseId: number): string {
  return `https://app.membersports.com/tee-times/${golfClubId}/${golfCourseId}/0`;
}

/** Standard tee sheet capacity, used when the field is missing. */
const DEFAULT_CAPACITY = 4;

function openSpots(item: RawTeeTimeItem): number {
  const capacity =
    Number.isFinite(item.maximumPlayersPerBooking) && item.maximumPlayersPerBooking > 0
      ? item.maximumPlayersPerBooking
      : DEFAULT_CAPACITY;
  const booked = Number.isFinite(item.playerCount) ? item.playerCount : 0;
  return Math.max(0, capacity - booked);
}

function toNormalized(
  bucket: RawTeeTimeBucket,
  date: string,
  bookingUrl: string
): NormalizedTeeTime[] {
  const time = formatTeeTime(bucket.teeTime);

  return bucket.items
    .filter((item) => !item.bookingNotAllowed)
    .map((item) => ({
      date,
      time,
      // holesRequirementTypeId: 1 -> 9 holes, 0 -> 18.
      //
      // OPEN QUESTION, deliberately not acted on: Eaglewood's own page
      // badges type-1 slots "9 ONLY" but type-0 slots "9/18", which
      // suggests type 0 means "either", not "18 only" — in which case
      // this hides a bookable 9-hole option at those times. Left as-is
      // because the item carries a single price ($64, the 18-hole rate),
      // so emitting a 9-hole option would mean inventing its price.
      // Resolve by checking whether a type-0 slot can actually be booked
      // for 9 holes, and at what rate.
      holes: (item.holesRequirementTypeId === 1 ? 9 : 18) as 9 | 18,
      // Open spots = capacity minus who's already booked.
      //
      // `availableCount` looks like the obvious field but reads 0 on every
      // slot, which silently hid every MemberSports tee time. Checked
      // against Eaglewood's own page, maximumPlayersPerBooking -
      // playerCount reproduces the upper bound it displays (4-2 -> "1-2",
      // 4-0 -> "2-4", 4-3 -> "1-1") on every slot sampled.
      //
      // Falls back to a foursome if capacity is missing: an absent field
      // would otherwise make this NaN, fail the "> 0" check below, and
      // hide the whole course — the same failure mode all over again.
      // Showing a time with a slightly wrong spot count beats hiding a
      // real one.
      playersOpen: openSpots(item),
      price: Math.round(item.price * 100), // dollars -> cents
      // MemberSports flags back-nine starts both on isBackNine and in the
      // item name ("Eaglewood Back Nine"). Without it, a back-nine slot is
      // indistinguishable from a front-nine one at the same time.
      side: item.isBackNine ? "Back" : "Front",
      bookingUrl,
    }))
    // A full slot isn't availability; ForeUp's adapter drops these too.
    .filter((slot) => slot.playersOpen > 0);
}

export const memberSportsAdapter: TeeTimeAdapter = {
  platform: "MEMBERSPORTS",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const { golfClubId, golfCourseId } = parseCourseIds(course.externalId);

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    // Prefer MemberSports' own tee sheet over whatever marketing page the
    // Course row points at — it drops the user straight into booking.
    const bookingUrl = memberSportsBookingUrl(golfClubId, golfCourseId);

    const results: NormalizedTeeTime[] = [];
    for (const date of dates) {
      const buckets = await fetchOneDate(golfClubId, golfCourseId, date);
      for (const bucket of buckets) {
        results.push(...toNormalized(bucket, date, bookingUrl));
      }
    }
    return results;
  },
};
