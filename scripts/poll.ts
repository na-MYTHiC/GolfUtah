/**
 * Polling worker: fetches current tee time availability for every active
 * course and upserts it into the DB, so the Next.js app just reads cached
 * data instead of hitting course platforms on every page load.
 *
 * This is meant to run as a standalone, long-running process (not a
 * serverless function) on a schedule — e.g. a loop with a sleep, or driven
 * by an external scheduler that invokes `npm run poll` every few minutes.
 * Headless-browser-based adapters in particular need a persistent process,
 * not a cold-started serverless one.
 *
 * Usage:
 *   npm run poll                # one pass over all active courses
 *   npm run poll -- --loop=300  # repeat every 300s
 */
import { prisma } from "../lib/db";
import { getAdapter } from "../lib/adapters";

function dateRange(days: number): { from: string; to: string } {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + days);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

async function pollOnce() {
  const courses = await prisma.course.findMany({ where: { active: true } });
  const range = dateRange(7); // next 7 days; adjust once real usage patterns are known

  console.log(`[poll] ${courses.length} active course(s), range ${range.from}..${range.to}`);

  for (const course of courses) {
    const adapter = getAdapter(course.platform);
    try {
      const teeTimes = await adapter.fetchTeeTimes(course, range);

      // Replace this course's cached slots wholesale each pass — simplest
      // way to make stale/booked slots disappear without diffing.
      await prisma.$transaction([
        prisma.teeTime.deleteMany({ where: { courseId: course.id } }),
        prisma.teeTime.createMany({
          data: teeTimes.map((t) => ({
            courseId: course.id,
            date: new Date(t.date),
            time: t.time,
            holes: t.holes,
            playersOpen: t.playersOpen,
            price: t.price,
            cartIncluded: t.priceIncludesCart,
            bookingUrl: t.bookingUrl,
          })),
        }),
      ]);

      console.log(`[poll] ${course.name}: ${teeTimes.length} slot(s)`);
    } catch (err) {
      // One course failing (adapter not implemented, platform blocked us,
      // network hiccup) should never take down the whole pass.
      console.error(`[poll] ${course.name} failed:`, (err as Error).message);
    }
  }
}

async function main() {
  const loopArg = process.argv.find((a) => a.startsWith("--loop="));
  const loopSeconds = loopArg ? Number(loopArg.split("=")[1]) : undefined;

  do {
    await pollOnce();
    if (loopSeconds) {
      console.log(`[poll] sleeping ${loopSeconds}s`);
      await new Promise((r) => setTimeout(r, loopSeconds * 1000));
    }
  } while (loopSeconds);
}

main()
  .catch((err) => {
    console.error("[poll] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
