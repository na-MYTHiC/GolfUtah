/**
 * Which tee times were already on screen last time you looked.
 *
 * Times go fast here, so the useful question on reopening the app isn't
 * "what's available" — you saw that ten minutes ago — it's "what's
 * changed". A slot that wasn't there before is worth a badge; the other
 * two hundred are noise you've already scanned past.
 *
 * Stored per day as a set of slot keys. There's no server and no
 * timestamp on a slot, so the only way to know something is new is to
 * remember what was there and compare.
 *
 * Two days are kept. Today and tomorrow are what anyone actually
 * re-checks, and holding all ten would put a few thousand keys in
 * localStorage to answer a question nobody asks about next Tuesday.
 */

const KEY = "golfutah:seen";
const MAX_DAYS = 2;

interface SeenFile {
  /** date -> slot keys that were on screen last time. */
  days: Record<string, string[]>;
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
    const parsed = raw ? (JSON.parse(raw) as SeenFile) : null;
    return parsed?.days ? parsed : { days: {} };
  } catch {
    return { days: {} };
  }
}

/**
 * The slots on this day that weren't here last time, and records the
 * current set for next time.
 *
 * Returns an empty set on a day never seen before — on a first visit
 * everything is new, and badging all two hundred would say nothing.
 */
export function markSeen(date: string, keys: string[]): Set<string> {
  if (typeof localStorage === "undefined") return new Set();

  const file = read();
  const before = file.days[date];

  const fresh = new Set<string>();
  if (before) {
    const previous = new Set(before);
    for (const key of keys) if (!previous.has(key)) fresh.add(key);
  }

  file.days[date] = keys;

  // Keep only the most recent days, by date, so this can't grow forever.
  const kept = Object.keys(file.days).sort().reverse().slice(0, MAX_DAYS);
  file.days = Object.fromEntries(kept.map((d) => [d, file.days[d]]));

  try {
    localStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    // Storage full or blocked — the badge is a nicety, not worth throwing.
  }

  return fresh;
}
