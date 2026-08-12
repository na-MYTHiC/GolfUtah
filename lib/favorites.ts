/**
 * Courses the golfer has starred, kept in localStorage.
 *
 * Most people play a handful of courses over and over. Making them scan
 * forty every time they open the app is the difference between a
 * directory and something you'd actually check on a Friday night — so
 * starred courses get pinned above everything else.
 *
 * Same external-store shape as the saved location in filters.tsx:
 * useSyncExternalStore needs a snapshot with a stable reference, so the
 * parsed value is cached against the raw string rather than re-parsed on
 * every read.
 */

const KEY = "golfutah:favorites";

const EMPTY: string[] = [];

const store = {
  listeners: new Set<() => void>(),
  raw: null as string | null,
  parsed: EMPTY as string[],

  subscribe(listener: () => void) {
    store.listeners.add(listener);
    // Starring a course in one tab should show up in the others.
    window.addEventListener("storage", listener);
    return () => {
      store.listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },

  getSnapshot(): string[] {
    const raw = localStorage.getItem(KEY);
    if (raw !== store.raw) {
      store.raw = raw;
      try {
        const parsed = raw ? (JSON.parse(raw) as string[]) : EMPTY;
        store.parsed = Array.isArray(parsed) ? parsed : EMPTY;
      } catch {
        store.parsed = EMPTY;
      }
    }
    return store.parsed;
  },

  /** Nothing is starred until the browser says so. */
  getServerSnapshot(): string[] {
    return EMPTY;
  },

  toggle(slug: string) {
    const current = store.getSnapshot();
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    localStorage.setItem(KEY, JSON.stringify(next));
    store.raw = null; // force a re-parse on the next read
    store.listeners.forEach((listener) => listener());
  },
};

export const favoritesStore = store;
