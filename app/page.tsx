import { Suspense } from "react";
import { AppShell } from "./components/app-shell";
import { APP_VERSION } from "@/lib/version";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function Home() {
  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        <header className="mb-1 flex items-center justify-between">
          {/* Tapping the name clears every filter and returns to today —
              the usual way out of a search you've narrowed too far. */}
          <a
            href={basePath ? `${basePath}/` : "/"}
            className="text-[22px] font-bold tracking-tight text-text-1"
          >
            Golf<span className="text-crimson-bright">Utah</span>
          </a>
          {/* Which build you're on. A cached service worker can otherwise
              keep serving an old one silently. */}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-2">
            {APP_VERSION}
          </span>
        </header>

        <Suspense
          fallback={<p className="py-16 text-center text-sm text-text-3">Loading…</p>}
        >
          <AppShell />
        </Suspense>

        <footer className="mt-10 text-[11px] leading-relaxed text-text-3">
          <p>
            Times come from each course&apos;s own booking system and change by the minute —
            confirm on the course&apos;s page. Booking and payment happen there.
          </p>
          <p className="mt-1">Weather: Open-Meteo · Distances approximate</p>
        </footer>
      </main>
    </div>
  );
}
