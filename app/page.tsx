import { Suspense } from "react";
import { getTeeTimes } from "@/lib/tee-times";
import { getDayWeather, describeWeather, weatherAt } from "@/lib/weather";
import { getPlaceInfo, placesEnabled } from "@/lib/places";
import { todayInUtah } from "@/lib/format";
import { Results } from "./components/results";
import type { CourseView } from "./components/course-card";

// Tee times go stale within minutes as other golfers book, so never
// serve this page from a cache.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const today = todayInUtah();
  const date = typeof params.date === "string" ? params.date : today;

  const { courses, mode } = await getTeeTimes(date);

  // Weather and ratings are per-course side quests — fetched in parallel,
  // and each falls back to undefined rather than failing the page.
  const enriched: CourseView[] = await Promise.all(
    courses.map(async (course) => {
      const [day, rating] = await Promise.all([
        course.latitude != null && course.longitude != null
          ? getDayWeather(course.latitude, course.longitude, date)
          : Promise.resolve(null),
        placesEnabled() ? getPlaceInfo(course.name, course.city) : Promise.resolve(null),
      ]);

      const slotWeather: CourseView["slotWeather"] = {};
      if (day) {
        for (const slot of course.teeTimes) {
          const hour = weatherAt(day, slot.time);
          if (hour) {
            slotWeather[slot.time] = {
              temperatureF: hour.temperatureF,
              windMph: hour.windMph,
              icon: describeWeather(hour.weatherCode).icon,
            };
          }
        }
      }

      return {
        id: course.id,
        name: course.name,
        city: course.city,
        platform: course.platform,
        bookingUrl: course.bookingUrl,
        latitude: course.latitude,
        longitude: course.longitude,
        slots: course.teeTimes,
        error: course.error,
        weather: day
          ? {
              highF: day.highF,
              lowF: day.lowF,
              maxPrecipChance: day.maxPrecipChance,
              ...describeWeather(day.hours[12]?.weatherCode ?? 0),
            }
          : undefined,
        slotWeather: day ? slotWeather : undefined,
        rating: rating ?? undefined,
      };
    })
  );

  const anyTimes = enriched.some((c) => c.slots.length > 0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            GolfUtah
          </h1>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            Every Utah tee time worth playing, in one place.
          </p>
        </header>

        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Results courses={enriched} today={today} date={date} mode={mode} />
        </Suspense>

        {!anyTimes && <SetupHelp mode={mode} />}

        <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          <p>
            Availability is fetched from each course&apos;s own booking system and can change
            within minutes — always confirm on the course&apos;s page. Booking and payment happen
            there; GolfUtah never handles payment details.
          </p>
          <p className="mt-1">
            Weather from Open-Meteo. Distances are approximate, from city-level coordinates.
          </p>
        </footer>
      </main>
    </div>
  );
}

function SetupHelp({ mode }: { mode: "cached" | "live" }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-5 text-sm dark:border-zinc-700">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">Nothing came back</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
        <li>Courses may simply be closed or fully booked for this date.</li>
        {mode === "live" && (
          <li>
            Running in live mode (no <code>DATABASE_URL</code>), so every page load calls the
            courses directly. Set up Postgres and run <code>npm run poll</code> for a cached,
            much faster listing.
          </li>
        )}
        <li>
          Check a single course from the terminal:{" "}
          <code>npx tsx scripts/probe.ts foreup 18895:578</code>
        </li>
      </ul>
    </div>
  );
}
