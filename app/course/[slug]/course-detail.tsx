"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadDay, loadCourseInfo, type StaticCourse, type CourseInfo } from "@/lib/static-data";
import { getProfile } from "@/lib/course-profiles";
import { FilterChips, useFilters } from "@/app/components/filters";
import { TeeTimeRow, windClass, type Booking } from "@/app/components/tee-time-row";
import { favoritesStore } from "@/lib/favorites";
import { useSyncExternalStore } from "react";

import { getDayWeather, describeWeather, weatherAt, type DayWeather } from "@/lib/weather";
import { todayInUtah, formatDateLabel, formatTime, addDays } from "@/lib/format";
import { useUtahNow, withoutPast } from "@/lib/now";

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
  const router = useRouter();
  const today = todayInUtah();
  const date = params.get("date") ?? today;

  const [course, setCourse] = useState<StaticCourse | null | undefined>(undefined);
  const [weather, setWeather] = useState<DayWeather | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const filters = useFilters(date);
  const [info, setInfo] = useState<CourseInfo | null>(null);
  const now = useUtahNow();

  // Ratings and reviews are the same every day, so they load once and
  // independently of the tee times — no reason to hold up the list.
  useEffect(() => {
    let cancelled = false;
    loadCourseInfo().then((all) => {
      if (!cancelled) setInfo(all[slug] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCourse(undefined);

      // Always bypass caches here. This is the page someone is looking at
      // with their thumb over the booking button, so it should reflect
      // the latest published data rather than whatever the service worker
      // happens to be holding.
      const day = await loadDay(date, true);
      if (cancelled) return;

      const match = day?.courses.find((c) => c.slug === slug) ?? null;
      setCourse(match);
      setCheckedAt(day?.generatedAt ?? null);

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

  // Times that have already teed off come out first and separately from
  // the filters, so "3 of 12" never counts this morning against a filter
  // that had nothing to do with it.
  const published = course?.slots ?? [];
  const remaining = withoutPast(published, date, now);

  // The same narrowing the list applies, so arriving here from a
  // filtered list doesn't silently widen it again.
  const visible = remaining.filter((slot) => {
    if (slot.spots < filters.players) return false;
    if (filters.holes !== "all" && slot.holes !== Number(filters.holes)) return false;
    if (!inWindow(slot.time, filters.when)) return false;
    if (filters.maxPrice != null) {
      if (slot.price == null || slot.price > filters.maxPrice * 100) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        <a
          href={back}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2"
        >
          <span aria-hidden>←</span> All courses
        </a>

        <DateStrip
          today={today}
          active={date}
          onPick={(next) => {
            const p = new URLSearchParams(params.toString());
            p.set("date", next);
            router.replace(`?${p}`, { scroll: false });
          }}
        />

        <header className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text-1">
              {name}
            </h1>
            <p className="mt-1 text-sm text-text-2">
              {city} · {county} County
              {info && (
                <>
                  {" · "}
                  <span className="text-crimson-bright">★ {info.rating.toFixed(1)}</span>
                  <span className="text-text-3"> ({info.reviewCount})</span>
                </>
              )}
            </p>
          </div>
          <FavoriteStar slug={slug} />
        </header>

        <Stats slug={slug} />

        <FilterChips
          filters={filters}
          hasOrigin={false}
          onLocate={() => {}}
          view="time"
        />

        {weather && <Conditions weather={weather} date={date} today={today} />}

        <div className="mt-5">
          {course === undefined ? (
            <ul className="flex animate-pulse flex-col gap-2" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="h-[68px] rounded-2xl bg-surface-1 ring-1 ring-line" />
              ))}
            </ul>
          ) : course === null ? (
            <Empty message="No data for this course on this day." />
          ) : course.error ? (
            <Empty message={`Couldn't load times — ${course.error}`} />
          ) : published.length === 0 ? (
            <Empty message="No openings published for this day." />
          ) : remaining.length === 0 ? (
            <Empty message="Every tee time here has already gone out today." />
          ) : visible.length === 0 ? (
            <Empty
              message={`None of this course's ${remaining.length} remaining times match your filters.`}
            />
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between px-0.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
                  {visible.length === remaining.length
                    ? `${visible.length} tee times`
                    : `${visible.length} of ${remaining.length} tee times`}
                </h2>
                <Freshness generatedAt={checkedAt} />
              </div>
              {/* The same row as the list view, rather than a second
                  layout that drifts from it. Reusing it also brings the
                  things this page was missing: cart pricing, the
                  after-dark warning, and saving to Rounds on tap. */}
              <ul className="flex flex-col gap-2">
                {visible.map((slot, i) => {
                  const hour = weatherAt(weather, slot.time);
                  const booking: Booking = {
                    id: `${slug}:${date}:${slot.time}:${slot.holes}:${i}`,
                    time: slot.time,
                    holes: slot.holes,
                    playersOpen: slot.spots,
                    price: slot.price,
                    cart: slot.cart,
                    withCart: slot.withCart,
                    rate: slot.rate,
                    side: slot.side,
                    bookingUrl: slot.url,
                    courseName: name,
                    courseSlug: slug,
                    courseCity: null,
                    date,
                    undatedLink: course.platform === "MEMBERSPORTS",
                    sunset: weather?.sunset,
                    weather: hour
                      ? {
                          temperatureF: hour.temperatureF,
                          windMph: hour.windMph,
                          icon: describeWeather(hour.weatherCode).icon,
                        }
                      : undefined,
                  };
                  return (
                    <TeeTimeRow
                      key={booking.id}
                      booking={booking}
                      players={filters.players}
                      hideCourse
                    />
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <About slug={slug} name={name} city={city} info={info} />

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

      <div className="mt-3 flex justify-between gap-1">
        {hours.map((h) => (
          <div key={h.time} className="min-w-0 flex-1 text-center">
            <div className="text-[10px] text-text-3">{formatTime(h.time).replace(":00", "")}</div>
            <div className="mt-0.5 text-base">{describeWeather(h.weatherCode).icon}</div>
            <div className="mt-0.5 text-[13px] font-medium text-text-1 tabular-nums">
              {h.temperatureF}°
            </div>
            <div
              className={`text-[10px] tabular-nums ${
                // The same three bands as the tee-time rows. Two rules
                // for one number meant 11mph read grey here and amber
                // three inches further down the same screen.
                windClass(h.windMph)
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

/** Mirrors the list's part-of-day windows so the two agree. */
const WINDOWS: Record<string, [string, string]> = {
  morning: ["00:00", "11:59"],
  midday: ["12:00", "16:59"],
  evening: ["17:00", "23:59"],
};

function inWindow(time: string, when: string): boolean {
  const range = WINDOWS[when];
  if (!range) return true;
  return time >= range[0] && time <= range[1];
}

/**
 * The same ten-day strip as the list view.
 *
 * Written locally rather than shared with the list's version because
 * that one navigates to "/?date=…"; here the day should change without
 * leaving the course.
 */
function DateStrip({
  today,
  active,
  onPick,
}: {
  today: string;
  active: string;
  onPick: (date: string) => void;
}) {
  const dates = Array.from({ length: 10 }, (_, i) => addDays(today, i));

  return (
    <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {dates.map((date) => {
        const d = new Date(`${date}T12:00:00`);
        const isActive = date === active;
        return (
          <button
            key={date}
            onClick={() => onPick(date)}
            className={`flex w-[3.25rem] shrink-0 flex-col items-center rounded-xl py-2 transition ${
              isActive
                ? "bg-crimson text-white shadow-sm shadow-crimson/30"
                : "bg-surface-2 text-text-2 active:bg-surface-3"
            }`}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-75">
              {date === today ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="text-base font-semibold leading-tight tabular-nums">
              {d.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * What the course is like, and what golfers said about it.
 *
 * The facts come first and the opinions second, deliberately. Choosing
 * between two open tee times is mostly a question of "is this course
 * long / hilly / hard", which a star rating doesn't answer and a
 * scorecard does.
 */
/**
 * The facts strip: what the round is, at a glance, above the times.
 *
 * Style, length and walkability are what decide between two courses with
 * openings at the same hour, so they belong at the top rather than
 * buried under the tee sheet.
 */
function Stats({ slug }: { slug: string }) {
  const profile = getProfile(slug);
  if (!profile) return null;

  const cells = [
    profile.style && { label: "Style", value: profile.style },
    profile.holes && { label: "Holes", value: String(profile.holes) },
    profile.par && { label: "Par", value: String(profile.par) },
    profile.yardage && { label: "Yards", value: profile.yardage.toLocaleString() },
    profile.slope && { label: "Slope", value: String(profile.slope) },
    profile.walkable && { label: "Walking", value: profile.walkable },
  ].filter(Boolean) as { label: string; value: string }[];

  if (cells.length === 0) return null;

  // Columns follow the number of cells rather than being fixed at three,
  // which left an empty square whenever a course had two facts or four.
  const columns = cells.length <= 3 ? cells.length : cells.length === 4 ? 2 : 3;

  return (
    <dl
      className="mt-3 grid gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {cells.map((cell) => (
        <div key={cell.label} className="bg-surface-1 px-3 py-2.5">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-text-3">
            {cell.label}
          </dt>
          <dd className="mt-0.5 truncate text-[14px] font-semibold text-text-1">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Star toggle, matching the one in the list view. */
function FavoriteStar({ slug }: { slug: string }) {
  const favorites = useSyncExternalStore(
    favoritesStore.subscribe,
    favoritesStore.getSnapshot,
    favoritesStore.getServerSnapshot
  );
  const on = favorites.includes(slug);

  return (
    <button
      onClick={() => favoritesStore.toggle(slug)}
      aria-label={on ? "Remove from starred courses" : "Star this course"}
      aria-pressed={on}
      className={`shrink-0 rounded-full bg-surface-2 px-3 py-2 text-lg leading-none ${
        on ? "text-crimson-bright" : "text-text-3"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

function About({
  slug,
  name,
  city,
  info,
}: {
  slug: string;
  name: string;
  city: string;
  info: CourseInfo | null;
}) {
  const profile = getProfile(slug);
  const blurb = profile?.notes ?? info?.summary;

  // Style, holes and walkability moved to the stats strip at the top of
  // the page, so this is the prose and the opinions only — repeating
  // them here made the same three facts appear twice on one screen.

  // The Maps link stands on its own, so this section is worth rendering
  // even with no profile and no Places data at all.

  return (
    <section className="mt-5 flex flex-col gap-2 rounded-2xl bg-surface-1 px-4 py-3.5 ring-1 ring-line">
      {(profile?.designer || profile?.opened) && (
        <p className="text-[12px] text-text-3">
          {[profile.designer, profile.opened && `est. ${profile.opened}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {blurb && <p className="text-[13px] leading-relaxed text-text-2">{blurb}</p>}

      {/* Reviews without an API key. Google Maps' URL scheme is public
          and free to link to, so when Places isn't configured the app
          still gets you to real reviews — one tap instead of inline. */}
      {!info && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${name} golf course ${city} Utah`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-surface-2 py-2.5 text-[13px] font-medium text-text-1 active:bg-surface-3"
        >
          Reviews &amp; photos on Google Maps
          <span aria-hidden className="text-text-3">↗</span>
        </a>
      )}

      {info?.reviews?.length ? (
        <div className="border-t border-line pt-3">
          <ul className="flex flex-col gap-3">
            {info.reviews.map((r, i) => (
              <li key={i} className="text-[13px] leading-relaxed">
                <p className="text-text-2">
                  <span className="text-crimson-bright">
                    {"★".repeat(Math.round(r.rating))}
                  </span>{" "}
                  <span className="text-text-3">
                    {r.author} · {r.when}
                  </span>
                </p>
                {/* Clamped rather than truncated in JS so the full text
                    stays selectable and readable to a screen reader. */}
                <p className="mt-0.5 line-clamp-4 text-text-2">{r.text}</p>
              </li>
            ))}
          </ul>
          {/* Google's terms require reviews be attributed and link back. */}
          <p className="mt-3 text-[11px] text-text-3">
            Reviews from Google
            {info.mapsUrl && (
              <>
                {" · "}
                <a
                  href={info.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  See all on Google Maps
                </a>
              </>
            )}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * How current the times are.
 *
 * There was a Refresh button here and it's gone. Opening this page
 * already bypasses every cache, so the button re-fetched a file that
 * hadn't changed and appeared to do nothing — which is worse than not
 * offering it. The data is only ever as new as the last scheduled
 * build, so the honest thing is to say when that was.
 */
function Freshness({ generatedAt }: { generatedAt: string | null }) {
  const clock = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Denver",
      })
    : null;

  return (
    <p className="text-[11px] text-text-3">
      {clock ? `Updated ${clock}` : "Loading…"}
    </p>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-text-2">
      {message}
    </div>
  );
}
