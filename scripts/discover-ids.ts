/**
 * Resolves booking ids for any platform by watching a real browser load
 * a course's booking page.
 *
 * scripts/detect-platform.ts fetches HTML and often can't tell what a
 * course runs, because the booking widget is loaded by JavaScript and
 * never appears in the served markup. This opens the page in Chromium
 * and listens to the traffic instead — the same thing a person does in
 * DevTools, which is how every id in this repo was found.
 *
 * It reads ids from the widget's *responses* wherever possible, because
 * those carry every id together and unambiguously:
 *
 *   ForeUp        each row has course_id, schedule_id, booking_class_id
 *   MemberSports  each item has golfClubId, golfCourseId
 *   Chronogolf    each teetime has course.uuid (see chronogolf-discover)
 *
 * The ForeUp booking_class matters more than it looks. Without it a tee
 * sheet can come back truncated — Sun Hills listed from 11:06am instead
 * of 6:45am — so `--refresh` re-visits courses already seeded without
 * one and captures it.
 *
 * Must run somewhere that can reach the booking sites.
 *
 * Usage:
 *   npx tsx scripts/discover-ids.ts                  # unseeded candidates
 *   npx tsx scripts/discover-ids.ts --refresh        # seeded ForeUp, for booking_class
 *   npx tsx scripts/discover-ids.ts --headed         # watch it work
 *   npx tsx scripts/discover-ids.ts --out found.json
 *   npx tsx scripts/discover-ids.ts "https://someclub.com/"   # one page
 *
 * Needs a browser once:  npx playwright install chromium
 */
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { COURSES } from "../lib/courses.data";
import CANDIDATES from "./courses.candidates.json";

const NAV_TIMEOUT_MS = 30_000;
/** Time to let a widget fire its own requests after the page settles. */
const SETTLE_MS = 5_000;
/** How long to wait for an availability request before giving up. */
const CAPTURE_TIMEOUT_MS = 15_000;
const DELAY_BETWEEN_COURSES_MS = 2_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/**
 * TEEITUP has no adapter yet — it turned up while surveying the last
 * stragglers. It's reported so its courses can be counted and seeded
 * once one exists; a seed entry naming it won't typecheck against
 * PlatformName until then, which is the intended nudge.
 */
type Platform =
  | "FOREUP"
  | "MEMBERSPORTS"
  | "CHRONOGOLF"
  | "TEEITUP"
  | "TEEROCKET"
  | "GOLFPAY";

interface Ids {
  platform: Platform;
  externalId: string;
  /** Where it came from, so a surprising result can be traced. */
  source: string;
  /**
   * The platform's own name for the course, when it says. Saves having
   * to know which course a bare booking link belongs to — ids alone
   * don't identify a course, and guessing puts wrong data in the app.
   */
  courseName?: string;
}

interface Target {
  name: string;
  city?: string;
  url: string;
}

interface Finding extends Target {
  ids?: Ids;
  note?: string;
  /**
   * What the page actually said when nothing was found. Four ForeUp
   * courses stall before their tee sheet loads and no amount of guessing
   * at button labels has fixed it — this puts the screen in the output
   * file so the blocker can be read rather than described.
   */
  pageText?: string;
}

/**
 * Collects ids seen on one page. A response-derived hit always beats a
 * URL-derived one: a booking URL gives course and schedule but never the
 * booking class, and a half-answer that looks complete is worse than an
 * obviously missing one.
 */
class Collector {
  private best?: Ids;

  /**
   * @param baseline ids already visible in the page address we asked
   * for. Reading those back out is not a discovery — in --refresh mode
   * every target *is* a ForeUp booking URL, so without this the script
   * reports a confident hit for every course while having captured
   * nothing at all.
   */
  constructor(private readonly baseline?: string) {}

  offer(ids: Ids | undefined): void {
    if (!ids) return;
    // Nothing new: same ids we were handed, and no name to go with them.
    if (ids.externalId === this.baseline && !ids.courseName) return;
    if (!this.best || rank(ids) > rank(this.best)) this.best = ids;
  }

  get result(): Ids | undefined {
    return this.best;
  }
}

