/**
 * Fetches tee times for the next few days and writes them as static JSON
 * for the site to load in the browser.
 *
 * This exists because the site is hosted on GitHub Pages, which has no
 * server: the courses' booking APIs mostly don't send CORS headers, so a
 * page can't call them directly. The GitHub Actions cron runs this, then
 * builds and deploys, which means the data is as fresh as the last run.
 *
 * One file per day keeps each download small — the browser only fetches
 * the day being viewed.
 *
 * FRESHNESS IS TIERED, and that's the point of --near/--reuse.
 *
 * Not every day deserves the same attention. Today's sheet moves by the
 * minute; next Tuesday's barely moves at all. Refetching all ten days
 * every run means ~430 requests across 40-odd courses each time, which
 * is both wasteful and rude to the booking systems — and it caps how
 * often the near days can refresh, because the far ones ride along.
 *
 * So: the first --near days are always fetched fresh, and the rest are
 * carried over from what's already published (--reuse <site url>) unless
 * that copy is too old. A frequent run keeps today sharp for a third of
 * the requests; a slower full run refreshes the tail.
 *
 * Usage:
 *   npx tsx scripts/build-data.ts [--days 10] [--near 10]
 *                                 [--reuse https://user.github.io/repo]
 *                                 [--out public/data]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { COURSES } from "../lib/courses.data";
import { getAdapter } from "../lib/adapters";
import { getPlaceInfo, placesEnabled } from "../lib/places";
import { todayInUtah, addDays } from "../lib/format";
import type { Course } from "@prisma/client";

/**
 * Simultaneous requests to any one booking platform. Fourteen Chronogolf
 * courses firing at once looks like a stampede from their side; a few at
 * a time looks like people browsing. Different platforms run in
 * parallel, so this costs little wall-clock time.
 */
const PER_PLATFORM_CONCURRENCY = 3;

/**
 * How stale a carried-over day may be before it's refetched anyway.
 * Generous, because these are days far enough out that availability
 * barely moves — but not unbounded, or a far day could go stale for as
 * long as the site keeps deploying.
 */
const MAX_REUSE_AGE_MS = 6 * 60 * 60 * 1000;

interface StaticSlot {
  time: string;
  holes: number;
  spots: number;
  price: number | null;
  side?: string;
  url: string;
}

interface StaticCourse {
  id: string;
  name: string;
  slug: string;
  city: string;
  county: string;
  platform: string;
  bookingUrl: string;
  lat: number;
  lon: number;
  rating?: { rating: number; reviewCount: number; mapsUrl?: string };
  slots: StaticSlot[];
  error?: string;
  /**
   * How many slots the platform returned before filtering. Distinguishes
   * "the API gave us nothing" from "it gave us times but they're all
   * full" — which look identical in the UI otherwise, and need completely
   * different fixes.
   */
  returned?: number;
  /**
   * ForeUp course with no booking_class captured. Sun Hills proved that
   * omitting it can hide most of the morning, so these listings may be
   * incomplete and the UI says so.
   */
  partial?: boolean;
}

