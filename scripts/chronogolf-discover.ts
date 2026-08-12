/**
 * Resolves Chronogolf course uuids by watching a real browser load each
 * club's tee sheet.
 *
 * Chronogolf addresses courses by uuid, and that uuid appears nowhere in
 * a club's public address — only in the request its own widget fires. So
 * far each club has cost a hand capture in DevTools. This does the same
 * thing without the hunting: open the page, listen for the
 * `marketplace/v2/teetimes` request, read `course_ids` out of it, and
 * read the response to learn which uuid is which course.
 *
 * It has to run somewhere that can actually reach chronogolf.com, which
 * is why it's a script you run rather than something already done.
 *
 * Usage:
 *   npx tsx scripts/chronogolf-discover.ts                 # every pending club
 *   npx tsx scripts/chronogolf-discover.ts mountain-dell-golf-club ...
 *   npx tsx scripts/chronogolf-discover.ts --headed        # watch it work
 *   npx tsx scripts/chronogolf-discover.ts --out found.json
 *
 * Needs a browser once:  npx playwright install chromium
 *
 * Output is a ready-to-paste CourseSeed per club, plus the raw findings
 * as JSON. Clubs that publish several courses (Riverbend lists its back
 * nine separately) come back with every uuid and its course name, so the
 * seed entry can cover them all.
 */
import { writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";

const CLUB_BASE = "https://www.chronogolf.com/club";
const TEETIMES_PATH = "/marketplace/v2/teetimes";

const NAV_TIMEOUT_MS = 30_000;
/** How long to wait for the widget to fire its own request. */
const CAPTURE_TIMEOUT_MS = 20_000;
/** One club at a time with a pause — browsing pace, not a crawl. */
const DELAY_BETWEEN_CLUBS_MS = 2_000;

/**
 * Clubs to resolve. Slugs marked confirmed have been seen in a real
 * address bar; the rest are patterns to try, and a wrong one simply
 * fails to load and is reported as not-found. Guessing is safe here in a
 * way it never is for response fields — a bad slug 404s loudly rather
 * than quietly producing wrong times.
 */
const CLUBS: { name: string; city: string; county: string; slugs: string[] }[] = [
  // Confirmed slugs, seen in a real address bar
  { name: "River Oaks Golf", city: "Sandy", county: "Salt Lake", slugs: ["river-oaks-golf-course-utah"] },
  { name: "University of Utah Golf Club", city: "Salt Lake City", county: "Salt Lake", slugs: ["university-of-utah-golf-club"] },
  { name: "Mountain Dell Golf Course", city: "Salt Lake City", county: "Salt Lake", slugs: ["mountain-dell-golf-club"] },
  { name: "Glendale Golf Course", city: "Salt Lake City", county: "Salt Lake", slugs: ["glendale-golf-course"] },

  // Salt Lake City municipals. There's no pattern to lean on: Mountain
  // Dell is "-golf-club" and Glendale is "-golf-course", two courses run
  // by the same city. So each sibling gets both spellings tried.
  { name: "Bonneville Golf Course", city: "Salt Lake City", county: "Salt Lake", slugs: ["bonneville-golf-course", "bonneville-golf-club", "bonneville-slc"] },
  { name: "Forest Dale Golf Course", city: "Salt Lake City", county: "Salt Lake", slugs: ["forest-dale-golf-course", "forest-dale-golf-club", "forestdale-golf-course"] },
  { name: "Nibley Park Golf Course", city: "Salt Lake City", county: "Salt Lake", slugs: ["nibley-park-golf-course", "nibley-park-golf-club"] },
  { name: "Rose Park Golf Course", city: "Salt Lake City", county: "Salt Lake", slugs: ["rose-park-golf-course", "rose-park-golf-club"] },

  // Salt Lake County municipals — Riverbend's slug ends "-slco".
  { name: "Meadow Brook Golf Course", city: "Taylorsville", county: "Salt Lake", slugs: ["meadow-brook-slco", "meadowbrook-slco", "meadow-brook-golf-course"] },
  { name: "Mick Riley Golf Course", city: "Murray", county: "Salt Lake", slugs: ["mick-riley-slco", "mick-riley-golf-course"] },
  { name: "Mountain View Golf Course", city: "West Jordan", county: "Salt Lake", slugs: ["mountain-view-slco", "mountain-view-golf-course"] },
  { name: "Old Mill Golf Course", city: "Holladay", county: "Salt Lake", slugs: ["old-mill-slco", "old-mill-golf-course"] },
  { name: "South Mountain Golf Course", city: "Draper", county: "Salt Lake", slugs: ["south-mountain-slco", "south-mountain-golf-course"] },
];

interface FoundCourse {
  uuid: string;
  name: string;
  holes: number;
}

interface Finding {
  name: string;
  city: string;
  county: string;
  slug?: string;
  courseIds: string[];
  courses: FoundCourse[];
  note?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The club's tee sheet for a day — the page whose widget fires the request. */
function sheetUrl(slug: string, date: string): string {
  const params = new URLSearchParams({
    date,
    step: "teetimes",
    holes: "",
    coursesIds: "",
    deals: "false",
    groupSize: "0",
  });
  return `${CLUB_BASE}/${slug}?${params}`;
}

/**
 * What one attempt at a slug produced. "missing" and "error" are kept
 * apart deliberately: a wrong slug means try the next spelling, but a
 * network or timeout failure says nothing about the slug at all, and
 * collapsing the two sends you hunting for an id that was never the
 * problem.
 */
type Attempt =
  | { status: "found"; courseIds: string[]; courses: FoundCourse[] }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * Loads one club page and waits for its own tee-times request. A guessed
 * slug costs one page load and nothing else.
 */
async function trySlug(browser: Browser, slug: string, date: string): Promise<Attempt> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  let courseIds: string[] = [];
  const courses = new Map<string, FoundCourse>();

  // The request carries the ids; the response says which is which. Both
  // are wanted, and the response only for clubs that actually have times
  // today — hence the id capture standing on its own.
  page.on("request", (req) => {
    if (!req.url().includes(TEETIMES_PATH)) return;
    const ids = new URL(req.url()).searchParams.get("course_ids");
    if (ids) courseIds = ids.split(",").map((s) => s.trim()).filter(Boolean);
  });

  page.on("response", async (resp) => {
    if (!resp.url().includes(TEETIMES_PATH) || !resp.ok()) return;
    try {
      const body = (await resp.json()) as {
        teetimes?: { course?: { uuid?: string; name?: string; holes?: number } }[];
      };
      for (const t of body.teetimes ?? []) {
        const c = t.course;
        if (c?.uuid && !courses.has(c.uuid)) {
          courses.set(c.uuid, { uuid: c.uuid, name: c.name ?? "", holes: c.holes ?? 0 });
        }
      }
    } catch {
      // Not JSON, or the body's already gone — the ids are what matter.
    }
  });

  try {
    const resp = await page.goto(sheetUrl(slug, date), {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });

    // A slug that isn't a club gets a 404 rather than a tee sheet.
    if (resp && resp.status() >= 400) return { status: "missing" };

    await page
      .waitForRequest((req) => req.url().includes(TEETIMES_PATH), {
        timeout: CAPTURE_TIMEOUT_MS,
      })
      .catch(() => undefined);

    // Let the response land after the request is seen.
    await page.waitForTimeout(2_000);

    if (courseIds.length > 0) {
      return { status: "found", courseIds, courses: [...courses.values()] };
    }

    // The page loaded but its widget never asked for tee times. Most
    // likely a real club whose sheet is closed for the day, so it's
    // worth saying so rather than blaming the slug.
    return { status: "error", message: "page loaded but no teetimes request fired" };
  } catch (err) {
    return { status: "error", message: (err as Error).message.split("\n")[0] };
  } finally {
    await context.close();
  }
}

/** "Mick Riley Golf Course" -> "mick-riley-golf-course" */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function printSeed(f: Finding): void {
  console.log(`  {
    name: ${JSON.stringify(f.name)},
    slug: ${JSON.stringify(slugify(f.name))},
    county: ${JSON.stringify(f.county)},
    city: ${JSON.stringify(f.city)},
    platform: "CHRONOGOLF",
    externalId:
      ${JSON.stringify(`${f.slug}:${f.courseIds.join(",")}`)},
    bookingUrl: "", // TODO the course's own website
    latitude: 0, // TODO
    longitude: 0, // TODO
  },`);
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes("--headed");
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;

  // Bare arguments are slugs to resolve instead of the built-in list.
  const explicit = args.filter(
    (a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1)
  );

  const clubs = explicit.length
    ? explicit.map((slug) => ({ name: slug, city: "", county: "", slugs: [slug] }))
    : CLUBS;

  const date = today();
  const browser = await chromium.launch({
    headless: !headed,
    // Only needed where a browser is preinstalled somewhere Playwright
    // doesn't look; a normal `npx playwright install chromium` leaves
    // this unset and finds its own.
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const findings: Finding[] = [];

  try {
    for (const club of clubs) {
      process.stdout.write(`${club.name || club.slugs[0]} ... `);
      let found: Finding | undefined;
      const errors: string[] = [];

      for (const slug of club.slugs) {
        const attempt = await trySlug(browser, slug, date);
        if (attempt.status === "found") {
          found = { ...club, slug, courseIds: attempt.courseIds, courses: attempt.courses };
          break;
        }
        if (attempt.status === "error") errors.push(`${slug}: ${attempt.message}`);
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CLUBS_MS));
      }

      if (found) {
        console.log(`ok  ${found.slug}  (${found.courseIds.length} course id(s))`);
        for (const c of found.courses) {
          console.log(`      ${c.uuid}  ${c.name}${c.holes ? ` (${c.holes})` : ""}`);
        }
        findings.push(found);
      } else if (errors.length) {
        // Reached the site but something went wrong — not a slug problem.
        console.log(`error`);
        for (const e of errors) console.log(`      ${e}`);
        findings.push({ ...club, courseIds: [], courses: [], note: errors.join("; ") });
      } else {
        console.log(`no such club — tried ${club.slugs.join(", ")}`);
        findings.push({ ...club, courseIds: [], courses: [], note: "no slug resolved" });
      }

      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CLUBS_MS));
    }
  } finally {
    await browser.close();
  }

  const resolved = findings.filter((f) => f.courseIds.length > 0);
  console.log(`\nResolved ${resolved.length} of ${findings.length} club(s).`);

  if (resolved.length) {
    console.log("\nPaste into lib/courses.data.ts:\n");
    for (const f of resolved) printSeed(f);
  }

  const missing = findings.filter((f) => f.courseIds.length === 0);
  if (missing.length) {
    console.log(`\nStill unresolved:`);
    for (const f of missing) console.log(`  ${f.name} — ${f.note}`);
    console.log(
      `\nFor "no slug resolved": open the course's own site, click its\n` +
        `book-a-tee-time link, and read the slug out of the resulting\n` +
        `chronogolf.com/club/<slug> address. Then re-run with just that slug:\n` +
        `  npx tsx scripts/chronogolf-discover.ts <slug>\n` +
        `Anything else is a network or timing failure — the slug may be fine,\n` +
        `so retry before going hunting.`
    );
  }

  const out = outFile ?? "chronogolf-found.json";
  writeFileSync(out, JSON.stringify(findings, null, 2));
  console.log(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
