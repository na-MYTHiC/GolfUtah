"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { favoritesStore } from "@/lib/favorites";
import { getProfile } from "@/lib/course-profiles";
import { distanceMiles } from "@/lib/format";
import { CITIES, COUNTIES, findCity } from "@/lib/utah-places";
import { useGeolocation } from "../components/filters";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface CourseCard {
  name: string;
  slug: string;
  city: string;
  county: string;
  lat: number;
  lon: number;
  /** Whether the build managed to fetch a photo for this course. */
  hasPhoto: boolean;
}

/**
 * Browsing courses, as opposed to hunting for a time.
 *
 * This is where search lives now. On the times screen it earned its
 * place maybe one session in ten, while taking the space where times
 * should be — here it's the whole point, so it gets the room and the
 * layout that suits reading rather than scanning.
 *
 * Tiles rather than rows: choosing a course is a slower, more visual
 * decision than picking a time out of a list.
 */
export function CourseBrowser({ courses }: { courses: CourseCard[] }) {
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const { coords, locate } = useGeolocation();

  const favorites = useSyncExternalStore(
    favoritesStore.subscribe,
    favoritesStore.getSnapshot,
    favoritesStore.getServerSnapshot
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();

    // Searching a place name measures from there instead; searching a
    // county filters to it. Same rules as the times screen, so the two
    // don't behave differently for the same input.
    const city = findCity(needle);
    const county = COUNTIES.find((c) => c.toLowerCase() === needle);
    const origin = city ?? (coords ? { lat: coords.lat, lon: coords.lon } : null);

    return courses
      .map((course) => ({
        ...course,
        distance: origin
          ? distanceMiles(origin.lat, origin.lon, course.lat, course.lon)
          : undefined,
      }))
      .filter((course) => {
        if (starredOnly && !favorites.includes(course.slug)) return false;
        if (county) return course.county === county;
        if (!needle || city) return true;
        return `${course.name} ${course.city} ${course.county}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        // Starred first, then nearest, then alphabetical — each falls
        // back to the next when it can't decide.
        const fa = favorites.includes(a.slug) ? 0 : 1;
        const fb = favorites.includes(b.slug) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        return a.name.localeCompare(b.name);
      });
  }, [courses, query, starredOnly, favorites, coords]);

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 bg-surface-0/95 px-4 pb-2 pt-2 backdrop-blur-lg">
        <div className="relative">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
          >
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <path
              d="M13.5 13.5 17 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter dismisses the keyboard; the list is already live.
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Course, city or county"
            className="w-full rounded-full bg-surface-2 py-2 pl-9 pr-3 text-[15px] text-text-1 placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-crimson/50"
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex rounded-full bg-surface-2 p-0.5">
            {[
              ["All", false],
              ["Starred", true],
            ].map(([label, value]) => (
              <button
                key={String(label)}
                onClick={() => setStarredOnly(value as boolean)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  starredOnly === value ? "bg-surface-3 text-text-1" : "text-text-2"
                }`}
              >
                {label as string}
              </button>
            ))}
          </div>
          {!coords && (
            <button
              onClick={locate}
              className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-2 active:bg-surface-3"
            >
              Sort by distance
            </button>
          )}
          <span className="ml-auto text-[12px] text-text-3">{shown.length}</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-2">
          {starredOnly ? "No starred courses yet." : "No courses match that search."}
        </p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-2.5">
          {shown.map((course) => (
            <CourseTile
              key={course.slug}
              course={course}
              starred={favorites.includes(course.slug)}
            />
          ))}
        </ul>
      )}

      {/* Every Utah city is searchable, including ones with no course —
          people search from where they live, then look at what's near. */}
      <p className="mt-6 text-center text-[11px] text-text-3">
        Search any of {CITIES.length} Utah cities or {COUNTIES.length} counties
      </p>
    </>
  );
}

function CourseTile({
  course,
  starred,
}: {
  course: CourseCard & { distance?: number };
  starred: boolean;
}) {
  const profile = getProfile(course.slug);

  return (
    <li className="overflow-hidden rounded-2xl bg-surface-1 ring-1 ring-line">
      <a href={`${basePath}/course/${course.slug}/`} className="block">
        <Thumbnail
          slug={course.slug}
          name={course.name}
          hasPhoto={course.hasPhoto}
        />
        {/* Fixed height so tiles line up in a grid whether or not a
            course has a profile line — ragged rows read as broken. */}
        <div className="h-[5.25rem] px-3 pb-2.5 pt-2">
          <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-text-1">
            {course.name}
          </p>
          <p className="mt-1 truncate text-[11px] text-text-3">
            {course.distance != null
              ? `${course.distance.toFixed(0)} mi · ${course.city}`
              : course.city}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-2">
            {profile?.style
              ? `${profile.style}${profile.holes ? ` · ${profile.holes} holes` : ""}`
              : ""}
          </p>
        </div>
      </a>

      <div className="flex items-center justify-between border-t border-line px-3 py-1.5">
        <button
          onClick={() => favoritesStore.toggle(course.slug)}
          aria-label={starred ? "Remove from starred courses" : "Star this course"}
          aria-pressed={starred}
          className={`-m-1 p-1 text-sm ${starred ? "text-crimson-bright" : "text-text-3"}`}
        >
          {starred ? "★" : "☆"}
        </button>
        <a
          href={`${basePath}/course/${course.slug}/`}
          className="text-[12px] font-medium text-crimson-bright"
        >
          See times →
        </a>
      </div>
    </li>
  );
}

/**
 * A course photo when the build fetched one, and a lettered tile when it
 * didn't.
 *
 * Photos are downloaded at build time into /photos rather than linked
 * from Google's media endpoint, which takes the API key as a query
 * parameter and would publish it in the page source of a public site.
 *
 * Whether a photo exists is decided at build time too — see the comment
 * in page.tsx. An onError fallback looks like it should work and
 * doesn't: the image has already failed by the time a static export
 * hydrates.
 */
function Thumbnail({
  slug,
  name,
  hasPhoto,
}: {
  slug: string;
  name: string;
  hasPhoto: boolean;
}) {
  if (!hasPhoto) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-surface-2 to-surface-3">
        <span className="text-3xl font-bold text-text-3">{name.charAt(0)}</span>
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element --
       a static export has no image optimiser to route through, and these
       are already resized at build time. */
    <img
      src={`${basePath}/photos/${slug}.jpg`}
      alt=""
      loading="lazy"
      className="aspect-[4/3] w-full bg-surface-2 object-cover"
    />
  );
}
