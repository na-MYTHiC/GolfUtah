/**
 * Resolves booking ids for any platform by watching a real browser load
 * a course's booking page.
 *
 * scripts/detect-platform.ts fetches HTML and often can't tell what a
 * course runs, because the booking widget is loaded by JavaScript and
 * never appears in the served markup. This opens the page in Chromium
 * and listens to the traffic instead — the same thing a person does in
 * DevTools, which is how every id in this repo was found.
 *
 * It reads ids from the widget's *responses* wherever possible, because
 * those carry every id together and unambiguously:
 *
 *   ForeUp        each row has course_id, schedule_id, booking_class_id
 *   MemberSports  each item has golfClubId, golfCourseId
 *   Chronogolf    each teetime has course.uuid (see chronogolf-discover)
 *
 * The ForeUp booking_class matters more than it looks. Without it a tee
 * sheet can come back truncated — Sun Hills listed from 11:06am instead
 * of 6:45am — so `--refresh` re-visits courses already seeded without
 * one and captures it.
 *
 * Must run somewhere that can reach the booking sites.
 *
 * Usage:
 *   npx tsx scripts/discover-ids.ts                  # unseeded candidates
 *   npx tsx scripts/discover-ids.ts --refresh        # seeded ForeUp, for booking_class
 *   npx tsx scripts/discover-ids.ts --headed         # watch it work
 *   npx tsx scripts/discover-ids.ts --out found.json
 *   npx tsx scripts/discover-ids.ts "https://someclub.com/"   # one page
 *
 * Needs a browser once:  npx playwright install chromium
 */
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { COURSES } from "../lib/courses.data";
import CANDIDATES from "./courses.candidates.json";

const NAV_TIMEOUT_MS = 30_000;
/** Time to let a widget fire its own requests after the page settles. */
const SETTLE_MS = 5_000;
/** How long to wait for an availability request before giving up. */
const CAPTURE_TIMEOUT_MS = 15_000;
const DELAY_BETWEEN_COURSES_MS = 2_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

type Platform = "FOREUP" | "MEMBERSPORTS" | "CHRONOGOLF";

interface Ids {
  platform: Platform;
  externalId: string;
  /** Where it came from, so a surprising result can be traced. */
  source: string;
}

interface Target {
  name: string;
  city?: string;
  url: string;
}

interface Finding extends Target {
  ids?: Ids;
  note?: string;
}

/**
 * Collects ids seen on one page. A response-derived hit always beats a
 * URL-derived one: a booking URL gives course and schedule but never the
 * booking class, and a half-answer that looks complete is worse than an
 * obviously missing one.
 */
class Collector {
  private best?: Ids;

  /**
   * @param baseline ids already visible in the page address we asked
   * for. Reading those back out is not a discovery — in --refresh mode
   * every target *is* a ForeUp booking URL, so without this the script
   * reports a confident hit for every course while having captured
   * nothing at all.
   */
  constructor(private readonly baseline?: string) {}

  offer(ids: Ids | undefined): void {
    if (!ids) return;
    if (ids.source === "booking url" && ids.externalId === this.baseline) return;
    if (!this.best || rank(ids) > rank(this.best)) this.best = ids;
  }

  get result(): Ids | undefined {
    return this.best;
  }
}

/** More colons means more ids; a response hit outranks a URL hit. */
function rank(ids: Ids): number {
  return ids.externalId.split(":").length * 2 + (ids.source.includes("response") ? 1 : 0);
}

const FOREUP_BOOKING_URL = /foreupsoftware\.com\/index\.php\/booking\/(\d+)\/(\d+)/;

function fromForeUpUrl(url: string): Ids | undefined {
  const m = FOREUP_BOOKING_URL.exec(url);
  if (!m) return undefined;
  return { platform: "FOREUP", externalId: `${m[1]}:${m[2]}`, source: "booking url" };
}