interface DayFile {
  date: string;
  generatedAt: string;
  courses: StaticCourse[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Runs tasks with a ceiling on how many are in flight at once.
 * Promise.all across every course hits one platform with dozens of
 * simultaneous requests, which is the kind of thing that gets an IP
 * blocked.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Every booking link must land on the day the golfer tapped, not on
 * whatever the course's page opens to by default. That's easy to lose:
 * a platform changes a parameter name, or a new adapter forgets it, and
 * the app quietly starts sending people to today's sheet for next
 * Saturday's tee time. So it's checked rather than trusted.
 *
 * Platforms spell the date differently — ISO for most, MM-DD-YYYY for
 * ForeUp — so both forms count.
 */
function carriesDate(url: string, date: string): boolean {
  const [year, month, day] = date.split("-");
  return url.includes(date) || url.includes(`${month}-${day}-${year}`);
}

async function fetchCourse(
  seed: (typeof COURSES)[number],
  date: string,
  rating: StaticCourse["rating"]
): Promise<StaticCourse> {
  const base: StaticCourse = {
    id: `${seed.platform}:${seed.externalId}`,
    name: seed.name,
    slug: seed.slug,
    city: seed.city,
    county: seed.county,
    platform: seed.platform,
    bookingUrl: seed.bookingUrl,
    lat: seed.latitude,
    lon: seed.longitude,
    rating,
    slots: [],
    partial: seed.platform === "FOREUP" && seed.externalId.split(":").length < 3,
  };

  try {
    const course = {
      name: seed.name,
      externalId: seed.externalId,
      bookingUrl: seed.bookingUrl,
      platform: seed.platform,
    } as Course;

    const times = await getAdapter(seed.platform).fetchTeeTimes(course, {
      from: date,
      to: date,
    });

    base.returned = times.length;
    base.slots = times.map((t) => ({
      time: t.time,
      holes: t.holes,
      spots: t.playersOpen,
      price: t.price ?? null,
      side: t.side,
      url: t.bookingUrl,
    }));
  } catch (err) {
    // Recorded rather than thrown: one course being down shouldn't cost
    // the whole day's data.
    base.error = (err as Error).message;
  }

  return base;
}

/** Fetches one day across every course, a few per platform at a time. */
async function fetchDay(
  date: string,
  ratings: Map<string, StaticCourse["rating"]>
): Promise<StaticCourse[]> {
  const byPlatform = new Map<string, (typeof COURSES)[number][]>();
  for (const seed of COURSES) {
    byPlatform.set(seed.platform, [...(byPlatform.get(seed.platform) ?? []), seed]);
  }

  // Platforms in parallel, courses within a platform rate-limited.
  const perPlatform = await Promise.all(
    [...byPlatform.values()].map((seeds) =>
      mapWithLimit(seeds, PER_PLATFORM_CONCURRENCY, (seed) =>
        fetchCourse(seed, date, ratings.get(seed.name))
      )
    )
  );

  return perPlatform.flat();
}

/**
 * The day as already published, when it's recent enough to stand. Days
 * this far out barely change, and not refetching them is what lets the
 * near days refresh often.
 */
async function reuseDay(baseUrl: string, date: string): Promise<DayFile | null> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/data/${date}.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;

    const file = (await resp.json()) as DayFile;
    const age = Date.now() - new Date(file.generatedAt).getTime();
    if (!Number.isFinite(age) || age > MAX_REUSE_AGE_MS) return null;
    if (!Array.isArray(file.courses) || file.courses.length === 0) return null;

    return file;
  } catch {
    // Not published yet, or unreachable — fetch it fresh instead.
    return null;
  }
}

async function main() {
  const days = Number(arg("days", "10"));
  // Defaults to every day, so a plain run behaves exactly as before and
  // the tiering only kicks in when the workflow asks for it.
  const near = Number(arg("near", String(days)));
  const reuse = arg("reuse", "");
  const outDir = arg("out", "public/data");
  const today = todayInUtah();

  mkdirSync(outDir, { recursive: true });

  // Ratings don't change day to day — fetch once and reuse across files.
  const ratings = new Map<string, StaticCourse["rating"]>();
  if (placesEnabled()) {
    for (const seed of COURSES) {
      const info = await getPlaceInfo(seed.name, seed.city);
      if (info) ratings.set(seed.name, info);
    }
    console.log(`Ratings: ${ratings.size}/${COURSES.length} matched`);
  }

  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const index: { dates: string[]; generatedAt: string; courseCount: number } = {
    dates,
    generatedAt: new Date().toISOString(),
    courseCount: COURSES.length,
  };

  let reused = 0;
  let undatedLinks = 0;

  for (const [i, date] of dates.entries()) {
    let file: DayFile | null = null;
    let carriedOver = false;

    if (i >= near && reuse) {
      const carried = await reuseDay(reuse, date);
      if (carried) {
        file = carried;
        carriedOver = true;
        reused++;
      }
    }

    if (!file) {
      file = {
        date,
        generatedAt: new Date().toISOString(),
        courses: await fetchDay(date, ratings),
      };
    }

    writeFileSync(`${outDir}/${date}.json`, JSON.stringify(file));

    const slots = file.courses.reduce((n, c) => n + c.slots.length, 0);
    const failed = file.courses.filter((c) => c.error).length;

    // A link that doesn't carry its date sends the golfer to the wrong
    // day at the checkout, which is worse than showing no link at all.
    const undated = file.courses.filter((c) =>
      c.slots.some((s) => !carriesDate(s.url, date))
    );
    undatedLinks += undated.length;

    console.log(
      `${date}: ${slots} slot(s) across ${file.courses.length - failed} course(s)` +
        (carriedOver ? " (carried over)" : "") +
        (failed ? `, ${failed} failed` : "") +
        (undated.length ? `, ${undated.length} with undated links` : "")
    );
    if (undated.length) {
      console.log(`  undated: ${undated.map((c) => c.name).join(", ")}`);
    }
  }

  writeFileSync(`${outDir}/index.json`, JSON.stringify(index));
  console.log(
    `Wrote ${dates.length} day file(s) to ${outDir}` +
      (reused ? ` (${reused} carried over, ${dates.length - reused} fetched)` : "")
  );

  if (undatedLinks) {
    console.log(
      `\nWARNING: ${undatedLinks} course-day(s) produced booking links with no ` +
        `date in them. Those send golfers to the course's default day. ` +
        `Check the adapter's booking-url builder.`
    );
  }
}

main().catch((err) => {
  console.error("build-data failed:", err);
  process.exitCode = 1;
});