/** More colons means more ids; a response hit outranks a URL hit. */
function rank(ids: Ids): number {
  return ids.externalId.split(":").length * 2 + (ids.source.includes("response") ? 1 : 0);
}

const FOREUP_BOOKING_URL = /foreupsoftware\.com\/index\.php\/booking\/(\d+)\/(\d+)/;

/**
 * Real ForeUp course ids are five digits; Crane Field's page yields
 * "1:1", which is placeholder markup rather than a course. Schedule ids
 * genuinely can be small (Timpanogos is 6279:49), so only the course id
 * is checked.
 */
function isPlaceholder(courseId: string): boolean {
  return Number(courseId) < 100;
}

function fromForeUpUrl(url: string): Ids | undefined {
  const m = FOREUP_BOOKING_URL.exec(url);
  if (!m || isPlaceholder(m[1])) return undefined;
  return { platform: "FOREUP", externalId: `${m[1]}:${m[2]}`, source: "booking url" };
}

/** ForeUp rows carry all three ids, which is the whole point of reading them. */
function fromForeUpResponse(rows: unknown): Ids | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const r = rows[0] as {
    course_id?: number;
    schedule_id?: number;
    booking_class_id?: number;
    course_name?: string;
  };
  if (!r.course_id || !r.schedule_id) return undefined;
  const parts = [r.course_id, r.schedule_id];
  if (r.booking_class_id) parts.push(r.booking_class_id);
  return {
    platform: "FOREUP",
    externalId: parts.join(":"),
    source: "times response",
    courseName: r.course_name,
  };
}

function fromMemberSports(body: unknown): Ids | undefined {
  // The response is an array of buckets, each with items carrying ids.
  const buckets = body as { items?: { golfClubId?: number; golfCourseId?: number }[] }[];
  if (!Array.isArray(buckets)) return undefined;
  for (const bucket of buckets) {
    for (const item of bucket.items ?? []) {
      if (item.golfClubId && item.golfCourseId) {
        return {
          platform: "MEMBERSPORTS",
          externalId: `${item.golfClubId}:${item.golfCourseId}`,
          source: "teetimes response",
        };
      }
    }
  }
  return undefined;
}

/** MemberSports sends its ids in the request body too, times or not. */
function fromMemberSportsRequest(postData: string | null): Ids | undefined {
  if (!postData) return undefined;
  try {
    const body = JSON.parse(postData) as { golfClubId?: number; golfCourseId?: number };
    if (!body.golfClubId || !body.golfCourseId) return undefined;
    return {
      platform: "MEMBERSPORTS",
      externalId: `${body.golfClubId}:${body.golfCourseId}`,
      source: "teetimes request",
    };
  } catch {
    return undefined;
  }
}

function fromChronogolf(url: string): Ids | undefined {
  if (!url.includes("/marketplace/v2/teetimes")) return undefined;
  const ids = new URL(url).searchParams.get("course_ids");
  const slug = /chronogolf\.com\/club\/([a-z0-9-]+)/i.exec(url)?.[1];
  if (!ids) return undefined;
  // The slug lives on the page, not the API call, so it's filled in by
  // the caller when known.
  return {
    platform: "CHRONOGOLF",
    externalId: `${slug ?? "<slug>"}:${ids}`,
    source: "teetimes request",
  };
}

/**
 * Ids straight out of a booking link's address, no traffic required.
 *
 * This is the cheap path and should be tried first. Most course websites
 * don't embed a booking widget at all — they just link out to it, and
 * the link's href already contains the ids. The first version of this
 * script only watched network traffic and so found nothing on 24 of 24
 * courses, including Valley View, whose ForeUp ids were sitting in an
 * anchor tag the whole time.
 */
