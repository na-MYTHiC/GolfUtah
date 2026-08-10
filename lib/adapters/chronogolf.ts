import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * Chronogolf (Lightspeed Golf) adapter.
 *
 * NOT WIRED UP YET. Chronogolf is what you're on when a course's own site
 * routes checkout to chronogolf.com / lightspeedhq.com. Their public
 * widget (see: golf-support.lightspeedhq.com docs on embedding the
 * booking widget) calls a JSON API to list availability per club/date.
 *
 * To wire this up:
 *  1. Open a Utah course's Chronogolf booking widget (e.g.
 *     chronogolf.com/club/<club-slug>), pick a date, and inspect the
 *     Network tab for the availability request.
 *  2. Store the club slug/id as Course.externalId.
 *  3. Replace the body below with the real fetch + response mapping.
 */
export const chronogolfAdapter: TeeTimeAdapter = {
  platform: "CHRONOGOLF",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    throw new Error(
      `chronogolfAdapter.fetchTeeTimes not implemented yet (course=${course.name}, ` +
        `externalId=${course.externalId}, range=${range.from}..${range.to}). ` +
        `See the comment at the top of lib/adapters/chronogolf.ts.`
    );
  },
};
