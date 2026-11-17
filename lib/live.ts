/**
 * Tee times asked for from the phone, at the moment the page is open.
 *
 * Everything else in the app reads what the last build published, so it
 * is as old as that build. Two platforms let a browser on any site ask
 * them directly: MemberSports and TeeItUp answer with
 * `access-control-allow-origin: *` and allow the headers their own
 * widgets send (measured 16 Nov 2026, scripts/platform-probe.ts). That is
 * 15 of the app's courses. On their course pages the times are checked
 * live, and the published copy stays as the fallback if the check fails.
 *
 * ForeUp, Chronogolf and GolfPay send no such header, so a browser is not
 * allowed to read their answers. Those stay on the published data.
 */
import type { NormalizedTeeTime } from "./adapters/types";
import type { StaticSlot } from "./static-data";
import { memberSportsAdapter } from "./adapters/membersports";
import { teeItUpAdapter } from "./adapters/teeitup";

const ADAPTERS = {
  MEMBERSPORTS: memberSportsAdapter,
  TEEITUP: teeItUpAdapter,
} as const;

export function canCheckLive(platform: string): platform is keyof typeof ADAPTERS {
  return platform in ADAPTERS;
}

/** Same shape build-data.ts publishes, so the page treats both alike. */
function toSlot(t: NormalizedTeeTime): StaticSlot {
  return {
    time: t.time,
    holes: t.holes,
    spots: t.playersOpen,
    price: t.price ?? null,
    cart: t.cartFee,
    withCart: t.priceIncludesCart,
    rate: t.rateName,
    side: t.side,
    url: t.bookingUrl,
  };
}

/**
 * The course's times for the day, straight from its booking system, or
 * null when that can't be had right now.
 *
 * @param id The published course id, "<PLATFORM>:<externalId>".
 */
export async function fetchLiveSlots(
  platform: string,
  id: string,
  name: string,
  date: string
): Promise<StaticSlot[] | null> {
  if (!canCheckLive(platform)) return null;
  const externalId = id.slice(platform.length + 1);
  try {
    const times = await ADAPTERS[platform].fetchTeeTimes(
      { name, externalId, platform } as never,
      { from: date, to: date }
    );
    return times.map(toSlot).sort((a, b) => a.time.localeCompare(b.time) || a.holes - b.holes);
  } catch {
    return null;
  }
}
