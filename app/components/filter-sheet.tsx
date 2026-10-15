"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { FilterState } from "./filters";
import { BottomSheet } from "./sheet";

/**
 * Every filter behind one button.
 *
 * They used to be a row of chips under the search box: Starred, players,
 * holes, time of day, price, distance, sort, Clear — eight controls in a
 * strip that scrolled sideways, half of it off the edge of a phone, plus
 * a Course/Time toggle squeezed in beside the search. A lot of small
 * things to aim at, at the top of the screen where the thumb is least
 * accurate, for settings most people change once a visit.
 *
 * In a sheet each one gets a full row and every option is visible at
 * once, instead of hiding inside a native select. Changes apply as they
 * are tapped, so the list behind the sheet is already the answer when it
 * closes, and the button at the bottom says how many times are left.
 *
 * "list" is the home screen. "course" is a single course's page, where
 * distance, starred and layout don't mean anything.
 */
export type FilterScope = "list" | "course";

/** What the badge counts and Clear resets. Layout is a view, not a filter. */
const KEYS: Record<FilterScope, string[]> = {
  list: ["starred", "players", "holes", "when", "maxPrice", "radius"],
  course: ["players", "holes", "when", "maxPrice"],
};

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, router, pathname]
  );

  return { set, params };
}

/** The applied filters in words, for the line under the search box. */
export function describeFilters(filters: FilterState, scope: FilterScope): string[] {
  const out: string[] = [];
  if (scope === "list" && filters.starred) out.push("Starred");
  if (filters.players > 1) out.push(filters.players >= 4 ? "4 players" : `${filters.players}+ players`);
  if (filters.holes !== "all") out.push(`${filters.holes} holes`);
  if (filters.when !== "any") out.push(filters.when[0].toUpperCase() + filters.when.slice(1));
  if (filters.maxPrice != null) out.push(`Under $${filters.maxPrice}`);
  if (scope === "list" && filters.radius != null) out.push(`Within ${filters.radius} mi`);
  return out;
}

