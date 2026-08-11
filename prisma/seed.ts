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
  // externalId is "<golfClubId>:<golfCourseId>". Eaglewood's came from a
  // real onlineBookingTeeTimes capture (see lib/adapters/membersports.ts);
  // the rest were found by scripts/detect-platform.ts reading the IDs out
  // of each course's booking URL. Verify a new one with:
  //   npx tsx scripts/probe-membersports.ts <clubId> <courseId>
  {
    name: "Eaglewood Golf Course",
    city: "North Salt Lake",
    platform: "MEMBERSPORTS",
    externalId: "15391:18901",
    bookingUrl: "https://eaglewoodgolf.com/golf/",
  },
  {
    name: "Cedar Hills Golf Club",
    city: "Cedar Hills",
    platform: "MEMBERSPORTS",
    externalId: "15381:18891",
    bookingUrl: "https://cedarhillsgolfutah.com/",
  },
  {
    name: "Fore Lakes Golf Course",
    city: "Taylorsville",
    platform: "MEMBERSPORTS",
    externalId: "15394:18905",
    bookingUrl: "https://www.forelakesgc.com/",
  },
  {
    name: "Fox Hollow Golf Club",
    city: "American Fork",
    platform: "MEMBERSPORTS",
    externalId: "15396:18907",
    bookingUrl: "https://www.foxhollowutah.com/",
  },
  {
    name: "Hobble Creek Golf Course",
    city: "Springville",
    platform: "MEMBERSPORTS",
    externalId: "15404:18918",
    bookingUrl: "https://www.springville.org/golf/",
  },
  // ForeUp (25 Utah courses) and Chronogolf (13) are the bigger pools but
  // have no adapter yet — see lib/adapters/. Add rows here once those are
  // implemented and their externalId format is settled.
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
