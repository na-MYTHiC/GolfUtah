"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { CourseView } from "./types";
import { TeeTimeRow, type Booking } from "./tee-time-row";
import {
  DateStrip,
  FilterChips,
  SearchBar,
  ViewToggle,
  useFilters,
  useGeolocation,
  type FilterState,
} from "./filters";
import { distanceMiles } from "@/lib/format";
import { findCity } from "@/lib/utah-places";
import { favoritesStore } from "@/lib/favorites";
import { markSeen, slotKey } from "@/lib/seen";
import { formatDateLabel } from "@/lib/format";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Starred course slugs, live across tabs. */
function useFavorites(): string[] {
  return useSyncExternalStore(
    favoritesStore.subscribe,
    favoritesStore.getSnapshot,
    favoritesStore.getServerSnapshot
  );
}

/**
 * The day's tee times as one chronological list across every course.
 *
 * Grouping by course reads like a directory; a golfer is asking "what can
 * I play Saturday morning?", not "what does Sun Hills have?". So slots
 * from all courses are merged and ordered by time, split into the parts
 * of the day people actually plan around.
 *
 * Filtering runs client-side: one day across ~19 courses is a few hundred
 * rows, small enough that this is instant and filter changes never hit
 * the network.
 */
export function Results({
  courses,
  today,
  date,
}: {
  courses: CourseView[];
  today: string;
  date: string;
}) {
  const filters = useFilters(date);
  const { coords, locate } = useGeolocation();
  const favorites = useFavorites();

  // Course names for the search suggestions, drawn from what's actually
  // loaded so a suggestion can never return nothing.
  const courseNames = useMemo(() => courses.map((c) => c.name).sort(), [courses]);

  // What's appeared since the last look. Deliberately keyed off the raw
  // course data rather than the filtered list, so changing a filter
  // doesn't make everything look new.
  const fresh = useMemo(() => {
    if (filters.view === "week") return new Set<string>();
    const keys = courses.flatMap((c) =>
      c.slots.map((s) => slotKey(c.slug, s.time, s.holes, s.side))
    );
    return markSeen(date, keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, date]);

  // A distance origin is the device's location, or any Utah city that
  // was searched for — including ones with no course of their own.
  const hasOrigin =
    coords != null || Boolean(findCity(filters.near || filters.q));

  const { bookings, coursesWithTimes, quiet } = useMemo(() => {
    const flat: Booking[] = [];
    const needle = filters.q.trim().toLowerCase();

    // Distances measure from the device when it's been shared, otherwise
    // from a chosen city — useful when planning a round somewhere you
    // aren't yet.
    // Origin comes from the full Utah city list, not just cities with
    // courses — searching "Bluffdale" should find courses near it even
    // though Bluffdale has none.
    const city = findCity(filters.near || filters.q);
    const origin = coords ? { lat: coords.lat, lon: coords.lon } : city;

    for (const course of courses) {
      const distance =
        origin && course.latitude != null && course.longitude != null
          ? distanceMiles(origin.lat, origin.lon, course.latitude, course.longitude)
          : undefined;

      if (filters.starred && !favorites.includes(course.slug)) continue;

      // A county is a boundary, so it filters directly and the text
      // search steps aside — "Salt Lake" the county shouldn't also have
      // to match a course name.
      if (filters.county) {
        if (course.county !== filters.county) continue;
      } else {
        // A searched city acts as the radius origin, so text search is
        // skipped once a radius is doing the narrowing — otherwise
        // "Layton within 30 miles" would still only ever show Layton.
        const narrowingByRadius = filters.radius != null && origin != null;
        if (needle && !narrowingByRadius) {
          const haystack = `${course.name} ${course.city ?? ""}`.toLowerCase();
          if (!haystack.includes(needle)) continue;
        }
        if (filters.radius != null && distance != null && distance > filters.radius) continue;
      }

      for (const slot of course.slots) {
        if (slot.playersOpen < filters.players) continue;
        if (filters.holes !== "all" && slot.holes !== Number(filters.holes)) continue;
        if (!inWindow(slot.time, filters.when)) continue;
        if (filters.maxPrice != null) {
          // Unpriced slots are dropped by a price filter rather than
          // assumed cheap — better omitted than misleading.
          if (slot.price == null || slot.price > filters.maxPrice * 100) continue;
        }

        flat.push({
          id: slot.id,
          time: slot.time,
          holes: slot.holes,
          playersOpen: slot.playersOpen,
          price: slot.price,
          cart: slot.cart,
          withCart: slot.withCart,
          rate: slot.rate,
          side: slot.side,
          bookingUrl: slot.bookingUrl,
          courseName: course.name,
          courseSlug: course.slug,
          courseCity: course.city,
          distanceMiles: distance,
          weather: course.slotWeather?.[slot.time],
          sunset: course.weather?.sunset,
          date: slot.date ?? date,
          undatedLink: course.platform === "MEMBERSPORTS",
          isNew: fresh.has(slotKey(course.slug, slot.time, slot.holes, slot.side)),
        });
      }
    }

    const chronological = filters.view === "time";
    const weekly = filters.view === "week";
    flat.sort((a, b) => {
      if (weekly) {
        // Cheapest first is the point of the week view — "when is this
        // cheap" rather than "what's on Tuesday".
        if (filters.sort === "price") {
          return (
            (a.price ?? Infinity) - (b.price ?? Infinity) ||
            (a.date ?? "").localeCompare(b.date ?? "") ||
            a.time.localeCompare(b.time)
          );
        }
        return (
          (a.date ?? "").localeCompare(b.date ?? "") || a.time.localeCompare(b.time)
        );
      }
      if (chronological) {
        return a.time.localeCompare(b.time) || a.courseName.localeCompare(b.courseName);
      }
      if (filters.sort === "price") {
        return (a.price ?? Infinity) - (b.price ?? Infinity) || a.time.localeCompare(b.time);
      }
      const da = a.distanceMiles ?? Infinity;
      const db = b.distanceMiles ?? Infinity;
      return da - db || a.time.localeCompare(b.time);
    });

    // Mark the cheapest slots on offer. Worth calling out explicitly:
    // scanning a right-hand column of prices for the smallest number is
    // work the app can just do. Ties all get the badge — there's often a
    // row of identical twilight rates and picking one arbitrarily would
    // be misleading.
    const cheapest = flat.reduce(
      (min, b) => (b.price != null && b.price < min ? b.price : min),
      Infinity
    );
    if (cheapest !== Infinity) {
      for (const b of flat) if (b.price === cheapest) b.bestPrice = true;
    }

    const shown = new Set(flat.map((b) => b.courseName));

    // Every tracked course should be accounted for. Dropping the empty
    // ones silently makes a course look like it isn't covered at all,
    // when usually it's booked out or filtered away.
    const quietCourses = courses
      .filter((c) => {
        if (shown.has(c.name)) return false;
        if (filters.starred && !favorites.includes(c.slug)) return false;
        if (filters.county) return c.county === filters.county;
        if (!needle) return true;
        return `${c.name} ${c.city ?? ""}`.toLowerCase().includes(needle);
      })
      .map((c) => ({
        name: c.name,
        reason: c.error
          ? ("error" as const)
          : c.slots.length > 0
            ? ("filtered" as const)
            : ("none" as const),
      }));

    return { bookings: flat, coursesWithTimes: shown.size, quiet: quietCourses };
  }, [courses, filters, coords, favorites, date, fresh]);

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface-0/95 px-4 pb-1 pt-2 backdrop-blur-lg">
        <DateStrip today={today} active={date} />
        <div className="pt-2">
          <SearchBar value={filters.q} courses={courseNames} />
        </div>
        <FilterChips
          filters={filters}
          hasOrigin={hasOrigin}
          onLocate={locate}
          view={filters.view}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pb-3 pt-3">
        {/* Kept short on purpose: the long form wrapped to two lines on a
            phone and shoved the view toggle around. */}
        <p className="min-w-0 truncate whitespace-nowrap px-0.5 text-[13px] text-text-2">
          {bookings.length === 0
            ? "No tee times match"
            : `${bookings.length} time${bookings.length === 1 ? "" : "s"} · ` +
              `${coursesWithTimes} course${coursesWithTimes === 1 ? "" : "s"}`}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <ShareButton />
          <ViewToggle view={filters.view} />
        </div>
      </div>

      {bookings.length === 0 ? (
        <EmptyState filters={filters} total={courses.length} />
      ) : (
        <TimeSections
          bookings={bookings}
          players={filters.players}
          byTime={filters.view === "time"}
          byCourse={filters.view === "course"}
          byWeek={filters.view === "week"}
          today={today}
          date={date}
          favorites={favorites}
        />
      )}

      {quiet.length > 0 && <QuietCourses quiet={quiet} />}
    </>
  );
}

