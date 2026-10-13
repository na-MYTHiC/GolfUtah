/**
 * Does Chronogolf quote the round it left out of the list?
 *
 * The state of play. A tee time that sells as both a 9 and an 18 comes
 * back from /marketplace/v2/teetimes carrying exactly one
 * `default_price`, stamped with the single `bookable_holes` it is the
 * rate for. The adapter emits two rows and refuses to price the other
 * from it, so 43% of Chronogolf rows show "—": 737 of 1290 priced,
 * measured across every seeded club by chronogolf:prices. Asking the
 * list per round changes nothing — 737/1290 either way, identical to the
 * row.
 *
 * A browser capture then showed the booking page calling two endpoints
 * the list never touches:
 *
 *   /marketplace/clubs/{clubId}/products     entries with bookable_holes
 *                                            9 AND 18
 *   /marketplace/v2/teetimes/{uuid}          the slot on its own
 *
 * Of the two, only the second can be trusted even if both carry money.
 * /products is a club-wide catalogue — list prices, not the rate for a
 * particular tee time — and green fees move with time of day, so
 * joining a catalogue number onto a 4pm slot would print a wrong price
 * with confidence. That is worse than "—" and is the thing the adapter
 * is right to refuse.
 *
 * /marketplace/v2/teetimes/{uuid} is about one slot at one time, so a
 * price there is that slot's price. And the uuid is already in the list
 * response the adapter reads, which means no browser, no club id, and
 * no discovery step: it can be asked directly.
 *
 * So this takes a club, finds a slot the adapter cannot price, asks that
 * endpoint, and prints what comes back.
 *
 *   npm run chronogolf:slot -- old-mill-golf-course
 *   npm run chronogolf:slot -- the-ledges-golf-club --raw
 *
 * Needs a machine that can reach chronogolf.com — or the Probe workflow.
 */

import { COURSES } from "../lib/courses.data";
import { politeFetch } from "../lib/adapters/http";

const API = "https://www.chronogolf.com/marketplace/v2/teetimes";

interface RawPrice {
  green_fee: number;
  half_cart: number | null;
  bookable_holes: number;
  affiliation_type: string;
}

