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
  nested = false,
}: {
  booking: Booking;
  players: number;
  /** Course view already names the course in its header. */
  hideCourse?: boolean;
  /** Sitting inside a course card, which already provides the surface. */
  nested?: boolean;
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
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition active:scale-[0.99] ${
          nested ? "bg-surface-2" : "rounded-2xl bg-surface-1 px-3.5 py-3 ring-1 ring-line"
        }`}
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
            {/* Spelled out where it fits. Moving conditions into their
                own column bought back the room for the word — but a row
                that also carries "Back" runs out again at 360px inside a
                card, and a clipped "4 ope" is worse than "18h". */}
            <span className="font-medium text-text-2">
              {booking.holes}
              {booking.side === "Back" ? "h" : " holes"}
            </span>
            {/* Only the back nine is worth a word. "Front" is the default
                and says nothing, while costing the same space. */}
            {booking.side === "Back" && (
              <>
                <Dot />
                <span>Back</span>
              </>
            )}
            <Dot />
            <span>{booking.playersOpen} open</span>
            {booking.distanceMiles != null && (
              <>
                <Dot />
                <span className="text-text-3">{booking.distanceMiles.toFixed(0)}mi</span>
              </>
            )}
            {/* No separator dot and a size down: the glyph is distinct
                enough to stand alone, and the pair of them was the last
                thing pushing a nested row over its width. */}
            {light?.short && (
              <span
                className="shrink-0 text-[10px] leading-none"
                aria-label="Finishes after dark"
                title={`Sunset ${to12h(booking.sunset!)} · ${booking.holes} holes finishes about ${to12h(light.finishesAt)}`}
              >
                🌙
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right leading-tight">
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
            <div className="text-[10px] text-text-3 tabular-nums">
              +{formatPrice(booking.cart)} cart
            </div>
          ) : booking.withCart ? (
            <div className="text-[10px] text-text-3">with cart</div>
          ) : null}
          {/* Conditions live here rather than in the meta line, which
              couldn't hold them at 360px without clipping something —
              and the thing being clipped was the wind. */}
          {booking.weather && (
            <div className="mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap text-[11px]">
              <span className="text-text-3" title={`${booking.weather.temperatureF}°F`}>
                {booking.weather.icon} {booking.weather.temperatureF}°
              </span>
              {/* Always shown; the colour carries how much it matters. */}
              <span className={windClass(booking.weather.windMph)}>
                {booking.weather.windMph}mph
              </span>
            </div>
          )}
        </div>
      </a>
    </li>
  );
}

/**
 * How much the wind is going to cost an amateur, as a colour.
 *
 *   under 8    barely felt; a long iron shapes a little. Grey — it's
 *              context, not a warning.
 *   8 to 15    about a club into it, and enough across to move a
 *              mid-iron off line. Amber: worth noticing, not a reason to
 *              pick another time.
 *   15 and up  changes clubbing on most shots and puts holes out of
 *              reach. Red, because it should change the decision.
 *
 * Three steps rather than two because the middle band is most of Utah's
 * afternoons, and colouring all of it red would make red mean nothing.
 */
export function windClass(mph: number): string {
  if (mph >= 15) return "font-medium text-crimson-bright";
  if (mph >= 8) return "font-medium text-amber-400/90";
  return "text-text-3";
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
