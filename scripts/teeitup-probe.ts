/**
 * Why TeeItUp answers 403, and what it wants instead.
 *
 * Every build since at least 14 Oct 2026 has logged, for all four Utah
 * State Parks courses on every day:
 *
 *   failed (4): Wasatch Mountain, Soldier Hollow, Green River, Palisade
 *     TeeItUp request failed: HTTP 403
 *
 * The adapter's request was captured from the booking site in August and
 * worked then. A 403 means the API now refuses that request — a header
 * it wants, a host it moved to, or a client it no longer trusts — and
 * which of those can't be told from the status alone. So this asks both
 * ways, from the same machine the builds run on:
 *
 *  1. The adapter's own request, then variations of it, each printing
 *     status, the headers that identify what answered, and the start of
 *     the body. A WAF and the API itself refuse in different words.
 *
 *  2. The real booking site in a browser, recording every request it
 *     makes to the tee-times API: the URL, every request header, and the
 *     status. If the browser gets 200 where the adapter gets 403, the
 *     difference between the two requests is the fix.
 *
 *   npm run teeitup:probe -- [alias] [facilityIds] [date]
 *   (defaults: aspira-management-company 17070,17067 tomorrow)
 */

import { chromium } from "playwright";
import { USER_AGENT as ADAPTER_UA } from "../lib/adapters/http";

const API = "https://phx-api-be-east-1b.kenna.io/v2/tee-times";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const [alias = "aspira-management-company", facilityIds = "17070,17067", dateArg] = process.argv.slice(2);
const date =
  dateArg ??
  new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
const site = `https://${alias}.book-v2.teeitup.golf`;

async function attempt(name: string, url: string, headers: Record<string, string>) {
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const body = await resp.text();
    const tell = ["server", "via", "x-cache", "x-amz-cf-id", "x-amzn-errortype", "cf-ray", "content-type"]
      .map((h) => (resp.headers.get(h) ? `${h}=${resp.headers.get(h)}` : ""))
      .filter(Boolean)
      .join(" ");
    console.log(`\n[${resp.status}] ${name}\n  ${tell}\n  body: ${body.slice(0, 300).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`\n[ERR] ${name}: ${(e as Error).message}`);
  }
}

async function main() {
  console.log(`alias=${alias} facilityIds=${facilityIds} date=${date}`);

  const query = new URLSearchParams({ date, facilityIds, returnPromotedRates: "true" });
  const base = {
    accept: "application/json, text/plain, */*",
    origin: site,
    referer: `${site}/`,
    "x-be-alias": alias,
  };

  console.log("\n=== 1. direct requests ===");
  await attempt("as the adapter sends it", `${API}?${query}`, { ...base, "user-agent": ADAPTER_UA });
  await attempt("browser user-agent", `${API}?${query}`, { ...base, "user-agent": BROWSER_UA });
  await attempt("no origin/referer", `${API}?${query}`, {
    accept: base.accept,
    "x-be-alias": alias,
    "user-agent": BROWSER_UA,
  });
  await attempt("booking site itself", `${site}/`, { "user-agent": BROWSER_UA });

  console.log("\n=== 2. the booking site in a browser ===");
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: BROWSER_UA });
  const seen: string[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (!/kenna\.io|teeitup/.test(url) || /\.(js|css|png|svg|woff2?|ico)(\?|$)/.test(url)) return;
    if (!url.includes("kenna.io")) return;
    seen.push(url);
    console.log(`\n-> ${req.method()} ${url}`);
    for (const [k, v] of Object.entries(req.headers())) {
      // Long opaque values are printed in part; the name is what matters.
      console.log(`   ${k}: ${v.length > 120 ? `${v.slice(0, 60)}…(${v.length} chars)` : v}`);
    }
  });
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("kenna.io")) return;
    let snippet = "";
    try {
      snippet = (await resp.text()).slice(0, 200).replace(/\s+/g, " ");
    } catch {
      snippet = "(no body)";
    }
    console.log(`<- ${resp.status()} ${url.split("?")[0]}\n   ${snippet}`);
  });

  const firstFacility = facilityIds.split(",")[0];
  await page.goto(`${site}/?course=${firstFacility}&date=${date}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(15000);
  console.log(`\npage title: ${await page.title()}`);
  console.log(`visible text: ${(await page.locator("body").innerText()).slice(0, 600).replace(/\s+/g, " ")}`);
  console.log(`\n${seen.length} request(s) to kenna.io`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