interface RawTeeTime {
  uuid: string;
  start_time: string;
  date: string;
  frozen: boolean;
  max_player_size: number;
  default_price?: RawPrice | null;
  course: { name: string; holes: number; bookable_holes: number[] };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function lengthsOf(t: RawTeeTime): (9 | 18)[] {
  const raw = t.course.bookable_holes?.length ? t.course.bookable_holes : [t.course.holes];
  return raw.filter((h): h is 9 | 18 => h === 9 || h === 18);
}

/** Price-shaped leaves, with the path that reached them. */
function moneyIn(node: unknown, path = "", out: string[] = [], depth = 0): string[] {
  if (depth > 8 || node == null || out.length > 40) return out;
  if (Array.isArray(node)) {
    node.forEach((item, i) => moneyIn(item, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (typeof value === "number" || typeof value === "string") {
      if (/green_fee|price|rate|fee|holes|subtotal/i.test(key)) out.push(`${here} = ${value}`);
    } else {
      moneyIn(value, here, out, depth + 1);
    }
  }
  return out;
}

async function getJson(url: string): Promise<unknown | string> {
  try {
    const resp = await politeFetch(url, {
      label: "Chronogolf",
      headers: { accept: "application/json", referer: "https://www.chronogolf.com/" },
    });
    if (!resp.ok) return `HTTP ${resp.status}`;
    return await resp.json();
  } catch (err) {
    return (err as Error).message;
  }
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
  const raw = process.argv.includes("--raw");

  const course = COURSES.find(
    (c) => c.platform === "CHRONOGOLF" && (c.slug === wanted || !wanted)
  );
  if (!course) {
    console.error(
      "Usage: npm run chronogolf:slot -- <course-slug> [--raw]\n" +
        COURSES.filter((c) => c.platform === "CHRONOGOLF")
          .map((c) => `  ${c.slug}`)
          .join("\n")
    );
    process.exit(1);
  }

  const courseIds = course.externalId.slice(course.externalId.indexOf(":") + 1);
  const date = arg("date") ?? tomorrow();

  console.log(`${course.name}  ${date}\n`);

  const list = await getJson(
    `${API}?${new URLSearchParams({
      start_date: date,
      course_ids: courseIds,
      holes: "9,18",
      page: "1",
    })}`
  );
  if (typeof list === "string") {
    console.error(`list request failed: ${list}`);
    process.exit(1);
  }

  const times = ((list as { teetimes?: RawTeeTime[] }).teetimes ?? []).filter(
    (t) => !t.frozen && t.max_player_size > 0
  );
  console.log(`${times.length} bookable slot(s) in page 1`);

  // The interesting slot is one that sells both rounds but is priced for
  // only one — that is the row the app renders as "—".
  const split = times.find((t) => {
    const lengths = lengthsOf(t);
    return (
      lengths.length > 1 &&
      t.default_price != null &&
      !lengths.every((h) => h === t.default_price!.bookable_holes)
    );
  });

  if (!split) {
    console.log("No slot here sells two rounds with only one priced.");
    console.log("Try another club — chronogolf:prices lists which ones sit at 50%.");
    return;
  }

  const quoted = split.default_price!;
  const missing = lengthsOf(split).find((h) => h !== quoted.bookable_holes);
  console.log(
    `\nslot ${split.start_time}  sells ${lengthsOf(split).join(" and ")}  ` +
      `priced only for ${quoted.bookable_holes} ($${quoted.green_fee}, ${quoted.affiliation_type})`
  );
  console.log(`the app shows "—" for its ${missing}-hole row`);
  console.log(`uuid ${split.uuid}\n`);

  // Does the LIST entry already carry per-round availability, or only the
  // single-slot response? This decides whether the adapter can fix itself
  // from the data it already has, or needs a request per slot — 553 of
  // them a day, which the build has no budget for.
  if (process.argv.includes("--list-raw")) {
    console.log("=== this slot, as the LIST returned it ===");
    console.log(JSON.stringify(split, null, 2).slice(0, 8000));
    console.log("=== end ===\n");
    const availability = (split as unknown as Record<string, unknown>)
      .affiliation_types_availability;
    console.log(
      availability
        ? "The list DOES carry affiliation_types_availability — no extra request needed."
        : "The list does NOT carry it; only the per-slot endpoint does."
    );
    return;
  }

  const detail = await getJson(`${API}/${split.uuid}`);
  if (typeof detail === "string") {
    console.error(`slot request failed: ${detail}`);
    process.exit(1);
  }

  if (raw) {
    console.log(JSON.stringify(detail, null, 2).slice(0, 20_000));
    return;
  }

  const found = moneyIn(detail);
  console.log(`/marketplace/v2/teetimes/{uuid} returned ${found.length} price/holes field(s):\n`);
  for (const line of found) console.log(`  ${line}`);

  // The question this script exists to answer, stated as a verdict rather
  // than left to inspection.
  const quotesMissing = found.some(
    (l) => /bookable_holes = /.test(l) && l.endsWith(` = ${missing}`)
  );
  console.log("");
  if (quotesMissing) {
    console.log(`YES — this response mentions ${missing} holes. Check above whether a`);
    console.log(`green fee sits alongside it; if so, the adapter can ask per slot.`);
  } else {
    console.log(`NO — nothing here is stamped for ${missing} holes, so this endpoint`);
    console.log(`repeats the one rate the list already gave. The "—" is the`);
    console.log(`platform's, and guessing it from the club catalogue would print a`);
    console.log(`wrong price rather than no price.`);
  }
}

main().catch((err) => {
  console.error("chronogolf:slot failed:", err);
  process.exitCode = 1;
});
