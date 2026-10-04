/**
 * Pembacaan status lease generasi (server-only, operasional).
 *
 * Status ketersediaan bab dibaca menggunakan Kysely di sisi server,
 * dan HANYA dipetakan ke boolean (isChapterPreparing) — tak ada detail teknis yang keluar.
 */
import 'server-only'
import { getDb, single } from '@lakoku/db'

/**
 * true bila ada lease generasi AKTIF (belum kedaluwarsa) untuk (story, bab):
 * artinya bab itu sedang ditulis. Best-effort — kegagalan baca dianggap
 * "tidak sedang disiapkan" agar layar reader tetap anggun.
 */
export async function isChapterPreparing(
  storyId: string,
  chapterNumber: number,
): Promise<boolean> {
  try {
    const db = getDb()
    // RLS_AUDIT: generation_leases_service_only
    const { data, error } = await single(
      db
        .selectFrom('generation_leases')
        .select(['id', 'expires_at'])
        .where('story_id', '=', storyId)
        .where('chapter_number', '=', chapterNumber)
        .where('status', '=', 'ACTIVE')
        .where('expires_at', '>', new Date())
        .limit(1)
        .execute(),
    )
    if (error) return false
    return data != null
  } catch {
    return false
  }
}
