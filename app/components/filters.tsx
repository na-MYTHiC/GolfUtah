"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
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
  /** City to measure distances from, when not using device location. */
  near: string;
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
    view: (params.get("view") as FilterState["view"]) ?? "time",
  };
}

/** Search across course name and city. */
export function SearchBar({ value }: { value: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const update = (next: string) => {
    const p = new URLSearchParams(params.toString());
    if (next.trim()) p.set("q", next);
    else p.delete("q");
    router.replace(`/?${p}`, { scroll: false });
  };

  return (
    <div className="relative">
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
      >
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder="Search course or city"
        className="w-full rounded-full bg-zinc-100 py-2 pl-9 pr-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:bg-zinc-800/80 dark:text-zinc-100"
      />
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
    <div className="flex shrink-0 rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800/80">
      {(["time", "course"] as const).map((option) => (
        <button
          key={option}
          onClick={() => set(option)}
          className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
            view === option
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
              : "text-zinc-500 dark:text-zinc-400"
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
                ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/25"
                : "bg-zinc-100 text-zinc-600 active:bg-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-300"
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
  cities,
  hasLocation,
  onLocate,
}: {
  filters: FilterState;
  cities: string[];
  hasLocation: boolean;
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
      <Chip
        value={hasLocation ? "__me" : filters.near}
        active={hasLocation || filters.near !== ""}
        onChange={(v) => {
          if (v === "__me") {
            onLocate();
            update("near", "");
          } else {
            update("near", v);
          }
        }}
        options={[
          ["", "Distance from…"],
          ["__me", "My location"],
          ...cities.map((c) => [c, c] as [string, string]),
        ]}
      />
      <Chip
        value={filters.sort}
        active={filters.sort !== "time"}
        onChange={(v) => {
          if (v === "distance" && !hasLocation) onLocate();
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
            ? "bg-emerald-600 text-white"
            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300"
        }`}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            {label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className={`pointer-events-none absolute right-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 ${
          active ? "text-white/80" : "text-zinc-400"
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
