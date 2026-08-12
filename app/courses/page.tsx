import { Suspense } from "react";
import { CourseBrowser } from "./course-browser";
import { AppHeader } from "../components/app-header";
import { COURSES } from "@/lib/courses.data";
import { existsSync } from "node:fs";

export default function CoursesPage() {
  // The course list is known at build time, so it ships in the HTML
  // rather than waiting on a fetch — this screen should feel instant.
  const courses = COURSES.map((c) => ({
    name: c.name,
    slug: c.slug,
    city: c.city,
    county: c.county,
    lat: c.latitude,
    lon: c.longitude,
    // Checked here rather than handled with an onError in the browser:
    // a static export hydrates after the image has already failed, so
    // the fallback never gets a chance and every course without a photo
    // shows a broken-image glyph. This page runs at build time and can
    // simply look.
    hasPhoto: existsSync(`public/photos/${c.slug}.jpg`),
  }));

  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto max-w-2xl px-4 pb-8 pt-4">
        <AppHeader subtitle={`${courses.length} Utah courses`} />
        <Suspense fallback={null}>
          <CourseBrowser courses={courses} />
        </Suspense>
      </main>
    </div>
  );
}
