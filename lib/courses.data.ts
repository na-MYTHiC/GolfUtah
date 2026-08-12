/**
 * The canonical list of courses GolfUtah knows about.
 *
 * Lives here rather than in prisma/seed.ts so it can serve two callers:
 * the seeder, and the no-database fallback in lib/tee-times.ts that lets
 * the app run without Postgres.
 *
 * externalId formats:
 *   MemberSports  "<golfClubId>:<golfCourseId>"
 *   ForeUp        "<courseId>:<scheduleId>:<bookingClassId>" — the
 *                 booking class is optional but should be captured:
 *                 without it ForeUp can return only part of the tee
 *                 sheet. Only Sun Hills has one so far, so the other
 *                 ForeUp courses here may be showing incomplete times.
 *   Chronogolf    "<clubSlug>:<courseUuid>[,<courseUuid>...]" — a club
 *                 can publish several courses on one sheet (Riverbend
 *                 lists its back nine separately) and its own widget asks
 *                 for all of them at once, so this is a list.
 *
 * Coordinates are city-level approximations — accurate enough to sort
 * courses by distance and to pull a local forecast, not to navigate by.
 * Refine them per course as real ones turn up.
 */

export type PlatformName = "FOREUP" | "CHRONOGOLF" | "MEMBERSPORTS";

export interface CourseSeed {
  name: string;
  /** URL-safe id for the course's own page. */
  slug: string;
  city: string;
  county: string;
  platform: PlatformName;
  externalId: string;
  bookingUrl: string;
  latitude: number;
  longitude: number;
}

