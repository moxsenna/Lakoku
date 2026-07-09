function StoryCardSkeleton() {
  return (
    <div className="flex gap-4 rounded-2xl bg-card p-3">
      <div className="h-[120px] w-20 shrink-0 animate-pulse rounded-xl bg-muted" />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div className="flex flex-col gap-2">
          <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex flex-col gap-8 px-5 pt-8">
          <header className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <div className="h-8 w-24 animate-pulse rounded bg-muted" />
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            </div>
          </header>

          <section className="flex flex-col gap-4">
            <div className="aspect-[4/5] w-full animate-pulse rounded-3xl bg-muted" />
          </section>

          <section className="flex flex-col gap-4">
            <div className="h-6 w-36 animate-pulse rounded bg-muted" />
            <div className="flex flex-col gap-3">
              <StoryCardSkeleton />
              <StoryCardSkeleton />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
