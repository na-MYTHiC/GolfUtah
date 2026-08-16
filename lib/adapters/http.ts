/**
 * The one place every adapter's outbound request goes through.
 *
 * WHY THIS EXISTS, in order of how much it matters.
 *
 * 1. TIMEOUTS. `fetch` has none. A booking system that accepts a
 *    connection and then never answers will hold a worker forever, and
 *    because the build runs under a job timeout, one hung socket doesn't
 *    cost one course — it costs the entire refresh, for every course, on
 *    that tick. This is the single cheapest way to stop a slow course
 *    from taking the site's data down with it.
 *
 * 2. RETRIES. A tee sheet that blips returns nothing for that course for
 *    the whole tick, and the app then shows the course as having no
 *    times — indistinguishable from booked out. One retry converts most
 *    of those into data. Only transient failures are retried: a network
 *    error, a 5xx, or a 429. A 404 or a 403 is an answer, and asking
 *    again is just noise.
 *
 * 3. BACKING OFF WHEN TOLD TO. If a platform answers 429 with a
 *    Retry-After, honouring it is the difference between being throttled
 *    and being blocked. Capped, because a server asking us to wait an
 *    hour is a server we should give up on for this tick rather than sit
 *    on a worker for.
 *
 * 4. SAYING WHO WE ARE. Three of the four adapters sent no user-agent at
 *    all, which makes this traffic anonymous and indistinguishable from
 *    something worth blocking. It refreshes every few minutes, forever;
 *    being identifiable is the polite half of that bargain, and it means
 *    a course that wants it stopped can find out how.
 *
 * 5. NOT ASKING TOO FAST. Concurrency is not rate, and confusing the two
 *    cost the app seven of its ten days on every Chronogolf course.
 *    Scaling concurrency to course count made each platform finish
 *    sooner; for a platform that answers quickly, that means the slots
 *    turn over quickly and the *rate* climbs. Chronogolf was being asked
 *    190 times in 9.8 seconds — about 19 requests a second — and
 *    answered 429 to everything after roughly the first sixty. Nineteen
 *    courses, including all six Salt Lake City municipals, listed
 *    nothing from day +3 onward, and the build called it a success.
 *
 *    So requests to a host are spaced, and the spacing adapts: a 429
 *    widens the interval for the rest of the run and pauses every worker
 *    on that host at once, rather than each retrying into the same wall.
 *    A guessed rate limit would be a guess; this lets the server say.
 */

/** Identifies the aggregator and points at it. See note 4 above. */
export const USER_AGENT =
  "GolfUtahBot/1.0 (+https://na-mythic.github.io/GolfUtah; tee-time aggregator)";

/**
 * A browser UA, for the one endpoint that needs to look like one.
 *
 * ForeUp's booking page is an HTML page meant for a browser and its
 * session handling was reverse-engineered from one; changing what it's
 * told mid-flight is a different experiment from this file's. Kept
 * here so both strings are in one place rather than the honest one
 * looking like an oversight next to the other.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export interface PoliteInit extends RequestInit {
  /** Per-attempt, not per-call: each retry gets a full one. */
  timeoutMs?: number;
  /** Extra attempts after the first. */
  retries?: number;
  /** Name used in error messages, e.g. "ForeUp". */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;

/**
 * Timeouts get one attempt, not the full retry budget.
 *
 * A refused connection or a 503 is usually a blip and asking again
 * usually works. A timeout is different: it means the host accepted us
 * and then couldn't answer, which is a host under strain — and the
 * honest reading of a retry there is that we'd be adding load to
 * something already failing. It's also the expensive failure, because
 * each attempt costs the full timeout rather than failing fast. Measured
 * against a deliberately hung host, three attempts turned a 45-second
 * budget into a 75-second run; one turns it into 25.
 */
const TIMEOUT_ATTEMPTS = 1;

/** Longest we'll sit on a worker waiting out a Retry-After. */
const MAX_RETRY_AFTER_MS = 20_000;

