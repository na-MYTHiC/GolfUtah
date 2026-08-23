/**
 * Checks every seeded ForeUp course for the Valley View shape: a course
 * split across booking classes, with only one of them seeded.
 *
 * Valley View publishes its 18-hole round as class 1208 (24 rows) and
 * its nine as 1209 (67 rows), on one schedule. Seeding 1208 alone
 * published a quarter of the course and none of its nines, and the only
 * outward sign was a golfer noticing the app and the course's own page
 * disagreed. Nothing in the build could have caught it: 24 rows is a
 * successful fetch.
 *
 * Two passes, so the sweep only falls on courses that look wrong:
 *
 *   1. ask each course as the adapter does, for one day, and record
 *      what comes back
 *   2. for anything one-sided (all 18 or all 9) or suspiciously thin,
 *      sweep booking classes around the seeded one and report any that
 *      answer with a different round
 *
 * A course legitimately can be 18-only — plenty are — so this reports
 * rather than concludes. What it's looking for is the pair: two classes
 * on one sheet, each holding half the tee sheet.
 *
 *   npm run foreup:audit
 *   npm run foreup:audit -- --span 10        # widen the class sweep
 *   npm run foreup:audit -- --only valley-view-golf-course
 *
 * Needs a machine that can reach foreupsoftware.com — or the Probe
 * workflow.
 */

import { COURSES } from "../lib/courses.data";
import { parseExternalId } from "../lib/adapters/foreup";

const BOOKING = "https://foreupsoftware.com/index.php/booking";
const TIMES = "https://foreupsoftware.com/index.php/api/booking/times";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/** Below this, a day's sheet is thin enough to be worth a second look. */
const THIN_ROWS = 30;