const LINK_PATTERNS: { platform: Platform; re: RegExp; ids: (m: RegExpMatchArray) => string }[] = [
  {
    platform: "FOREUP",
    re: /foreupsoftware\.com\/index\.php\/booking\/(\d+)\/(\d+)/i,
    ids: (m) => (isPlaceholder(m[1]) ? "" : `${m[1]}:${m[2]}`),
  },
  {
    platform: "MEMBERSPORTS",
    re: /app\.membersports\.com\/tee-times\/(\d+)\/(\d+)/i,
    ids: (m) => `${m[1]}:${m[2]}`,
  },
  {
    // Only the club slug — the course uuids still need a page load, which
    // followUp() does.
    platform: "CHRONOGOLF",
    re: /chronogolf\.com\/(?:en\/)?club\/([a-z0-9-]+)/i,
    ids: (m) => m[1],
  },
  {
    // TeeItUp books under a per-operator subdomain; the alias in it is
    // also the x-be-alias header its API wants. Facility ids come from
    // the API call, not the link.
    platform: "TEEITUP",
    re: /([a-z0-9-]+)\.book-v2\.teeitup\.golf/i,
    ids: (m) => m[1],
  },
  {
    // TeeRocket — a Firebase app rather than an API. Only a Firestore
    // document path identifies a course: group/<groupId>/course/<courseId>.
    // Matching anything after the host caught "page/TeeTimes" for
    // Schneiter's Riverside, which is a route in the widget, not an id.
    platform: "TEEROCKET",
    re: /trwidget\.web\.app\/(?:#\/)?(group\/[A-Za-z0-9_-]+\/course\/[A-Za-z0-9_-]+)/i,
    ids: (m) => m[1],
  },
  {
    // GolfPay addresses a course by a descriptive slug that already
    // encodes city and ZIP, e.g. the-barn-golf-club-ogden-ut-84414.
    // Its pages also carry ?date=YYYY-MM-DD, so deep links are cheap.
    // Detection only — no availability capture yet.
    platform: "GOLFPAY",
    re: /golfpay\.co\/course\/([a-z0-9-]+)/i,
    ids: (m) => m[1],
  },
];

/**
 * TeeRocket, spotted by the Firebase project its widget talks to.
 *
 * Detection only — there's deliberately no adapter. Unlike the other
 * four platforms, TeeRocket has no JSON endpoint to call: the widget is
 * a Firebase client and its data arrives over Firestore's streaming
 * channel, a length-prefixed protobuf-over-JSON protocol that isn't
 * meaningfully reproducible with fetch().
 *
 * More importantly, Schneiter's puts availability behind a user account.
 * scripts/teerocket-probe.ts loaded the widget and got:
 *
 *   "Please login to reserve a tee time for Schneiter's Bluff Golf
 *    Course. Login / Forgot Password / Don't have an account?"
 *
 * So this isn't an adapter problem. The tee sheet isn't public at all,
 * which puts it in the same category as The Ridge: readable only with
 * credentials, via the CourseCredential path in lib/crypto.ts.
 *
 * Note also that the widget's route says group/<id>/course/<id> while
 * Firestore's collections are plural — groups/<id>/courses/<id>. An
 * earlier REST test used the singular route form and got 403, which
 * proved nothing: Firestore answers PERMISSION_DENIED rather than
 * NOT_FOUND for paths that don't exist, so a wrong path and a forbidden
 * one look identical.
 *
 * The subscriptions the widget makes, for whoever picks this up:
 *   groups/YFlPUck58D81fB5Kqqa8
 *   groups/YFlPUck58D81fB5Kqqa8/courses/BH4MnB2co04ve5At3aQl
 *   a query over groups/YFlPUck58D81fB5Kqqa8/courses  <- lists every
 *   course in the group, which is where Schneiter's Riverside's id
 *   would come from; its own page only reaches the widget's generic
 *   "select a group first" screen.
 */
function fromFirestore(url: string): Ids | undefined {
  const project = /firestore\.googleapis\.com\/.*projects(?:%2F|\/)([a-z0-9-]+)/i.exec(url)?.[1];
  if (project !== "teerocket") return undefined;
  return { platform: "TEEROCKET", externalId: "teerocket", source: "firestore channel" };
}

/**
 * TeeItUp's availability call, e.g.
 *   phx-api-be-east-1b.kenna.io/v2/tee-times
 *     ?date=2026-08-16&facilityIds=17070,17067&returnPromotedRates=true
 *
 * A booking site can front several facilities at once, the way a
 * Chronogolf club can publish several courses — so facilityIds is a
 * list. The operator alias rides in the x-be-alias header and in the
 * request's own origin.
 */
function fromTeeItUp(url: string, headers: Record<string, string>): Ids | undefined {
  if (!/kenna\.io\/v\d+\/tee-times/i.test(url)) return undefined;
  const facilityIds = new URL(url).searchParams.get("facilityIds");
  if (!facilityIds) return undefined;
  const alias =
    headers["x-be-alias"] ||
    /([a-z0-9-]+)\.book-v2\.teeitup\.golf/i.exec(headers["origin"] ?? "")?.[1] ||
    "<alias>";
  return {
    platform: "TEEITUP",
    externalId: `${alias}:${facilityIds}`,
    source: "tee-times request",
  };
}

function fromAnyUrl(url: string, source: string): Ids | undefined {
  for (const { platform, re, ids } of LINK_PATTERNS) {
    const m = re.exec(url);
    if (!m) continue;
    const externalId = ids(m);
    if (!externalId) return undefined; // placeholder, not a course
    return { platform, externalId, source };
  }
  return undefined;
}

/**
 * Hosts worth following a link to. Most misses in the first full run
 * were courses whose site links out to a booking platform in a shape
 * this script didn't recognise — "booking links point at
 * foreupsoftware.com" on six courses that are plainly ForeUp. Following
 * the link lands on the booking page, where the widget names its own
 * ids.
 */
const BOOKING_HOSTS =
  /foreupsoftware\.com|chronogolf\.com|app\.membersports\.com|teeitup\.(?:golf|com)|kenna\.io|golfpay\.co|quick18\.com|golfrev\.com|trwidget\.web\.app/i;

/**
 * Every address the page mentions: link targets, embedded frames, and
 * anything URL-shaped in the markup. Widgets are often injected by a
 * script, so the raw HTML is worth scanning too.
 */
async function pageUrls(page: Page): Promise<string[]> {
  const urls: string[] = [];
  try {
    urls.push(
      ...(await page.$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href)))
    );
    urls.push(
      ...(await page.$$eval("iframe[src]", (els) => els.map((e) => (e as HTMLIFrameElement).src)))
    );
    for (const frame of page.frames()) urls.push(frame.url());
    const html = await page.content();
    urls.push(...(html.match(/https?:\/\/[^\s"'<>\\)]+/g) ?? []));
  } catch {
    // Page navigated or closed mid-scan; whatever was collected stands.
  }
  return urls;
}

/**
 * Same-origin pages worth a look when the landing page has no booking
 * link — courses commonly keep it one click away under "Tee Times".
 */
async function bookingSubpages(page: Page, limit: number): Promise<string[]> {
  try {
    const origin = new URL(page.url()).origin;
    const links = await page.$$eval("a[href]", (els) =>
      els.map((e) => ({
        href: (e as HTMLAnchorElement).href,
        text: (e.textContent ?? "").trim().slice(0, 80),
      }))
    );
    const seen = new Set<string>();
    return links
      .filter((l) => l.href.startsWith(origin))
      .filter((l) => /tee.?time|book|reserve|golf/i.test(`${l.text} ${l.href}`))
      .map((l) => l.href.split("#")[0])
      .filter((h) => h !== page.url() && !seen.has(h) && seen.add(h))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Click a booking-looking control — some widgets load only on demand. */
async function nudge(page: Page): Promise<void> {
  const patterns = [
    /book.*tee.*time/i,
    /tee.*times?/i,
    /book.*now/i,
    /reserve/i,
    // ForeUp asks which rate class you're booking as before showing the
    // sheet, and that choice *is* the booking_class we're after. The
    // wording is per-course, so this lists what's actually been seen
    // plus the obvious neighbours.
    /^(public|guest|resident|regular|non.?resident|standard|open|daily.?fee|walk|ride)/i,
  ];
  for (const pattern of patterns) {
    for (const role of ["link", "button"] as const) {
      try {
        const target = page.getByRole(role, { name: pattern }).first();
        if (await target.isVisible({ timeout: 1_000 })) {
          await target.click({ timeout: 5_000 });
          await page.waitForTimeout(SETTLE_MS);
          return;
        }
      } catch {
        // not present or not clickable — try the next pattern
      }
    }
  }

  // Last resort, and only on ForeUp itself: its rate-class step is a
  // short list of buttons whose labels are course-specific, so no word
  // list will ever cover them all. Murray Parkway, Davis Park and The
  // Ridge all stalled here. Clicking the first one picks *a* class,
  // which is enough — the response names whichever it was.
  if (!/foreupsoftware\.com/i.test(page.url())) return;
  try {
    const buttons = page.locator("button:visible, a.btn:visible");
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const label = (await buttons.nth(i).textContent())?.trim() ?? "";
      // Skip the chrome: navigation, language pickers, dismissals.
      if (!label || /login|sign.?in|close|cancel|back|espa|fran/i.test(label)) continue;
      await buttons.nth(i).click({ timeout: 5_000 });
      await page.waitForTimeout(SETTLE_MS);
      return;
    }
  } catch {
    // Nothing clickable — the caller reports the miss.
  }
}

/** A link-derived hit that's still missing the part only a page load gives. */
function needsFollowUp(ids: Ids): boolean {
  if (ids.platform === "FOREUP") return ids.externalId.split(":").length < 3;
  if (ids.platform === "CHRONOGOLF") return !ids.externalId.includes(":");
  return false;
}

/**
 * Opens the platform's own booking page so its widget fires the request
 * that carries the rest: ForeUp's booking_class_id, or Chronogolf's
 * course uuids. The context listeners pick both up, so this only has to
 * navigate and wait.
 */
async function followUp(
  context: BrowserContext,
  ids: Ids,
  found: Collector
): Promise<void> {
  const [a, b] = ids.externalId.split(":");
  const url =
    ids.platform === "FOREUP"
      ? `https://foreupsoftware.com/index.php/booking/${a}/${b}#/teetimes`
      : `https://www.chronogolf.com/club/${a}?${new URLSearchParams({
          date: new Date().toISOString().slice(0, 10),
          step: "teetimes",
          holes: "",
          coursesIds: "",
          deals: "false",
          groupSize: "0",
        })}`;

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page
      .waitForResponse((r) => /api\/booking\/times|marketplace\/v2\/teetimes/.test(r.url()), {
        timeout: CAPTURE_TIMEOUT_MS,
      })
      .catch(() => undefined);
    // ForeUp may ask which rate class first; that choice is the id.
    if (needsFollowUp(found.result ?? ids)) {
      await nudge(page);
    }
    await page.waitForTimeout(2_000);
  } catch {
    // The link-derived ids still stand.
  } finally {
    await page.close();
  }
}

async function inspect(browser: Browser, target: Target): Promise<Finding> {
  const context = await browser.newContext({
    userAgent: UA,
    // One course (Homestead) serves a TLS setup Chromium rejects
    // outright. We're reading public booking ids, not trusting the site
    // with anything, so a handshake it dislikes shouldn't end the run.
    ignoreHTTPSErrors: true,
  });
  const found = new Collector(fromForeUpUrl(target.url)?.externalId);
  /** Third-party hosts a booking link pointed at, for the ones that miss. */
  const bookingHosts = new Set<string>();

  // Listening on the context rather than the page is the important part:
  // booking links routinely open in a new tab, and a page-level listener
  // never sees a word of what happens there.
  context.on("request", (req) => {
    const url = req.url();
    found.offer(fromForeUpUrl(url));
    found.offer(fromChronogolf(url));
    found.offer(fromTeeItUp(url, req.headers()));
    found.offer(fromFirestore(url));
    if (url.includes("onlineBookingTeeTimes")) {
      found.offer(fromMemberSportsRequest(req.postData()));
    }
  });

  context.on("response", async (resp) => {
    const url = resp.url();
    if (!resp.ok()) return;
    try {
      if (url.includes("/api/booking/times")) {
        found.offer(fromForeUpResponse(await resp.json()));
      } else if (url.includes("onlineBookingTeeTimes")) {
        found.offer(fromMemberSports(await resp.json()));
      }
    } catch {
      // Body gone or not JSON — the request-side hits still stand.
    }
  });

  const page = await context.newPage();

  // Chronogolf's API is addressed by uuid and never mentions the club
  // slug, but the seed entry needs both. The slug only ever appears in
  // the link that got us there, so it's kept aside and stitched back on.
  let chronoSlug: string | undefined;

  /** Links to a booking platform, to be followed when nothing else works. */
  const bookingLinks = new Set<string>();

  /** Read every address a page mentions, and note where bookings point. */
  const harvest = async (p: Page) => {
    for (const url of await pageUrls(p)) {
      const hit = fromAnyUrl(url, "page link");
      if (hit?.platform === "CHRONOGOLF" && !hit.externalId.includes(":")) {
        chronoSlug ??= hit.externalId;
      }
      found.offer(hit);

      if (BOOKING_HOSTS.test(url)) bookingLinks.add(url.split("#")[0]);

      if (BOOKING_HOSTS.test(url) || /tee.?time|booking|reserve/i.test(url)) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "");
          if (host !== new URL(p.url()).hostname.replace(/^www\./, "")) bookingHosts.add(host);
        } catch {
          // not a parseable URL — ignore
        }
      }
    }
  };

  /** Wait for whichever availability call the platform makes. */
  const awaitAvailability = (p: Page) =>
    p
      .waitForResponse(
        (r) =>
          /api\/booking\/times|onlineBookingTeeTimes|marketplace\/v2\/teetimes|kenna\.io\/v\d+\/tee-times/.test(
            r.url()
          ),
        { timeout: CAPTURE_TIMEOUT_MS }
      )
      .catch(() => undefined);

  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    await harvest(page);

    // Nothing on the landing page — try the obvious subpages, then a click.
    if (!found.result) {
      for (const url of await bookingSubpages(page, 3)) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
        await page.waitForTimeout(2_000);
        await harvest(page);
        if (found.result) break;
      }
    }

    if (!found.result) {
      await nudge(page);
      await harvest(page);
      for (const p of context.pages()) await harvest(p);
    }

    // Still nothing, but the site links out to a platform we know: go
    // there. This is what the first full run was missing — six courses
    // reported "booking links point at foreupsoftware.com" while their
    // ids sat one navigation away.
    if (!found.result) {
      for (const link of [...bookingLinks].slice(0, 3)) {
        await page
          .goto(link, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
          .catch(() => undefined);
        await page.waitForTimeout(SETTLE_MS);
        await harvest(page);
        if (!found.result) {
          await nudge(page);
          await awaitAvailability(page);
          await harvest(page);
        }
        if (found.result) break;
      }
    }

    // A link gives ids but never a ForeUp booking class, and never
    // Chronogolf's course uuids. Both need the booking page itself, so
    // go there and let the widget do the work.
    const partial = found.result;
    if (partial && needsFollowUp(partial)) {
      await followUp(context, partial, found);
    }

    const ids = found.result;
    if (ids) return { ...target, ids };

    const pageText = await page
      .evaluate(() => document.body.innerText)
      .then((t) => t.replace(/\n{3,}/g, "\n\n").trim().slice(0, 2_000))
      .catch(() => undefined);

    return {
      ...target,
      note: bookingHosts.size
        ? `no ids found; booking links point at ${[...bookingHosts].join(", ")}`
        : "no booking link or traffic found",
      pageText,
    };
  } catch (err) {
    // A timeout after a sighting still counts — the ids are real.
    const ids = found.result;
    if (ids) return { ...target, ids };
    return { ...target, note: (err as Error).message.split("\n")[0] };
  } finally {
    await context.close();
  }
}

