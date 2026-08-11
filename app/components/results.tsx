"use client";

import { useMemo, useState } from "react";
import type { CourseView } from "./types";
import { TeeTimeRow, type Booking } from "./tee-time-row";
import {
  DateStrip,
  FilterChips,
  SearchBar,
  ViewToggle,
  useFilters,
  useGeolocation,
} from "./filters";
import { distanceMiles } from "@/lib/format";

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

  // Cities we actually have courses in, for the "near" selector.
  const cities = useMemo(
    () =>
      [...new Set(courses.map((c) => c.city).filter((c): c is string => Boolean(c)))].sort(),
    [courses]
  );

  const { bookings, coursesWithTimes, quiet } = useMemo(() => {
    const flat: Booking[] = [];
    const needle = filters.q.trim().toLowerCase();

    // Distances measure from the device when it's been shared, otherwise
    // from a chosen city — useful when planning a round somewhere you
    // aren't yet.
    const originCity = filters.near
      ? courses.find((c) => c.city === filters.near && c.latitude != null)
      : undefined;
    const origin = coords
      ? { lat: coords.lat, lon: coords.lon }
      : originCity
        ? { lat: originCity.latitude!, lon: originCity.longitude! }
        : undefined;

    for (const course of courses) {
      if (needle) {
        const haystack = `${course.name} ${course.city ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }

      const distance =
        origin && course.latitude != null && course.longitude != null
          ? distanceMiles(origin.lat, origin.lon, course.latitude, course.longitude)
          : undefined;

      for (const slot of course.slots) {
        if (slot.playersOpen < filters.players) continue;
        if (filters.holes !== "all" && slot.holes !== Number(filters.holes)) continue;
        if (filters.after && slot.time < filters.after) continue;
        if (filters.before && slot.time > filters.before) continue;
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
          side: slot.side,
          bookingUrl: slot.bookingUrl,
          courseName: course.name,
          courseCity: course.city,
          distanceMiles: distance,
          weather: course.slotWeather?.[slot.time],
        });
      }
    }

    flat.sort((a, b) => {
      if (filters.sort === "price") {
        return (a.price ?? Infinity) - (b.price ?? Infinity) || a.time.localeCompare(b.time);
      }
      if (filters.sort === "distance") {
        const da = a.distanceMiles ?? Infinity;
        const db = b.distanceMiles ?? Infinity;
        return da - db || a.time.localeCompare(b.time);
      }
      return a.time.localeCompare(b.time) || a.courseName.localeCompare(b.courseName);
    });

    const shown = new Set(flat.map((b) => b.courseName));

    // Every tracked course should be accounted for. Dropping the empty
    // ones silently makes a course look like it isn't covered at all,
    // when usually it's booked out or filtered away.
    const quietCourses = courses
      .filter((c) => {
        if (shown.has(c.name)) return false;
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
  }, [courses, filters, coords]);

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface-0/95 px-4 pb-1 pt-2 backdrop-blur-lg">
        <DateStrip today={today} active={date} />
        <div className="pt-2">
          <SearchBar value={filters.q} />
        </div>
        <FilterChips
          filters={filters}
          cities={cities}
          hasLocation={coords != null}
          onLocate={locate}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pb-3 pt-3">
        <p className="px-0.5 text-[13px] text-text-2">
          {bookings.length === 0
            ? "No tee times match"
            : `${bookings.length} tee time${bookings.length === 1 ? "" : "s"} · ${coursesWithTimes} of ${courses.length} courses`}
        </p>
        <ViewToggle view={filters.view} />
      </div>

      {bookings.length === 0 ? (
        <EmptyState />
      ) : (
        <TimeSections
          bookings={bookings}
          players={filters.players}
          byTime={filters.sort === "time"}
          byCourse={filters.view === "course"}
        />
      )}

      {quiet.length > 0 && <QuietCourses quiet={quiet} />}
    </>
  );
}

/** The windows golfers plan around, not even thirds of the clock. */
const PARTS = [
  { key: "early", label: "Early", until: "09:00" },
  { key: "morning", label: "Morning", until: "12:00" },
  { key: "afternoon", label: "Afternoon", until: "16:00" },
  { key: "twilight", label: "Twilight", until: "24:00" },
] as const;

function TimeSections({
  bookings,
  players,
  byTime,
  byCourse,
}: {
  bookings: Booking[];
  players: number;
  byTime: boolean;
  byCourse: boolean;
}) {
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

    return (
      <div className="flex flex-col gap-5">
        {order.map((name) => {
          const items = groups.get(name)!;
          const cheapest = items.reduce(
            (min, b) => (b.price != null ? Math.min(min, b.price) : min),
            Infinity
          );
          return (
            <section key={name}>
              <h2 className="mb-2 flex items-baseline justify-between px-0.5">
                <span className="text-[13px] font-semibold text-text-1">
                  {name}
                  <span className="ml-1.5 font-normal text-text-3">{items.length}</span>
                </span>
                {cheapest !== Infinity && (
                  <span className="text-[11px] font-medium text-crimson-bright">
                    from ${(cheapest / 100).toFixed(0)}
                  </span>
                )}
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((b) => (
                  <TeeTimeRow key={b.id} booking={b} players={players} hideCourse />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  // Part-of-day headers only make sense in time order; sorted by price
  // they would interleave meaninglessly.
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

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-2xl">⛳</p>
      <p className="mt-2 font-medium text-text-1">Nothing open</p>
      <p className="mt-1 text-sm text-text-2">
        Try another day, a smaller group, or a wider time range.
      </p>
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
