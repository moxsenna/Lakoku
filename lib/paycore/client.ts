import 'server-only'
import { hmacSha256Hex, sha256Hex } from './crypto'
import { loadPayCoreOutboundConfig, type PayCoreOutboundConfig } from './config'
import { getCreditProduct, calculateTopupCredits, type CreditProduct, type TopupCreditCalculation } from './products'
import { createAdminClient } from '@lakoku/db'

/**
 * Client outbound PayCore (server-only): membuat order pembelian kredit dan
 * menandatangani request app sesuai integration-guide §6.
 *
 * Canonical signature request:  `{timestamp}.{METHOD}.{path}.{sha256hex(rawBody)}`
 * Header:  X-PayCore-App, X-PayCore-Key-Id, X-PayCore-Timestamp,
 *          X-PayCore-Signature: sha256=<hex>, Idempotency-Key.
 *
 * Otoritas fulfillment tetap di webhook: `fulfillment_data.credits` yang kita
 * kirim di sini di-echo balik PayCore saat `payment.succeeded`, lalu itulah yang
 * di-grant. Tak ada grant dari sisi klien/return URL.
 *
 * Bonus topup dihitung server-side (bukan dari client): base + bonus pertama
 * kali / normal. Snapshot disimpan di `credit_orders` agar webinar lama tetap
 * bisa diaudit walau harga/bonus berubah kelak.
 */

/** Kredensial + string canonical untuk sign request app PayCore. */
export async function buildAppRequestSignature(params: {
  appSecret: string
  timestamp: string
  method: string
  path: string
  rawBody: string
}): Promise<string> {
  const bodyHash = await sha256Hex(params.rawBody)
  const message = `${params.timestamp}.${params.method.toUpperCase()}.${params.path}.${bodyHash}`
  return hmacSha256Hex(params.appSecret, message)
}

export interface CreateCreditOrderInput {
  /** User lakoku penerima kredit (auth.users.id). */
  userId: string
  /** product_key dari katalog `credit_products`. */
  productKey: string
  /** Data pembeli (opsional, diteruskan ke Duitku via PayCore). */
  customer?: { name?: string; email?: string; phone?: string }
  /** Override external_order_id (default: acak). */
  externalOrderId?: string
}

export interface CreateCreditOrderResult {
  orderId: string
  externalOrderId: string
  checkoutUrl: string
  baseCredits: number
  bonusCredits: number
  totalCredits: number
  bonusKind: 'first_topup' | 'normal' | 'none'
  amountIdr: number
}

export type CreateOrderError =
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'unknown_product' }
  | { ok: false; reason: 'missing_customer_email' }
  | { ok: false; reason: 'paycore_error'; status: number; detail: string }

export type CreateOrderOutcome =
  | ({ ok: true } & CreateCreditOrderResult)
  | CreateOrderError

/** Cek apakah user sudah pernah topup berbayar (untuk bonus first topup). */
async function hasPaidTopup(userId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('has_paid_topup_v1', { p_user_id: userId })
  if (error) throw new Error(`hasPaidTopup: ${error.message}`)
  return data === true
}

/**
 * Buat order kredit di PayCore dan kembalikan `checkout_url`. Harga & jumlah
 * kredit diambil dari katalog DB (bukan dari klien) → tak bisa dimanipulasi.
 * Bonus dihitung server-side; snapshot disimpan di `credit_orders`.
 */
