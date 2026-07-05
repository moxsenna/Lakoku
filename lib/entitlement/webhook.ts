/**
 * Verifikasi webhook checkout (M8/T8.3) — ENGINE MURNI, bebas I/O.
 *
 * Invarian keamanan (ARCH §8.4, §26.8 poin 8, §29):
 *  - HANYA event provider yang tanda tangannya terverifikasi server yang boleh
 *    memicu perubahan entitlement. Tak ada payload dari klien/mobile yang
 *    otoritatif.
 *  - Verifikasi tanda tangan HMAC-SHA256 memakai perbandingan waktu-konstan
 *    (timing-safe) untuk mencegah kebocoran lewat timing.
 *  - Anti-replay: stempel waktu wajib berada dalam toleransi (default 5 menit),
 *    dan penerbitan akses dedup lewat keunikan `eventId` (di lapisan store).
 *  - Payload di-parse & divalidasi skema sebelum dipetakan ke keputusan
 *    grant/revoke. Nilai tak dikenal → ditolak, tidak "fail-open".
 *
 * Provider-agnostik: format tanda tangan mengikuti konvensi umum
 * `t=<unix>,v1=<hex-hmac>` (kompatibel Stripe) di atas payload
 * `"{t}.{rawBody}"`. Rahasia disuntik dari luar (env di lapisan server).
 */
import crypto from 'node:crypto'

export type EntitlementAction = 'grant' | 'revoke'

/** Jenis event provider yang dikenali dan pemetaannya ke aksi entitlement. */
const EVENT_ACTION_MAP: Record<string, EntitlementAction> = {
  'checkout.completed': 'grant',
  'checkout.session.completed': 'grant',
  'payment.succeeded': 'grant',
  'charge.refunded': 'revoke',
  'subscription.canceled': 'revoke',
  'entitlement.revoked': 'revoke',
}

export interface CheckoutEvent {
  /** ID event unik dari provider — kunci dedup/idempotensi penerbitan. */
  eventId: string
  /** Jenis event provider mentah (mis. `checkout.completed`). */
  type: string
  /** Aksi entitlement tervalidasi hasil pemetaan `type`. */
  action: EntitlementAction
  /** User penerima entitlement (dari metadata event terverifikasi server). */
  userId: string
  /** Kode entitlement yang diberikan/dicabut (mis. `story_create`, `chapter_pack`). */
  entitlementCode: string
  /** Stempel waktu tanda tangan (unix detik). */
  signedAt: number
}

export type WebhookRejectReason =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'BAD_SIGNATURE'
  | 'STALE_TIMESTAMP'
  | 'MALFORMED_PAYLOAD'
  | 'UNKNOWN_EVENT_TYPE'

export type VerifyResult =
  | { ok: true; event: CheckoutEvent }
  | { ok: false; reason: WebhookRejectReason }

export interface VerifyOptions {
  /** Rahasia bersama untuk HMAC (dari env di sisi server). */
  secret: string
  /** Toleransi umur tanda tangan dalam detik (default 300 = 5 menit). */
  toleranceSeconds?: number
  /** Waktu "sekarang" (unix detik) — disuntik agar uji deterministik. */
  nowSeconds?: number
}

const DEFAULT_TOLERANCE = 300

/** Parse header tanda tangan `t=<unix>,v1=<hex>` → {t, v1}. */
function parseSignatureHeader(
  header: string,
): { t: number; v1: string } | null {
  const parts = header.split(',').map((s) => s.trim())
  let t: number | null = null
  let v1: string | null = null
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq)
    const val = part.slice(eq + 1)
    if (key === 't') {
      if (val.trim() === '' || Number.isNaN(Number(val))) return null
      t = Number(val)
    } else if (key === 'v1') {
      v1 = val
    }
  }
  if (t === null || v1 === null || v1 === '') return null
  return { t, v1 }
}

/** Hitung HMAC-SHA256 hex atas `"{t}.{rawBody}"`. */
export function computeSignature(
  rawBody: string,
  timestamp: number,
  secret: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
}

/** Bandingkan dua hex secara timing-safe; false bila panjang beda / non-hex. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let bufA: Buffer
  let bufB: Buffer
  try {
    bufA = Buffer.from(a, 'hex')
    bufB = Buffer.from(b, 'hex')
  } catch {
    return false
  }
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function parseEventPayload(rawBody: string): Omit<CheckoutEvent, 'action' | 'signedAt'> | null {
  let obj: unknown
  try {
    obj = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const p = obj as Record<string, unknown>
  const eventId = p.id ?? p.event_id
  const type = p.type
  const data = (p.data && typeof p.data === 'object' ? p.data : p) as Record<string, unknown>
  const userId = data.user_id ?? data.userId
  const entitlementCode = data.entitlement_code ?? data.entitlementCode
  if (
    typeof eventId !== 'string' || eventId.trim() === '' ||
    typeof type !== 'string' || type.trim() === '' ||
    typeof userId !== 'string' || userId.trim() === '' ||
    typeof entitlementCode !== 'string' || entitlementCode.trim() === ''
  ) {
    return null
  }
  return { eventId, type, userId, entitlementCode }
}

/**
 * Verifikasi tanda tangan + stempel waktu + skema payload, lalu petakan ke
 * event entitlement tervalidasi. Fail-closed di setiap cabang.
 */
export function verifyCheckoutWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  opts: VerifyOptions,
): VerifyResult {
  if (!signatureHeader || signatureHeader.trim() === '') {
    return { ok: false, reason: 'MISSING_SIGNATURE' }
  }
  const parsed = parseSignatureHeader(signatureHeader)
  if (!parsed) return { ok: false, reason: 'MALFORMED_SIGNATURE' }

  const expected = computeSignature(rawBody, parsed.t, opts.secret)
  if (!timingSafeEqualHex(expected, parsed.v1)) {
    return { ok: false, reason: 'BAD_SIGNATURE' }
  }

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE
  if (Math.abs(now - parsed.t) > tolerance) {
    return { ok: false, reason: 'STALE_TIMESTAMP' }
  }

  const payload = parseEventPayload(rawBody)
  if (!payload) return { ok: false, reason: 'MALFORMED_PAYLOAD' }

  const action = EVENT_ACTION_MAP[payload.type]
  if (!action) return { ok: false, reason: 'UNKNOWN_EVENT_TYPE' }

  return {
    ok: true,
    event: { ...payload, action, signedAt: parsed.t },
  }
}
