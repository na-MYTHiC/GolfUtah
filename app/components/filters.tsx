"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addDays } from "@/lib/format";
import { CITIES, COUNTIES } from "@/lib/utah-places";

/**
 * Filters live in the URL so a search is shareable and survives a
 * refresh — "9 holes under $40 Saturday morning" is exactly the sort of
 * thing you send to whoever you're playing with.
 */
export interface FilterState {
  date: string;
  players: number;
  holes: "all" | "9" | "18";
  /** Part of day, replacing the old from/until pair. */
  when: "any" | "morning" | "midday" | "evening";
  maxPrice: number | null;
  /** Only meaningful grouped by course; the time list is always chronological. */
  sort: "distance" | "price";
  /** Free text matched against course name and city. */
  q: string;
  /** City to measure distances from, set by searching for one. */
  near: string;
  /** Only show courses within this many miles of the origin. */
  radius: number | null;
  /** Restrict to one Utah county. Mutually exclusive with radius. */
  county: string;
  /** Only courses the golfer has starred. */
  starred: boolean;
  view: "time" | "course";
}

/** How far ahead data is published; matches build-data.ts --days. */
const DAYS_AHEAD = 10;

export function useFilters(date: string): FilterState {
  const params = useSearchParams();
  return {
    date,
    players: Number(params.get("players") ?? 1),
    holes: (params.get("holes") as FilterState["holes"]) ?? "all",
    when: (params.get("when") as FilterState["when"]) ?? "any",
    maxPrice: params.get("maxPrice") ? Number(params.get("maxPrice")) : null,
    sort: (params.get("sort") as FilterState["sort"]) ?? "distance",
    q: params.get("q") ?? "",
    near: params.get("near") ?? "",
    radius: params.get("radius") ? Number(params.get("radius")) : null,
    county: params.get("county") ?? "",
    starred: params.get("starred") === "1",
    // Grouped by course by default: most people are choosing where to
    // play before they're choosing when.
    view: (params.get("view") as FilterState["view"]) ?? "course",
  };
}

/**
 * Search across course name and city, with suggestions.
 *
 * Suggestions come from the courses actually loaded, so they can never
 * offer something that returns nothing. Picking a city also gives the
 * radius filter something to measure from — see `near` in FilterState.
 */
export function SearchBar({ value, courses }: { value: string; courses: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the box in step when the URL changes from elsewhere — a shared
  // link, or tapping the app name to reset. Comparing against the last
  // value seen during render, rather than syncing in an effect, avoids
  // the extra render pass an effect would cause.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const commit = useCallback(
    (next: string, kind?: "course" | "city" | "county") => {
      const p = new URLSearchParams(params.toString());
      if (next.trim()) p.set("q", next);
      else p.delete("q");

      if (kind === "county") {
        // A county is a boundary, not a point — a radius around it would
        // mean something different from what was asked, so clear it.
        p.set("county", next);
        p.delete("near");
        p.delete("radius");
      } else {
        p.delete("county");
        // A city doubles as the origin for radius filtering.
        if (kind === "city") p.set("near", next);
        else if (!next.trim()) p.delete("near");
      }
      router.replace(`${pathname}?${p}`, { scroll: false });
    },
    [params, router, pathname]
  );

  const suggestions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    if (!needle) return [];

    const courseHits = courses
      .filter((c) => c.toLowerCase().includes(needle))
      .map((c) => ({ label: c, kind: "course" as const }));

    // Every Utah city, not just ones with a course: people search from
    // where they live, then widen the radius to find somewhere to play.
    const cityHits = CITIES.filter((c) => c.name.toLowerCase().includes(needle)).map((c) => ({
      label: c.name,
      kind: "city" as const,
      hint: `${c.county} County`,
    }));

    const countyHits = COUNTIES.filter((c) => c.toLowerCase().includes(needle)).map((c) => ({
      label: c,
      kind: "county" as const,
    }));

    // Courses first — an exact course match is the most specific thing
    // the searcher could have meant.
    return [...courseHits, ...countyHits, ...cityHits].slice(0, 7);
  }, [draft, courses]);

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Dismisses the on-screen keyboard.
          inputRef.current?.blur();
          setOpen(false);
          // Typing a place name by hand should behave the same as
          // picking it from the suggestions.
          const typed = draft.trim().toLowerCase();
          const kind = COUNTIES.some((c) => c.toLowerCase() === typed)
            ? ("county" as const)
            : CITIES.some((c) => c.name.toLowerCase() === typed)
              ? ("city" as const)
              : undefined;
          commit(draft, kind);
        }}
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
        >
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            commit(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          // Delayed so a tap on a suggestion registers before it closes.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search course or city"
          className="w-full rounded-full bg-surface-2 py-2 pl-9 pr-3 text-[15px] text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-crimson/50"
        />
      </form>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-2xl bg-surface-1 py-1 ring-1 ring-line">
          {suggestions.map((s) => (
            <li key={`${s.kind}:${s.label}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDraft(s.label);
                  setOpen(false);
                  inputRef.current?.blur();
                  commit(s.label, s.kind);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-text-1 active:bg-surface-2"
              >
                <span className="text-text-3">
                  {s.kind === "course" ? "⛳" : s.kind === "county" ? "▨" : "◎"}
                </span>
                <span className="truncate">{s.label}</span>
                <span className="ml-auto shrink-0 text-[11px] text-text-3">
                  {s.kind === "county"
                    ? "county"
                    : s.kind === "city"
                      ? ("hint" in s ? s.hint : "city")
                      : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Time list vs. grouped by course. */
export function ViewToggle({ view }: { view: FilterState["view"] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (next: FilterState["view"]) => {
    const p = new URLSearchParams(params.toString());
    if (next === "course") p.delete("view");
    else p.set("view", next);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <div className="flex shrink-0 rounded-full bg-surface-2 p-0.5">
      {(["course", "time"] as const).map((option) => (
        <button
          key={option}
          onClick={() => set(option)}
          className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
            view === option
              ? "bg-surface-3 text-text-1"
              : "text-text-2"
          }`}
        >
          {option === "time" ? "By time" : "By course"}
        </button>
      ))}
    </div>
  );
}

