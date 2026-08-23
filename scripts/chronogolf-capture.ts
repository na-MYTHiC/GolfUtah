/**
 * Where Chronogolf keeps the price it won't put in the tee-times list.
 *
 * chronogolf:prices settled the cause and killed the obvious fix in one
 * run. A slot carries exactly one `default_price`, stamped with the one
 * `bookable_holes` it is the rate for, so on a course selling both
 * rounds half the rows come out unpriced — 737 of 1290 priced across
 * every seeded club, 57%. And asking per round changes nothing:
 *
 *   as we ask now:  737/1290 rows priced   57%
 *   asking split:   737/1290 rows priced   57%
 *
 * Identical to the row. The `holes` parameter does not affect which rate
 * comes back, so the missing price is not a request we're getting wrong.
 *
 * It has to exist somewhere: the club's own booking flow quotes the
 * 18-hole round when you pick it. This opens a real slot, clicks through
 * the round choice, and prints every JSON request the page makes along
 * with anything price-shaped in the response — the same trick that found
 * ForeUp's booking classes.
 *
 *   npm run chronogolf:capture -- old-mill-golf-course
 *   npm run chronogolf:capture -- old-mill-golf-course --headed
 *
 * Needs Chromium. Run it through the Probe workflow.
 */

import { chromium, type Browser } from "playwright";
import { COURSES } from "../lib/courses.data";

const BOOKING_BASE = "https://www.chronogolf.com/club";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const WATCH_MS = 20_000;

/** How much of a dumped body to print. Enough to read a rate card. */
const DUMP_CHARS = 6000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

interface Seen {
  url: string;
  /** Price-shaped keys found in the response, with a sample value. */
  prices: string[];
  holes: string[];
}

/** Keys worth reporting, and the ones that would just be noise. */
const PRICE_KEY = /(green_fee|price|rate|fee|amount|total|subtotal)/i;
const HOLES_KEY = /holes/i;

/**
 * Walk a JSON body and collect price-ish and holes-ish leaves. Depth
 * capped because these responses nest and the point is a signal, not a
 * dump.
 */
function harvest(node: unknown, path: string, out: Seen, depth = 0): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    // First two elements only: an array of 60 identical shapes tells us
    // nothing the first one didn't.
    for (const item of node.slice(0, 2)) harvest(item, `${path}[]`, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (typeof value === "number" || typeof value === "string") {
      if (PRICE_KEY.test(key) && out.prices.length < 12) out.prices.push(`${here}=${value}`);
      else if (HOLES_KEY.test(key) && out.holes.length < 8) out.holes.push(`${here}=${value}`);
    } else {
      harvest(value, here, out, depth + 1);
    }
  }
}

/**
 * Click whatever stands between the sheet and a priced round.
 *
 * The order matters for the same reason it did on ForeUp: the round
 * chooser only appears once a slot is picked, so a tee time has to be
 * clicked before "18 holes" exists to click.
 */
