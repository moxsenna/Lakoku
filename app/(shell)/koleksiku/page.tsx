import Link from 'next/link'
import { StoryCard } from '@/components/story-card'
import { listMyLibraryStories } from '@/lib/api/server'
import { getSessionUser } from '@/lib/api/user-state'
import { createAdminClient } from '@lakoku/db'
import { StoryVisibilityToggle } from '@/components/story/story-visibility-toggle'

export const dynamic = 'force-dynamic'

export default async function KoleksikuPage() {
  const user = await getSessionUser()
  // Personal only (AMENDMENTS v0.5). Route is auth-gated; empty for safety if session missing.
  const stories = user ? await listMyLibraryStories() : []
  const berjalan = stories.filter((s) => s.status !== 'SELESAI')
  const selesai = stories.filter((s) => s.status === 'SELESAI')

  const ownedStoriesMap = new Map<string, string>()
  if (user && stories.length > 0) {
    try {
      const db = createAdminClient()
      const { data } = await db
        .from('stories')
        .select('id, visibility')
        .eq('owner_user_id', user.id)
        .in('id', stories.map((s) => s.id))
      if (data) {
        for (const row of data) {
          ownedStoriesMap.set(row.id, row.visibility || 'private')
        }
      }
    } catch {
      // Fail-open: if ownership query fails, toggle won't show
    }
  }

  return (
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
              {berjalan.map((story) => {
                const isOwned = ownedStoriesMap.has(story.id)
                return (
                  <div key={story.id} className="flex flex-col gap-1">
                    <StoryCard story={story} />
                    {isOwned && (
                      <div className="flex items-center justify-between px-2 py-0.5">
                        <span className="text-[11px] text-muted-foreground">Visibilitas cerita</span>
                        <StoryVisibilityToggle
                          storyId={story.id}
                          initialVisibility={ownedStoriesMap.get(story.id) ?? 'private'}
                          owned={true}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
              <p className="text-sm text-muted-foreground">Belum ada cerita yang menunggumu.</p>
              <Link
                href="/mulai"
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Mulai Cerita Baru
              </Link>
            </div>
          )}
        </section>

        <section aria-labelledby="selesai-heading" className="mb-4 flex flex-col gap-4">
          <h2 id="selesai-heading" className="text-sm font-semibold tracking-wide text-lavender">
            AKHIR CERITA
          </h2>
          {selesai.length > 0 ? (
            <div className="flex flex-col gap-3">
              {selesai.map((story) => {
                const isOwned = ownedStoriesMap.has(story.id)
                return (
                  <div key={story.id} className="flex flex-col gap-1">
                    <StoryCard story={story} />
                    {isOwned && (
                      <div className="flex items-center justify-between px-2 py-0.5">
                        <span className="text-[11px] text-muted-foreground">Visibilitas cerita</span>
                        <StoryVisibilityToggle
                          storyId={story.id}
                          initialVisibility={ownedStoriesMap.get(story.id) ?? 'private'}
                          owned={true}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-card p-6">
              <p className="text-sm text-muted-foreground">Akhir ceritamu akan muncul di sini.</p>
              <Link
                href="/mulai"
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Mulai Cerita Baru
              </Link>
            </div>
          )}
        </section>
    </main>
  )
}
