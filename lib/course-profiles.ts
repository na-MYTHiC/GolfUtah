/**
 * What a course is actually like to play — the part a star rating can't
 * tell you.
 *
 * Reviews answer "did people enjoy it". They're poor at the questions a
 * golfer asks when choosing between two open tee times: how hard is it,
 * does it walk, is it flat or up a canyon, how long. Those are facts,
 * not opinions, so they live here rather than being inferred from
 * someone's four stars.
 *
 * SOURCES AND HONESTY
 *
 * These are curated from public course information — scorecards, course
 * and municipal websites. Fields are optional on purpose and left out
 * when not known: an absent yardage renders as nothing, while a guessed
 * one is a number a golfer might plan around. Nothing here is invented
 * to fill a gap.
 *
 * `slope` in particular should be verified against the course's own
 * scorecard or the USGA's course rating database before being trusted —
 * it's the one number that genuinely quantifies difficulty (113 is
 * average; 130+ is a hard day), which is exactly why it shouldn't be
 * approximated.
 *
 * Green speed was asked for and is deliberately absent: stimpmeter
 * readings aren't published by municipal courses and change day to day
 * with mowing and weather, so any number here would be fiction.
 */

export type CourseStyle =
  | "Parkland"
  | "Mountain"
  | "Links"
  | "Desert"
  | "Executive"
  | "Par 3";

export interface CourseProfile {
  /** Matches CourseSeed.slug. */
  slug: string;
  holes?: number;
  par?: number;
  /** Back tees, in yards. */
  yardage?: number;
  /** USGA slope from the back tees. 113 is average. */
  slope?: number;
  /** USGA course rating from the back tees. */
  rating?: number;
  style?: CourseStyle;
  /** Terrain, in the sense that decides whether you take a cart. */
  walkable?: "Easy" | "Moderate" | "Strenuous";
  designer?: string;
  opened?: number;
  /** One or two sentences on what the round is like. */
  notes?: string;
}

/**
 * Populated where the information is well established. Courses missing
 * from this list simply show their Google rating and nothing else, which
 * is the correct behaviour — a profile is added when it's known, not
 * when a slot needs filling.
 */
export const COURSE_PROFILES: CourseProfile[] = [
  {
    slug: "mountain-dell-golf-course",
    holes: 36,
    style: "Mountain",
    walkable: "Strenuous",
    notes:
      "Two full eighteens up Parleys Canyon — Lake and Canyon. Tree-lined, " +
      "significant elevation change, and noticeably cooler than the valley " +
      "on a summer afternoon. Ball flies further at 5,800 feet.",
  },
  {
    slug: "bonneville-golf-course",
    holes: 18,
    par: 72,
    style: "Parkland",
    walkable: "Moderate",
    opened: 1929,
    notes:
      "Classic hillside parkland on the east bench, mature trees and " +
      "sloping lies. One of the older municipal courses in the state.",
  },
  {
    slug: "glendale-golf-course",
    holes: 18,
    par: 72,
    style: "Parkland",
    walkable: "Easy",
    notes: "Flat riverside parkland on the west side. Wide and forgiving, and easy to walk.",
  },
  {
    slug: "rose-park-golf-course",
    holes: 18,
    par: 72,
    style: "Parkland",
    walkable: "Easy",
    notes: "Flat, walkable and quick to get round. A common choice for an after-work eighteen.",
  },
  {
    slug: "forest-dale-golf-course",
    holes: 9,
    style: "Parkland",
    walkable: "Easy",
    opened: 1906,
    notes: "Short historic nine in Sugar House — one of the oldest courses in Utah.",
  },
  {
    slug: "nibley-park-golf-course",
    holes: 9,
    style: "Executive",
    walkable: "Easy",
    notes: "Short nine, popular for a quick round or a first course.",
  },
  {
    slug: "mick-riley-golf-course",
    style: "Executive",
    walkable: "Easy",
    notes:
      "A regulation nine and a separate par 3 course, both bookable. Good " +
      "for beginners and for short-game practice.",
  },
  {
    slug: "old-mill-golf-course",
    holes: 18,
    par: 71,
    style: "Parkland",
    walkable: "Strenuous",
    notes:
      "Upscale county course at the mouth of Big Cottonwood, with real " +
      "elevation change and mountain views. Usually the priciest of the " +
      "Salt Lake County courses.",
  },
  {
    slug: "wasatch-mountain-golf-course",
    holes: 36,
    style: "Mountain",
    walkable: "Strenuous",
    notes:
      "Two eighteens in Wasatch Mountain State Park — Lake and Mountain. " +
      "Scenic and hilly; the Mountain course is the tougher of the two.",
  },
  {
    slug: "soldier-hollow-golf-course",
    holes: 36,
    style: "Mountain",
    walkable: "Strenuous",
    notes:
      "Two eighteens, Gold and Silver, on the 2002 Olympic venue above " +
      "Midway. Open and windy compared with most mountain golf here.",
  },
  {
    slug: "thanksgiving-point-golf-club",
    holes: 18,
    par: 72,
    style: "Parkland",
    walkable: "Strenuous",
    designer: "Johnny Miller",
    notes:
      "Long, water-heavy and among the sterner tests in the valley. Plays " +
      "significantly harder from the back tees than its neighbours.",
  },
  {
    slug: "riverbend-golf-course",
    holes: 18,
    style: "Parkland",
    walkable: "Easy",
    notes:
      "Flat riverside county course in Riverton, with a separate back nine " +
      "sheet so a quick nine is usually available.",
  },
  {
    slug: "the-ridge-golf-club",
    holes: 18,
    style: "Parkland",
    walkable: "Moderate",
    notes: "West-side course with a modern layout. Its tee sheet sits behind a login, so listings here may be incomplete.",
  },
];

const BY_SLUG = new Map(COURSE_PROFILES.map((p) => [p.slug, p]));

export function getProfile(slug: string): CourseProfile | undefined {
  return BY_SLUG.get(slug);
}

/** "Parkland · 18 holes · par 72 · walks easily" */
export function profileSummary(profile: CourseProfile): string[] {
  const parts: string[] = [];
  if (profile.style) parts.push(profile.style);
  if (profile.holes) parts.push(`${profile.holes} holes`);
  if (profile.par) parts.push(`par ${profile.par}`);
  if (profile.yardage) parts.push(`${profile.yardage.toLocaleString()} yds`);
  if (profile.slope) parts.push(`slope ${profile.slope}`);
  if (profile.designer) parts.push(profile.designer);
  if (profile.opened) parts.push(`est. ${profile.opened}`);
  return parts;
}
