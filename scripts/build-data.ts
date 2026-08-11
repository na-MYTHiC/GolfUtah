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
 * Usage:
 *   npx tsx scripts/build-data.ts [--days 5] [--out public/data]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { COURSES } from "../lib/courses.data";
import { getAdapter } from "../lib/adapters";
import { getPlaceInfo, placesEnabled } from "../lib/places";
import { todayInUtah, addDays } from "../lib/format";
import type { Course } from "@prisma/client";

interface StaticSlot {
  time: string;
  holes: number;
  spots: number;
  price: number | null;
  url: string;
}

interface StaticCourse {
  id: string;
  name: string;
  city: string;
  platform: string;
  bookingUrl: string;
  lat: number;
  lon: number;
  rating?: { rating: number; reviewCount: number; mapsUrl?: string };
  slots: StaticSlot[];
  error?: string;
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

async function fetchCourse(
  seed: (typeof COURSES)[number],
  date: string,
  rating: StaticCourse["rating"]
): Promise<StaticCourse> {
  const base: StaticCourse = {
    id: `${seed.platform}:${seed.externalId}`,
    name: seed.name,
    city: seed.city,
    platform: seed.platform,
    bookingUrl: seed.bookingUrl,
    lat: seed.latitude,
    lon: seed.longitude,
    rating,
    slots: [],
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

    base.slots = times.map((t) => ({
      time: t.time,
      holes: t.holes,
      spots: t.playersOpen,
      price: t.price ?? null,
      url: t.bookingUrl,
    }));
  } catch (err) {
    // Recorded rather than thrown: one course being down shouldn't cost
    // the whole day's data.
    base.error = (err as Error).message;
  }

  return base;
}

async function main() {
  const days = Number(arg("days", "5"));
  const outDir = arg("out", "public/data");
  const today = todayInUtah();

  mkdirSync(outDir, { recursive: true });

  // Adapters that don't exist yet would only produce error rows.
  const supported = COURSES.filter((c) => c.platform !== "CHRONOGOLF");

  // Ratings don't change day to day — fetch once and reuse across files.
  const ratings = new Map<string, StaticCourse["rating"]>();
  if (placesEnabled()) {
    for (const seed of supported) {
      const info = await getPlaceInfo(seed.name, seed.city);
      if (info) ratings.set(seed.name, info);
    }
    console.log(`Ratings: ${ratings.size}/${supported.length} matched`);
  }

  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const index: { dates: string[]; generatedAt: string; courseCount: number } = {
    dates,
    generatedAt: new Date().toISOString(),
    courseCount: supported.length,
  };

  for (const date of dates) {
    const courses = await Promise.all(
      supported.map((seed) => fetchCourse(seed, date, ratings.get(seed.name)))
    );

    const file: DayFile = { date, generatedAt: new Date().toISOString(), courses };
    writeFileSync(`${outDir}/${date}.json`, JSON.stringify(file));

    const slots = courses.reduce((n, c) => n + c.slots.length, 0);
    const failed = courses.filter((c) => c.error).length;
    console.log(
      `${date}: ${slots} slot(s) across ${courses.length - failed} course(s)` +
        (failed ? `, ${failed} failed` : "")
    );
  }

  writeFileSync(`${outDir}/index.json`, JSON.stringify(index));
  console.log(`Wrote ${dates.length} day file(s) to ${outDir}`);
}

main().catch((err) => {
  console.error("build-data failed:", err);
  process.exitCode = 1;
});