export function DateStrip({ today, active }: { today: string; active: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  const pick = (date: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("date", date);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    // Horizontal scroll rather than wrapping: ten days of chips would
    // otherwise push the actual tee times off a phone screen.
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {dates.map((date) => {
        const d = new Date(`${date}T12:00:00`);
        const isActive = date === active;
        const isToday = date === today;
        return (
          <button
            key={date}
            onClick={() => pick(date)}
            className={`flex w-[3.25rem] shrink-0 flex-col items-center rounded-xl py-2 transition ${
              isActive
                ? "bg-crimson text-white shadow-sm shadow-crimson/30"
                : "bg-surface-2 text-text-2 active:bg-surface-3"
            }`}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-75">
              {isToday ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="text-base font-semibold leading-tight tabular-nums">
              {d.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterChips({
  filters,
  hasOrigin,
  onLocate,
  view,
}: {
  filters: FilterState;
  /** Whether a distance origin exists (device location or searched city). */
  hasOrigin: boolean;
  onLocate: () => void;
  /** Sorting is hidden in the time list, which is chronological by definition. */
  view: FilterState["view"];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, router, pathname]
  );

  // Everything except the day and the view, which aren't narrowing —
  // clearing filters shouldn't jump you back to today or change layout.
  const NARROWING = ["players", "holes", "when", "maxPrice", "radius", "county", "starred", "q", "near", "sort"];
  const activeCount = NARROWING.filter((k) => params.get(k)).length;

  const clearAll = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    for (const key of NARROWING) next.delete(key);
    router.replace(`${pathname}?${next}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, router, pathname]);

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        onClick={() => update("starred", filters.starred ? "" : "1")}
        aria-pressed={filters.starred}
        className={`flex shrink-0 items-center gap-1 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-medium transition ${
          filters.starred ? "bg-crimson text-white" : "bg-surface-2 text-text-2"
        }`}
      >
        <span aria-hidden>{filters.starred ? "★" : "☆"}</span>
        Starred
      </button>
      <Chip
        value={String(filters.players)}
        active={filters.players > 1}
        onChange={(v) => update("players", v === "1" ? "" : v)}
        options={[
          ["1", "Any group"],
          ["2", "2+ players"],
          ["3", "3+ players"],
          ["4", "4 players"],
        ]}
      />
      <Chip
        value={filters.holes}
        active={filters.holes !== "all"}
        onChange={(v) => update("holes", v)}
        options={[
          ["all", "9 or 18"],
          ["9", "9 holes"],
          ["18", "18 holes"],
        ]}
      />
      {/* One control instead of a from/until pair — nobody thinks in
          boundary times, they think "I want to play in the morning". */}
      <Chip
        value={filters.when}
        active={filters.when !== "any"}
        onChange={(v) => update("when", v === "any" ? "" : v)}
        options={[
          ["any", "Any time"],
          ["morning", "Morning"],
          ["midday", "Midday"],
          ["evening", "Evening"],
        ]}
      />
      <Chip
        value={filters.maxPrice == null ? "" : String(filters.maxPrice)}
        active={filters.maxPrice != null}
        onChange={(v) => update("maxPrice", v)}
        options={[
          ["", "Any price"],
          ["25", "Under $25"],
          ["40", "Under $40"],
          ["60", "Under $60"],
          ["100", "Under $100"],
        ]}
      />
      {/* Measures from your location if shared, otherwise from a city
          picked in the search box. Without either there's no origin, so
          the chip prompts for one rather than silently doing nothing. */}
      <Chip
        value={filters.radius == null ? "" : String(filters.radius)}
        active={filters.radius != null}
        disabled={filters.county !== ""}
        onChange={(v) => {
          if (v && !hasOrigin) onLocate();
          update("radius", v);
        }}
        options={[
          ["", filters.county ? "Whole county" : hasOrigin ? "Any distance" : "Distance"],
          ["10", "Within 10 miles"],
          ["20", "Within 20 miles"],
          ["30", "Within 30 miles"],
          ["50", "Within 50 miles"],
        ]}
      />
      {view === "course" && (
        <Chip
          value={filters.sort}
          active={filters.sort !== "distance"}
          onChange={(v) => {
            if (v === "distance" && !hasOrigin) onLocate();
            update("sort", v === "distance" ? "" : v);
          }}
          options={[
            ["distance", "By distance"],
            ["price", "By price"],
          ]}
        />
      )}
      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="shrink-0 rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium text-text-2 active:bg-surface-3"
        >
          Clear {activeCount}
        </button>
      )}
    </div>
  );
}

function Chip({
  value,
  active,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  options: [string, string][];
  disabled?: boolean;
}) {
  return (
    <div className={`relative shrink-0 ${disabled ? "opacity-40" : ""}`}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        // Native select: on a phone this opens the OS picker, which is
        // faster and more accessible than any custom dropdown.
        className={`appearance-none rounded-full py-1.5 pl-3.5 pr-7 text-sm font-medium transition ${
          active
            ? "bg-crimson text-white"
            : "bg-surface-2 text-text-2"
        }`}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v} className="bg-surface-1 text-text-1">
            {label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className={`pointer-events-none absolute right-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 ${
          active ? "text-white/80" : "text-text-3"
        }`}
      >
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

type Coords = { lat: number; lon: number };
const COORDS_KEY = "golfutah:coords";

/**
 * localStorage as an external store, so a saved location survives a
 * refresh without syncing through an effect. getSnapshot must return a
 * stable reference or React re-renders forever, hence caching the parsed
 * value against the raw string.
 */
const coordsStore = {
  listeners: new Set<() => void>(),
  raw: null as string | null,
  parsed: null as Coords | null,

  subscribe(listener: () => void) {
    coordsStore.listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      coordsStore.listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },

  getSnapshot(): Coords | null {
    const raw = localStorage.getItem(COORDS_KEY);
    if (raw !== coordsStore.raw) {
      coordsStore.raw = raw;
      try {
        coordsStore.parsed = raw ? (JSON.parse(raw) as Coords) : null;
      } catch {
        coordsStore.parsed = null;
      }
    }
    return coordsStore.parsed;
  },

  /** The server can't know where anyone is. */
  getServerSnapshot(): Coords | null {
    return null;
  },

  save(coords: Coords) {
    localStorage.setItem(COORDS_KEY, JSON.stringify(coords));
    coordsStore.listeners.forEach((listener) => listener());
  },
};

/** Browser geolocation, for distance sorting. Never leaves the device. */
export function useGeolocation() {
  const coords = useSyncExternalStore(
    coordsStore.subscribe,
    coordsStore.getSnapshot,
    coordsStore.getServerSnapshot
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => coordsStore.save({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {
        // Denied or unavailable — distance sorting stays unavailable.
      },
      { maximumAge: 10 * 60 * 1000, timeout: 8000 }
    );
  }, []);

  return { coords, locate };
}
