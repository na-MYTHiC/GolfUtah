import { APP_VERSION } from "@/lib/version";
import { RoundsButton } from "./rounds-sheet";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The wordmark and the rounds button.
 *
 * The build number tucks under the wordmark rather than sitting beside
 * it as a chip: it's there to answer "am I on the latest?" once in a
 * while, not to be read, and it was taking space the rounds button
 * wanted.
 */
export function AppHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        {/* Tapping the name clears every filter and returns to today —
            the usual way out of a search narrowed too far. */}
        <a
          href={basePath ? `${basePath}/` : "/"}
          className="flex items-baseline gap-1.5 text-[22px] font-bold leading-none tracking-tight text-text-1"
        >
          Golf<span className="-ml-1.5 text-crimson-bright">Utah</span>
          <span className="font-mono text-[9px] font-normal leading-none text-text-3">
            {APP_VERSION}
          </span>
        </a>
        {subtitle && <p className="mt-0.5 truncate text-[12px] text-text-3">{subtitle}</p>}
      </div>
      <RoundsButton />
    </header>
  );
}
