"use client";

import { usePathname } from "next/navigation";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The app's three destinations, fixed to the bottom of the screen.
 *
 * Replaces a chip row that was growing every time something was added.
 * Three thumb-reachable tabs is the right shape for something opened
 * one-handed in a car park.
 *
 * There's deliberately no settings tab. Nothing needs one yet — location
 * and starred courses are handled where they're used — and an empty tab
 * makes an app feel unfinished. It goes in when something has to live in
 * it.
 */
const TABS = [
  { href: "/", label: "Times", icon: TimesIcon },
  { href: "/courses/", label: "Courses", icon: SearchIcon },
  { href: "/rounds/", label: "Rounds", icon: TeeIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  // A course page belongs to Courses, so the tab stays lit while you're
  // reading one rather than leaving nothing selected.
  const active = (href: string) => {
    const path = pathname.replace(basePath, "") || "/";
    if (href === "/") return path === "/";
    if (href === "/courses/") return path.startsWith("/courses") || path.startsWith("/course/");
    return path.startsWith(href);
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-0/95 backdrop-blur-lg"
      // Clears the iPhone home indicator without a hardcoded guess.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const on = active(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <a
                href={`${basePath}${tab.href}`}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition ${
                  on ? "text-crimson-bright" : "text-text-3"
                }`}
              >
                <Icon />
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A clock, for the day's tee sheet. */
function TimesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[22px] w-[22px]" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 7v5l3.5 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[22px] w-[22px]" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A ball on a tee, for rounds. */
function TeeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[22px] w-[22px]" fill="none">
      <circle cx="12" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8.5 14.5h7L12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
