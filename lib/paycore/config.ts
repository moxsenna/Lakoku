import 'server-only'

/**
 * Resolusi konfigurasi PayCore dari env (server-only). Fail-closed: bila kredensial
 * kurang, loader mengembalikan `null` dan route memetakan ke 503 (bukan mengarang
 * order/verifikasi). Nilai di-set via `wrangler secret put` (lihat docs/PAYCORE_INTEGRATION.md).
 *
 * Staging vs production hanya beda nilai env (base URL + secrets) — kode identik.
 */

/** Rahasia webhook untuk verifikasi event masuk (`payment.succeeded`). */
export function getPayCoreWebhookSecret(): string | null {
  return process.env.PAYCORE_WEBHOOK_SECRET || null
}

export interface PayCoreOutboundConfig {
  /** Base URL PayCore (staging: pay-staging.appvibe.biz.id, prod: pay.appvibe.biz.id). */
  baseUrl: string
  /** Slug app lakoku terdaftar di PayCore. */
  appId: string
  /** Key id untuk penandatanganan request app. */
  keyId: string
  /** Rahasia app untuk HMAC request outbound. */
  appSecret: string
  /** URL redirect balik ke lakoku setelah bayar. */
  returnUrl: string
}

/** Muat konfigurasi outbound (pembuatan order). `null` bila ada yang kurang. */
export function loadPayCoreOutboundConfig(): PayCoreOutboundConfig | null {
  const baseUrl = process.env.PAYCORE_BASE_URL
  const appId = process.env.PAYCORE_APP_ID
  const keyId = process.env.PAYCORE_KEY_ID
  const appSecret = process.env.PAYCORE_APP_SECRET
  const returnUrl = process.env.PAYCORE_RETURN_URL
  if (!baseUrl || !appId || !keyId || !appSecret || !returnUrl) return null
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    appId,
    keyId,
    appSecret,
    returnUrl,
  }
}
