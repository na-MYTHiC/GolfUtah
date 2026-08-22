/**
 * Fetches tee times for the next few days and writes them as static JSON
 * for the site to load in the browser.
 *
 * This exists because the site is hosted on GitHub Pages, which has no
 * server: the courses' booking APIs mostly don't send CORS headers, so a
 * page can't call them directly. The GitHub Actions cron runs this, then
 * builds and deploys, which means the data is as fresh as the last run.
 *
 * One file per day keeps each download small — the browser only fetches
 * the day being viewed.
 *
 * FRESHNESS IS TIERED, and that's the point of --near/--reuse.
 *
 * Not every day deserves the same attention. Today's sheet moves by the
 * minute; next Tuesday's barely moves at all. Refetching all ten days
 * every run means ~430 requests across 40-odd courses each time, which
 * is both wasteful and rude to the booking systems — and it caps how
 * often the near days can refresh, because the far ones ride along.
 *
 * So each run says which days it wants fresh; the rest are carried over
 * from what's already published (--reuse <site url>) unless that copy is
 * too old.
 *
 *   --fresh 0-2      just the next three days
 *   --fresh 0-2,7-9  the near days and the tail, skipping the middle
 *   --near 3         shorthand for --fresh 0-2
 *
 * The ranges matter more than they look. A run that only wants to
 * refresh day 8 shouldn't have to refetch days 1-7 to do it — with
 * --near alone it would, which is what made a finer-grained schedule
 * cost more than it should.
 *
 * Fetching is pipelined across days rather than done a day at a time —
 * see fetchAll(). Same request count, same per-platform ceiling, but a
 * platform that finishes today's courses starts on tomorrow's instead of
 * waiting for the slowest platform to catch up.
 *
 * Usage:
 *   npx tsx scripts/build-data.ts [--days 10] [--fresh 0-2] [--near 10]
 *                                 [--reuse https://user.github.io/repo]
 *                                 [--budget 240] [--out public/data]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { COURSES } from "../lib/courses.data";
import { getAdapter } from "../lib/adapters";
import { pacingReport } from "../lib/adapters/http";
import { getPlaceInfo, placesEnabled, type PlaceInfo } from "../lib/places";
import { todayInUtah, addDays } from "../lib/format";
import type { Course } from "@prisma/client";

/**
 * Simultaneous requests to any one booking platform, scaled to how many
 * courses that platform serves.
 *
 * It used to be a flat 3 for everyone, and that turned out to be the
 * thing setting the length of every run. ForeUp carries 23 of the 47
 * courses and Chronogolf 14, but both got the same three slots as
 * TeeItUp's four — so on a ten-day tick ForeUp needed ~85 sequential
 * rounds and took ~60s, while Chronogolf finished in ~21s and then sat
 * idle for the remaining 38. The run was never bounded by the schedule
 * or by the day-by-day structure; it was bounded by one platform's queue.
 *
 * WHY RAISING THIS IS NOT RUDE, which is the part worth being careful
 * about. What a golf course could reasonably object to is how often its
 * own tee sheet is polled, and that is completely unchanged: every
 * course is asked exactly once per day per run either way. This number
 * only decides how many *different* courses' sheets are in flight at the
 * same instant against a shared SaaS host — and foreupsoftware.com
 * serves thousands of courses. Six concurrent is less than one person
 * opening one booking page in a browser.
 *
 * One slot per four courses, floored at 2 so a small platform still
 * overlaps, capped at 6 so a platform that grows can't quietly turn into
 * a stampede without someone changing this line.
 */
const COURSES_PER_SLOT = 4;
const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 6;

function concurrencyFor(courseCount: number): number {
  return Math.max(
    MIN_CONCURRENCY,
    Math.min(MAX_CONCURRENCY, Math.ceil(courseCount / COURSES_PER_SLOT))
  );
}

/**
 * How stale a carried-over day may be before it's refetched anyway.
 * Generous, because these are days far enough out that availability
 * barely moves — but not unbounded, or a far day could go stale for as
 * long as the site keeps deploying.
 */
const MAX_REUSE_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * How old the published ratings and reviews may be before Google is
 * asked again.
 *
 * This one is a cost control, not a freshness one. Places is billed per
 * call, and the build runs every five minutes: fetching 43 courses on
 * every run would be ~370,000 calls a month, which on the SKU that
 * includes reviews and photos runs to five figures. Ratings move by
 * hundredths of a star in a year, so once a week is generous.
 */
