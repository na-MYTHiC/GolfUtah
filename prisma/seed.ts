/**
 * Seed script: populate the Course table.
 *
 * There's no real course data here yet — externalId (the platform's own
 * identifier for a course) has to come from actually inspecting each
 * course's booking site (see the comments in lib/adapters/*.ts), not from
 * guessing. Add real rows here as courses are researched and verified.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const courses: {
  name: string;
  city?: string;
  platform: "FOREUP" | "CHRONOGOLF" | "MEMBERSPORTS";
  externalId: string;
  bookingUrl: string;
}[] = [
  {
    name: "Eaglewood Golf Course",
    city: "North Salt Lake",
    platform: "MEMBERSPORTS",
    // "<golfClubId>:<golfCourseId>", confirmed from a real
    // onlineBookingTeeTimes capture — see lib/adapters/membersports.ts
    externalId: "15391:18901",
    bookingUrl: "https://eaglewoodgolf.com/golf/",
  },
  // Example shape once a course is verified — uncomment and fill in with
  // a real, confirmed externalId:
  // {
  //   name: "Example Golf Course",
  //   city: "Salt Lake City",
  //   platform: "FOREUP",
  //   externalId: "<schedule_id from the booking widget's network request>",
  //   bookingUrl: "https://.../booking/...",
  // },
];

async function main() {
  for (const course of courses) {
    await prisma.course.upsert({
      where: { platform_externalId: { platform: course.platform, externalId: course.externalId } },
      update: course,
      create: course,
    });
  }
  console.log(`Seeded ${courses.length} course(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
