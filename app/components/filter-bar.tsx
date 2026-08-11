"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { addDays, formatDateLabel } from "@/lib/format";

/**
 * Filters live in the URL rather than component state so a search is
 * shareable and survives a refresh — "9 holes under $30 on Saturday" is
 * exactly the kind of thing you send to the person you're playing with.
 */

export interface FilterState {
  date: string;
  players: number;
  holes: "all" | "9" | "18";
  after: string;
  before: string;
  maxPrice: number | null;
  sort: "time" | "price" | "distance";
}

const DAYS_AHEAD = 8;

export function FilterBar({
  today,
  filters,
  courseCount,
  onLocate,
  hasLocation,
}: {
  today: string;
  filters: FilterState;
  courseCount: number;
  onLocate: () => void;
  hasLocation: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const update = useCallback(
    (patch: Partial<FilterState>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === "all") next.delete(key);
        else next.set(key, String(value));
      }
      router.replace(`/?${next.toString()}`, { scroll: false });
    },
    [params, router]
  );

  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      {/* Dates scroll horizontally on narrow screens rather than wrapping
          into a tall block that pushes results off-screen. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-2">
        {dates.map((date) => {
          const active = date === filters.date;
          return (
            <button
              key={date}
              onClick={() => update({ date })}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {formatDateLabel(date, today)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select
          label="Players"
          value={String(filters.players)}
          onChange={(v) => update({ players: Number(v) })}
          options={[
            ["1", "1+ player"],
            ["2", "2+ players"],
            ["3", "3+ players"],
            ["4", "4 players"],
          ]}
        />
        <Select
          label="Holes"
          value={filters.holes}
          onChange={(v) => update({ holes: v as FilterState["holes"] })}
          options={[
            ["all", "9 or 18"],
            ["9", "9 holes"],
            ["18", "18 holes"],
          ]}
        />
        <Select
          label="After"
          value={filters.after}
          onChange={(v) => update({ after: v })}
          options={[
            ["", "Any time"],
            ["06:00", "6 AM"],
            ["08:00", "8 AM"],
            ["10:00", "10 AM"],
            ["12:00", "Noon"],
            ["14:00", "2 PM"],
            ["16:00", "4 PM"],
          ]}
        />
        <Select
          label="Before"
          value={filters.before}
          onChange={(v) => update({ before: v })}
          options={[
            ["", "Any time"],
            ["10:00", "10 AM"],
            ["12:00", "Noon"],
            ["14:00", "2 PM"],
            ["16:00", "4 PM"],
            ["18:00", "6 PM"],
          ]}
        />
        <Select
          label="Max price"
          value={filters.maxPrice == null ? "" : String(filters.maxPrice)}
          onChange={(v) => update({ maxPrice: v === "" ? null : Number(v) })}
          options={[
            ["", "Any price"],
            ["25", "Under $25"],
            ["40", "Under $40"],
            ["60", "Under $60"],
            ["100", "Under $100"],
          ]}
        />
        <Select
          label="Sort"
          value={filters.sort}
          onChange={(v) => update({ sort: v as FilterState["sort"] })}
          options={[
            ["time", "Tee time"],
            ["price", "Price"],
            ["distance", "Distance"],
          ]}
        />

        {!hasLocation && (
          <button
            onClick={onLocate}
            className="rounded-full border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Use my location
          </button>
        )}

        <span className="ml-auto text-zinc-500 dark:text-zinc-400">
          {courseCount} course{courseCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

type Coords = { lat: number; lon: number };

const COORDS_KEY = "golfutah:coords";

/**
 * localStorage as an external store, so the saved location survives a
 * refresh without syncing it into React state via an effect.
 *
 * getSnapshot must return a stable reference or React re-renders forever,
 * hence caching the parsed value against the raw string.
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

  /** No location during SSR — the server can't know where anyone is. */
  getServerSnapshot(): Coords | null {
    return null;
  },

  save(coords: Coords) {
    localStorage.setItem(COORDS_KEY, JSON.stringify(coords));
    coordsStore.listeners.forEach((listener) => listener());
  },
};

/** Browser geolocation, used to sort by distance. Never sent anywhere. */
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
        // Denied or unavailable — distance sorting just stays unavailable.
      },
      { maximumAge: 10 * 60 * 1000, timeout: 8000 }
    );
  }, []);

  return { coords, locate };
}
