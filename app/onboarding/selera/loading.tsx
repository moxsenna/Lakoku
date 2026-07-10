/**
 * Skeleton loading untuk /onboarding/selera.
 */
export default function SeleraLoading() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background px-5 pb-10 pt-6">
      <header className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-1 items-center gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
      </header>

      <section className="mt-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-36 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      </section>
    </main>
  )
}
