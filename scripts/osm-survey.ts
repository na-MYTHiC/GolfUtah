/**
 * Every golf course in Utah, from OpenStreetMap, diffed against what's
 * seeded.
 *
 * WHY NOT JUST LIST THEM. Candidates were being added from memory, and
 * memory is wrong in both directions. It invented courses that needed a
 * page load each to disprove, and it offered East Bay as a gap when East
 * Bay is Timpanogos renamed and had been seeded for weeks. A survey built
 * on recall can't tell a missing course from one you've already got under
 * a different name.
 *
 * OSM can. It's a real source, free, no key, and it carries the two
 * things that settle both questions: coordinates, and often the course's
 * own website. Coordinates are what catch a rename — Timpanogos sits
 * where East Bay sits, so proximity matches it even though the names
 * share not one word.
 *
 *   npm run osm:utah
 *   npm run osm:utah -- --out utah-courses.json
 *   npm run osm:utah -- --include-private
 *
 * ONE request to Overpass, not one per course. That endpoint is donated
 * infrastructure, and a statewide query is cheaper for them than sixty
 * small ones.
 *
 * The output is a starting point, not gospel. OSM is contributed by
 * anyone: a course can be missing, closed-but-still-mapped, or tagged as
 * a course when it's a driving range. Read the list before acting on it.
 */
import { writeFileSync } from "node:fs";
import { COURSES } from "../lib/courses.data";
import { distanceMiles } from "../lib/format";

const OVERPASS = "https://overpass-api.de/api/interpreter";

const UA = "GolfUtahBot/1.0 (+https://na-mythic.github.io/GolfUtah; course survey)";

/**
 * How close counts as the same course. Generous on purpose: OSM's centre
 * for a sprawling 18 can sit a good way from the clubhouse the seeded
 * coordinates point at, and the seeded ones are city-level
 * approximations anyway. Two *different* courses closer together than
 * this is rare enough to be worth the manual check the output asks for.
 */
const SAME_COURSE_MILES = 1.2;

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(golf|course|club|links|the|at|of|and|cc|country)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Same course, allowing for one name being longer than the other.
 *
 * Exact normalized equality was too strict by exactly one word, and it
 * put six courses already in the app onto the missing list: OSM calls
 * them Palisade *State Park*, Roosevelt *Municipal*, Wasatch Mountain
 * *State*, Wolf Creek (seeded as Wolf Creek *Resort*), and — best of all
 * — *Pro Shop at* Eagle Mountain. Containment catches every one.
 *
 * The length floor is what stops it going the other way: without it
 * "oaks" would match anything with oaks in its name.
 */
const MIN_CONTAINMENT = 6;

function sameName(a: string, b: string): boolean {
  const [x, y] = [norm(a), norm(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_CONTAINMENT && long.includes(short);
}

/**
 * Members-only. The app has nothing to show for a course the public
 * can't book, so these are reported separately rather than as gaps.
 *
 * `access` is the standard tag; `golf_course=private` and
 * `membership=members_only` show up too. None is reliably present, so a
 * course missing all three is treated as public and may not be.
 */
function isPrivate(tags: Record<string, string>): boolean {
  return (
    ["private", "members", "no"].includes(tags.access ?? "") ||
    tags.golf_course === "private" ||
    tags.membership === "members_only"
  );
}

function cleanUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const markdown = /\]\((https?:\/\/[^)]+)\)/.exec(raw);
  const url = markdown?.[1] ?? raw.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
}

/** Ranges and mini-golf get mapped as courses often enough to matter. */
function isNotACourse(tags: Record<string, string>): boolean {
  const name = (tags.name ?? "").toLowerCase();
  return (
    tags.golf === "driving_range" ||
    tags["course:type"] === "miniature" ||
    /driving range|mini golf|miniature|foot ?golf|disc golf|topgolf/.test(name)
  );
}

