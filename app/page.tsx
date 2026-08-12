import { Suspense } from "react";
import { AppShell } from "./components/app-shell";

export default function Home() {
  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-4">
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
