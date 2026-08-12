/**
 * Turns a DevTools capture into a ready-to-paste Chronogolf course entry.
 *
 * Chronogolf's API is addressed by course uuids that appear nowhere in
 * the club's public address, so each club needs one look at its own
 * network traffic. That's the only manual step — this script does the
 * rest.
 *
 * How to capture (about ten seconds per club):
 *   1. Open the club's booking page, e.g.
 *      https://www.chronogolf.com/club/riverbend-slco
 *   2. DevTools -> Network -> Fetch/XHR, then pick a date.
 *   3. Right-click the `marketplace/v2/teetimes` request -> Copy -> Copy
 *      link address. The response body isn't needed.
 *
 * Then:
 *   npx tsx scripts/chronogolf-add.ts "<club page url>" "<teetimes url>"
 *
 * It prints a CourseSeed to paste into lib/courses.data.ts, and — if the
 * API is reachable from where you're running it — confirms the ids by
 * naming the courses they resolve to.
 */
import { chronogolfAdapter, CHRONOGOLF_PENDING } from "../lib/adapters/chronogolf";
import type { Course } from "@prisma/client";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** ".../club/riverbend-slco?date=..." -> "riverbend-slco" */
function slugFrom(clubUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(clubUrl);
  } catch {
    fail(`Not a URL: ${clubUrl}`);
  }
  const match = /\/club\/([^/?#]+)/.exec(parsed.pathname);
  if (!match) {
    fail(`No club slug in ${clubUrl} — expected .../club/<slug>`);
  }
  return match[1];
}

function courseIdsFrom(requestUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    fail(`Not a URL: ${requestUrl}`);
  }
  // URLSearchParams decodes the %2C separators for us.
  const raw = parsed.searchParams.get("course_ids");
  if (!raw) {
    fail(
      `No course_ids in ${requestUrl}\n` +
        `Copy the request whose path is /marketplace/v2/teetimes — other ` +
        `requests on that page won't have it.`
    );
  }
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) fail("course_ids was empty");
  return ids;
}

/** "Mick Riley Golf Course" -> "mick-riley-golf-course" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const [clubUrl, requestUrl] = process.argv.slice(2);

  if (!clubUrl || !requestUrl) {
    console.log("Usage: npx tsx scripts/chronogolf-add.ts <club page url> <teetimes request url>");
    console.log("\nStill waiting on a capture:");
    for (const club of CHRONOGOLF_PENDING) {
      const known = club.slug ? `  https://www.chronogolf.com/club/${club.slug}` : "";
      console.log(`  ${club.name} (${club.city})${known}`);
    }
    process.exit(1);
  }

  const slug = slugFrom(clubUrl);
  const courseIds = courseIdsFrom(requestUrl);
  const externalId = `${slug}:${courseIds.join(",")}`;

  console.log(`Club slug:  ${slug}`);
  console.log(`Course ids: ${courseIds.length}`);
  for (const id of courseIds) console.log(`  ${id}`);

  // Optional confirmation — this is the same call the app will make, so
  // if it works here the seed entry works. Not fatal when the network
  // is unavailable; the ids came from a real request either way.
  const today = new Date().toISOString().slice(0, 10);
  try {
    const slots = await chronogolfAdapter.fetchTeeTimes(
      { name: slug, externalId, platform: "CHRONOGOLF" } as Course,
      { from: today, to: today }
    );
    console.log(`\nLive check: ${slots.length} slot(s) for ${today}`);
    for (const slot of slots.slice(0, 5)) {
      const price = slot.price != null ? `$${(slot.price / 100).toFixed(0)}` : "—";
      console.log(
        `  ${slot.time}  ${slot.holes}h  ${slot.playersOpen} open  ${price}` +
          (slot.side ? `  ${slot.side}` : "")
      );
    }
  } catch (err) {
    console.log(`\nLive check skipped: ${(err as Error).message}`);
  }

  const guess = slug.replace(/-slco$|-utah$/, "");
  console.log(`\nPaste into lib/courses.data.ts (fill in the // TODO lines):\n`);
  console.log(`  {
    name: "", // TODO the course's real name
    slug: "${slugify(guess)}",
    county: "", // TODO
    city: "", // TODO
    platform: "CHRONOGOLF",
    externalId:
      "${externalId}",
    bookingUrl: "", // TODO the course's own website
    latitude: 0, // TODO
    longitude: 0, // TODO
  },`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
