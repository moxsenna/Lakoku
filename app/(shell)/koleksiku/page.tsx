import { LibraryView } from '@/components/library/library-view'
import { listMyLibraryStories, getOwnedStoryVisibilityForUser } from '@/lib/api/server'
import { getSessionUser } from '@/lib/api/user-state'
import type { LibraryStoryItem } from '@/lib/library/types'

export const dynamic = 'force-dynamic'

export default async function KoleksikuPage() {
  const user = await getSessionUser()
  // Personal only (AMENDMENTS v0.5). Route is auth-gated; empty for safety if session missing.
  const stories = user ? await listMyLibraryStories() : []

  const ownedStoriesMap =
    user && stories.length > 0
      ? await getOwnedStoryVisibilityForUser(
          user.id,
          stories.map((s) => s.id),
        )
      : new Map<string, string>()

  // DTO sempit: `jejak` (bisa ~50 entri per cerita) tidak pernah ikut ke klien.
  const items: LibraryStoryItem[] = stories.map((story) => ({
    id: story.id,
    title: story.title,
    cover: story.cover,
    status: story.status,
    currentChapter: story.currentChapter,
    totalChapters: story.totalChapters,
    ...(story.lastReadAt ? { lastReadAt: story.lastReadAt } : {}),
    isOwned: ownedStoriesMap.has(story.id),
    visibility: ownedStoriesMap.get(story.id) ?? null,
  }))

  return (
    <main className="flex flex-col gap-6 px-5 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-foreground">Koleksiku</h1>
        <p className="text-sm text-muted-foreground">
          Cerita yang sedang kamu jalani dan akhir yang sudah kamu capai.
        </p>
      </header>

      <LibraryView stories={items} />
    </main>
  )
}
