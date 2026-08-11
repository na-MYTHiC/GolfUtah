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
 *   npm run detect -- scripts/courses.candidates.json
 *   npm run detect -- scripts/courses.candidates.json --json > found.json
 *
 * Deliberately sequential with a delay between requests — this is meant
 * to behave like a person clicking through a directory, not to hammer
 * anyone's site. Don't crank the concurrency up.
 */
import { readFileSync, existsSync } from "node:fs";

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

function detectFromHtml(html: string): { platform: Detection["platform"]; externalId?: string } {
  const ms = html.match(MEMBERSPORTS_URL);
  if (ms) return { platform: "MEMBERSPORTS", externalId: `${ms[1]}:${ms[2]}` };

  // Bare mention without the ID pattern — still MemberSports, but the IDs
  // need to be read off the booking page by hand.
  if (/membersports\.com/i.test(html)) return { platform: "MEMBERSPORTS" };

  if (/foreupsoftware\.com|foreup/i.test(html)) return { platform: "FOREUP" };
  if (/chronogolf\.com|lightspeedhq\.com|chronogolf/i.test(html)) return { platform: "CHRONOGOLF" };
  if (/golfnow\.com|teeoff\.com/i.test(html)) return { platform: "GOLFNOW" };

  return { platform: "UNKNOWN" };
}

async function detect(candidate: Candidate): Promise<Detection> {
  try {
    const resp = await fetch(candidate.url, {
      redirect: "follow",
      headers: {
        // Identify as a normal browser; some course sites 403 bare fetches.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!resp.ok) {
      return { ...candidate, platform: "ERROR", note: `HTTP ${resp.status}` };
    }

    const html = await resp.text();

    // The final URL after redirects is itself a strong signal — a "Book
    // Tee Time" link often redirects straight to the platform.
    const fromUrl = detectFromHtml(resp.url);
    if (fromUrl.platform !== "UNKNOWN") return { ...candidate, ...fromUrl };

    return { ...candidate, ...detectFromHtml(html) };
  } catch (err) {
    return { ...candidate, platform: "ERROR", note: (err as Error).message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
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

  const ready = results.filter((r) => r.platform === "MEMBERSPORTS" && r.externalId);
  if (ready.length > 0) {
    console.log(`\n${ready.length} MemberSports course(s) with IDs — paste into prisma/seed.ts:\n`);
    for (const r of ready) {
      console.log(
        `  {\n    name: ${JSON.stringify(r.name)},\n` +
          (r.city ? `    city: ${JSON.stringify(r.city)},\n` : "") +
          `    platform: "MEMBERSPORTS",\n` +
          `    externalId: ${JSON.stringify(r.externalId)},\n` +
          `    bookingUrl: ${JSON.stringify(r.url)},\n  },`
      );
    }
  }
}

main().catch((err) => {
  console.error("detect failed:", (err as Error).message);
  process.exitCode = 1;
});
