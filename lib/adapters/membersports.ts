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
 * NOT YET RESOLVED: how to obtain a valid `Authorization: Bearer` token
 * server-side. The captured request had a real token identifying the
 * capturing user's own MemberSports profile, even though no login screen
 * was shown — meaning the browser already had a stored MemberSports
 * session (cookie/localStorage) from some earlier visit, not that the
 * endpoint is anonymous. We haven't captured the request that actually
 * issues/refreshes that token, so `getAccessToken` below is a stub.
 * To find it: clear cookies for membersports.com / app.membersports.com
 * (or use a fresh Incognito window), reload the Eaglewood booking page
 * with the Network tab open, and look for the first auth-ish request
 * that fires before `onlineBookingTeeTimes` — likely something under
 * `/api/v1/auth/...` or similar.
 */

const API_BASE = "https://api.membersports.com/api/v1";

// Public client key baked into MemberSports' own web app JS bundle (same
// for every visitor) — not a per-user secret, safe to keep in source.
const X_API_KEY = "A9814038-9E19-4683-B171-5A06B39147FC";

interface RawTeeTimeItem {
  availableCount: number;
  bookingNotAllowed: boolean;
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
  teeTime: number; // e.g. 820 = 8:20am, 1110 = 11:10am
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

async function getAccessToken(): Promise<string> {
  throw new Error(
    "MemberSports getAccessToken() not implemented — need to capture the " +
      "request that issues/refreshes the session token (see comment at top " +
      "of lib/adapters/membersports.ts)."
  );
}

async function fetchOneDate(
  golfClubId: number,
  golfCourseId: number,
  date: string,
  token: string
): Promise<RawTeeTimeBucket[]> {
  const resp = await fetch(`${API_BASE}/golfclubs/onlineBookingTeeTimes`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
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

function toNormalized(
  bucket: RawTeeTimeBucket,
  date: string,
  fallbackBookingUrl: string
): NormalizedTeeTime[] {
  const time = formatTeeTime(bucket.teeTime);

  return bucket.items
    .filter((item) => !item.bookingNotAllowed)
    .map((item) => ({
      date,
      time,
      // Observed: holesRequirementTypeId 1 -> 9-hole rate (half the price
      // of the 18-hole rate), 0 -> 18-hole rate. Confirmed across both
      // front- and back-nine-start slots in the captured sample; worth
      // re-checking against more courses since it's inferred, not
      // documented by MemberSports.
      holes: item.holesRequirementTypeId === 1 ? 9 : 18,
      // MemberSports' own field for "how many more can book here" — in
      // the captured sample every slot read 0 (that date/course was
      // apparently near fully booked), so this mapping hasn't yet been
      // seen producing a nonzero value. Re-verify against an obviously
      // open day before trusting this in the UI.
      playersOpen: item.availableCount,
      price: Math.round(item.price * 100), // dollars -> cents
      bookingUrl: fallbackBookingUrl, // no slot-level deep link captured yet
    }));
}

export const memberSportsAdapter: TeeTimeAdapter = {
  platform: "MEMBERSPORTS",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const { golfClubId, golfCourseId } = parseCourseIds(course.externalId);
    const token = await getAccessToken();

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const results: NormalizedTeeTime[] = [];
    for (const date of dates) {
      const buckets = await fetchOneDate(golfClubId, golfCourseId, date, token);
      for (const bucket of buckets) {
        results.push(...toNormalized(bucket, date, course.bookingUrl));
      }
    }
    return results;
  },
};
