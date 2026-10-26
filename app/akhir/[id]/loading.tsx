export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Memuat akhir cerita"
      className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 bg-background px-5 pb-10 pt-6"
    >
      <div className="size-11 animate-pulse rounded-full bg-muted" />
      <div className="mx-auto h-48 w-36 animate-pulse rounded-2xl bg-card" />
      <div className="mx-auto h-8 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-card" />
      <div className="h-40 animate-pulse rounded-2xl bg-card" />
      <div className="mt-auto h-13 animate-pulse rounded-2xl bg-muted" />
    </main>
  )
}
