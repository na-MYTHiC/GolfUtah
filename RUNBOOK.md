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

ForeUp courses with no `booking_class` captured. Without one, ForeUp can
return a *subset* of the tee sheet: Sun Hills listed from 11:06am when
the course was actually selling from 6:45.

**22 of 26 now have one.** The Stripe unwrapping fix landed Murray
Parkway (`6263:244:7668`) and The Ridge (`22131:9898:13622`) — the
latter was recorded here as being behind a login, which turned out to be
wrong. Roosevelt and El Monte resolved too.

Four left, in two kinds:

| Course | Why |
|---|---|
| Davis Park, Valley View | booking page still reaches no tee sheet |
| Mt. Ogden, Cove View | a refresh resolves to El Monte's sheet — see below |

**Davis Park and Valley View won't resolve through `discover:refresh`,
and now it's clear why.** Their `bookingUrl` points straight at the
ForeUp tee sheet, so the ids the page yields are the ids we already had
— and the refresh pass suppresses those deliberately, or every run would
report a "find" that was just its own input echoed back
(`Collector.offer`, discover-ids.ts). That leaves only a times *response*
as evidence, and on these two installs the widget never fires one within
the settle window: it shows an intermediate step first. Which is
probably the same reason they need a booking class at all.

Use the API directly instead — no browser, no widget to click through:

```
npm run foreup:schedules -- 19500 --ids 1757
npm run foreup:schedules -- 19501 --ids 1759
```

That reads `booking_class_id` straight off the times response. **This is
the fallback for any ForeUp course `discover:refresh` can't crack** — it
needs only the course and schedule ids, which are already in the seed's
`externalId`.

Both of these first came back "no times returned on any day tried",
which turned out to be a second, separate thing: some installs won't
answer the times endpoint cold. A browser loads the booking page first,
which issues a PHPSESSID, and the sheet is held against that session.
The script now retries with one — but only after a cold request comes
back empty, so a wide `--scan` doesn't pay for a page load per id.

### Pass 2 — courses not in the app yet

The last run resolved 7 of 20. Two are now seeded — **Palisade**
(TeeItUp, the fourth and last Utah State Parks course) and **Roosevelt**
(ForeUp), which between them close the two counties inside the covered
latitude band that had no course at all.

Still open:

- **El Monte / Mount Ogden** and **Schneiter's Bluff / Riverside** each
  came back with one id shared between two courses — the collision guard
  doing its job. See below.
- **The Barn** confirmed as GolfPay. That needs an adapter, not another
  discovery run.
- **Canyons** is on quick18, **Birch Creek** on golfrev, **Golf the
  Round** on TeeItUp but as a driving range. No adapters for any.
- Eight courses turned up no booking link at all. The script prints a
  search link for each, so a course whose site simply moved is one click
  from being found rather than a dead end.
- **Homestead** fails TLS negotiation outright
  (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`) — their server, not ours.

---

## The things a script can't get

**El Monte and Mount Ogden.** Both resolve to the same ForeUp sheet,
because Ogden City's Mt Ogden page links to El Monte's booking page.
Neither is seeded, because seeding both would show identical times under
two course names.

There's now a script for exactly this:

```
npm run foreup:schedules -- 19197
```

Both courses live under ForeUp course id `19197` as separate tee sheets,
and every row of ForeUp's times response carries `course_name` — so once
a schedule id is known, ForeUp itself says which course it is. No
guessing from a municipal website that links to the wrong page.

It prints a ready-to-paste seed entry per sheet, including the booking
class when ForeUp gives one.

**Resolved.** El Monte is `19197:1258`, Mt. Ogden is `19197:1259`. The
booking page only ever linked to El Monte, so Mt. Ogden was found by
sweeping the id range:

```
npm run foreup:schedules -- 19197 --scan 1240-1290
```

**What that sweep also proved: a ForeUp `courseId` is a shared tenant,
not one operator.** 19197 hosts thirteen tee sheets across at least five
states, plus two of ForeUp's own "Setup Training Account" fixtures. So a
sweep returns candidates, not a shortlist — and since the times response
carries no location, only the name is known. The script now skips
obvious test sheets and says so; check the booking URL for a course's
own address before seeding anything from a sweep.

Cove View (Richfield) was the only other Utah course on that tenant and
is seeded, identified by name alone.

**Open question on both new seeds.** A refresh run pointed at
`/booking/19197/1259` (Mt. Ogden) and `/booking/19197/1265` (Cove View)
came back reporting El Monte, schedule 1258 — the account's default
sheet. Asking the API directly for 1259 does return Mt. Ogden with 64
slots, so the *data* is right; it's the *booking link* that's in doubt.

The likely explanation is that on a multi-tenant account the second path
segment isn't the schedule id — the widget selects the sheet in-app off
the hash route. If so, times shown for these two are correct but tapping
one may hand the golfer El Monte's checkout.

To settle it, open both URLs and see which course's name the page shows.
If it's El Monte, their booking links need to come from the courses' own
websites instead.

If the booking page won't load but you know the ids:

```
npm run foreup:schedules -- 19197 --ids 1258,1259
```

That skips the browser and just does the naming, which is the half that
matters. If both ids come back with the *same* name, that's ForeUp's
answer — they really are one course, and only one should be seeded.

Works for any city running several courses on one ForeUp account, not
just Ogden.

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
| ForeUp | 26 | yes | only if the course names its sheet |
| Chronogolf | 14 | yes — to the exact slot | only if the club splits the nine out |
| MemberSports | 6 | **no** | yes — a real flag on every slot |
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

Two platforms are detected but have no adapter, both parked deliberately:

- **GolfPay** (The Barn) — needs one availability capture. Doable.
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
