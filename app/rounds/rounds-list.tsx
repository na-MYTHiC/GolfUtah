"use client";

import { useSyncExternalStore } from "react";
import { roundsStore, type Round } from "@/lib/rounds";
import { formatPrice, formatTime, todayInUtah, formatDateLabel } from "@/lib/format";

/**
 * Tee times you've opened, split into what's still ahead and what's
 * behind you.
 *
 * The app can't see your bookings — you're handed off to the course's
 * checkout and it never reports back — so this is what you tapped, plus
 * whatever you've confirmed. That's deliberately stated on screen rather
 * than left to be discovered.
 */
export function RoundsList() {
  const rounds = useSyncExternalStore(
    roundsStore.subscribe,
    roundsStore.getSnapshot,
    roundsStore.getServerSnapshot
  );

  const today = todayInUtah();
  const upcoming = rounds
    .filter((r) => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const past = rounds
    .filter((r) => r.date < today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  if (rounds.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
        <p className="text-2xl">⛳</p>
        <p className="mt-2 font-medium text-text-1">No rounds yet</p>
        <p className="mt-1 text-sm text-text-2">
          Tee times you open are saved here so you can find them again.
        </p>
        <p className="mt-2 text-xs text-text-3">
          Booking happens on the course&apos;s own site, which never tells us the
          outcome — so mark a round as booked yourself and it&apos;ll stick.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      {upcoming.length > 0 && (
        <Section title="Coming up" rounds={upcoming} today={today} />
      )}
      {past.length > 0 && <Section title="Past" rounds={past} today={today} muted />}
    </div>
  );
}

function Section({
  title,
  rounds,
  today,
  muted = false,
}: {
  title: string;
  rounds: Round[];
  today: string;
  muted?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-3">
        {title}
        <span className="ml-1.5 font-normal normal-case tracking-normal">{rounds.length}</span>
      </h2>
      <ul className={`flex flex-col gap-2 ${muted ? "opacity-70" : ""}`}>
        {rounds.map((round) => (
          <RoundRow key={round.id} round={round} today={today} />
        ))}
      </ul>
    </section>
  );
}

function RoundRow({ round, today }: { round: Round; today: string }) {
  return (
    <li className="rounded-2xl bg-surface-1 px-3.5 py-3 ring-1 ring-line">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium leading-tight text-text-1">
            {round.courseName}
          </p>
          <p className="mt-1 text-[13px] text-text-2">
            {formatDateLabel(round.date, today)} · {formatTime(round.time)} · {round.holes} holes
            {round.price != null && ` · ${formatPrice(round.price)}`}
          </p>
        </div>
        <button
          onClick={() => roundsStore.remove(round.id)}
          aria-label="Remove this round"
          className="-m-1 shrink-0 p-1 text-text-3"
        >
          ✕
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => roundsStore.setBooked(round.id, !round.booked)}
          aria-pressed={round.booked}
          className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
            round.booked ? "bg-crimson text-white" : "bg-surface-2 text-text-2"
          }`}
        >
          {round.booked ? "✓ Booked" : "Mark booked"}
        </button>
        <a
          href={round.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-text-1 active:bg-surface-3"
        >
          Open course site
        </a>
      </div>
    </li>
  );
}
