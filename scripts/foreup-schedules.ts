/**
 * Lists every tee sheet under one ForeUp course account, and asks each
 * one what course it is.
 *
 * WHY THIS EXISTS. El Monte and Mount Ogden are both Ogden City courses
 * and both live under ForeUp course id 19197. They're separate tee
 * sheets — different `schedule_id` — but Ogden City's Mount Ogden page
 * links to El Monte's booking page, so following the links from the
 * city's website gets you the same sheet twice. Seeding both from that
 * would show identical times under two course names, which is worse than
 * not listing them.
 *
 * The way out is that ForeUp's own response settles it. Every row of the
 * times endpoint carries `course_name` and `schedule_id`, so once a
 * schedule id is known, the platform will say which course it belongs
 * to. No guessing, no reading a municipal website's mind.
 *
 *   npm run foreup:schedules -- 19197
 *   npm run foreup:schedules -- 19197 --headed
 *   npm run foreup:schedules -- https://foreupsoftware.com/index.php/booking/19197/1258
 *
 * Needs a machine that can reach foreupsoftware.com. Prints a
 * ready-to-paste seed entry for each sheet it can name.
 *
 * This generalises past Ogden: any city running several courses on one
 * ForeUp account has the same shape.
 */

import { chromium, type Page } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const BOOKING = "https://foreupsoftware.com/index.php/booking";
const TIMES = "https://foreupsoftware.com/index.php/api/booking/times";

const NAV_TIMEOUT_MS = 45_000;
const SETTLE_MS = 4_000;

interface Sheet {
  scheduleId: number;
  /** What ForeUp calls it, once a times response has named it. */
  courseName?: string;
  bookingClassId?: number;
  slots?: number;
  note?: string;
}

function parseTarget(arg: string): { courseId: number; scheduleId?: number } {
  const fromUrl = /booking\/(\d+)(?:\/(\d+))?/.exec(arg);
  if (fromUrl) {
    return { courseId: Number(fromUrl[1]), scheduleId: fromUrl[2] ? Number(fromUrl[2]) : undefined };
  }
  const bare = Number(arg);
  if (!bare) throw new Error(`Not a ForeUp course id or booking URL: "${arg}"`);
  return { courseId: bare };
}

/** MM-DD-YYYY, which is the only date format this endpoint accepts. */
function foreupDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

/**
 * Every schedule id the booking page mentions.
 *
 * Three places worth looking, because ForeUp's widget is a single-page
 * app and which one holds the list varies by how the account is set up:
 * the requests it makes, the links it renders, and the raw HTML (the
 * course picker is often server-rendered even when nothing has been
 * clicked yet).
 */
