/**
 * Which courses tell us the nine, and which stay silent.
 *
 * "Front or back?" is not a question every platform answers, and the
 * difference isn't visible from the app — a row with no side looks the
 * same whether the course said "front" or said nothing at all. This
 * counts it.
 *
 *   npm run sides
 *   npm run sides -- --url https://na-mythic.github.io/GolfUtah
 *   npm run sides -- --dir out/data
 *
 * Defaults to the published site, because that's the data the app is
 * actually serving. --dir reads a local build instead.
 *
 * WHAT THE ANSWER DEPENDS ON, per platform:
 *
 *   MemberSports  a real boolean (isBackNine) on every slot. Always known.
 *   TeeItUp       a real boolean (backNine) on every slot. Always known.
 *   ForeUp        inferred from teesheet_side_name, which is the *sheet's*
 *                 name — "Front 9" on courses that name it that way,
 *                 "Teesheet 1" on courses that don't. Silent unless the
 *                 course happens to label it.
 *   Chronogolf    inferred from the course name, because a back nine is
 *                 published as its own course ("Riverbend back 9").
 *                 Silent unless the club splits it out.
 *
 * So a silent course is not a bug to fix in the adapter — it's a course
 * whose booking system never says. The only thing this script can change
 * is whether we know which ones those are.
 */

import { COURSES } from "../lib/courses.data";

interface Slot {
  time: string;
  holes: number;
  side?: string;
}
interface Course {
  name: string;
  slug: string;
  platform: string;
  slots: Slot[];
  error?: string;
}
interface DayFile {
  date: string;
  courses: Course[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DEFAULT_URL = "https://na-mythic.github.io/GolfUtah";

async function readDays(): Promise<DayFile[]> {
  const dir = arg("dir", "");
  if (dir) {
    const { readFile, readdir } = await import("node:fs/promises");
    const names = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    return Promise.all(
      names.map(async (f) => JSON.parse(await readFile(`${dir}/${f}`, "utf8")) as DayFile)
    );
  }

  const base = arg("url", DEFAULT_URL).replace(/\/$/, "");
  const index = (await (await fetch(`${base}/data/index.json`)).json()) as { dates: string[] };
  const days: DayFile[] = [];
  for (const date of index.dates) {
    const resp = await fetch(`${base}/data/${date}.json`);
    if (resp.ok) days.push((await resp.json()) as DayFile);
  }
  return days;
}

async function main() {
  const days = await readDays();
  if (days.length === 0) {
    console.error("No day files found. Pass --dir out/data, or --url <site>.");
    process.exit(1);
  }

  console.log(`Read ${days.length} day file(s).\n`);

  const platformOf = new Map(COURSES.map((c) => [c.slug, c.platform]));

  interface Tally {
    name: string;
    platform: string;
    slots: number;
    nines: number;
    front: number;
    back: number;
    silent: number;
  }
  const byCourse = new Map<string, Tally>();

  for (const day of days) {
    for (const course of day.courses) {
      const t =
        byCourse.get(course.slug) ??
        ({
          name: course.name,
          platform: platformOf.get(course.slug) ?? course.platform ?? "?",
          slots: 0,
          nines: 0,
          front: 0,
          back: 0,
          silent: 0,
        } satisfies Tally);
      for (const s of course.slots) {
        t.slots++;
        if (s.holes === 9) t.nines++;
        if (s.side === "Back") t.back++;
        else if (s.side === "Front") t.front++;
        else t.silent++;
      }
      byCourse.set(course.slug, t);
    }
  }

  const rows = [...byCourse.values()]
    .filter((t) => t.slots > 0)
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));

  const verdict = (t: Tally) =>
    t.silent === 0 ? "every slot" : t.silent === t.slots ? "never" : "sometimes";

  console.table(
    rows.map((t) => ({
      course: t.name,
      platform: t.platform,
      slots: t.slots,
      "9-hole": t.nines,
      front: t.front,
      back: t.back,
      "no side": t.silent,
      "says which nine": verdict(t),
    }))
  );

  const group = (v: string) => rows.filter((t) => verdict(t) === v);
  const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;

  const [all, some, none] = ["every slot", "sometimes", "never"].map((v) => group(v).length);
  console.log(
    `\n${all} of ${rows.length} courses (${pct(all)}) label every slot, ` +
      `${some} label some, ${none} never say.`
  );

  const silentByPlatform = new Map<string, { silent: number; total: number }>();
  for (const t of rows) {
    const e = silentByPlatform.get(t.platform) ?? { silent: 0, total: 0 };
    e.total++;
    if (verdict(t) === "never") e.silent++;
    silentByPlatform.set(t.platform, e);
  }
  console.log("\nCourses that never say, by platform:");
  for (const [p, e] of [...silentByPlatform].sort()) {
    console.log(`  ${p.padEnd(13)} ${e.silent} of ${e.total}`);
  }

  const never = group("never");
  if (never.length) {
    console.log(
      "\nThese are courses whose booking system doesn't publish a side, not\n" +
        "an adapter gap — see the header of this file for why, per platform:"
    );
    for (const t of never) console.log(`  ${t.name} (${t.platform})`);
  }
}

main().catch((err) => {
  console.error("side-coverage failed:", err);
  process.exitCode = 1;
});