export function FilterButton({
  filters,
  scope,
  matching,
  hasOrigin = false,
  onLocate,
}: {
  filters: FilterState;
  scope: FilterScope;
  /** Tee times left after filtering, for the sheet's done button. */
  matching: number;
  hasOrigin?: boolean;
  onLocate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = describeFilters(filters, scope).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={count ? `Filters (${count} on)` : "Filters"}
        className={`relative flex h-11 shrink-0 items-center gap-1.5 rounded-full pl-3.5 pr-4 text-[0.875rem] font-medium transition ${
          count ? "bg-crimson/15 text-text-1 ring-1 ring-crimson/40" : "bg-surface-2 text-text-1"
        } active:bg-surface-3`}
      >
        <SlidersIcon />
        Filters
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-crimson px-1 text-[0.625rem] font-bold text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <FilterSheet
          filters={filters}
          scope={scope}
          matching={matching}
          hasOrigin={hasOrigin}
          onLocate={onLocate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * What's applied, in one line, with a way out.
 *
 * With the chips gone, a filter set an hour ago is out of sight — and
 * "why are there only three courses?" is the question that follows. So
 * whatever is on is spelled out under the search box, only while
 * something is.
 */
export function ActiveFilters({
  filters,
  scope,
  className = "pt-2",
}: {
  filters: FilterState;
  scope: FilterScope;
  className?: string;
}) {
  const { set } = useSetParam();
  const labels = describeFilters(filters, scope);
  if (labels.length === 0) return null;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <p className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-2">{labels.join(" · ")}</p>
      <button
        onClick={() => set(Object.fromEntries(KEYS[scope].map((k) => [k, ""])))}
        className="-mr-2 h-9 shrink-0 px-2 text-[0.8125rem] font-medium text-crimson-bright"
      >
        Clear
      </button>
    </div>
  );
}

function FilterSheet({
  filters,
  scope,
  matching,
  hasOrigin,
  onLocate,
  onClose,
}: {
  filters: FilterState;
  scope: FilterScope;
  matching: number;
  hasOrigin: boolean;
  onLocate?: () => void;
  onClose: () => void;
}) {
  const { set } = useSetParam();
  const count = describeFilters(filters, scope).length;
  const list = scope === "list";

  return (
    <BottomSheet title="Filters" onClose={onClose}>
      <div className="flex flex-col gap-5 px-4 pt-4">
        {list && (
          <Options
            label="Show"
            value={filters.view}
            onChange={(v) => set({ view: v === "course" ? "" : v })}
            options={[
              ["course", "By course"],
              ["time", "By time"],
            ]}
          />
        )}
        {/* Only grouped by course: the time list is chronological by
            definition, so there is nothing to sort. */}
        {list && filters.view === "course" && (
          <Options
            label="Sort courses"
            value={filters.sort}
            onChange={(v) => {
              if (v === "distance" && !hasOrigin) onLocate?.();
              set({ sort: v === "distance" ? "" : v });
            }}
            options={[
              ["distance", "Nearest"],
              ["price", "Cheapest"],
            ]}
          />
        )}
        {list && (
          <Options
            label="Courses"
            value={filters.starred ? "1" : ""}
            onChange={(v) => set({ starred: v })}
            options={[
              ["", "All"],
              ["1", "★ Starred"],
            ]}
          />
        )}
        <Options
          label="Players"
          value={String(filters.players)}
          onChange={(v) => set({ players: v === "1" ? "" : v })}
          options={[
            ["1", "Any"],
            ["2", "2+"],
            ["3", "3+"],
            ["4", "4"],
          ]}
        />
        <Options
          label="Holes"
          value={filters.holes}
          onChange={(v) => set({ holes: v === "all" ? "" : v })}
          options={[
            ["all", "Any"],
            ["9", "9"],
            ["18", "18"],
          ]}
        />
        <Options
          label="Time of day"
          hint="Morning is before noon, evening from 5"
          value={filters.when}
          onChange={(v) => set({ when: v === "any" ? "" : v })}
          options={[
            ["any", "Any"],
            ["morning", "Morning"],
            ["midday", "Midday"],
            ["evening", "Evening"],
          ]}
        />
        <Options
          label="Price"
          value={filters.maxPrice == null ? "" : String(filters.maxPrice)}
          onChange={(v) => set({ maxPrice: v })}
          options={[
            ["", "Any"],
            ["25", "<$25"],
            ["40", "<$40"],
            ["60", "<$60"],
            ["100", "<$100"],
          ]}
        />
        {/* Measures from your location if shared, otherwise from a city
            picked in the search box. Without either there's no origin,
            so choosing a distance asks for one rather than silently
            doing nothing. A county search is its own boundary. */}
        {list && (
          <Options
            label="Distance"
            hint={
              filters.county
                ? `Showing all of ${filters.county} County`
                : hasOrigin
                  ? undefined
                  : "Asks for your location"
            }
            disabled={filters.county !== ""}
            value={filters.radius == null ? "" : String(filters.radius)}
            onChange={(v) => {
              if (v && !hasOrigin) onLocate?.();
              set({ radius: v });
            }}
            options={[
              ["", "Any"],
              ["10", "10 mi"],
              ["20", "20 mi"],
              ["30", "30 mi"],
              ["50", "50 mi"],
            ]}
          />
        )}

        {/* Pinned to the bottom of the sheet, so the count is in view
            while the options above it are being changed.

            The sheet has 2rem of bottom padding, and a sticky box stops
            short of its scroller's padding — at bottom: 0 this one hung
            2rem up with options scrolling past beneath it. So it sits
            that far lower, and the same amount comes off its margin so
            the end of the scroll doesn't leave a gap under it either. */}
        <div
          className="sticky -mx-4 flex gap-3 border-t border-line bg-surface-1 px-4 pt-3"
          style={{
            bottom: "calc(-2rem - env(safe-area-inset-bottom))",
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            marginBottom: "calc(-2rem - env(safe-area-inset-bottom))",
          }}
        >
          {count > 0 && (
            <button
              onClick={() => set(Object.fromEntries(KEYS[scope].map((k) => [k, ""])))}
              className="h-12 shrink-0 rounded-full bg-surface-2 px-5 text-[0.9375rem] font-medium text-text-1 active:bg-surface-3"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="h-12 flex-1 rounded-full bg-crimson text-[0.9375rem] font-semibold text-white active:opacity-90"
          >
            {/* Zero with nothing applied is the day, not the filters —
                late evening, or a date nothing's published for yet. */}
            {matching > 0
              ? `Show ${matching} tee time${matching === 1 ? "" : "s"}`
              : count > 0
                ? "No tee times match"
                : "Done"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * One filter as a row of equal segments, every option on show.
 *
 * Radios rather than a native select: the select opened an OS picker for
 * a choice of three or four, which is a tap to open, a tap to choose and
 * sometimes a tap to dismiss, where this is one.
 */
function Options({
  label,
  hint,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-40" : ""}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-text-3">{label}</h3>
        {hint && <p className="truncate text-[0.6875rem] text-text-3">{hint}</p>}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        // Equal segments while they fit. flex-1 with the default
        // min-width means a label that needs more than its share takes
        // it from the short ones, so "Morning" isn't cut to "Morni…" at
        // the largest text size just to keep "Any" as wide as it.
        className="flex gap-1 rounded-full bg-surface-2 p-1"
      >
        {options.map(([v, text]) => {
          const selected = v === value;
          return (
            <button
              key={v}
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={`h-10 flex-1 whitespace-nowrap rounded-full px-2 text-[0.875rem] font-medium transition-colors ${
                selected ? "bg-crimson text-white shadow-sm shadow-crimson/30" : "text-text-2 active:bg-surface-3"
              }`}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlidersIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 text-text-2">
      <path
        d="M3 6h8M15 6h2M3 14h2M9 14h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="13" cy="6" r="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <circle cx="7" cy="14" r="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
    </svg>
  );
}
