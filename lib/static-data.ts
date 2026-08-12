/**
 * Browser-side loading of the JSON that scripts/build-data.ts baked into
 * the site at deploy time.
 */

export interface StaticSlot {
  time: string;
  holes: number;
  spots: number;
  price: number | null;
  /** Cart per player in cents, quoted separately from the green fee. */
  cart?: number;
  /** True when `price` already includes a cart. */
  withCart?: boolean;
  /** Rate class the price belongs to. */
  rate?: string;
  /** Only set in week mode, where slots from many days are merged. */
  date?: string;
  /** "Front" / "Back" when the platform reports it. */
  side?: string;
  url: string;
}

export interface StaticCourse {
  id: string;
  name: string;
  slug: string;
  city: string;
  county: string;
  platform: string;
  bookingUrl: string;
  lat: number;
  lon: number;
  rating?: { rating: number; reviewCount: number; mapsUrl?: string };
  slots: StaticSlot[];
  error?: string;
  /** Listing may be missing times — see build-data.ts. */
  partial?: boolean;
  /** Slots the platform returned before filtering. */
  returned?: number;
}

export interface DayFile {
  date: string;
  generatedAt: string;
  courses: StaticCourse[];
}

/** Pages serves the site from /<repo>/, so asset paths need the prefix. */
export function assetPath(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}${path}`;
}

/**
 * @param bust Adds a unique query so nothing between here and the origin
 * can answer from a cache — the HTTP cache, the service worker, or a CDN
 * edge. `cache: "no-store"` alone doesn't reliably get past a service
 * worker, and this is used on the screen someone books from.
 */
export async function loadDay(date: string, bust = false): Promise<DayFile | null> {
  try {
    const url = assetPath(`/data/${date}.json`) + (bust ? `?t=${Date.now()}` : "");
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return null;
    return (await resp.json()) as DayFile;
  } catch {
    return null;
  }
}

/**
 * Ratings and reviews, keyed by course slug. Separate from the day files
 * because they're the same for every day and review text is bulky.
 * Absent entirely when no Places key was configured at build time.
 */
export interface CourseInfo {
  rating: number;
  reviewCount: number;
  mapsUrl?: string;
  summary?: string;
  reviews?: { rating: number; text: string; author: string; when: string }[];
}

export async function loadCourseInfo(): Promise<Record<string, CourseInfo>> {
  try {
    const resp = await fetch(assetPath("/data/courses.json"), { cache: "no-store" });
    if (!resp.ok) return {};
    const file = (await resp.json()) as { generatedAt?: string; courses?: Record<string, CourseInfo> };
    return file.courses ?? {};
  } catch {
    return {};
  }
}

export interface DataIndex {
  dates: string[];
  generatedAt: string;
  courseCount: number;
}

export async function loadIndex(): Promise<DataIndex | null> {
  try {
    const resp = await fetch(assetPath("/data/index.json"), { cache: "no-store" });
    if (!resp.ok) return null;
    return (await resp.json()) as DataIndex;
  } catch {
    return null;
  }
}
