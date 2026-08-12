/**
 * Checks the Chronogolf parser against the real Riverbend capture from
 * 2026-08-12 (10 slots, both of the club's courses).
 *
 * There's no network here on purpose: the point is that the mapping from
 * their fields to ours is right, which is where all three adapters have
 * gone wrong before. Run it after touching chronogolf.ts.
 *
 *   npx tsx scripts/test-chronogolf.ts
 */
import { __test, chronogolfAdapter, chronogolfBookingUrl } from "../lib/adapters/chronogolf";

const { toNormalized, padTime, parseExternalId, sideOf } = __test;

/**
 * Real slot uuids from the capture, for the rows where the paste showed
 * one. The 8:20 slot's uuid is the one that matters most: it also turned
 * up in a later capture's referer as `?step=options&teetime=<that uuid>`,
 * which is what proved the per-slot link format.
 */
const SLOT_UUIDS: Record<number, string> = {
  515670424: "82391ed2-6f10-490a-a26d-d81f5ac5b0af",
  515670427: "3308713a-a886-438a-9e1b-bf70e8d06d4a",
  515647573: "be63e987-83f2-4831-ba03-df01c7940792",
  515670434: "2092315e-f342-450c-9c57-a757c4b40253",
  515647593: "cae566bc-1253-43be-919e-6bd27ae0d6f3",
  515647610: "6451dd27-548c-4fa4-90f9-5f61c95c960e",
};

/** Verbatim from the capture, trimmed to the fields the adapter reads. */
const CAPTURE = {
  status: "open",
  teetimes: [
    row(515670424, 22961, "Riverbend back 9", 9, [9], "8:20", "2026-08-12T14:20:00Z", 1),
    row(515670427, 22961, "Riverbend back 9", 9, [9], "8:40", "2026-08-12T14:40:00Z", 1),
    row(515647573, 16307, "Riverbend", 18, [9, 18], "9:10", "2026-08-12T15:10:00Z", 1),
    row(515670434, 22961, "Riverbend back 9", 9, [9], "9:20", "2026-08-12T15:20:00Z", 1),
    row(515647593, 16307, "Riverbend", 18, [9, 18], "10:10", "2026-08-12T16:10:00Z", 2),
    row(515647610, 16307, "Riverbend", 18, [9, 18], "11:10", "2026-08-12T17:10:00Z", 1),
    row(515647640, 16307, "Riverbend", 18, [9, 18], "12:40", "2026-08-12T18:40:00Z", 1),
    row(515647651, 16307, "Riverbend", 18, [9, 18], "13:20", "2026-08-12T19:20:00Z", 1),
    row(515647654, 16307, "Riverbend", 18, [9, 18], "13:30", "2026-08-12T19:30:00Z", 1),
    row(515647727, 16307, "Riverbend", 18, [9, 18], "17:10", "2026-08-12T23:10:00Z", 1),
  ],
};

