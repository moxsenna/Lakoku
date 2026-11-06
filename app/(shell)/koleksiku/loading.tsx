function CollectionSkeleton() {
  // Audit M-A11: skeleton meniru grid 3 kolom LibraryView agar tidak ada
  // lompatan layout (CLS) saat data selesai dimuat.
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <div className="relative aspect-[9/16] w-full animate-pulse rounded-xl bg-muted" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
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