/** ForeUp rows carry all three ids, which is the whole point of reading them. */
function fromForeUpResponse(rows: unknown): Ids | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const r = rows[0] as {
    course_id?: number;
    schedule_id?: number;
    booking_class_id?: number;
  };
  if (!r.course_id || !r.schedule_id) return undefined;
  const parts = [r.course_id, r.schedule_id];
  if (r.booking_class_id) parts.push(r.booking_class_id);
  return { platform: "FOREUP", externalId: parts.join(":"), source: "times response" };
}

function fromMemberSports(body: unknown): Ids | undefined {
  // The response is an array of buckets, each with items carrying ids.
  const buckets = body as { items?: { golfClubId?: number; golfCourseId?: number }[] }[];
  if (!Array.isArray(buckets)) return undefined;
  for (const bucket of buckets) {
    for (const item of bucket.items ?? []) {
      if (item.golfClubId && item.golfCourseId) {
        return {
          platform: "MEMBERSPORTS",
          externalId: `${item.golfClubId}:${item.golfCourseId}`,
          source: "teetimes response",
        };
      }
    }
  }
  return undefined;
}

/** MemberSports sends its ids in the request body too, times or not. */
function fromMemberSportsRequest(postData: string | null): Ids | undefined {
  if (!postData) return undefined;
  try {
    const body = JSON.parse(postData) as { golfClubId?: number; golfCourseId?: number };
    if (!body.golfClubId || !body.golfCourseId) return undefined;
    return {
      platform: "MEMBERSPORTS",
      externalId: `${body.golfClubId}:${body.golfCourseId}`,
      source: "teetimes request",
    };
  } catch {
    return undefined;
  }
}

function fromChronogolf(url: string): Ids | undefined {
  if (!url.includes("/marketplace/v2/teetimes")) return undefined;
  const ids = new URL(url).searchParams.get("course_ids");
  const slug = /chronogolf\.com\/club\/([a-z0-9-]+)/i.exec(url)?.[1];
  if (!ids) return undefined;
  // The slug lives on the page, not the API call, so it's filled in by
  // the caller when known.
  return {
    platform: "CHRONOGOLF",
    externalId: `${slug ?? "<slug>"}:${ids}`,
    source: "teetimes request",
  };
}

/** Click a booking-looking control — some widgets load only on demand. */
async function nudge(page: Page): Promise<void> {
  const patterns = [
    /book.*tee.*time/i,
    /tee.*times?/i,
    /book.*now/i,
    /reserve/i,
    // ForeUp asks which rate class you're booking as before showing the
    // sheet, and that choice *is* the booking_class we're after.
    /^(public|guest|resident|regular)/i,
  ];
  for (const pattern of patterns) {
    for (const role of ["link", "button"] as const) {
      try {
        const target = page.getByRole(role, { name: pattern }).first();
        if (await target.isVisible({ timeout: 1_000 })) {
          await target.click({ timeout: 5_000 });
          await page.waitForTimeout(SETTLE_MS);
          return;
        }
      } catch {
        // not present or not clickable — try the next pattern
      }
    }
  }
}

async function inspect(browser: Browser, target: Target): Promise<Finding> {
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();
  const found = new Collector(fromForeUpUrl(target.url)?.externalId);

  page.on("request", (req) => {
    const url = req.url();
    found.offer(fromForeUpUrl(url));
    found.offer(fromChronogolf(url));
    if (url.includes("onlineBookingTeeTimes")) {
      found.offer(fromMemberSportsRequest(req.postData()));
    }
  });

  page.on("framenavigated", (frame) => found.offer(fromForeUpUrl(frame.url())));

  page.on("response", async (resp) => {
    const url = resp.url();
    if (!resp.ok()) return;
    try {
      if (url.includes("/api/booking/times")) {
        found.offer(fromForeUpResponse(await resp.json()));
      } else if (url.includes("onlineBookingTeeTimes")) {
        found.offer(fromMemberSports(await resp.json()));
      }
    } catch {
      // Body gone or not JSON — the request-side hits still stand.
    }
  });

  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);

    // An embedded widget shows the platform in its frame's own URL.
    for (const frame of page.frames()) found.offer(fromForeUpUrl(frame.url()));

    if (!found.result) {
      await nudge(page);
      for (const frame of page.frames()) found.offer(fromForeUpUrl(frame.url()));
    }

    // Give an availability request that's already in flight time to land,
    // since the response is what carries the booking class.
    if (!found.result?.externalId.includes(":")) {
      await page
        .waitForResponse((r) => /api\/booking\/times|onlineBookingTeeTimes/.test(r.url()), {
          timeout: CAPTURE_TIMEOUT_MS,
        })
        .catch(() => undefined);
    }
    await page.waitForTimeout(2_000);

    const ids = found.result;
    return ids ? { ...target, ids } : { ...target, note: "no booking traffic captured" };
  } catch (err) {
    // A timeout after a sighting still counts — the ids are real.
    const ids = found.result;
    if (ids) return { ...target, ids };
    return { ...target, note: (err as Error).message.split("\n")[0] };
  } finally {
    await context.close();
  }
}