/** Retried: we can't tell a transient failure from these. */
function isTransient(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Seconds or an HTTP date, per RFC 9110. Returns null when absent or
 * unparseable, so the caller falls back to its own backoff.
 */
function retryAfterMs(resp: Response): number | null {
  const raw = resp.headers.get("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Exponential with full jitter. The jitter is the point: without it,
 * every course that failed against the same platform at the same moment
 * retries at the same moment, which is how a blip becomes a stampede.
 */
function backoffMs(attempt: number): number {
  return Math.random() * Math.min(4_000, 400 * 2 ** attempt);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimum gap between requests to one host, before any 429 widens it.
 *
 * 100ms is roughly what ForeUp already runs at unthrottled — 350
 * course-days in 33s — so it's deliberately not a change for the
 * platform that isn't complaining. Chronogolf starts wider because it
 * has told us, repeatedly, that 19 a second is too many.
 */
const DEFAULT_INTERVAL_MS = 100;

/**
 * 300ms for Chronogolf, and it is not the rate that avoids being
 * throttled — there isn't one.
 *
 * Four production runs, each asking 190 course-days:
 *
 *   ~19/sec   429s from roughly the 57th request on
 *   300ms     429s at request ~57, 14 of them
 *   600ms     429s at request ~57, 16 of them
 *
 * Six times slower, same place. That is a budget of requests per
 * window, not a rate, and no spacing gets under it — spacing only
 * decides how much of the run is spent discovering that. A middle run
 * looked like 600ms had solved it, on the strength of two days that
 * happened to succeed after the cooldowns; the next run at 600ms from
 * the start was refused just as early and finished worse, because
 * everything after the widening ran at 1200ms and missed the deadline.
 *
 * So the spacing exists to be polite and to stop the stampede, not to
 * dodge the limit. 300ms because it got the most days published of
 * anything tried: 61/70/70/54 courses on days +3 to +6, against
 * 59/62/50/50 at 600ms.
 *
 * What actually fixes the missing tee times is not here — it's the
 * per-course fallback in build-data.ts, which serves the last good
 * answer for a course this run couldn't reach.
 */
const INTERVAL_BY_HOST: [pattern: RegExp, ms: number][] = [[/chronogolf\.com$/, 300]];

/**
 * A 429 doubles the interval, up to here.
 *
 * One step past the starting interval, and no more.
 *
 * Going slower does not stop Chronogolf refusing — four runs say the
 * refusals arrive at the same request count at any speed — so a wide
 * cap buys nothing and costs the deadline. 2000ms made a run take 163s
 * and skip 96 course-days; 1200ms made one take 159s and skip 102. Both
 * traded one kind of missing data for another, and both were worse than
 * being refused and falling back to the last good answer.
 */
const MAX_INTERVAL_MS = 600;

/** How long every worker on a host pauses when one of them is throttled. */
const THROTTLE_COOLDOWN_MS = 5_000;

/**
 * Refusals this close together are one event, and widen the interval
 * once between them.
 *
 * Without this the limiter overreacts by exactly the concurrency: five
 * workers hit the wall in the same instant, each doubles, and 300ms
 * becomes 9600ms from a single throttling. That happened on the first
 * production run — the log said "now 2000ms apart", the cap, reached
 * immediately rather than converged to. Widening per *episode* lets it
 * step 300 -> 600 and find the rate instead of overshooting to the
 * slowest thing it's allowed to be.
 */
const THROTTLE_EPISODE_MS = 3_000;

interface HostState {
  /** Current minimum spacing, widened by each 429. */
  intervalMs: number;
  /** What it started at, so a caller can tell "widened" from "wide". */
  initialMs: number;
  /** Earliest moment the next request to this host may start. */
  nextAt: number;
  /** When the interval last grew, so one episode widens it once. */
  widenedAt: number;
  /** Refusals seen, for the build to report. */
  refusals: number;
}

const hosts = new Map<string, HostState>();

function stateFor(url: string): HostState | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  const existing = hosts.get(host);
  if (existing) return existing;

  const match = INTERVAL_BY_HOST.find(([pattern]) => pattern.test(host));
  const start = match?.[1] ?? DEFAULT_INTERVAL_MS;
  const fresh: HostState = {
    intervalMs: start,
    initialMs: start,
    nextAt: 0,
    widenedAt: 0,
    refusals: 0,
  };
  hosts.set(host, fresh);
  return fresh;
}

/**
 * Claims the next slot in this host's queue and waits for it.
 *
 * Reserving `nextAt` before sleeping is what makes this work under
 * concurrency: five workers arriving together take five consecutive
 * slots rather than all seeing the same "now" and firing at once.
 */
async function takeSlot(state: HostState | null): Promise<void> {
  if (!state) return;
  const now = Date.now();
  const at = Math.max(now, state.nextAt);
  state.nextAt = at + state.intervalMs;
  if (at > now) await sleep(at - now);
}

/**
 * The server said we're going too fast. Believe it.
 *
 * Widening the interval is the part that lasts: the cooldown alone
 * would drain and then let the same rate resume, which is how the
 * retries were already failing.
 */
function throttled(state: HostState | null, retryAfter: number | null): void {
  if (!state) return;
  const now = Date.now();
  state.refusals++;

  // Every refusal pauses the host — that part is per-request, because
  // each one is a worker that needs to stop. Only the first of an
  // episode widens the interval.
  if (now - state.widenedAt > THROTTLE_EPISODE_MS) {
    state.intervalMs = Math.min(MAX_INTERVAL_MS, state.intervalMs * 2);
    state.widenedAt = now;
  }

  const pause = Math.min(retryAfter ?? THROTTLE_COOLDOWN_MS, MAX_RETRY_AFTER_MS);
  state.nextAt = Math.max(state.nextAt, now + pause);
}

/** Per-host pacing, for the build to report. Test seam too. */
export function pacingReport(): {
  host: string;
  intervalMs: number;
  initialMs: number;
  refusals: number;
}[] {
  return [...hosts]
    .map(([host, s]) => ({
      host,
      intervalMs: s.intervalMs,
      initialMs: s.initialMs,
      refusals: s.refusals,
    }))
    .sort((a, b) => b.intervalMs - a.intervalMs);
}

/** Only for tests — the map is module state and would leak between them. */
export function resetPacing(): void {
  hosts.clear();
}

/**
 * Fetch with a timeout, bounded retries, and a user-agent.
 *
 * Resolves with the Response on any non-retryable status — callers still
 * check `resp.ok` themselves, because what a 404 means is the adapter's
 * business, not this file's. Throws only when every attempt failed.
 */
export async function politeFetch(url: string, init: PoliteInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, label = "request", ...rest } = init;

  const state = stateFor(url);
  let lastError: Error | null = null;
  let timeouts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    await takeSlot(state);

    try {
      const resp = await fetch(url, {
        ...rest,
        headers: { "user-agent": USER_AGENT, ...(rest.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Slow down for the rest of the run whether or not this attempt is
      // the last — the next course in the queue is about to ask the same
      // host, and it's the one that benefits.
      const asked = retryAfterMs(resp);
      if (resp.status === 429) throttled(state, asked);

      if (!isTransient(resp.status) || attempt === retries) return resp;

      // Told how long to wait, and it's a wait worth taking.
      if (asked != null) {
        if (asked > MAX_RETRY_AFTER_MS) return resp;
        await sleep(asked);
      }

      lastError = new Error(`${label} HTTP ${resp.status}`);
    } catch (err) {
      // AbortSignal.timeout aborts with a TimeoutError; say so plainly,
      // because "the course took too long" and "the course refused" want
      // different responses from whoever reads the log.
      const e = err as Error;
      const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
      lastError = timedOut
        ? new Error(`${label} timed out after ${timeoutMs}ms`)
        : new Error(`${label} failed: ${e.message}`);

      if (timedOut && ++timeouts > TIMEOUT_ATTEMPTS) throw lastError;
      if (attempt === retries) throw lastError;
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}