async function main() {
  const includePrivate = process.argv.includes("--include-private");
  const outFile = arg("out", "");

  // ISO3166-2 rather than name="Utah": there is more than one place
  // called Utah, and admin_level alone would match a county.
  const query = `
    [out:json][timeout:120];
    area["ISO3166-2"="US-UT"]->.utah;
    (
      way["leisure"="golf_course"](area.utah);
      relation["leisure"="golf_course"](area.utah);
      node["leisure"="golf_course"](area.utah);
    );
    out center tags;
  `;

  console.log("Asking Overpass for every golf course in Utah…\n");

  const resp = await fetch(OVERPASS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(180_000),
  });

  if (!resp.ok) {
    console.error(`Overpass returned HTTP ${resp.status}.`);
    if (resp.status === 429 || resp.status === 504) {
      console.error("That endpoint is rate-limited and shared — wait a minute and retry.");
    }
    process.exitCode = 1;
    return;
  }

  const body = (await resp.json()) as { elements?: OsmElement[] };
  const elements = body.elements ?? [];

  interface Found {
    name: string;
    lat: number;
    lon: number;
    city?: string;
    website?: string;
    holes?: string;
    private: boolean;
  }

  const found: Found[] = [];
  const unnamed: number[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    if (isNotACourse(tags)) continue;
    if (!tags.name) {
      unnamed.push(el.id);
      continue;
    }
    found.push({
      name: tags.name,
      lat,
      lon,
      city: tags["addr:city"],
      // One Utah entry has its website tagged as markdown:
      // "[www.SunRiverGolf.com](https://www.SunRiverGolf.com)". Take the
      // target, since that's the only half that is a URL.
      website: cleanUrl(tags.website ?? tags["contact:website"]),
      holes: tags.holes,
      private: isPrivate(tags),
    });
  }

  // Deduplicate: a course mapped as both a way and a relation appears
  // twice, and the two copies sit on top of each other.
  const unique: Found[] = [];
  for (const f of found) {
    const dupe = unique.find(
      (u) => norm(u.name) === norm(f.name) && distanceMiles(u.lat, u.lon, f.lat, f.lon) < 1
    );
    if (!dupe) unique.push(f);
  }

  const missing: Found[] = [];
  const matched: { osm: Found; seeded: string }[] = [];
  const ambiguous: { osm: Found; seeded: string; miles: number }[] = [];

  for (const f of unique) {
    const byName = COURSES.find((c) => sameName(c.name, f.name));
    if (byName) {
      matched.push({ osm: f, seeded: byName.name });
      continue;
    }

    // Nothing matched on name. Position alone is a hint, not an answer:
    // it correctly spots a rename, but it also paired Nibley Park with
    // Forest Dale, and Homestead with Wasatch Mountain — different
    // courses that happen to be neighbours. Counting those as seeded
    // silently hid Homestead, which really is missing. So they get their
    // own bucket and stay in the missing list.
    const near = COURSES.map((c) => ({
      c,
      miles: distanceMiles(c.latitude, c.longitude, f.lat, f.lon),
    })).sort((a, b) => a.miles - b.miles)[0];

    if (near && near.miles < SAME_COURSE_MILES) {
      ambiguous.push({ osm: f, seeded: near.c.name, miles: near.miles });
    }
    missing.push(f);
  }

  const publicMissing = missing.filter((f) => !f.private);
  const privateMissing = missing.filter((f) => f.private);

  console.log(
    `OSM knows ${unique.length} golf course(s) in Utah` +
      (unnamed.length ? ` (plus ${unnamed.length} with no name tag, skipped)` : "")
  );
  console.log(`  ${matched.length} already seeded (matched by name)`);
  console.log(`  ${publicMissing.length} not seeded, public`);
  console.log(`  ${privateMissing.length} not seeded, tagged private\n`);

  if (ambiguous.length) {
    console.log("CLOSE TO A SEEDED COURSE BUT NAMED DIFFERENTLY — decide each one.");
    console.log("Still counted as missing below: position alone can't tell a rename");
    console.log("from two courses that happen to be neighbours.\n");
    for (const m of ambiguous.sort((a, b) => a.miles - b.miles)) {
      console.log(`  "${m.osm.name}"  is ${m.miles.toFixed(2)} mi from seeded "${m.seeded}"`);
    }
    console.log("");
  }

  if (publicMissing.length) {
    console.log("NOT SEEDED — public:\n");
    for (const f of publicMissing.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(
        `  ${f.name}${f.city ? ` (${f.city})` : ""}${f.holes ? ` — ${f.holes} holes` : ""}`
      );
      console.log(`      ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`);
      console.log(`      ${f.website ?? "no website tagged — search for its booking page"}`);
    }
    console.log("");
  }

  if (privateMissing.length && includePrivate) {
    console.log("NOT SEEDED — tagged private:\n");
    for (const f of privateMissing.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${f.name}${f.city ? ` (${f.city})` : ""}`);
    }
    console.log("");
  } else if (privateMissing.length) {
    console.log(`(${privateMissing.length} private course(s) hidden — --include-private to see them)\n`);
  }

  // Candidate entries for the ones that tagged a website, ready to merge
  // into scripts/courses.candidates.json.
  const withSite = publicMissing.filter((f) => f.website);
  if (withSite.length) {
    console.log(`Paste into scripts/courses.candidates.json (${withSite.length} with a website):\n`);
    console.log(
      JSON.stringify(
        withSite.map((f) => ({ name: f.name, city: f.city ?? "", url: f.website })),
        null,
        2
      )
    );
    console.log("");
  }

  if (outFile) {
    writeFileSync(outFile, JSON.stringify({ matched, publicMissing, privateMissing }, null, 2));
    console.log(`Wrote ${outFile}`);
  }
}

main().catch((err) => {
  console.error("osm:utah failed:", err);
  process.exitCode = 1;
});
