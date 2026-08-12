"use client";

import { formatPrice } from "@/lib/format";
import { daylight } from "@/lib/weather";
import { roundsStore, roundId } from "@/lib/rounds";

export interface Booking {
  id: string;
  time: string; // "HH:mm"
  holes: number;
  playersOpen: number;
  price: number | null;
  /** Cart per player in cents, when quoted separately from the green fee. */
  cart?: number;
  /** True when `price` already includes a cart. */
  withCart?: boolean;
  /** Rate class the price belongs to. */
  rate?: string;
  side?: string;
  bookingUrl: string;
  courseName: string;
  courseSlug: string;
  courseCity: string | null;
  distanceMiles?: number;
  weather?: { temperatureF: number; windMph: number; icon: string };
  /** Course-local sunset, for the daylight check. */
  sunset?: string;
  /** Cheapest slot matching the current filters. */
  bestPrice?: boolean;
  /** The day this slot is on, for saving it as a round. */
  date?: string;
  /** True when the booking page can't be opened on a specific day. */
  undatedLink?: boolean;
  /** Appeared since this day was last looked at. */
  isNew?: boolean;
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

  // The thing a golfer works out in their head and no aggregator does
  // for them. A twilight rate is a bargain right up until you're putting
  // out by phone light on fourteen.
  const light = daylight(booking.sunset, booking.time, booking.holes);

  return (
    <li>
      <a
        href={withPlayers(booking.bookingUrl, players)}
        target="_blank"
        rel="noopener noreferrer"
        // Opening a tee time is the only signal this app ever gets that
        // someone is interested in one — the course's checkout never
        // reports back. Recording it here is what makes the Rounds tab
        // possible at all.
        onClick={() => {
          if (!booking.date) return;
          roundsStore.remember({
            id: roundId(booking.courseSlug, booking.date, booking.time, booking.holes),
            courseSlug: booking.courseSlug,
            courseName: booking.courseName,
            date: booking.date,
            time: booking.time,
            holes: booking.holes,
            price: booking.price,
            bookingUrl: booking.bookingUrl,
          });
        }}
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
            className={`flex items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-text-2 ${
              hideCourse ? "text-[13px]" : "mt-1 text-xs"
            }`}
          >
            {/* Times go fast here, so what changed since the last look
                is more useful than what exists. */}
            {booking.isNew && (
              <>
                <span className="rounded bg-crimson/20 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-crimson-bright">
                  New
                </span>
                <Dot />
              </>
            )}
            {/* "9 · 1 open" reads as two counts; "9 holes" doesn't. */}
            <span className="font-medium text-text-2">{booking.holes} holes</span>
            {booking.side && (
              <>
                <Dot />
                <span>{booking.side}</span>
              </>
            )}
            <Dot />
            <span>{booking.playersOpen} open</span>
            {booking.distanceMiles != null && (
              <>
                <Dot />
                <span>{booking.distanceMiles.toFixed(0)} mi</span>
              </>
            )}
            {light?.short && (
              <>
                <Dot />
                <span
                  aria-label="Finishes after dark"
                  title={`Sunset ${to12h(booking.sunset!)} · ${booking.holes} holes finishes about ${to12h(light.finishesAt)}`}
                >
                  🌙
                </span>
              </>
            )}
            {booking.weather && (
              <>
                <Dot />
                <span title={`${booking.weather.temperatureF}°F, ${booking.weather.windMph} mph`}>
                  {booking.weather.icon} {booking.weather.temperatureF}°
                  {/* Around 10mph is where a mid-iron starts moving, so
                      that's where wind earns space. Below it, showing a
                      number on every row would be noise. */}
                  {booking.weather.windMph >= 10 && (
                    <span className="ml-0.5 text-crimson-bright">
                      {" "}
                      {booking.weather.windMph}mph
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div
            className={`text-[15px] font-semibold tabular-nums ${
              booking.bestPrice ? "text-crimson-bright" : "text-text-1"
            }`}
          >
            {formatPrice(booking.price)}
          </div>
          {/* Whether a cart is in that number, which platforms disagree
              about: ForeUp and Chronogolf quote the green fee and the
              cart apart, TeeItUp quotes one figure with the cart in it.
              Without this the app silently compares the two. */}
          {booking.cart != null ? (
            <div className="mt-0.5 text-[10px] text-text-3 tabular-nums">
              +{formatPrice(booking.cart)} cart
            </div>
          ) : booking.withCart ? (
            <div className="mt-0.5 text-[10px] text-text-3">with cart</div>
          ) : null}
          {/* The course view names the course above the group, so the
              city on every row is just repetition. */}
          {booking.courseCity && !hideCourse && (
            <div className="mt-0.5 max-w-[5.5rem] truncate text-[11px] text-text-3">
              {booking.courseCity}
            </div>
          )}
        </div>
      </a>
    </li>
  );
}

/** "19:40" -> "7:40 PM", for the tooltips. */
function to12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function Dot() {
  return (
    <span aria-hidden className="text-text-3">
      ·
    </span>
  );
}

/**
 * Carries the chosen party size into the handoff, using whichever
 * parameter the destination speaks — ForeUp's `players`, Chronogolf's
 * `groupSize`. Both names come from real links, and each is only set on a
 * URL that already carries it, so nothing is invented for a platform that
 * wouldn't understand it. Applied at click time because it depends on the
 * filter rather than on the data.
 */
function withPlayers(url: string, players: number): string {
  if (players <= 1) return url;
  try {
    const parsed = new URL(url);
    const param = parsed.searchParams.has("schedule_id")
      ? "players" // ForeUp
      : parsed.searchParams.has("groupSize")
        ? "groupSize" // Chronogolf
        : null;
    if (!param) return url;
    parsed.searchParams.set(param, String(players));
    return parsed.toString();
  } catch {
    return url;
  }
}