/** "Mount Ogden Golf Course" -> "mount-ogden-golf-course" */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function printSeed(f: Finding): void {
  console.log(`  {
    name: ${JSON.stringify(f.ids!.courseName ?? f.name)},
    slug: ${JSON.stringify(slugify(f.ids!.courseName ?? f.name))},
    county: "", // TODO
    city: ${JSON.stringify(f.city ?? "")},
    platform: ${JSON.stringify(f.ids!.platform)},
    externalId: ${JSON.stringify(f.ids!.externalId)},
    bookingUrl: ${JSON.stringify(f.url)},
    latitude: 0, // TODO
    longitude: 0, // TODO
  },`);
}

/** Courses in the tracker that aren't seeded yet. */
function unseededCandidates(): Target[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const seeded = new Set(COURSES.map((c) => norm(c.name)));
  return (CANDIDATES as Target[]).filter((c) => !seeded.has(norm(c.name)));
}

/**
 * Seeded ForeUp courses with no booking class, pointed at their own
 * booking pages. These already work; the aim is to stop their sheets
 * being truncated.
 */
function foreUpNeedingClass(): Target[] {
  return COURSES.filter(
    (c) => c.platform === "FOREUP" && c.externalId.split(":").length < 3
  ).map((c) => {
    const [courseId, scheduleId] = c.externalId.split(":");
    return {
      name: c.name,
      city: c.city,
      url: `https://foreupsoftware.com/index.php/booking/${courseId}/${scheduleId}#/teetimes`,
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes("--headed");
  const refresh = args.includes("--refresh");
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : "discovered-ids.json";

  const urls = args.filter(
    (a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1)
  );

  const targets: Target[] = urls.length
    ? urls.map((url) => ({ name: url, url }))
    : refresh
      ? foreUpNeedingClass()
      : unseededCandidates();

  console.log(
    `${targets.length} course(s) to inspect` +
      (refresh ? " (ForeUp, looking for booking_class)" : "") +
      `\n`
  );

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const findings: Finding[] = [];

  try {
    for (const target of targets) {
      process.stdout.write(`${target.name} ... `);
      const finding = await inspect(browser, target);
      if (finding.ids) {
        console.log(
          `${finding.ids.platform}  ${finding.ids.externalId}  (${finding.ids.source})` +
            (finding.ids.courseName ? `  "${finding.ids.courseName}"` : "")
        );
      } else {
        console.log(finding.note);
      }
      findings.push(finding);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_COURSES_MS));
    }
  } finally {
    await browser.close();
  }

  const hits = findings.filter((f) => f.ids);
  console.log(`\nResolved ${hits.length} of ${findings.length}.`);

  // Two courses resolving to one id means the site has a single shared
  // booking link and the per-course schedule was never reached. Seeding
  // both would show every golfer the same tee sheet under two names, so
  // this is called out rather than printed as a clean result.
  const byId = new Map<string, Finding[]>();
  for (const f of hits) {
    const key = `${f.ids!.platform}:${f.ids!.externalId}`;
    byId.set(key, [...(byId.get(key) ?? []), f]);
  }
  const collisions = [...byId.entries()].filter(([, fs]) => fs.length > 1);
  if (collisions.length) {
    console.log(`\nSAME IDS FOR DIFFERENT COURSES — do not seed these as-is:`);
    for (const [key, fs] of collisions) {
      console.log(`  ${key}\n    ${fs.map((f) => f.name).join("\n    ")}`);
    }
    console.log(
      `  Open each course's own booking link; they'll differ by schedule id.`
    );
  }

  if (refresh) {
    const withClass = hits.filter((f) => f.ids!.externalId.split(":").length === 3);
    console.log(`Captured a booking class for ${withClass.length}.\n`);
    for (const f of withClass) {
      console.log(`  ${f.name}: externalId: "${f.ids!.externalId}",`);
    }
  } else if (hits.length) {
    const collided = new Set(collisions.flatMap(([, fs]) => fs.map((f) => f.name)));
    const clean = hits.filter((f) => !collided.has(f.name));
    if (clean.length) {
      console.log(`\nPaste into lib/courses.data.ts:\n`);
      for (const f of clean) printSeed(f);
    }
  }

  const misses = findings.filter((f) => !f.ids);
  if (misses.length) {
    console.log(`\nNothing seen for:`);
    for (const f of misses) console.log(`  ${f.name} — ${f.note}`);
    if (misses.some((f) => f.pageText)) {
      console.log(
        `  What those pages showed is in the output file, under pageText.`
      );
    }
  }

  writeFileSync(outFile, JSON.stringify(findings, null, 2));
  console.log(`\nWrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
