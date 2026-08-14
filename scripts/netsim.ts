/**
 * A fake set of booking platforms, so the fetch pipeline can be timed
 * without touching anyone's real tee sheet.
 *
 * The sandbox this was written in can't reach the booking systems at
 * all, and even where it could, tuning concurrency by firing real
 * requests at golf courses is not a reasonable way to find a number. So
 * this replaces `fetch` and leaves everything else — the real adapters,
 * the real limiter, the real scheduling — running as shipped.
 *
 *   npm run simulate -- --days 10 --fresh 0-9 --out /tmp/sim
 *
 * Env:
 *   SLOW_HOST=membersports   make one host hang, to exercise the
 *                            per-request timeout and --budget
 *
 * It honours the caller's AbortSignal, which matters: without that the
 * timeouts under test are no-ops and a hung host looks survivable when
 * it isn't. That was a real bug in the first version of this file, and
 * it hid the fact that retrying a timeout was costing 75s where it
 * should have cost 25.
 *
 * The latencies below are estimates, not measurements — nothing here can
 * observe the real ones. They're for comparing *strategies* against each
 * other, which they're adequate for; don't read the absolute seconds as
 * a prediction of a real run.
 */
const LATENCY: Record<string, number> = {
  "foreupsoftware.com": 700,
  "chronogolf.com": 450,
  "membersports.com": 550,
  "kenna.io": 400,
};
const SLOW = process.env.SLOW_HOST ?? "";

let calls = 0;
const perHost = new Map<string, number>();
let peak = 0;
const inflight = new Map<string, number>();
const peakPerHost = new Map<string, number>();

const real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  // Reads of our own published site are not part of the simulation.
  if (url.includes("github.io") || url.includes("127.0.0.1")) return real(input as RequestInfo, init);

  const host = Object.keys(LATENCY).find((h) => url.includes(h)) ?? "other";
  calls++;
  perHost.set(host, (perHost.get(host) ?? 0) + 1);

  const n = (inflight.get(host) ?? 0) + 1;
  inflight.set(host, n);
  peakPerHost.set(host, Math.max(peakPerHost.get(host) ?? 0, n));
  peak = Math.max(peak, [...inflight.values()].reduce((a, b) => a + b, 0));

  const base = LATENCY[host] ?? 300;
  const wait = SLOW && url.includes(SLOW) ? 60_000 : base * (0.7 + Math.random() * 0.6);
  // Honour the caller's AbortSignal, or the timeout under test is a
  // no-op and a hung host looks survivable when it isn't.
  const signal = init?.signal ?? null;
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, wait);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        const e = new Error("aborted");
        e.name = signal.reason?.name === "TimeoutError" ? "TimeoutError" : "AbortError";
        reject(e);
      });
    });
  } finally {
    inflight.set(host, (inflight.get(host) ?? 1) - 1);
  }

  // ForeUp's session page: HTML plus a Set-Cookie.
  if (url.includes("foreupsoftware.com/index.php/booking/")) {
    return new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html", "set-cookie": "PHPSESSID=sim; path=/" },
    });
  }
  if (url.includes("chronogolf.com")) {
    return new Response("[]", { status: 200, headers: { "content-type": "application/json", total: "0", "per-page": "24" } });
  }
  if (url.includes("membersports.com")) {
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("kenna.io")) {
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

process.on("exit", () => {
  console.log(`\n--- simulated network ---`);
  console.log(`requests: ${calls}`);
  for (const [h, n] of [...perHost].sort()) {
    console.log(`  ${h.padEnd(24)} ${String(n).padStart(4)}  peak concurrent ${peakPerHost.get(h)}`);
  }
  console.log(`peak concurrent, all hosts: ${peak}`);
});
