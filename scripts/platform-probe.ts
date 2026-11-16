/**
 * Measures the things the refresh pipeline is built around, instead of
 * assuming them.
 *
 *   1. CHRONOGOLF BATCHING. The adapter asks one club at a time. The
 *      endpoint takes a list of course uuids, so: does it answer for every
 *      Utah club in one request, and can the page size be raised?
 *   2. CHRONOGOLF'S LIMIT. Requests at a steady pace until the first 429,
 *      then how long until it answers again. A count per window, and the
 *      window.
 *   3. CORS. Whether any platform lets a browser on the app's own origin
 *      call it directly, which would allow a live check from the phone.
 *   4. THE PUBLISHED SITE. How stale the CDN copy of the data is, with and
 *      without a cache-busting query.
 *
 *   npm run platform:probe -- [chronogolf|limit|cors|site ...]   (default: all but limit)
 */

import { COURSES } from "../lib/courses.data";
import { getAdapter } from "../lib/adapters";
import { USER_AGENT } from "../lib/adapters/http";
import type { Course } from "@prisma/client";

const ORIGIN = "https://na-mythic.github.io";
const SITE = "https://na-mythic.github.io/GolfUtah";
const CHRONO = "https://www.chronogolf.com/marketplace/v2/teetimes";

const which = new Set(process.argv.slice(2));
const run = (name: string, byDefault = true) => (which.size ? which.has(name) : byDefault);

const day = (offset: number) =>
  new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Denver" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const chronoClubs = COURSES.filter((c) => c.platform === "CHRONOGOLF").map((c) => {
  const at = c.externalId.indexOf(":");
  return { name: c.name, uuids: c.externalId.slice(at + 1).split(",").map((s) => s.trim()) };
});
const allUuids = chronoClubs.flatMap((c) => c.uuids);

