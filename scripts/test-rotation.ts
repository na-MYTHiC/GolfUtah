/**
 * Checks that Chronogolf's day rotation reaches every day.
 *
 * The bug this guards against shipped, and was invisible from the code.
 * Chronogolf's days were chosen by a band picker that judged staleness
 * from each day file's generatedAt — but every file is rewritten every
 * run, so every band looked equally fresh and days 0-1 won every time.
 * Days 2-9 were never fetched again, and the weekend lost every Salt Lake
 * municipal while each run reported success.
 *
 * "Picks a sensible set" isn't enough to catch that; a starving
 * scheduler picks a sensible set every single time. So besides the
 * single-run cases, this simulates a day of runs and checks that every
 * day is reached, and that a day stuck on an error recovers.
 *
 *   npx tsx scripts/test-rotation.ts
 */

import { isUsableFallback, pickChronogolfDays, queueOrder } from "./build-data";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const DAYS = 10;
const MAX = 3;
const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

type Course = { platform: string; fetchedAt?: string; error?: string };

/** A published day: Chronogolf courses with the given fetch ages, plus noise. */
function day(chronogolfAgesMin: (number | "never" | "error")[]): { courses: Course[] } {
  return {
    courses: [
      ...chronogolfAgesMin.map((age): Course =>
        age === "never"
          ? { platform: "CHRONOGOLF" }
          : age === "error"
            ? { platform: "CHRONOGOLF", error: "HTTP 429" }
            : { platform: "CHRONOGOLF", fetchedAt: new Date(NOW - age * MIN).toISOString() }
      ),
      // Other platforms are refreshed every run and must not sway the
      // choice — they're exactly what made the old picker see every day
      // as fresh.
      { platform: "FOREUP", fetchedAt: new Date(NOW).toISOString() },
    ],
  };
}

const pick = (carried: Map<number, { courses: Course[] }>, now = NOW) =>
  pickChronogolfDays(carried as never, DAYS, now, MAX);

console.log("single runs");
check("nothing published: the nearest days first", pick(new Map()).join() === "0,1,2", pick(new Map()).join());

{
  const carried = new Map(
    Array.from({ length: DAYS }, (_, i) => [i, day(i < 3 ? [1, 1] : ["never", "never"])])
  );
  check("never-fetched days beat freshly fetched ones", pick(carried).join() === "3,4,5", pick(carried).join());
}

{
  // Everything fetched half an hour ago, except one course on day 8 that
  // last came back as an error. Day 8 must be picked, or it never heals.
  const carried = new Map(
    Array.from({ length: DAYS }, (_, i) => [i, day(i === 8 ? [30, "error"] : [30, 30])])
  );
  const got = pick(carried);
  check("a day stuck on an error is picked so it can recover", got.includes(8), got.join());
}

{
  // Everything equally old: nearer days have tighter targets, so they're
  // the more overdue. 30 min against 5/10/20/40-minute targets.
  const carried = new Map(Array.from({ length: DAYS }, (_, i) => [i, day([30, 30])]));
  check("equal ages favour the near days", pick(carried).join() === "0,1,2", pick(carried).join());
}

{
  // The old picker's blind spot, reproduced: the day files themselves are
  // brand new (FOREUP was just fetched), but Chronogolf's data on days
  // 2-9 is hours old. The far days must win.
  const carried = new Map(
    Array.from({ length: DAYS }, (_, i) => [i, day(i < 2 ? [1, 1] : [300, 300])])
  );
  const got = pick(carried);
  check("fresh files don't hide stale Chronogolf data", !got.includes(0) && !got.includes(1), got.join());
}

{
  // v88's live case: day 3 has two stragglers from before fetchedAt
  // existed, days 5-9 lost every course. The empty week must come first.
  const carried = new Map(
    Array.from({ length: DAYS }, (_, i) => [
      i,
      i === 3
        ? day([10, 10, 10, "never", "never"])
        : i >= 5
          ? day(["error", "error", "error", "error", "error"])
          : day([10, 10, 10, 10, 10]),
    ])
  );
  const got = pick(carried);
  check(
    "a day missing every course outranks one with two stragglers",
    got.includes(5) && got.includes(6),
    got.join()
  );
}

