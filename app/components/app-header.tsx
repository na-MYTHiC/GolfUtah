import { APP_VERSION } from "@/lib/version";
import { RoundsButton } from "./rounds-sheet";
import { TextSizeButton } from "./text-size";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The wordmark, the text size button and the rounds button.
 *
 * The build number tucks under the wordmark rather than sitting beside
 * it as a chip: it's there to answer "am I on the latest?" once in a
 * while, not to be read, and it was taking space the rounds button
 * wanted.
 */
export function AppHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex items-center justify-between gap-3 pb-3">
      <div className="min-w-0">
        {/* Tapping the name clears every filter and returns to today —
            the usual way out of a search narrowed too far. */}
        <a
          href={basePath ? `${basePath}/` : "/"}
          className="flex items-baseline gap-1.5 py-2 text-[1.375rem] font-bold leading-none tracking-tight text-text-1"
        >
          Golf<span className="-ml-1.5 text-crimson-bright">Utah</span>
          <span className="font-mono text-[0.5625rem] font-normal leading-none text-text-3">
            {APP_VERSION}
          </span>
        </a>
        {subtitle && <p className="mt-0.5 truncate text-[0.75rem] text-text-3">{subtitle}</p>}
      </div>
      {/* Full-height buttons a clear thumb's width apart. At 32px tall,
          8px from each other and 4px above the date tiles, a tap for Aa
          could land on Rounds or on Saturday. The header's pb-3 is the
          clearance downwards. */}
      <div className="flex shrink-0 items-center gap-3">
        <TextSizeButton />
        <RoundsButton />
      </div>
    </header>
  );
}
