/**
 * The DevTools capture, automated.
 *
 * RUNBOOK.md's pass 1 ends with "open the booking page, F12, filter on
 * `times`, click through until tee times appear, Copy as cURL". That
 * step exists because a ForeUp booking class appears nowhere except in
 * the widget's own request — not in the page URL, not in the HTML, not
 * in any API this repo has found. It is also the step that needs a
 * human at a laptop, which is why several courses have sat unresolved.
 *
 * A browser can do it. This opens the booking page, watches the network
 * for calls to /api/booking/times, and prints every distinct one with
 * its query broken out. Whatever the widget asks for is what we should
 * be asking for.
 *
 * Written for the courses the audit can't reach any other way: Canyon
 * Breeze returns nothing at all, so there is no row to read a class
 * from and no anchor for a sweep. Thanksgiving Point and The Ridge are
 * the same shape.
 *
 *   npm run foreup:capture -- 21251 7447
 *   npm run foreup:capture -- https://foreupsoftware.com/index.php/booking/21251/7447
 *   npm run foreup:capture -- 21251 7447 --headed
 *
 * Needs Chromium. Run it through the Probe workflow if you're not at a
 * machine that can reach foreupsoftware.com.
 */

import { chromium, type Browser } from "playwright";

const BOOKING = "https://foreupsoftware.com/index.php/booking";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/** How long to sit on the page collecting requests. */
const WATCH_MS = 12_000;

interface Seen {
  bookingClass?: string;
  scheduleId?: string;
  holes?: string;
  date?: string;
  url: string;
}

function parseTarget(args: string[]): { courseId: string; scheduleId: string } {
  const [first, second] = args;
  const m = /\/booking\/(\d+)(?:\/(\d+))?/.exec(first ?? "");
  if (m) return { courseId: m[1], scheduleId: m[2] ?? second ?? "" };
  return { courseId: first ?? "", scheduleId: second ?? "" };
}

/**
 * The widget usually fetches times on load, but some installs wait for
 * a round to be chosen — which is the "two sections, 18 or 9" screen.
 * Clicking those is what reveals a per-round booking class, so they're
 * worth pressing rather than just waiting.
 */
async function nudge(page: import("playwright").Page): Promise<void> {
  const labels = [/18\s*holes?/i, /9\s*holes?/i, /book\s*now/i, /tee\s*times?/i];
  for (const label of labels) {
    const button = page.getByRole("button", { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(2500);
      }
    } catch {
      // Not present on this install, or not clickable. Fine — the next
      // label might be, and the load-time request may already be enough.
    }
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const headed = process.argv.includes("--headed");
  const { courseId, scheduleId } = parseTarget(args);

  if (!courseId) {
    console.error(
      "Usage: npm run foreup:capture -- <courseId> [scheduleId]\n" +
        "       npm run foreup:capture -- <booking URL> [--headed]"
    );
    process.exit(1);
  }

  const url = scheduleId ? `${BOOKING}/${courseId}/${scheduleId}` : `${BOOKING}/${courseId}`;
  console.log(`Watching ${url} for the widget's own times request\n`);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    const seen = new Map<string, Seen>();
    page.on("request", (req) => {
      const u = req.url();
      if (!u.includes("/api/booking/times")) return;
      const q = new URL(u).searchParams;
      const key = `${q.get("schedule_id")}|${q.get("booking_class")}|${q.get("holes")}`;
      if (seen.has(key)) return;
      seen.set(key, {
        bookingClass: q.get("booking_class") ?? undefined,
        scheduleId: q.get("schedule_id") ?? undefined,
        holes: q.get("holes") ?? undefined,
        date: q.get("date") ?? undefined,
        url: u,
      });
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(4000);
    await nudge(page);
    await page.waitForTimeout(WATCH_MS - 4000);

    if (seen.size === 0) {
      console.log("The widget never asked for times.\n");

      // "It didn't ask" is not a diagnosis, and the page usually says
      // why in plain English — closed for the season, pick a course,
      // sign in. Printing it turns a dead end into something actionable
      // without anyone opening a browser.
      const title = await page.title().catch(() => "");
      const text = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const visible = text.replace(/\s+/g, " ").trim().slice(0, 400);

      console.log(`  page title: ${title || "(none)"}`);
      console.log(`  page says:  ${visible || "(nothing rendered)"}`);
      console.log("");

      const buttons = await page
        .getByRole("button")
        .allInnerTexts()
        .catch(() => [] as string[]);
      const labels = buttons.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (labels.length) {
        console.log(`  buttons on the page: ${labels.slice(0, 12).join(" | ")}`);
        console.log("  If one of those is the round or course chooser, it needs clicking");
        console.log("  and nudge() doesn't recognise it yet.");
      } else {
        console.log("  No buttons rendered at all — the page didn't get as far as a widget.");
      }
      return;
    }

    console.log(`${seen.size} distinct times request(s):\n`);
    const classes = new Set<string>();
    const schedules = new Set<string>();

    for (const s of seen.values()) {
      console.log(
        `  schedule_id=${s.scheduleId ?? "(none)"}  ` +
          `booking_class=${s.bookingClass ?? "(none)"}  ` +
          `holes=${s.holes ?? "(none)"}  date=${s.date ?? "(none)"}`
      );
      if (s.bookingClass) classes.add(s.bookingClass);
      if (s.scheduleId) schedules.add(s.scheduleId);
    }

    console.log("");
    if (classes.size === 0) {
      console.log("No booking class in any request — this install doesn't use one,");
      console.log("and an empty response means something else is wrong.");
      return;
    }

    const sched = [...schedules].join(",") || scheduleId;
    console.log(`Seed as:  "${courseId}:${sched}:${[...classes].join(",")}"`);
    if (classes.size > 1) {
      console.log("More than one class — the widget asks per round, so seed them all.");
    }
  } finally {
    await browser?.close();
  }
}

main().catch((err) => {
  console.error("foreup:capture failed:", err);
  process.exitCode = 1;
});
