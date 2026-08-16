/**
 * Works out whether a GolfPay adapter can be written, and what its
 * responses look like.
 *
 * A capture from The Barn gave the request but not the reply:
 *
 *   GET https://golfpay.co/api/tee-times
 *     ?date=08/16/2026&course_id=1466&tsid=20
 *     &source=&price_class_id=&number_of_holes=9
 *
 * Two things have to be true before an adapter is worth writing, and
 * neither is knowable from the request alone.
 *
 * 1. THE SESSION HAS TO BE OBTAINABLE HEADLESSLY. GolfPay is Laravel,
 *    and the capture carries a `laravel_session` cookie, an `XSRF-TOKEN`
 *    cookie and an `X-CSRF-TOKEN` header that has to match. A token
 *    lifted from someone's browser is useless in CI — the build has to
 *    be able to get its own, which means the course page must hand one
 *    over to a plain fetch. If it doesn't, GolfPay needs a browser on
 *    every refresh, which is a different and much more expensive
 *    adapter.
 *
 * 2. THE RESPONSE HAS TO CARRY WHAT THE APP NEEDS. Time, holes, price,
 *    spots open, and something to build a booking link from. Guessing a
 *    shape and writing a parser against it is how you get an adapter
 *    that silently returns nothing.
 *
 * So this asks, rather than assumes:
 *
 *   npm run golfpay:probe
 *   npm run golfpay:probe -- --course 1466 --tsid 20 --holes 18
 *   npm run golfpay:probe -- --slug the-barn-golf-club-ogden-ut-84414
 *
 * Writes the full response to golfpay-probe.json and prints enough of it
 * to see the shape. Needs a machine that can reach golfpay.co.
 */

import { writeFileSync } from "node:fs";

const SITE = "https://golfpay.co";
const API = `${SITE}/api/tee-times`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** GolfPay wants MM/DD/YYYY, encoded. */
function golfpayDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

interface Session {
  cookie: string;
  csrf?: string;
}

/**
 * A session and CSRF token from the course page, the way a browser gets
 * them.
 *
 * Laravel puts the token in a `<meta name="csrf-token">` tag and mirrors
 * it into an XSRF-TOKEN cookie. The meta tag is the one to read: the
 * cookie value is encrypted and the header wants the plain token.
 */
async function openSession(slug: string): Promise<Session | null> {
  const url = `${SITE}/course/${slug}`;
  try {
    const resp = await fetch(url, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
      signal: AbortSignal.timeout(25_000),
    });
    console.log(`course page: HTTP ${resp.status}`);
    if (!resp.ok) return null;

    const cookies = resp.headers.getSetCookie?.().map((c) => c.split(";")[0]).filter(Boolean);
    const html = await resp.text();

    const meta =
      /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i.exec(html);

    if (!cookies?.length) {
      console.log("  no cookies issued — a plain fetch can't hold a session here");
      return null;
    }
    console.log(`  cookies: ${cookies.map((c) => c.split("=")[0]).join(", ")}`);
    console.log(`  csrf-token meta tag: ${meta ? "found" : "NOT FOUND"}`);

    return { cookie: cookies.join("; "), csrf: meta?.[1] };
  } catch (err) {
    console.log(`course page failed: ${(err as Error).message}`);
    return null;
  }
}

async function probe(
  courseId: string,
  tsid: string,
  holes: string,
  daysAhead: number,
  session: Session | null
): Promise<unknown> {
  const params = new URLSearchParams({
    date: golfpayDate(daysAhead),
    course_id: courseId,
    tsid,
    source: "",
    price_class_id: "",
    number_of_holes: holes,
  });

  const resp = await fetch(`${API}?${params}`, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "user-agent": UA,
      "x-requested-with": "XMLHttpRequest",
      ...(session?.cookie ? { cookie: session.cookie } : {}),
      ...(session?.csrf ? { "x-csrf-token": session.csrf } : {}),
    },
    signal: AbortSignal.timeout(25_000),
  });

  const body = await resp.text();
  console.log(
    `tee-times (holes=${holes}, +${daysAhead}d, ${session ? "with session" : "cold"}): ` +
      `HTTP ${resp.status}, ${body.length} bytes`
  );

  // 419 is Laravel's "page expired" — a CSRF failure, not a missing course.
  if (resp.status === 419) console.log("  -> 419: the CSRF token wasn't accepted");
  if (!resp.ok) return null;

  try {
    return JSON.parse(body);
  } catch {
    console.log(`  -> not JSON. First 200 chars: ${body.slice(0, 200)}`);
    return null;
  }
}

/** Prints the shape without dumping a whole tee sheet. */
function describe(value: unknown, depth = 0): void {
  const pad = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    console.log(`${pad}array of ${value.length}`);
    if (value.length) describe(value[0], depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const kind = Array.isArray(v)
        ? `array(${v.length})`
        : v && typeof v === "object"
          ? "object"
          : `${typeof v} = ${JSON.stringify(v)?.slice(0, 60)}`;
      console.log(`${pad}${k}: ${kind}`);
      if (Array.isArray(v) && v.length) describe(v[0], depth + 1);
      else if (v && typeof v === "object") describe(v, depth + 1);
    }
  }
}

