# Runbook — adding courses and fixing incomplete ones

Everything here needs a machine that can reach the booking sites. The
development sandbox can't, which is why these are scripts you run rather
than work already done.

One-time setup, if this is a fresh clone:

```
npm install
npx playwright install chromium
```

---

## The one command

```
git pull
npm run survey
```

That runs two passes, in the order that matters — fix what's already
listed before hunting for what isn't — and writes `refresh.json` and
`discovered.json`. **Send both files back**, or paste the console output.

Takes about five minutes. A browser window won't appear; add `-- --headed`
to either underlying command if you want to watch.

### Pass 1 — courses already in the app that may be showing short sheets

ForeUp courses with no `booking_class` captured. **25 of 27 now have
one**, up from 17 when this section was written.

Two different failure modes turned up, and the second is worse than this
section originally described:

**A short sheet.** Sun Hills listed from 11:06am without a class when the
course was actually selling from 6:45.

**No sheet at all.** Davis Park (`19500:1757`) and Valley View
(`19501:1759`) answer a request without a booking class with an *empty
array* — cold, with a session, on every date tried. They had been showing
as "nothing published" in the app, not as short. If a ForeUp course shows
no times whatsoever, check this first.

Only Mt. Ogden and Cove View are left, and for a different reason — see
the section below on 19197.

#### When `discover:refresh` can't crack one

Try the API directly, which needs no browser:

```
npm run foreup:schedules -- <courseId> --ids <scheduleId>
```

If that also comes back empty, the install almost certainly requires a
booking class, and the only way to see it is the widget's own request:

1. open the course's booking page
2. F12 → Network, filter on `times`
3. click through until tee times appear
4. right-click the `times?...` request → Copy → Copy as cURL

The URL carries `booking_class`, `schedule_id` and everything else. That
capture is what resolved both Davis County courses after two discovery
passes and an API probe had all failed.

### Pass 2 — courses not in the app yet

The last run resolved 7 of 20. Two are now seeded — **Palisade**
(TeeItUp, the fourth and last Utah State Parks course) and **Roosevelt**
(ForeUp), which between them close the two counties inside the covered
latitude band that had no course at all.

Still open:

- **El Monte / Mount Ogden** and **Schneiter's Bluff / Riverside** each
  came back with one id shared between two courses — the collision guard
  doing its job. See below.
- **The Barn** is seeded — GolfPay now has an adapter, written against
  `npm run golfpay:probe` rather than guessed. The endpoint answers cold,
  so no Laravel session or CSRF token is needed. Two costs worth knowing:
  9 and 18 are separate sheets, so a course-day is two requests; and each
  time appears twice, with and without a cart, which the adapter collapses
  into a green fee plus a cart fee.
- **Park City Golf Club** is seeded — MemberSports `15426:18944`. Two
  discovery passes found no booking link; the ids came straight from the
  app URL.
- **The Outlaw Golf Club** is seeded — Chronogolf. Same story: the
  candidate pointed at the course's own site, which links nowhere the
  script can follow. Pointed at the club's Chronogolf page, it resolved
  on the first try.

**The pattern in both:** "no booking link or traffic found" usually means
the *course's website* is unhelpful, not that the course is unreachable.
Finding the booking page by hand once and putting that URL in the
candidate list is the fix, and it sticks.
- **Canyons** is on quick18, **Birch Creek** on golfrev, **Golf the
  Round** on TeeItUp but as a driving range. No adapters for any.
- **Crane Field** is seeded. It had been failing since the first survey
  because a guard in discover-ids discarded ForeUp course ids under 100
  as template placeholders — and Crane Field really is course 1,
  schedule 1. The guard is gone.
- Eight courses turned up no booking link at all. The script prints a
  search link for each, so a course whose site simply moved is one click
  from being found rather than a dead end.
