/**
 * Tee times you've opened, and the ones you say you booked.
 *
 * WHY THIS IS MANUAL, and can't be otherwise.
 *
 * GolfUtah hands you off to the course's own checkout and never hears
 * what happened there — no callback, no confirmation, no shared session.
 * So an automatic "your booked rounds" list is not something this app is
 * withholding for effort reasons; it has no way to know.
 *
 * What it does know is which tee time you tapped. That turns out to be
 * most of the value: tapping a slot records it as an intent, and one tap
 * confirms it as booked. You get a round history and a reminder of what
 * you were looking at, without pretending to an integration that doesn't
 * exist.
 *
 * Everything stays on the device.
 */

const KEY = "golfutah:rounds";

export interface Round {
  /** Stable across a rebuild: course, day and time identify a slot. */
  id: string;
  courseSlug: string;
  courseName: string;
  date: string; // YYYY-MM-DD
  time: string; // "HH:mm"
  holes: number;
  price: number | null;
  bookingUrl: string;
  /** Set when the golfer confirms they went through with it. */
  booked: boolean;
  /** When it was first tapped, for ordering and pruning. */
  savedAt: string;
}

const EMPTY: Round[] = [];

/** Enough to be a history without growing without bound. */
const MAX_ROUNDS = 100;

function read(): Round[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Round[]) : EMPTY;
    return Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

const store = {
  listeners: new Set<() => void>(),
  raw: null as string | null,
  parsed: EMPTY as Round[],

  subscribe(listener: () => void) {
    store.listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      store.listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },

  /**
   * Cached against the raw string: useSyncExternalStore compares
   * snapshots by reference, and re-parsing on every read would hand it a
   * new array each time and spin.
   */
  getSnapshot(): Round[] {
    const raw = localStorage.getItem(KEY);
    if (raw !== store.raw) {
      store.raw = raw;
      store.parsed = read();
    }
    return store.parsed;
  },

  getServerSnapshot(): Round[] {
    return EMPTY;
  },

  write(next: Round[]) {
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, MAX_ROUNDS)));
    store.raw = null;
    store.listeners.forEach((listener) => listener());
  },

  /** Called when a tee time is opened. Idempotent per slot. */
  remember(round: Omit<Round, "booked" | "savedAt">) {
    const current = store.getSnapshot();
    if (current.some((r) => r.id === round.id)) return;
    store.write([{ ...round, booked: false, savedAt: new Date().toISOString() }, ...current]);
  },

  /**
   * Corrects the recorded time. The usual case is booking 8:30 after
   * tapping 8:00 — the course and day are right, the slot moved. The id
   * is left alone so the entry keeps its identity rather than
   * duplicating.
   */
  setTime(id: string, time: string) {
    store.write(store.getSnapshot().map((r) => (r.id === id ? { ...r, time } : r)));
  },

  setBooked(id: string, booked: boolean) {
    store.write(store.getSnapshot().map((r) => (r.id === id ? { ...r, booked } : r)));
  },

  remove(id: string) {
    store.write(store.getSnapshot().filter((r) => r.id !== id));
  },
};

export const roundsStore = store;

/** A slot's stable identity, independent of how the data was rebuilt. */
export function roundId(courseSlug: string, date: string, time: string, holes: number): string {
  return `${courseSlug}:${date}:${time}:${holes}`;
}
