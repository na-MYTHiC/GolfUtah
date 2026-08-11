"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable and lets it
 * open instantly from a phone's home screen.
 *
 * Skipped on localhost during development, where a caching worker mostly
 * serves stale builds and confuses debugging.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: "none" })
      .then((registration) => {
        // Check on every load, so a redeploy is picked up rather than
        // waiting for the browser's own (slow) update heuristics.
        registration.update().catch(() => {});
      })
      .catch(() => {
        // Registration failing costs offline support, nothing more.
      });

    // When a new worker takes over, reload once so the page isn't left
    // running the previous build's JavaScript.
    let reloading = false;
    const onChange = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);

  return null;
}
