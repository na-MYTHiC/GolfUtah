import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Serves cached tee times (written by scripts/poll.ts) grouped by course.
// The frontend reads from here rather than hitting course platforms
// directly on every page load.
export async function GET() {
  const courses = await prisma.course.findMany({
    where: { active: true },
    include: {
      teeTimes: {
        orderBy: [{ date: "asc" }, { time: "asc" }],
      },
    },
  });

  return NextResponse.json({ courses });
}
