/**
 * Why a Chronogolf tee time shows "—" instead of a price.
 *
 * An 18-hole Chronogolf course sells the same slot as a 9 and as an 18,
 * and the adapter rightly emits two rows for it. But the response only
 * carries ONE `default_price`, stamped with the single `bookable_holes`
 * it is the rate for. The adapter refuses to price the other round from
 * it — correctly, since that number would be invented — so one of every
 * pair comes out unpriced:
 *
 *   price: raw.default_price.bookable_holes === holes ? ... : undefined
 *
 * That is a deliberate choice, and it is the right one given a single
 * price. The question this asks is whether we have to be given a single
 * price at all. We request `holes=9,18` in one call, copying the widget.
 * If asking for one round at a time returns that round's own rate, then
 * both rows can be priced honestly and nothing has to be guessed.
 *
 * So: fetch each way and compare coverage.
 *
 *   npm run chronogolf:prices                       # every seeded club
 *   npm run chronogolf:prices -- --only riverbend-golf-course
 *   npm run chronogolf:prices -- --days 2
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

function dateAhead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseExternalId(externalId: string): { slug: string; courseIds: string[] } {
  const at = externalId.indexOf(":");
  return {
    slug: externalId.slice(0, at),
    courseIds: externalId.slice(at + 1).split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** One page is enough to characterise a sheet; this isn't a data load. */
async function fetchTimes(
  courseIds: string[],
  date: string,
  holes: string
): Promise<RawTeeTime[] | string> {
  const params = new URLSearchParams({
    start_date: date,
    course_ids: courseIds.join(","),
    holes,
    page: "1",
  });
  try {
    const resp = await politeFetch(`${API}?${params}`, {
      label: "Chronogolf",
      headers: { accept: "application/json", referer: "https://www.chronogolf.com/" },
    });
    if (!resp.ok) return `HTTP ${resp.status}`;
    const body = (await resp.json()) as { status: string; teetimes: RawTeeTime[] };
    if (!Array.isArray(body.teetimes)) return `status ${body.status}`;
    return body.teetimes.filter((t) => !t.frozen && t.max_player_size > 0);
  } catch (err) {
    return (err as Error).message;
  }
}

/** The round lengths the adapter would emit rows for. */
function lengthsOf(t: RawTeeTime): (9 | 18)[] {
  const raw = t.course.bookable_holes?.length ? t.course.bookable_holes : [t.course.holes];
  return raw.filter((h): h is 9 | 18 => h === 9 || h === 18);
}

/** Rows the adapter would produce, and how many carry a price. */
function coverage(times: RawTeeTime[]): { rows: number; priced: number } {
  let rows = 0;
  let priced = 0;
  for (const t of times) {
    for (const holes of lengthsOf(t)) {
      rows++;
      if (t.default_price && t.default_price.bookable_holes === holes) priced++;
    }
  }
  return { rows, priced };
}

function pct(a: number, b: number): string {
  return b === 0 ? "  n/a" : `${String(Math.round((100 * a) / b)).padStart(3)}%`;
}

async function main() {
  const only = arg("only");
  const days = Number(arg("days") ?? "1");

  const clubs = COURSES.filter(
    (c) => c.platform === "CHRONOGOLF" && (!only || c.slug === only)
  );

  console.log(`Checking price coverage on ${clubs.length} Chronogolf course(s)\n`);
  console.log("  'both' asks holes=9,18 the way the adapter does today.");
  console.log("  'split' asks each round on its own and merges.\n");

  let bothRows = 0;
  let bothPriced = 0;
  let splitRows = 0;
  let splitPriced = 0;

  for (const course of clubs) {
    const { courseIds } = parseExternalId(course.externalId);

    for (let d = 1; d <= days; d++) {
      const date = dateAhead(d);

      const both = await fetchTimes(courseIds, date, "9,18");
      if (typeof both === "string") {
        console.log(`  ${course.name.padEnd(30)} ${both}`);
        continue;
      }

      // Split: ask for each round separately, and count a row as priced
      // when the response for THAT round quotes it.
      const nine = await fetchTimes(courseIds, date, "9");
      const eighteen = await fetchTimes(courseIds, date, "18");

      let sRows = 0;
      let sPriced = 0;
      for (const [holes, got] of [
        [9, nine],
        [18, eighteen],
      ] as const) {
        if (typeof got === "string") continue;
        for (const t of got) {
          if (!lengthsOf(t).includes(holes as 9 | 18)) continue;
          sRows++;
          if (t.default_price && t.default_price.bookable_holes === holes) sPriced++;
        }
      }

      const b = coverage(both);
      bothRows += b.rows;
      bothPriced += b.priced;
      splitRows += sRows;
      splitPriced += sPriced;

      const gap = b.rows - b.priced;
      console.log(
        `  ${course.name.padEnd(30)} ${date}  ` +
          `both ${String(b.priced).padStart(3)}/${String(b.rows).padEnd(3)} ${pct(b.priced, b.rows)}   ` +
          `split ${String(sPriced).padStart(3)}/${String(sRows).padEnd(3)} ${pct(sPriced, sRows)}` +
          (gap > 0 ? `   (${gap} unpriced today)` : "")
      );

      // What the single price actually says, on the first slot that has
      // one. If a course only ever quotes one round, that is the finding.
      const sample = both.find((t) => t.default_price);
      if (sample?.default_price && d === 1) {
        console.log(
          `      default_price: $${sample.default_price.green_fee} for ` +
            `${sample.default_price.bookable_holes} holes ` +
            `(${sample.default_price.affiliation_type}), ` +
            `slot sells ${lengthsOf(sample).join(" and ")}`
        );
      }
    }
  }

  console.log("");
  console.log(`  as we ask now:  ${bothPriced}/${bothRows} rows priced  ${pct(bothPriced, bothRows)}`);
  console.log(`  asking split:   ${splitPriced}/${splitRows} rows priced  ${pct(splitPriced, splitRows)}`);
  console.log("");
  if (splitRows === 0) {
    console.log("  Split returned nothing — this API may reject a single-round request.");
  } else if (splitPriced > bothPriced) {
    console.log("  Splitting the request prices more rows. Worth changing the adapter.");
  } else {
    console.log("  Splitting gains nothing: the sheet quotes one round and only one.");
    console.log("  The '—' rows are honest and the fix has to be elsewhere.");
  }
}

main().catch((err) => {
  console.error("chronogolf:prices failed:", err);
  process.exitCode = 1;
});
