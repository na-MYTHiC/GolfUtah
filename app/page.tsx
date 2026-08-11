import { Suspense } from "react";
import { AppShell } from "./components/app-shell";
import { buildLabel } from "@/lib/version";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              GolfUtah
            </h1>
            {/* Which build you're actually looking at. A cached service
                worker can otherwise keep serving an old one silently. */}
            <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {buildLabel()}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            Every Utah tee time worth playing, in one place.
          </p>
        </header>

        <Suspense
          fallback={<p className="py-10 text-center text-sm text-zinc-500">Loading…</p>}
        >
          <AppShell />
        </Suspense>

        <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          <p>
            Availability comes from each course&apos;s own booking system and can change within
            minutes. Booking and payment happen on the course&apos;s page; GolfUtah never handles
            payment details.
          </p>
          <p className="mt-1">
            Weather from Open-Meteo. Distances are approximate, from city-level coordinates.
          </p>
        </footer>
      </main>
    </div>
  );
}
