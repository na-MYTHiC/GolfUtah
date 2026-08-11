# GolfUtah

A tee time aggregator for Utah golf courses.

GolfUtah pulls together live tee time availability from individual golf
course booking systems, shows how many spots are open in each slot, and
lets you compare across courses in one place instead of checking each
course's site separately. When you pick a time, GolfUtah hands you off to
that course's own booking page to enter payment and complete the
reservation — GolfUtah never touches payment info or holds a booking
itself.

## The app

One page listing every tee time GolfUtah can see for a given day, grouped
by course.

- **Filters** — date (8 days out), party size, 9 vs 18 holes, earliest and
  latest tee time, max price. Sort by tee time, price, or distance.
  Filters live in the URL, so a search is shareable and survives a
  refresh.
- **Weather per tee time** — temperature and wind at the hour you'd be
  playing, from Open-Meteo. Wind is called out above 12 mph, since it
  changes a round more than most weather widgets suggest. No API key
  needed.
- **Distance** — optional, from browser geolocation. The coordinates stay
  in the browser; they're never sent to the server.
- **Ratings** — Google Places, only if `GOOGLE_PLACES_API_KEY` is set.
  Omitted entirely otherwise rather than showing a broken panel.
- **Honest failure** — a course whose fetch failed is listed with the
  reason instead of silently vanishing, so an outage doesn't look like
  "no tee times".

Clicking a time opens that course's own booking page. GolfUtah never
handles payment.

### How it's hosted

The site is a static build on GitHub Pages, installable to a phone home
screen as a PWA — same shape as AniLog.

GitHub Pages has no server, and the courses' booking APIs mostly don't
send CORS headers, so the browser can't call them directly. Instead a
GitHub Actions cron (`.github/workflows/deploy.yml`) fetches tee times,
writes one JSON file per day into `public/data/`, builds the static site,
and deploys it. **The schedule is therefore the app's refresh rate** —
currently every 20 minutes, and the page states plainly when the data was
last checked.

Weather is the exception: Open-Meteo allows cross-origin requests, so
that's fetched live in the browser and is always current.

**Both GitHub Pages and Actions are only free on public repositories.**
This repo has to be public for the schedule to run without eating billed
Actions minutes.

Add to a phone: open the Pages URL in Safari or Chrome, then Share → Add
to Home Screen.

## Architecture

- **Next.js (App Router) + TypeScript**, built as a static export
  (`output: "export"`). No server at runtime — the page loads the JSON
  that `scripts/build-data.ts` baked in at deploy time.
- **Prisma + Postgres** (`prisma/schema.prisma`) — `Course` and `TeeTime`
  models. `TeeTime` rows are a disposable cache written by the poll
  worker, not a source of truth — always re-check with the source
  platform at booking time.
- **Platform adapters** (`lib/adapters/`) — one adapter per booking
  platform (ForeUp, Chronogolf, MemberSports), each implementing a shared
  `fetchTeeTimes()` interface that normalizes that platform's response
  into a common shape. Utah courses run on a small number of these
  platforms, so adapters are per-*platform*, not per-course — a new
  course is just a new `Course` row pointing at an existing adapter.
- **Data build** (`scripts/build-data.ts`) — what the deploy workflow
  runs: walks the courses, calls the right adapter, writes one JSON file
  per day. This is what makes a serverless host viable at all.
- **Poll worker** (`scripts/poll.ts`) — the same idea for a server
  deployment: walks active courses and upserts results into Postgres. Meant to run as a long-lived process on a
  schedule (e.g. on Railway/Fly.io), not as a serverless function —
  some adapters will need a real Playwright browser session (for
  courses that require login), which doesn't suit cold-started
  serverless functions.
- **Enrichment** (`lib/weather.ts`, `lib/places.ts`) — weather and
  ratings. Both cache aggressively, and both return null rather than
  throwing, so an upstream outage costs a badge and not the page.
- **Credential storage** (`lib/crypto.ts`, `CourseCredential` model) —
  for courses that only show full availability (or member rates) to a
  logged-in user, and eventually for auto-booking. Credentials are
  AES-256-GCM encrypted at rest with `CREDENTIALS_ENCRYPTION_KEY`
  (`npm run generate-key` to create one) — never stored in plaintext.
  One credential row per course for now (single-user assumption);
  revisit with a real `User` model before this has more than one user.