function row(
  id: number,
  courseId: number,
  courseName: string,
  holes: number,
  bookable: number[],
  startTime: string,
  startsAt: string,
  maxPlayers: number
) {
  return {
    id,
    uuid: SLOT_UUIDS[id] ?? `uuid-${id}`,
    course: {
      id: courseId,
      uuid: courseId === 22961 ? "8ceb87d6-…" : "a10735ef-…",
      name: courseName,
      holes,
      bookable_holes: bookable,
    },
    hole: 1,
    has_cart: false,
    min_player_size: 1,
    max_player_size: maxPlayers,
    starts_at: startsAt,
    start_time: startTime,
    date: "2026-08-12",
    has_deal: false,
    default_price: {
      green_fee: 21.0,
      half_cart: 10.0,
      one_person_cart: null,
      subtotal: 21.0,
      bookable_holes: 9,
      affiliation_type: "Regular",
    },
    format: "normal",
    frozen: false,
  };
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n         got      ${a}\n         expected ${e}`);
  }
}

const SLUG = "riverbend-slco";
const url = chronogolfBookingUrl(SLUG, "2026-08-12");
const slots = CAPTURE.teetimes.flatMap((t) => toNormalized(t as never, SLUG, url));

console.log("padTime");
check("unpadded hour", padTime("8:20"), "08:20");
check("already padded", padTime("13:20"), "13:20");
check("evening", padTime("17:10"), "17:10");
check("garbage", padTime("nope"), null);
// The reason padding exists at all: the app sorts and range-filters by
// comparing these strings.
check("sorts correctly", ["8:20", "13:20"].map(padTime).sort(), ["08:20", "13:20"]);

console.log("\nexternalId");
check("slug + two uuids", parseExternalId("riverbend-slco:aaa,bbb"), {
  slug: "riverbend-slco",
  courseIds: ["aaa", "bbb"],
});
check("single uuid", parseExternalId("x:aaa"), { slug: "x", courseIds: ["aaa"] });

console.log("\nside");
check("back nine course", sideOf("Riverbend back 9"), "Back");
check("main course", sideOf("Riverbend"), undefined);

console.log("\nmapping the capture");
// 3 back-nine slots (9 only) + 7 main-course slots (9 and 18) = 17 rows.
check("row count", slots.length, 17);
check("all on the captured date", new Set(slots.map((s) => s.date)).size, 1);

const first = slots[0];
check("first slot", first, {
  date: "2026-08-12",
  time: "08:20",
  holes: 9,
  playersOpen: 1,
  price: 2100,
  side: "Back",
  // Byte-for-byte the address a real browser sat on after picking this
  // exact slot, minus the ordering (URLSearchParams sorts nothing, so
  // insertion order is what's compared).
  bookingUrl:
    "https://www.chronogolf.com/club/riverbend-slco?date=2026-08-12&step=options" +
    "&teetime=82391ed2-6f10-490a-a26d-d81f5ac5b0af",
});

// The 10:10 slot is the only one on the sheet with two spots open.
const two = slots.filter((s) => s.playersOpen === 2);
check("slots with 2 open", two.map((s) => `${s.time}/${s.holes}`), ["10:10/9", "10:10/18"]);

// default_price is the 9-hole rate, so the 18-hole row goes out unpriced
// rather than carrying a made-up number.
const eighteen = slots.filter((s) => s.holes === 18);
check("18-hole rows", eighteen.length, 7);
check("18-hole rows unpriced", new Set(eighteen.map((s) => s.price)), new Set([undefined]));
check("9-hole rows all $21", new Set(slots.filter((s) => s.holes === 9).map((s) => s.price)), new Set([2100]));

// starts_at is 6 hours ahead of start_time (UTC vs MDT). If the adapter
// ever starts reading the wrong field, every time shifts by 6 hours —
// this is the assertion that catches it.
check("last slot is evening, not next morning", slots[slots.length - 1].time, "17:10");

console.log("\nfilters");
const drop = (patch: object) => toNormalized({ ...CAPTURE.teetimes[0], ...patch } as never, SLUG, url).length;
check("frozen dropped", drop({ frozen: true }), 0);
check("full slot dropped", drop({ max_player_size: 0 }), 0);
check("unparseable time dropped", drop({ start_time: "" }), 0);

console.log("\nbooking url");
check(
  "day sheet carries the date",
  url,
  "https://www.chronogolf.com/club/riverbend-slco?date=2026-08-12&step=teetimes&holes=&coursesIds=&deals=false&groupSize=0"
);
// Both rows of a 9-or-18 slot point at the same tee time — the holes
// choice happens on Chronogolf's options step, which is where this lands.
const nineAndEighteen = slots.filter((s) => s.time === "09:10");
check("9 and 18 rows share one slot link", new Set(nineAndEighteen.map((s) => s.bookingUrl)).size, 1);
check(
  "slot link uses the uuid, not the numeric id",
  nineAndEighteen[0].bookingUrl.includes("teetime=be63e987-83f2-4831-ba03-df01c7940792"),
  true
);
// A slot with no uuid still has to go somewhere useful.
const noUuid = toNormalized({ ...CAPTURE.teetimes[0], uuid: "" } as never, SLUG, url);
check("uuid-less slot falls back to the day sheet", noUuid[0].bookingUrl, url);

/**
 * The request and pagination loop, against a stubbed fetch. Riverbend's
 * sheet fit on one page (10 of 24), so nothing about paging was exercised
 * by the real capture — and a paging loop that miscounts either drops
 * half a course's times or spins forever.
 */
async function checkRequests() {
  console.log("\nrequests");
  const calls: string[] = [];
  const realFetch = globalThis.fetch;

  // 30 slots at 24 per page: page 1 full, page 2 short, then stop.
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    const count = page === 1 ? 24 : page === 2 ? 6 : 0;
    const teetimes = Array.from({ length: count }, (_, i) =>
      row(i, 16307, "Riverbend", 18, [18], "9:10", "2026-08-12T15:10:00Z", 1)
    );
    return {
      ok: true,
      headers: new Headers({ total: "30", "per-page": "24" }),
      json: async () => ({ status: "open", teetimes }),
    };
  }) as typeof globalThis.fetch;

  try {
    const slots = await chronogolfAdapter.fetchTeeTimes(
      {
        name: "Riverbend",
        externalId: "riverbend-slco:aaa,bbb",
        platform: "CHRONOGOLF",
      } as never,
      { from: "2026-08-12", to: "2026-08-13" }
    );

    check("two days, two pages each", calls.length, 4);
    check("all 30 slots per day kept", slots.length, 60);

    const first = new URL(calls[0]);
    check("endpoint", `${first.origin}${first.pathname}`, "https://www.chronogolf.com/marketplace/v2/teetimes");
    check("start_date", first.searchParams.get("start_date"), "2026-08-12");
    check("course_ids joined", first.searchParams.get("course_ids"), "aaa,bbb");
    check("holes", first.searchParams.get("holes"), "9,18");
    check("commas encoded as %2C, like the capture", first.search.includes("%2C"), true);
    check("second day requested", new URL(calls[2]).searchParams.get("start_date"), "2026-08-13");
    check("pages walked in order", calls.map((c) => new URL(c).searchParams.get("page")), [
      "1",
      "2",
      "1",
      "2",
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }

  // A `total` that overstates what's actually sent must not spin.
  const spinCalls: string[] = [];
  globalThis.fetch = (async (input: string) => {
    spinCalls.push(String(input));
    return {
      ok: true,
      headers: new Headers({ total: "9999", "per-page": "24" }),
      json: async () => ({ status: "open", teetimes: [] }),
    };
  }) as typeof globalThis.fetch;

  try {
    await chronogolfAdapter.fetchTeeTimes(
      { name: "x", externalId: "x:aaa", platform: "CHRONOGOLF" } as never,
      { from: "2026-08-12", to: "2026-08-12" }
    );
    check("empty page stops the loop", spinCalls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
}

checkRequests().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
});
