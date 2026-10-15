"use client";

import { useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { DENSITIES, densityStore, type Density } from "@/lib/density";
import { BottomSheet } from "./sheet";
import { TeeTimeRow, type Booking } from "./tee-time-row";

/**
 * The text size button and the sheet it opens.
 *
 * In the header next to Rounds because it's a setting someone changes
 * once and then forgets, and the header is the one thing on every
 * screen of the list. An "Aa" rather than a gear: there is exactly one
 * setting behind it, and it should say which.
 */
export function TextSizeButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Text size"
        className="flex items-center rounded-full bg-surface-2 px-3 py-1.5 text-[0.8125rem] font-semibold text-text-1 active:bg-surface-3"
      >
        <span aria-hidden>
          A<span className="text-[0.6875rem]">a</span>
        </span>
      </button>

      {open && <TextSizeSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** A real row at the size being chosen, so nobody has to guess. */
const PREVIEW: Booking = {
  id: "preview",
  time: "08:10",
  holes: 18,
  playersOpen: 4,
  price: 4500,
  cart: 1500,
  bookingUrl: "#",
  courseName: "Bonneville Golf Course",
  courseSlug: "preview",
  courseCity: "Salt Lake City",
  distanceMiles: 4,
};

function TextSizeSheet({ onClose }: { onClose: () => void }) {
  const current = useSyncExternalStore(
    densityStore.subscribe,
    densityStore.getSnapshot,
    densityStore.getServerSnapshot
  );

  return (
    <BottomSheet title="Text size" subtitle="Scales the whole app — text, spacing and buttons" onClose={onClose}>
      <div className="px-4 pt-4">
        <div role="radiogroup" aria-label="Text size" className="grid grid-cols-3 gap-2">
          {DENSITIES.map((d, i) => {
            const selected = d.id === current;
            return (
              <button
                key={d.id}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(d.id)}
                className={`flex flex-col items-center gap-1 rounded-2xl px-2 pb-2.5 pt-2 transition-colors ${
                  selected
                    ? "bg-crimson text-white shadow-sm shadow-crimson/30"
                    : "bg-surface-2 text-text-2 active:bg-surface-3"
                }`}
              >
                {/* A fixed-height box with the glyph sat on its floor, so
                    the three labels line up even though the glyphs grow. */}
                <span aria-hidden className="flex h-9 items-end font-semibold leading-none">
                  <span style={{ fontSize: `${[1, 1.3, 1.65][i]}rem` }}>Aa</span>
                </span>
                <span className="text-[0.8125rem] font-medium">{d.label}</span>
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-5 text-[0.6875rem] font-semibold uppercase tracking-wider text-text-3">
          Preview
        </p>
        {/* Inert, not just aria-hidden: the row is a real link, and a
            hidden link that can still be tabbed to is worse than either. */}
        <ul inert>
          <TeeTimeRow booking={PREVIEW} players={1} />
        </ul>
      </div>
    </BottomSheet>
  );
}

/**
 * Switch sizes without the page lurching.
 *
 * Changing the root size reflows everything at once, and two things go
 * wrong if it just happens. The whole screen snaps from one layout to the
 * next in a single frame. And your place in the list moves, because every
 * row above it just got taller or shorter — scroll halfway down the list,
 * pick Spacious, and you'd be looking at different courses.
 *
 * So: crossfade between the two layouts where the browser can, and pin
 * whatever was in the middle of the screen to where it was.
 */
function choose(next: Density) {
  // Taken now, at the tap, and not inside the transition below. While a
  // view transition runs its update, the browser's own overlay covers
  // the page, so hit-testing from in there finds the overlay instead of
  // the list. The first version did exactly that, found nothing, and
  // never corrected the scroll at all — measured: scrollY sat at 1400
  // either side of the switch while a different row slid in underneath.
  // Reading the anchor's position afterwards is layout, not hit-testing,
  // so that half works fine from inside.
  const place = notePlace();

  const swap = () => {
    // Flushed so the new selection is already drawn when the transition
    // takes its "after" picture — otherwise it fades to the old one.
    flushSync(() => densityStore.set(next));
    restorePlace(place);
  };

  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  if (!calm && typeof doc.startViewTransition === "function") {
    doc.startViewTransition(swap);
  } else {
    swap();
  }
}

interface Place {
  anchor: Element;
  top: number;
}

/**
 * What's in the middle of the screen right now, and where.
 *
 * Looks *through* the open sheet: its backdrop covers the whole viewport,
 * so the topmost element at any point is the overlay, not the list
 * someone is trying to keep their place in.
 */
function notePlace(): Place | null {
  const anchor = document
    .elementsFromPoint(window.innerWidth / 2, window.innerHeight * 0.4)
    .find(
      (el) =>
        !el.closest("[data-sheet]") && el !== document.body && el !== document.documentElement
    );
  return anchor ? { anchor, top: anchor.getBoundingClientRect().top } : null;
}

/** Scroll so that element is back where it was before the size changed. */
function restorePlace(place: Place | null) {
  if (!place?.anchor.isConnected) return;
  const drift = place.anchor.getBoundingClientRect().top - place.top;
  if (drift) window.scrollBy(0, drift);
}
