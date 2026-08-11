# GolfUtah

A tee time aggregator for Utah golf courses.

GolfUtah pulls together live tee time availability from individual golf
course booking systems, shows how many spots are open in each slot, and
lets you compare across courses in one place instead of checking each
course's site separately. When you pick a time, GolfUtah hands you off to
that course's own booking page to enter payment and complete the
reservation — GolfUtah never touches payment info or holds a booking
itself.

## Architecture

- **Next.js (App Router) + TypeScript** — the web app (`app/`) and a
  read-only API route (`app/api/tee-times`) that serve cached data.
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
- **Poll worker** (`scripts/poll.ts`) — a standalone script (`npm run
  poll`) that walks active courses, calls the right adapter, and upserts
  results into Postgres. Meant to run as a long-lived process on a
  schedule (e.g. on Railway/Fly.io), not as a serverless function —
  some adapters will need a real Playwright browser session (for
  courses that require login), which doesn't suit cold-started
  serverless functions.
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
cp .env.example .env
npm run generate-key   # paste the output into .env as CREDENTIALS_ENCRYPTION_KEY
# set DATABASE_URL in .env too
npm install
npm run db:migrate     # create tables
npm run db:seed        # add real courses to prisma/seed.ts first
npm run dev            # http://localhost:3000
```

To populate tee time data once at least one adapter is implemented:

```bash
npm run poll            # one pass
npm run poll -- --loop=300   # repeat every 5 minutes
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

ForeUp has an optional third segment, `booking_class`, which selects the
rate class. It isn't in the URL — only in the widget's own request — so
it's left off by default. If a ForeUp course returns nothing or prices
that look wrong, capture its `booking_class` from DevTools and append it:
`18895:578:177`.

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

`scripts/courses.candidates.json` holds the Utah courses still to work
out. It requests one site at a time with a delay, deliberately: it should
behave like a person clicking through a directory. Don't parallelize it.

## Status

Two of the three platforms are implemented, covering 30 of the 57 Utah
courses surveyed. Both were built against real captured traffic and their
response mappings are unit-verified against that captured data. Neither
has yet made a live network call from this repo — development happened in
a sandbox that can't reach external hosts — so the first real run against
Postgres via `npm run poll` is the remaining validation step.

Seeded so far: 17 courses — 5 MemberSports and 12 ForeUp. The remaining
40 are tracked in `scripts/courses.candidates.json`: 13 Chronogolf (no
adapter yet), 12 ForeUp whose ids detection couldn't reach, 12 with no
platform detected, and Crane Field, whose page yielded a placeholder id.

Neither adapter has written to a real database yet — `scripts/probe.ts`
confirms the live API calls work, but the first `npm run poll` against
Postgres is still the outstanding validation.

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
