export default function GenerationLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <header>
        <div className="h-7 w-44 animate-pulse rounded bg-muted" />
        <p className="mt-2 text-xs text-muted-foreground">Loading generation observability…</p>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-border bg-muted/30" />
      <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/30" />
    </div>
  )
}
