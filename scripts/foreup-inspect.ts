/**
 * Dumps what one ForeUp sheet actually returns for a day, so a
 * disagreement with the course's own page can be settled with data
 * rather than a theory.
 *
 * Written for Valley View, reported as showing a time its website
 * didn't have and as missing its 9-hole round. Two possible causes
 * looked identical from outside:
 *
 *   1. the course runs separate 9- and 18-hole schedules, and we read
 *      only one of them
 *   2. it runs one schedule, and the "18 holes / 9 holes" choice on the
 *      booking page is ForeUp's holes filter over the same sheet
 *
 * A sweep of neighbouring schedule ids found no sibling sheet, which
 * points at (2) — but "found nothing nearby" is weak evidence, and the
 * response settles it outright: every row carries `holes`, `schedule_id`
 * and `booking_class_id`.
 *
 *   npm run foreup:inspect -- 19501 1759 --class 1208
 *   npm run foreup:inspect -- 19501 1759 --class 1208 --days 3
 *   npm run foreup:inspect -- 19501 1759 --classes 1195-1235
 *
 * --classes sweeps booking classes instead of days, which is what the
 * Valley View answer turned out to need: sheet 1759 under class 1208
 * returns 18-hole rows only, 24 of them on a good day and none at all
 * on others. A course does not run like that. The rest of the sheet —
 * the nine, and the times the course's own page shows — is under a
 * class we hadn't found, and a class is a number like any other.
 *
 * Needs a machine that can reach foreupsoftware.com — or run it through
 * the Probe workflow.
 */

const BOOKING = "https://foreupsoftware.com/index.php/booking";
const TIMES = "https://foreupsoftware.com/index.php/api/booking/times";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

interface Row {
  time: string;
  holes: number | string;
  schedule_id: number;
  course_id: number;
  course_name: string;
  booking_class_id: number;
  available_spots: number;
  available_spots_9: number;
  available_spots_18: number;
  green_fee_9: number;
  green_fee_18: number;
  teesheet_side_name: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function foreupDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

/** The session the widget establishes before asking for times. */
async function session(courseId: string, scheduleId: string): Promise<string | undefined> {
  try {
    const resp = await fetch(`${BOOKING}/${courseId}/${scheduleId}`, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
      signal: AbortSignal.timeout(25_000),
    });
    const cookies = resp.headers.getSetCookie?.().map((c) => c.split(";")[0]).filter(Boolean);
    return cookies?.length ? cookies.join("; ") : undefined;
  } catch {
    return undefined;
  }
}

async function times(
  courseId: string,
  scheduleId: string,
  bookingClass: string | undefined,
  date: string,
  cookie: string | undefined
): Promise<Row[] | string> {
  const params = new URLSearchParams({
    time: "all",
    date,
    holes: "all",
    players: "0",
    schedule_id: scheduleId,
    "schedule_ids[]": scheduleId,
    specials_only: "0",
    api_key: "",
    ...(bookingClass ? { booking_class: bookingClass } : {}),
  });

  const resp = await fetch(`${TIMES}?${params}`, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "api-key": "",
      referer: `${BOOKING}/${courseId}/${scheduleId}`,
      "user-agent": UA,
      "x-fu-golfer-location": "foreup",
      "x-requested-with": "XMLHttpRequest",
      ...(cookie ? { cookie } : {}),
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!resp.ok) return `HTTP ${resp.status}`;
  const body = await resp.json();
  return Array.isArray(body) ? (body as Row[]) : `not an array: ${JSON.stringify(body).slice(0, 200)}`;
}

