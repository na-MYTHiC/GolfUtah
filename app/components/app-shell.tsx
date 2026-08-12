"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Results } from "./results";
import type { CourseView } from "./types";
import { loadDay, loadIndex, type DataIndex, type DayFile } from "@/lib/static-data";
import { getDayWeather, describeWeather, weatherAt, type DayWeather } from "@/lib/weather";
import { todayInUtah } from "@/lib/format";

/**
 * Loads a day's baked JSON, then decorates it with weather fetched
 * straight from the browser — Open-Meteo allows cross-origin requests, so
 * that part doesn't need a build step and is always current even when the
 * tee time data is a few minutes old.
 */
export function AppShell() {
  const params = useSearchParams();
  const today = todayInUtah();
  const date = params.get("date") ?? today;
  const week = params.get("view") === "week";

  const [courses, setCourses] = useState<CourseView[] | null>(null);
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Clearing inside the async body rather than synchronously keeps
      // this from cascading an extra render pass on mount.
      setCourses(null);

      // Week mode merges every published day into one list. Ten small
      // files in parallel is a fraction of a second and saves the golfer
      // tapping through ten days to answer "when can I play this week".
      let day: DayFile | null;
      if (week) {
        const index = await loadIndex();
        const dates = index?.dates ?? [date];
        const files = (await Promise.all(dates.map((d) => loadDay(d)))).filter(
          (f): f is DayFile => f != null
        );
        day = files.length ? mergeDays(files) : null;
      } else {
        day = await loadDay(date);
      }
      if (cancelled) return;

      if (!day) {
        setCourses([]);
        setGeneratedAt(null);
        return;
      }
      setGeneratedAt(day.generatedAt);

      // Show tee times immediately; weather fills in a moment later
      // rather than holding up the whole list.
      const base: CourseView[] = day.courses.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        city: c.city,
        county: c.county,
        platform: c.platform,
        bookingUrl: c.bookingUrl,
        latitude: c.lat,
        longitude: c.lon,
        rating: c.rating,
        error: c.error,
        partial: c.partial,
        returned: c.returned,
        slots: c.slots.map((s, i) => ({
          id: `${c.id}:${s.date ?? date}:${i}`,
          // In week mode each slot carries the day it belongs to; on a
          // single day they're all the chosen one.
          date: s.date ?? date,
          time: s.time,
          holes: s.holes,
          playersOpen: s.spots,
          price: s.price,
          cart: s.cart,
          withCart: s.withCart,
          rate: s.rate,
          side: s.side,
          bookingUrl: s.url,
        })),
      }));
      setCourses(base);

      // One forecast per distinct location, not per course.
      const byLocation = new Map<string, { lat: number; lon: number }>();
      for (const c of day.courses) {
        if (c.slots.length === 0) continue;
        byLocation.set(`${c.lat.toFixed(2)},${c.lon.toFixed(2)}`, { lat: c.lat, lon: c.lon });
      }

      const forecasts = new Map<string, DayWeather | null>();
      await Promise.all(
        [...byLocation.entries()].map(async ([key, { lat, lon }]) => {
          forecasts.set(key, await getDayWeather(lat, lon, date));
        })
      );
      if (cancelled) return;

      setCourses(
        base.map((course) => {
          const key = `${course.latitude!.toFixed(2)},${course.longitude!.toFixed(2)}`;
          const day = forecasts.get(key);
          if (!day) return course;

          const slotWeather: NonNullable<CourseView["slotWeather"]> = {};
          for (const slot of course.slots) {
            const hour = weatherAt(day, slot.time);
            if (hour) {
              slotWeather[slot.time] = {
                temperatureF: hour.temperatureF,
                windMph: hour.windMph,
                icon: describeWeather(hour.weatherCode).icon,
              };
            }
          }

          return {
            ...course,
            weather: {
              highF: day.highF,
              lowF: day.lowF,
              maxPrecipChance: day.maxPrecipChance,
              sunset: day.sunset,
              ...describeWeather(day.hours[12]?.weatherCode ?? 0),
            },
            slotWeather,
          };
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [date, week]);

  if (courses === null) {
    return <ResultsSkeleton />;
  }

  if (courses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-6 text-sm">
        <p className="font-medium text-text-1">No data for this day</p>
        <p className="mt-1 text-text-2">
          {index
            ? `Tee times are published for ${index.dates[0]} through ${
                index.dates[index.dates.length - 1]
              }.`
            : "The site's tee time data hasn't been generated yet."}
        </p>
      </div>
    );
  }

  return (
    <>
      <Results courses={courses} today={today} date={date} />
      {generatedAt && <Freshness generatedAt={generatedAt} />}
    </>
  );
}

/**
 * Every day's courses folded into one set, with each slot tagged with
 * the day it came from.
 *
 * Courses are keyed by slug so a course appearing on all ten days
 * becomes one entry with ten days of slots rather than ten entries.
 */
function mergeDays(files: DayFile[]): DayFile {
  const byCourse = new Map<string, DayFile["courses"][number]>();

  for (const file of files) {
    for (const course of file.courses) {
      const dated = course.slots.map((slot) => ({ ...slot, date: file.date }));
      const existing = byCourse.get(course.slug);
      if (existing) existing.slots.push(...dated);
      else byCourse.set(course.slug, { ...course, slots: dated });
    }
  }

  return {
    date: files[0].date,
    // The oldest of the merged days, so freshness isn't overstated: a
    // week view is only as current as its stalest file.
    generatedAt: files
      .map((f) => f.generatedAt)
      .sort()[0],
    courses: [...byCourse.values()],
  };
}

/**
 * Placeholder rows at the shape of the real ones. A spinner or a line of
 * text makes the page jump when data arrives; this keeps the layout
 * still and makes the wait feel shorter than it is.
 */
function ResultsSkeleton() {
  return (
    <div className="animate-pulse pt-4" aria-hidden>
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 w-[3.25rem] shrink-0 rounded-xl bg-surface-2" />
        ))}
      </div>
      <div className="mb-3 h-9 rounded-full bg-surface-2" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[68px] rounded-2xl bg-surface-1 ring-1 ring-line" />
        ))}
      </div>
    </div>
  );
}

/**
 * Static hosting means the data is only as fresh as the last scheduled
 * build, and tee times move fast — so say plainly how old it is rather
 * than letting it look live.
 */
function Freshness({ generatedAt }: { generatedAt: string }) {
  // An absolute time rather than "12 min ago": it's a pure function of
  // the prop (no clock read during render), and it's less ambiguous when
  // the page has been sitting open in a background tab.
  const clock = new Date(generatedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver",
  });

  return (
    <p className="mt-6 text-center text-xs text-text-3">
      Availability last checked at {clock} · always confirm on the course&apos;s own page
    </p>
  );
}
