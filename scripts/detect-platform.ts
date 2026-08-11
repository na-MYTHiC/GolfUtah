/**
 * Given a list of golf course websites, work out which booking platform
 * each one uses — so we know which adapter (if any) can cover it.
 *
 * A course directory (18birdies, UGA, GolfNow, ...) gives names and
 * addresses but never says "this course books through MemberSports".
 * That only shows up in the course's own site: the "Book Tee Time" link
 * points at the platform, or the page embeds the platform's widget.
 * This script fetches each course's page and looks for those markers.
 *
 * Input: a JSON file of candidates, e.g. scripts/courses.candidates.json
 *   [{ "name": "Eaglewood Golf Course", "city": "North Salt Lake",
 *      "url": "https://eaglewoodgolf.com/golf/" }]
 *
 * Usage:
 *   npx tsx scripts/detect-platform.ts candidates.json
 *   npx tsx scripts/detect-platform.ts candidates.json --json
 *   npx tsx scripts/detect-platform.ts candidates.json --prune
 *
 * --prune rewrites the input file with the resolved courses removed, so
 * repeat runs only re-check what's still unknown. Seed the resolved ones
 * before pruning — afterwards their ids live only in prisma/seed.ts.
 *
 * Deliberately sequential with a delay between requests — this is meant
 * to behave like a person clicking through a directory, not to hammer
 * anyone's site. Don't crank the concurrency up.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const DELAY_MS = 1500;

interface Candidate {
  name: string;
  city?: string;
  url: string;
}

interface Detection {
  name: string;
  city?: string;
  url: string;
  platform: "MEMBERSPORTS" | "FOREUP" | "CHRONOGOLF" | "GOLFNOW" | "UNKNOWN" | "ERROR";
  /** For MemberSports: "<golfClubId>:<golfCourseId>", ready for prisma/seed.ts. */
  externalId?: string;
  note?: string;
}

/**
 * MemberSports booking pages look like
 * app.membersports.com/tee-times/<golfClubId>/<golfCourseId>/0 — the two
 * IDs the adapter needs are right there in the URL.
 */
const MEMBERSPORTS_URL = /app\.membersports\.com\/(?:tee-times|custom)\/(\d+)\/(\d+)/i;

/**
 * ForeUp booking pages look like
 * foreupsoftware.com/index.php/booking/<courseId>/<scheduleId>. That's
 * two of the three ids the adapter can use; booking_class isn't in the
 * URL and is optional — see lib/adapters/foreup.ts.
 */
const FOREUP_URL = /foreupsoftware\.com\/index\.php\/booking\/(\d+)\/(\d+)/i;

