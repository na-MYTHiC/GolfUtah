import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * MemberSports adapter.
 *
 * NOT WIRED UP YET. Used by some private/semi-private Utah clubs. Coverage
 * and API shape are less well-documented publicly than ForeUp/Chronogolf —
 * expect this one to more often require a logged-in Playwright session
 * rather than a bare JSON endpoint. Investigate per-course before assuming
 * a shared API shape across all MemberSports courses.
 */
export const memberSportsAdapter: TeeTimeAdapter = {
  platform: "MEMBERSPORTS",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    throw new Error(
      `memberSportsAdapter.fetchTeeTimes not implemented yet (course=${course.name}, ` +
        `externalId=${course.externalId}, range=${range.from}..${range.to}). ` +
        `See the comment at the top of lib/adapters/membersports.ts.`
    );
  },
};
