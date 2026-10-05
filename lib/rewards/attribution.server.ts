import { getDb, single, result } from '@lakoku/db'
import { getRewardPolicy } from './server'

/**
 * Catat ikatan atribusi pembaca baru ke pengajak.
 * Fail-closed, non-fatal, idempoten seumur hidup.
 */
export async function recordReferralAttribution(
  referredUserId: string,
  code: string,
  source: 'referral_code' | 'share_link' = 'referral_code',
  sharedLinkId: string | null = null,
): Promise<boolean> {
  if (!referredUserId || !code) return false

  try {
    const db = getDb()

    // 1. Cari pemilik kode referral
    // RLS_AUDIT: referral_codes_own_read
    const { data: codeRow, error: codeErr } = await single(
      db
        .selectFrom('referral_codes')
        .select('user_id')
        .where('code', '=', code.toUpperCase())
        .limit(1)
        .execute(),
    )

    if (codeErr || !codeRow?.user_id) return false
    const referrerUserId = codeRow.user_id

    // 2. Tolak self-referral
    if (referrerUserId === referredUserId) return false

    // 3. Hitung window_ends_at dari kebijakan aktif
    const policy = await getRewardPolicy()
    const now = new Date()
    const windowEndsAt = new Date(now.getTime() + policy.windowDays * 24 * 60 * 60 * 1000)

    // 4. Tulis atribusi
    // RLS_AUDIT: referral_attributions_own_read
    const { error: insertErr } = await result(
      db
        .insertInto('referral_attributions')
        .values({
          referrer_user_id: referrerUserId,
          referred_user_id: referredUserId,
          source,
          shared_link_id: sharedLinkId,
          attributed_at: now.toISOString(),
          window_ends_at: windowEndsAt.toISOString(),
        })
        .execute(),
    )

    if (insertErr) {
      // 23505 = unique_violation (user sudah pernah diatribusikan)
      if (insertErr.code === '23505') return false
      console.log('[rewards] recordReferralAttribution non-fatal insert error:', insertErr.message)
      return false
    }

    return true
  } catch (err) {
    console.log('[rewards] recordReferralAttribution caught error:', (err as Error)?.message)
    return false
  }
}
