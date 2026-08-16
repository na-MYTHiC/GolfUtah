/**
 * Can TenFore Golf be read without a browser?
 *
 * The Ranches (fox.tenfore.golf/theranches) runs on TenFore, and a
 * capture gives three clean endpoints on swan.tenfore.golf:
 *
 *   GET  /api/BookingEngineV4/booking-dates?golfCourseId=16515
 *   GET  /api/BookingEngineV4/booking-schedule?golfCourseId=16515&date=&appId=23
 *   POST /api/BookingEngineV4/booking-times   {golfCourseId, dateFrom, appId}
 *
 * THE PROBLEM, AND WHY IT MIGHT NOT BE ONE. Every request carries an
 * `x-recaptcha-token` — a reCAPTCHA v3 token, minted by Google's script
 * inside the page, scoped to an action name and valid for about two
 * minutes. A scheduled build cannot produce one: it would have to load
 * the site, run Google's JS and hold a real browser open on every
 * refresh, which is a far more expensive adapter than the five here now.
 *
 * But sending a token and *verifying* it are different things, and this
 * repo has been wrong about that before. GolfPay's capture carried a
 * Laravel session and a CSRF header that looked mandatory; the endpoint
 * answered cold and the adapter is trivial as a result. So this asks.
 *
 *   npm run tenfore:probe
 *   npm run tenfore:probe -- --course 16515 --app 23
 *
 * Four attempts per endpoint, from most to least honest:
 *   1. nothing but the app id
 *   2. an empty token
 *   3. a junk token
 *   4. the action header without a token
 *
 * If any of those answers, the token is decoration and an adapter is
 * cheap. If all four are refused, TenFore belongs with TeeRocket:
 * technically reachable, practically not, and worth saying so plainly
 * rather than half-building something that breaks on the first run.
 */

import { writeFileSync } from "node:fs";

const API = "https://swan.tenfore.golf/api/BookingEngineV4";
const ORIGIN = "https://fox.tenfore.golf";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

interface Attempt {
  label: string;
  headers: Record<string, string>;
}

function attempts(appId: string, action: string): Attempt[] {
  const base = {
    accept: "application/json, */*",
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
    "user-agent": UA,
    "x-tenfore-appid": appId,
  };
  return [
    { label: "app id only", headers: base },
    { label: "empty token", headers: { ...base, "x-recaptcha-action": action, "x-recaptcha-token": "" } },
    { label: "junk token", headers: { ...base, "x-recaptcha-action": action, "x-recaptcha-token": "not-a-real-token" } },
    { label: "action, no token", headers: { ...base, "x-recaptcha-action": action } },
  ];
}

/** Prints the shape without dumping a whole tee sheet. */
function describe(value: unknown, depth = 0): void {
  const pad = "    ".repeat(depth + 1);
  if (Array.isArray(value)) {
    console.log(`${pad}array of ${value.length}`);
    if (value.length && depth < 2) describe(value[0], depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v)) {
        console.log(`${pad}${k}: array(${v.length})`);
        if (v.length && depth < 2) describe(v[0], depth + 1);
      } else if (v && typeof v === "object") {
        console.log(`${pad}${k}: object`);
        if (depth < 2) describe(v, depth + 1);
      } else {
        console.log(`${pad}${k}: ${typeof v} = ${JSON.stringify(v)?.slice(0, 70)}`);
      }
    }
  }
}

async function tryEndpoint(
  label: string,
  action: string,
  appId: string,
  run: (headers: Record<string, string>) => Promise<Response>
): Promise<unknown | null> {
  console.log(`\n${label}`);
  for (const attempt of attempts(appId, action)) {
    try {
      const resp = await run(attempt.headers);
      const text = await resp.text();
      console.log(`  ${attempt.label.padEnd(18)} HTTP ${resp.status}, ${text.length} bytes`);

      if (resp.ok && text.length > 2) {
        try {
          return JSON.parse(text);
        } catch {
          console.log(`    (not JSON: ${text.slice(0, 100)})`);
        }
      }
      // 403 here almost certainly means the token really is checked.
      if (resp.status === 403) console.log(`    -> 403, the token is verified`);
    } catch (err) {
      console.log(`  ${attempt.label.padEnd(18)} failed: ${(err as Error).message}`);
    }
  }
  return null;
}

async function main() {
  const courseId = arg("course", "16515");
  const appId = arg("app", "23");

  const date = new Date();
  date.setDate(date.getDate() + 2);
  const iso = date.toISOString().slice(0, 10);

  console.log(`TenFore probe — golfCourseId ${courseId}, appId ${appId}, date ${iso}`);
  console.log("Trying each endpoint without a reCAPTCHA token.\n");

  const dates = await tryEndpoint(
    "booking-dates (which days are bookable)",
    "bookingenginev4_booking_dates",
    appId,
    (headers) =>
      fetch(`${API}/booking-dates?golfCourseId=${courseId}`, {
        headers,
        signal: AbortSignal.timeout(25_000),
      })
  );

  const schedule = await tryEndpoint(
    "booking-schedule (the day's sheet)",
    "bookingenginev4_booking_schedule",
    appId,
    (headers) =>
      fetch(`${API}/booking-schedule?golfCourseId=${courseId}&date=${iso}&appId=${appId}`, {
        headers,
        signal: AbortSignal.timeout(25_000),
      })
  );

  const times = await tryEndpoint(
    "booking-times (POST)",
    "bookingenginev4_booking_times",
    appId,
    (headers) =>
      fetch(`${API}/booking-times`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          golfCourseId: Number(courseId),
          subCourseId: null,
          dateFrom: iso,
          appId: Number(appId),
        }),
        signal: AbortSignal.timeout(25_000),
      })
  );

  const got = [
    ["booking-dates", dates],
    ["booking-schedule", schedule],
    ["booking-times", times],
  ].filter(([, v]) => v != null) as [string, unknown][];

  console.log("");
  if (got.length === 0) {
    console.log("Nothing answered without a token. The reCAPTCHA is enforced, which");
    console.log("means TenFore needs a real browser on every refresh — a different and");
    console.log("much more expensive adapter than the five here now. Worth saying so");
    console.log("plainly rather than half-building something that breaks on first run.");
    return;
  }

  console.log(`${got.length} of 3 endpoints answered without a token.\n`);
  writeFileSync("tenfore-probe.json", JSON.stringify(Object.fromEntries(got), null, 2));
  console.log("Wrote tenfore-probe.json\n");

  for (const [name, body] of got) {
    console.log(`${name}:`);
    describe(body);
    console.log("");
  }
}

main().catch((err) => {
  console.error("tenfore:probe failed:", err);
  process.exitCode = 1;
});
