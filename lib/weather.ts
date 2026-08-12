/**
 * Hourly forecast per course, from Open-Meteo.
 *
 * Chosen because it needs no API key — the app works out of the box
 * rather than degrading to a blank panel until someone signs up for
 * something. Free for non-commercial use; revisit if this ever gets
 * heavy traffic.
 *
 * Golf-relevant fields only: temperature, wind (which matters more to a
 * round than most weather apps suggest), and precipitation chance.
 */

const API = "https://api.open-meteo.com/v1/forecast";

/** Forecasts change slowly; no sense re-fetching per request. */
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface HourWeather {
  /** "HH:mm", course-local */
  time: string;
  temperatureF: number;
  windMph: number;
  precipChance: number; // 0-100
  weatherCode: number; // WMO code, see describeWeather()
}

export interface DayWeather {
  date: string; // YYYY-MM-DD
  hours: HourWeather[];
  highF: number;
  lowF: number;
  /** Chance of precipitation at any point during golfing hours. */
  maxPrecipChance: number;
  /**
   * Course-local "HH:mm". Sunset is the constraint no other filter
   * captures: a 6pm eighteen in October is four hours of golf and two
   * hours of daylight, and no amount of price or distance filtering
   * tells you that.
   */
  sunrise?: string;
  sunset?: string;
}

const cache = new Map<string, { at: number; value: DayWeather | null }>();

interface OpenMeteoResponse {
  hourly?: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
  };
  daily?: {
    sunrise?: string[];
    sunset?: string[];
  };
}

/**
 * WMO weather codes, condensed to what a golfer actually needs to decide.
 * https://open-meteo.com/en/docs — the full table is far more granular
 * than "should I bring a jacket".
 */
export function describeWeather(code: number): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: "☀️" };
  if (code <= 2) return { label: "Partly cloudy", icon: "⛅" };
  if (code === 3) return { label: "Overcast", icon: "☁️" };
  if (code <= 48) return { label: "Fog", icon: "🌫️" };
  if (code <= 57) return { label: "Drizzle", icon: "🌦️" };
  if (code <= 67) return { label: "Rain", icon: "🌧️" };
  if (code <= 77) return { label: "Snow", icon: "🌨️" };
  if (code <= 82) return { label: "Showers", icon: "🌧️" };
  if (code <= 86) return { label: "Snow showers", icon: "🌨️" };
  return { label: "Thunderstorm", icon: "⛈️" };
}

export async function getDayWeather(
  latitude: number,
  longitude: number,
  date: string
): Promise<DayWeather | null> {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)},${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
    daily: "sunrise,sunset",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "America/Denver",
    start_date: date,
    end_date: date,
  });

  try {
    const resp = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data: OpenMeteoResponse = await resp.json();
    if (!data.hourly?.time?.length) throw new Error("no hourly data");

    const hours: HourWeather[] = data.hourly.time.map((stamp, i) => ({
      time: stamp.slice(11, 16),
      temperatureF: Math.round(data.hourly!.temperature_2m[i]),
      windMph: Math.round(data.hourly!.wind_speed_10m[i]),
      precipChance: data.hourly!.precipitation_probability[i] ?? 0,
      weatherCode: data.hourly!.weather_code[i],
    }));

    // Daylight hours only — a 3am low tells a golfer nothing.
    const playable = hours.filter((h) => {
      const hour = Number(h.time.slice(0, 2));
      return hour >= 6 && hour <= 20;
    });
    const sample = playable.length > 0 ? playable : hours;

    const value: DayWeather = {
      date,
      hours,
      highF: Math.max(...sample.map((h) => h.temperatureF)),
      lowF: Math.min(...sample.map((h) => h.temperatureF)),
      maxPrecipChance: Math.max(...sample.map((h) => h.precipChance)),
      // Already course-local: the request pins timezone to America/Denver.
      sunrise: data.daily?.sunrise?.[0]?.slice(11, 16),
      sunset: data.daily?.sunset?.[0]?.slice(11, 16),
    };

    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    // Weather is a nice-to-have; a forecast outage shouldn't blank the
    // tee times. Cache the failure briefly so we don't retry per course.
    cache.set(key, { at: Date.now(), value: null });
    return null;
  }
}

/** The forecast hour closest to a "HH:mm" tee time. */
export function weatherAt(day: DayWeather | null, time: string): HourWeather | undefined {
  if (!day) return undefined;
  const target = Number(time.slice(0, 2));
  return day.hours.find((h) => Number(h.time.slice(0, 2)) === target);
}

/**
 * Roughly how long a round takes, in minutes. Deliberately optimistic
 * rather than average: the point is to flag rounds that clearly won't
 * finish, not to nag about ones that might just make it.
 */
const ROUND_MINUTES: Record<number, number> = { 9: 135, 18: 255 };

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Whether a round teeing off at this time finishes before dark, and by
 * how much.
 *
 * This is the check a golfer does in their head and an aggregator never
 * does for them — twilight rates look like a bargain right up until you
 * are putting out by phone light on fourteen.
 */
export function daylight(
  sunset: string | undefined,
  time: string,
  holes: number
): { finishesAt: string; minutesSpare: number; short: boolean } | null {
  if (!sunset) return null;
  const round = ROUND_MINUTES[holes];
  if (!round) return null;

  const end = toMinutes(time) + round;
  const minutesSpare = toMinutes(sunset) - end;

  const finishesAt = `${String(Math.floor((end % 1440) / 60)).padStart(2, "0")}:${String(
    end % 60
  ).padStart(2, "0")}`;

  // Play continues a while after sunset in usable light, so only a real
  // shortfall counts — otherwise every twilight tee time carries a
  // warning and the warning stops meaning anything.
  return { finishesAt, minutesSpare, short: minutesSpare < -20 };
}
