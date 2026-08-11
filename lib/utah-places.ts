/**
 * Utah cities and counties, for search and distance.
 *
 * Courses only sit in a couple of dozen towns, but people search from
 * where they live — so searching a city with no course of its own should
 * still work, using it as the origin for a radius. That means carrying a
 * general list of places, not just the ones we have courses in.
 *
 * Coordinates are approximate town centres, good enough to rank courses
 * by distance and to answer "what's within 30 miles", not to navigate by.
 */

export interface Place {
  name: string;
  county: string;
  lat: number;
  lon: number;
}

/** The 29 Utah counties. */
export const COUNTIES = [
  "Beaver", "Box Elder", "Cache", "Carbon", "Daggett", "Davis", "Duchesne",
  "Emery", "Garfield", "Grand", "Iron", "Juab", "Kane", "Millard", "Morgan",
  "Piute", "Rich", "Salt Lake", "San Juan", "Sanpete", "Sevier", "Summit",
  "Tooele", "Uintah", "Utah", "Wasatch", "Washington", "Wayne", "Weber",
] as const;

export const CITIES: Place[] = [
  // Salt Lake
  { name: "Salt Lake City", county: "Salt Lake", lat: 40.761, lon: -111.891 },
  { name: "West Valley City", county: "Salt Lake", lat: 40.692, lon: -112.001 },
  { name: "West Jordan", county: "Salt Lake", lat: 40.610, lon: -111.939 },
  { name: "Sandy", county: "Salt Lake", lat: 40.565, lon: -111.839 },
  { name: "South Jordan", county: "Salt Lake", lat: 40.562, lon: -111.930 },
  { name: "Murray", county: "Salt Lake", lat: 40.667, lon: -111.888 },
  { name: "Taylorsville", county: "Salt Lake", lat: 40.668, lon: -111.939 },
  { name: "Draper", county: "Salt Lake", lat: 40.525, lon: -111.864 },
  { name: "Riverton", county: "Salt Lake", lat: 40.522, lon: -111.939 },
  { name: "Herriman", county: "Salt Lake", lat: 40.514, lon: -112.033 },
  { name: "Midvale", county: "Salt Lake", lat: 40.611, lon: -111.900 },
  { name: "Cottonwood Heights", county: "Salt Lake", lat: 40.620, lon: -111.810 },
  { name: "Holladay", county: "Salt Lake", lat: 40.669, lon: -111.825 },
  { name: "Millcreek", county: "Salt Lake", lat: 40.687, lon: -111.875 },
  { name: "South Salt Lake", county: "Salt Lake", lat: 40.719, lon: -111.888 },
  { name: "Bluffdale", county: "Salt Lake", lat: 40.489, lon: -111.939 },
  { name: "Magna", county: "Salt Lake", lat: 40.709, lon: -112.102 },
  { name: "Kearns", county: "Salt Lake", lat: 40.660, lon: -111.996 },
  { name: "Sandy Hills", county: "Salt Lake", lat: 40.575, lon: -111.850 },

  // Utah County
  { name: "Provo", county: "Utah", lat: 40.234, lon: -111.659 },
  { name: "Orem", county: "Utah", lat: 40.297, lon: -111.695 },
  { name: "Lehi", county: "Utah", lat: 40.392, lon: -111.851 },
  { name: "American Fork", county: "Utah", lat: 40.377, lon: -111.796 },
  { name: "Pleasant Grove", county: "Utah", lat: 40.364, lon: -111.739 },
  { name: "Spanish Fork", county: "Utah", lat: 40.115, lon: -111.655 },
  { name: "Springville", county: "Utah", lat: 40.165, lon: -111.611 },
  { name: "Payson", county: "Utah", lat: 40.045, lon: -111.732 },
  { name: "Saratoga Springs", county: "Utah", lat: 40.349, lon: -111.904 },
  { name: "Eagle Mountain", county: "Utah", lat: 40.314, lon: -112.007 },
  { name: "Cedar Hills", county: "Utah", lat: 40.414, lon: -111.755 },
  { name: "Highland", county: "Utah", lat: 40.426, lon: -111.795 },
  { name: "Lindon", county: "Utah", lat: 40.341, lon: -111.721 },
  { name: "Alpine", county: "Utah", lat: 40.453, lon: -111.777 },
  { name: "Mapleton", county: "Utah", lat: 40.130, lon: -111.578 },
  { name: "Salem", county: "Utah", lat: 40.053, lon: -111.673 },
  { name: "Santaquin", county: "Utah", lat: 39.977, lon: -111.786 },
  { name: "Vineyard", county: "Utah", lat: 40.297, lon: -111.755 },

  // Davis / Weber / Box Elder
  { name: "Layton", county: "Davis", lat: 41.060, lon: -111.971 },
  { name: "Bountiful", county: "Davis", lat: 40.889, lon: -111.881 },
  { name: "Kaysville", county: "Davis", lat: 41.035, lon: -111.938 },
  { name: "Clearfield", county: "Davis", lat: 41.111, lon: -112.026 },
  { name: "Syracuse", county: "Davis", lat: 41.089, lon: -112.065 },
  { name: "Farmington", county: "Davis", lat: 40.980, lon: -111.887 },
  { name: "Centerville", county: "Davis", lat: 40.918, lon: -111.872 },
  { name: "North Salt Lake", county: "Davis", lat: 40.848, lon: -111.907 },
  { name: "Clinton", county: "Davis", lat: 41.139, lon: -112.051 },
  { name: "Woods Cross", county: "Davis", lat: 40.872, lon: -111.892 },
  { name: "West Bountiful", county: "Davis", lat: 40.893, lon: -111.901 },
  { name: "West Point", county: "Davis", lat: 41.118, lon: -112.084 },
  { name: "Ogden", county: "Weber", lat: 41.223, lon: -111.973 },
  { name: "Roy", county: "Weber", lat: 41.162, lon: -112.026 },
  { name: "South Ogden", county: "Weber", lat: 41.190, lon: -111.957 },
  { name: "North Ogden", county: "Weber", lat: 41.302, lon: -111.960 },
  { name: "Pleasant View", county: "Weber", lat: 41.320, lon: -111.994 },
  { name: "Riverdale", county: "Weber", lat: 41.177, lon: -112.001 },
  { name: "Washington Terrace", county: "Weber", lat: 41.176, lon: -111.972 },
  { name: "Eden", county: "Weber", lat: 41.300, lon: -111.830 },
  { name: "Huntsville", county: "Weber", lat: 41.257, lon: -111.768 },
  { name: "Brigham City", county: "Box Elder", lat: 41.510, lon: -112.015 },
  { name: "Tremonton", county: "Box Elder", lat: 41.711, lon: -112.165 },
  { name: "Perry", county: "Box Elder", lat: 41.462, lon: -112.028 },

  // Cache / Rich / Morgan / Summit / Wasatch
  { name: "Logan", county: "Cache", lat: 41.735, lon: -111.834 },
  { name: "North Logan", county: "Cache", lat: 41.770, lon: -111.806 },
  { name: "Smithfield", county: "Cache", lat: 41.838, lon: -111.833 },
  { name: "Hyrum", county: "Cache", lat: 41.633, lon: -111.852 },
  { name: "Providence", county: "Cache", lat: 41.706, lon: -111.817 },
  { name: "Garden City", county: "Rich", lat: 41.946, lon: -111.393 },
  { name: "Randolph", county: "Rich", lat: 41.665, lon: -111.180 },
  { name: "Morgan", county: "Morgan", lat: 41.036, lon: -111.677 },
  { name: "Park City", county: "Summit", lat: 40.646, lon: -111.498 },
  { name: "Coalville", county: "Summit", lat: 40.917, lon: -111.399 },
  { name: "Kamas", county: "Summit", lat: 40.643, lon: -111.281 },
  { name: "Heber City", county: "Wasatch", lat: 40.507, lon: -111.413 },
  { name: "Midway", county: "Wasatch", lat: 40.512, lon: -111.474 },
  { name: "Hideout", county: "Wasatch", lat: 40.573, lon: -111.437 },

  // Tooele / Juab / Sanpete / Millard
  { name: "Tooele", county: "Tooele", lat: 40.531, lon: -112.298 },
  { name: "Grantsville", county: "Tooele", lat: 40.600, lon: -112.464 },
  { name: "Stansbury Park", county: "Tooele", lat: 40.638, lon: -112.297 },
  { name: "Nephi", county: "Juab", lat: 39.710, lon: -111.836 },
  { name: "Ephraim", county: "Sanpete", lat: 39.359, lon: -111.586 },
  { name: "Manti", county: "Sanpete", lat: 39.268, lon: -111.637 },
  { name: "Mount Pleasant", county: "Sanpete", lat: 39.546, lon: -111.456 },
  { name: "Delta", county: "Millard", lat: 39.352, lon: -112.577 },
  { name: "Fillmore", county: "Millard", lat: 38.968, lon: -112.324 },

  // Carbon / Emery / Grand / San Juan / Duchesne / Uintah / Daggett
  { name: "Price", county: "Carbon", lat: 39.599, lon: -110.811 },
  { name: "Helper", county: "Carbon", lat: 39.684, lon: -110.856 },
  { name: "Ferron", county: "Emery", lat: 39.093, lon: -111.132 },
  { name: "Castle Dale", county: "Emery", lat: 39.213, lon: -111.020 },
  { name: "Huntington", county: "Emery", lat: 39.327, lon: -110.963 },
  { name: "Green River", county: "Emery", lat: 38.996, lon: -110.159 },
  { name: "Moab", county: "Grand", lat: 38.573, lon: -109.550 },
  { name: "Monticello", county: "San Juan", lat: 37.871, lon: -109.343 },
  { name: "Blanding", county: "San Juan", lat: 37.625, lon: -109.478 },
  { name: "Roosevelt", county: "Duchesne", lat: 40.299, lon: -109.989 },
  { name: "Duchesne", county: "Duchesne", lat: 40.163, lon: -110.402 },
  { name: "Vernal", county: "Uintah", lat: 40.455, lon: -109.528 },
  { name: "Manila", county: "Daggett", lat: 40.988, lon: -109.722 },

  // Southern Utah
  { name: "St. George", county: "Washington", lat: 37.096, lon: -113.568 },
  { name: "Washington", county: "Washington", lat: 37.131, lon: -113.508 },
  { name: "Hurricane", county: "Washington", lat: 37.175, lon: -113.290 },
  { name: "Ivins", county: "Washington", lat: 37.168, lon: -113.679 },
  { name: "Santa Clara", county: "Washington", lat: 37.134, lon: -113.654 },
  { name: "Cedar City", county: "Iron", lat: 37.678, lon: -113.061 },
  { name: "Enoch", county: "Iron", lat: 37.773, lon: -113.026 },
  { name: "Parowan", county: "Iron", lat: 37.842, lon: -112.831 },
  { name: "Beaver", county: "Beaver", lat: 38.277, lon: -112.641 },
  { name: "Milford", county: "Beaver", lat: 38.396, lon: -113.013 },
  { name: "Richfield", county: "Sevier", lat: 38.773, lon: -112.084 },
  { name: "Salina", county: "Sevier", lat: 38.958, lon: -111.860 },
  { name: "Panguitch", county: "Garfield", lat: 37.822, lon: -112.436 },
  { name: "Escalante", county: "Garfield", lat: 37.770, lon: -111.601 },
  { name: "Kanab", county: "Kane", lat: 37.047, lon: -112.526 },
  { name: "Junction", county: "Piute", lat: 38.240, lon: -112.223 },
  { name: "Loa", county: "Wayne", lat: 38.402, lon: -111.643 },
];