/**
 * The parts of day the filter offers, as real boundaries. Chosen to
 * match how rounds are actually planned rather than splitting the clock
 * evenly: morning golf runs until lunch, evening starts when the heat
 * breaks.
 */
const WINDOWS: Record<string, [string, string]> = {
  morning: ["00:00", "11:59"],
  midday: ["12:00", "16:59"],
  evening: ["17:00", "23:59"],
};

function inWindow(time: string, when: FilterState["when"]): boolean {
  const range = WINDOWS[when];
  if (!range) return true;
  return time >= range[0] && time <= range[1];
}

/**
 * Shares the current view.
 *
 * Filters already live in the URL, so this is nearly free — the address
 * bar is a complete description of "Saturday morning, two players, under
 * $50 within 20 miles", which is exactly the thing you'd type out to
 * whoever you're playing with.
 */
function ShareButton() {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    // The native sheet where there is one; a clipboard copy where there
    // isn't, rather than nothing on desktop.
    if (navigator.share) {
      try {
        await navigator.share({ title: "GolfUtah tee times", url });
        return;
      } catch {
        // Dismissed, or not permitted — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard permission; nothing useful left to try.
    }
  };

  return (
    <button
      onClick={share}
      aria-label="Share these results"
      className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-text-2 active:bg-surface-3"
    >
      {copied ? "Copied" : "Share"}
    </button>
  );
}

