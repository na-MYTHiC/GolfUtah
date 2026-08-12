/**
 * Course facts from OpenStreetMap — free, no key, no card.
 *
 * OSM maps golf courses as `leisure=golf_course`, and mappers often tag
 * the things worth knowing: hole count, par, the course's own website,
 * sometimes the architect. That's most of what lib/course-profiles.ts
 * holds, and unlike reviews it's public domain data anyone may use.
 *
 * What OSM cannot give is reviews — nobody writes them there. See the
 * course page for how that's handled without an API.
 *
 * Queries Overpass, which is donated infrastructure: one course at a
 * time, with a pause, and a User-Agent identifying the app. Bulk
 * hammering is how public endpoints get closed to everyone.
 *
 *   npm run osm                 # print what OSM knows
 *   npm run osm -- --out osm.json
 *
 * The output is deliberately NOT merged into course-profiles.ts
 * automatically. OSM tags are contributed by anyone and occasionally
 * wrong; they're a starting point for a human to accept, not a source to
 * trust blindly into the app.
 */
import { writeFileSync } from "node:fs";
import { COURSES } from "../lib/courses.data";

const OVERPASS = "https://overpass-api.de/api/interpreter";

/** Overpass is donated infrastructure — this is the polite pace. */
const DELAY_MS = 2_000;

/** How far from the seeded coordinates to look, in metres. */
const RADIUS_M = 2_500;

interface OsmTags {
  name?: string;
  holes?: string;
  par?: string;
  website?: string;
  "addr:city"?: string;
  architect?: string;
  designer?: string;
  golf_course?: string;
  access?: string;
  "course:type"?: string;
}

interface Found {
  slug: string;
  seedName: string;
  osmName?: string;
  holes?: number;
  par?: number;
  website?: string;
  designer?: string;
  access?: string;
  note?: string;
}

async function lookup(lat: number, lon: number): Promise<OsmTags | null> {
  // Both ways and relations: a course is usually a way, but larger ones
  // are mapped as a multipolygon relation.
  const query = `
    [out:json][timeout:25];
    (
      way["leisure"="golf_course"](around:${RADIUS_M},${lat},${lon});
      relation["leisure"="golf_course"](around:${RADIUS_M},${lat},${lon});
    );
    out tags;
  `;

  const resp = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // Overpass asks that clients identify themselves.
      "user-agent": "GolfUtah/1.0 (course metadata; https://github.com/na-MYTHiC/GolfUtah)",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = (await resp.json()) as { elements?: { tags?: OsmTags }[] };
  return data.elements?.[0]?.tags ?? null;
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : undefined;
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;

  const results: Found[] = [];

  for (const seed of COURSES) {
    process.stdout.write(`${seed.name} ... `);
    try {
      const tags = await lookup(seed.latitude, seed.longitude);
      if (!tags) {
        console.log("not found");
        results.push({ slug: seed.slug, seedName: seed.name, note: "no OSM course nearby" });
      } else {
        const found: Found = {
          slug: seed.slug,
          seedName: seed.name,
          osmName: tags.name,
          holes: toNumber(tags.holes),
          par: toNumber(tags.par),
          website: tags.website,
          designer: tags.architect ?? tags.designer,
          access: tags.access,
        };
        const bits = [
          found.osmName,
          found.holes && `${found.holes} holes`,
          found.par && `par ${found.par}`,
          found.designer,
        ].filter(Boolean);
        console.log(bits.length ? bits.join(" · ") : "found, but untagged");
        results.push(found);
      }
    } catch (err) {
      console.log(`error: ${(err as Error).message}`);
      results.push({ slug: seed.slug, seedName: seed.name, note: (err as Error).message });
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const useful = results.filter((r) => r.holes || r.par || r.designer);
  console.log(`\n${useful.length} of ${results.length} courses had usable tags.`);

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`Wrote ${outFile}`);
  }
  console.log(
    `\nNothing was written into lib/course-profiles.ts. OSM tags are\n` +
      `contributed by anyone and occasionally wrong — read these, then add\n` +
      `the ones worth keeping by hand.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
