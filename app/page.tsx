import { prisma } from "@/lib/db";

// Tee time data changes by the minute — always render fresh, never
// statically cache this page.
export const dynamic = "force-dynamic";

export default async function Home() {
  const courses = await prisma.course.findMany({
    where: { active: true },
    include: { teeTimes: { orderBy: [{ date: "asc" }, { time: "asc" }] } },
  }).catch(() => null); // null if DATABASE_URL isn't configured yet

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          GolfUtah
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Live tee time availability across Utah golf courses, in one place.
        </p>

        {courses === null && (
          <div className="mt-10 rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            No database connection yet. Set{" "}
            <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">
              DATABASE_URL
            </code>{" "}
            in <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">.env</code>,
            run <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">npx prisma migrate dev</code>,
            and seed some courses (<code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">prisma/seed.ts</code>).
          </div>
        )}

        {courses && courses.length === 0 && (
          <div className="mt-10 rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            Database is connected but no courses are seeded yet. See{" "}
            <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">prisma/seed.ts</code>.
          </div>
        )}

        {courses && courses.length > 0 && (
          <div className="mt-10 flex flex-col gap-8">
            {courses.map((course) => (
              <section key={course.id}>
                <h2 className="text-lg font-medium text-black dark:text-zinc-50">
                  {course.name}
                  {course.city ? (
                    <span className="ml-2 text-sm font-normal text-zinc-500">{course.city}</span>
                  ) : null}
                </h2>
                {course.teeTimes.length === 0 ? (
                  <p className="mt-1 text-sm text-zinc-500">No cached tee times yet — run the poll worker.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                    {course.teeTimes.map((t) => (
                      <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                        <span>
                          {t.date.toISOString().slice(0, 10)} · {t.time} · {t.holes} holes
                        </span>
                        <span className="text-zinc-500">{t.playersOpen} open</span>
                        <a
                          href={t.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-zinc-950 underline dark:text-zinc-50"
                        >
                          Book
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