async function nudge(page: import("playwright").Page): Promise<string[]> {
  const trail: string[] = [];

  // A tee time button carries a time on it. Take the first one that does
  // rather than guessing at a class name, which would rot.
  const slot = page.getByRole("button", { name: /\d{1,2}:\d{2}/ }).first();
  try {
    if (await slot.isVisible({ timeout: 8000 })) {
      const label = (await slot.innerText()).replace(/\s+/g, " ").trim();
      await slot.click({ timeout: 5000 });
      trail.push(`slot "${label}"`);
      await page.waitForTimeout(3000);
    }
  } catch {
    trail.push("(no tee time button found)");
  }

  // 18 first: the 9 is usually the one already priced, so the 18 is the
  // request worth seeing.
  for (const label of [/18\s*holes?/i, /9\s*holes?/i, /continue|next|book/i]) {
    const button = page.getByRole("button", { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 2500 })) {
        await button.click({ timeout: 4000 });
        trail.push(`"${label.source}"`);
        await page.waitForTimeout(3000);
      }
    } catch {
      // Not on this install, or not clickable yet.
    }
  }
  return trail;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const headed = process.argv.includes("--headed");
  const wanted = args[0];

  const course = COURSES.find(
    (c) => c.platform === "CHRONOGOLF" && (c.slug === wanted || !wanted)
  );
  if (!course) {
    console.error(
      "Usage: npm run chronogolf:capture -- <course-slug>\n" +
        "Seeded Chronogolf slugs:\n" +
        COURSES.filter((c) => c.platform === "CHRONOGOLF")
          .map((c) => `  ${c.slug}`)
          .join("\n")
    );
    process.exit(1);
  }

  const clubSlug = course.externalId.slice(0, course.externalId.indexOf(":"));
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    date,
    step: "teetimes",
    holes: "",
    coursesIds: "",
    deals: "false",
    groupSize: "0",
  });
  const url = `${BOOKING_BASE}/${clubSlug}?${params}`;

  console.log(`${course.name} (${clubSlug})`);
  console.log(`Watching ${url}\n`);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    const seen: Seen[] = [];
    page.on("response", async (resp) => {
      const u = resp.url();
      if (!/chronogolf\.com/.test(u)) return;
      const type = resp.headers()["content-type"] ?? "";
      if (!type.includes("json")) return;

      try {
        const body = await resp.json();
        const entry: Seen = { url: u, prices: [], holes: [] };
        harvest(body, "", entry);
        if (entry.prices.length || entry.holes.length) seen.push(entry);
      } catch {
        // Not parseable, or the body was already consumed. Skip.
      }
    });

    // --dump <substring> prints the raw body of any matching response.
    // The harvester is deliberately shallow, which is right for finding
    // an endpoint and useless for reading one: the first run named
    // /clubs/{id}/products as carrying both 9- and 18-hole entries and
    // then showed none of their prices, because they sit deeper than it
    // looks or under a key it slices past.
    const dump = arg("dump");
    if (dump) {
      page.on("response", async (resp) => {
        if (!resp.url().includes(dump)) return;
        const type = resp.headers()["content-type"] ?? "";
        if (!type.includes("json")) return;
        try {
          const body = await resp.json();
          console.log(`\n=== ${new URL(resp.url()).pathname} ===`);
          console.log(JSON.stringify(body, null, 2).slice(0, DUMP_CHARS));
          console.log("=== end ===\n");
        } catch {
          // Body already consumed or not JSON.
        }
      });
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(5000);
    const trail = await nudge(page);
    await page.waitForTimeout(4000);

    console.log(`clicked: ${trail.length ? trail.join(" -> ") : "(nothing)"}\n`);

    if (seen.length === 0) {
      console.log("No JSON response carried anything price-shaped.\n");
      const title = await page.title().catch(() => "");
      const text = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      console.log(`  page title: ${title || "(none)"}`);
      console.log(`  page says:  ${text.replace(/\s+/g, " ").trim().slice(0, 400)}`);
      const buttons = await page.getByRole("button").allInnerTexts().catch(() => [] as string[]);
      const labels = buttons.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (labels.length) console.log(`  buttons: ${labels.slice(0, 12).join(" | ")}`);
      return;
    }

    console.log(`${seen.length} response(s) carrying prices:\n`);
    for (const s of seen) {
      // The path, not the whole URL: the query is long and the endpoint
      // is what we're hunting for.
      const parsed = new URL(s.url);
      console.log(`  ${parsed.pathname}`);
      console.log(`    query:  ${parsed.search.slice(0, 160) || "(none)"}`);
      if (s.holes.length) console.log(`    holes:  ${s.holes.join("  ")}`);
      if (s.prices.length) console.log(`    price:  ${s.prices.join("  ")}`);
      console.log("");
    }

    console.log("Look for an endpoint that quotes a round the tee-times list");
    console.log("doesn't. If one exists, that's where the missing price lives.");
  } finally {
    await browser?.close();
  }
}

main().catch((err) => {
  console.error("chronogolf:capture failed:", err);
  process.exitCode = 1;
});
