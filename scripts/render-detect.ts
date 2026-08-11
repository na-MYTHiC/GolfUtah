/**
 * Second-pass detection with a real browser, for courses that plain HTTP
 * fetching can't resolve.
 *
 * Most stubborn courses embed their booking widget instead of linking to
 * it, so the platform never appears in the served HTML — it only shows up
 * once JavaScript runs and the widget starts calling its API. This script
 * loads each page in Chromium and watches the network, which is exactly
 * how the ids were found by hand in DevTools.
 *
 * Usage:
 *   npx tsx scripts/render-detect.ts candidates.json
 *   npx tsx scripts/render-detect.ts candidates.json --out found.json
 *   npx tsx scripts/render-detect.ts candidates.json --headed   # watch it
 *   npx tsx scripts/render-detect.ts --login <url>              # see below
 *
 * Some courses put the tee sheet itself behind a login. For those, run
 * --login <url> once: a browser opens, you sign in by hand, and the
 * resulting session is saved per-host under playwright/.auth (gitignored)
 * and reused automatically. No credentials are typed into or stored by
 * this script — only the session it produces.
 *
 * Needs a browser once:  npx playwright install chromium
 *
 * Slower and heavier than scripts/detect-platform.ts — run that first and
 * point this only at what's left.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { chromium, type Browser, type Page } from "playwright";

/**
 * Where signed-in sessions are kept, one file per host. Gitignored —
 * these are real login sessions and must never be committed.
 */
const AUTH_DIR = "playwright/.auth";

function authFileFor(url: string): string | undefined {
  try {
    return `${AUTH_DIR}/${new URL(url).hostname.replace(/^www\./, "")}.json`;
  } catch {
    return undefined;
  }
}

const NAV_TIMEOUT_MS = 30_000;
/** Time to let the widget's own requests fire after the page settles. */
const SETTLE_MS = 4_000;
const DELAY_BETWEEN_COURSES_MS = 1_500;

interface Candidate {
  name: string;
  city?: string;
  url: string;
  /**
   * Name of the saved session to use, when it isn't this course's own
   * host. Courses that share a booking system share a login — The Ridge
   * and Stonebridge sit on one ForeUp install — so one --login run can
   * cover several courses:
   *   { "name": "Stonebridge Golf Club", "url": "...",
   *     "auth": "golftheridgegc.com" }
   */
  auth?: string;
}

interface Finding {
  name: string;
  city?: string;
  url: string;
  platform: "MEMBERSPORTS" | "FOREUP" | "CHRONOGOLF" | "UNKNOWN" | "ERROR";
  externalId?: string;
  note?: string;
}

/**
 * Patterns matched against every URL the page requests. These are the
 * same calls the booking widgets make — the ForeUp one carries
 * schedule_id, and its Referer/page URL carries the course id.
 */
function matchPlatformUrl(url: string): Partial<Finding> | undefined {
  const ms = url.match(/app\.membersports\.com\/(?:tee-times|custom)\/(\d+)\/(\d+)/i);
  if (ms) return { platform: "MEMBERSPORTS", externalId: `${ms[1]}:${ms[2]}` };

  const msApi = url.match(/api\.membersports\.com\/.*?golfclubs\/(\d+)\/courses\/(\d+)/i);
  if (msApi) return { platform: "MEMBERSPORTS", externalId: `${msApi[1]}:${msApi[2]}` };

  const fu = url.match(/foreupsoftware\.com\/index\.php\/booking\/(\d+)\/(\d+)/i);
  if (fu && Number(fu[1]) >= 100) return { platform: "FOREUP", externalId: `${fu[1]}:${fu[2]}` };

  const fuApi = url.match(/foreupsoftware\.com\/index\.php\/api\/booking\/times\?(.+)/i);
  if (fuApi) {
    const params = new URLSearchParams(fuApi[1]);
    const scheduleId = params.get("schedule_id");
    if (scheduleId) {
      return { platform: "FOREUP", note: `schedule_id=${scheduleId} (course_id not in this call)` };
    }
  }

  const cg = url.match(/club_id=(\d+)[^&]*&(?:.*&)?course_id=(\d+)/i);
  if (cg) return { platform: "CHRONOGOLF", note: `club_id=${cg[1]} course_id=${cg[2]}` };

  if (/chronogolf\.com|lightspeedhq\.com/i.test(url)) return { platform: "CHRONOGOLF" };
  if (/membersports\.com/i.test(url)) return { platform: "MEMBERSPORTS" };
  if (/foreupsoftware\.com/i.test(url)) return { platform: "FOREUP" };

  return undefined;
}

