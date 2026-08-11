import { NextResponse } from "next/server";
import { getTeeTimes } from "@/lib/tee-times";
import { todayInUtah } from "@/lib/format";

/**
 * JSON view of the same data the page renders — handy for scripting, and
 * the seam a future mobile client would use.
 *
 *   GET /api/tee-times?date=2026-08-15
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayInUtah();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const { courses, mode } = await getTeeTimes(date);

  return NextResponse.json({
    date,
    mode,
    courses: courses.map((c) => ({
      name: c.name,
      city: c.city,
      platform: c.platform,
      bookingUrl: c.bookingUrl,
      error: c.error,
      teeTimes: c.teeTimes,
    })),
  });
}
