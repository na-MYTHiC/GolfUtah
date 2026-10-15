/**
 * Checks the text size setting can't quietly stop working.
 *
 * Two ways it could, neither of which would throw:
 *
 * The boot script is a string, run before the app exists. If it breaks —
 * a typo, a renamed key, a level added to the table but not here — every
 * launch draws at standard and then jumps once React applies the real
 * size. Nothing errors. It just looks janky, for exactly the people who
 * asked for a bigger app. So it's executed here against a fake page.
 *
 * And the setting only covers what's sized in rem. Every px value in the
 * UI was converted so the whole app scales together; one `text-[13px]`
 * added later would sit at its fixed size while everything around it
 * grows, which is the incohesion this was built to avoid. So the source
 * is scanned for them.
 *
 *   npx tsx scripts/test-density.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DENSITIES, DENSITY_BOOT_SCRIPT } from "../lib/density";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Run the boot script against a stored value; report what it set. */
function boot(stored: string | null, storageThrows = false) {
  const root = { dataset: {} as Record<string, string>, style: { fontSize: "" } };
  const localStorage = {
    getItem: () => {
      if (storageThrows) throw new Error("SecurityError");
      return stored;
    },
  };
  const document = { documentElement: root };
  new Function("localStorage", "document", DENSITY_BOOT_SCRIPT)(localStorage, document);
  return { density: root.dataset.density, fontSize: root.style.fontSize };
}

console.log("boot script");
for (const d of DENSITIES) {
  const got = boot(d.id);
  if (d.scale === 1) {
    // Standard must leave the page exactly as it was before this existed.
    check(`${d.id} sets nothing`, !got.density && !got.fontSize, JSON.stringify(got));
  } else {
    // Close to the scale, and written without floating-point noise.
    const pct = parseFloat(got.fontSize);
    check(
      `${d.id} sets ${got.fontSize} before first paint`,
      got.density === d.id &&
        Math.abs(pct - d.scale * 100) < 0.01 &&
        /^\d+(\.\d{1,2})?%$/.test(got.fontSize),
      JSON.stringify(got)
    );
  }
}
check("nothing stored sets nothing", !boot(null).fontSize);
check("an unknown value sets nothing", !boot("huge").fontSize);
check("blocked storage doesn't throw", !boot(null, true).fontSize);

console.log("\nlevels");
const scales = DENSITIES.map((d) => d.scale);
check("ordered smallest to largest", scales.every((s, i) => i === 0 || s > scales[i - 1]));
check("exactly one standard, at 1", DENSITIES.filter((d) => d.scale === 1).length === 1);
check("ids are unique", new Set(DENSITIES.map((d) => d.id)).size === DENSITIES.length);

console.log("\nevery size in the UI scales");
// Sizes that would stay fixed while the app around them grew. A blur
// radius is an effect, not a size, so it's exempt.
const FIXED = /(?<![\w-])(?!backdrop-blur-)[a-z-]+-\[\d+(?:\.\d+)?px\]/g;
const offenders: string[] = [];
function scan(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) scan(path);
    else if (/\.tsx?$/.test(name)) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(FIXED)) offenders.push(`${path}:${i + 1} ${m[0]}`);
        });
    }
  }
}
scan(new URL("../app", import.meta.url).pathname);
check(
  "no px sizes in app/ — use rem so the text size setting reaches them",
  offenders.length === 0,
  offenders.slice(0, 5).join(", ")
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All text size checks passed.");
}