function tally<T>(rows: T[], of: (r: T) => string): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = of(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} x${n}`)
    .join("   ");
}

/**
 * Which booking classes this sheet answers to, and what each one shows.
 *
 * Bounded and sequential — one course's own rate classes, asked once
 * each for a single day. The point is the holes column: a class that
 * returns nines is the one the app should be seeded with.
 */
async function sweepClasses(
  courseId: string,
  scheduleId: string,
  from: number,
  to: number,
  cookie: string | undefined
): Promise<void> {
  if (to - from > 60) {
    console.error(`--classes range too wide (${to - from}); keep it under 60`);
    process.exit(1);
  }

  // Tomorrow: today's sheet is half gone by definition, and an empty
  // today would read as a dead class.
  const date = foreupDate(1);
  console.log(`Sweeping booking classes ${from}-${to} on ${date}\n`);

  for (let cls = from; cls <= to; cls++) {
    const rows = await times(courseId, scheduleId, String(cls), date, cookie);
    if (typeof rows === "string") {
      console.log(`  ${cls}   ${rows}`);
      continue;
    }
    if (rows.length === 0) continue;

    const nine = rows.filter((r) => r.available_spots_9 > 0).length;
    const eighteen = rows.filter((r) => r.available_spots_18 > 0).length;
    console.log(
      `  ${cls}   ${String(rows.length).padStart(3)} row(s)  ` +
        `holes: ${tally(rows, (r) => String(r.holes))}  ` +
        `| 9-hole rows: ${nine}, 18-hole rows: ${eighteen}  ` +
        `| ${rows[0].course_name}`
    );
  }
  console.log("\nSeed the class that shows the sheet the course's own page shows.");
}

async function main() {
  const [courseId, scheduleId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!courseId || !scheduleId) {
    console.error(
      "Usage: npm run foreup:inspect -- <courseId> <scheduleId> [--class 1208] [--days 3]\n" +
        "                                [--classes 1195-1235]"
    );
    process.exit(1);
  }
  const bookingClass = arg("class");
  const days = Number(arg("days") ?? "3");
  const classes = arg("classes");

  console.log(`ForeUp ${courseId}:${scheduleId}${bookingClass ? `:${bookingClass}` : ""}`);
  console.log(`Asking for ${days} day(s), holes=all\n`);

  const cookie = await session(courseId, scheduleId);
  console.log(cookie ? "session established" : "no session (continuing cold)");

  if (classes) {
    const m = /^(\d+)-(\d+)$/.exec(classes);
    if (!m) {
      console.error(`--classes wants a range like 1195-1235, got "${classes}"`);
      process.exit(1);
    }
    await sweepClasses(courseId, scheduleId, Number(m[1]), Number(m[2]), cookie);
    return;
  }

  for (let d = 0; d < days; d++) {
    const date = foreupDate(d);
    const rows = await times(courseId, scheduleId, bookingClass, date, cookie);

    if (typeof rows === "string") {
      console.log(`\n${date}: ${rows}`);
      continue;
    }
    if (rows.length === 0) {
      console.log(`\n${date}: EMPTY ARRAY — this install wants a booking class it didn't get`);
      continue;
    }

    console.log(`\n${date}: ${rows.length} row(s)`);
    console.log(`  holes:          ${tally(rows, (r) => String(r.holes))}`);
    console.log(`  schedule_id:    ${tally(rows, (r) => String(r.schedule_id))}`);
    console.log(`  course_id:      ${tally(rows, (r) => String(r.course_id))}`);
    console.log(`  course_name:    ${tally(rows, (r) => r.course_name)}`);
    console.log(`  booking_class:  ${tally(rows, (r) => String(r.booking_class_id))}`);
    console.log(`  side:           ${tally(rows, (r) => r.teesheet_side_name || "(none)")}`);

    // What the adapter would actually publish, and why. A 9-hole round
    // is only listed when available_spots_9 > 0, so a sheet full of
    // "9/18" rows with no nine spots publishes as 18-only — which looks
    // from outside exactly like a missing 9-hole sheet.
    const nine = rows.filter((r) => r.available_spots_9 > 0).length;
    const eighteen = rows.filter((r) => r.available_spots_18 > 0).length;
    console.log(`  bookable as 9:  ${nine} row(s)`);
    console.log(`  bookable as 18: ${eighteen} row(s)`);

    const first = rows[0];
    console.log(
      `  first row: ${first.time} holes=${first.holes} ` +
        `spots(9/18)=${first.available_spots_9}/${first.available_spots_18} ` +
        `fee(9/18)=${first.green_fee_9}/${first.green_fee_18}`
    );
  }
}

main().catch((err) => {
  console.error("foreup:inspect failed:", err);
  process.exitCode = 1;
});
