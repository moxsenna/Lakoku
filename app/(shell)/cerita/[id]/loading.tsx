export default function Loading() {
  return (
    <main className="flex flex-col">
      <div className="h-[52svh] w-full animate-pulse bg-muted" />
      <section className="-mt-8 flex flex-col gap-6 px-5 pb-8">
        <div className="flex flex-col gap-3 rounded-3xl bg-background/90 p-1">
          <div className="h-6 w-32 animate-pulse rounded bg-muted" />
          <div className="h-10 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-24 animate-pulse rounded-2xl bg-card" />
        <div className="h-14 animate-pulse rounded-2xl bg-primary/30" />
      </section>
    </main>
  )
}
