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
  // The uuids come from the club's own request. The numeric ids that also
  // appear in Chronogolf's response are not what the API is addressed by.
  // First uuid is "Riverbend back 9", second is the 18-hole "Riverbend".
  //
  // The other twelve Utah Chronogolf clubs — the Salt Lake City and Salt
  // Lake County municipals — are listed in CHRONOGOLF_PENDING in the
  // adapter, and land here as each one's request URL is captured.
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
];
