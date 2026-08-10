import type { TeeTimeAdapter, NormalizedTeeTime } from "./types";

/**
 * ForeUp adapter.
 *
 * NOT WIRED UP YET. ForeUp powers most municipal/public Utah courses'
 * booking widgets. Their booking pages call an internal JSON endpoint
 * (historically something like `foreupsoftware.com/index.php/api/booking/times`
 * with `schedule_id`, `date`, `time`, `holes` query params) to populate the
 * tee sheet — but the exact shape drifts, so don't hardcode this comment's
 * URL without verifying it first.
 *
 * To wire this up for real:
 *  1. Open a Utah course's ForeUp booking page (many embed a ForeUp widget
 *     directly, others route to foreupsoftware.com).
 *  2. Open devtools -> Network, pick a date, and find the XHR/fetch call
 *     that returns the tee sheet as JSON.
 *  3. Note the request URL, required headers/params (schedule_id is the
 *     course identifier — store it as Course.externalId), and response
 *     shape.
 *  4. Replace the body below with a `fetch()` to that endpoint and map its
 *     response into NormalizedTeeTime[].
 *  5. If a course's rates require login, this adapter will need a
 *     Playwright-driven session instead of a bare fetch — see
 *     lib/adapters/browser.ts for the shared helper once that's needed.
 */
export const foreupAdapter: TeeTimeAdapter = {
  platform: "FOREUP",

  async fetchTeeTimes(course, range): Promise<NormalizedTeeTime[]> {
    throw new Error(
      `foreupAdapter.fetchTeeTimes not implemented yet (course=${course.name}, ` +
        `externalId=${course.externalId}, range=${range.from}..${range.to}). ` +
        `See the comment at the top of lib/adapters/foreup.ts.`
    );
  },
};
