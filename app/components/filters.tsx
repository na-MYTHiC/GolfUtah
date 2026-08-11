"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addDays } from "@/lib/format";

/**
 * Filters live in the URL so a search is shareable and survives a
 * refresh — "9 holes under $40 Saturday morning" is exactly the sort of
 * thing you send to whoever you're playing with.
 */
export interface FilterState {
  date: string;
  players: number;
  holes: "all" | "9" | "18";
  after: string;
  before: string;
  maxPrice: number | null;
  sort: "time" | "price" | "distance";
  /** Free text matched against course name and city. */
  q: string;
  /** City to measure distances from, set by searching for one. */
  near: string;
  /** Only show courses within this many miles of the origin. */
  radius: number | null;
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
    after: params.get("after") ?? "",
    before: params.get("before") ?? "",
    maxPrice: params.get("maxPrice") ? Number(params.get("maxPrice")) : null,
    sort: (params.get("sort") as FilterState["sort"]) ?? "time",
    q: params.get("q") ?? "",
    near: params.get("near") ?? "",
    radius: params.get("radius") ? Number(params.get("radius")) : null,
    view: (params.get("view") as FilterState["view"]) ?? "time",
  };
}

/**
 * Search across course name and city, with suggestions.
 *
 * Suggestions come from the courses actually loaded, so they can never
 * offer something that returns nothing. Picking a city also gives the
 * radius filter something to measure from — see `near` in FilterState.
 */
export function SearchBar({
  value,
  courses,
  cities,
}: {
  value: string;
  courses: string[];
  cities: string[];
}) {
  const router = useRouter();
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
    (next: string, city?: string) => {
      const p = new URLSearchParams(params.toString());
      if (next.trim()) p.set("q", next);
      else p.delete("q");
      // A city match doubles as the origin for radius filtering.
      if (city) p.set("near", city);
      else if (!next.trim()) p.delete("near");
      router.replace(`/?${p}`, { scroll: false });
    },
    [params, router]
  );

  const suggestions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    if (!needle) return [];
    const cityHits = cities
      .filter((c) => c.toLowerCase().includes(needle))
      .map((c) => ({ label: c, kind: "city" as const }));
    const courseHits = courses
      .filter((c) => c.toLowerCase().includes(needle))
      .map((c) => ({ label: c, kind: "course" as const }));
    return [...cityHits, ...courseHits].slice(0, 6);
  }, [draft, courses, cities]);

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Dismisses the on-screen keyboard.
          inputRef.current?.blur();
          setOpen(false);
          commit(draft, cities.find((c) => c.toLowerCase() === draft.trim().toLowerCase()));
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
                  commit(s.label, s.kind === "city" ? s.label : undefined);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-text-1 active:bg-surface-2"
              >
                <span className="text-text-3">{s.kind === "city" ? "◎" : "⛳"}</span>
                <span className="truncate">{s.label}</span>
                {s.kind === "city" && (
                  <span className="ml-auto shrink-0 text-[11px] text-text-3">city</span>
                )}
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
  const params = useSearchParams();

  const set = (next: FilterState["view"]) => {
    const p = new URLSearchParams(params.toString());
    if (next === "time") p.delete("view");
    else p.set("view", next);
    router.replace(`/?${p}`, { scroll: false });
  };

  return (
    <div className="flex shrink-0 rounded-full bg-surface-2 p-0.5">
      {(["time", "course"] as const).map((option) => (
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
  const params = useSearchParams();

  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  const pick = (date: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("date", date);
    router.replace(`/?${next}`, { scroll: false });
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
}: {
  filters: FilterState;
  /** Whether a distance origin exists (device location or searched city). */
  hasOrigin: boolean;
  onLocate: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
      router.replace(`/?${next}`, { scroll: false });
    },
    [params, router]
  );

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      <Chip
        value={filters.after}
        active={filters.after !== ""}
        onChange={(v) => update("after", v)}
        options={[
          ["", "From any time"],
          ["06:00", "From 6 AM"],
          ["08:00", "From 8 AM"],
          ["10:00", "From 10 AM"],
          ["12:00", "From noon"],
          ["15:00", "From 3 PM"],
        ]}
      />
      <Chip
        value={filters.before}
        active={filters.before !== ""}
        onChange={(v) => update("before", v)}
        options={[
          ["", "Until any time"],
          ["10:00", "Until 10 AM"],
          ["12:00", "Until noon"],
          ["15:00", "Until 3 PM"],
          ["18:00", "Until 6 PM"],
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
        onChange={(v) => {
          if (v && !hasOrigin) onLocate();
          update("radius", v);
        }}
        options={[
          ["", hasOrigin ? "Any distance" : "Distance"],
          ["10", "Within 10 miles"],
          ["20", "Within 20 miles"],
          ["30", "Within 30 miles"],
          ["50", "Within 50 miles"],
        ]}
      />
      <Chip
        value={filters.sort}
        active={filters.sort !== "time"}
        onChange={(v) => {
          if (v === "distance" && !hasOrigin) onLocate();
          update("sort", v === "time" ? "" : v);
        }}
        options={[
          ["time", "By time"],
          ["price", "By price"],
          ["distance", "By distance"],
        ]}
      />
    </div>
  );
}

function Chip({
  value,
  active,
  onChange,
  options,
}: {
  value: string;
  active: boolean;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
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
