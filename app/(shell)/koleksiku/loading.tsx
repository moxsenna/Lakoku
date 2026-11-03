function CollectionSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-2xl bg-card p-2.5">
          <div className="relative aspect-[9/16] w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-1 w-full animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex flex-col gap-6 px-5 pt-8">
          <header className="flex flex-col gap-2">
            <div className="h-9 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          </header>

          <CollectionSkeleton />
        </div>
      </div>
    </main>
  )
}
