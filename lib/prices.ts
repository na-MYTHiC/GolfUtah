"use client";

/**
 * Price context, shared by everything that wants it.
 *
 * One small file (`data/prices.json`) answers a question the app
 * couldn't otherwise answer at all, because it needs to see across days
 * and the app only ever loads one: which day this week is cheapest, so
 * the date strip can say so rather than making you tap through ten tabs
 * and remember.
 *
 * Fetched once per page load and shared, rather than prop-drilled from
 * the shell through two separate component trees — the date strip is
 * used on both the list and a course page, and neither has a natural
 * path from the loader.
 */

import { useEffect, useState } from "react";
import { loadPriceSummary, type PriceSummary } from "./static-data";

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

/*
 * There was a dealAgainstTypical() here, which turned the per-course
 * median into a "usually $52" line under a cheap price. Removed with the
 * line it fed — nothing else called it.
 *
 * The medians themselves stay in data/prices.json and stay useful: the
 * date strip reads them to mark the cheapest day of the week, which is
 * the other question a single day's data can't answer.
 */
