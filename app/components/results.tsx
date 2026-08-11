"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { CourseCard, type CourseView } from "./course-card";
import { FilterBar, useGeolocation, type FilterState } from "./filter-bar";
import { distanceMiles, formatTime } from "@/lib/format";

/**
 * Filtering and sorting run client-side over the day's slots. The dataset
 * for one day across ~19 courses is small enough that this is instant,
 * and it keeps filter changes from round-tripping to the server.
 * Changing the date does reload, since that's a different fetch.
 */
export function Results({
  courses,
  today,
  date,
  mode,
}: {
  courses: CourseView[];
  today: string;
  date: string;
  mode: "cached" | "live";
}) {
  const params = useSearchParams();
  const { coords, locate } = useGeolocation();

  // Memoized so the filtering below doesn't re-run on every render just
  // because this object is rebuilt.
  const filters: FilterState = useMemo(
    () => ({
      date,
      players: Number(params.get("players") ?? 1),
      holes: (params.get("holes") as FilterState["holes"]) ?? "all",
      after: params.get("after") ?? "",
      before: params.get("before") ?? "",
      maxPrice: params.get("maxPrice") ? Number(params.get("maxPrice")) : null,
      sort: (params.get("sort") as FilterState["sort"]) ?? "time",
    }),
    [date, params]
  );

  const filtered = useMemo(() => {
    const withDistance = courses.map((course) => {
      const distance =
        coords && course.distanceMiles == null && course.latitude != null
          ? distanceMiles(coords.lat, coords.lon, course.latitude, course.longitude!)
          : course.distanceMiles;

      const slots = course.slots.filter((slot) => {
        if (slot.playersOpen < filters.players) return false;
        if (filters.holes !== "all" && slot.holes !== Number(filters.holes)) return false;
        if (filters.after && slot.time < filters.after) return false;
        if (filters.before && slot.time > filters.before) return false;
        if (filters.maxPrice != null) {
          // Unpriced slots are dropped by a price filter rather than
          // assumed cheap — better to omit than to mislead.
          if (slot.price == null || slot.price > filters.maxPrice * 100) return false;
        }
        return true;
      });

      const sorted = [...slots].sort((a, b) =>
        filters.sort === "price"
          ? (a.price ?? Infinity) - (b.price ?? Infinity) || a.time.localeCompare(b.time)
          : a.time.localeCompare(b.time)
      );

      return { ...course, slots: sorted, distanceMiles: distance };
    });

    // Courses that errored stay visible so an outage is legible rather
    // than looking like "no tee times".
    const visible = withDistance.filter((c) => c.slots.length > 0 || c.error);

    return visible.sort((a, b) => {
      if (filters.sort === "distance") {
        if (a.distanceMiles == null) return 1;
        if (b.distanceMiles == null) return -1;
        return a.distanceMiles - b.distanceMiles;
      }
      if (filters.sort === "price") {
        const cheapest = (c: CourseView) =>
          c.slots.reduce((min, s) => Math.min(min, s.price ?? Infinity), Infinity);
        return cheapest(a) - cheapest(b);
      }
      const earliest = (c: CourseView) => c.slots[0]?.time ?? "99:99";
      return earliest(a).localeCompare(earliest(b));
    });
  }, [courses, filters, coords]);

  const totalSlots = filtered.reduce((n, c) => n + c.slots.length, 0);
  const earliest = filtered.flatMap((c) => c.slots).sort((a, b) => a.time.localeCompare(b.time))[0];

  return (
    <>
      <FilterBar
        today={today}
        filters={filters}
        courseCount={filtered.filter((c) => c.slots.length > 0).length}
        onLocate={locate}
        hasLocation={coords != null}
      />

      {totalSlots > 0 && (
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          {totalSlots} tee time{totalSlots === 1 ? "" : "s"} available
          {earliest && `, from ${formatTime(earliest.time)}`}
          {mode === "live" && " · live from each course"}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">No tee times match</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Try a different day, fewer players, or a wider time range.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </>
  );
}
