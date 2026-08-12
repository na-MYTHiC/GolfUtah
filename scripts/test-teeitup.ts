/**
 * Checks the TeeItUp parser against the real capture from 2026-08-12
 * (two facilities, five slots between them).
 *
 * The timezone assertions are the point. TeeItUp sends UTC and no local
 * time at all, so unlike the other adapters there's no local field to
 * prefer — the conversion has to be right, and a sign error would move
 * every tee time by twelve hours.
 *
 *   npx tsx scripts/test-teeitup.ts
 */
import { __test, toLocalDateTime, teeItUpBookingUrl } from "../lib/adapters/teeitup";

const { toNormalized, parseExternalId } = __test;

function rate(id: number, greenFeeCart: number, holes = 18, allowed = [1, 2, 3, 4]) {
  return {
    _id: id,
    name: "Non-Utah Resident",
    externalId: String(id),
    allowedPlayers: allowed,
    holes,
    greenFeeCart,
    transactionFees: 0,
  };
}

/** Verbatim from the capture, trimmed to the fields the adapter reads. */
const CAPTURE = [
  {
    courseId: "5e209e580b4f950100421b7d",
    totalAvailableTeetimes: 1,
    teetimes: [
      {
        courseId: "5e209e580b4f950100421b7d",
        teetime: "2026-08-16T20:48:00.000Z",
        backNine: false,
        rates: [rate(213720791, 8500, 18, [1])],
        bookedPlayers: 3,
        minPlayers: 1,
        maxPlayers: 1,
      },
    ],
  },
  {
    courseId: "5e20827c6312b90100616f93",
    totalAvailableTeetimes: 4,
    teetimes: [
      {
        courseId: "5e20827c6312b90100616f93",
        teetime: "2026-08-16T20:24:00.000Z",
        backNine: false,
        rates: [rate(213704906, 8500, 18, [1])],
        bookedPlayers: 3,
        minPlayers: 1,
        maxPlayers: 1,
      },
      {
        courseId: "5e20827c6312b90100616f93",
        teetime: "2026-08-16T23:24:00.000Z",
        backNine: false,
        rates: [rate(213704735, 8500)],
        bookedPlayers: 0,
        minPlayers: 1,
        maxPlayers: 4,
      },
      {
        courseId: "5e20827c6312b90100616f93",
        teetime: "2026-08-16T23:36:00.000Z",
        backNine: false,
        rates: [rate(213704720, 8500)],
        bookedPlayers: 0,
        minPlayers: 1,
        maxPlayers: 4,
      },
      {
        courseId: "5e20827c6312b90100616f93",
        teetime: "2026-08-16T23:48:00.000Z",
        backNine: false,
        rates: [rate(213704719, 8500)],
        bookedPlayers: 0,
        minPlayers: 1,
        maxPlayers: 4,
      },
    ],
  },
];

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

const url = teeItUpBookingUrl("aspira-management-company", "2026-08-16");
const slots = CAPTURE.flatMap((f) => f.teetimes.flatMap((t) => toNormalized(t as never, url)));

console.log("timezone");
// The response's own dayInfo is the cross-check: it reports sunrise at
// 12:38Z and sunset at 02:21Z (next day) for August 16. Those are 6:38am
// and 8:21pm Mountain — correct for Utah in August, and only correct if
// the offset runs this direction.
check("sunrise 12:38Z is 06:38 local", toLocalDateTime("2026-08-16T12:38:00.000Z")?.time, "06:38");
check("sunset 02:21Z is 20:21 local the day before", toLocalDateTime("2026-08-17T02:21:00.000Z"), {
  date: "2026-08-16",
  time: "20:21",
});
check("afternoon slot", toLocalDateTime("2026-08-16T20:24:00.000Z"), {
  date: "2026-08-16",
  time: "14:24",
});
// A late-UTC slot belongs to the previous local day. Reading the date off
// the UTC string instead would file it a day late.
check("23:48Z is still the 16th locally", toLocalDateTime("2026-08-16T23:48:00.000Z"), {
  date: "2026-08-16",
  time: "17:48",
});
// Standard time is a different offset; the app publishes ten days out
// and will cross the boundary every autumn.
check("MST (winter) is -7, not -6", toLocalDateTime("2026-12-16T20:24:00.000Z")?.time, "13:24");
check("garbage", toLocalDateTime("nope"), null);

console.log("\nexternalId");
check("alias + two facilities", parseExternalId("aspira-management-company:17070,17067"), {
  alias: "aspira-management-company",
  facilityIds: ["17070", "17067"],
});
check("single facility", parseExternalId("x:1"), { alias: "x", facilityIds: ["1"] });

console.log("\nmapping the capture");
check("row count", slots.length, 5);
check("all on the requested local date", new Set(slots.map((s) => s.date)), new Set(["2026-08-16"]));
check(
  "times in local order",
  slots.map((s) => s.time),
  ["14:48", "14:24", "17:24", "17:36", "17:48"]
);

check("first slot", slots[0], {
  date: "2026-08-16",
  time: "14:48",
  holes: 18,
  playersOpen: 1,
  // greenFeeCart is already cents: 8500 is $85, not $8,500.
  price: 8500,
  side: "Front",
  bookingUrl: url,
});

// maxPlayers is what's left, not capacity — every row has
// bookedPlayers + maxPlayers === 4.
check(
  "open spots track bookedPlayers",
  slots.map((s) => s.playersOpen),
  [1, 1, 4, 4, 4]
);

console.log("\nfilters and edges");
const one = CAPTURE[1].teetimes[1];
const drop = (patch: object) => toNormalized({ ...one, ...patch } as never, url).length;
check("full slot dropped", drop({ maxPlayers: 0 }), 0);
check("unparseable time dropped", drop({ teetime: "nope" }), 0);
check("no rates means no row", drop({ rates: [] }), 0);

// A slot sold at several rates is one tee time, not several — it
// collapses to the cheapest per round length.
const multi = toNormalized(
  { ...one, rates: [rate(1, 8500), rate(2, 4500), rate(3, 3000, 9)] } as never,
  url
);
check("one row per round length", multi.length, 2);
check(
  "cheapest rate wins",
  multi.map((s) => `${s.holes}h/${s.price}`),
  ["18h/4500", "9h/3000"]
);

const back = toNormalized({ ...one, backNine: true } as never, url);
check("back nine labelled", back[0].side, "Back");

console.log("\nbooking url");
check("carries the date", url, "https://aspira-management-company.book-v2.teeitup.golf/?date=2026-08-16");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