/**
 * Aggregates across every row, because the first one settles nothing.
 *
 * The Barn's first 9-hole slot is a 6:30pm at $1.00 with
 * is_online_block true — which could mean the course sells a dollar
 * twilight, or that the row isn't bookable at all and its prices are
 * placeholders. One row can't tell you, and an adapter that guesses
 * wrong either hides a course's whole sheet or advertises $1 golf.
 *
 * Three questions this answers:
 *   - do prices vary, or is every row $1?
 *   - does max_allowed_golfers vary? It is the only candidate for
 *     "spots left" anywhere in the response; there is no explicit count.
 *   - what does is_online_block actually track?
 */
function summarise(body: unknown): void {
  const times = (body as { data?: { times?: Record<string, unknown>[] } })?.data?.times;
  if (!Array.isArray(times) || times.length === 0) return;

  const tally = (key: string) => {
    const counts = new Map<string, number>();
    for (const t of times) {
      const v = JSON.stringify(t[key]);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([v, n]) => `${v}x${n}`)
      .join("  ");
  };

  console.log(`\n  --- across all ${times.length} rows ---`);

  // Distinct times, sorted — array order turned out to mean nothing:
  // row 0 and row 44 were both 18:30, so "first and last" said only that
  // the response isn't in time order.
  const slots = [...new Set(times.map((t) => String(t.local_tee_time)))].sort();
  console.log(`  ${slots.length} distinct tee times: ${slots[0]} .. ${slots[slots.length - 1]}`);
  console.log(`  rows per time: ${(times.length / slots.length).toFixed(1)} on average`);

  // Every row for one time. This is what decides whether cart-included
  // and walking are separate rows for the same slot — and so whether the
  // adapter should merge them into one price plus a cart fee, which is
  // the shape the rest of the app expects.
  const sample = slots[Math.floor(slots.length / 2)];
  const atSample = times.filter((t) => t.local_tee_time === sample);
  console.log(`\n  all ${atSample.length} row(s) at ${sample}:`);
  for (const r of atSample) {
    console.log(
      `    holes=${r.number_of_holes} cart=${r.is_cart_included} ` +
        `price=${r.regular_price_formatted} green=${r.regular_golfer_green_fee} ` +
        `cartfee=${r.regular_golfer_cart_fee} max=${r.max_allowed_golfers} ` +
        `block=${r.is_online_block}`
    );
  }
  console.log("");
  for (const key of [
    "number_of_holes",
    "min_allowed_golfers",
    "max_allowed_golfers",
    "is_online_block",
    "is_cart_included",
    "regular_price_formatted",
    "booking_golfer_price_formatted",
  ]) {
    console.log(`  ${key}: ${tally(key)}`);
  }

  // Does is_online_block line up with the $1 rows? If every blocked row
  // is $1 and no open row is, the flag is the filter and the price is a
  // placeholder.
  const blocked = times.filter((t) => t.is_online_block === true);
  const open = times.filter((t) => t.is_online_block !== true);
  const priced = (rows: Record<string, unknown>[]) =>
    [...new Set(rows.map((r) => String(r.regular_price_formatted)))].slice(0, 6).join(", ") || "none";
  console.log(`  is_online_block=true  (${blocked.length} rows): prices ${priced(blocked)}`);
  console.log(`  is_online_block=false (${open.length} rows): prices ${priced(open)}`);

  // The per-slot booking link, decoded — this is what a golfer would be
  // handed, so it matters whether it names the slot or just the course.
  const url = (times[0].actions as { createBookingUrl?: string } | undefined)?.createBookingUrl;
  if (url) {
    console.log(`\n  createBookingUrl (row 0):`);
    const raw = /bookingParams=([^&]+)/.exec(url)?.[1];
    if (raw) {
      try {
        console.log(`    decoded bookingParams: ${decodeURIComponent(raw)}`);
      } catch {
        console.log(`    ${url.slice(0, 140)}`);
      }
    } else {
      console.log(`    ${url.slice(0, 140)}`);
    }
  }
}

async function main() {
  const slug = arg("slug", "the-barn-golf-club-ogden-ut-84414");
  const courseId = arg("course", "1466");
  const tsid = arg("tsid", "20");
  const holes = arg("holes", "");

  console.log(`GolfPay probe — course ${courseId}, tsid ${tsid}, slug ${slug}\n`);

  // Cold first. If it answers, the adapter never needs a session at all,
  // which is much the better outcome.
  const cold = await probe(courseId, tsid, holes || "9", 1, null);
  if (cold) {
    console.log("\nAnswers cold — no session needed. That's the cheap adapter.\n");
  }

  const session = cold ? null : await openSession(slug);
  if (!cold && !session) {
    console.log("\nNo session, no cold answer. GolfPay would need a browser per refresh.");
    return;
  }

  const results: Record<string, unknown> = {};
  for (const h of holes ? [holes] : ["9", "18"]) {
    const body = cold ? await probe(courseId, tsid, h, 1, null) : await probe(courseId, tsid, h, 1, session);
    if (body) results[`holes_${h}`] = body;
  }

  if (Object.keys(results).length === 0) {
    console.log("\nNothing came back. Paste the response from DevTools instead.");
    return;
  }

  writeFileSync("golfpay-probe.json", JSON.stringify(results, null, 2));
  console.log("\nWrote golfpay-probe.json\n");
  console.log("Response shape:");
  for (const [key, body] of Object.entries(results)) {
    console.log(`\n${key}:`);
    describe(body);
    summarise(body);
  }
}

main().catch((err) => {
  console.error("golfpay:probe failed:", err);
  process.exitCode = 1;
});
