import 'server-only'
import { getDb, single } from '@lakoku/db'
import { recordReferralAttribution } from './attribution.server'
import { ensureReferralCode } from './server'

export const SHARE_ATTRIBUTION_COOKIE_NAME = 'lakoku_share'

/**
 * Atribusi referral lewat tautan share: pembaca baru yang mulai cerita dari
 * `/s/[slug]` dihitung sebagai pengunjung yang dibawa pemilik share.
 *
 * Beda dengan `/r/[code]`: pemilik tidak mengirim kode, hanya tautan cerita,
 * jadi kode referral di-resolve dari pemilik tautan saat kuncinya terjadi.
 * Fail-closed dan non-fatal — kegagalan tidak pernah mengganggu alur baca.
 */
export async function recordShareLinkAttribution(input: {
  newUserId: string
  shareSlug: string
}): Promise<boolean> {
  try {
    const db = getDb()
    // RLS_AUDIT: shared_story_links_select_active
    const { data: link } = await single(
      db
        .selectFrom('shared_story_links')
        .select(['id', 'owner_user_id', 'revoked_at'])
        .where('share_slug', '=', input.shareSlug)
        .limit(1)
        .execute(),
    )
    if (!link || link.revoked_at || !link.owner_user_id) return false

    // Audit M-A7: kode referral pemilik dibuat on-demand — jangan gugur
    // diam-diam hanya karena pemilik belum pernah membuka tab Imbalan.
    let ownerCode: string
    try {
      ownerCode = await ensureReferralCode(link.owner_user_id)
    } catch {
      return false
    }
    if (!ownerCode) return false

    return await recordReferralAttribution(
      input.newUserId,
      ownerCode,
      'share_link',
      link.id,
    )
  } catch {
    return false
  }
}
