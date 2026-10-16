"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Results } from "./results";
import type { CourseView } from "./types";
import { loadDay, type DayFile } from "@/lib/static-data";
import { getDayWeather, describeWeather, weatherAt, type DayWeather } from "@/lib/weather";
import { addDays, todayInUtah } from "@/lib/format";

/**
 * Loads a day's baked JSON, then decorates it with weather fetched
 * straight from the browser — Open-Meteo allows cross-origin requests, so
 * that part doesn't need a build step and is always current even when the
 * tee time data is a few minutes old.
 *
 * SWITCHING DAYS KEEPS THE SCREEN. This used to swap everything for a
 * skeleton while the new day loaded — the date strip, the search box and
 * the filters included — so tapping a date looked like the whole page
 * reloading. Now Results stays mounted and only the list waits.
 *
 * And mostly it doesn't wait. Days are held in memory once loaded, and
 * after the first one draws, the rest of the strip is fetched in the
 * background, so a tap is usually answered from memory immediately. A
 * day held longer than a couple of minutes is still shown at once, and
 * quietly re-fetched behind it.
 */
export function AppShell() {
  const params = useSearchParams();
  const today = todayInUtah();
  const date = params.get("date") ?? today;

  // Bumped whenever a day lands in the cache, which lives outside React.
  const [, rendered] = useReducer((n: number) => n + 1, 0);
  const [forecast, setForecast] = useState<{ date: string; byLocation: Map<string, DayWeather | null> } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const day = await ensureDay(date);
      if (cancelled) return;
      rendered();
      // A held day being refreshed behind the screen: draw the newer copy
      // when it lands.
      inFlight.get(date)?.then(() => {
        if (!cancelled) rendered();
      });
      if (!day) return;

      // One forecast per distinct location, not per course. Tee times are
      // already on screen by now; this fills in a moment later rather
      // than holding up the list.
      const byLocation = new Map<string, DayWeather | null>();
      const places = new Map<string, { lat: number; lon: number }>();
      for (const c of day.courses) {
        if (c.slots.length > 0) places.set(placeKey(c.lat, c.lon), { lat: c.lat, lon: c.lon });
      }
      await Promise.all(
        [...places].map(async ([key, { lat, lon }]) => {
          byLocation.set(key, await getDayWeather(lat, lon, date));
        })
      );
      if (cancelled) return;
      setForecast({ date, byLocation });

      // The rest of the strip, one at a time and only once this day is
      // complete, so it never competes with what's on screen.
      for (let i = 0; i < DAYS_AHEAD && !cancelled; i++) {
        await ensureDay(addDays(today, i), { refetch: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [date, today]);

  const entry = dayCache.get(date);
  const weather = forecast?.date === date ? forecast.byLocation : null;
  const courses = useMemo(
    () => (entry === undefined ? null : entry.file ? toCourseViews(entry.file, date, weather) : []),
    [entry, date, weather]
  );

  return (
    <>
      <Results courses={courses ?? []} loading={courses === null} today={today} date={date} />
      {entry?.file && <Freshness generatedAt={entry.file.generatedAt} />}
    </>
  );
}

/** How far ahead data is published; matches the date strip. */
const DAYS_AHEAD = 10;

/** Long enough to flip between days freely, short enough to stay current. */
const REFETCH_AFTER_MS = 2 * 60 * 1000;

/**
 * Days loaded this visit. `file: null` is a day with nothing published,
 * remembered so it isn't asked for again on every tap.
 */
const dayCache = new Map<string, { file: DayFile | null; at: number }>();
const inFlight = new Map<string, Promise<DayFile | null>>();

/**
 * The day, from memory if held, otherwise from the network.
 *
 * A held day older than REFETCH_AFTER_MS is still returned straight
 * away, and replaced in the background; the caller re-renders when it
 * lands. Prefetching passes `refetch: false`, so filling the strip never
 * re-downloads days already held.
 */
async function ensureDay(date: string, { refetch = true } = {}): Promise<DayFile | null> {
  const held = dayCache.get(date);
  if (held) {
    if (refetch && Date.now() - held.at > REFETCH_AFTER_MS) void fetchDay(date);
    return held.file;
  }
  return fetchDay(date);
}

function fetchDay(date: string): Promise<DayFile | null> {
  const pending = inFlight.get(date);
  if (pending) return pending;

  const request = loadDay(date).then((file) => {
    // A failed refresh keeps what was already held rather than blanking
    // a day that was showing fine a moment ago.
    if (file || !dayCache.get(date)?.file) dayCache.set(date, { file, at: Date.now() });
    inFlight.delete(date);
    return dayCache.get(date)?.file ?? null;
  });
  inFlight.set(date, request);
  return request;
}

const placeKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

function toCourseViews(
  day: DayFile,
  date: string,
  forecasts: Map<string, DayWeather | null> | null
): CourseView[] {
  return day.courses.map((c) => {
    const course: CourseView = {
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
        id: `${c.id}:${date}:${i}`,
        date,
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
    };

    const day = forecasts?.get(placeKey(c.lat, c.lon));
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
  });
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
