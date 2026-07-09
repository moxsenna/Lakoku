function CollectionSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-[120px] animate-pulse rounded-2xl bg-card" />
      <div className="h-[120px] animate-pulse rounded-2xl bg-card" />
    </div>
  )
}

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex flex-col gap-8 px-5 pt-8">
          <header className="flex flex-col gap-2">
            <div className="h-9 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          </header>

          <section className="flex flex-col gap-4">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <CollectionSkeleton />
          </section>

          <section className="flex flex-col gap-4">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <CollectionSkeleton />
          </section>
        </div>
      </div>
    </main>
  )
}