- **Homestead** fails TLS negotiation outright
  (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`) — their server, not ours.

---

## The things a script can't get

**El Monte, Mt. Ogden and Cove View — all resolved.** Kept here because
the way they failed is the most instructive thing in this file.

| Course | externalId |
|---|---|
| El Monte | `19197:1258:14275` |
| Mt. Ogden | `19196:1259` |
| Cove View | `19201:1265` |

Three separate traps, in the order they were hit:

**1. A city website that links to the wrong course.** Ogden City's Mt
Ogden page points at El Monte's booking page, so every discovery pass
resolved both courses to the same sheet and the collision guard refused
to seed either. Correctly.

**2. A ForeUp course id is not one operator.** Sweeping the id range
under 19197 found thirteen tee sheets across at least five states, plus
two of ForeUp's own "Setup Training Account" fixtures:

```
npm run foreup:schedules -- 19197 --scan 1240-1290
```

So a sweep returns *candidates*, not a shortlist. The times response
carries no location, so only the name is known — the script skips obvious
test sheets and warns, but checking the booking page for a real address
is still on you. Cove View (Richfield) was the only other Utah course
there.

**3. The booking path belongs to a course, not to the sweep.** The path
is `/booking/<bookingSiteId>/<scheduleId>`, and **a booking site belongs
to one course**. 19197 is El Monte's, so `/booking/19197/1259` serves El
Monte no matter what — which meant Mt. Ogden and Cove View shipped for
three versions with booking links that opened the wrong course's
checkout. The times were always right; the handoff wasn't.

ForeUp reports the real owner on every response row as `course_id`. The
script surfaces it now:

```
  19197:1259   Mt. Ogden Golf Course — 64 slot(s)  [belongs to course 19196]
```

**Sweep under whatever id you have; seed under the one ForeUp reports
back.**

Neither exposed a booking class, and that's expected rather than
outstanding — a sweep talks to the API directly and never sees the
widget's own request, which is the only place the class appears.

**Schneiter's Bluff and Schneiter's Riverside.** Same shape, same
reason: both pages resolve to TeeRocket group `YFlPUck58D81fB5Kqqa8`,
course `BH4MnB2co04ve5At3aQl`. Two courses cannot genuinely share one
course id, so one of the two pages is linking at the other's sheet.

This one is moot until TeeRocket has an adapter, and it can't have one:
the widget renders "Please login to reserve a tee time", so availability
isn't public at all.

**Any course whose site the script can't crack.** A booking URL is
enough — paste it and it gets seeded. If it's ForeUp and the page loads a
tee sheet, the response even names the course, so you don't have to say
which one it is.

---

## Adding a course by hand, if you'd rather

```
npm run discover -- "https://the-course-site.com/"
```

Prints the platform, the ids, the course's own name where the platform
gives one, and a ready-to-paste seed entry.

---

## What each platform can and can't do

Worth knowing before chasing a bug that isn't one.

| Platform | Courses | Links to a specific day? | Says front/back nine? |
|---|---|---|---|
| ForeUp | 27 | yes | only if the course names its sheet |
| GolfPay | 1 | yes — to the exact slot | no |
| Chronogolf | 15 | yes — to the exact slot | only if the club splits the nine out |
| MemberSports | 7 | **no** | yes — a real flag on every slot |
| TeeItUp | 4 | date in the query, unverified | yes — a real flag on every slot |

MemberSports and TeeItUp send a boolean, so the nine is always known.
ForeUp and Chronogolf send neither — the side is read out of a *name*
(ForeUp's tee sheet, Chronogolf's course), which only mentions a nine
when the course happens to label it that way. A row with no side means
the course didn't say, not that it's the front.

```
npm run sides
```

Counts it per course against the published data, and lists the ones that
never say. Those aren't adapter gaps to fix — their booking systems
don't publish it.

MemberSports keeps the selected date in its app state rather than the
URL — two different days produce byte-for-byte identical addresses. Those
rows say "opens on today" for that reason. It isn't a bug and it can't be
fixed from this side.

One platform is detected and has no adapter, parked deliberately:

- **TeeRocket** (Schneiter's ×2) — needs a *user account*. The widget
  renders "Please login to reserve a tee time", so availability isn't
  public at all. Not an adapter problem, and no amount of protocol work
  gets past it.

---

## How often times refresh, and what actually limits it

Five minutes is the floor. GitHub won't schedule a workflow more often
than that, so there is no version of this that polls every minute
without moving off Pages entirely.

Within that, the schedule is tiered:

| days | refreshed |
|---|---|
| today → +3 | every 5 minutes |
| +4 → +6 | every 15 minutes |
| +7 → +9 | every 30 minutes |

66 day-fetches an hour. Every course is asked exactly **once per day per
run** — that number is what a course operator would care about, and none
of the tuning below changes it.

### What was actually slow

The run used to be bounded by one platform. Every platform got the same
3 concurrent slots, but ForeUp carries 23 of the 47 courses and TeeItUp
carries 4 — so on a ten-day tick ForeUp needed ~85 sequential rounds and
took ~60s while Chronogolf finished in ~21s and idled for the rest.

Concurrency now scales with course count (one slot per four courses,
2–6). Same requests, same once-per-course-per-day, roughly half the
wall clock:

| tick | before | after |
|---|---|---|
| 4 days | 27.7s | 13.5s |
| 7 days | 43.1s | 21.7s |
| 10 days | ~60s | 29.7s |

Restructuring the fetch to pipeline across days instead of doing one day
at a time was tried first and made **no difference at all** (61.5s →
60.6s) — because ForeUp was the slowest platform on every individual
day, so there was never any waiting to eliminate. The pipelining was
kept because it's the right shape, but the concurrency split is what
actually did it.

### Re-measuring after a change

```
npm run simulate -- --days 10 --fresh 0-9 --budget 150 --out /tmp/sim
```

Fakes the four platforms and runs the real adapters, limiter and
scheduler against them. Prints per-platform time, request counts and
peak concurrency. `SLOW_HOST=membersports npm run simulate -- …` hangs
one host, which is how the timeout and `--budget` paths get exercised.

The latencies in `scripts/netsim.ts` are estimates — nothing in a
sandbox can measure the real ones. Compare strategies with it; don't
read the absolute seconds as a prediction.

### If a platform starts blocking

In rough order of what to reach for:

1. Raise `COURSES_PER_SLOT` in `scripts/build-data.ts` — fewer
   concurrent requests per platform, longer runs.
2. Slow the far tiers in `.github/workflows/deploy.yml`.
3. Drop `MAX_CONCURRENCY`.

Requests now identify themselves as `GolfUtahBot` with a link back (see
`lib/adapters/http.ts`), so a course that wants this stopped can find
out how rather than just blackholing an anonymous IP.

---

## Optional: OpenStreetMap course facts

```
npm run osm
```

Free, no key. Prints hole count, par, website and architect for every
seeded course that OSM knows about. Nothing is written into the app —
OSM tags are contributed by anyone and are occasionally wrong, so they're
a starting point to read rather than a source to trust. Paste the output
and the good ones get folded into `lib/course-profiles.ts`.