/** "Mount Ogden Golf Course" -> "mount-ogden-golf-course" */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function printSeed(f: Finding): void {
  console.log(`  {
    name: ${JSON.stringify(f.name)},
    slug: ${JSON.stringify(slugify(f.name))},
    county: "", // TODO
    city: ${JSON.stringify(f.city ?? "")},
    platform: ${JSON.stringify(f.ids!.platform)},
    externalId: ${JSON.stringify(f.ids!.externalId)},
    bookingUrl: ${JSON.stringify(f.url)},
    latitude: 0, // TODO
    longitude: 0, // TODO
  },`);
}

/** Courses in the tracker that aren't seeded yet. */
function unseededCandidates(): Target[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const seeded = new Set(COURSES.map((c) => norm(c.name)));
  return (CANDIDATES as Target[]).filter((c) => !seeded.has(norm(c.name)));
}

/**
 * Seeded ForeUp courses with no booking class, pointed at their own
 * booking pages. These already work; the aim is to stop their sheets
 * being truncated.
 */
function foreUpNeedingClass(): Target[] {
  return COURSES.filter(
    (c) => c.platform === "FOREUP" && c.externalId.split(":").length < 3
  ).map((c) => {
    const [courseId, scheduleId] = c.externalId.split(":");
    return {
      name: c.name,
      city: c.city,
      url: `https://foreupsoftware.com/index.php/booking/${courseId}/${scheduleId}#/teetimes`,
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes("--headed");
  const refresh = args.includes("--refresh");
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : "discovered-ids.json";

  const urls = args.filter(
    (a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1)
  );

  const targets: Target[] = urls.length
    ? urls.map((url) => ({ name: url, url }))
    : refresh
      ? foreUpNeedingClass()
      : unseededCandidates();

  console.log(
    `${targets.length} course(s) to inspect` +
      (refresh ? " (ForeUp, looking for booking_class)" : "") +
      `\n`
  );

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const findings: Finding[] = [];

  try {
    for (const target of targets) {
      process.stdout.write(`${target.name} ... `);
      const finding = await inspect(browser, target);
      if (finding.ids) {
        console.log(`${finding.ids.platform}  ${finding.ids.externalId}  (${finding.ids.source})`);
      } else {
        console.log(finding.note);
      }
      findings.push(finding);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_COURSES_MS));
    }
  } finally {
    await browser.close();
  }

  const hits = findings.filter((f) => f.ids);
  console.log(`\nResolved ${hits.length} of ${findings.length}.`);

  if (refresh) {
    const withClass = hits.filter((f) => f.ids!.externalId.split(":").length === 3);
    console.log(`Captured a booking class for ${withClass.length}.\n`);
    for (const f of withClass) {
      console.log(`  ${f.name}: externalId: "${f.ids!.externalId}",`);
    }
  } else if (hits.length) {
    console.log(`\nPaste into lib/courses.data.ts:\n`);
    for (const f of hits) printSeed(f);
  }

  const misses = findings.filter((f) => !f.ids);
  if (misses.length) {
    console.log(`\nNothing seen for:`);
    for (const f of misses) console.log(`  ${f.name} — ${f.note}`);
  }

  writeFileSync(outFile, JSON.stringify(findings, null, 2));
  console.log(`\nWrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