async function chrono(params: Record<string, string>) {
  const started = Date.now();
  const resp = await fetch(`${CHRONO}?${new URLSearchParams(params)}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", referer: "https://www.chronogolf.com/" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  let rows: { course: { uuid: string }; start_time: string }[] = [];
  try {
    rows = JSON.parse(text).teetimes ?? [];
  } catch {
    // Not JSON: a refusal page.
  }
  return { resp, rows, ms: Date.now() - started, text };
}

const interesting = (resp: Response) =>
  [...resp.headers]
    .filter(([k]) => /rate|retry|total|per-page|link|x-runtime|cf-cache|age$|cache-control|access-control/i.test(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

async function chronogolfBatching() {
  console.log(`\n=== 1. Chronogolf batching — ${chronoClubs.length} clubs, ${allUuids.length} course uuids ===`);

  for (const offset of [1, 5]) {
    const date = day(offset);
    for (const holes of ["18", "9"]) {
      // One club at a time, the way the adapter does it.
      let perClubRows = 0;
      let perClubRequests = 0;
      const perClub = new Map<string, number>();
      for (const club of chronoClubs) {
        for (let page = 1; page <= 20; page++) {
          const { resp, rows } = await chrono({ start_date: date, course_ids: club.uuids.join(","), holes, page: String(page) });
          perClubRequests++;
          if (resp.status !== 200) {
            console.log(`  per-club ${club.name} p${page}: HTTP ${resp.status}`);
            break;
          }
          for (const r of rows) perClub.set(r.course.uuid, (perClub.get(r.course.uuid) ?? 0) + 1);
          perClubRows += rows.length;
          if (rows.length < 24) break;
          await sleep(1100);
        }
        await sleep(1100);
      }

      // Every club in one request, paged.
      let batchRows = 0;
      let batchRequests = 0;
      const batch = new Map<string, number>();
      let headers = "";
      for (let page = 1; page <= 60; page++) {
        const { resp, rows } = await chrono({ start_date: date, course_ids: allUuids.join(","), holes, page: String(page) });
        batchRequests++;
        if (page === 1) headers = `HTTP ${resp.status} ${interesting(resp)}`;
        if (resp.status !== 200) {
          console.log(`  batch p${page}: HTTP ${resp.status}`);
          break;
        }
        for (const r of rows) batch.set(r.course.uuid, (batch.get(r.course.uuid) ?? 0) + 1);
        batchRows += rows.length;
        if (rows.length < 24) break;
        await sleep(1100);
      }

      const same =
        perClub.size === batch.size && [...perClub].every(([uuid, n]) => batch.get(uuid) === n);
      console.log(
        `${date} holes=${holes}: per-club ${perClubRows} rows in ${perClubRequests} requests; ` +
          `batched ${batchRows} rows in ${batchRequests} requests; ` +
          `${same ? "IDENTICAL per course" : "DIFFERENT"}\n  first batch page: ${headers}`
      );
      if (!same) {
        for (const uuid of new Set([...perClub.keys(), ...batch.keys()])) {
          if (perClub.get(uuid) !== batch.get(uuid)) {
            console.log(`    ${uuid}: per-club ${perClub.get(uuid) ?? 0}, batched ${batch.get(uuid) ?? 0}`);
          }
        }
      }
      await sleep(20000);
    }
  }

  console.log("\n--- page size ---");
  const date = day(5);
  const sizes: Record<string, string>[] = [{ per_page: "100" }, { "per-page": "100" }, { limit: "100" }, { page_size: "100" }];
  for (const extra of sizes) {
    const { resp, rows } = await chrono({ start_date: date, course_ids: allUuids.join(","), holes: "18", page: "1", ...extra });
    console.log(`  ${JSON.stringify(extra)} -> HTTP ${resp.status}, ${rows.length} rows, ${interesting(resp)}`);
    await sleep(1500);
  }

  console.log("\n--- several days in one request? ---");
  const spans: Record<string, string>[] = [{ end_date: day(6) }, { dates: `${day(5)},${day(6)}` }];
  for (const extra of spans) {
    const { resp, rows } = await chrono({ start_date: date, course_ids: chronoClubs[0].uuids.join(","), holes: "18", page: "1", ...extra });
    const dates = new Set(rows.map((r) => (r as unknown as { date: string }).date));
    console.log(`  ${JSON.stringify(extra)} -> HTTP ${resp.status}, ${rows.length} rows, dates ${[...dates].join(",")}`);
    await sleep(1500);
  }
}

async function chronogolfLimit() {
  console.log("\n=== 2. Chronogolf's limit ===");
  const date = day(6);
  const club = chronoClubs[0];
  for (const gapMs of [250, 1000]) {
    const started = Date.now();
    let ok = 0;
    let refusedAt = -1;
    for (let i = 0; i < 150; i++) {
      const { resp } = await chrono({ start_date: date, course_ids: club.uuids.join(","), holes: "18", page: "1" });
      if (resp.status === 429) {
        refusedAt = Date.now() - started;
        console.log(
          `  ${gapMs}ms apart: first 429 at request ${i + 1}, ${(refusedAt / 1000).toFixed(1)}s in. ${interesting(resp)}`
        );
        break;
      }
      ok++;
      await sleep(gapMs);
    }
    if (refusedAt < 0) {
      console.log(`  ${gapMs}ms apart: ${ok} requests, no refusal, ${((Date.now() - started) / 1000).toFixed(1)}s`);
      continue;
    }
    // How long until it answers again, asked every 5s.
    for (let waited = 5; waited <= 120; waited += 5) {
      await sleep(5000);
      const { resp } = await chrono({ start_date: date, course_ids: club.uuids.join(","), holes: "18", page: "1" });
      if (resp.status === 200) {
        const since = (Date.now() - started) / 1000;
        console.log(`    answering again ${waited}s after the refusal, ${since.toFixed(1)}s after the first request`);
        break;
      }
    }
    // Let the window clear before the next pace.
    await sleep(70000);
  }
}

async function cors() {
  console.log(`\n=== 3. CORS, as seen from ${ORIGIN} ===`);
  const real = globalThis.fetch;
  const seen: { url: string; method: string; headers: string[] }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    headers.set("origin", ORIGIN);
    const started = Date.now();
    const resp = await real(url, { ...init, headers });
    const host = new URL(url).hostname;
    console.log(
      `  ${init?.method ?? "GET"} ${host}${new URL(url).pathname.slice(0, 50)} -> ${resp.status} in ${Date.now() - started}ms; ` +
        `allow-origin=${resp.headers.get("access-control-allow-origin") ?? "(none)"}`
    );
    seen.push({ url, method: init?.method ?? "GET", headers: [...headers.keys()] });
    return resp;
  }) as typeof fetch;

  const date = day(2);
  for (const platform of ["FOREUP", "CHRONOGOLF", "MEMBERSPORTS", "TEEITUP", "GOLFPAY"] as const) {
    const seed = COURSES.find((c) => c.platform === platform)!;
    console.log(`${platform} — ${seed.name}`);
    try {
      const times = await getAdapter(platform).fetchTeeTimes(
        { name: seed.name, externalId: seed.externalId, bookingUrl: seed.bookingUrl, platform } as Course,
        { from: date, to: date }
      );
      console.log(`  ${times.length} tee time(s)`);
    } catch (e) {
      console.log(`  failed: ${(e as Error).message}`);
    }
  }
  globalThis.fetch = real;

  console.log("preflights (what a browser sends first when the request carries custom headers)");
  const asked = new Set<string>();
  for (const s of seen) {
    const key = `${s.method} ${new URL(s.url).hostname}`;
    if (asked.has(key)) continue;
    asked.add(key);
    const custom = s.headers.filter((h) => !["accept", "user-agent", "origin", "referer"].includes(h));
    try {
      const resp = await real(s.url, {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": s.method,
          ...(custom.length ? { "access-control-request-headers": custom.join(",") } : {}),
        },
        signal: AbortSignal.timeout(15000),
      });
      console.log(
        `  OPTIONS ${key} [${custom.join(",") || "no custom headers"}] -> ${resp.status}; ` +
          `allow-origin=${resp.headers.get("access-control-allow-origin") ?? "(none)"} ` +
          `allow-headers=${resp.headers.get("access-control-allow-headers") ?? "(none)"}`
      );
    } catch (e) {
      console.log(`  OPTIONS ${key} failed: ${(e as Error).message}`);
    }
  }
}

async function site() {
  console.log("\n=== 4. The published site ===");
  for (const path of ["/data/index.json", `/data/index.json?t=${Date.now()}`, `/data/${day(0)}.json`, "/sw.js", "/"]) {
    try {
      const resp = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(15000) });
      const text = await resp.text();
      let stamp = "";
      try {
        const at = JSON.parse(text).generatedAt;
        if (at) stamp = ` generatedAt ${at} (${Math.round((Date.now() - Date.parse(at)) / 1000)}s ago)`;
      } catch {
        // Not JSON.
      }
      const h = (k: string) => resp.headers.get(k) ?? "-";
      console.log(
        `  ${path.replace(/\?t=\d+/, "?t=…")} -> ${resp.status}, ${text.length} bytes (${h("content-encoding")}), ` +
          `cache-control=${h("cache-control")} age=${h("age")} x-cache=${h("x-cache")} ` +
          `last-modified=${h("last-modified")}${stamp}`
      );
    } catch (e) {
      console.log(`  ${path} failed: ${(e as Error).message}`);
    }
  }
}

async function main() {
  console.log(`now ${new Date().toISOString()}`);
  if (run("site")) await site();
  if (run("cors")) await cors();
  if (run("chronogolf")) await chronogolfBatching();
  if (run("limit", false)) await chronogolfLimit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
