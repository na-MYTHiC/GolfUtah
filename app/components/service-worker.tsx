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
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      // Registration failing costs offline support, nothing more.
    });
  }, []);

  return null;
}
