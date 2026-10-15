/**
 * How large the whole app draws: compact, standard or spacious.
 *
 * One number, applied at the root. Every size in the app is in rem —
 * Tailwind's spacing scale, its type scale, and every arbitrary value,
 * which were converted from px for exactly this — so changing the root
 * font size scales text, padding, gaps, radii, icons and tap targets
 * together. That is what keeps it cohesive: a setting that only enlarged
 * the text would leave it crammed into rows sized for the small version.
 *
 * Set as a percentage rather than a pixel size, so it multiplies the
 * browser's own default instead of replacing it. Someone who already
 * raised the text size in their browser keeps that, and this adds to it.
 *
 * Not CSS `zoom`. Zoom scales the rendered box after layout, which bends
 * position:fixed, viewport units and hit-testing in ways that differ by
 * browser. A root font size goes through layout like any other change,
 * so the sticky header, the sheets and the safe-area padding all just
 * reflow.
 */

export type Density = "compact" | "standard" | "spacious";

export const DENSITIES: readonly { id: Density; label: string; scale: number }[] = [
  // Smallest text in the app is the AM/PM under each time, at 10px on
  // standard. 90% puts it at 9px, which is as small as it should go.
  { id: "compact", label: "Compact", scale: 0.9 },
  { id: "standard", label: "Standard", scale: 1 },
  // For the people who find it too small, which is who asked. A clear
  // step up — roughly one notch of browser zoom — while the busiest row
  // still fits a 360px phone. Checked by screenshot at 360 and 390.
  { id: "spacious", label: "Spacious", scale: 1.15 },
];

const KEY = "golfutah:density";

function isDensity(value: unknown): value is Density {
  return DENSITIES.some((d) => d.id === value);
}

function read(): Density {
  try {
    const raw = localStorage.getItem(KEY);
    return isDensity(raw) ? raw : "standard";
  } catch {
    // Private mode, or storage disabled: the app still works, at standard.
    return "standard";
  }
}

/**
 * Percentages for every level but standard, which needs nothing set.
 *
 * Rounded, because 1.15 * 100 is 114.99999999999999 in floating point —
 * harmless to the browser, but it put that string on every page.
 */
const ROOT_SIZES: Record<string, string> = Object.fromEntries(
  DENSITIES.filter((d) => d.scale !== 1).map((d) => [d.id, `${+(d.scale * 100).toFixed(2)}%`])
);

/**
 * Puts a density on the page.
 *
 * Standard removes both rather than writing 100%, so the default page is
 * byte-for-byte the page it was before this setting existed.
 */
export function applyDensity(density: Density): void {
  const root = document.documentElement;
  const size = ROOT_SIZES[density];
  if (size) {
    root.dataset.density = density;
    root.style.fontSize = size;
  } else {
    delete root.dataset.density;
    root.style.removeProperty("font-size");
  }
}

/**
 * The same as applyDensity, as an inline script for <head>.
 *
 * Has to run before the first paint. Applying it from React would mean
 * the page draws at standard and then visibly jumps once hydration
 * catches up — on every launch, for everyone who chose a size. Built
 * from DENSITIES so it can never disagree with the table above.
 */
export const DENSITY_BOOT_SCRIPT =
  `try{var d=localStorage.getItem(${JSON.stringify(KEY)}),` +
  `s=${JSON.stringify(ROOT_SIZES)}[d];` +
  `if(s){var r=document.documentElement;r.dataset.density=d;r.style.fontSize=s}}catch(e){}`;

/**
 * External store, in the same shape as favourites and rounds, so the
 * picker re-renders when the choice changes — here or in another tab.
 */
const listeners = new Set<() => void>();

export const densityStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    // Another tab changed it: follow, so two open tabs never disagree.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      applyDensity(read());
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },

  getSnapshot: read,

  getServerSnapshot(): Density {
    return "standard";
  },

  set(density: Density) {
    try {
      if (density === "standard") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, density);
    } catch {
      // Not persisted, but still applied for this visit.
    }
    applyDensity(density);
    listeners.forEach((listener) => listener());
  },
};
