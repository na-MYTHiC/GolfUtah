"use client";

/**
 * Price context, shared by everything that wants it.
 *
 * One small file (`data/prices.json`) answers two questions the app
 * couldn't previously answer at all, because both need to see across
 * days and the app only ever loads one:
 *
 *   - which day this week is cheapest, so the date strip can say so
 *     rather than making you tap through ten tabs and remember
 *   - whether a given price is good *for that course at that time of
 *     day*, which is the one thing a course's own booking page will
 *     never tell you
 *
 * Fetched once per page load and shared, rather than prop-drilled from
 * the shell through two separate component trees — the date strip is
 * used on both the list and a course page, and neither has a natural
 * path from the loader.
 */

import { useEffect, useState } from "react";
import { loadPriceSummary, priceBand, type PriceSummary } from "./static-data";

/**
 * Module-level so a second caller joins the first request instead of
 * making its own. Not a cache with a TTL: the file is small, the page
 * is reloaded to get fresh data anyway, and a stale-but-consistent
 * baseline is better than two components disagreeing about it.
 */
let pending: Promise<PriceSummary | null> | null = null;

export function usePriceSummary(): PriceSummary | null {
  const [summary, setSummary] = useState<PriceSummary | null>(null);

  useEffect(() => {
    let live = true;
    pending ??= loadPriceSummary();
    pending.then((s) => {
      if (live) setSummary(s);
    });
    return () => {
      live = false;
    };
  }, []);

  return summary;
}

/**
 * How this price compares with what the course usually charges at this
 * time of day, or null when there's nothing worth saying.
 *
 * DELIBERATELY ONE-SIDED. It reports bargains and stays quiet about
 * everything else. A badge on an ordinary price is noise on almost every
 * row, and "this is expensive" is a judgement about a course's pricing
 * that this app has no business making from a ten-day median — a course
 * can be dear because it's better. A cheap slot, on the other hand, is
 * information you can act on in the next few minutes.
 *
 * @param minDiscount Below this it isn't news. Green fees move a few
 * dollars between rate classes all the time; 15% is roughly the point
 * where it's a different decision rather than rounding.
 */
export function dealAgainstTypical(
  summary: PriceSummary | null,
  courseSlug: string,
  time: string,
  price: number | null,
  minDiscount = 0.15
): { median: number; percentOff: number } | null {
  if (!summary || price == null || price <= 0) return null;

  const typical = summary.typical[courseSlug]?.[priceBand(time)];
  if (!typical) return null;

  const off = (typical.median - price) / typical.median;
  if (off < minDiscount) return null;

  return { median: typical.median, percentOff: Math.round(off * 100) };
}