async function collectScheduleIds(page: Page, courseId: number): Promise<Set<number>> {
  const found = new Set<number>();

  const harvest = (text: string) => {
    for (const m of text.matchAll(/schedule_ids?(?:\[\])?[=:]\s*"?(\d+)/g)) found.add(Number(m[1]));
    for (const m of text.matchAll(new RegExp(`booking/${courseId}/(\\d+)`, "g"))) {
      found.add(Number(m[1]));
    }
  };

  page.on("request", (r) => harvest(r.url()));
  page.on("response", (r) => harvest(r.url()));

  await page.goto(`${BOOKING}/${courseId}`, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  await page.waitForTimeout(SETTLE_MS);
  harvest(await page.content());

  // The course picker, when the account has one. Clicking each entry is
  // what makes the widget commit a schedule id to the URL.
  const choices = page.locator(
    'a[href*="/booking/"], [class*="schedule"] a, [class*="course"] a, button[data-schedule-id]'
  );
  const n = Math.min(await choices.count(), 12);
  for (let i = 0; i < n; i++) {
    const el = choices.nth(i);
    const id = await el.getAttribute("data-schedule-id");
    if (id) found.add(Number(id));
    const href = await el.getAttribute("href");
    if (href) harvest(href);
  }

  return found;
}

/**
 * Asks ForeUp what a schedule is, by requesting its times and reading
 * the name off the response.
 *
 * Looks a week out rather than today: a sheet with nothing left this
 * afternoon still has next Tuesday, and an empty response can't name
 * itself. Falls back to today if that's empty too.
 */
async function identify(scheduleId: number, courseId: number): Promise<Partial<Sheet>> {
  for (const daysAhead of [7, 1, 0]) {
    const params = new URLSearchParams({
      time: "all",
      date: foreupDate(daysAhead),
      holes: "all",
      players: "0",
      schedule_id: String(scheduleId),
      "schedule_ids[]": String(scheduleId),
      specials_only: "0",
      api_key: "",
    });

    try {
      const resp = await fetch(`${TIMES}?${params}`, {
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "api-key": "",
          referer: `${BOOKING}/${courseId}/${scheduleId}`,
          "user-agent": UA,
          "x-fu-golfer-location": "foreup",
          "x-requested-with": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) {
        if (daysAhead === 0) return { note: `HTTP ${resp.status}` };
        continue;
      }

      const rows = (await resp.json()) as {
        course_name?: string;
        booking_class_id?: number;
      }[];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Not reliably on the first row: El Monte returned 32 slots with
      // no booking class on row 0. Without one ForeUp can serve a
      // partial sheet, so it's worth looking past the first row before
      // giving up on it.
      return {
        courseName: rows.find((r) => r.course_name)?.course_name,
        bookingClassId: rows.find((r) => r.booking_class_id)?.booking_class_id,
        slots: rows.length,
      };
    } catch (err) {
      if (daysAhead === 0) return { note: (err as Error).message };
    }
  }
  return { note: "no times returned on any day tried" };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Names each schedule and prints seed entries. The half that matters. */
async function report(courseId: number, ids: Set<number>) {
  console.log(`Found ${ids.size} schedule id(s): ${[...ids].sort((a, b) => a - b).join(", ")}`);
  console.log("Asking ForeUp what each one is…\n");

  const sheets: Sheet[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const info = await identify(id, courseId);
    sheets.push({ scheduleId: id, ...info });
    console.log(
      `  ${courseId}:${id}`.padEnd(18) +
        (info.courseName
          ? `${info.courseName}${info.bookingClassId ? ` (booking class ${info.bookingClassId})` : ""}` +
            `  — ${info.slots} slot(s)`
          : `— ${info.note}`)
    );
  }

  const named = sheets.filter((s) => s.courseName);
  const distinct = new Set(named.map((s) => s.courseName));

  console.log("");
  if (named.length === 0) {
    console.log("None of them returned a name. Send the schedule ids and I'll take it from here.");
    return;
  }
  if (distinct.size < named.length) {
    console.log(
      "NOTE: two or more sheets report the same course name. That's ForeUp's\n" +
        "answer, not a bug here — those really are one course, and only one\n" +
        "should be seeded."
    );
    console.log("");
  }

  // A ForeUp courseId is a shared tenant, not one operator. Sweeping
  // 19197 returned thirteen sheets across at least five states plus two
  // of ForeUp's own training fixtures — so the list below is candidates,
  // not a shortlist, and nothing here can tell you where any of them is.
  const suspect = named.filter((s) => /setup|training|test|demo/i.test(s.courseName!));
  if (suspect.length) {
    console.log(
      `Skipping ${suspect.length} that look like ForeUp's own test sheets: ` +
        suspect.map((s) => s.courseName).join(", ")
    );
    console.log("");
  }

  const real = named.filter((s) => !suspect.includes(s));
  if (real.length > 1) {
    console.log(
      "CHECK THE STATE BEFORE PASTING. One ForeUp course id serves many\n" +
        "unrelated operators, and the times response carries no location —\n" +
        "these names could be anywhere. Open the booking URL to see the\n" +
        "course's own address."
    );
    console.log("");
  }

  console.log("Paste into lib/courses.data.ts:\n");
  for (const s of real) {
    console.log(`  {
    name: "${s.courseName}",
    slug: "${slugify(s.courseName!)}",
    county: "", // TODO
    city: "", // TODO
    platform: "FOREUP",
    externalId: "${courseId}:${s.scheduleId}${s.bookingClassId ? `:${s.bookingClassId}` : ""}",
    bookingUrl: "${BOOKING}/${courseId}/${s.scheduleId}#/teetimes",
    latitude: 0, // TODO
    longitude: 0, // TODO
  },`);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const headed = process.argv.includes("--headed");
  if (args.length === 0) {
    console.error(
      "Usage: npm run foreup:schedules -- <courseId | booking URL>\n" +
        "         [--ids 1258,1259] [--scan 1250-1275] [--headed]"
    );
    process.exit(1);
  }

  const { courseId, scheduleId } = parseTarget(args[0]);
  console.log(`ForeUp course ${courseId} — looking for its tee sheets\n`);

  /**
   * A bounded sweep of neighbouring schedule ids.
   *
   * For the case this script was written for: Ogden's booking page links
   * only to El Monte, so Mount Ogden's sheet exists but nothing on the
   * web points at it. Sister courses on one account are numbered close
   * together, so a small window around a known id usually finds it.
   *
   * Sequential and deliberately small. This is one operator's tee sheets
   * being asked what they're called, once — not a crawl.
   */
  const scan = arg("scan");
  if (scan) {
    const m = /^(\d+)-(\d+)$/.exec(scan);
    if (!m) throw new Error(`--scan wants a range like 1250-1275, got "${scan}"`);
    const [from, to] = [Number(m[1]), Number(m[2])];
    if (to - from > 60) throw new Error(`--scan range too wide (${to - from}); keep it under 60`);

    console.log(`Scanning schedule ids ${from}-${to} under course ${courseId}…\n`);
    const hits = new Set<number>();
    for (let id = from; id <= to; id++) {
      const info = await identify(id, courseId);
      if (info.courseName) {
        hits.add(id);
        console.log(`  ${courseId}:${id}`.padEnd(18) + `${info.courseName} — ${info.slots} slot(s)`);
      }
    }
    console.log("");
    if (hits.size === 0) {
      console.log("Nothing in that range. Try a different window, or a different course id.");
      return;
    }
    await report(courseId, hits);
    return;
  }

  // Skips the browser entirely. For when the ids are already known, or
  // when the booking page won't load but the API still answers — naming
  // is the valuable half and it's a plain HTTP call.
  const given = arg("ids");
  if (given) {
    await report(courseId, new Set(given.split(",").map((v) => Number(v.trim())).filter(Boolean)));
    return;
  }

  // A fresh clone has Playwright installed but no browser binary, and
  // its own error buries the fix in a box of ASCII art.
  const browser = await chromium.launch({ headless: !headed }).catch((err: Error) => {
    if (/Executable doesn't exist|playwright install/i.test(err.message)) {
      console.error("Chromium isn't installed for Playwright yet. Run:\n");
      console.error("  npx playwright install chromium\n");
      process.exit(1);
    }
    throw err;
  });

  const context = await browser.newContext({ userAgent: UA, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  let ids: Set<number>;
  try {
    ids = await collectScheduleIds(page, courseId);
  } catch (err) {
    console.error(`Couldn't load the booking page: ${(err as Error).message}`);
    ids = new Set();
  }
  if (scheduleId) ids.add(scheduleId);

  await browser.close();

  if (ids.size === 0) {
    console.log("No schedule ids found on the booking page.");
    console.log(`Try opening ${BOOKING}/${courseId} yourself — if it shows a list of`);
    console.log("courses, click each one and send the URLs; the second number is the id.");
    return;
  }

  await report(courseId, ids);
}

main().catch((err) => {
  console.error("foreup:schedules failed:", err);
  process.exitCode = 1;
});
