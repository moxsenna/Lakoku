export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Memuat misi" className="flex flex-col gap-6 px-5 pt-6 pb-8">
      <div className="flex items-center gap-3">
        <div className="size-11 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-24 animate-pulse rounded-2xl bg-card" />
      <div className="flex flex-col gap-3">
        <div className="h-16 animate-pulse rounded-2xl bg-card" />
        <div className="h-16 animate-pulse rounded-2xl bg-card" />
        <div className="h-16 animate-pulse rounded-2xl bg-card" />
      </div>
    </main>
  )
}
