import type { Slot } from "@/lib/tee-times";

/**
 * A course plus the day's slots, as the UI consumes it. The rendering
 * lives in results.tsx / tee-time-row.tsx — this is just the shape they
 * agree on.
 */
export interface CourseView {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  county: string;
  platform: string;
  bookingUrl: string;
  slots: Slot[];
  latitude: number | null;
  longitude: number | null;
  /** Filled in client-side once the visitor shares their location. */
  distanceMiles?: number;
  /** Listing may be missing times (ForeUp booking class not captured). */
  partial?: boolean;
  /** Slots the platform returned before filtering. */
  returned?: number;
  error?: string;
  weather?: {
    highF: number;
    lowF: number;
    maxPrecipChance: number;
    icon: string;
    label: string;
    /** Course-local "HH:mm", for the daylight check on late tee times. */
    sunset?: string;
  };
  slotWeather?: Record<string, { temperatureF: number; windMph: number; icon: string }>;
  rating?: { rating: number; reviewCount: number; mapsUrl?: string };
}
