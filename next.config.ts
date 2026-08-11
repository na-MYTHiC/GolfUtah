import type { NextConfig } from "next";

/**
 * Built as a fully static site so it can live on GitHub Pages — no
 * server, free hosting, and installable to a phone home screen.
 *
 * Tee times can't be fetched from the browser (the courses' APIs mostly
 * don't send CORS headers), so a GitHub Actions cron fetches them and
 * bakes per-day JSON into `public/data/` before each build. The page
 * loads those files at runtime.
 *
 * BASE_PATH is set by the deploy workflow to the repo name, since Pages
 * serves the site from /<repo>/ rather than the domain root. Locally it's
 * empty so `npm run dev` works at /.
 */
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // Pages has no image optimizer behind it.
  images: { unoptimized: true },
  // Directory-style URLs, so /about serves /about/index.html.
  trailingSlash: true,
  env: {
    // Needed at runtime to build asset URLs (data files, manifest) that
    // still resolve under the Pages sub-path.
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Surfaced in the header so a stale cached build is obvious.
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID ?? "dev",
    NEXT_PUBLIC_BUILD_TIME: process.env.BUILD_TIME ?? "",
  },
};

export default nextConfig;
