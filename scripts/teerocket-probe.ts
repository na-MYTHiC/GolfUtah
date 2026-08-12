/**
 * Works out how to read tee times out of TeeRocket (Schneiter's).
 *
 * TeeRocket is the one platform here with no callable JSON endpoint. Its
 * widget is a Firebase client, its data arrives over Firestore's
 * streaming channel, and the REST API refuses anonymous reads:
 *
 *   GET .../documents/group/YFlPUck58D81fB5Kqqa8/course/BH4MnB2co04ve5At3aQl
 *   -> 403 PERMISSION_DENIED
 *
 * That leaves two possible adapters, and this decides between them
 * rather than guessing:
 *
 *  A. Sign in anonymously the way the widget does, then call the REST
 *     API with the resulting token. Cheap to run, but only viable if
 *     anonymous auth is really all the rules want.
 *  B. Drive a browser and read the rendered page. Always works, but
 *     costs a real page load per course on every refresh.
 *
 * So it records three things:
 *
 *  - whether an anonymous sign-in happens, and the Firebase API key it
 *    uses (public by design — it identifies the project, it isn't a
 *    secret, and it's needed to reproduce the sign-in)
 *  - the Firestore Listen channel's request bodies, which carry the
 *    document paths and queries the widget asks for. That's the data
 *    model, and it's what either adapter needs to know.
 *  - the rendered text once times are on screen, so option B can be
 *    written against something real instead of guessed selectors.
 *
 * Tokens are redacted: the point is to learn the shape of the exchange,
 * and a real credential in a pasted log helps nobody.
 *
 * Usage:
 *   npx tsx scripts/teerocket-probe.ts            # both Schneiter's courses
 *   npx tsx scripts/teerocket-probe.ts <url> ...
 *   npx tsx scripts/teerocket-probe.ts --headed   # watch it
 *
 * Writes teerocket-probe.json. Send that back.
 */
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const DEFAULT_TARGETS = [
  "https://schneitersgolf.com/",
  "https://schneitersgolf.com/riverside-course/",
];

const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 6_000;
/** Long enough for the widget to sign in and stream a day's times. */
const WATCH_MS = 20_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/**
 * Strips anything that would be a live credential if pasted into a chat.
 * Firebase API keys are deliberately *not* redacted — they identify the
 * project rather than authorise anyone, and reproducing the sign-in
 * needs one.
 */
function redact(text: string): string {
  return text
    .replace(/"(idToken|refreshToken|access_token|id_token)":"[^"]*"/g, '"$1":"<redacted>"')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<jwt-redacted>");
}

interface Probe {
  target: string;
  widgetUrl?: string;
  /**
   * Every identitytoolkit call, in order. Keeping only the last one hid
   * the interesting half: the first run reported `accounts:lookup`,
   * which reads an existing account, when what matters is whether an
   * `accounts:signUp` preceded it — that's the anonymous sign-in an
   * adapter would have to reproduce.
   */
  auth: { endpoint: string; apiKey?: string; status: number }[];
  /** Firestore channel calls, with their request bodies. */
  firestore: { url: string; method: string; body?: string }[];
  /** Anything that looked like a plain JSON API, which would be simplest. */
  otherJson: string[];
  /** Rendered text once the widget has drawn something. */
  renderedText?: string;
  /** Elements that look like tee times, for writing selectors against. */
  timeishHtml?: string[];
  note?: string;
}

async function probe(page: Page, target: string): Promise<Probe> {
  const found: Probe = { target, auth: [], firestore: [], otherJson: [] };

  page.on("request", (req) => {
    const url = req.url();

    if (/identitytoolkit\.googleapis\.com/.test(url)) {
      found.auth.push({
        endpoint: url.split("?")[0],
        apiKey: new URL(url).searchParams.get("key") ?? undefined,
        status: 0,
      });
    }

    if (/firestore\.googleapis\.com/.test(url)) {
      // The Listen channel's body carries the queries the widget runs —
      // collection paths, filters, ordering. That's the data model.
      const body = req.postData();
      found.firestore.push({
        url: url.length > 500 ? `${url.slice(0, 500)}…` : url,
        method: req.method(),
        body: body ? redact(body).slice(0, 4_000) : undefined,
      });
    }

    // A plain JSON API would make all of this moot, so it's worth
    // noticing if one exists alongside the Firebase traffic.
    if (
      /\/(api|v\d)\//.test(url) &&
      !/google|gstatic|firebase|stripe|doubleclick|analytics/.test(url)
    ) {
      found.otherJson.push(url);
    }
  });

  page.on("response", (resp) => {
    const entry = found.auth.find((a) => resp.url().startsWith(a.endpoint) && !a.status);
    if (entry) entry.status = resp.status();
  });

  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);

    // The widget is usually embedded in an iframe or linked to; either
    // way its address carries the course path we need.
    const widgetUrl = (
      await page.$$eval("iframe[src], a[href]", (els) =>
        els.map((e) => (e as HTMLIFrameElement).src || (e as HTMLAnchorElement).href)
      )
    ).find((u) => /trwidget\.web\.app/i.test(u));

    if (widgetUrl) {
      found.widgetUrl = widgetUrl;
      await page
        .goto(widgetUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
        .catch(() => undefined);
    }

    // Let it sign in and stream a day's times.
    await page.waitForTimeout(WATCH_MS);

    found.renderedText = (await page.evaluate(() => document.body.innerText))
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 6_000);

    // Anything shaped like a clock time, with its markup — enough to
    // write real selectors against rather than guessing.
    found.timeishHtml = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode() as HTMLElement | null;
      while (node && out.length < 12) {
        const text = (node.textContent ?? "").trim();
        if (
          /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(text) &&
          text.length < 200 &&
          node.children.length <= 6
        ) {
          out.push(node.outerHTML.slice(0, 800));
        }
        node = walker.nextNode() as HTMLElement | null;
      }
      return out;
    });
  } catch (err) {
    found.note = (err as Error).message.split("\n")[0];
  }

  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes("--headed");
  const targets = args.filter((a) => !a.startsWith("--"));

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  const results: Probe[] = [];
  try {
    for (const target of targets.length ? targets : DEFAULT_TARGETS) {
      process.stdout.write(`${target} ... `);
      const context = await browser.newContext({ userAgent: UA, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const result = await probe(page, target);
      await context.close();

      console.log(
        result.note
          ? `error: ${result.note}`
          : `widget=${result.widgetUrl ? "yes" : "no"} ` +
              `auth=${result.auth.length ? result.auth.map((a) => a.status).join("/") : "none"} ` +
              `firestore=${result.firestore.length} ` +
              `times=${result.timeishHtml?.length ?? 0}`
      );
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  writeFileSync("teerocket-probe.json", JSON.stringify(results, null, 2));
  console.log(`\nWrote teerocket-probe.json — send that back.`);

  for (const r of results) {
    if (!r.auth.length && !r.widgetUrl) continue;
    console.log(`\n${r.target}`);
    if (r.widgetUrl) console.log(`  widget: ${r.widgetUrl}`);
    for (const a of r.auth) console.log(`  auth: ${a.endpoint} (HTTP ${a.status})`);
    const key = r.auth.find((a) => a.apiKey)?.apiKey;
    if (key) console.log(`  firebase api key: ${key}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
