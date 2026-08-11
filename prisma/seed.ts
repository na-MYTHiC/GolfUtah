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
  // Discovered by scripts/detect-platform.ts, which reads each platform's
  // ids straight out of the course's booking URL:
  //   MemberSports  "<golfClubId>:<golfCourseId>"
  //   ForeUp        "<courseId>:<scheduleId>" (an optional third
  //                 ":<bookingClassId>" selects a rate class; verified
  //                 unnecessary against Sun Hills)
  // Eaglewood and Sun Hills are the two the adapters were built against,
  // so their ids are confirmed by hand; the rest come from detection and
  // are worth spot-checking with scripts/probe.ts.
  {
    name: "Eaglewood Golf Course",
    city: "North Salt Lake",
    platform: "MEMBERSPORTS",
    externalId: "15391:18901",
    bookingUrl: "https://eaglewoodgolf.com/",
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
  {
    name: "Sun Hills Golf Course",
    city: "Layton",
    platform: "FOREUP",
    externalId: "18895:578",
    bookingUrl: "https://www.sunhillsgolf.com/",
  },
  {
    name: "Murray Parkway Golf Course",
    city: "Murray",
    platform: "FOREUP",
    externalId: "6263:244",
    bookingUrl: "https://parkwaygolf.org/",
  },
  {
    name: "Timpanogos Golf Club",
    city: "Provo",
    platform: "FOREUP",
    externalId: "6279:49",
    bookingUrl: "https://www.timpanogosgolf.com/",
  },
  {
    name: "Links at Sleepy Ridge",
    city: "Orem",
    platform: "FOREUP",
    externalId: "19396:1726",
    bookingUrl: "https://www.sleepyridgegolf.com/",
  },
  {
    name: "Thanksgiving Point Golf Club",
    city: "Lehi",
    platform: "FOREUP",
    externalId: "19645:2034",
    bookingUrl: "https://www.thanksgivingpointgolfclub.com/",
  },
  {
    name: "The Oaks at Spanish Fork",
    city: "Spanish Fork",
    platform: "FOREUP",
    externalId: "21698:8633",
    bookingUrl: "https://www.theoaksatsf.com/",
  },
  {
    name: "Davis Park Golf Course",
    city: "Kaysville",
    platform: "FOREUP",
    externalId: "19500:1757",
    bookingUrl: "https://www.davisparkutah.com/",
  },
  {
    name: "Glen Eagle Golf Course",
    city: "Syracuse",
    platform: "FOREUP",
    externalId: "20940:6276",
    bookingUrl: "https://golfgleneagle.com/",
  },
  {
    name: "Wolf Creek Resort Golf Course",
    city: "Eden",
    platform: "FOREUP",
    externalId: "18945:756",
    bookingUrl: "https://wolfcreekresort.com/golf/",
  },
  {
    name: "Eagle Mountain Golf Club",
    city: "Brigham City",
    platform: "FOREUP",
    externalId: "19943:3033",
    bookingUrl: "https://eaglemountaingc.com/",
  },
  {
    name: "Carbon Country Club",
    city: "Helper",
    platform: "FOREUP",
    externalId: "22113:9906",
    bookingUrl: "https://www.carboncountryclub.com/",
  },
  {
    name: "Millsite Golf Course",
    city: "Ferron",
    platform: "FOREUP",
    externalId: "21605:8326",
    bookingUrl: "https://millsitegolfcourse.com/",
  },
  // Not seeded: Crane Field Golf Course. Detection returned "1:1", which
  // is a placeholder URL in its markup rather than a real booking link --
  // every genuine Utah ForeUp courseId is 4-5 digits. Needs its real ids
  // read off the booking page.
  //
  // Still unresolved statewide: 13 Chronogolf courses (no adapter yet),
  // 12 undetected, and 12 ForeUp courses whose ids detection couldn't
  // reach. See scripts/courses.candidates.json.
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
