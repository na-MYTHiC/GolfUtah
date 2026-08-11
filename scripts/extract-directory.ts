/**
 * Pull candidate golf course websites out of a directory page (utah.com,
 * UGA, 18birdies, ...) and emit them in the shape `npm run detect`
 * expects.
 *
 * Directory pages list courses and link out to each course's own site.
 * Those outbound links are what we want — the platform a course books
 * through is only visible on the course's own site, not the directory.
 *
 * Usage:
 *   npm run extract -- https://www.utah.com/.../golfing/ > candidates.json
 *   npm run extract -- saved-page.html > candidates.json
 *
 * The second form is the fallback for directories that block plain
 * fetches: open the page in a browser, Save Page As, and point this at
 * the saved file.
 *
 * Output is a starting point, not gospel — directory pages link to plenty
 * of things that aren't golf courses. Skim the result before running it
 * through detect.
 */
import { readFileSync, existsSync } from "node:fs";

interface Candidate {
  name: string;
  url: string;
}

/** Hosts that show up on every page and are never a golf course. */
const JUNK_HOSTS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
  "pinterest.com", "linkedin.com", "tiktok.com", "google.com", "apple.com",
  "wikipedia.org", "tripadvisor.com", "yelp.com", "maps.google.com",
];

const JUNK_PATH = /\/(privacy|terms|contact|about|login|signup|cart|search)\b/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extract(html: string, sourceUrl?: string): Candidate[] {
  const sourceHost = sourceUrl ? safeHost(sourceUrl) : undefined;
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  // Keyed by full normalized URL, not by host: municipal sites run several
  // courses off one domain (slc-golf.com/bonneville/, /glendale/, ...), so
  // collapsing to the host would silently merge distinct courses.
  const byUrl = new Map<string, Candidate>();

  for (const match of html.matchAll(anchor)) {
    const [, rawHref, inner] = match;
    if (!/^https?:\/\//i.test(rawHref)) continue;

    const host = safeHost(rawHref);
    if (!host) continue;
    if (sourceHost && host === sourceHost) continue; // internal nav
    if (JUNK_HOSTS.some((j) => host === j || host.endsWith(`.${j}`))) continue;
    if (JUNK_PATH.test(rawHref)) continue;

    const name = cleanText(inner);
    // Link text is the course name on a directory page. Skip image-only
    // links, "click here", and other non-names.
    if (name.length < 3 || name.length > 80) continue;
    if (/^(here|more|read more|visit|website|link|book now)$/i.test(name)) continue;

    const url = normalizeUrl(rawHref);
    if (!url) continue;

    // Directories often link the same page several times (logo, name,
    // "book now"). Keep the longest link text, which is usually the real
    // course name rather than "Book".
    const existing = byUrl.get(url);
    if (!existing || name.length > existing.name.length) {
      byUrl.set(url, { name, url });
    }
  }

  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Strip query/hash and drop www, but keep the path — it identifies the course. */
function normalizeUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.protocol = "https:";
    return u.toString();
  } catch {
    return undefined;
  }
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: npm run extract -- <directory-url|saved-page.html>");
    process.exitCode = 1;
    return;
  }

  let html: string;
  let sourceUrl: string | undefined;

  if (existsSync(source)) {
    html = readFileSync(source, "utf8");
  } else {
    sourceUrl = source;
    const resp = await fetch(source, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) {
      console.error(
        `Fetch failed: HTTP ${resp.status}. If the site blocks plain requests, ` +
          `open it in a browser, Save Page As, and pass the saved file instead.`
      );
      process.exitCode = 1;
      return;
    }
    html = await resp.text();
  }

  const candidates = extract(html, sourceUrl);
  if (candidates.length === 0) {
    console.error(
      "No outbound links found. The page may render its list with JavaScript — " +
        "try the Save Page As route so the rendered HTML is captured."
    );
    process.exitCode = 1;
    return;
  }

  console.error(`Extracted ${candidates.length} candidate(s).`); // stderr so stdout stays pipeable
  console.log(JSON.stringify(candidates, null, 2));
}

main().catch((err) => {
  console.error("extract failed:", (err as Error).message);
  process.exitCode = 1;
});
