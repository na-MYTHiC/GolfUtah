/**
 * Does MemberSports answer anonymously for a club whose *page* wants a
 * login?
 *
 * St. George City's four courses — Dixie Red Hills, Southgate,
 * St. George Golf Club and Sunbrook — run on MemberSports and put a
 * login in front of their tee sheet. That looks like a dead end, and it
 * might be one. But this repo has met that shape before and been wrong:
 * Davis Park's ForeUp widget also gates in the browser, and its API
 * answers fine once the request carries the right parameters.
 *
 * There is a specific reason to think it might work here. The
 * MemberSports adapter already authenticates as nobody — it sends the
 * literal string "Bearer null", which is what that platform's own
 * booking page sends — and ten Utah courses are served that way today.
 * So the question isn't whether anonymous access exists, it's whether
 * these particular clubs have it switched off.
 *
 *   npm run membersports:probe -- --club 15402 --course 18913
 *   npm run membersports:probe -- --club 15402 --scan 18900-18930
 *
 * The ids are the two numbers in an app.membersports.com URL:
 *   app.membersports.com/tee-times/<golfClubId>/<golfCourseId>/0
 * A login screen usually still carries the club id in its address, which
 * is the half that's hard to guess; --scan then walks the course ids
 * around it.
 *
 * Reports what came back per id, so a club that answers for one course
 * and not another is visible rather than averaged away.
 */
import { memberSportsAdapter } from "../lib/adapters/membersports";
import { todayInUtah, addDays } from "../lib/format";
import type { Course } from "@prisma/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Bounded, and sequential — this is someone else's booking system. */
const MAX_SCAN = 40;

async function tryOne(clubId: number, courseId: number): Promise<string> {
  const course = {
    name: `${clubId}:${courseId}`,
    externalId: `${clubId}:${courseId}`,
    bookingUrl: "",
    platform: "MEMBERSPORTS",
  } as Course;

  // Two days out: a club can legitimately have nothing left today, and
  // an empty sheet would read as a locked one.
  const date = addDays(todayInUtah(), 2);

  try {
    const times = await memberSportsAdapter.fetchTeeTimes(course, { from: date, to: date });
    if (times.length === 0) return "answered, but no times for that day";
    const first = times[0];
    return `${times.length} slot(s) — first ${first.time}, ${first.holes} holes` +
      (first.price != null ? `, $${(first.price / 100).toFixed(2)}` : "");
  } catch (err) {
    const msg = (err as Error).message;
    // 401/403 is the interesting failure: it means anonymous really is
    // switched off, rather than the ids being wrong.
    if (/40[13]/.test(msg)) return `REFUSED — ${msg} (anonymous access is off)`;
    return `failed — ${msg}`;
  }
}

async function main() {
  const club = Number(arg("club"));
  if (!club) {
    console.error("Usage: npm run membersports:probe -- --club <id> [--course <id> | --scan a-b]");
    process.exit(1);
  }

  const scan = arg("scan");
  const single = Number(arg("course"));

  let courseIds: number[];
  if (scan) {
    const m = /^(\d+)-(\d+)$/.exec(scan);
    if (!m) throw new Error(`--scan wants a range like 18900-18930, got "${scan}"`);
    const [from, to] = [Number(m[1]), Number(m[2])];
    if (to - from > MAX_SCAN) throw new Error(`--scan range too wide; keep it under ${MAX_SCAN}`);
    courseIds = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  } else if (single) {
    courseIds = [single];
  } else {
    throw new Error("Give --course <id> or --scan <from>-<to>");
  }

  console.log(`MemberSports club ${club}, ${courseIds.length} course id(s)\n`);

  let answered = 0;
  for (const courseId of courseIds) {
    const result = await tryOne(club, courseId);
    // Only worth a line if something came back — a scan is mostly ids
    // that don't exist.
    if (!/^failed/.test(result) || courseIds.length === 1) {
      console.log(`  ${club}:${courseId}`.padEnd(18) + result);
    }
    if (/slot\(s\)/.test(result)) answered++;
  }

  console.log("");
  if (answered > 0) {
    console.log(`${answered} course(s) served tee times anonymously.`);
    console.log("The login is a website thing, not an API thing — these can be seeded.");
  } else {
    console.log("Nothing served times. Either the ids are wrong, or this club really");
    console.log("has anonymous booking switched off, in which case it belongs with");
    console.log("TeeRocket: public availability doesn't exist and no adapter can invent it.");
  }
}

main().catch((err) => {
  console.error("membersports:probe failed:", err);
  process.exitCode = 1;
});
