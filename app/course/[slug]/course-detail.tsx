"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadDay, loadCourseInfo, type StaticCourse, type CourseInfo } from "@/lib/static-data";
import { getProfile, profileSummary } from "@/lib/course-profiles";
import { getDayWeather, describeWeather, weatherAt, type DayWeather } from "@/lib/weather";
import { todayInUtah, formatDateLabel, formatPrice, formatTime, addDays } from "@/lib/format";

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
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Bumped to re-run the load; how a manual refresh is triggered. */
  const [reloads, setReloads] = useState(0);
  const [info, setInfo] = useState<CourseInfo | null>(null);

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
      // Only blank the list on a first load. A manual refresh keeps the
      // old times on screen until the new ones arrive, so the page
      // doesn't flash empty while someone is reading it.
      if (reloads === 0) setCourse(undefined);
      else setRefreshing(true);

      // Always bypass caches here. This is the page someone is looking at
      // with their thumb over the booking button, so it should reflect
      // the latest published data rather than whatever the service worker
      // happens to be holding.
      const day = await loadDay(date, true);
      if (cancelled) return;

      const match = day?.courses.find((c) => c.slug === slug) ?? null;
      setCourse(match);
      setCheckedAt(day?.generatedAt ?? null);
      setLastChecked(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Denver",
        })
      );
      setRefreshing(false);

      if (match) {
        const forecast = await getDayWeather(match.lat, match.lon, date);
        if (!cancelled) setWeather(forecast);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, date, reloads]);

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

        <DateStrip
          today={today}
          active={date}
          onPick={(next) => {
            const p = new URLSearchParams(params.toString());
            p.set("date", next);
            router.replace(`?${p}`, { scroll: false });
          }}
        />

        <header className="mt-3">
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
        </header>

        <About slug={slug} name={name} city={city} info={info} />

        {weather && <Conditions weather={weather} date={date} today={today} />}

        <Freshness
          generatedAt={checkedAt}
          lastChecked={lastChecked}
          refreshing={refreshing}
          onRefresh={() => setReloads((n) => n + 1)}
        />

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
  const facts = profile ? profileSummary(profile) : [];
  const blurb = profile?.notes ?? info?.summary;

  // The Maps link stands on its own, so this section is worth rendering
  // even with no profile and no Places data at all.

  return (
    <section className="mt-4 rounded-2xl bg-surface-1 px-4 py-3.5 ring-1 ring-line">
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-1 text-[12px] text-text-2">
          {facts.map((f, i) => (
            <span key={f}>
              {i > 0 && <span className="mr-2 text-text-3">·</span>}
              {f}
            </span>
          ))}
        </div>
      )}

      {profile?.walkable && (
        <p className="mt-1.5 text-[12px] text-text-2">
          Walking: <span className="text-text-1">{profile.walkable}</span>
        </p>
      )}

      {blurb && <p className="mt-2 text-[13px] leading-relaxed text-text-2">{blurb}</p>}

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
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-surface-2 py-2.5 text-[13px] font-medium text-text-1 active:bg-surface-3"
        >
          Reviews &amp; photos on Google Maps
          <span aria-hidden className="text-text-3">↗</span>
        </a>
      )}

      {info?.reviews?.length ? (
        <div className="mt-3 border-t border-line pt-3">
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
 * How current the times are, and a way to ask again.
 *
 * Worth being blunt about the ceiling: the site is static, so this
 * re-reads the most recently published data rather than calling the
 * course's booking system. The booking systems don't allow cross-origin
 * requests from a browser, so a page like this one physically cannot ask
 * them directly — the data is as new as the last scheduled build, which
 * runs every few minutes. The link out to the course is the only truly
 * live source, which is why it's the thing every row points at.
 */
function Freshness({
  generatedAt,
  lastChecked,
  refreshing,
  onRefresh,
}: {
  generatedAt: string | null;
  /** When this page last asked, as opposed to when the times were gathered. */
  lastChecked: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const clock = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Denver",
      })
    : null;

  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface-1 px-3.5 py-2.5 ring-1 ring-line">
      {/* Two different times, and conflating them was confusing: one is
          when the courses were last polled, the other is when this page
          last asked for that data. Tapping Refresh moves the second and
          only moves the first if a new build has landed. */}
      <p className="min-w-0 text-[12px] leading-snug text-text-2">
        {clock ? `Times gathered ${clock}` : "Checking…"}
        <span className="block text-text-3">
          {lastChecked ? `Checked ${lastChecked} · ` : ""}confirm on the course&apos;s page
        </span>
      </p>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="shrink-0 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-text-1 transition active:bg-surface-3 disabled:opacity-50"
      >
        {refreshing ? "Checking…" : "Refresh"}
      </button>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-text-2">
      {message}
    </div>
  );
}
