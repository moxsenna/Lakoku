import { getDb, single, rpcOne } from '@lakoku/db'
import { getRewardPolicy } from './server'
import { calculateCommission } from './policy'

export interface ApplyCommissionResult {
  applied: boolean
  commissionIdr?: number
  reason?: string
}

/**
 * Berikan komisi referral atas pembayaran top-up (idempoten ref `commission:<order_id>`).
 * Dipanggil dari handler webhook PayCore setelah order lunas.
 */
export async function applyReferralCommission(
  orderId: string,
  buyerUserId: string,
): Promise<ApplyCommissionResult> {
  const policy = await getRewardPolicy()
  if (!policy.commissionEnabled) {
    return { applied: false, reason: 'commission_disabled' }
  }

  const db = getDb()

  // 1. Cari ikatan atribusi pembeli
  // RLS_AUDIT: referral_attributions_own_read
  const { data: attribution, error: attrErr } = await single(
    db
      .selectFrom('referral_attributions')
      .select(['referrer_user_id', 'window_ends_at'])
      .where('referred_user_id', '=', buyerUserId)
      .limit(1)
      .execute(),
  )

  if (attrErr || !attribution) {
    return { applied: false, reason: 'no_attribution' }
  }

  // 2. Cek apakah masih dalam jendela waktu
  const nowIso = new Date().toISOString()
  const windowEndsAt = attribution.window_ends_at instanceof Date
    ? attribution.window_ends_at.toISOString()
    : String(attribution.window_ends_at)
  if (windowEndsAt < nowIso) {
    return { applied: false, reason: 'window_expired' }
  }

  // 3. Ambil snapshot price_idr dari credit_orders
  // RLS_AUDIT: credit_orders_own_read
  const { data: order, error: orderErr } = await single(
    db
      .selectFrom('credit_orders')
      .select('price_idr')
      .where('order_id', '=', orderId)
      .limit(1)
      .execute(),
  )

  if (orderErr || !order) {
    console.log(`[rewards] applyReferralCommission: snapshot credit_orders untuk ${orderId} tidak ditemukan`)
    return { applied: false, reason: 'no_order_snapshot' }
  }

  const commissionIdr = calculateCommission(Number(order.price_idr), policy)
  if (commissionIdr <= 0) {
    return { applied: false, reason: 'zero_commission' }
  }

  // 4. Tulis ke reward_ledger idempoten
  const ref = `commission:${orderId}`
  const { data: grantData, error: grantErr } = await single(
    rpcOne(db, 'grant_reward_v1', {
      p_user_id: attribution.referrer_user_id,
      p_ref: ref,
      p_delta_idr: commissionIdr,
      p_reason: 'referral_commission',
    }).execute(),
  )

  if (grantErr) {
    console.log(`[rewards] applyReferralCommission RPC error: ${grantErr.message}`)
    return { applied: false, reason: grantErr.message }
  }

  const granted = grantData ? ((grantData as Record<string, unknown>).fn ?? grantData) : false
  return { applied: granted === true, commissionIdr }
}
