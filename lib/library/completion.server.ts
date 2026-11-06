import 'server-only'
import { getDb, result } from '@lakoku/db'

/**
 * Audit NIT seam: rekonsiliasi akhir cerita standard saat pembaca mencapai
 * bab penutup — dipanggil dari Server Component, bukan akses DB langsung.
 * Kegagalan tidak melempar: penanda tamat bersifat best-effort.
 */
export async function markReaderCompletedStandard(input: {
  userId: string
  storyId: string
  endingName: string
  chapterNumber: number
}): Promise<void> {
  const db = getDb()
  // RLS_AUDIT: reader_states_owner
  const { error } = await result(
    db
      .updateTable('reader_states')
      .set({
        status: 'SELESAI',
        ending_name: input.endingName,
        current_chapter: input.chapterNumber,
        updated_at: new Date().toISOString(),
      })
      .where('user_id', '=', input.userId)
      .where('story_id', '=', input.storyId)
      .execute(),
  )
  if (error) throw new Error(`markReaderCompletedStandard: ${error.message}`)
}
