/**
 * Probe a MemberSports club+course pair to confirm it's real and see what
 * it returns, without touching the database.
 *
 * Use this when adding a new MemberSports course: grab golfClubId and
 * golfCourseId from the course's booking page (they're in the
 * onlineBookingTeeTimes request body, and also in the page URL itself:
 * app.membersports.com/tee-times/<clubId>/<courseId>/0), then run this to
 * sanity-check before adding a row to prisma/seed.ts.
 *
 * Usage:
 *   npm run probe -- 15391 18901            # today
 *   npm run probe -- 15391 18901 2026-08-12 # specific date
 */
import { memberSportsAdapter, memberSportsBookingUrl } from "../lib/adapters/membersports";
import type { Course } from "@prisma/client";

async function main() {
  const [clubId, courseId, dateArg] = process.argv.slice(2);
  if (!clubId || !courseId) {
    console.error("Usage: npm run probe -- <golfClubId> <golfCourseId> [YYYY-MM-DD]");
    process.exitCode = 1;
    return;
  }

  const date = dateArg ?? new Date().toISOString().slice(0, 10);
  const externalId = `${clubId}:${courseId}`;

  // Only the fields the adapter actually reads — this never hits the DB.
  const course = {
    name: `probe ${externalId}`,
    externalId,
    bookingUrl: memberSportsBookingUrl(Number(clubId), Number(courseId)),
  } as Course;

  console.log(`Probing ${externalId} for ${date}`);
  console.log(`Booking page: ${course.bookingUrl}\n`);

  const teeTimes = await memberSportsAdapter.fetchTeeTimes(course, { from: date, to: date });

  if (teeTimes.length === 0) {
    console.log("No tee times returned — course may be closed that day, or the IDs are wrong.");
    return;
  }

  console.log(`${teeTimes.length} slot(s):`);
  for (const t of teeTimes.slice(0, 20)) {
    const price = t.price != null ? `$${(t.price / 100).toFixed(2)}` : "—";
    console.log(`  ${t.time}  ${t.holes}h  ${t.playersOpen} open  ${price}`);
  }
  if (teeTimes.length > 20) console.log(`  ... and ${teeTimes.length - 20} more`);
}

main().catch((err) => {
  console.error("Probe failed:", (err as Error).message);
  process.exitCode = 1;
});
