export default function Loading() {
  return (
    <main className="flex flex-col gap-6 px-5 pt-6 pb-8">
      <header className="flex items-center gap-3">
        <div className="size-10 animate-pulse rounded-full bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded bg-muted" />
      </header>

      <section className="h-24 animate-pulse rounded-2xl bg-card" />
      <div className="h-5 w-full animate-pulse rounded bg-muted" />

      <section className="flex flex-col gap-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
      </section>
    </main>
  )
}
