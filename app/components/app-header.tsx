import { APP_VERSION } from "@/lib/version";
import { RoundsButton } from "./rounds-sheet";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The wordmark and build number, shared by every screen so they read as
 * one app rather than three pages that happen to be linked.
 */
export function AppHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="mb-1 flex items-center justify-between">
      <div className="min-w-0">
        {/* Tapping the name clears every filter and returns to today —
            the usual way out of a search narrowed too far. */}
        <a
          href={basePath ? `${basePath}/` : "/"}
          className="text-[22px] font-bold tracking-tight text-text-1"
        >
          Golf<span className="text-crimson-bright">Utah</span>
        </a>
        {subtitle && <p className="truncate text-[12px] text-text-3">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RoundsButton />
        {/* Which build you're on. A cached service worker can otherwise
            keep serving an old one silently. */}
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-2">
          {APP_VERSION}
        </span>
      </div>
    </header>
  );
}