/** Click a booking-looking control, since some widgets load only on demand. */
async function nudgeBookingUi(page: Page): Promise<void> {
  const patterns = [/book.*tee.*time/i, /tee.*times?/i, /book.*now/i, /reserve/i];
  for (const pattern of patterns) {
    const link = page.getByRole("link", { name: pattern }).first();
    const button = page.getByRole("button", { name: pattern }).first();
    for (const target of [link, button]) {
      try {
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

async function inspect(browser: Browser, candidate: Candidate): Promise<Finding> {
  // Reuse a signed-in session if one was captured with --login. Some
  // courses (The Ridge, Stonebridge) put their tee sheet behind a login,
  // so without this they can never be resolved. `auth` lets courses on a
  // shared booking system reuse one session.
  const authFile = candidate.auth
    ? `${AUTH_DIR}/${candidate.auth.replace(/^www\./, "").replace(/\.json$/, "")}.json`
    : authFileFor(candidate.url);
  const storageState = authFile && existsSync(authFile) ? authFile : undefined;

  if (candidate.auth && !storageState) {
    console.warn(`  (no saved session at ${authFile} — run --login first)`);
  }

  const context = await browser.newContext({
    storageState,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Best hit wins: one carrying ids beats a bare platform sighting.
  let best: Partial<Finding> | undefined;
  const consider = (hit: Partial<Finding> | undefined) => {
    if (!hit) return;
    if (!best || (!best.externalId && (hit.externalId || (!best.note && hit.note)))) best = hit;
  };

  page.on("request", (req) => consider(matchPlatformUrl(req.url())));
  page.on("framenavigated", (frame) => consider(matchPlatformUrl(frame.url())));

  try {
    await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);

    if (!best?.externalId) {
      // Iframed widgets expose the platform in the frame's own URL.
      for (const frame of page.frames()) consider(matchPlatformUrl(frame.url()));
    }
    if (!best?.externalId) {
      await nudgeBookingUi(page);
      for (const frame of page.frames()) consider(matchPlatformUrl(frame.url()));
    }
    if (!best?.externalId) {
      consider(matchPlatformUrl(await page.content()));
    }

    return { ...candidate, platform: "UNKNOWN", ...best } as Finding;
  } catch (err) {
    // A navigation timeout after a platform sighting still counts.
    if (best) return { ...candidate, platform: "UNKNOWN", ...best } as Finding;
    return { ...candidate, platform: "ERROR", note: (err as Error).message.split("\n")[0] };
  } finally {
    await context.close();
  }
}

/**
 * Open a real browser, let the operator sign in by hand, then save the
 * session for later runs. Credentials are never typed here or stored —
 * only the resulting cookies/localStorage, under playwright/.auth
 * (gitignored).
 */
async function captureLogin(url: string): Promise<void> {
  const authFile = authFileFor(url);
  if (!authFile) {
    console.error(`Not a valid URL: ${url}`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({
    headless: false, // the whole point is to let a person sign in
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

  console.log(
    `\nA browser window is open at ${url}.\n` +
      `Sign in there, navigate to the tee sheet, then come back here.\n`
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter once you're signed in... ");
  rl.close();

  mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: authFile });
  await browser.close();

  console.log(`Saved session to ${authFile}. Future runs against this host will reuse it.`);
}

async function main() {
  const args = process.argv.slice(2);

  const loginIdx = args.indexOf("--login");
  if (loginIdx >= 0) {
    const url = args[loginIdx + 1];
    if (!url) {
      console.error("Usage: npx tsx scripts/render-detect.ts --login <url>");
      process.exitCode = 1;
      return;
    }
    await captureLogin(url);
    return;
  }

  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const outValueIdx = outIdx >= 0 ? outIdx + 1 : -1;
  const file =
    args.find((a, i) => !a.startsWith("--") && i !== outValueIdx) ?? "candidates.json";

  if (!existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exitCode = 1;
    return;
  }

  const candidates: Candidate[] = JSON.parse(readFileSync(file, "utf8"));

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: !args.includes("--headed"),
      // Escape hatch for environments that ship a browser Playwright's
      // own version pinning won't find (CI images, sandboxes).
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
  } catch (err) {
    console.error(
      `Could not launch Chromium: ${(err as Error).message}\n\n` +
        `Install it once with:  npx playwright install chromium\n` +
        `Or point at an existing binary:  CHROMIUM_PATH=/path/to/chrome`
    );
    process.exitCode = 1;
    return;
  }

  const results: Finding[] = [];
  try {
    for (const [i, candidate] of candidates.entries()) {
      const result = await inspect(browser, candidate);
      results.push(result);

      const id = result.externalId ? `  ${result.externalId}` : "";
      const note = result.note ? `  (${result.note})` : "";
      console.log(
        `[${i + 1}/${candidates.length}] ${result.platform.padEnd(12)} ${result.name}${id}${note}`
      );

      if (i < candidates.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_COURSES_MS));
      }
    }
  } finally {
    await browser.close();
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\nSummary:", summary);

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n", "utf8");
    console.log(`Wrote ${outFile}`);
  }

  const ready = results.filter(
    (r) => r.externalId && (r.platform === "MEMBERSPORTS" || r.platform === "FOREUP")
  );
  if (ready.length > 0) {
    console.log(`\n${ready.length} course(s) with usable ids — paste into prisma/seed.ts:\n`);
    for (const r of ready) {
      console.log(
        `  {\n    name: ${JSON.stringify(r.name)},\n` +
          (r.city ? `    city: ${JSON.stringify(r.city)},\n` : "") +
          `    platform: ${JSON.stringify(r.platform)},\n` +
          `    externalId: ${JSON.stringify(r.externalId)},\n` +
          `    bookingUrl: ${JSON.stringify(r.url)},\n  },`
      );
    }
  }

  const partial = results.filter((r) => !r.externalId && r.note);
  if (partial.length > 0) {
    console.log(`\n${partial.length} course(s) identified but missing ids:`);
    for (const r of partial) console.log(`  ${r.name}: ${r.platform} — ${r.note}`);
  }
}

main().catch((err) => {
  console.error("render-detect failed:", (err as Error).message);
  process.exitCode = 1;
});