/** The windows golfers plan around, not even thirds of the clock. */
const PARTS = [
  { key: "early", label: "Early", until: "09:00" },
  { key: "morning", label: "Morning", until: "12:00" },
  { key: "afternoon", label: "Afternoon", until: "16:00" },
  { key: "twilight", label: "Twilight", until: "24:00" },
] as const;

/** Times shown per course before sending you to its own page. */
const COURSE_PREVIEW = 4;

function TimeSections({
  bookings,
  players,
  byTime,
  byCourse,
  byWeek,
  today,
  date,
  favorites,
}: {
  bookings: Booking[];
  players: number;
  /** Part-of-day headers only make sense in time order. */
  byTime: boolean;
  byCourse: boolean;
  byWeek: boolean;
  today: string;
  date: string;
  favorites: string[];
}) {
  // Across the week, the day is the thing to group by — a flat list of
  // four hundred times with no day headers is unreadable.
  if (byWeek) {
    const order: string[] = [];
    const days = new Map<string, Booking[]>();
    for (const b of bookings) {
      const key = b.date ?? date;
      if (!days.has(key)) {
        days.set(key, []);
        order.push(key);
      }
      days.get(key)!.push(b);
    }

    return (
      <div className="flex flex-col gap-5">
        {order.map((day) => (
          <section key={day}>
            <h2 className="mb-2 flex items-baseline gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-3">
              {formatDateLabel(day, today)}
              <span className="font-normal normal-case tracking-normal">
                {days.get(day)!.length}
              </span>
            </h2>
            <ul className="flex flex-col gap-2">
              {days.get(day)!.map((b) => (
                <TeeTimeRow key={b.id} booking={b} players={players} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  // Grouped by course for when you're deciding *where* rather than
  // *when* — the two questions want different shapes.
  if (byCourse) {
    const order: string[] = [];
    const groups = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (!groups.has(b.courseName)) {
        groups.set(b.courseName, []);
        order.push(b.courseName);
      }
      groups.get(b.courseName)!.push(b);
    }

    // Starred courses first. Most people play the same handful over and
    // over, and making them scroll past forty others every time is the
    // difference between a directory and something you'd actually check.
    order.sort((a, b) => {
      const fa = favorites.includes(groups.get(a)![0].courseSlug) ? 0 : 1;
      const fb = favorites.includes(groups.get(b)![0].courseSlug) ? 0 : 1;
      return fa - fb;
    });

    return (
      <div className="flex flex-col gap-5">
        {order.map((name) => {
          const items = groups.get(name)!;
          const preview = items.slice(0, COURSE_PREVIEW);
          const rest = items.length - preview.length;
          const cheapest = items.reduce(
            (min, b) => (b.price != null ? Math.min(min, b.price) : min),
            Infinity
          );
          const slug = items[0].courseSlug;

          return (
            // A card per course rather than a bare heading over loose
            // rows: grouped by course, the course is the thing being
            // chosen, and it should look like an object you can pick.
            <section
              key={name}
              className="overflow-hidden rounded-2xl bg-surface-1 ring-1 ring-line"
            >
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <FavoriteStar slug={slug} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[14px] font-semibold leading-tight text-text-1">
                    {name}
                  </h2>
                  <p className="truncate text-[11px] text-text-3">
                    {[
                      items[0].courseCity,
                      items[0].distanceMiles != null &&
                        `${items[0].distanceMiles.toFixed(0)} mi`,
                      `${items.length} time${items.length === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {cheapest !== Infinity && (
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] leading-none text-text-3">from</div>
                    <div className="text-[15px] font-semibold leading-tight text-crimson-bright">
                      ${(cheapest / 100).toFixed(0)}
                    </div>
                  </div>
                )}
              </div>

              <ul className="flex flex-col gap-1.5 p-2">
                {preview.map((b) => (
                  <TeeTimeRow key={b.id} booking={b} players={players} hideCourse nested />
                ))}
              </ul>

              {/* The whole day, the forecast hour by hour, and the
                  course's rating live on its own page — this list is for
                  scanning, not for deciding. */}
              <a
                href={`${basePath}/course/${slug}/?${new URLSearchParams({ date })}`}
                className="flex items-center justify-center gap-1 border-t border-line py-2.5 text-[13px] font-medium text-text-1 active:bg-surface-2"
              >
                {rest > 0 ? `See all ${items.length} times` : "Course details"}
                <span aria-hidden className="text-text-3">→</span>
              </a>
            </section>
          );
        })}
      </div>
    );
  }

  // Part-of-day headers only make sense in time order; sorted by price
  // or distance they would interleave meaninglessly.
  if (!byTime) {
    return (
      <ul className="flex flex-col gap-2">
        {bookings.map((b) => (
          <TeeTimeRow key={b.id} booking={b} players={players} />
        ))}
      </ul>
    );
  }

  const groups = PARTS.map((part, i) => ({
    ...part,
    items: bookings.filter(
      (b) => b.time < part.until && (i === 0 || b.time >= PARTS[i - 1].until)
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-3">
            {group.label}
            <span className="ml-1.5 font-normal normal-case tracking-normal text-text-3">
              {group.items.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-2">
            {group.items.map((b) => (
              <TeeTimeRow key={b.id} booking={b} players={players} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Star toggle. Deliberately a wide tap target with a small glyph — it
 * sits next to a course name and gets pressed with a thumb.
 */
function FavoriteStar({ slug }: { slug: string }) {
  const favorites = useFavorites();
  const on = favorites.includes(slug);

  return (
    <button
      type="button"
      onClick={() => favoritesStore.toggle(slug)}
      aria-label={on ? "Remove from starred courses" : "Star this course"}
      aria-pressed={on}
      className={`-m-1 shrink-0 p-1 text-sm leading-none transition ${
        on ? "text-crimson-bright" : "text-text-3"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/**
 * Nothing matched — so say which filter is most likely responsible.
 *
 * With eight filters it's easy to narrow into an empty result and not
 * remember which one did it. Generic advice ("try another day") is worse
 * than useless here: the app knows exactly what's applied and can name
 * the narrowest thing first.
 */
function EmptyState({ filters, total }: { filters: FilterState; total: number }) {
  const reasons: string[] = [];
  if (filters.starred) reasons.push("only starred courses");
  if (filters.maxPrice != null) reasons.push(`under $${filters.maxPrice}`);
  if (filters.players > 1) reasons.push(`room for ${filters.players}`);
  if (filters.radius != null) reasons.push(`within ${filters.radius} miles`);
  if (filters.county) reasons.push(`${filters.county} County`);
  if (filters.holes !== "all") reasons.push(`${filters.holes} holes`);
  if (filters.when !== "any") reasons.push(filters.when);

  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-2xl">⛳</p>
      <p className="mt-2 font-medium text-text-1">Nothing open</p>
      {reasons.length > 0 ? (
        <p className="mt-1 text-sm text-text-2">
          No tee times across {total} courses match {reasons.join(" · ")}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-text-2">
          Nothing is published for this day yet. Try another date.
        </p>
      )}
      {reasons.length > 0 && (
        <p className="mt-2 text-xs text-text-3">
          Widen a filter above, or tap Clear to start over.
        </p>
      )}
    </div>
  );
}

function QuietCourses({
  quiet,
}: {
  quiet: { name: string; reason: "filtered" | "none" | "error" }[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = quiet.filter((q) => q.reason === "filtered");
  const none = quiet.filter((q) => q.reason === "none");
  const errored = quiet.filter((q) => q.reason === "error");

  return (
    <div className="mt-6 rounded-2xl bg-surface-1 px-4 py-3 ring-1 ring-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-text-2"
      >
        <span>{quiet.length} other courses</span>
        <span className="text-lg leading-none text-text-3">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3 text-[13px]">
          <QuietGroup label="Have times, but not matching your filters" items={filtered} />
          <QuietGroup label="Nothing published for this day" items={none} />
          <QuietGroup label="Couldn't be reached" items={errored} />
        </div>
      )}
    </div>
  );
}

function QuietGroup({ label, items }: { label: string; items: { name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-text-2">{label}</p>
      <p className="mt-0.5 text-text-2">
        {items.map((i) => i.name).join(" · ")}
      </p>
    </div>
  );
}
