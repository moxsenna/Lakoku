import 'server-only'
import { createAdminClient } from '@lakoku/db'

/**
 * Grant kredit Play Billing — server-only wrapper RPC play_billing_grant_v1.
 *
 * Idempotensi di level DB: credit_ledger.ref unik 'playbilling:{token}'.
 * Replay (retry klien, klik ganda, duplikat) TIDAK menambah kredit kedua kali;
 * fungsi mengembalikan order existing dengan alreadyGranted=true.
 */

export interface PlayBillingGrantInput {
  userId: string
  productKey: string
  creditsBase: number
  creditsBonus: number
  creditsTotal: number
  purchaseToken: string
  productId: string
  orderNumber: string | null
}

export type PlayBillingGrantResult =
  | { ok: true; orderId: string; alreadyGranted: boolean }
  | { ok: false; error: string }

export async function playBillingGrantV1(
  input: PlayBillingGrantInput,
): Promise<PlayBillingGrantResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('play_billing_grant_v1', {
    p_user_id: input.userId,
    p_product_key: input.productKey,
    p_credits_base: input.creditsBase,
    p_credits_bonus: input.creditsBonus,
    p_credits_total: input.creditsTotal,
    p_purchase_token: input.purchaseToken,
    p_product_id: input.productId,
    p_order_number: input.orderNumber,
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  const orderId = row?.order_id ?? null
  if (!orderId) return { ok: false, error: 'grant_no_order_id' }
  return { ok: true, orderId, alreadyGranted: row?.already_granted === true }
}
