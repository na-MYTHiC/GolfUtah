import { Suspense } from "react";
import { COURSES } from "@/lib/courses.data";
import { CourseDetail } from "./course-detail";

/**
 * One page per course, pre-rendered at build time. Static export needs
 * every route known up front, which is fine — the course list is fixed
 * and small.
 */
export function generateStaticParams() {
  return COURSES.map((course) => ({ slug: course.slug }));
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = COURSES.find((c) => c.slug === slug);

  if (!course) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-text-2">Course not found.</p>
      </main>
    );
  }

  return (
    <Suspense fallback={<p className="py-16 text-center text-sm text-text-3">Loading…</p>}>
      <CourseDetail
        slug={course.slug}
        name={course.name}
        city={course.city}
        county={course.county}
        bookingUrl={course.bookingUrl}
      />
    </Suspense>
  );
}
