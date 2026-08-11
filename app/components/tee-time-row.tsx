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
export function TeeTimeRow({
  booking,
  players,
  hideCourse = false,
}: {
  booking: Booking;
  players: number;
  /** Course view already names the course in its header. */
  hideCourse?: boolean;
}) {
  const [hour, minute] = booking.time.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  const display = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")}`;

  return (
    <li>
      <a
        href={withPlayers(booking.bookingUrl, players)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-2xl bg-surface-1 px-3.5 py-3 ring-1 ring-line transition active:scale-[0.99]"
      >
        <div className="w-14 shrink-0 text-center">
          <div className="text-lg font-semibold leading-tight tracking-tight text-text-1 tabular-nums">
            {display}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-text-3">
            {period}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {!hideCourse && (
            <div className="truncate text-[15px] font-medium leading-tight text-text-1">
              {booking.courseName}
            </div>
          )}
          <div
            className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-text-2 ${
              hideCourse ? "text-[13px]" : "mt-1 text-xs"
            }`}
          >
            <span className="font-medium text-text-2">
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
                    <span className="ml-0.5 text-crimson-bright">
                      {booking.weather.windMph}mph
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold text-text-1 tabular-nums">
            {formatPrice(booking.price)}
          </div>
          {booking.courseCity && (
            <div className="mt-0.5 max-w-[5.5rem] truncate text-[11px] text-text-3">
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
    <span aria-hidden className="text-text-3">
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
