import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Penyimpanan sampul di Supabase Storage.
 *
 * Dibungkus antarmuka sempit (`putCover`) supaya pindah ke penyedia objek
 * lain nanti hanya menyentuh file ini — pemanggil cukup tahu ia menerima URL.
 */

export const COVER_BUCKET = 'story-covers'

/** Nama objek unik per unggahan supaya CDN tidak menyajikan versi lama. */
function coverObjectPath(storyId: string): string {
  const safeStoryId = storyId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `${safeStoryId}/${stamp}.webp`
}

export type PutCoverResult = { ok: true; url: string } | { ok: false; detail: string }

/** Unggah byte WebP dan kembalikan URL publik yang siap dipasang ke stories.cover. */
export async function putCover(storyId: string, webp: Buffer): Promise<PutCoverResult> {
  const db = createAdminClient()
  const path = coverObjectPath(storyId)

  const { error } = await db.storage.from(COVER_BUCKET).upload(path, webp, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  })

  if (error) return { ok: false, detail: error.message }

  const { data } = db.storage.from(COVER_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) return { ok: false, detail: 'URL publik tidak terbentuk' }

  return { ok: true, url: data.publicUrl }
}