console.log("\na day of runs");
{
  // Every day starts in the state production was found in: near days
  // fine, far days failed.
  const fetched = new Map<number, number | "error">(
    Array.from({ length: DAYS }, (_, i) => [i, i < 2 ? NOW : "error"] as const)
  );
  const runsTouching = new Array(DAYS).fill(0);
  // The longest any day's Chronogolf data went without a refresh, after
  // the first few runs have cleared the starting backlog. This is the
  // number that matters to someone looking at Saturday: "reached once in
  // 24 hours" passes a > 0 check and is still day-old tee times.
  const worstAgeMin = new Array(DAYS).fill(0);
  let firstFullCoverage = -1;
  const reached = new Set<number>();

  // GitHub delivers about two runs an hour, measured. Simulate a day.
  for (let run = 0; run < 48; run++) {
    const now = NOW + run * 30 * MIN;
    const carried = new Map(
      [...fetched].map(([i, at]) => [
        i,
        day(at === "error" ? ["error", "error"] : [(now - at) / MIN, (now - at) / MIN]),
      ])
    );
    if (run >= 4) {
      for (const [i, at] of fetched) {
        if (at !== "error") worstAgeMin[i] = Math.max(worstAgeMin[i], (now - at) / MIN);
      }
    }
    for (const d of pickChronogolfDays(carried as never, DAYS, now, MAX)) {
      fetched.set(d, now);
      runsTouching[d]++;
      reached.add(d);
    }
    if (firstFullCoverage < 0 && reached.size === DAYS) firstFullCoverage = run + 1;
  }

  check(
    "every day is reached — none starved",
    runsTouching.every((n) => n > 0),
    `refreshes per day over 24h: ${runsTouching.join(" ")}`
  );
  check(
    "the failed days recover within a few runs",
    firstFullCoverage > 0 && firstFullCoverage <= 4,
    `all ten reached by run ${firstFullCoverage}`
  );
  check(
    "near days are refreshed more often than far ones",
    runsTouching[0] > runsTouching[9],
    `day 0: ${runsTouching[0]}, day 9: ${runsTouching[9]}`
  );
  // Capacity is three days a run at about two runs an hour, so ten days
  // can't all be fresh. The bounds say how the shortfall is shared: the
  // days people book most stay near-live, and nothing goes stale enough
  // to be mostly fiction.
  check(
    "today and tomorrow are never more than an hour old",
    worstAgeMin[0] <= 60 && worstAgeMin[1] <= 60,
    `worst ages (min): ${worstAgeMin.map((m) => Math.round(m)).join(" ")}`
  );
  check(
    "no day is ever more than five hours old",
    worstAgeMin.every((m) => m <= 300),
    `worst: ${Math.round(Math.max(...worstAgeMin))} min`
  );
  check(
    "never more than the cap per run",
    runsTouching.reduce((a, b) => a + b, 0) <= 48 * MAX
  );
}

console.log("\ncarry-over");
{
  const at = (minAgo: number) => new Date(NOW - minAgo * MIN).toISOString();
  const usable = (c: object | undefined) => isUsableFallback(c as never, NOW);
  // Tonight's case: the last fetch correctly found nothing left today.
  check("a real fetch that found nothing is still an answer", usable({ slots: [], fetchedAt: at(30) }));
  check("a real fetch with times is used", usable({ slots: [{}], fetchedAt: at(30) }));
  check("an errored copy is never used", !usable({ slots: [{}], fetchedAt: at(30), error: "HTTP 429" }));
  check("nothing to fall back to", !usable(undefined));
  check("too old to pass off as current", !usable({ slots: [{}], fetchedAt: at(7 * 60) }));
  // From before fetchedAt existed: unknown provenance, so it must have times.
  check("an unstamped copy with times is used", usable({ slots: [{}] }));
  check("an unstamped empty copy is not", !usable({ slots: [] }));
}

console.log("\nqueue order");
{
  // Tonight's case: day 6 had nine courses with nothing to fall back on,
  // and they kept landing mid-run where Chronogolf starts refusing.
  const at = (minAgo: number) => new Date(NOW - minAgo * MIN).toISOString();
  const carried = new Map<number, { courses: object[] }>([
    [4, { courses: [{ slug: "a", slots: [], fetchedAt: at(20) }, { slug: "b", slots: [], fetchedAt: at(20) }] }],
    [6, { courses: [{ slug: "a", slots: [], error: "HTTP 429" }, { slug: "b", slots: [], fetchedAt: at(20) }] }],
    [9, { courses: [{ slug: "a", slots: [], fetchedAt: at(400) }] }],
  ]);
  const jobs = [
    { seed: { slug: "a" }, dayIndex: 4 },
    { seed: { slug: "b" }, dayIndex: 4 },
    { seed: { slug: "a" }, dayIndex: 6 },
    { seed: { slug: "b" }, dayIndex: 6 },
    { seed: { slug: "a" }, dayIndex: 9 },
    { seed: { slug: "b" }, dayIndex: 9 },
  ];
  const got = queueOrder(jobs, carried as never, NOW).map((j) => `${j.dayIndex}${j.seed.slug}`).join(" ");
  check(
    "courses with nothing to fall back on go first, in date order",
    got.startsWith("6a 9a 9b"),
    got
  );
  check("then the ones with a recent copy, in date order", got.endsWith("4a 4b 6b"), got);
}

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All rotation checks passed.");
}
