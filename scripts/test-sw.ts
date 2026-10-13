/**
 * Checks which requests the service worker is allowed to answer from
 * cache without asking the network.
 *
 * This exists because getting it wrong is this project's worst failure
 * mode, and it has already happened once: an early worker was cache-first
 * with a cache name that never changed, so a browser that had loaded the
 * site once kept running that build's JavaScript forever, however many
 * times the app was fixed and redeployed. An app whose entire job is
 * showing current information served a frozen copy of itself, silently.
 *
 * Cache-first is now back, but only for URLs that carry a content hash in
 * the filename — where a cached copy provably cannot be stale, because
 * different bytes would mean a different name. Everything that keeps its
 * name across deploys must still reach the network: the document decides
 * which build runs, /data/*.json is the tee times themselves, and sw.js
 * is how a new worker is noticed at all.
 *
 * The split is one substring test, which is exactly the kind of thing
 * that looks obviously right and silently isn't — the paths carry a
 * /GolfUtah/ prefix in production and no prefix locally.
 *
 *   npx tsx scripts/test-sw.ts
 */

import { readFileSync } from "node:fs";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * Pull immutable() out of the worker and run it.
 *
 * Read from the real file rather than copied here, so the test cannot
 * drift away from what actually ships. sw.js is plain script with no
 * exports, and importing it would need a ServiceWorkerGlobalScope.
 */
function loadImmutable(): (url: URL) => boolean {
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const match = /function immutable\(url\) \{[\s\S]*?\n\}/.exec(source);
  if (!match) {
    console.error("FAIL  could not find immutable() in public/sw.js");
    process.exit(1);
  }
  return new Function(`${match[0]}; return immutable;`)() as (url: URL) => boolean;
}

const immutable = loadImmutable();
const served = (path: string) => immutable(new URL(`https://na-mythic.github.io${path}`));

// Cache-first: the name changes whenever the bytes do.
for (const path of [
  "/GolfUtah/_next/static/chunks/08ttfj81-47mu.js",
  "/GolfUtah/_next/static/chunks/3drgg_o7wwi5k.css",
  "/GolfUtah/_next/static/media/caa3a2e1cccd8315-s.p.0wgildi0cnwt9.woff2",
  "/GolfUtah/_next/static/8S7f3BbNqWYveYo4HefW7/_buildManifest.js",
]) {
  check(`cached without asking: ${path.replace("/GolfUtah/_next/static/", "…/")}`, served(path));
}

// The same build served from the domain root, which is what `npm run dev`
// does. A prefix-anchored test would have passed production and broken
// local development, or the reverse.
check(
  "works with no base path, as in dev",
  served("/_next/static/chunks/08ttfj81-47mu.js")
);

// Network-first: these keep their names across deploys, so a cached copy
// can be last week's.
const mustRevalidate: [string, string][] = [
  ["the document", "/GolfUtah/"],
  ["a course page", "/GolfUtah/course/valley-view-golf-course/"],
  ["today's tee times", "/GolfUtah/data/2026-08-24.json"],
  ["tee times with a cache-buster", "/GolfUtah/data/2026-08-24.json?t=1756000000000"],
  ["the ratings file", "/GolfUtah/data/courses.json"],
  ["the data index", "/GolfUtah/data/index.json"],
  ["the worker itself", "/GolfUtah/sw.js"],
  ["the manifest", "/GolfUtah/manifest.webmanifest"],
  ["the icon", "/GolfUtah/favicon.ico"],
];
for (const [name, path] of mustRevalidate) {
  check(`must reach the network: ${name}`, !served(path));
}

// A path that merely mentions the magic words is not a hashed asset. A
// course could be slugged anything, and the test for "can this be stale"
// should not be fooled by one.
check(
  "a lookalike course slug is not treated as immutable",
  !served("/GolfUtah/course/_next-static-golf-club/")
);
check(
  "a query string cannot smuggle a path past it",
  !served("/GolfUtah/data/2026-08-24.json?x=/_next/static/")
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All service worker checks passed.");
}