export const COURSES: CourseSeed[] = [
  // --- Chronogolf ---
  // Every Utah Chronogolf club, resolved by scripts/chronogolf-discover.ts
  // reading course_ids out of each club's own widget traffic. The uuids
  // are what the API is addressed by; the numeric ids that also appear in
  // Chronogolf's response are not.
  //
  // Several clubs publish more than one course on a single sheet — a back
  // nine, an opposite nine, a par 3, or a genuinely separate course like
  // Mountain Dell's Lake and Canyon — so most of these carry several
  // uuids. That's one GolfUtah course showing everything the club sells,
  // which is how a golfer thinks about it.
  //
  // Slugs follow no pattern: the same city runs "mountain-dell-golf-club"
  // and "glendale-golf-course", and the county uses a "-slco" suffix. All
  // of these were resolved, not guessed.
  {
    name: "Riverbend Golf Course",
    slug: "riverbend-golf-course",
    county: "Salt Lake",
    city: "Riverton",
    platform: "CHRONOGOLF",
    externalId:
      "riverbend-slco:8ceb87d6-0afb-4361-a633-1b1d3f6e5805,a10735ef-5ac1-4ad1-b5e8-8721c344a1ac",
    bookingUrl:
      "https://slco.org/parks-recreation/facilities-and-golf/golf/riverbend-golf-course/",
    latitude: 40.522,
    longitude: -111.924,
  },
  {
    name: "Mountain Dell Golf Course",
    slug: "mountain-dell-golf-course",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    // Lake and Canyon are two full 18s up Parleys Canyon; the third uuid
    // had no times the day this was captured, so its name is unknown.
    externalId:
      "mountain-dell-golf-club:2c162b65-6803-4bad-9a21-4c1ca88bb242,77dca1a2-edae-47d2-a202-a1e9391cc305,bd6e3c42-7ae5-4d97-b6d0-60ebf9957a7e",
    bookingUrl: "https://slc-golf.com/mountaindell/",
    latitude: 40.755,
    longitude: -111.665,
  },
  {
    name: "Bonneville Golf Course",
    slug: "bonneville-golf-course",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    externalId:
      "bonneville-golf-course:bc27ab7a-6218-4b61-9aa8-0838f7c44ce3,caa8142a-4a42-482b-8d35-4239ce26f7b0",
    bookingUrl: "https://slc-golf.com/bonneville/",
    latitude: 40.75,
    longitude: -111.834,
  },
  {
    name: "Forest Dale Golf Course",
    slug: "forest-dale-golf-course",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    externalId: "forest-dale-golf-course:41ea25ca-ffcb-4f14-a86d-de0ef84510e0",
    bookingUrl: "https://slc-golf.com/forestdale/",
    latitude: 40.72,
    longitude: -111.867,
  },
  {
    name: "Glendale Golf Course",
    slug: "glendale-golf-course",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    externalId:
      "glendale-golf-course:547936f8-0f45-4bea-b557-d15a4de485ad,4984e272-06a5-446a-8e24-8402e3591b7c",
    bookingUrl: "https://slc-golf.com/glendale/",
    latitude: 40.725,
    longitude: -111.936,
  },
  {
    name: "Nibley Park Golf Course",
    slug: "nibley-park-golf-course",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    externalId: "nibley-park-golf-course:997cd01f-4ce8-4462-a459-594762efb606",
    bookingUrl: "https://slc-golf.com/nibleypark/",
    latitude: 40.712,
    longitude: -111.873,
  },
  {
    name: "Rose Park Golf Course",
    slug: "rose-park-golf-course",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    externalId:
      "rose-park-golf-course:19a5558e-3821-4935-b6bd-0cbc99693d91,f899015b-2109-4028-8640-d670ada581e4",
    bookingUrl: "https://slc-golf.com/rosepark/",
    latitude: 40.797,
    longitude: -111.939,
  },
  {
    name: "University of Utah Golf Club",
    slug: "university-of-utah-golf-club",
    county: "Salt Lake",
    city: "Salt Lake City",
    platform: "CHRONOGOLF",
    externalId: "university-of-utah-golf-club:59546da1-0c26-419c-9621-c1974cf59d5b",
    // The only one of these without a course website on file, so this
    // points at its booking page rather than at a guessed address.
    bookingUrl: "https://www.chronogolf.com/club/university-of-utah-golf-club",
    latitude: 40.766,
    longitude: -111.836,
  },
  {
    name: "Meadow Brook Golf Course",
    slug: "meadow-brook-golf-course",
    county: "Salt Lake",
    city: "Taylorsville",
    platform: "CHRONOGOLF",
    externalId: "meadow-brook-slco:c3155ad4-2f72-4b4d-80ec-a3b3c08a89db",
    bookingUrl:
      "https://slco.org/parks-recreation/facilities-and-golf/golf/meadow-brook-golf-course/",
    latitude: 40.687,
    longitude: -111.926,
  },
  {
    name: "Mick Riley Golf Course",
    slug: "mick-riley-golf-course",
    county: "Salt Lake",
    city: "Murray",
    platform: "CHRONOGOLF",
    // A regulation nine and a par 3, both bookable here.
    externalId:
      "mick-riley-slco:2c99f9f7-e373-47d5-8b16-dd15f332fe57,b6cf292e-8323-426d-828e-f3e55a112b8f",
    bookingUrl:
      "https://slco.org/parks-recreation/facilities-and-golf/golf/mick-riley-golf-course/",
    latitude: 40.652,
    longitude: -111.869,
  },
  {
    name: "Mountain View Golf Course",
    slug: "mountain-view-golf-course",
    county: "Salt Lake",
    city: "West Jordan",
    platform: "CHRONOGOLF",
    externalId:
      "mountain-view-slco:bd12a75f-50ad-4ca8-8d18-520e40b22551,3b6d3bcf-4af4-4deb-a715-acce88244790",
    bookingUrl:
      "https://slco.org/parks-recreation/facilities-and-golf/golf/mountain-view-golf-course/",
    latitude: 40.598,
    longitude: -112.01,
  },
  {
    name: "Old Mill Golf Course",
    slug: "old-mill-golf-course",
    county: "Salt Lake",
    city: "Holladay",
    platform: "CHRONOGOLF",
    externalId:
      "old-mill-slco:51eb43b1-d054-46e6-9dc6-dba30a6f9906,dd49962c-d6a9-4150-a701-9e547902e664",
    bookingUrl:
      "https://slco.org/parks-recreation/facilities-and-golf/golf/old-mill-golf-course/",
    latitude: 40.632,
    longitude: -111.797,
  },
  {
    name: "South Mountain Golf Course",
    slug: "south-mountain-golf-course",
    county: "Salt Lake",
    city: "Draper",
    platform: "CHRONOGOLF",
    externalId:
      "south-mountain-slco:bc4c00f2-435a-4f4a-8d0a-c807d5f515f0,6b9948eb-a045-4692-9579-7c827c195edd,9bb16c41-88fe-4f36-a84c-39f74f8aa5f2",
    bookingUrl: "https://slco.org/parks-recreation/facilities-and-golf/golf/south-mountain/",
    latitude: 40.508,
    longitude: -111.844,
  },
  {
    name: "River Oaks Golf",
    slug: "river-oaks-golf",
    county: "Salt Lake",
    city: "Sandy",
    platform: "CHRONOGOLF",
    // An 18 plus an "Opposite 9", which is the same ground played from
    // the other set of tees.
    externalId:
      "river-oaks-golf-course-utah:79c03256-be52-4e3d-aba8-9c64df6e12b2,026599af-6569-4b0f-aaf9-aefedc607e3c",
    bookingUrl: "https://sandy.utah.gov/1174/River-Oaks-Golf",
    latitude: 40.585,
    longitude: -111.887,
  },

  // --- MemberSports ---
  {
    name: "Eaglewood Golf Course",
    slug: "eaglewood-golf-course",
    county: "Davis",
    city: "North Salt Lake",
    platform: "MEMBERSPORTS",
    externalId: "15391:18901",
    bookingUrl: "https://eaglewoodgolf.com/",
    latitude: 40.848,
    longitude: -111.907,
  },
  {
    name: "Cedar Hills Golf Club",
    slug: "cedar-hills-golf-club",
    county: "Utah",
    city: "Cedar Hills",
    platform: "MEMBERSPORTS",
    externalId: "15381:18891",
    bookingUrl: "https://cedarhillsgolfutah.com/",
    latitude: 40.414,
    longitude: -111.755,
  },
  {
    name: "Fore Lakes Golf Course",
    slug: "fore-lakes-golf-course",
    county: "Salt Lake",
    city: "Taylorsville",
    platform: "MEMBERSPORTS",
    externalId: "15394:18905",
    bookingUrl: "https://www.forelakesgc.com/",
    latitude: 40.668,
    longitude: -111.939,
  },
  {
    name: "Fox Hollow Golf Club",
    slug: "fox-hollow-golf-club",
    county: "Utah",
    city: "American Fork",
    platform: "MEMBERSPORTS",
    externalId: "15396:18907",
    bookingUrl: "https://www.foxhollowutah.com/",
    latitude: 40.377,
    longitude: -111.796,
  },
  {
    name: "Hobble Creek Golf Course",
    slug: "hobble-creek-golf-course",
    county: "Utah",
    city: "Springville",
    platform: "MEMBERSPORTS",
    externalId: "15404:18918",
    bookingUrl: "https://www.springville.org/golf/",
    latitude: 40.151,
    longitude: -111.549,
  },

  // --- ForeUp ---
  {
    name: "Sun Hills Golf Course",
    slug: "sun-hills-golf-course",
    county: "Davis",
    city: "Layton",
    platform: "FOREUP",
    // ":177" is the "Regular" booking class from the course's own page.
    // Without it the tee sheet comes back truncated — see foreup.ts.
    externalId: "18895:578:177",
    bookingUrl: "https://www.sunhillsgolf.com/",
    latitude: 41.06,
    longitude: -111.971,
  },
  {
    name: "Murray Parkway Golf Course",
    slug: "murray-parkway-golf-course",
    county: "Salt Lake",
    city: "Murray",
    platform: "FOREUP",
    externalId: "6263:244",
    bookingUrl: "https://parkwaygolf.org/",
    latitude: 40.65,
    longitude: -111.92,
  },
  {
    name: "Timpanogos Golf Club",
    slug: "timpanogos-golf-club",
    county: "Utah",
    city: "Provo",
    platform: "FOREUP",
    externalId: "6279:49",
    bookingUrl: "https://www.timpanogosgolf.com/",
    latitude: 40.234,
    longitude: -111.659,
  },
  {
    name: "Links at Sleepy Ridge",
    slug: "links-at-sleepy-ridge",
    county: "Utah",
    city: "Orem",
    platform: "FOREUP",
    externalId: "19396:1726",
    bookingUrl: "https://www.sleepyridgegolf.com/",
    latitude: 40.281,
    longitude: -111.733,
  },
  {
    name: "Thanksgiving Point Golf Club",
    slug: "thanksgiving-point-golf-club",
    county: "Utah",
    city: "Lehi",
    platform: "FOREUP",
    externalId: "19645:2034",
    bookingUrl: "https://www.thanksgivingpointgolfclub.com/",
    latitude: 40.391,
    longitude: -111.851,
  },
  {
    name: "The Oaks at Spanish Fork",
    slug: "the-oaks-at-spanish-fork",
    county: "Utah",
    city: "Spanish Fork",
    platform: "FOREUP",
    externalId: "21698:8633",
    bookingUrl: "https://www.theoaksatsf.com/",
    latitude: 40.115,
    longitude: -111.655,
  },
  {
    name: "Davis Park Golf Course",
    slug: "davis-park-golf-course",
    county: "Davis",
    city: "Kaysville",
    platform: "FOREUP",
    externalId: "19500:1757",
    bookingUrl: "https://www.davisparkutah.com/",
    latitude: 41.035,
    longitude: -111.938,
  },
  {
    name: "Glen Eagle Golf Course",
    slug: "glen-eagle-golf-course",
    county: "Davis",
    city: "Syracuse",
    platform: "FOREUP",
    externalId: "20940:6276",
    bookingUrl: "https://golfgleneagle.com/",
    latitude: 41.089,
    longitude: -112.065,
  },
  {
    name: "Wolf Creek Resort Golf Course",
    slug: "wolf-creek-resort-golf-course",
    county: "Weber",
    city: "Eden",
    platform: "FOREUP",
    externalId: "18945:756",
    bookingUrl: "https://wolfcreekresort.com/golf/",
    latitude: 41.3,
    longitude: -111.83,
  },
  {
    name: "Eagle Mountain Golf Club",
    slug: "eagle-mountain-golf-club",
    county: "Box Elder",
    city: "Brigham City",
    platform: "FOREUP",
    externalId: "19943:3033",
    bookingUrl: "https://eaglemountaingc.com/",
    latitude: 41.51,
    longitude: -112.015,
  },
  {
    name: "Carbon Country Club",
    slug: "carbon-country-club",
    county: "Carbon",
    city: "Helper",
    platform: "FOREUP",
    externalId: "22113:9906",
    bookingUrl: "https://www.carboncountryclub.com/",
    latitude: 39.684,
    longitude: -110.856,
  },
  {
    name: "Millsite Golf Course",
    slug: "millsite-golf-course",
    county: "Emery",
    city: "Ferron",
    platform: "FOREUP",
    externalId: "21605:8326",
    bookingUrl: "https://millsitegolfcourse.com/",
    latitude: 39.093,
    longitude: -111.132,
  },
  {
    name: "Stonebridge Golf Club",
    slug: "stonebridge-golf-club",
    county: "Salt Lake",
    city: "West Valley City",
    platform: "FOREUP",
    externalId: "22130:9912",
    bookingUrl: "https://www.golfstonebridgeutah.com/",
    latitude: 40.692,
    longitude: -112.001,
  },
  // The Ridge is its own ForeUp install (22131), separate from
  // neighbouring Stonebridge (22130) despite looking related. Its booking
  // page lands on #/login, so this schedule_id came from the signed-in tee
  // sheet — availability may not be readable without a session.
  {
    name: "The Ridge Golf Club",
    slug: "the-ridge-golf-club",
    county: "Salt Lake",
    city: "West Valley City",
    platform: "FOREUP",
    externalId: "22131:9898",
    bookingUrl: "https://www.golftheridgegc.com/",
    latitude: 40.688,
    longitude: -112.03,
  },
  {
    name: "Bountiful Ridge Golf Course",
    slug: "bountiful-ridge-golf-course",
    county: "Davis",
    city: "Bountiful",
    platform: "FOREUP",
    externalId: "18950:674",
    bookingUrl: "https://bountifulridgegolf.com/",
    latitude: 40.868,
    longitude: -111.845,
  },
];
