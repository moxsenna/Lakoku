export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Memuat bab"
      className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="size-11 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-1 flex-col items-center gap-1.5">
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="size-11 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="flex flex-col gap-5 px-6 pt-8">
        <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </main>
  )
}
