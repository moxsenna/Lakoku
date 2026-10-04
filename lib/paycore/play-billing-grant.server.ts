import 'server-only'
import { getDb, rpcOne, single } from '@lakoku/db'

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
  const db = getDb()
  const { data, error } = await single(
    rpcOne(db, 'play_billing_grant_v1', {
      p_user_id: input.userId,
      p_product_key: input.productKey,
      p_credits_base: input.creditsBase,
      p_credits_bonus: input.creditsBonus,
      p_credits_total: input.creditsTotal,
      p_purchase_token: input.purchaseToken,
      p_product_id: input.productId,
      p_order_number: input.orderNumber,
    }).execute(),
  )
  if (error) return { ok: false, error: error.message }
  const row = data as { order_id?: string; already_granted?: boolean } | null
  const orderId = row?.order_id ?? null
  if (!orderId) return { ok: false, error: 'grant_no_order_id' }
  return { ok: true, orderId, alreadyGranted: row?.already_granted === true }
}
