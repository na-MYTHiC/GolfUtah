import type { Course } from "@prisma/client";

/**
 * A single normalized tee time slot, in GolfUtah's canonical shape.
 * Every adapter's job is to translate whatever its platform returns into
 * this shape — the rest of the app never needs to know which platform a
 * course runs on.
 */
export interface NormalizedTeeTime {
  date: string; // "YYYY-MM-DD"
  time: string; // course-local, "HH:mm" 24h
  holes: 9 | 18;
  playersOpen: number;
  price?: number; // cents
  cartIncluded?: boolean;
  /**
   * Which nine the round starts on ("Front" / "Back"), when the platform
   * says. Two slots can share a time and hole count while starting on
   * different sides at different prices, so without this they look like
   * duplicates.
   */
  side?: string;
  bookingUrl: string; // deep link to this exact slot when available
}

/**
 * Implement one of these per booking platform (ForeUp, Chronogolf,
 * MemberSports, ...). The worker (scripts/poll.ts) calls `fetchTeeTimes`
 * for every active Course on a schedule and upserts the results.
 *
 * Two implementation strategies, pick per platform:
 *  - Direct API call: reverse-engineer the JSON endpoint the platform's own
 *    booking widget calls (open the course's booking page, watch the
 *    Network tab while changing dates) and hit it with `fetch`. Faster,
 *    cheaper, and less fragile than rendering the page — prefer this.
 *  - Browser automation: only when the platform requires a real session
 *    (e.g. member-rate times behind a login) — use Playwright
 *    (lib/adapters/browser.ts) to drive an actual page.
 */
export interface TeeTimeAdapter {
  platform: Course["platform"];

  /**
   * Fetch currently available tee times for one course, for the given
   * date range (inclusive). Should throw on hard failures (network,
   * auth) rather than silently returning []; the worker decides how to
   * log/retry.
   */
  fetchTeeTimes(
    course: Course,
    range: { from: string; to: string } // "YYYY-MM-DD"
  ): Promise<NormalizedTeeTime[]>;
}
