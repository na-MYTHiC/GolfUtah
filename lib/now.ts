/**
 * The current Utah minute, as something React can re-render on.
 *
 * Exists for one job: a tee time that has already started is still in the
 * day's data file and will stay there until the next scheduled build, but
 * it is not bookable. Tapping it lands on a course's site that won't sell
 * it. So the list has to hide it, and "has it passed?" is a question
 * whose answer changes while the page is open — a golfer who loads the
 * app at 7:58 and looks again at 8:05 should not still be offered the
 * 8:00.
 *
 * Rebuilding the data more often wouldn't fix this: the fastest tier runs
 * every five minutes, and slots pass continuously. It has to be decided
 * in the browser, against the browser's clock.
 */

import { useMemo, useSyncExternalStore } from "react";

/** "YYYY-MM-DD HH:mm" in Utah — one string so snapshots compare cheaply. */
function read(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

const store = {
  listeners: new Set<() => void>(),
  snapshot: null as string | null,
  timer: null as ReturnType<typeof setTimeout> | null,

  subscribe(listener: () => void) {
    store.listeners.add(listener);
    if (store.listeners.size === 1) store.schedule();
    return () => {
      store.listeners.delete(listener);
      if (store.listeners.size === 0 && store.timer != null) {
        clearTimeout(store.timer);
        store.timer = null;
      }
    };
  },

  /**
   * Wakes on the minute boundary rather than every 60s from whenever the
   * first component happened to mount, so the list drops a slot when the
   * clock rolls over and not up to a minute late.
   */
  schedule() {
    const delay = 60_000 - (Date.now() % 60_000) + 250;
    store.timer = setTimeout(() => {
      const next = read();
      if (next !== store.snapshot) {
        store.snapshot = next;
        for (const l of store.listeners) l();
      }
      if (store.listeners.size > 0) store.schedule();
    }, delay);
  },

  getSnapshot(): string {
    // Cached because useSyncExternalStore compares snapshots by identity
    // and a fresh string every call would loop forever.
    store.snapshot ??= read();
    return store.snapshot;
  },

  /**
   * The static export is prerendered at build time, so there is no
   * meaningful "now" then. A sentinel that precedes every real tee time
   * means the prerendered HTML hides nothing; React swaps in the real
   * clock on hydration and the past slots disappear on that first
   * client render.
   */
  getServerSnapshot(): string {
    return "0000-00-00 00:00";
  },
};

export interface UtahNow {
  date: string;
  time: string;
}

export function useUtahNow(): UtahNow {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
  // Stable across renders so callers can use it as a memo dependency —
  // a fresh object every render would defeat the pruning memo it exists
  // to feed.
  return useMemo(() => {
    const [date, time] = snapshot.split(" ");
    return { date, time };
  }, [snapshot]);
}

/**
 * Whether a slot's start has already gone by.
 *
 * No grace period beyond the current minute. A course's real cutoff is
 * its own business and varies — some stop selling fifteen minutes out,
 * some take walk-ups right up to the tee — so the only line this app can
 * draw honestly is the tee time itself. Hiding times that might still be
 * bookable would be the worse error of the two.
 *
 * The comparison is `<=` rather than `<` because both sides are minutes:
 * at 2:00 the 2:00 tee time is teeing off, not upcoming, and `<` would
 * leave it on screen for the rest of that minute.
 */
export function isPast(slotDate: string, slotTime: string, now: UtahNow): boolean {
  if (slotDate !== now.date) return slotDate < now.date;
  return slotTime <= now.time;
}

/** Drops slots that have already started. `date` is the day being shown. */
export function withoutPast<T extends { time: string; date?: string }>(
  slots: T[],
  date: string,
  now: UtahNow
): T[] {
  // Nothing to walk on a future day, which is most of them.
  if (date > now.date) return slots;
  return slots.filter((s) => !isPast(s.date ?? date, s.time, now));
}
