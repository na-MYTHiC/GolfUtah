/**
 * Seed script: populate the Course table from lib/courses.data.ts.
 *
 * The course list lives there rather than here so the app can also use it
 * as a fallback when no database is configured.
 *
 * Not yet covered, and tracked in scripts/courses.candidates.json:
 *  - 12 Chronogolf courses awaiting a course-uuid capture — the adapter
 *    works, but Chronogolf's ids aren't derivable from a course's public
 *    address (see CHRONOGOLF_PENDING in lib/adapters/chronogolf.ts)
 *  - ForeUp courses whose ids fetch-based detection couldn't reach
 *  - Crane Field, whose page yielded a placeholder "1:1" rather than real
 *    ids
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { COURSES } from "../lib/courses.data";

const prisma = new PrismaClient();

async function main() {
  for (const course of COURSES) {
    await prisma.course.upsert({
      where: {
        platform_externalId: { platform: course.platform, externalId: course.externalId },
      },
      update: course,
      create: course,
    });
  }
  console.log(`Seeded ${COURSES.length} course(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
