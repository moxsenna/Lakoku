import 'server-only'
import { hmacSha256Hex, sha256Hex } from './crypto'
import { loadPayCoreOutboundConfig, type PayCoreOutboundConfig } from './config'
import { getCreditProduct } from './products'

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
  credits: number
  amountIdr: number
}

export type CreateOrderError =
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'unknown_product' }
  | { ok: false; reason: 'paycore_error'; status: number; detail: string }

export type CreateOrderOutcome =
  | ({ ok: true } & CreateCreditOrderResult)
  | CreateOrderError

/**
 * Buat order kredit di PayCore dan kembalikan `checkout_url`. Harga & jumlah
 * kredit diambil dari katalog DB (bukan dari klien) → tak bisa dimanipulasi.
 */
export async function createCreditOrder(
  input: CreateCreditOrderInput,
): Promise<CreateOrderOutcome> {
  const config = loadPayCoreOutboundConfig()
  if (!config) return { ok: false, reason: 'not_configured' }

  const product = await getCreditProduct(input.productKey)
  if (!product) return { ok: false, reason: 'unknown_product' }

  const externalOrderId = input.externalOrderId ?? `lakoku-${crypto.randomUUID()}`
  const body = {
    external_order_id: externalOrderId,
    merchant_profile_id: 'appvibe_default',
    product_key: product.productKey,
    description: `${product.name} — ${product.credits} kredit`,
    amount: product.priceIdr,
    currency: 'IDR',
    customer: input.customer ?? {},
    return_url: config.returnUrl,
    fulfillment_data: {
      user_id: input.userId,
      package_id: product.productKey,
      credits: product.credits,
    },
  }
  const rawBody = JSON.stringify(body)
  const result = await postOrder(config, rawBody)
  if (!result.ok) return result

  return {
    ok: true,
    orderId: result.orderId,
    externalOrderId,
    checkoutUrl: result.checkoutUrl,
    credits: product.credits,
    amountIdr: product.priceIdr,
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
