/**
 * Browser-side loading of the JSON that scripts/build-data.ts baked into
 * the site at deploy time.
 */

export interface StaticSlot {
  time: string;
  holes: number;
  spots: number;
  price: number | null;
  /** "Front" / "Back" when the platform reports it. */
  side?: string;
  url: string;
}

export interface StaticCourse {
  id: string;
  name: string;
  city: string;
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

export async function loadDay(date: string): Promise<DayFile | null> {
  try {
    const resp = await fetch(assetPath(`/data/${date}.json`), { cache: "no-store" });
    if (!resp.ok) return null;
    return (await resp.json()) as DayFile;
  } catch {
    return null;
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
