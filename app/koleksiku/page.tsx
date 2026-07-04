import { AppShell } from '@/components/app-shell'
import { StoryCard } from '@/components/story-card'
import { listStories } from '@/lib/api/server'

export default async function KoleksikuPage() {
  const stories = await listStories()
  const berjalan = stories.filter((s) => s.status !== 'SELESAI')
  const selesai = stories.filter((s) => s.status === 'SELESAI')

  return (
    <AppShell>
      <main className="flex flex-col gap-8 px-5 pt-8">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-3xl text-foreground">Koleksiku</h1>
          <p className="text-sm text-muted-foreground">
            Cerita yang sedang kamu jalani dan akhir yang sudah kamu capai.
          </p>
        </header>

        <section aria-labelledby="berjalan-heading" className="flex flex-col gap-4">
          <h2 id="berjalan-heading" className="text-sm font-semibold tracking-wide text-lavender">
            CERITA BERJALAN
          </h2>
          {berjalan.length > 0 ? (
            <div className="flex flex-col gap-3">
              {berjalan.map((story) => (
                <StoryCard key={story.id} story={story} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
              <p className="text-sm text-muted-foreground">Belum ada cerita yang menunggumu.</p>
            </div>
          )}
        </section>

        <section aria-labelledby="selesai-heading" className="mb-4 flex flex-col gap-4">
          <h2 id="selesai-heading" className="text-sm font-semibold tracking-wide text-lavender">
            AKHIR CERITA
          </h2>
          {selesai.length > 0 ? (
            <div className="flex flex-col gap-3">
              {selesai.map((story) => (
                <StoryCard key={story.id} story={story} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
              <p className="text-sm text-muted-foreground">Akhir ceritamu akan muncul di sini.</p>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  )
}
