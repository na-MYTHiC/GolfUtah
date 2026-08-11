import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * Chronogolf (Lightspeed Golf) — the last unimplemented platform, and the
 * largest remaining gap: 13 Utah courses, including most of the Salt Lake
 * City and county municipals.
 *
 * WHAT'S KNOWN
 *
 * Booking pages are addressed by club slug:
 *   chronogolf.com/club/riverbend-slco
 *   chronogolf.com/club/river-oaks-golf-course-utah
 *
 * and accept these query parameters, which is enough to deep-link a
 * golfer to the right day:
 *   ?date=YYYY-MM-DD&step=teetimes&holes=&coursesIds=&deals=false&groupSize=0
 *
 * Note the date format is ISO here, unlike ForeUp's MM-DD-YYYY.
 *
 * WHAT'S MISSING
 *
 * The availability endpoint itself. A capture of tee-time.io calling
 * Chronogolf through their own proxy showed the API is addressed by
 * numeric ids, not slugs — club_id, course_id, nb_holes, date — so the
 * slug alone can't be turned into a request without first loading the
 * club page and reading the ids out of it.
 *
 * TO IMPLEMENT
 *
 * Open a club page, DevTools -> Network -> Fetch/XHR, pick a date, and
 * capture the request that returns tee times as JSON. That one capture
 * gives the endpoint path, the id parameters, and the response shape —
 * the same three things that were needed for ForeUp and MemberSports.
 *
 * Don't guess at it: this file's two predecessors each cost a round of
 * wrong data by inferring a field rather than reading one.
 */

const BASE = "https://www.chronogolf.com/club";

/** Known Utah club slugs, ready for when the adapter can use them. */
export const CHRONOGOLF_SLUGS: Record<string, string> = {
  "Riverbend Golf Course": "riverbend-slco",
  "River Oaks Golf": "river-oaks-golf-course-utah",
};

/**
 * The club's own booking page for a date. Usable today for the handoff
 * even though availability can't be read yet.
 */
export function chronogolfBookingUrl(slug: string, date?: string): string {
  const params = new URLSearchParams({ step: "teetimes", deals: "false" });
  if (date) params.set("date", date); // ISO here, unlike ForeUp
  return `${BASE}/${slug}?${params}`;
}

export const chronogolfAdapter: TeeTimeAdapter = {
  platform: "CHRONOGOLF",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    throw new Error(
      `Chronogolf adapter not implemented (course=${course.name}, ` +
        `range=${range.from}..${range.to}). Needs one DevTools capture of the ` +
        `availability request — see the comment at the top of ` +
        `lib/adapters/chronogolf.ts.`
    );
  },
};
