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
 *
 * ---
 *
 * SECOND PASS. The first run came back split: both GETs answered on the
 * app id alone, and booking-times — the only one that returns tee times
 * — refused all four attempts with HTTP 400.
 *
 * 400 is the interesting part. A refused reCAPTCHA is normally 403, and
 * 400 means "bad request", which would usually point at the body. It
 * doesn't here: the capture's body is
 *
 *   {"golfCourseId":16515,"subCourseId":null,"dateFrom":"2026-08-17","appId":23}
 *
 * and that is exactly, field for field, what the first pass sent. So a
 * wrong shape is already ruled out, and the 28-byte reply is the only
 * thing left that can say why. The first pass measured its length and
 * threw it away, which is the one mistake worth not repeating: 28 bytes
 * is a sentence, and the junk token drew a *different* sentence at 48.
 *
 * This pass therefore prints every failure body verbatim, and varies
 * the two things the capture can't rule out on its own:
 *
 *   - the date. The first pass guessed today+2; booking-dates says
 *     which days the course actually sells, so ask it and use one.
 *   - the body, in case a field is conditionally required (the schedule
 *     id booking-schedule hands back is the obvious candidate).
 *
 * If every variant draws the same message and that message names the
 * token, the answer is no and this file is the reason why.
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

/**
 * Every refusal, printed.
 *
 * The first pass reported "HTTP 400, 28 bytes" and dropped the 28 bytes,
 * which is where the answer was. Bodies at this size are error messages;
 * they are worth reading in full, and the truncation is only here so a
 * stray HTML error page doesn't fill the terminal.
 */
function showFailure(status: number, text: string): void {
  const body = text.trim();
  if (body) console.log(`    body: ${body.length > 400 ? `${body.slice(0, 400)}…` : body}`);
  // 403 would be the plain "your token was checked and rejected". 400
  // says bad request, which normally means the body — except the body
  // here is the captured one, so a 400 that repeats across every variant
  // is the server declining to be specific about the token.
  if (status === 403) console.log(`    -> 403, the token is verified`);
}

/** Collects every attempt so failures can be compared, not just counted. */
interface Outcome {
  label: string;
  status: number;
  text: string;
}

async function tryEndpoint(
  label: string,
  action: string,
  appId: string,
  run: (headers: Record<string, string>) => Promise<Response>,
  outcomes?: Outcome[]
): Promise<unknown | null> {
  console.log(`\n${label}`);
  for (const attempt of attempts(appId, action)) {
    try {
      const resp = await run(attempt.headers);
      const text = await resp.text();
      console.log(`  ${attempt.label.padEnd(18)} HTTP ${resp.status}, ${text.length} bytes`);
      outcomes?.push({ label: attempt.label, status: resp.status, text });

      if (resp.ok && text.length > 2) {
        try {
          return JSON.parse(text);
        } catch {
          console.log(`    (not JSON: ${text.slice(0, 100)})`);
        }
      }
      showFailure(resp.status, text);
    } catch (err) {
      console.log(`  ${attempt.label.padEnd(18)} failed: ${(err as Error).message}`);
    }
  }
  return null;
}

/**
 * The first date booking-dates offers that hasn't already happened.
 *
 * Not `data[0]`. The list starts in the past — a run on the 16th got
 * 2026-08-15 as its first entry — and feeding booking-times a past date
 * would draw a 400 indistinguishable from the one this script exists to
 * explain. Utah dates against a UTC clock, because the app's whole
 * notion of "today" is America/Denver.
 */
