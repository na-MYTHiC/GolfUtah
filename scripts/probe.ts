/**
 * Probe a course against its platform's live API — confirms the IDs are
 * right and shows what comes back, without touching the database.
 *
 * Usage:
 *   npx tsx scripts/probe.ts membersports 15391:18901 [YYYY-MM-DD]
 *   npx tsx scripts/probe.ts foreup 18895:578:177 [YYYY-MM-DD]
 *   npx tsx scripts/probe.ts foreup 18895:578          # no booking class
 *
 * Where the IDs come from:
 *   MemberSports  app.membersports.com/tee-times/<clubId>/<courseId>/0
 *   ForeUp        foreupsoftware.com/index.php/booking/<courseId>/<scheduleId>
 *                 (booking class, if needed, is only in the widget's own
 *                 request — see lib/adapters/foreup.ts)
 */
import type { Course } from "@prisma/client";
import { getAdapter } from "../lib/adapters";
import { memberSportsBookingUrl } from "../lib/adapters/membersports";
import { foreUpBookingUrl, parseExternalId as parseForeUpId } from "../lib/adapters/foreup";

const PLATFORMS = { membersports: "MEMBERSPORTS", foreup: "FOREUP" } as const;

function bookingUrlFor(platform: string, externalId: string): string {
  if (platform === "MEMBERSPORTS") {
    const [clubId, courseId] = externalId.split(":").map(Number);
    return memberSportsBookingUrl(clubId, courseId);
  }
  const { courseId, scheduleId } = parseForeUpId(externalId);
  return foreUpBookingUrl(courseId, scheduleId);
}

async function main() {
  const [platformArg, externalId, dateArg] = process.argv.slice(2);
  const platform = PLATFORMS[platformArg as keyof typeof PLATFORMS];

  if (!platform || !externalId) {
    console.error(
      "Usage: npx tsx scripts/probe.ts <membersports|foreup> <externalId> [YYYY-MM-DD]\n" +
        "  e.g. npx tsx scripts/probe.ts foreup 18895:578:177"
    );
    process.exitCode = 1;
    return;
  }

  const date = dateArg ?? new Date().toISOString().slice(0, 10);
  const bookingUrl = bookingUrlFor(platform, externalId);

  console.log(`Probing ${platform} ${externalId} for ${date}`);
  console.log(`Booking page: ${bookingUrl}\n`);

  // Only the fields adapters actually read — this never hits the DB.
  const course = { name: `probe ${externalId}`, externalId, bookingUrl, platform } as Course;
  const teeTimes = await getAdapter(platform).fetchTeeTimes(course, { from: date, to: date });

  if (teeTimes.length === 0) {
    console.log(
      "No tee times returned. Could mean: course closed that day, wrong IDs, or " +
        "(ForeUp) a booking_class is required — see lib/adapters/foreup.ts."
    );
    return;
  }

  console.log(`${teeTimes.length} slot(s):`);
  for (const t of teeTimes.slice(0, 25)) {
    const price = t.price != null ? `$${(t.price / 100).toFixed(2)}` : "—";
    console.log(`  ${t.time}  ${String(t.holes).padStart(2)}h  ${t.playersOpen} open  ${price}`);
  }
  if (teeTimes.length > 25) console.log(`  ... and ${teeTimes.length - 25} more`);
}

main().catch((err) => {
  console.error("Probe failed:", (err as Error).message);
  process.exitCode = 1;
});
