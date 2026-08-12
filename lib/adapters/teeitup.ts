import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * TeeItUp (Kenna) — confirmed against a real capture on 2026-08-12 for
 * the 16th, covering two facilities on one booking site.
 *
 * Endpoint: GET https://phx-api-be-east-1b.kenna.io/v2/tee-times
 *   ?date=YYYY-MM-DD
 *   &facilityIds=17070,17067      (comma-separated)
 *   &returnPromotedRates=true
 * Header:   x-be-alias: <operator alias>
 *
 * The alias is the operator's booking subdomain
 * (<alias>.book-v2.teeitup.golf) and the API wants it as a header. One
 * booking site fronts several facilities, so facilityIds is a list —
 * the same shape as a Chronogolf club publishing several courses.
 *
 * TIME ZONE — the one real hazard here. `teetime` is UTC with no local
 * counterpart anywhere in the response, so unlike ForeUp and Chronogolf
 * there's no local field to prefer and the conversion can't be avoided.
 * It's checked against the response's own `dayInfo`: sunrise comes back
 * as 12:38Z for August 16, which is 6:38am Mountain — right for Utah in
 * August, and six hours off, confirming the offset direction. Getting
 * this backwards would shift every time by 12 hours.
 *
 * Auth: none. No token, no cookie — only the x-be-alias header.
 */

const API = "https://phx-api-be-east-1b.kenna.io/v2/tee-times";
const BOOKING_HOST = "book-v2.teeitup.golf";

/** Utah is the only zone this app serves. */
const ZONE = "America/Denver";

interface RawRate {
  _id: number;
  name: string; // rate class, e.g. "Non-Utah Resident"
  holes: number;
  /** Party sizes bookable at this rate. */
  allowedPlayers: number[];
  /**
   * Green fee *including* cart, already in cents — 8500 is $85. Do not
   * multiply by 100: every other adapter here receives dollars and
   * converts, so this is the one that breaks the pattern.
   */
  greenFeeCart: number;
  transactionFees: number;
}

interface RawTeeTime {
  courseId: string;
  /** UTC instant. See the file header before touching this. */
  teetime: string;
  backNine: boolean;
  rates: RawRate[];
  bookedPlayers: number;
  minPlayers: number;
  /** Spots still open — 4 minus bookedPlayers on every row sampled. */
  maxPlayers: number;
}

interface RawFacility {
  courseId: string;
  teetimes: RawTeeTime[];
  totalAvailableTeetimes: number;
}

/** externalId is "<alias>:<facilityId>[,<facilityId>...]". */
function parseExternalId(externalId: string): { alias: string; facilityIds: string[] } {
  const at = externalId.indexOf(":");
  const alias = at >= 0 ? externalId.slice(0, at) : "";
  const facilityIds = (at >= 0 ? externalId.slice(at + 1) : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!alias || facilityIds.length === 0) {
    throw new Error(
      `Invalid TeeItUp externalId "${externalId}" — expected ` +
        `"<alias>:<facilityId>[,<facilityId>...]"`
    );
  }
  return { alias, facilityIds };
}

/**
 * A UTC instant as the local date and time the course would call it.
 *
 * en-CA gives ISO-shaped output, so this reads the parts back out rather
 * than doing arithmetic on an offset — which would be wrong twice a year
 * at the daylight-saving boundary, and this app publishes ten days ahead.
 */
export function toLocalDateTime(utcIso: string): { date: string; time: string } | null {
  const at = new Date(utcIso);
  if (Number.isNaN(at.getTime())) return null;

  const date = at.toLocaleDateString("en-CA", { timeZone: ZONE });
  const time = at.toLocaleTimeString("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

async function fetchOneDate(
  alias: string,
  facilityIds: string[],
  date: string
): Promise<RawFacility[]> {
  const params = new URLSearchParams({
    date,
    facilityIds: facilityIds.join(","),
    returnPromotedRates: "true",
  });

  const resp = await fetch(`${API}?${params}`, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: `https://${alias}.${BOOKING_HOST}`,
      referer: `https://${alias}.${BOOKING_HOST}/`,
      "x-be-alias": alias,
    },
  });

  if (!resp.ok) {
    throw new Error(`TeeItUp request failed: HTTP ${resp.status}`);
  }

  return resp.json();
}

/**
 * The operator's booking site for a day.
 *
 * UNVERIFIED, deliberately harmless: only the site's bare origin has
 * been seen, never one carrying a date. The date goes on as a query
 * parameter rather than a path segment for the same reason as
 * MemberSports — an unrecognised query is ignored and the golfer still
 * lands on the booking site, where a wrong path could 404.
 */
export function teeItUpBookingUrl(alias: string, date?: string): string {
  const base = `https://${alias}.${BOOKING_HOST}/`;
  return date ? `${base}?date=${date}` : base;
}

/**
 * One row per round length, priced at the cheapest rate offering it.
 *
 * A slot can carry several rates — resident and non-resident, walking
 * and riding. Emitting one row each would show the same tee time four
 * times over, so they collapse to the best price per round length. The
 * capture had a single rate ("Non-Utah Resident", $85), so the collapse
 * is untested against a multi-rate slot; the shape is what a golfer
 * wants either way.
 */
function toNormalized(raw: RawTeeTime, bookingUrl: string): NormalizedTeeTime[] {
  const local = toLocalDateTime(raw.teetime);
  if (!local) return [];

  // maxPlayers is what's left, not the slot's capacity: every row
  // sampled had bookedPlayers + maxPlayers === 4.
  const spots = Number.isFinite(raw.maxPlayers) ? raw.maxPlayers : 0;
  if (spots <= 0) return [];

  const cheapestByHoles = new Map<9 | 18, number>();
  for (const rate of raw.rates ?? []) {
    if (rate.holes !== 9 && rate.holes !== 18) continue;
    const price = rate.greenFeeCart; // already cents
    if (!Number.isFinite(price)) continue;
    const current = cheapestByHoles.get(rate.holes);
    if (current == null || price < current) cheapestByHoles.set(rate.holes, price);
  }

  return [...cheapestByHoles].map(([holes, price]) => ({
    date: local.date,
    time: local.time,
    holes,
    playersOpen: spots,
    price,
    side: raw.backNine ? "Back" : "Front",
    bookingUrl,
  }));
}

export const teeItUpAdapter: TeeTimeAdapter = {
  platform: "TEEITUP",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    const { alias, facilityIds } = parseExternalId(course.externalId);

    const dates: string[] = [];
    for (let d = new Date(range.from); d <= new Date(range.to); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const results: NormalizedTeeTime[] = [];
    for (const date of dates) {
      const bookingUrl = teeItUpBookingUrl(alias, date);
      // One request covers every facility on the site, so unlike the
      // other adapters this doesn't loop per course.
      const facilities = await fetchOneDate(alias, facilityIds, date);
      for (const facility of facilities ?? []) {
        for (const raw of facility.teetimes ?? []) {
          results.push(...toNormalized(raw, bookingUrl));
        }
      }
    }
    return results;
  },
};

/** Exported for the parser test — not part of the adapter's interface. */
export const __test = { toNormalized, parseExternalId };
