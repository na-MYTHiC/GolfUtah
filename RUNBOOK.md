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

ForeUp courses with no `booking_class` captured. **28 of 33 now have
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

70 courses seeded, across 22 of Utah's 29 counties.

#### Surveying the whole state

```
npm run osm:utah
```

Asks OpenStreetMap for every golf course in Utah in **one** Overpass
query, then diffs it against the seed list and prints what's missing,
with coordinates and — where OSM has it — the course's own website.

This replaced adding candidates from memory, which was wrong in both
directions: it invented courses that cost a page load each to disprove,
and it offered East Bay as a gap when East Bay is Timpanogos renamed and
had been seeded for weeks.

**Names are matched loosely, on containment.** Exact matching was one
word too strict and put six seeded courses on the missing list: OSM calls
them Palisade *State Park*, Roosevelt *Municipal*, Wasatch Mountain
*State*, Wolf Creek (seeded as Wolf Creek *Resort*), and *Pro Shop at*
Eagle Mountain.

**Proximity flags, it doesn't resolve.** A course near a seeded one but
named differently is printed for you to decide and *stays in the missing
list*. Treating position as proof went wrong in both directions — it
paired Homestead with Wasatch Mountain, 0.21 miles apart and different
courses, and hid Homestead entirely.

**And discovery now catches duplicates by id.** Spanish Oaks resolved to
ids already seeded under "The Oaks at Spanish Fork" and was printed as a
fresh find. Any hit matching a seeded externalId is now reported as
already seeded and kept out of the paste block. Names get changed; ids
don't.

Private clubs are counted and hidden (`--include-private` to see them),
driving ranges and mini-golf are filtered out, and a course mapped as
both a way and a relation is deduplicated.

Caveats worth keeping in mind: OSM is contributed by anyone, so a course
can be missing, closed but still mapped, or tagged as a course when it
isn't one. The `access` tag is often absent, so "public" here means "not
tagged private" rather than confirmed bookable.

#### Then resolve the platform

For each missing course, aim discovery at its **booking page**, not its
home page:

```
npm run discover -- "<booking or club url>"
```

**The single most useful lesson from this whole exercise:** "no booking
link or traffic found" nearly always means the *course's website* is
unhelpful, not that the course is unreachable. Park City, Outlaw and
Round Valley each failed two full surveys and then resolved on the first
try once pointed at their actual booking page. Putting that URL in
`courses.candidates.json` fixes it permanently.

#### Known platform, no adapter

Canyons (quick18), Birch Creek (golfrev), Glenmoor (cps.golf — Club
Prophet Systems), The Ranches (tenfore.golf).

TenFore is the interesting one, and there's a probe for it:

```
npm run tenfore:probe
```

Its API is clean — three endpoints on swan.tenfore.golf — but every
request carries an `x-recaptcha-token`. Those are reCAPTCHA v3 tokens,
minted by Google's script inside the page and valid for about two
minutes, so a scheduled build cannot produce one without holding a real
browser open on every refresh.

Whether that matters depends on whether the token is *verified*, which
isn't knowable from a capture. GolfPay's request carried a Laravel
session and a CSRF header that looked mandatory, and the endpoint
answered cold. The probe tries four ways — no token, empty token, junk
token, action header alone — and says plainly which way it went.

#### Blocked by a login

