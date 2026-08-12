/**
 * Downloads one Google Places photo per course into public/photos.
 *
 * Run by hand, and the results are committed. It is deliberately NOT
 * part of the scheduled build, and that distinction is worth the space
 * to explain.
 *
 * The build runs every five minutes. Each Actions run starts from a
 * fresh clone, so anything gitignored is absent and gets fetched again —
 * which would mean re-downloading forty-odd photos 288 times a day, on
 * a metered Google SKU, for images that never change. Committing them
 * makes them what they actually are: static assets, fetched once.
 *
 *   npm run photos            # only courses without a photo yet
 *   npm run photos -- --force # refetch everything
 *
 * Needs GOOGLE_PLACES_API_KEY in the environment (a .env file works).
 * Then commit whatever lands in public/photos.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { COURSES } from "../lib/courses.data";
import { getPlaceInfo, downloadPhoto, placesEnabled } from "../lib/places";

const OUT_DIR = "public/photos";

/** Courtesy pause between courses, as everywhere else in this repo. */
const DELAY_MS = 300;

async function main() {
  if (!placesEnabled()) {
    console.error(
      "GOOGLE_PLACES_API_KEY is not set.\n" +
        "Put it in .env, or export it, then run this again."
    );
    process.exitCode = 1;
    return;
  }

  const force = process.argv.includes("--force");
  mkdirSync(OUT_DIR, { recursive: true });

  let saved = 0;
  let skipped = 0;
  let missing = 0;

  for (const seed of COURSES) {
    const target = `${OUT_DIR}/${seed.slug}.jpg`;
    if (!force && existsSync(target)) {
      skipped++;
      continue;
    }

    process.stdout.write(`${seed.name} ... `);
    const info = await getPlaceInfo(seed.name, seed.city);

    if (!info?.photoName) {
      console.log("no photo");
      missing++;
    } else {
      const bytes = await downloadPhoto(info.photoName);
      if (bytes) {
        writeFileSync(target, bytes);
        console.log(`saved (${Math.round(bytes.length / 1024)} KB)`);
        saved++;
      } else {
        console.log("download failed");
        missing++;
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(
    `\n${saved} saved, ${skipped} already present, ${missing} without a photo.`
  );
  if (saved > 0) {
    console.log(`Commit ${OUT_DIR} so the build doesn't fetch them again.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