Adapter status, against a 57-course Utah survey (ForeUp 25,
Chronogolf 13, MemberSports 5):
- **ForeUp** — done, built against a real capture from Sun Hills Golf
  Course (Layton). Covers the largest share of Utah courses. Handles
  slots that are bookable as either 9 or 18 holes (`holes: "9/18"`) by
  listing each option separately, since they carry different prices.
- **MemberSports** — done, confirmed end-to-end against real captures
  from Eaglewood Golf Course (North Salt Lake), including a subtle
  time-encoding bug caught and fixed (`teeTime` is minutes-since-midnight,
  not literal HH:MM digits). No auth needed — a fresh Incognito capture
  showed the working request sends literally `Authorization: Bearer
  null`; only the public `x-api-key` header matters.
- **Chronogolf** — not started; see the comment at the top of
  `lib/adapters/chronogolf.ts` for how to find and verify its real API.

## Getting started

```bash
npm install
npm run build:data     # fetch tee times into public/data/
npm run dev            # http://localhost:3000
```

`build:data` is the same step the deploy workflow runs; without it the
page has no tee times to show. Re-run it whenever you want fresher data
locally.

To deploy, push to `main` — the workflow builds and publishes to Pages.
Enable it once under **Settings → Pages → Source: GitHub Actions**.

### The Postgres path (optional)

`scripts/poll.ts` and the Prisma schema still exist for running this as a
real server instead of a static site, which would give minute-fresh data
rather than whatever the last cron run produced:

```bash
cp .env.example .env   # set DATABASE_URL
npm run generate-key   # paste into .env as CREDENTIALS_ENCRYPTION_KEY
npm run db:migrate
npm run db:seed        # 19 courses, from lib/courses.data.ts
npm run poll -- --loop=300
```

## Adding a course

Both implemented platforms put their ids in the booking URL, so adding a
course usually needs no DevTools work at all:

| Platform | Booking URL | `externalId` |
|---|---|---|
| MemberSports | `app.membersports.com/tee-times/<clubId>/<courseId>/0` | `<clubId>:<courseId>` |
| ForeUp | `foreupsoftware.com/index.php/booking/<courseId>/<scheduleId>` | `<courseId>:<scheduleId>` |

1. Get the ids — from the URL above, or by running
   `scripts/detect-platform.ts`, which extracts them and prints
   ready-to-paste seed entries.
2. Check them against the live API before committing:
   ```bash
   npx tsx scripts/probe.ts foreup 18895:578
   npx tsx scripts/probe.ts membersports 15391:18901
   ```
3. Add the row to `prisma/seed.ts`, then `npm run db:seed`.

ForeUp has a third segment, `booking_class`, which selects the rate class
("Booking as: Regular" on the course's own page). It isn't in the URL —
only in the widget's own request — so it has to be captured from DevTools
and appended: `18895:578:177`.

**Capture it.** Without it ForeUp can return a *subset* of the tee sheet,
not merely different prices: Sun Hills lists times from 6:45am with class
177 and from 11:06am without it. Only Sun Hills has one so far, so the
other seeded ForeUp courses may be showing incomplete times. To get it:
open the course's booking page, DevTools → Network → Fetch/XHR, and read
`booking_class` off the `times` request.

There's no public directory of which courses use which platform — it has
to be discovered per course.

## Finding which courses use which platform

Course directories (18birdies, UGA, GolfNow) list names and addresses but
never say which booking platform a course uses — that only shows up on
the course's own site, where the "Book Tee Time" link points at the
platform or embeds its widget.

Two scripts cover this. First, pull the course links out of a directory
page (utah.com, UGA, 18birdies, ...):

```bash
npx tsx scripts/extract-directory.ts https://www.utah.com/.../golfing/
```

If the directory blocks plain requests or renders its list with
JavaScript, open it in a browser, Save Page As, and point the script at
the saved file instead:

```bash
npx tsx scripts/extract-directory.ts saved-page.html
```

Then check what platform each course uses:

```bash
npx tsx scripts/detect-platform.ts
npx tsx scripts/detect-platform.ts --json
```

Both default to `candidates.json`; pass `--out`/a filename to change it.
Invoke them via `npx tsx` rather than `npm run` — PowerShell eats the
`--` that `npm run` needs to forward arguments, and its `>` redirect
writes UTF-16 that fails to parse later. The scripts write their own
files to avoid both.

For MemberSports courses it pulls the `<golfClubId>:<golfCourseId>` pair
straight out of the booking URL and prints a ready-to-paste
`prisma/seed.ts` entry.

Add `--prune` to drop resolved courses from the candidates file, so
repeat runs only re-check what's still missing (seed the resolved ones
first — afterwards their ids live only in `prisma/seed.ts`).

