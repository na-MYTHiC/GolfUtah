/**
 * Build identity, shown in the header so it's possible to tell at a
 * glance which build you're looking at — cached service workers and
 * scheduled deploys otherwise make that invisible.
 *
 * Set by the deploy workflow; "dev" when running locally.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";

export function buildLabel(): string {
  if (!BUILD_TIME) return BUILD_ID;
  const when = new Date(BUILD_TIME).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver",
  });
  return `${BUILD_ID} · ${when}`;
}