function detectFromHtml(html: string): { platform: Detection["platform"]; externalId?: string } {
  const ms = html.match(MEMBERSPORTS_URL);
  if (ms) return { platform: "MEMBERSPORTS", externalId: `${ms[1]}:${ms[2]}` };

  // Bare mention without the ID pattern — still MemberSports, but the IDs
  // need to be read off the booking page by hand.
  if (/membersports\.com/i.test(html)) return { platform: "MEMBERSPORTS" };

  const fu = html.match(FOREUP_URL);
  if (fu) {
    // Guard against placeholder/example URLs in page markup: every real
    // Utah ForeUp courseId observed is 4-5 digits (6263 and up), so a
    // tiny id means we matched documentation, not the booking link.
    // Schedule ids legitimately are small (49, 244), so only check the
    // course id.
    const courseId = Number(fu[1]);
    if (courseId >= 100) return { platform: "FOREUP", externalId: `${fu[1]}:${fu[2]}` };
    return { platform: "FOREUP" };
  }

  if (/foreupsoftware\.com|foreup/i.test(html)) return { platform: "FOREUP" };
  if (/chronogolf\.com|lightspeedhq\.com|chronogolf/i.test(html)) return { platform: "CHRONOGOLF" };
  if (/golfnow\.com|teeoff\.com/i.test(html)) return { platform: "GOLFNOW" };

  return { platform: "UNKNOWN" };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | { error: string }> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return { html: await resp.text(), finalUrl: resp.url };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Links that look like they lead to booking. Courses very often don't
 * name their platform on the homepage — the giveaway is one click deeper,
 * behind a "Book a Tee Time" button.
 */
function findBookingLinks(html: string, baseUrl: string): string[] {
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const bookingish = /book|tee[\s-]?time|reserve|reservation|schedule/i;
  const found = new Set<string>();

  for (const match of html.matchAll(anchor)) {
    const [, href, inner] = match;
    const text = inner.replace(/<[^>]*>/g, " ").trim();
    if (!bookingish.test(text) && !bookingish.test(href)) continue;

    try {
      const abs = new URL(href, baseUrl).toString();
      if (/^https?:/i.test(abs)) found.add(abs);
    } catch {
      // malformed href, skip
    }
    if (found.size >= 3) break; // cap the fan-out per course
  }

  return [...found];
}

/**
 * How many clicks past the homepage to chase. Some courses need two:
 * Hobble Creek's homepage links to a golf page, which links again to the
 * actual booking page before the platform ever shows up.
 */
const MAX_DEPTH = 2;

/** Bounds total work per course, so a link-heavy site can't blow up. */
const MAX_PAGES_PER_COURSE = 8;

async function detect(candidate: Candidate): Promise<Detection> {
  const visited = new Set<string>();
  // Queue of pages to check, each remembering the trail that got us there.
  let frontier: { url: string; trail: string[] }[] = [{ url: candidate.url, trail: [] }];
  let firstError: string | undefined;
  let fetched = 0;

  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const next: typeof frontier = [];

    for (const { url, trail } of frontier) {
      if (visited.has(url) || fetched >= MAX_PAGES_PER_COURSE) continue;
      visited.add(url);

      if (fetched > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
      const page = await fetchPage(url);
      fetched++;

      if ("error" in page) {
        // Only the landing page's failure is worth reporting as ERROR;
        // a dead link deeper in just means keep looking.
        if (depth === 0) firstError = page.error;
        continue;
      }

      // The final URL after redirects is itself a strong signal — a booking
      // link often redirects straight to the platform.
      for (const candidateHtml of [page.finalUrl, page.html]) {
        const hit = detectFromHtml(candidateHtml);
        if (hit.platform !== "UNKNOWN") {
          return {
            ...candidate,
            ...hit,
            note: trail.length > 0 ? `via ${trail.join(" -> ")}` : undefined,
          };
        }
      }

      if (depth < MAX_DEPTH) {
        for (const link of findBookingLinks(page.html, page.finalUrl)) {
          if (visited.has(link)) continue;
          next.push({ url: link, trail: [...trail, pathOf(link)] });
        }
      }
    }

    frontier = next;
    if (frontier.length === 0) break;
  }

  if (firstError) return { ...candidate, platform: "ERROR", note: firstError };
  return { ...candidate, platform: "UNKNOWN" };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const prune = args.includes("--prune");
  const file = args.find((a) => !a.startsWith("--")) ?? "candidates.json";

  if (!existsSync(file)) {
    console.error(
      `No such file: ${file}\n` +
        `Run the extractor first:\n` +
        `  npx tsx scripts/extract-directory.ts <directory-url>`
    );
    process.exitCode = 1;
    return;
  }

  const candidates: Candidate[] = JSON.parse(readFileSync(file, "utf8"));
  const results: Detection[] = [];

  for (const [i, candidate] of candidates.entries()) {
    const result = await detect(candidate);
    results.push(result);

    if (!asJson) {
      const id = result.externalId ? `  ${result.externalId}` : "";
      const note = result.note ? `  (${result.note})` : "";
      console.log(
        `[${i + 1}/${candidates.length}] ${result.platform.padEnd(12)} ${result.name}${id}${note}`
      );
    }

    if (i < candidates.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const byPlatform = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\nSummary:", byPlatform);

  const ready = results.filter(
    (r) => r.externalId && (r.platform === "MEMBERSPORTS" || r.platform === "FOREUP")
  );
  if (ready.length > 0) {
    console.log(`\n${ready.length} course(s) with usable IDs — paste into prisma/seed.ts:\n`);
    for (const r of ready) {
      console.log(
        `  {\n    name: ${JSON.stringify(r.name)},\n` +
          (r.city ? `    city: ${JSON.stringify(r.city)},\n` : "") +
          `    platform: ${JSON.stringify(r.platform)},\n` +
          `    externalId: ${JSON.stringify(r.externalId)},\n` +
          `    bookingUrl: ${JSON.stringify(r.url)},\n  },`
      );
    }
    const foreup = ready.filter((r) => r.platform === "FOREUP").length;
    if (foreup > 0) {
      console.log(
        `\nForeUp entries carry courseId:scheduleId only. If a course returns\n` +
          `nothing or wrong pricing, capture its booking_class and append it as\n` +
          `a third segment. Check one with:\n` +
          `  npx tsx scripts/probe.ts foreup <externalId>`
      );
    }
  }

  if (prune) {
    // Drop everything we got ids for, so re-running only re-checks the
    // courses still missing something. Seed the resolved ones first —
    // once they're out of this file, the ids live only in prisma/seed.ts.
    const resolved = new Set(ready.map((r) => r.url));
    const remaining = candidates.filter((c) => !resolved.has(c.url));
    writeFileSync(file, JSON.stringify(remaining, null, 2) + "\n", "utf8");
    console.log(
      `\nPruned ${candidates.length - remaining.length} resolved course(s) from ${file}; ` +
        `${remaining.length} left to work out.`
    );
  }
}

main().catch((err) => {
  console.error("detect failed:", (err as Error).message);
  process.exitCode = 1;
});
