"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable and lets it
 * open instantly from a phone's home screen.
 *
 * Skipped on localhost during development, where a caching worker mostly
 * serves stale builds and confuses debugging.
 *
 * WHY THE VERSION USED TO STICK. Everything here was already in place —
 * `updateViaCache: 'none'`, an update check, a reload when the new worker
 * takes over — and the app still sat on an old build for days. The check
 * ran in a `useEffect` with an empty dependency list, so it ran exactly
 * once per mount, and an installed PWA doesn't remount. Opened from the
 * home screen it is *resumed*: same document, same JavaScript, no
 * navigation, no fetch, nothing to notice a deploy with. The only thing
 * that ever triggered an update was a genuine cold start, which on a
 * phone can be days apart.
 *
 * So the check now also runs whenever the app comes back to the
 * foreground, which is what "opening the app" actually means once it's
 * installed. It's cheap — a conditional request that 304s unless sw.js
 * really changed.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

    // Captured before registering. With no controller yet this is a
    // first-ever install, where controllerchange fires as a normal part
    // of setup — reloading there is a pointless flash on someone's first
    // visit, not an update landing.
    //
    // Mutable on purpose. Holding it as a constant meant that after a
    // first install the flag stayed false for the life of the page, so
    // the guard against one harmless reload silently suppressed every
    // real update that followed in the same session.
    let controlled = Boolean(navigator.serviceWorker.controller);

    let onVisible: (() => void) | null = null;

    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: "none" })
      .then((registration) => {
        // Check on every load, so a redeploy is picked up rather than
        // waiting for the browser's own (slow) update heuristics.
        registration.update().catch(() => {});

        // A worker left waiting by an older build would otherwise sit
        // there forever, with the page reporting nothing and the update
        // never applying. Nothing should reach this now that install
        // skips waiting, which is exactly why it's worth handling.
        if (registration.waiting && navigator.serviceWorker.controller) {
          registration.waiting.postMessage({ type: "golfutah-skip-waiting" });
        }

        // The auto-check on open. See the note above: this, not the
        // mount, is what catches a deploy on an installed app.
        onVisible = () => {
          if (document.visibilityState === "visible") registration.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {
        // Registration failing costs offline support, nothing more.
      });

    // When a new worker takes over, reload once so the page isn't left
    // running the previous build's JavaScript. Filters live in the URL,
    // so a reload keeps the day, search and sort exactly as they were.
    let reloading = false;
    const onChange = () => {
      if (!controlled) {
        // The first install claiming this page. Nothing to reload for —
        // the page is already running the code that installed it — but
        // it is controlled from here on, so the next change is real.
        controlled = true;
        return;
      }
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
