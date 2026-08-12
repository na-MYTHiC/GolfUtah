import type { Course } from "@prisma/client";
import { prisma } from "./db";
import { getAdapter } from "./adapters";
import { COURSES, type CourseSeed } from "./courses.data";

/**
 * Where the app gets tee times, in two modes:
 *
 *  - **cached** — read rows the poll worker wrote to Postgres. What you
 *    want in production: fast, and one poll serves every visitor.
 *  - **live** — no DATABASE_URL, so call the platforms directly. Slower
 *    and it re-fetches per visitor, but it means `npm run dev` shows real
 *    tee times with zero setup, which matters a lot for actually trying
 *    the thing.
 *
 * Live mode is not a substitute for the worker at any real traffic — it
 * puts one request per course on the courses' own systems per page load.
 */

export interface CourseWithTeeTimes {
  id: string;
  name: string;
  city: string | null;
  platform: string;
  bookingUrl: string;
  latitude: number | null;
  longitude: number | null;
  teeTimes: Slot[];
  /** Set when this course's fetch failed, so the UI can say so. */
  error?: string;
}

export interface Slot {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  holes: number;
  playersOpen: number;
  price: number | null; // cents
  /** "Front" / "Back" when the platform reports it. */
  side?: string;
  bookingUrl: string;
}

export type DataMode = "cached" | "live";

/** Live mode re-fetches per request otherwise; brief cache keeps it sane. */
const LIVE_TTL_MS = 3 * 60 * 1000;
const liveCache = new Map<string, { at: number; value: CourseWithTeeTimes }>();

function seedToCourse(seed: CourseSeed): Course {
  // Only the fields adapters read. Ids are synthetic in live mode since
  // there's no database row to point at.
  return {
    id: `${seed.platform}:${seed.externalId}`,
    name: seed.name,
    city: seed.city,
    platform: seed.platform,
    externalId: seed.externalId,
    bookingUrl: seed.bookingUrl,
    active: true,
    latitude: seed.latitude,
    longitude: seed.longitude,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Course;
}

async function fetchLiveCourse(seed: CourseSeed, date: string): Promise<CourseWithTeeTimes> {
  const key = `${seed.platform}:${seed.externalId}:${date}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.value;

  const base: CourseWithTeeTimes = {
    id: `${seed.platform}:${seed.externalId}`,
    name: seed.name,
    city: seed.city,
    platform: seed.platform,
    bookingUrl: seed.bookingUrl,
    latitude: seed.latitude,
    longitude: seed.longitude,
    teeTimes: [],
  };

  try {
    const adapter = getAdapter(seed.platform);
    const times = await adapter.fetchTeeTimes(seedToCourse(seed), { from: date, to: date });

    base.teeTimes = times.map((t, i) => ({
      id: `${key}:${i}`,
      date: t.date,
      time: t.time,
      holes: t.holes,
      playersOpen: t.playersOpen,
      price: t.price ?? null,
      side: t.side,
      bookingUrl: t.bookingUrl,
    }));
  } catch (err) {
    // One course being down shouldn't empty the whole page.
    base.error = (err as Error).message;
  }

  liveCache.set(key, { at: Date.now(), value: base });
  return base;
}

async function getLive(date: string): Promise<CourseWithTeeTimes[]> {
  // All three platforms have adapters now, and a course is only seeded
  // once its ids have been captured, so every seeded course is askable.
  return Promise.all(COURSES.map((seed) => fetchLiveCourse(seed, date)));
}

async function getCached(date: string): Promise<CourseWithTeeTimes[]> {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);

  const rows = await prisma.course.findMany({
    where: { active: true },
    include: {
      teeTimes: {
        where: { date: { gte: start, lte: end } },
        orderBy: [{ time: "asc" }],
      },
    },
  });

  return rows.map((course) => ({
    id: course.id,
    name: course.name,
    city: course.city,
    platform: course.platform,
    bookingUrl: course.bookingUrl,
    latitude: course.latitude,
    longitude: course.longitude,
    teeTimes: course.teeTimes.map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      time: t.time,
      holes: t.holes,
      playersOpen: t.playersOpen,
      price: t.price,
      bookingUrl: t.bookingUrl,
    })),
  }));
}

export async function getTeeTimes(
  date: string
): Promise<{ courses: CourseWithTeeTimes[]; mode: DataMode }> {
  if (process.env.DATABASE_URL) {
    try {
      const courses = await getCached(date);
      // A configured-but-unseeded database shouldn't render an empty app.
      if (courses.length > 0) return { courses, mode: "cached" };
    } catch {
      // Unreachable database — fall through to live rather than erroring.
    }
  }
  return { courses: await getLive(date), mode: "live" };
}
