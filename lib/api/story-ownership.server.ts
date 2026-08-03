import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Kontrak topologi (P0):
 *   chapters PK = (story_id, number) → satu bab per story, tanpa dimensi reader.
 *   Karena itu generasi bab personal HANYA sah pada story yang dimiliki reader.
 *
 * Story publik/berbagi bersifat shared-linear (pre-generated). Reader non-pemilik
 * tidak boleh memicu generasi, karena hasilnya dipublikasikan global ke story_id
 * yang sama dan akan terbaca oleh reader lain dengan rute berbeda.
 *
 * Lihat docs/CONTINUITY_REGENERATION.md untuk opsi lanjutan (clone→private).
 */
export async function isStoryOwnedBy(storyId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('stories')
    .select('id')
    .eq('id', storyId)
    .eq('owner_user_id', userId)
    .maybeSingle()
  if (error) return false
  return data != null
}
