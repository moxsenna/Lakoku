export default function Loading() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <div className="flex flex-1 flex-col pb-24">
        <div className="flex flex-col gap-8 px-5 pt-8">
          <header className="flex items-center gap-4">
            <div className="size-14 animate-pulse rounded-full bg-muted" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-8 w-40 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
            <div className="size-10 animate-pulse rounded-full bg-muted" />
          </header>

          <section className="grid grid-cols-3 gap-3">
            <div className="h-24 animate-pulse rounded-2xl bg-card" />
            <div className="h-24 animate-pulse rounded-2xl bg-card" />
            <div className="h-24 animate-pulse rounded-2xl bg-card" />
          </section>

          <section className="h-24 animate-pulse rounded-2xl bg-card" />
          <section className="h-48 animate-pulse rounded-2xl bg-card" />

          <section className="flex flex-col gap-3">
            <div className="h-12 animate-pulse rounded-2xl bg-muted" />
            <div className="h-4 w-40 self-center animate-pulse rounded bg-muted" />
          </section>
        </div>
      </div>
    </main>
  )
}
