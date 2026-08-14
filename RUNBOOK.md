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
the course was actually selling from 6:45. So these may be hiding their
mornings from you right now.

| Course | Status |
|---|---|
| Murray Parkway | was stalling — should be fixed, see below |
| Davis Park | was stalling — should be fixed, see below |
| Valley View | was stalling — should be fixed, see below |
| The Ridge | booking page sits behind a login |
| Roosevelt | never tried — seeded from a link |

**The three stalls were a bug in this script, now fixed.** All three
reported "booking links point at js.stripe.com, m.stripe.network", which
read like the page never reached a tee sheet. It had. ForeUp's booking
page loads Stripe, and Stripe's iframe carries the embedding page inside
its own fragment, percent-encoded:

```
https://m.stripe.network/inner.html#url=https%3A%2F%2Fforeupsoftware.com
%2Findex.php%2Fbooking%2F19393%2F3564
```

The ids were on the page the whole time. Every slash between the host and
the numbers was a `%2F`, so the id pattern didn't match while the host
test — which only needs the literal string `foreupsoftware.com` — did.
The script then reported the *outer* host and queued a Stripe address as
the booking link to follow. It now decodes URLs nested inside other URLs,
and matches booking hosts against the hostname rather than the whole
string, so a third party can't masquerade as the booking link.

The Ridge is the one genuine wall: no login, no tee sheet.

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

Open each course's own "Book Tee Time" and send both URLs. They'll share
course id `19197` and differ in schedule id.

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
| ForeUp | 23 | yes | only if the course names its sheet |
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

## Optional: OpenStreetMap course facts

```
npm run osm
```

Free, no key. Prints hole count, par, website and architect for every
seeded course that OSM knows about. Nothing is written into the app —
OSM tags are contributed by anyone and are occasionally wrong, so they're
a starting point to read rather than a source to trust. Paste the output
and the good ones get folded into `lib/course-profiles.ts`.