const MAX_PLACES_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StaticSlot {
  time: string;
  holes: number;
  spots: number;
  price: number | null;
  /** Cart per player in cents, when quoted separately from the green fee. */
  cart?: number;
  /** True when `price` already includes a cart and can't be split out. */
  withCart?: boolean;
  /** Rate class, e.g. "Non-Utah Resident". */
  rate?: string;
  side?: string;
  url: string;
}

interface StaticCourse {
  id: string;
  name: string;
  slug: string;
  city: string;
  county: string;
  platform: string;
  bookingUrl: string;
  lat: number;
  lon: number;
  rating?: PlaceInfo;
  slots: StaticSlot[];
  error?: string;
  /**
   * How many slots the platform returned before filtering. Distinguishes
   * "the API gave us nothing" from "it gave us times but they're all
   * full" — which look identical in the UI otherwise, and need completely
   * different fixes.
   */
  returned?: number;
  /**
   * ForeUp course with no booking_class captured. Sun Hills proved that
   * omitting it can hide most of the morning, so these listings may be
   * incomplete and the UI says so.
   */
  partial?: boolean;
}

/**
 * The cross-day summary: what's cheap, and when.
 *
 * TWO QUESTIONS THIS ANSWERS THAT A SINGLE DAY CAN'T.
 *
 * "When should I play?" The app shows one day at a time, so comparing
 * Saturday against Thursday means tapping through the date strip and
 * remembering. `days` puts the cheapest price for each published day in
 * one small file, so the strip itself can show it.
 *
 * "Is $45 good?" A price means nothing without knowing the course. A
 * municipal twilight nine and a resort eighteen are both "cheap" at
 * wildly different numbers, and no course's own booking page will ever
 * tell you its price is high today — that's the one thing an aggregator
 * is structurally able to say. `typical` is the median for that course
 * in that part of the day, across every published day.
 *
 * WHY MEDIAN, AND WHY FORWARD-LOOKING. The median because green fees are
 * a handful of rate classes rather than a smooth distribution, and one
 * $150 outing rate would drag a mean somewhere no golfer recognises.
 * Forward-looking because there's no history to draw on — the site keeps
 * ten days ahead and nothing behind — but "what this course charges at
 * this time of day" is exactly the baseline the question needs, and ten
 * days of it is a real sample rather than a guess.
 *
 * Separate file, like ratings, because it's identical for every day and
 * would otherwise be duplicated ten times over.
 */
interface PriceSummary {
  generatedAt: string;
  /** date -> the cheapest slot published that day, in cents. */
  days: Record<string, { cheapest: number; slots: number }>;
  /** course slug -> band -> median price in cents, and the sample size. */
  typical: Record<string, Partial<Record<PriceBand, { median: number; n: number }>>>;
}

/**
 * Bands rather than raw hours: an 8am and a 9am tee time are the same
 * product at nearly every course, while an 8am and a 6pm are not.
 * These match the "when" filter the UI already offers, so a golfer
 * filtering to Morning is being compared against mornings.
 */
type PriceBand = "morning" | "midday" | "evening";

