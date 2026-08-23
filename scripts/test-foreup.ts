/**
 * Checks the ForeUp parser, with no network.
 *
 * Written after a report that Valley View showed a time the course's own
 * site didn't have, and that its 9-hole sheet was missing entirely. Both
 * came from the same cause: a ForeUp course can have several tee sheets
 * (a 9-hole schedule and an 18-hole one are separate schedule ids, not
 * two views of one), and the adapter only ever read the seeded one — and
 * then built every booking link against that id, so a link could point
 * at a sheet the slot wasn't on.
 *
 *   npx tsx scripts/test-foreup.ts
 */

import { parseExternalId, toNormalized, foreUpBookingUrl } from "../lib/adapters/foreup";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** A response row, trimmed to what the adapter reads. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    time: "2026-08-25 07:10",
    course_id: 19501,
    course_name: "Valley View Golf Course",
    schedule_id: 1759,
    holes: 18,
    available_spots: 4,
    available_spots_9: 0,
    available_spots_18: 4,
    green_fee: 38,
    green_fee_9: 0,
    green_fee_18: 38,
    cart_fee: 16,
    cart_fee_9: 0,
    cart_fee_18: 16,
    teesheet_side_name: "Front",
    booking_class_id: 1208,
    ...over,
  } as Parameters<typeof toNormalized>[0];
}

function externalIds(): void {
  const one = parseExternalId("19501:1759:1208");
  check(
    "a single schedule still parses",
    one.scheduleId === 1759 && one.scheduleIds.length === 1 && one.bookingClassId === 1208,
    `scheduleIds=[${one.scheduleIds}]`
  );

  const many = parseExternalId("19501:1759,1760:1208");
  check(
    "a comma list gives every schedule",
    many.scheduleIds.join(",") === "1759,1760" && many.scheduleId === 1759,
    `scheduleIds=[${many.scheduleIds}], first=${many.scheduleId}`
  );

  const noClass = parseExternalId("19501:1759,1760");
  check(
    "the booking class stays optional alongside a list",
    noClass.scheduleIds.length === 2 && noClass.bookingClassId === undefined
  );

  let threw = false;
  try {
    parseExternalId("19501:1759,notanumber:1208");
  } catch {
    threw = true;
  }
  check("a bad id in the list is rejected rather than silently dropped", threw);
}

function bookingLinks(): void {
  // A row from the SECOND sheet, fetched while the seeded id is the first.
  const nine = toNormalized(
    row({ schedule_id: 1760, holes: 9, available_spots_9: 3, green_fee_9: 22, cart_fee_9: 10 }),
    { courseId: 19501, scheduleId: 1759, bookingClassId: 1208 },
    1760
  );

  check("a 9-hole row from the second sheet yields a slot", nine.length === 1, `${nine.length} slot(s)`);
  check(
    "its link points at the sheet the slot is actually on",
    nine[0]?.bookingUrl.includes("/19501/1760") && nine[0].bookingUrl.includes("schedule_id=1760"),
    nine[0]?.bookingUrl ?? "(none)"
  );
  check(
    "the link still carries the day, round and booking class",
    nine[0]?.bookingUrl.includes("date=08-25-2026") &&
      nine[0].bookingUrl.includes("holes=9") &&
      nine[0].bookingUrl.includes("booking_class_id=1208"),
    nine[0]?.bookingUrl ?? "(none)"
  );

  // The old behaviour, for contrast: without the row's own id this would
  // have linked to 1759 — a sheet with no 7:10 nine on it.
  const wrong = foreUpBookingUrl(19501, 1759, { date: "2026-08-25", holes: 9 });
  check("the seeded-id link is the one that used to be wrong", wrong.includes("/19501/1759"));
}

function bothRounds(): void {
  const both = toNormalized(
    row({ holes: "9/18", available_spots_9: 2, green_fee_9: 22, cart_fee_9: 10 }),
    { courseId: 19501, scheduleId: 1759, bookingClassId: 1208 },
    1759
  );
  check(
    "a 9/18 row still yields both rounds",
    both.length === 2 && both.some((s) => s.holes === 9) && both.some((s) => s.holes === 18),
    both.map((s) => `${s.holes}h`).join(" + ")
  );

  const soldOutNine = toNormalized(
    row({ holes: "9/18", available_spots_9: 0, green_fee_9: 22 }),
    { courseId: 19501, scheduleId: 1759 },
    1759
  );
  check(
    "a round with no spots is dropped rather than shown as bookable",
    soldOutNine.length === 1 && soldOutNine[0].holes === 18,
    soldOutNine.map((s) => `${s.holes}h`).join(" + ") || "(none)"
  );
}

function main(): void {
  externalIds();
  bookingLinks();
  bothRounds();

  console.log("");
  if (failures) {
    console.log(`${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("All ForeUp checks passed.");
  }
}

main();
