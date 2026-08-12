"use client";

import { useState, useSyncExternalStore } from "react";
import { roundsStore, type Round } from "@/lib/rounds";
import { formatPrice, formatTime, todayInUtah, formatDateLabel } from "@/lib/format";

/**
 * The rounds button and the panel it opens.
 *
 * Lives in the header rather than on its own screen: this app is one
 * page again, and a list you check occasionally shouldn't cost a
 * navigation. The count bubble is the whole point — it tells you there's
 * something to deal with without you having to look.
 */
export function RoundsButton() {
  const [open, setOpen] = useState(false);
  const rounds = useSyncExternalStore(
    roundsStore.subscribe,
    roundsStore.getSnapshot,
    roundsStore.getServerSnapshot
  );

  const today = todayInUtah();
  // Only what's still ahead counts on the badge. A bubble that includes
  // last month's rounds is a number nobody can ever clear.
  const upcoming = rounds.filter((r) => r.date >= today);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Rounds (${upcoming.length} upcoming)`}
        className="relative flex items-center gap-1.5 rounded-full bg-surface-2 py-1.5 pl-3 pr-3.5 text-[13px] font-medium text-text-1 active:bg-surface-3"
      >
        <TeeIcon />
        Rounds
        {upcoming.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-crimson px-1 text-[10px] font-bold text-white">
            {upcoming.length}
          </span>
        )}
      </button>

      {open && <Sheet rounds={rounds} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function Sheet({
  rounds,
  today,
  onClose,
}: {
  rounds: Round[];
  today: string;
  onClose: () => void;
}) {
  const upcoming = rounds
    .filter((r) => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const past = rounds
    .filter((r) => r.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <div className="relative max-h-[85vh] overflow-y-auto rounded-t-3xl bg-surface-1 pb-8 ring-1 ring-line">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface-1 px-4 py-3">
          <div>
            <h2 className="text-[17px] font-semibold text-text-1">Your rounds</h2>
            <p className="text-[11px] text-text-3">
              Saved when you open a tee time — booking happens on the course&apos;s site
            </p>
          </div>
          <button onClick={onClose} className="-m-2 p-2 text-lg text-text-3">
            ✕
          </button>
        </div>

        {rounds.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-2xl">⛳</p>
            <p className="mt-2 font-medium text-text-1">Nothing saved yet</p>
            <p className="mt-1 text-sm text-text-2">
              Tap a tee time and it&apos;s kept here so you can find it again.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-4 pt-4">
            {upcoming.length > 0 && <Group title="Coming up" rounds={upcoming} today={today} />}
            {past.length > 0 && <Group title="Past" rounds={past} today={today} muted />}
          </div>
        )}
      </div>
    </div>
  );
}

function Group({
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
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">
        {title} <span className="font-normal normal-case">{rounds.length}</span>
      </h3>
      <ul className={`flex flex-col gap-2 ${muted ? "opacity-60" : ""}`}>
        {rounds.map((round) => (
          <RoundCard key={round.id} round={round} today={today} />
        ))}
      </ul>
    </section>
  );
}

function RoundCard({ round, today }: { round: Round; today: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(round.time);

  return (
    <li className="rounded-2xl bg-surface-2 px-3.5 py-3">
      <p className="truncate text-[15px] font-medium leading-tight text-text-1">
        {round.courseName}
      </p>
      <p className="mt-1 text-[13px] text-text-2">
        {formatDateLabel(round.date, today)} · {formatTime(round.time)} · {round.holes} holes
        {round.price != null && ` · ${formatPrice(round.price)}`}
      </p>

      {editing ? (
        // Changing the time rather than re-picking the slot: the usual
        // case is booking 8:30 after tapping 8:00, and the rest of the
        // round is unchanged.
        <div className="mt-2.5 flex items-center gap-2">
          <input
            type="time"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="rounded-lg bg-surface-3 px-2.5 py-1.5 text-[13px] text-text-1"
          />
          <button
            onClick={() => {
              roundsStore.setTime(round.id, draft);
              setEditing(false);
            }}
            className="rounded-full bg-crimson px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Save
          </button>
          <button
            onClick={() => {
              setDraft(round.time);
              setEditing(false);
            }}
            className="rounded-full bg-surface-3 px-3 py-1.5 text-[13px] font-medium text-text-2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={() => roundsStore.setBooked(round.id, !round.booked)}
            aria-pressed={round.booked}
            className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
              round.booked ? "bg-crimson text-white" : "bg-surface-3 text-text-1"
            }`}
          >
            {round.booked ? "✓ Booked" : "Confirm"}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="rounded-full bg-surface-3 px-3 py-1.5 text-[13px] font-medium text-text-2"
          >
            Change
          </button>
          <button
            onClick={() => roundsStore.remove(round.id)}
            className="rounded-full bg-surface-3 px-3 py-1.5 text-[13px] font-medium text-text-2"
          >
            Delete
          </button>
          <a
            href={round.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[13px] font-medium text-crimson-bright"
          >
            Open ↗
          </a>
        </div>
      )}
    </li>
  );
}

/** A ball on a tee — also the app's icon. */
function TeeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none">
      <circle cx="12" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 14.5h7L12 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
