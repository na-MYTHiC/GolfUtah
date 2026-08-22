/**
 * Writes the app version into the built service worker.
 *
 * WHY THIS HAS TO EXIST. A browser decides whether there is a new
 * service worker by byte-comparing sw.js against the copy it already
 * has. Identical file, no new worker — no install, no activate, no
 * `controllerchange`, and so no reload. The page can call
 * `registration.update()` as often as it likes and be told nothing has
 * changed, correctly.
 *
 * That was the bug behind "the version isn't updating". sw.js carried a
 * hand-written `golfutah-v2` that had been bumped twice in the app's
 * life, while the app itself shipped sixty-odd versions. Cold starts
 * still picked up new code, because navigations are network-first — but
 * an installed PWA opened from the home screen is *resumed*, not
 * cold-started, and nothing in that path ever noticed a deploy.
 *
 * So the version is stamped in, and every deploy therefore changes
 * sw.js. Bumping APP_VERSION — which is already done by hand with each
 * change — is now all it takes.
 *
 * Runs as part of `npm run build`, after `next build` has copied
 * public/ into out/.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { APP_VERSION } from "../lib/version";

const PLACEHOLDER = "__APP_VERSION__";
const target = process.argv[2] ?? "out/sw.js";

function main() {
  let source: string;
  try {
    source = readFileSync(target, "utf8");
  } catch {
    console.error(`stamp-sw: ${target} not found — did next build run?`);
    process.exitCode = 1;
    return;
  }

  if (!source.includes(PLACEHOLDER)) {
    // Loud rather than silent: a worker whose version never changes is
    // exactly the failure this script exists to prevent, and it would
    // otherwise look like a clean build.
    console.error(
      `stamp-sw: no ${PLACEHOLDER} in ${target}. The service worker would ` +
        `ship with a version that never changes, and updates would stop ` +
        `reaching anyone whose app is already open.`
    );
    process.exitCode = 1;
    return;
  }

  writeFileSync(target, source.split(PLACEHOLDER).join(APP_VERSION));
  console.log(`stamp-sw: ${target} pinned to golfutah-${APP_VERSION}`);
}

main();
