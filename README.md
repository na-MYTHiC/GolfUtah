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

Adapter status:
- **MemberSports** — done, confirmed end-to-end against real captures
  from Eaglewood Golf Course (North Salt Lake): request shape, response
  mapping, and a subtle time-encoding bug caught and fixed (`teeTime` is
  minutes-since-midnight, not literal HH:MM digits). Turns out no auth is
  needed at all — a fresh Incognito capture showed the working request
  sends literally `Authorization: Bearer null`; only the public
  `x-api-key` header matters.
- **ForeUp**, **Chronogolf** — not started; see the comments at the top
  of each file in `lib/adapters/` for how to find and verify each
  platform's real API.

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

## Adding a MemberSports course

The MemberSports adapter is done, so adding a course is just finding its
two IDs — no new reverse-engineering needed.

1. Open the course's booking page. If it's on MemberSports the URL looks
   like `app.membersports.com/tee-times/<golfClubId>/<golfCourseId>/0`,
   so the IDs are often right there in the address bar. Otherwise open
   DevTools → Network → Fetch/XHR, load the tee sheet, and read them off
   the `onlineBookingTeeTimes` request body.
2. Sanity-check the pair before committing to it:
   ```bash
   npm run probe -- <golfClubId> <golfCourseId> [YYYY-MM-DD]
   ```
   It prints the slots that come back, or tells you if nothing does.
3. Add a row to `prisma/seed.ts` with the name, city, and
   `externalId: "<golfClubId>:<golfCourseId>"`, then `npm run db:seed`.

There's no public directory of which courses use MemberSports — it has to
be discovered per course.

## Finding which courses use which platform

Course directories (18birdies, UGA, GolfNow) list names and addresses but
never say which booking platform a course uses — that only shows up on
the course's own site, where the "Book Tee Time" link points at the
platform or embeds its widget.

Two scripts cover this. First, pull the course links out of a directory
page (utah.com, UGA, 18birdies, ...):

```bash
npm run extract -- https://www.utah.com/.../golfing/ > candidates.json
```

If the directory blocks plain requests or renders its list with
JavaScript, open it in a browser, Save Page As, and point the script at
the saved file instead:

```bash
npm run extract -- saved-page.html > candidates.json
```

Then check what platform each course uses:

```bash
npm run detect -- candidates.json
npm run detect -- candidates.json --json > found.json
```

For MemberSports courses it pulls the `<golfClubId>:<golfCourseId>` pair
straight out of the booking URL and prints a ready-to-paste
`prisma/seed.ts` entry.

`scripts/courses.candidates.json` is a starting list of Utah courses —
the URLs are best guesses and some will 404, so fix or extend it as you
go. It requests one site at a time with a delay, deliberately: it should
behave like a person clicking through a directory. Don't parallelize it.

## Status

Early stage, but MemberSports is a real, working adapter: Eaglewood Golf
Course is seeded, and `fetchTeeTimes` in `lib/adapters/membersports.ts`
is fully implemented against a verified request/response shape — no
credentials required. Untested against a live network call from this
environment (sandboxed, can't reach external hosts) but ready to try
against a real Postgres + `npm run poll`. ForeUp and Chronogolf adapters
are unstarted.

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

## License

TBD.
