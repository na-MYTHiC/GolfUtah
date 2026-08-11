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
- **MemberSports** — confirmed against a real capture from Eaglewood Golf
  Course (North Salt Lake). Request/response shape and field mapping are
  verified (including a subtle bug caught along the way: `teeTime` is
  minutes-since-midnight, not literal HH:MM digits). Not fully wired up
  yet — see below.
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

## Status

Early stage. Eaglewood Golf Course is seeded (MemberSports), with a
verified request/response mapping in `lib/adapters/membersports.ts` —
but `fetchTeeTimes` isn't fully callable yet, since we don't yet know
how to obtain a valid session token server-side (the captured request
had a real user session already stored in the browser; the actual
login/token-issuing request hasn't been captured — see the comment at
the top of that file). ForeUp and Chronogolf adapters are unstarted.

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
