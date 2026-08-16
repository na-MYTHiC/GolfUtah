/**
 * Checks that politeFetch actually spaces its requests, and that a 429
 * makes it slower rather than louder.
 *
 * This exists because the bug it guards against was invisible. The
 * build reported "success" while nineteen Chronogolf courses — every
 * Salt Lake City municipal among them — returned nothing for seven of
 * the ten days, every run, for as long as the platform had been seeded.
 * The only symptom was a count in a log line nobody had reason to read.
 *
 * A rate limiter that silently doesn't limit looks exactly like one that
 * works, so the spacing is measured rather than assumed.
 *
 *   npx tsx scripts/test-pacing.ts
 */

import { pacingReport, politeFetch, resetPacing } from "../lib/adapters/http";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Records when each request arrived, and answers however the test says. */
function stubFetch(reply: (n: number) => { status: number; headers?: Record<string, string> }) {
  const at: number[] = [];
  const original = globalThis.fetch;
  let n = 0;

  globalThis.fetch = (async () => {
    at.push(Date.now());
    const { status, headers } = reply(n++);
    return new Response("{}", { status, headers });
  }) as typeof fetch;

  return { at, restore: () => void (globalThis.fetch = original) };
}

/** Gaps between consecutive arrivals. */
function gaps(at: number[]): number[] {
  return at.slice(1).map((t, i) => t - at[i]);
}

async function spacesConcurrentRequests(): Promise<void> {
  resetPacing();
  const stub = stubFetch(() => ({ status: 200 }));

  // Five at once, the way the build's workers arrive. The interval for
  // an unlisted host is 100ms, so five requests should span ~400ms.
  const started = Date.now();
  await Promise.all(
    Array.from({ length: 5 }, () => politeFetch("https://example.test/tee-times", { retries: 0 }))
  );
  const elapsed = Date.now() - started;
  stub.restore();

  const spacing = gaps(stub.at);
  check(
    "five concurrent requests are spaced, not simultaneous",
    elapsed >= 350,
    `${elapsed}ms for 5 (gaps: ${spacing.join(", ")}ms)`
  );
  check(
    "no two requests land in the same instant",
    spacing.every((g) => g >= 80),
    `min gap ${Math.min(...spacing)}ms`
  );
}

async function widensAfter429(): Promise<void> {
  resetPacing();
  // First call 429s, everything after is fine. Retry-After is short so
  // the test doesn't sit through the 5s default cooldown.
  const stub = stubFetch((n) => (n === 0 ? { status: 429, headers: { "retry-after": "0" } } : { status: 200 }));

  await politeFetch("https://throttled.test/tee-times", { retries: 1 });
  stub.restore();

  const [entry] = pacingReport().filter((h) => h.host === "throttled.test");
  check(
    "a 429 widens the host's interval",
    entry?.intervalMs === 200,
    `interval is now ${entry?.intervalMs}ms (was 100ms)`
  );
}

/**
 * The bug that shipped in v61 and cost a production run.
 *
 * Five workers hit the wall in the same instant, each doubled the
 * interval, and 300ms became 9600ms — clamped to the cap — from a
 * single throttling. The log said "now 2000ms apart" and 96 course-days
 * were skipped for missing the deadline.
 *
 * Refusals inside one episode must widen the interval once.
 */
async function concurrentRefusalsWidenOnce(): Promise<void> {
  resetPacing();
  const stub = stubFetch(() => ({ status: 429, headers: { "retry-after": "0" } }));

  await Promise.all(
    Array.from({ length: 5 }, () =>
      politeFetch("https://swarm.test/tee-times", { retries: 0 }).catch(() => {})
    )
  );
  stub.restore();

  const [entry] = pacingReport().filter((h) => h.host === "swarm.test");
  check(
    "five simultaneous refusals widen the interval once, not five times",
    entry?.intervalMs === 200,
    `interval ${entry?.intervalMs}ms after ${entry?.refusals} refusals (5x doubling would be 2000+)`
  );
}

async function neverExceedsTheCap(): Promise<void> {
  resetPacing();
  const stub = stubFetch(() => ({ status: 429, headers: { "retry-after": "0" } }));

  // Episodes well apart, so each one is allowed to widen.
  for (let i = 0; i < 6; i++) {
    await politeFetch("https://relentless.test/tee-times", { retries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3_100));
  }
  stub.restore();

  const [entry] = pacingReport().filter((h) => h.host === "relentless.test");
  // 100 -> 200 -> 400 -> 800 -> 1600, clamped to the 1200ms cap.
  check(
    "the interval stops at the cap rather than growing without bound",
    entry?.intervalMs === 1_200,
    `interval ${entry?.intervalMs}ms after ${entry?.refusals} refusals`
  );
}

async function chronogolfStartsWider(): Promise<void> {
  resetPacing();
  const stub = stubFetch(() => ({ status: 200 }));
  await politeFetch("https://www.chronogolf.com/marketplace/clubs/1/teetimes", { retries: 0 });
  stub.restore();

  const [entry] = pacingReport().filter((h) => h.host === "www.chronogolf.com");
  check(
    "chronogolf starts at its measured 600ms",
    entry?.intervalMs === 600,
    `interval ${entry?.intervalMs}ms`
  );
}

async function nonThrottledStatusLeavesPacingAlone(): Promise<void> {
  resetPacing();
  // A 404 is an answer, not a complaint about rate.
  const stub = stubFetch(() => ({ status: 404 }));
  await politeFetch("https://calm.test/tee-times", { retries: 0 });
  stub.restore();

  const [entry] = pacingReport().filter((h) => h.host === "calm.test");
  check("a 404 does not widen the interval", entry?.intervalMs === 100, `interval ${entry?.intervalMs}ms`);
}

async function main() {
  await spacesConcurrentRequests();
  await widensAfter429();
  await concurrentRefusalsWidenOnce();
  await neverExceedsTheCap();
  await chronogolfStartsWider();
  await nonThrottledStatusLeavesPacingAlone();

  console.log("");
  if (failures) {
    console.log(`${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("All pacing checks passed.");
  }
}

main().catch((err) => {
  console.error("test-pacing failed:", err);
  process.exitCode = 1;
});