export function bandOf(time: string): PriceBand {
  const hour = Number(time.slice(0, 2));
  if (hour < 11) return "morning";
  if (hour < 16) return "midday";
  return "evening";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * @param minSample Below this, a median is an anecdote. A course with
 * two published prices shouldn't be the basis for telling someone a
 * third one is a bargain, so it's left out and the UI shows nothing.
 */
export function summarize(files: DayFile[], minSample = 6): PriceSummary {
  const days: PriceSummary["days"] = {};
  const gathered = new Map<string, Map<PriceBand, number[]>>();

  for (const file of files) {
    let cheapest = Infinity;
    let slots = 0;

    for (const course of file.courses) {
      for (const slot of course.slots) {
        slots++;
        if (slot.price == null) continue;
        // Cart-inclusive prices aren't comparable with green-fee-only
        // ones; mixing them would make a course look cheap or dear
        // depending on how its platform happens to quote.
        if (slot.withCart) continue;

        if (slot.price < cheapest) cheapest = slot.price;

        const byBand = gathered.get(course.slug) ?? new Map<PriceBand, number[]>();
        const band = bandOf(slot.time);
        byBand.set(band, [...(byBand.get(band) ?? []), slot.price]);
        gathered.set(course.slug, byBand);
      }
    }

    if (slots > 0) {
      days[file.date] = { cheapest: cheapest === Infinity ? 0 : cheapest, slots };
    }
  }

  const typical: PriceSummary["typical"] = {};
  for (const [slug, byBand] of gathered) {
    for (const [band, prices] of byBand) {
      if (prices.length < minSample) continue;
      typical[slug] ??= {};
      typical[slug][band] = { median: median(prices), n: prices.length };
    }
  }

  return { generatedAt: new Date().toISOString(), days, typical };
}

interface DayFile {
  date: string;
  generatedAt: string;
  courses: StaticCourse[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * "0-2,7-9" -> the day indexes to fetch fresh. Anything outside the set
 * is carried over. A malformed spec yields an empty set, which would
 * silently refresh nothing, so it throws instead.
 */
/**
 * The bands, and how often each *wants* refreshing.
 *
 * Targets, not promises. Which band a run picks is decided by which is
 * furthest past its target, so these are ratios against each other more
 * than they are absolute times.
 */
const BANDS: { label: string; from: number; to: number; targetMs: number }[] = [
  { label: "0-3", from: 0, to: 3, targetMs: 5 * 60 * 1000 },
  { label: "4-6", from: 4, to: 6, targetMs: 15 * 60 * 1000 },
  { label: "7-9", from: 7, to: 9, targetMs: 30 * 60 * 1000 },
];

/**
 * Platforms that refuse when asked for too much in one run.
 *
 * Only Chronogolf has ever done so — roughly 57 requests per window,
 * three days across its nineteen courses. Everything else is asked for
 * the near days every run regardless of which band won, because there
 * is no reason to make them share a limit that isn't theirs.
 *
 * Add to this only on evidence: a platform that starts answering 429
 * shows up in the build log's "throttled by:" line.
 */
const RATE_LIMITED_PLATFORMS = new Set<string>(["CHRONOGOLF"]);

/**
 * Picks the band that is furthest overdue, from what's actually
 * published.
 *
 * WHY NOT THE CLOCK. The workflow used to choose by minute-of-hour, on
 * the assumption that a 5-minute cron fires every 5 minutes. It
 * doesn't. Measured over sixteen consecutive scheduled runs, GitHub
 * fired this workflow every 11 to 26 minutes, averaging about 18 — and
 * of those sixteen, exactly one landed on minute 0 and one on minute
 * 15. Any rule of the form `MINUTE % 30 == 0` is therefore close to
 * never, and the far bands would go hours without a refresh while the
 * schedule looked fine.
 *
 * Staleness is the honest input: it's measured from the published
 * files, so it self-corrects no matter when a tick actually lands. A
 * band that got skipped becomes more overdue and wins the next one.
 */
function pickBand(published: Map<number, DayFile>, days: number): Set<number> {
  const now = Date.now();
  let best: { label: string; days: number[]; ratio: number } | null = null;

  for (const band of BANDS) {
    const indexes: number[] = [];
    for (let i = band.from; i <= band.to && i < days; i++) indexes.push(i);
    if (indexes.length === 0) continue;

    // The stalest day in the band decides it — a band is only as fresh
    // as its worst day, and a day never fetched has no file at all.
    let oldest = 0;
    for (const i of indexes) {
      const at = published.get(i)?.generatedAt;
      const age = at ? now - new Date(at).getTime() : Number.POSITIVE_INFINITY;
      oldest = Math.max(oldest, Number.isFinite(age) ? age : Number.POSITIVE_INFINITY);
    }

    const ratio = oldest / band.targetMs;
    if (!best || ratio > best.ratio) best = { label: band.label, days: indexes, ratio };
  }

  if (!best) return new Set([0]);
  console.log(
    `auto-fresh: refreshing ${best.label} — ` +
      (Number.isFinite(best.ratio)
        ? `${best.ratio.toFixed(1)}x its target age, the most overdue band`
        : `never published`)
  );
  return new Set(best.days);
}

function parseFresh(spec: string, days: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error(`Bad --fresh range "${part}" — expected "0-2" or "5"`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    for (let i = from; i <= to && i < days; i++) out.add(i);
  }
  if (out.size === 0) throw new Error(`--fresh "${spec}" selected no days`);
  return out;
}

/**
 * Runs tasks with a ceiling on how many are in flight at once.
 * Promise.all across every course hits one platform with dozens of
 * simultaneous requests, which is the kind of thing that gets an IP
 * blocked.
 */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Every booking link must land on the day the golfer tapped, not on
 * whatever the course's page opens to by default. That's easy to lose:
 * a platform changes a parameter name, or a new adapter forgets it, and
 * the app quietly starts sending people to today's sheet for next
 * Saturday's tee time. So it's checked rather than trusted.
 *
 * Platforms spell the date differently — ISO for most, MM-DD-YYYY for
 * ForeUp, a unix timestamp for GolfPay — so all three forms count.
 */
/**
 * Platforms whose booking page genuinely cannot be deep-linked to a day.
 * MemberSports keeps the selected date in its app state rather than the
 * address — the same URL is served for every day, confirmed by comparing
 * two. Warning about these every run would train the warning to be
 * ignored, so they're excluded and surfaced in the UI instead.
 */
const PLATFORMS_WITHOUT_DATED_LINKS = new Set(["MEMBERSPORTS"]);

/**
 * A ten-digit run in the URL that lands on `date` when read as unix
 * seconds.
 *
 * GolfPay's per-slot link carries no date at all — it carries
 * `{"course_id":1466,"tee_time_ts":1786926600,"number_of_holes":"9"}`,
 * URL-encoded. That timestamp names the exact slot, which is *better*
 * than a date, but the textual check can't see it and reported The Barn
 * as undated on every single day. A warning that cries wolf every run
 * is worse than no warning, because the next real one gets skimmed
 * past.
 *
 * Ten digits is narrow enough to be worth the small risk of a course id
 * coincidentally matching: 1786926600 is a plausible timestamp, 1466 is
 * not. Utah's day, since that's the day the golfer is booking.
 */
function carriesTimestamp(url: string, date: string): boolean {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // A malformed escape isn't worth failing over — search the raw form.
  }
  for (const digits of decoded.match(/\d{10}(?!\d)/g) ?? []) {
    const when = new Date(Number(digits) * 1000);
    if (Number.isNaN(when.getTime())) continue;
    if (when.toLocaleDateString("en-CA", { timeZone: "America/Denver" }) === date) return true;
  }
  return false;
}

function carriesDate(url: string, date: string): boolean {
  const [year, month, day] = date.split("-");
  return (
    url.includes(date) || url.includes(`${month}-${day}-${year}`) || carriesTimestamp(url, date)
  );
}

async function fetchCourse(
  seed: (typeof COURSES)[number],
  date: string,
  rating: StaticCourse["rating"]
): Promise<StaticCourse> {
  const base: StaticCourse = {
    id: `${seed.platform}:${seed.externalId}`,
    name: seed.name,
    slug: seed.slug,
    city: seed.city,
    county: seed.county,
    platform: seed.platform,
    bookingUrl: seed.bookingUrl,
    lat: seed.latitude,
    lon: seed.longitude,
    rating,
    slots: [],
    partial: seed.platform === "FOREUP" && seed.externalId.split(":").length < 3,
  };

  try {
    const course = {
      name: seed.name,
      externalId: seed.externalId,
      bookingUrl: seed.bookingUrl,
      platform: seed.platform,
    } as Course;

    const times = await getAdapter(seed.platform).fetchTeeTimes(course, {
      from: date,
      to: date,
    });

    base.returned = times.length;
    base.slots = times.map((t) => ({
      time: t.time,
      holes: t.holes,
      spots: t.playersOpen,
      price: t.price ?? null,
      cart: t.cartFee,
      withCart: t.priceIncludesCart,
      rate: t.rateName,
      side: t.side,
      url: t.bookingUrl,
    }));
  } catch (err) {
    // Recorded rather than thrown: one course being down shouldn't cost
    // the whole day's data.
    base.error = (err as Error).message;
  }

  return base;
}

/**
 * Every (course, day) that needs fetching, run as one pipeline per
 * platform instead of one pass per day.
 *
 * THE PROBLEM THIS SOLVES. Days used to be fetched strictly in
 * sequence: all courses for today, then all courses for tomorrow, and
 * so on. Within a day the platforms ran in parallel, so each pass took
 * as long as its *slowest* platform — and every other platform sat idle
 * waiting for it before the next day could start. On a ten-day tick
 * that idle time was paid ten times over.
 *
 * Flattening the work removes the barrier between days without changing
 * anything a booking system can see: still at most
 * PER_PLATFORM_CONCURRENCY requests in flight per platform, still the
 * same total number of requests. The only difference is that a platform
 * that finishes early gets on with the next day instead of waiting.
 *
 * ORDERING IS DAY-MAJOR, and deliberately so. The queue is walked in
 * order, so day-major means the three in-flight requests for a platform
 * are three *different courses* on the same day. Course-major would put
 * three days of the same course in flight at once — which is the same
 * volume aimed at one course rather than spread across the platform,
 * and for ForeUp it would also race three callers into the same session
 * fetch. It also means each course's days arrive in order, so its
 * session is established once and reused.
 */
interface Job {
  seed: (typeof COURSES)[number];
  /** Index into `dates`, not a day offset from today. */
  dayIndex: number;
  date: string;
}

async function fetchAll(
  jobs: Job[],
  ratings: Map<string, StaticCourse["rating"]>,
  deadline: number | null
): Promise<Map<string, StaticCourse>> {
  const byPlatform = new Map<string, Job[]>();
  for (const job of jobs) {
    byPlatform.set(job.seed.platform, [...(byPlatform.get(job.seed.platform) ?? []), job]);
  }

  const results = new Map<string, StaticCourse>();
  const skipped = new Map<string, number>();
  const timing = new Map<string, number>();

  await Promise.all(
    [...byPlatform.entries()].map(async ([platform, list]) => {
      const started = Date.now();
      const courses = new Set(list.map((j) => j.seed.slug)).size;
      await mapWithLimit(list, concurrencyFor(courses), async (job) => {
        // Past the deadline we stop *starting* work rather than killing
        // what's running. Whatever didn't get picked up falls back to the
        // published copy, which is better than publishing a course as
        // having no times when we simply never asked.
        if (deadline != null && Date.now() > deadline) {
          skipped.set(platform, (skipped.get(platform) ?? 0) + 1);
          return;
        }
        results.set(
          `${job.dayIndex}:${job.seed.slug}`,
          await fetchCourse(job.seed, job.date, ratings.get(job.seed.name))
        );
      });
      timing.set(platform, Date.now() - started);
    })
  );

  // Printed every run because it's the one number that says whether the
  // concurrency split is still right: platforms should finish close
  // together, and whichever is slowest is what a shorter tick would have
  // to beat.
  const order = [...timing].sort((a, b) => b[1] - a[1]);
  console.log(
    "  " +
      order
        .map(([p, ms]) => {
          const n = new Set(
            (byPlatform.get(p) ?? []).map((j) => j.seed.slug)
          ).size;
          return `${p} ${(ms / 1000).toFixed(1)}s (${n} courses, ${concurrencyFor(n)} at a time)`;
        })
        .join("; ")
  );

  for (const [platform, n] of skipped) {
    console.log(`  ${platform}: ${n} course-day(s) skipped — past the deadline`);
  }

  return results;
}

/**
 * The day as already published, when it's recent enough to stand. Days
 * this far out barely change, and not refetching them is what lets the
 * near days refresh often.
 */
async function reuseDay(baseUrl: string, date: string): Promise<DayFile | null> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/data/${date}.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;

    const file = (await resp.json()) as DayFile;
    const age = Date.now() - new Date(file.generatedAt).getTime();
    if (!Number.isFinite(age) || age > MAX_REUSE_AGE_MS) return null;
    if (!Array.isArray(file.courses) || file.courses.length === 0) return null;

    return file;
  } catch {
    // Not published yet, or unreachable — fetch it fresh instead.
    return null;
  }
}