/** Approximate county centres, for county-level distance. */
export const COUNTY_CENTERS: Record<string, { lat: number; lon: number }> = {
  Beaver: { lat: 38.36, lon: -113.24 },
  "Box Elder": { lat: 41.52, lon: -113.08 },
  Cache: { lat: 41.74, lon: -111.74 },
  Carbon: { lat: 39.65, lon: -110.59 },
  Daggett: { lat: 40.89, lon: -109.51 },
  Davis: { lat: 40.99, lon: -112.11 },
  Duchesne: { lat: 40.30, lon: -110.43 },
  Emery: { lat: 38.99, lon: -110.70 },
  Garfield: { lat: 37.85, lon: -111.44 },
  Grand: { lat: 38.98, lon: -109.57 },
  Iron: { lat: 37.86, lon: -113.29 },
  Juab: { lat: 39.70, lon: -112.78 },
  Kane: { lat: 37.28, lon: -111.89 },
  Millard: { lat: 39.07, lon: -113.10 },
  Morgan: { lat: 41.09, lon: -111.58 },
  Piute: { lat: 38.34, lon: -112.13 },
  Rich: { lat: 41.63, lon: -111.24 },
  "Salt Lake": { lat: 40.67, lon: -111.92 },
  "San Juan": { lat: 37.63, lon: -109.81 },
  Sanpete: { lat: 39.37, lon: -111.58 },
  Sevier: { lat: 38.75, lon: -111.80 },
  Summit: { lat: 40.87, lon: -110.95 },
  Tooele: { lat: 40.45, lon: -113.13 },
  Uintah: { lat: 40.13, lon: -109.52 },
  Utah: { lat: 40.12, lon: -111.67 },
  Wasatch: { lat: 40.33, lon: -111.17 },
  Washington: { lat: 37.28, lon: -113.50 },
  Wayne: { lat: 38.32, lon: -110.94 },
  Weber: { lat: 41.27, lon: -111.91 },
};

export function findCity(name: string): Place | undefined {
  const needle = name.trim().toLowerCase();
  return CITIES.find((c) => c.name.toLowerCase() === needle);
}

export function isCounty(name: string): boolean {
  const needle = name.trim().toLowerCase();
  return COUNTIES.some((c) => c.toLowerCase() === needle);
}
