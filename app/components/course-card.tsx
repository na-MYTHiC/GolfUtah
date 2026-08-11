"use client";

import { useState } from "react";
import { formatPrice, formatTime } from "@/lib/format";
import type { Slot } from "@/lib/tee-times";

export interface CourseView {
  id: string;
  name: string;
  city: string | null;
  platform: string;
  bookingUrl: string;
  slots: Slot[];
  latitude: number | null;
  longitude: number | null;
  /** Filled in client-side once the visitor shares their location. */
  distanceMiles?: number;
  error?: string;
  weather?: {
    highF: number;
    lowF: number;
    maxPrecipChance: number;
    icon: string;
    label: string;
  };
  slotWeather?: Record<string, { temperatureF: number; windMph: number; icon: string }>;
  rating?: { rating: number; reviewCount: number; mapsUrl?: string };
}

/** Slots shown before the list collapses behind a "show all" toggle. */
const PREVIEW_COUNT = 6;

export function CourseCard({ course }: { course: CourseView }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? course.slots : course.slots.slice(0, PREVIEW_COUNT);
  const hidden = course.slots.length - visible.length;

  const cheapest = course.slots.reduce<number | null>(
    (min, s) => (s.price != null && (min == null || s.price < min) ? s.price : min),
    null
  );

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{course.name}</h2>

        {course.city && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {course.city}
            {course.distanceMiles != null && ` · ${course.distanceMiles.toFixed(0)} mi`}
          </span>
        )}

        {course.rating && (
          <a
            href={course.rating.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ★ {course.rating.rating.toFixed(1)}
            <span className="ml-1 text-xs">({course.rating.reviewCount})</span>
          </a>
        )}

        {course.weather && (
          <span
            className="text-sm text-zinc-500 dark:text-zinc-400"
            title={`${course.weather.label}, ${course.weather.maxPrecipChance}% chance of precipitation`}
          >
            {course.weather.icon} {course.weather.highF}°/{course.weather.lowF}°
            {course.weather.maxPrecipChance >= 30 && (
              <span className="ml-1 text-blue-600 dark:text-blue-400">
                {course.weather.maxPrecipChance}%
              </span>
            )}
          </span>
        )}

        {cheapest != null && (
          <span className="ml-auto text-sm font-medium text-emerald-700 dark:text-emerald-500">
            from {formatPrice(cheapest)}
          </span>
        )}
      </header>

      {course.error ? (
        <p className="text-sm text-amber-700 dark:text-amber-500">
          Couldn&apos;t load times — {course.error}
        </p>
      ) : course.slots.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No times match your filters.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((slot) => (
              <SlotTile
                key={slot.id}
                slot={slot}
                weather={course.slotWeather?.[slot.time]}
              />
            ))}
          </ul>

          {hidden > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-3 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-500"
            >
              Show {hidden} more time{hidden === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function SlotTile({
  slot,
  weather,
}: {
  slot: Slot;
  weather?: { temperatureF: number; windMph: number; icon: string };
}) {
  return (
    <li>
      <a
        href={slot.bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-zinc-200 p-2.5 transition-colors hover:border-emerald-500 hover:bg-emerald-50 dark:border-zinc-700 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            {formatTime(slot.time)}
          </span>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {formatPrice(slot.price)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span>{slot.holes} holes</span>
          {/* Two slots can share a time and hole count while starting on
              different nines at different prices — without this they read
              as duplicates. */}
          {slot.side && (
            <>
              <span aria-hidden>·</span>
              <span
                className={
                  slot.side === "Back"
                    ? "font-medium text-amber-700 dark:text-amber-500"
                    : undefined
                }
              >
                {slot.side}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>
            {slot.playersOpen} spot{slot.playersOpen === 1 ? "" : "s"}
          </span>
          {weather && (
            <>
              <span aria-hidden>·</span>
              {/* Wind is the weather detail that actually changes a round. */}
              <span title={`${weather.temperatureF}°F, ${weather.windMph} mph wind`}>
                {weather.icon} {weather.temperatureF}°
                {weather.windMph >= 12 && ` 💨${weather.windMph}`}
              </span>
            </>
          )}
        </div>
      </a>
    </li>
  );
}
