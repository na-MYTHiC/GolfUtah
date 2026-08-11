"use client";

import { formatPrice } from "@/lib/format";

export interface Booking {
  id: string;
  time: string; // "HH:mm"
  holes: number;
  playersOpen: number;
  price: number | null;
  side?: string;
  bookingUrl: string;
  courseName: string;
  courseCity: string | null;
  distanceMiles?: number;
  weather?: { temperatureF: number; windMph: number; icon: string };
}

/**
 * One tee time, as a row.
 *
 * Reading order is deliberately time -> course -> details -> price: a
 * golfer scans down the left edge for a time that works, then checks
 * whether the course and price suit. Price sits right-aligned so the
 * column can be compared at a glance without reading each row.
 */
export function TeeTimeRow({ booking, players }: { booking: Booking; players: number }) {
  const [hour, minute] = booking.time.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  const display = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")}`;

  return (
    <li>
      <a
        href={withPlayers(booking.bookingUrl, players)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-3 ring-1 ring-zinc-200 transition active:scale-[0.99] dark:bg-zinc-900 dark:ring-zinc-800"
      >
        <div className="w-14 shrink-0 text-center">
          <div className="text-lg font-semibold leading-tight tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {display}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {period}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium leading-tight text-zinc-900 dark:text-zinc-100">
            {booking.courseName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              {booking.holes}
            </span>
            {booking.side && (
              <>
                <Dot />
                <span>{booking.side}</span>
              </>
            )}
            <Dot />
            <span>
              {booking.playersOpen} open
            </span>
            {booking.distanceMiles != null && (
              <>
                <Dot />
                <span>{booking.distanceMiles.toFixed(0)} mi</span>
              </>
            )}
            {booking.weather && (
              <>
                <Dot />
                <span title={`${booking.weather.temperatureF}°F, ${booking.weather.windMph} mph`}>
                  {booking.weather.icon} {booking.weather.temperatureF}°
                  {/* Above ~12mph wind genuinely changes club selection,
                      so it earns space; below that it's noise. */}
                  {booking.weather.windMph >= 12 && (
                    <span className="ml-0.5 text-amber-600 dark:text-amber-500">
                      {booking.weather.windMph}mph
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatPrice(booking.price)}
          </div>
          {booking.courseCity && (
            <div className="mt-0.5 max-w-[5.5rem] truncate text-[11px] text-zinc-400">
              {booking.courseCity}
            </div>
          )}
        </div>
      </a>
    </li>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
      ·
    </span>
  );
}

/**
 * ForeUp's booking page accepts `players`, so the chosen party size rides
 * along into the handoff. Applied at click time because it depends on the
 * filter rather than the data.
 */
function withPlayers(url: string, players: number): string {
  if (players <= 1) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("schedule_id")) return url; // not a ForeUp link
    parsed.searchParams.set("players", String(players));
    return parsed.toString();
  } catch {
    return url;
  }
}
