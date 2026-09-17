import { createAdminClient } from '@lakoku/db'
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

  const db = createAdminClient()

  // 1. Cari ikatan atribusi pembeli
  const { data: attribution, error: attrErr } = await db
    .from('referral_attributions')
    .select('referrer_user_id,window_ends_at')
    .eq('referred_user_id', buyerUserId)
    .maybeSingle()

  if (attrErr || !attribution) {
    return { applied: false, reason: 'no_attribution' }
  }

  // 2. Cek apakah masih dalam jendela waktu
  const nowIso = new Date().toISOString()
  if (attribution.window_ends_at < nowIso) {
    return { applied: false, reason: 'window_expired' }
  }

  // 3. Ambil snapshot price_idr dari credit_orders
  const { data: order, error: orderErr } = await db
    .from('credit_orders')
    .select('price_idr')
    .eq('order_id', orderId)
    .maybeSingle()

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
  const { data: granted, error: grantErr } = await db.rpc('grant_reward_v1', {
    p_user_id: attribution.referrer_user_id,
    p_ref: ref,
    p_delta_idr: commissionIdr,
    p_reason: 'referral_commission',
  })

  if (grantErr) {
    console.log(`[rewards] applyReferralCommission RPC error: ${grantErr.message}`)
    return { applied: false, reason: grantErr.message }
  }

  return { applied: granted === true, commissionIdr }
}
