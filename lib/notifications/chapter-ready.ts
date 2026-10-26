import { notifyChapterReady } from './server'

/**
 * Pemicu push "bab siap" dari pekerja generasi. Judul cerita dibaca dari DB
 * agar pemanggil tidak perlu membawa data tambahan. Semua kegagalan diam:
 * pemberitahuan tidak boleh mengubah hasil pekerjaan.
 */
export async function notifyChapterGenerated(input: {
  userId: string | null
  storyId: string
  chapterNumber: number
}): Promise<void> {
  if (!input.userId) return
  try {
    const { getDb, single } = await import('@lakoku/db')
    const db = getDb()
    // RLS_AUDIT: stories_public_read, stories_owner_read (service-role worker)
    const { data: story } = await single(
      db
        .selectFrom('stories')
        .select('title')
        .where('id', '=', input.storyId)
        .limit(1)
        .execute(),
    )
    if (!story?.title) return

    await notifyChapterReady({
      userId: input.userId,
      storyTitle: story.title,
      chapterNumber: input.chapterNumber,
      deepLink: `/baca/${encodeURIComponent(input.storyId)}?bab=${input.chapterNumber}`,
    })
  } catch {
    // Non-fatal.
  }
}
