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
 * Fetch with a timeout, bounded retries, and a user-agent.
 *
 * Resolves with the Response on any non-retryable status — callers still
 * check `resp.ok` themselves, because what a 404 means is the adapter's
 * business, not this file's. Throws only when every attempt failed.
 */
export async function politeFetch(url: string, init: PoliteInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, label = "request", ...rest } = init;

  let lastError: Error | null = null;
  let timeouts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));

    try {
      const resp = await fetch(url, {
        ...rest,
        headers: { "user-agent": USER_AGENT, ...(rest.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!isTransient(resp.status) || attempt === retries) return resp;

      // Told how long to wait, and it's a wait worth taking.
      const asked = retryAfterMs(resp);
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