export async function createCreditOrder(
  input: CreateCreditOrderInput,
): Promise<CreateOrderOutcome> {
  const config = loadPayCoreOutboundConfig()
  if (!config) return { ok: false, reason: 'not_configured' }

  const product = await getCreditProduct(input.productKey)
  if (!product) return { ok: false, reason: 'unknown_product' }

  // PayCore mewajibkan customer.name + email valid (src/schemas/order.ts).
  const email = input.customer?.email?.trim()
  if (!email) return { ok: false, reason: 'missing_customer_email' }
  const name = input.customer?.name?.trim() || email.split('@')[0] || 'Pembaca Lakoku'
  const phone = input.customer?.phone?.trim()

  // Hitung bonus server-side: first topup atau normal.
  const firstTopup = await hasPaidTopup(input.userId)
  const calc = calculateTopupCredits(product, firstTopup)

  const externalOrderId = input.externalOrderId ?? `lakoku-${crypto.randomUUID()}`
  // merchant_profile_id sengaja TAK dikirim: PayCore memakai default app
  // (order-service memvalidasi id eksplisit = default_merchant_profile_id/PK,
  // sehingga mengirim profile_key malah 403).
  const body = {
    external_order_id: externalOrderId,
    product_key: product.productKey,
    description: `${product.name} — ${calc.totalCredits} kredit`,
    amount: product.priceIdr,
    currency: 'IDR',
    customer: { name, email, ...(phone ? { phone } : {}) },
    return_url: config.returnUrl,
    fulfillment_data: {
      user_id: input.userId,
      package_id: product.productKey,
      base_credits: calc.baseCredits,
      bonus_credits: calc.bonusCredits,
      credits: calc.totalCredits,
      bonus_kind: calc.bonusKind,
    },
  }
  const rawBody = JSON.stringify(body)
  const result = await postOrder(config, rawBody)
  if (!result.ok) return result

  // Simpan snapshot order agar webhook bisa cross-check & audit trail tetap utuh.
  await insertCreditOrderSnapshot({
    orderId: result.orderId,
    userId: input.userId,
    productKey: product.productKey,
    priceIdr: product.priceIdr,
    calc,
  })

  return {
    ok: true,
    orderId: result.orderId,
    externalOrderId,
    checkoutUrl: result.checkoutUrl,
    baseCredits: calc.baseCredits,
    bonusCredits: calc.bonusCredits,
    totalCredits: calc.totalCredits,
    bonusKind: calc.bonusKind,
    amountIdr: product.priceIdr,
  }
}

/** Simpan snapshot order ke `credit_orders` untuk audit & webhook cross-check. */
async function insertCreditOrderSnapshot(args: {
  orderId: string
  userId: string
  productKey: string
  priceIdr: number
  calc: TopupCreditCalculation
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('credit_orders').insert({
    order_id: args.orderId,
    user_id: args.userId,
    product_key: args.productKey,
    price_idr: args.priceIdr,
    base_credits: args.calc.baseCredits,
    bonus_credits: args.calc.bonusCredits,
    total_credits: args.calc.totalCredits,
    bonus_kind: args.calc.bonusKind,
    status: 'created',
  })
  if (error) {
    // Bukan fatal: order di PayCore sudah dibuat. Log warning, lanjut.
    console.log('[v0] credit_orders insert gagal (non-fatal):', error.message)
  }
}

async function postOrder(
  config: PayCoreOutboundConfig,
  rawBody: string,
): Promise<
  | { ok: true; orderId: string; checkoutUrl: string }
  | { ok: false; reason: 'paycore_error'; status: number; detail: string }
> {
  const path = '/v1/orders'
  const timestamp = new Date().toISOString()
  const signature = await buildAppRequestSignature({
    appSecret: config.appSecret,
    timestamp,
    method: 'POST',
    path,
    rawBody,
  })

  let res: Response
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PayCore-App': config.appId,
        'X-PayCore-Key-Id': config.keyId,
        'X-PayCore-Timestamp': timestamp,
        'X-PayCore-Signature': `sha256=${signature}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: rawBody,
    })
  } catch (err) {
    return { ok: false, reason: 'paycore_error', status: 0, detail: (err as Error).message }
  }

  const text = await res.text()
  if (!res.ok) {
    return { ok: false, reason: 'paycore_error', status: res.status, detail: text.slice(0, 500) }
  }
  let parsed: { order_id?: string; checkout_url?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'paycore_error', status: res.status, detail: 'invalid JSON from PayCore' }
  }
  if (!parsed.order_id || !parsed.checkout_url) {
    return { ok: false, reason: 'paycore_error', status: res.status, detail: 'missing order_id/checkout_url' }
  }
  return { ok: true, orderId: parsed.order_id, checkoutUrl: parsed.checkout_url }
}
