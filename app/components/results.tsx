"use client";

import { useMemo, useState } from "react";
import type { CourseView } from "./types";
import { TeeTimeRow, type Booking } from "./tee-time-row";
import { DateStrip, FilterChips, useFilters, useGeolocation } from "./filters";
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

  const { bookings, coursesWithTimes, quiet } = useMemo(() => {
    const flat: Booking[] = [];

    for (const course of courses) {
      const distance =
        coords && course.latitude != null && course.longitude != null
          ? distanceMiles(coords.lat, coords.lon, course.latitude, course.longitude)
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
      .filter((c) => !shown.has(c.name))
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
      <div className="sticky top-0 z-10 -mx-4 border-b border-zinc-200/70 bg-zinc-50/95 px-4 pb-1 pt-2 backdrop-blur-lg dark:border-zinc-800/70 dark:bg-zinc-950/95">
        <DateStrip today={today} active={date} />
        <FilterChips filters={filters} hasLocation={coords != null} onLocate={locate} />
      </div>

      <p className="px-0.5 pb-3 pt-3 text-[13px] text-zinc-500 dark:text-zinc-400">
        {bookings.length === 0
          ? "No tee times match"
          : `${bookings.length} tee time${bookings.length === 1 ? "" : "s"} · ${coursesWithTimes} of ${courses.length} courses`}
      </p>

      {bookings.length === 0 ? (
        <EmptyState />
      ) : (
        <TimeSections
          bookings={bookings}
          players={filters.players}
          byTime={filters.sort === "time"}
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
}: {
  bookings: Booking[];
  players: number;
  byTime: boolean;
}) {
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
          <h2 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {group.label}
            <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-400/70">
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
    <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
      <p className="text-2xl">⛳</p>
      <p className="mt-2 font-medium text-zinc-900 dark:text-zinc-100">Nothing open</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
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
    <div className="mt-6 rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-zinc-600 dark:text-zinc-300"
      >
        <span>{quiet.length} other courses</span>
        <span className="text-lg leading-none text-zinc-400">{open ? "−" : "+"}</span>
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
      <p className="text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">
        {items.map((i) => i.name).join(" · ")}
      </p>
    </div>
  );
}