### When plain fetching isn't enough

Many courses embed their booking widget rather than linking to it, so the
platform never appears in the served HTML — it only shows up once
JavaScript runs and the widget calls its own API. `detect-platform.ts`
reports those as UNKNOWN, or as a platform with no ids.

`scripts/render-detect.ts` loads those pages in a real browser and watches
the network, which is how the ids were originally found by hand in
DevTools:

```bash
npx playwright install chromium        # once
npx tsx scripts/render-detect.ts scripts/courses.candidates.json
npx tsx scripts/render-detect.ts scripts/courses.candidates.json --headed
```

It catches widgets loaded from external bundles, iframes injected after
load, and platform API calls. Slower than the fetch-based pass, so run
that one first and point this at what's left. Set `CHROMIUM_PATH` to use
an existing browser binary instead of Playwright's own.

### Courses behind a login

A few courses put the tee sheet itself behind a sign-in, so no amount of
rendering will reveal it anonymously. Capture a session once:

```bash
npx tsx scripts/render-detect.ts --login https://www.golftheridgegc.com/
```

A browser opens; sign in by hand, then press Enter. The session is saved
per-host under `playwright/.auth/` (gitignored) and reused automatically
on later runs. The script never asks for or stores credentials — only the
session that results from you signing in yourself.

Courses that genuinely share one booking system also share a login, so
one capture can cover several. Point the others at it with `auth`:

```json
{ "name": "Some Course", "url": "https://...", "auth": "othercourse.com" }
```

Neighbouring courses aren't necessarily one install, though — The Ridge
and Stonebridge look like a shared page but are ForeUp courses 22131 and
22130, two separate installs with separate logins. Check the booking URL
before assuming.

Worth being clear about what this implies for the product: if a course
gates *availability* behind login (rather than just checkout), GolfUtah
can only show its times to someone who has an account there. That's a
per-user constraint, not something a shared scraper can solve — which is
what `CourseCredential` and `lib/crypto.ts` exist for.

`scripts/courses.candidates.json` holds the Utah courses still to work
out. It requests one site at a time with a delay, deliberately: it should
behave like a person clicking through a directory. Don't parallelize it.

## Status

Two of the three platforms are implemented, between them covering 30 of
the 57 Utah courses surveyed. Both were built against real captured
traffic, and their response mappings are verified against that data.

Seeded so far: 19 courses — 5 MemberSports and 14 ForeUp. The remaining
38 are tracked in `scripts/courses.candidates.json`, mostly the 13
Chronogolf courses (no adapter yet) plus ForeUp courses whose ids
fetch-based detection couldn't reach.

Outstanding validation: the scheduled build hasn't run in GitHub Actions
yet. `scripts/probe.ts` confirms both adapters return real tee times, and
the static build has been exercised end-to-end in a browser under a
Pages-style sub-path, but the first live deploy is still ahead.

**Roadmap:** aggregation (read-only availability) first, hand off to the
course's own checkout for now. Auto-booking is a later phase, once
aggregation is solid for a real set of courses.

## Notes on data accuracy

- Prefer hitting each platform's internal JSON endpoint (found via
  devtools Network tab) over scraping rendered HTML — faster and far
  less fragile.
- Poll frequently, but always do a live check right before handoff —
  cached availability can go stale within minutes as other golfers book
  directly.
- ForeUp, Chronogolf, and most similar platforms generally restrict
  automated access in their Terms of Service — worth pursuing legitimate
  API/partner access as this grows past personal use.
- The discovery and probe scripts request one page at a time with a
  delay, on purpose. Keep it that way: the point is to look like a person
  browsing, not to hammer a course's booking system.

## License

TBD.
