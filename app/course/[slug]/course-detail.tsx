"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadDay, type StaticCourse } from "@/lib/static-data";
import { getDayWeather, describeWeather, weatherAt, type DayWeather } from "@/lib/weather";
import { todayInUtah, formatDateLabel, formatPrice, formatTime } from "@/lib/format";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Everything about one course for a given day: every tee time, the
 * conditions you'd be playing in, and the course's rating.
 *
 * The list view deliberately shows only a handful of times per course —
 * this is where you come when you've decided you care about this course
 * and want the whole picture.
 */
export function CourseDetail({
  slug,
  name,
  city,
  county,
  bookingUrl,
}: {
  slug: string;
  name: string;
  city: string;
  county: string;
  bookingUrl: string;
}) {
  const params = useSearchParams();
  const today = todayInUtah();
  const date = params.get("date") ?? today;

  const [course, setCourse] = useState<StaticCourse | null | undefined>(undefined);
  const [weather, setWeather] = useState<DayWeather | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCourse(undefined);
      const day = await loadDay(date);
      if (cancelled) return;

      const match = day?.courses.find((c) => c.slug === slug) ?? null;
      setCourse(match);

      if (match) {
        const forecast = await getDayWeather(match.lat, match.lon, date);
        if (!cancelled) setWeather(forecast);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, date]);

  const back = `${basePath}/?${new URLSearchParams({ date, view: "course" })}`;

  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        <a
          href={back}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2"
        >
          <span aria-hidden>←</span> All courses
        </a>

        <header className="mt-3">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text-1">
            {name}
          </h1>
          <p className="mt-1 text-sm text-text-2">
            {city} · {county} County
            {course?.rating && (
              <>
                {" · "}
                <span className="text-crimson-bright">★ {course.rating.rating.toFixed(1)}</span>
                <span className="text-text-3"> ({course.rating.reviewCount})</span>
              </>
            )}
          </p>
        </header>

        {weather && <Conditions weather={weather} date={date} today={today} />}

        <div className="mt-6">
          {course === undefined ? (
            <p className="py-10 text-center text-sm text-text-3">Loading tee times…</p>
          ) : course === null ? (
            <Empty message="No data for this course on this day." />
          ) : course.error ? (
            <Empty message={`Couldn't load times — ${course.error}`} />
          ) : course.slots.length === 0 ? (
            <Empty message="No openings published for this day." />
          ) : (
            <>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                {course.slots.length} tee times
              </h2>
              <ul className="flex flex-col gap-2">
                {course.slots.map((slot, i) => {
                  const hour = weatherAt(weather, slot.time);
                  return (
                    <li key={`${slot.time}-${slot.holes}-${i}`}>
                      <a
                        href={slot.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-2xl bg-surface-1 px-3.5 py-3 ring-1 ring-line active:scale-[0.99]"
                      >
                        <span className="w-[4.75rem] shrink-0 text-[15px] font-semibold text-text-1 tabular-nums">
                          {formatTime(slot.time)}
                        </span>
                        <span className="flex-1 text-xs text-text-2">
                          {slot.holes} holes
                          {slot.side && ` · ${slot.side}`} · {slot.spots} open
                          {hour && ` · ${hour.temperatureF}° · ${hour.windMph} mph`}
                        </span>
                        <span className="shrink-0 text-[15px] font-semibold text-text-1 tabular-nums">
                          {formatPrice(slot.price)}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 block rounded-2xl bg-surface-2 py-3 text-center text-sm font-medium text-text-1"
        >
          Course website
        </a>

        <p className="mt-6 text-center text-[11px] text-text-3">
          {formatDateLabel(date, today)} · times change by the minute, confirm on the
          course&apos;s page
        </p>
      </main>
    </div>
  );
}

/**
 * The day's conditions, hour by hour through playable daylight. Wind gets
 * its own row because it's the one a golfer actually plans around.
 */
function Conditions({
  weather,
  date,
  today,
}: {
  weather: DayWeather;
  date: string;
  today: string;
}) {
  const hours = weather.hours.filter((h) => {
    const hour = Number(h.time.slice(0, 2));
    return hour >= 6 && hour <= 20 && hour % 2 === 0;
  });

  return (
    <section className="mt-4 rounded-2xl bg-surface-1 p-4 ring-1 ring-line">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
          {formatDateLabel(date, today)}
        </h2>
        <p className="text-sm text-text-2">
          {weather.highF}° / {weather.lowF}°
          {weather.maxPrecipChance >= 20 && (
            <span className="ml-1.5 text-crimson-bright">{weather.maxPrecipChance}% rain</span>
          )}
        </p>
      </div>

      <div className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hours.map((h) => (
          <div key={h.time} className="shrink-0 text-center">
            <div className="text-[10px] text-text-3">{formatTime(h.time).replace(":00", "")}</div>
            <div className="mt-0.5 text-base">{describeWeather(h.weatherCode).icon}</div>
            <div className="mt-0.5 text-[13px] font-medium text-text-1 tabular-nums">
              {h.temperatureF}°
            </div>
            <div
              className={`text-[10px] tabular-nums ${
                h.windMph >= 12 ? "text-crimson-bright" : "text-text-3"
              }`}
            >
              {h.windMph}mph
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-text-2">
      {message}
    </div>
  );
}