function firstBookableDate(dates: unknown): string | null {
  const rows = (dates as { data?: { date?: string }[] } | null)?.data;
  if (!Array.isArray(rows)) return null;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const valid = rows
    .map((row) => (typeof row?.date === "string" ? row.date.slice(0, 10) : ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  return valid.find((d) => d >= today) ?? valid[0] ?? null;
}

/**
 * Body shapes for booking-times, cheapest hypothesis first.
 *
 * The first is the capture, unchanged — it is the control, and it
 * failing again is itself a result. The rest exist because the capture
 * can't rule them out: a field can be required only under conditions
 * the capture happened not to be in.
 */
function bodyVariants(courseId: number, appId: number, date: string, scheduleId: number | null) {
  const base = { golfCourseId: courseId, subCourseId: null, dateFrom: date, appId };
  const variants: { label: string; body: Record<string, unknown> }[] = [
    { label: "as captured", body: base },
    { label: "no subCourseId", body: { golfCourseId: courseId, dateFrom: date, appId } },
    { label: "with dateTo", body: { ...base, dateTo: date } },
    { label: "midnight datetime", body: { ...base, dateFrom: `${date}T00:00:00` } },
  ];
  // booking-schedule hands back an id; if booking-times wants to be told
  // which schedule it is reading, that's the number it would want.
  if (scheduleId != null) {
    variants.push({ label: "with scheduleId", body: { ...base, scheduleId } });
  }
  return variants;
}

async function main() {
  const courseId = arg("course", "16515");
  const appId = arg("app", "23");

  const guess = new Date();
  guess.setDate(guess.getDate() + 2);
  let iso = guess.toISOString().slice(0, 10);

  console.log(`TenFore probe — golfCourseId ${courseId}, appId ${appId}`);
  console.log("Trying each endpoint without a reCAPTCHA token, and printing refusals.\n");

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

  // Prefer a date the course says it sells over one this script invented.
  // A 400 for an out-of-range date would look exactly like a 400 for a
  // bad body, and that ambiguity is cheap to remove.
  const real = firstBookableDate(dates);
  if (real) {
    console.log(`\n  using ${real} from booking-dates (was guessing ${iso})`);
    iso = real;
  }

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
  const scheduleId = (schedule as { data?: { id?: number } } | null)?.data?.id ?? null;

  // The headers made no difference last time — all four drew the same
  // 400 — so vary the body under the most honest one rather than
  // running a 4x5 matrix that says the same thing twenty times.
  const header = attempts(appId, "bookingenginev4_booking_times")[0];
  const failures: Outcome[] = [];
  let times: unknown = null;

  console.log("\nbooking-times (POST) — body variants, app id only");
  for (const variant of bodyVariants(Number(courseId), Number(appId), iso, scheduleId)) {
    try {
      const resp = await fetch(`${API}/booking-times`, {
        method: "POST",
        headers: { ...header.headers, "content-type": "application/json" },
        body: JSON.stringify(variant.body),
        signal: AbortSignal.timeout(25_000),
      });
      const text = await resp.text();
      console.log(`  ${variant.label.padEnd(18)} HTTP ${resp.status}, ${text.length} bytes`);
      failures.push({ label: variant.label, status: resp.status, text });

      if (resp.ok && text.length > 2) {
        try {
          times = JSON.parse(text);
          console.log(`    -> answered. The token is decoration on this endpoint too.`);
          break;
        } catch {
          console.log(`    (not JSON: ${text.slice(0, 100)})`);
        }
      } else {
        showFailure(resp.status, text);
      }
    } catch (err) {
      console.log(`  ${variant.label.padEnd(18)} failed: ${(err as Error).message}`);
    }
  }

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

  // The verdict, stated rather than left to be inferred from a wall of
  // HTTP codes — booking-times is the only endpoint that matters, since
  // the other two return metadata a golfer can't book.
  if (times == null) {
    const distinct = new Set(failures.map((f) => f.text.trim()));
    console.log("booking-times refused every body variant, including the captured one.");
    if (distinct.size === 1) {
      console.log("Every variant drew the identical reply, so the body is not what it");
      console.log("objects to — the request is being rejected before anyone reads it.");
    } else {
      console.log(`${distinct.size} different replies across ${failures.length} variants —`);
      console.log("the body does change the answer, so this is worth another pass.");
    }
    console.log("\nRead the bodies above. If they name the token, TenFore joins TeeRocket:");
    console.log("reachable only with a real browser per refresh, which is not worth it");
    console.log("for one course. If they name a field, that field is the next variant.");
  }
}

main().catch((err) => {
  console.error("tenfore:probe failed:", err);
  process.exitCode = 1;
});
