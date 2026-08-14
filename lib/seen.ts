/**
 * Which tee times are new, and for how long they stay new.
 *
 * Times go fast here, so the useful question on reopening the app isn't
 * "what's available" — you saw that ten minutes ago — it's "what's
 * changed". A slot that wasn't there before is worth a badge; the other
 * two hundred are noise you've already scanned past.
 *
 * WHY THIS STORES TIMESTAMPS AND NOT A SET OF KEYS.
 *
 * It used to keep "the keys that were on screen last time" and diff
 * against them. That has a fatal flaw: reading the diff destroys it. The
 * first render after data arrived found the new slot and immediately
 * recorded it as seen — and this app re-renders the list a second later
 * when the weather resolves, at which point the slot was already "seen"
 * and the badge vanished. So a genuinely new tee time flashed "New" for
 * about a second and then looked like all the others.
 *
 * Recording the moment a slot was *first* seen fixes that at the root.
 * It's idempotent: seeing the same slot again doesn't move its
 * timestamp, so re-rendering, refetching or reloading can't clear a
 * badge. And "new" becomes a question about time rather than about read
 * order — a slot is new for NEW_FOR_MS after it first appeared, however
 * many times the list gets drawn in between.
 *
 * Two days are kept. Today and tomorrow are what anyone actually
 * re-checks, and holding all ten would put a few thousand keys in
 * localStorage to answer a question nobody asks about next Tuesday.
 */

const KEY = "golfutah:seen";
const MAX_DAYS = 2;

/**
 * How long a slot wears the badge.
 *
 * Long enough to still be there when you come back to a tab, and to
 * survive several refreshes — the near days rebuild every five minutes,
 * so this spans about three of them. Short enough that the badge still
 * means "just appeared" rather than decorating half the list.
 */
export const NEW_FOR_MS = 15 * 60 * 1000;

/**
 * Timestamp meaning "already here before we started watching this day".
 * Slots recorded on a first visit get this so they never badge — on a
 * first visit everything is new, and badging all two hundred says
 * nothing.
 */
const PREEXISTING = 0;

interface SeenFile {
  /** date -> slot key -> epoch ms first seen (or PREEXISTING). */
  days: Record<string, Record<string, number>>;
}

/** Identifies a slot without depending on how the data was rebuilt. */
export function slotKey(
  courseSlug: string,
  time: string,
  holes: number,
  side?: string
): string {
  return `${courseSlug}|${time}|${holes}|${side ?? ""}`;
}

function read(): SeenFile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { days: {} };

    const parsed = JSON.parse(raw) as { days?: Record<string, unknown> };
    if (!parsed?.days) return { days: {} };

    const days: SeenFile["days"] = {};
    for (const [date, entry] of Object.entries(parsed.days)) {
      // Upgrade from the old format, which stored a plain array of keys.
      // Everything in it predates the change, so it counts as
      // pre-existing — the alternative is badging a whole day's list
      // once on upgrade, which is exactly the noise avoided elsewhere.
      if (Array.isArray(entry)) {
        days[date] = Object.fromEntries((entry as string[]).map((k) => [k, PREEXISTING]));
      } else if (entry && typeof entry === "object") {
        days[date] = entry as Record<string, number>;
      }
    }
    return { days };
  } catch {
    return { days: {} };
  }
}

/**
 * Records anything not seen before, and returns what still counts as new.
 *
 * Safe to call on every render: a slot's first-seen time is written once
 * and never moved, so calling this again with the same slots is a no-op
 * that returns the same answer.
 *
 * @param now Passed in rather than read here, so badges expire on the
 * caller's minute tick — a re-render is what makes one disappear, which
 * an unobservable clock read during render could never do.
 */
export function markSeen(date: string, keys: string[], now = Date.now()): Set<string> {
  if (typeof localStorage === "undefined") return new Set();

  const file = read();
  const known = file.days[date];

  // A day never opened before: everything on it predates us.
  const firstVisit = known === undefined;
  const next: Record<string, number> = {};

  for (const key of keys) {
    next[key] = firstVisit ? PREEXISTING : (known[key] ?? now);
  }

  // Slots that have gone (booked, or the sheet moved) are kept until
  // they're past the badge window. Without that, a slot that blinks out
  // of one refresh and back into the next would return wearing a "New"
  // badge it hasn't earned. Past the window there's nothing left worth
  // remembering, so they're dropped and storage stays bounded.
  if (!firstVisit) {
    for (const [key, at] of Object.entries(known)) {
      if (next[key] === undefined && at !== PREEXISTING && now - at < NEW_FOR_MS) {
        next[key] = at;
      }
    }
  }

  file.days[date] = next;

  // Keep only the most recent days, by date, so this can't grow forever.
  const kept = Object.keys(file.days).sort().reverse().slice(0, MAX_DAYS);
  file.days = Object.fromEntries(kept.map((d) => [d, file.days[d]]));

  try {
    localStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    // Storage full or blocked — the badge is a nicety, not worth throwing.
  }

  const fresh = new Set<string>();
  for (const key of keys) {
    const at = next[key];
    if (at !== PREEXISTING && now - at < NEW_FOR_MS) fresh.add(key);
  }
  return fresh;
}