**St. George City's four** — Dixie Red Hills, Southgate, St. George Golf
Club, Sunbrook — are MemberSports behind a login. That's not
automatically fatal: the MemberSports adapter already authenticates as
nobody (it sends the literal string `Bearer null`, which is what the
platform's own page sends) and serves eleven Utah courses that way. So
the question is whether these clubs have anonymous access switched off.

```
npm run membersports:probe -- --club <id> --course <id>
npm run membersports:probe -- --club <id> --scan 18900-18930
```

The ids are the two numbers in an `app.membersports.com/tee-times/<club>/<course>/0`
URL. A login screen usually still carries the club id in its address,
which is the half that's hard to guess; `--scan` walks the course ids
around it.

#### Genuinely closed

Schneiter's Bluff and Riverside need a login, so availability isn't
public at all. Homestead's server fails TLS negotiation. Golf the Round
is a Toptracer range, not a course.

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
| ForeUp | 35 | yes | only if the course names its sheet |
| GolfPay | 1 | yes — to the exact slot | no |
| Chronogolf | 17 | yes — to the exact slot | only if the club splits the nine out |
| MemberSports | 11 | **no** | yes — a real flag on every slot |
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

Two platforms are detected and have no adapter, parked deliberately:

- **TeeRocket** (Schneiter's ×2) — needs a *user account*. The widget
  renders "Please login to reserve a tee time", so availability isn't
  public at all. Not an adapter problem, and no amount of protocol work
  gets past it.

- **TenFore** (The Ranches) — reCAPTCHA v3, enforced server-side on the
  only endpoint that matters. `npm run tenfore:probe` settled this
  rather than assuming it, and the reasoning is worth keeping because
  the first two readings of the evidence were both wrong.

  Two of three endpoints answer cold, on the app id alone. That looked
  promising and isn't: `booking-dates` returns which days are on sale
  and `booking-schedule` returns a schedule record whose every useful
  field — `startTime`, `endTime`, `numberOfTimes`, `gap`, `days` — is
  null or empty. Neither contains a tee time. `booking-times` is the
  only endpoint carrying anything bookable.

  It answers 400, which reads like a bad request and isn't. The
  captured body is `{golfCourseId, subCourseId, dateFrom, appId}`, the
  probe sent exactly that, and the reply is 28 bytes of
  `reCAPTCHA token is required.` Vary the body and you get ASP.NET's
  model binder instead — missing `subCourseId`, or a `dateFrom` that
  won't parse as `DateOnly` — which only proves the token check sits
  *behind* binding and that a valid body is what earns you the real
  answer. (The `searchParams field is required` line in those errors is
  ASP.NET naming its unbound action parameter, not a wrapper object the
  request is missing.)

  An empty token draws that same "is required"; a junk token draws a
  different message. Presence and validity are checked separately, so
  the server is forwarding the token to Google rather than looking for
  a header.

  A browser per refresh is the only way past it, and it wouldn't
  reliably work: reCAPTCHA v3 scores rather than passes, and scoring
  automated browsers low is the whole product. That would add a browser
  launch to every 5-minute build for a result that can silently start
  failing. Not worth it for one course.

---

## How often times refresh, and what actually limits it

Five minutes is the floor. GitHub won't schedule a workflow more often
than that, so there is no version of this that polls every minute
without moving off Pages entirely.

**The 5-minute cron does not fire every 5 minutes, and it is worse than
first measured.** Over 29 consecutive scheduled runs:

| min gap | median | mean | max |
|---|---|---|---|
| 16 min | 28 min | 32 min | 101 min |

About **1.9 runs an hour**, against the 12 the cron asks for. An earlier
sample of sixteen runs gave 11–26 minutes and a mean of 18; the honest
reading is that this varies a lot and the mean drifts, so re-measure
before believing any freshness claim on this page. Everything else here
is downstream of this number.

Nothing in the repo can make GitHub fire on time. The one free lever is
avoiding `:00`, which GitHub names as its most congested minute — the
cron is offset to `:02, :07, :12 …` for that reason.

**A run refreshes every day, for every platform except Chronogolf.**
Tiering days across ticks was the right answer to twelve ticks an hour.
At two, it just leaves days stale for no reason: one run is ~564
course-days and finishes inside 70s against a 150s deadline, so there is
budget going spare.

Chronogolf still rotates, because its limit is real and unrelated to the
cron — it refuses after roughly 57 requests, three days across its
nineteen courses. Which band it takes is chosen **by staleness**:

| band | target age |
|---|---|
| today → +3 | 5 minutes |
| +4 → +6 | 15 minutes |
| +7 → +9 | 30 minutes |

Whichever is furthest past its target wins the tick. A band that gets
skipped becomes more overdue and wins the next one, whenever that
arrives — which is what makes this survive a scheduler firing at
unpredictable intervals. Picking by minute-of-hour instead does not
survive it; see below.

Two earlier designs were wrong, in instructive ways:

**Cumulative bands** (a half-hour tick fetching 0-3, then 4-6, then
7-9, in one run) quietly cost six days of the window. Chronogolf
refuses after roughly 57 requests — three days across its nineteen
courses — so the near days spent the budget before the far ones were
reached. **Days +7 to +9 were never fetched successfully on any tick,
for as long as the tiering existed.** Not stale: empty. The per-course
fallback couldn't help either, because it can only preserve an answer
that was fetched at least once.

**Exclusive bands chosen by minute-of-hour** fixed that on paper and
would have been worse in practice. Of those sixteen scheduled runs, one
landed on minute 0 and one on minute 15, so `MINUTE % 30 == 0` is close
to never — the far bands would have gone hours without a refresh while
the schedule looked healthy. This is the mistake worth remembering: a
rule keyed to a clock nobody honours.

Every course is asked exactly **once per day per run**; that number is
what a course operator would care about, and none of the tuning below
changes it.

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

### Concurrency is not rate, and that cost seven days of Chronogolf

The tuning above optimised the wrong number, and it took a build log to
notice. Making each platform finish sooner means a fast-answering
platform's slots turn over faster, so the **request rate** goes up even
though the concurrency doesn't. Chronogolf was being asked 190 times in
9.8 seconds — about 19 a second — and answered **429 to everything
after roughly the first sixty**.

The effect: all 19 Chronogolf courses returned nothing from day +3
through +9. Every Salt Lake City municipal — Bonneville, Forest Dale,
Glendale, Nibley Park, Rose Park, Mountain Dell — plus Riverbend,
University of Utah, Meadow Brook and Mick Riley. Seven of the ten days,
every run, for as long as the platform had been seeded. **The build
reported success the whole time**, because a course that errors is
counted and then skipped, and the count was a bare number in a log line.

`politeFetch` now spaces requests per host, and the spacing adapts: a
429 doubles the interval for the rest of the run (to a 1200ms cap) and
pauses every worker on that host at once, instead of each retrying into
the same wall. Defaults are 100ms, and **600ms for Chronogolf** — 100ms
is roughly what ForeUp already ran at, so this deliberately doesn't
change the platform that wasn't complaining.

**No spacing avoids the throttling — that was four runs' worth of
learning.** Each asks 190 Chronogolf course-days:

| spacing | first refusal |
|---|---|
| ~19/sec | request ~57 |
| 300ms | request ~57, 14 refusals |
| 600ms | request ~57, 16 refusals |

Six times slower, same place. That is a **budget of requests per
window**, not a rate, and spacing only decides how much of the run is
spent discovering it. One run in the middle looked like 600ms had
solved it — two days succeeded after the cooldowns — and the next run
starting at 600ms was refused just as early and finished *worse*,
because everything after the widening ran at 1200ms and missed the
deadline.

So the spacing is there to be polite and to stop five workers
stampeding, not to dodge the limit. 300ms because it published the most
days: 61/70/70/54 courses on days +3 to +6, against 59/62/50/50 at
600ms.

**What actually fixed the missing tee times is the per-course
fallback.** A course this run couldn't reach — throttled, timed out, or
cut off by the deadline — now serves its entry from the last good
build, provided that copy has times and is under six hours old. The
code for this had been there all along and could never fire: only
non-fresh days were loaded from the published site, so a fresh day had
nothing to fall back to. Every day is loaded now. Ten reads of our own
JSON against a course looking closed for a week.

Two wrong turns on the way, both worth keeping:

- **The limiter overreacted by exactly the concurrency.** Five workers
  hit the wall in the same instant, each doubled the interval, and 300ms
  became 9600ms from a single throttling. A run took 163s against the
  150s budget and skipped 96 course-days. Refusals within 3s now count
  as one episode and widen the interval once.
- **Starting at 300ms and adapting still cost a run.** The widening only
  happens *after* the refusals, and refusals bring 5s cooldowns, so the
  first minute went on relearning a known number. Start where the
  evidence is.

Cost, from the simulator: 46.0s → 57.1s for a ten-day tick. Production
runs bounded by GolfPay anyway, and courses the deadline cuts off now
fall back rather than publishing an empty sheet.

Two things came out of this worth keeping:

- **Failures are grouped by message in the build log.** A count can't be
  acted on; "19 courses, all saying HTTP 429" names the bug in one line.
  That change is what found this, a single run after it shipped.
- **A widened interval is reported too** (`throttled by: ...`), so the
  next platform that starts pushing back is visible before it costs
  anyone a week of tee times.

`npx tsx scripts/test-pacing.ts` checks the spacing actually happens —
a rate limiter that silently doesn't limit looks exactly like one that
works.

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