interface CourseInfoFile {
  generatedAt: string;
  courses: Record<string, PlaceInfo>;
}

/** The published ratings and reviews, when they're recent enough to stand. */
async function reuseCourseInfo(baseUrl: string): Promise<CourseInfoFile | null> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/data/courses.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;

    const file = (await resp.json()) as CourseInfoFile;
    if (!file?.courses || Object.keys(file.courses).length === 0) return null;

    const age = Date.now() - new Date(file.generatedAt).getTime();
    if (!Number.isFinite(age) || age > MAX_PLACES_AGE_MS) return null;

    return file;
  } catch {
    return null;
  }
}

async function main() {
  const days = Number(arg("days", "10"));
  // Defaults to every day, so a plain run refreshes everything and the
  // tiering only applies when a schedule asks for it.
  const near = Number(arg("near", String(days)));
  // "auto" defers the choice until the published files have been read —
  // see pickBand. Everything else is a literal range, as before.
  const freshSpec = arg("fresh", `0-${near - 1}`);
  const auto = freshSpec === "auto";
  let fresh = auto ? new Set<number>() : parseFresh(freshSpec, days);
  const reuse = arg("reuse", "");
  const outDir = arg("out", "public/data");
  const today = todayInUtah();

  /**
   * When to stop starting new fetches, as an absolute time.
   *
   * The job this runs under has its own timeout, and hitting that kills
   * the run before anything is written — so a single slow platform
   * doesn't cost one course, it costs the deploy. This lands first and
   * publishes what's in hand. 0 disables it.
   */
  const budget = Number(arg("budget", "0"));
  const deadline = budget > 0 ? Date.now() + budget * 1000 : null;

  mkdirSync(outDir, { recursive: true });

  // Ratings and reviews, either carried over from the published site or
  // fetched afresh when that copy has aged out. See MAX_PLACES_AGE_MS —
  // this is about the bill, not about freshness.
  const carriedInfo = reuse ? await reuseCourseInfo(reuse) : null;
  const ratings = new Map<string, StaticCourse["rating"]>();

  if (carriedInfo) {
    for (const seed of COURSES) {
      const info = carriedInfo.courses[seed.slug];
      if (info) ratings.set(seed.name, info);
    }
    console.log(`Ratings: ${ratings.size} carried over (published ${carriedInfo.generatedAt})`);
  } else if (placesEnabled()) {
    for (const seed of COURSES) {
      const info = await getPlaceInfo(seed.name, seed.city);
      if (info) ratings.set(seed.name, info);
    }
    console.log(`Ratings: ${ratings.size}/${COURSES.length} fetched from Google`);
  }

  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const index: { dates: string[]; generatedAt: string; courseCount: number } = {
    dates,
    generatedAt: new Date().toISOString(),
    courseCount: COURSES.length,
  };

  let reused = 0;
  let undatedLinks = 0;
  /** Courses served from the last good build because this one couldn't. */
  let carriedCourses = 0;

  // Carried days first, and in parallel — they're reads of our own
  // published site, so there's nothing to be polite about, and doing
  // them up front means the answer is in hand if a fresh day later needs
  // to fall back to one.
  //
  // EVERY day is fetched here, including the ones being refreshed. The
  // per-course fallback below has always been written to use these, and
  // could never fire, because only non-fresh days were ever loaded — so
  // a course that was throttled or cut off by the deadline on a fresh
  // day published `error` and showed up in the app as a course with no
  // tee times. Indistinguishable, to a golfer, from a course that's
  // booked solid.
  //
  // Chronogolf spent four builds in that state on its far days. Ten
  // reads of our own JSON is a rounding error against one course
  // looking closed for a week.
  const carried = new Map<number, DayFile>();
  if (reuse) {
    const loaded = await Promise.all(
      dates.map(async (date, i) => ({ i, file: await reuseDay(reuse, date) }))
    );
    for (const { i, file } of loaded) if (file) carried.set(i, file);
  }

  // Which band to refresh, once the published state is known. `--fresh
  // auto` needs those files to measure staleness, which is why the
  // decision waits until here rather than being made by the caller.
  if (auto) {
    fresh = carried.size > 0 ? pickBand(carried, days) : parseFresh(`0-${days - 1}`, days);
    if (carried.size === 0) {
      console.log("auto-fresh: nothing published to compare against, so fetching every day");
    }
  }

  console.log(
    `Fetching fresh: day(s) ${[...fresh].sort((a, b) => a - b).join(", ")} of ${days}` +
      (reuse ? `; the rest carried over from ${reuse}` : "; no --reuse, so all days fetched")
  );

  // The band limit exists for one platform, so only that platform pays
  // for it.
  //
  // Chronogolf refuses after roughly 57 requests, which is three days
  // across its nineteen courses — that's the whole reason a run
  // refreshes one band instead of all ten days. The other 51 courses
  // have never refused anything, and making them share Chronogolf's
  // budget cost the near days real freshness: simulated against the
  // measured tick gaps, one-band-for-everyone refreshes today through
  // +3 every ~33 minutes, where fetching them every tick is ~18.
  //
  // So the unlimited platforms fetch EVERY day, every run, and only
  // Chronogolf rotates through bands.
  //
  // Tiering at all was a response to a 5-minute cron. That cron does not
  // exist: measured over 29 consecutive scheduled runs, GitHub delivered
  // a median gap of 28 minutes, a mean of 32, one gap of 101, and about
  // 1.9 runs an hour against the 12 requested. Rationing days across
  // twelve ticks an hour is the right call; rationing them across two is
  // just leaving days stale for no reason, because each run has budget
  // to spare — 50 courses over ten days is ~500 requests, which the
  // unlimited platforms clear well inside the 150s deadline.
  //
  // Chronogolf still rotates, because its limit is real and unrelated to
  // how often the cron fires: it refuses after roughly 57 requests,
  // which is three days across its nineteen courses.
  //
  // A day is therefore usually part fresh and part carried, which the
  // per-course fallback below already handles — it fills in any course
  // this run didn't reach.
  const everyDay = new Set(dates.map((_, i) => i));
  const daysFor = (platform: string): Set<number> =>
    RATE_LIMITED_PLATFORMS.has(platform) ? fresh : everyDay;

  const started = Date.now();
  const jobs: Job[] = dates.flatMap((date, dayIndex) =>
    COURSES.filter(
      (seed) => daysFor(seed.platform).has(dayIndex) || !carried.has(dayIndex)
    ).map((seed) => ({ seed, dayIndex, date }))
  );

  /** Any day with work queued is assembled fresh rather than reused wholesale. */
  const touched = new Set(jobs.map((j) => j.dayIndex));

  // Only days nothing was queued for count as reused; the rest are
  // insurance, and saying otherwise would overstate what was carried.
  reused = [...carried.keys()].filter((i) => !touched.has(i)).length;

  console.log(`Fetching ${jobs.length} course-day(s)…`);
  const fetched = await fetchAll(jobs, ratings, deadline);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Fetched in ${elapsed}s`);

  // Any host we ended up slower against than we started is a host that
  // told us to slow down. Worth one line: the Chronogolf throttling ran
  // for as long as the platform had been seeded and was only ever
  // visible as a failure count nobody had reason to read.
  const paced = pacingReport().filter((h) => h.intervalMs > h.initialMs);
  if (paced.length) {
    console.log(
      `  throttled by: ${paced
        .map(
          (h) =>
            `${h.host} (${h.initialMs}ms -> ${h.intervalMs}ms after ${h.refusals} refusal(s))`
        )
        .join(", ")}`
    );
  }

  // Kept so the cross-day summary can be computed from exactly what was
  // published, rather than re-reading the files back off disk.
  const written: DayFile[] = [];

  for (const [i, date] of dates.entries()) {
    // `touched`, not `fresh`: a day can now have work queued for the
    // unlimited platforms while Chronogolf sits this band out, and
    // reusing that day wholesale would throw away everything this run
    // just fetched for it.
    const carriedOver = carried.has(i) && !touched.has(i);

    // A fresh day is assembled per course rather than wholesale, so a
    // course the deadline cut off falls back to its published entry on
    // its own — the rest of the day is still this run's data.
    const file: DayFile = carriedOver
      ? carried.get(i)!
      : {
          date,
          generatedAt: new Date().toISOString(),
          courses: COURSES.map((seed) => {
            const got = fetched.get(`${i}:${seed.slug}`);
            if (got && !got.error) return got;

            // Failed as well as missing. A 429 and a deadline skip leave
            // the app in the same place — a course showing nothing —
            // and the last good answer beats that in both cases. Only
            // taken when the published copy actually has times: falling
            // back to someone else's empty day helps nobody, and
            // reuseDay already refuses anything over six hours old.
            const fallback = carried.get(i)?.courses.find((c) => c.slug === seed.slug);
            if (fallback && !fallback.error && fallback.slots.length > 0) {
              carriedCourses++;
              return fallback;
            }
            return (
              got ?? {
                id: `${seed.platform}:${seed.externalId}`,
                name: seed.name,
                slug: seed.slug,
                city: seed.city,
                county: seed.county,
                platform: seed.platform,
                bookingUrl: seed.bookingUrl,
                lat: seed.latitude,
                lon: seed.longitude,
                rating: ratings.get(seed.name),
                slots: [],
                error: "not fetched this run",
              }
            );
          }),
        };

    writeFileSync(`${outDir}/${date}.json`, JSON.stringify(file));
    written.push(file);

    const slots = file.courses.reduce((n, c) => n + c.slots.length, 0);
    const failures = file.courses.filter((c) => c.error);
    const failed = failures.length;

    // A link that doesn't carry its date sends the golfer to the wrong
    // day at the checkout, which is worse than showing no link at all.
    const undated = file.courses.filter(
      (c) =>
        !PLATFORMS_WITHOUT_DATED_LINKS.has(c.platform) &&
        c.slots.some((s) => !carriesDate(s.url, date))
    );
    undatedLinks += undated.length;

    console.log(
      `${date}: ${slots} slot(s) across ${file.courses.length - failed} course(s)` +
        (carriedOver ? " (carried over)" : "") +
        (failed ? `, ${failed} failed` : "") +
        (undated.length ? `, ${undated.length} with undated links` : "")
    );
    if (undated.length) {
      console.log(`  undated: ${undated.map((c) => c.name).join(", ")}`);
    }

    // Which ones, and why. A bare count can't be acted on: a run that
    // says "19 failed" from day +3 outward reads identically whether
    // nineteen courses simply don't sell that far ahead or an adapter
    // broke. Grouping by message answers that in one line — a booking
    // window is the same message across many courses, a broken adapter
    // is one course saying something new.
    if (failed) {
      const byReason = new Map<string, string[]>();
      for (const c of failures) {
        const reason = (c.error ?? "unknown").split("\n")[0].slice(0, 90);
        byReason.set(reason, [...(byReason.get(reason) ?? []), c.name]);
      }
      for (const [reason, names] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
        const shown = names.slice(0, 6).join(", ");
        console.log(
          `  failed (${names.length}): ${shown}${names.length > 6 ? `, +${names.length - 6} more` : ""}` +
            `\n    ${reason}`
        );
      }
    }
  }

  // Ratings and reviews go in their own file rather than into every day.
  // They're identical across all ten, and review text is long enough that
  // duplicating it would dominate each day's download.
  if (ratings.size > 0) {
    const courses = Object.fromEntries(
      COURSES.map((seed) => [seed.slug, ratings.get(seed.name)]).filter(([, v]) => v)
    );
    // generatedAt is what lets the next run decide whether to carry this
    // forward or pay for it again, so it's carried over unchanged rather
    // than stamped fresh.
    const generatedAt = carriedInfo?.generatedAt ?? new Date().toISOString();
    writeFileSync(`${outDir}/courses.json`, JSON.stringify({ generatedAt, courses }));
    console.log(`Wrote course info for ${Object.keys(courses).length} course(s)`);
  }

  const summary = summarize(written);
  writeFileSync(`${outDir}/prices.json`, JSON.stringify(summary));
  console.log(
    `Price summary: ${Object.keys(summary.days).length} day(s) priced, ` +
      `typical prices for ${Object.keys(summary.typical).length}/${COURSES.length} course(s)`
  );

  writeFileSync(`${outDir}/index.json`, JSON.stringify(index));
  console.log(
    `Wrote ${dates.length} day file(s) to ${outDir}` +
      (reused ? ` (${reused} carried over, ${dates.length - reused} fetched)` : "")
  );

  // Not a warning — this is the safety net doing its job. It's still
  // worth a number, because a net that's catching hundreds every run
  // means something upstream is broken and the app is quietly showing
  // yesterday's tee sheet rather than today's.
  if (carriedCourses) {
    console.log(
      `${carriedCourses} course-day(s) served from the last good build ` +
        `(this run couldn't fetch them; the published copy had times and was under 6h old)`
    );
  }

  if (undatedLinks) {
    console.log(
      `\nWARNING: ${undatedLinks} course-day(s) produced booking links with no ` +
        `date in them. Those send golfers to the course's default day. ` +
        `Check the adapter's booking-url builder.`
    );
  }
}

// Only when run as a command. summarize() and bandOf() are exported so
// they can be checked directly, and importing them shouldn't set 47
// courses' worth of requests going.
if (process.argv[1]?.includes("build-data")) {
  main().catch((err) => {
    console.error("build-data failed:", err);
    process.exitCode = 1;
  });
}
