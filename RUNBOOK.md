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

Five ForeUp courses have no `booking_class` captured. Without one, ForeUp
can return a *subset* of the tee sheet: Sun Hills listed from 11:06am
when the course was actually selling from 6:45. So these five may be
hiding their mornings from you right now.

| Course | Why it failed before |
|---|---|
| Murray Parkway | page never reached a tee sheet |
| Davis Park | page never reached a tee sheet |
| Valley View | page never reached a tee sheet |
| The Ridge | booking page sits behind a login |
| Overlake | never tried — seeded from a link |

Overlake is the likeliest win; it's the only one that hasn't already
failed a run. If the other four fail again, `refresh.json` now records
what their pages actually said under `pageText`, which is the thing that
will finally explain the stall.

### Pass 2 — courses not in the app yet

Twenty candidates, including five whole counties with no coverage at all
that the original survey missed entirely.

**Palisade (Sterling) is the one to care about.** It's a Utah State Parks
course, and the other three — Wasatch Mountain, Soldier Hollow, Green
River — all run on TeeItUp, which already has a working adapter. If it
resolves, it's a paste-and-done addition.

Five of the twenty have a guessed website, marked `url unverified` in
`scripts/courses.candidates.json`. A wrong address costs one page load
and reports as "no booking link found" — and the script now prints a
search link for those, so a course whose site simply moved is one click
from being found rather than a dead end.

---

## The two things a script can't get

**El Monte and Mount Ogden.** Both resolve to the same ForeUp sheet,
because Ogden City's Mt Ogden page links to El Monte's booking page.
Neither is seeded, because seeding both would show identical times under
two course names.

Open each course's own "Book Tee Time" and send both URLs. They'll share
course id `19197` and differ in schedule id.

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

| Platform | Courses | Links to a specific day? |
|---|---|---|
| ForeUp | 22 | yes |
| Chronogolf | 14 | yes — to the exact slot |
| MemberSports | 6 | **no** |
| TeeItUp | 3 | date in the query, unverified |

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
