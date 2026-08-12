import { Suspense } from "react";
import { RoundsList } from "./rounds-list";
import { AppHeader } from "../components/app-header";

export default function RoundsPage() {
  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-4">
        <AppHeader subtitle="Tee times you've opened" />
        <Suspense fallback={null}>
          <RoundsList />
        </Suspense>
      </main>
    </div>
  );
}