interface Row {
  time: string;
  holes: number | string;
  booking_class_id: number;
  course_name: string;
  available_spots_9: number;
  available_spots_18: number;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function session(courseId: number, scheduleId: number): Promise<string | undefined> {
  try {
    const resp = await fetch(`${BOOKING}/${courseId}/${scheduleId}`, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    const cookies = resp.headers.getSetCookie?.().map((c) => c.split(";")[0]).filter(Boolean);
    return cookies?.length ? cookies.join("; ") : undefined;
  } catch {
    return undefined;
  }
}

async function times(
  courseId: number,
  scheduleId: number,
  cls: number | undefined,
  date: string,
  cookie: string | undefined
): Promise<Row[] | string> {
  const params = new URLSearchParams({
    time: "all",
    date,
    holes: "all",
    players: "0",
    schedule_id: String(scheduleId),
    "schedule_ids[]": String(scheduleId),
    specials_only: "0",
    api_key: "",
    ...(cls !== undefined ? { booking_class: String(cls) } : {}),
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
        ...(cookie ? { cookie } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) return `HTTP ${resp.status}`;
    const body = await resp.json();
    return Array.isArray(body) ? (body as Row[]) : "not an array";
  } catch (err) {
    return (err as Error).message;
  }
}

function rounds(rows: Row[]): { nine: number; eighteen: number } {
  return {
    nine: rows.filter((r) => r.available_spots_9 > 0).length,
    eighteen: rows.filter((r) => r.available_spots_18 > 0).length,
  };
}

interface Finding {
  name: string;
  externalId: string;
  seeded: string;
  extra: { cls: number; rows: number; fresh: number; nine: number; eighteen: number }[];
}

/** One tee time, regardless of which rate class is quoting it. */
function slotKey(r: Row): string {
  return `${r.time}|${r.holes}|${r.teesheet_side_name ?? ""}`;
}

async function main() {
  const only = arg("only");
  const span = Number(arg("span") ?? "6");
  const date = foreupDate(1);

  const foreup = COURSES.filter(
    (c) => c.platform === "FOREUP" && (!only || c.slug === only)
  );

  console.log(`Auditing ${foreup.length} ForeUp course(s) on ${date}`);
  console.log(`Looking for a course split across booking classes.\n`);

  const suspicious: typeof foreup = [];
  const findings: Finding[] = [];
  /**
   * Where to centre each course's class sweep.
   *
   * A course with no class seeded still gets one back: ForeUp stamps
   * `booking_class_id` on every row it returns, whichever class it
   * decided to serve. Without this, the eight courses seeded without a
   * class had no number to sweep around and were skipped — including
   * Cedar Ridge, which pass 1 flags as 9-hole-only.
   */
  const anchor = new Map<string, number>();
  /**
   * The tee times pass 1 already publishes, per course.
   *
   * Pass 2 counts rows, and rows are not times. Mulligans answers eight
   * neighbouring classes with the same 85 slots, Oquirrh Hills six with
   * the same 21, Cedar Ridge seven with the same 11 — those are
   * duplicate rate classes quoting one sheet, and the audit was
   * recommending we seed all of them. Following that advice would have
   * meant eight times the requests for no new golf. So compare slots,
   * not counts, and say plainly when a class adds nothing.
   */
  const published = new Map<string, Set<string>>();

  // Pass 1 — ask exactly as the adapter asks, which since v75 means
  // every seeded class, not just the first.
  //
  // Asking with only bookingClassIds[0] made this permanently blind to
  // its own fixes: Valley View is seeded 1208,1209 and the adapter
  // merges both, but asking 1208 alone returns 24 rows of 18-hole golf
  // and reports "one-sided" — the exact symptom the seed was changed to
  // cure. Davis Park read the same way. So the audit would have gone on
  // flagging two courses that are correct, and could never have caught
  // the second class going bad.
  for (const course of foreup) {
    const ids = parseExternalId(course.externalId);
    const cookie = await session(ids.courseId, ids.scheduleId);
    const asked: (number | undefined)[] =
      ids.bookingClassIds.length > 0 ? ids.bookingClassIds : [undefined];
    const cls = ids.bookingClassIds.join(",") || undefined;

    const merged: Row[] = [];
    const seenRow = new Set<string>();
    let failure: string | undefined;
    for (const one of asked) {
      const got = await times(ids.courseId, ids.scheduleId, one, date, cookie);
      await sleep(150);
      if (typeof got === "string") {
        failure ??= got;
        continue;
      }
      for (const r of got) {
        // Same slot offered under two classes is one tee time, not two.
        const key = slotKey(r);
        if (seenRow.has(key)) continue;
        seenRow.add(key);
        merged.push(r);
      }
    }

    // Only a total failure is a failure: if one class errored and
    // another answered, the course is reachable and the rows are real.
    const rows: Row[] | string = merged.length > 0 ? merged : (failure ?? merged);

    if (typeof rows === "string") {
      console.log(`  ${course.name.padEnd(32)} ${rows}`);
      continue;
    }

    const { nine, eighteen } = rounds(rows);
    const oneSided = rows.length > 0 && (nine === 0 || eighteen === 0);
    const thin = rows.length > 0 && rows.length < THIN_ROWS;
    const flag = rows.length === 0 ? "EMPTY" : oneSided ? "one-sided" : thin ? "thin" : "";

    console.log(
      `  ${course.name.padEnd(32)} ${String(rows.length).padStart(3)} rows  ` +
        `9:${String(nine).padStart(3)}  18:${String(eighteen).padStart(3)}  ` +
        `class ${cls ?? "(none)"}  ${flag}`
    );

    published.set(course.slug, seenRow);

    const observed =
      ids.bookingClassIds[0] ?? rows.find((r) => r.booking_class_id)?.booking_class_id;
    if (observed !== undefined) anchor.set(course.slug, observed);
    if (flag && observed !== undefined) suspicious.push(course);
    else if (flag) {
      console.log(`      (no class to sweep around — nothing came back to name one)`);
    }
  }

  if (suspicious.length === 0) {
    console.log(`\nNothing to sweep. No course looks split.`);
    return;
  }

  // Pass 2 — sweep classes, but only where pass 1 gave a reason to.
  console.log(`\nSweeping booking classes for ${suspicious.length} course(s), +/-${span}\n`);

  for (const course of suspicious) {
    const ids = parseExternalId(course.externalId);
    const seeded = new Set(ids.bookingClassIds);
    const base = anchor.get(course.slug)!;
    const cookie = await session(ids.courseId, ids.scheduleId);
    const already = published.get(course.slug) ?? new Set<string>();
    const extra: Finding["extra"] = [];
    let duplicates = 0;

    for (let cls = base - span; cls <= base + span; cls++) {
      if (cls <= 0 || seeded.has(cls)) continue;
      const rows = await times(ids.courseId, ids.scheduleId, cls, date, cookie);
      await sleep(150);
      if (typeof rows === "string" || rows.length === 0) continue;
      // Only this course's own rows count — a class id that belongs to
      // someone else's install is not a find.
      if (!rows.some((r) => r.course_name === course.name)) continue;

      // How many of these are tee times we don't already have? A class
      // that answers with the same sheet at a different price is a rate
      // card, not a missing half of the course.
      const fresh = rows.filter((r) => !already.has(slotKey(r)));
      if (fresh.length === 0) {
        duplicates++;
        continue;
      }

      const { nine, eighteen } = rounds(fresh);
      extra.push({ cls, rows: rows.length, fresh: fresh.length, nine, eighteen });
      console.log(
        `  ${course.name.padEnd(32)} class ${cls}  ${String(fresh.length).padStart(3)} new  ` +
          `(of ${String(rows.length).padStart(3)})  ` +
          `9:${String(nine).padStart(3)}  18:${String(eighteen).padStart(3)}`
      );
    }

    if (duplicates) {
      console.log(
        `  ${course.name.padEnd(32)} ${duplicates} class(es) return only times we already have`
      );
    }

    if (extra.length) {
      findings.push({
        name: course.name,
        externalId: course.externalId,
        seeded: ids.bookingClassIds.join(","),
        extra,
      });
    }
  }

  console.log("");
  if (findings.length === 0) {
    console.log("No class adds a tee time we don't already publish.");
    console.log("The flagged courses are genuinely that shape.");
    return;
  }

  console.log(`${findings.length} course(s) publish more than we ask for:\n`);
  for (const f of findings) {
    const all = [f.seeded, ...f.extra.map((e) => e.cls)].join(",");
    const [course, schedule] = f.externalId.split(":");
    console.log(`  ${f.name}`);
    console.log(`    now:  "${f.externalId}"`);
    console.log(`    ->    "${course}:${schedule}:${all}"`);
    for (const e of f.extra) {
      console.log(
        `          class ${e.cls} adds ${e.fresh} tee time(s) we don't have ` +
          `(9:${e.nine}, 18:${e.eighteen})`
      );
    }
  }
}

main().catch((err) => {
  console.error("foreup:audit failed:", err);
  process.exitCode = 1;
});
