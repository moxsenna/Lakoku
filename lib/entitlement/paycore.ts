/**
 * Adapter webhook PayCore → kredit lakoku (M-PAY, inbound).
 *
 * Kontrak (docs/external/payment-events.md, integration-guide §7–§8):
 *  - Header: `X-PayCore-Event-Timestamp: <ISO>`, `X-PayCore-Event-Signature: sha256=<hex>`.
 *  - Canonical HMAC: `{timestampISO}.{rawBody}`; secret = PAYCORE_WEBHOOK_SECRET.
 *  - Skew ±5 menit; event_type MVP satu-satunya: `payment.succeeded`.
 *  - Payload: event_id, event_type, data.order_id, data.fulfillment_data.{user_id,credits}.
 *
 * Invarian keamanan (sama dgn engine generik): HANYA event bertanda tangan valid &
 * segar yang menerbitkan kredit; timing-safe compare; fail-closed di tiap cabang;
 * idempoten via event_id (payment_events) + ref ledger `paycore:{order_id}`.
 *
 * Verify bebas I/O & `server-only` agar bisa diuji di harness.
 */
import { hmacSha256Hex, parseSha256Header, timingSafeEqualHex } from '../paycore/crypto'
import type { EntitlementStore } from './store'

const PAYMENT_SUCCEEDED = 'payment.succeeded'
const DEFAULT_TOLERANCE_MS = 5 * 60_000

export interface PayCoreEvent {
  eventId: string
  eventType: string
  orderId: string
  externalOrderId: string | null
  userId: string
  credits: number
  baseCredits: number | null
  bonusCredits: number | null
  bonusKind: 'first_topup' | 'normal' | 'none' | null
  productKey: string | null
  /** ISO timestamp header terverifikasi. */
  timestamp: string
}

export interface OrderSnapshot {
  totalCredits: number
  bonusKind: string
  productKey: string
  status: string
}

export type PayCoreRejectReason =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'BAD_SIGNATURE'
  | 'STALE_TIMESTAMP'
  | 'MALFORMED_PAYLOAD'
  | 'UNKNOWN_EVENT_TYPE'

export type PayCoreVerifyResult =
  | { ok: true; event: PayCoreEvent }
  | { ok: false; reason: PayCoreRejectReason }

export interface PayCoreVerifyOptions {
  secret: string
  /** Toleransi umur event (default 300_000 ms). */
  toleranceMs?: number
  /** "Sekarang" dalam ms (disuntik agar uji deterministik). */
  nowMs?: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function parsePayload(rawBody: string): PayCoreEvent | { badType: true } | null {
  let obj: unknown
  try {
    obj = JSON.parse(rawBody)
  } catch {
    return null
  }
  const p = asRecord(obj)
  if (!p) return null

  const eventId = p.event_id
  const eventType = p.event_type
  if (typeof eventId !== 'string' || eventId.trim() === '') return null
  if (typeof eventType !== 'string' || eventType.trim() === '') return null
  if (eventType !== PAYMENT_SUCCEEDED) return { badType: true }

  const data = asRecord(p.data)
  if (!data) return null
  const fulfillment = asRecord(data.fulfillment_data)
  if (!fulfillment) return null

  const orderId = data.order_id
  const userId = fulfillment.user_id
  const credits = fulfillment.credits
  const baseCredits = typeof fulfillment.base_credits === 'number' ? fulfillment.base_credits : null
  const bonusCredits = typeof fulfillment.bonus_credits === 'number' ? fulfillment.bonus_credits : null
  const bonusKindRaw = fulfillment.bonus_kind
  const bonusKind: 'first_topup' | 'normal' | 'none' | null =
    bonusKindRaw === 'first_topup' || bonusKindRaw === 'normal' || bonusKindRaw === 'none'
      ? bonusKindRaw
      : null
  const productKey = typeof data.product_key === 'string' ? data.product_key : null
  const externalOrderId = typeof data.external_order_id === 'string' ? data.external_order_id : null

  if (typeof orderId !== 'string' || orderId.trim() === '') return null
  if (typeof userId !== 'string' || userId.trim() === '') return null
  if (typeof credits !== 'number' || !Number.isInteger(credits) || credits <= 0) return null

  return {
    eventId,
    eventType,
    orderId,
    externalOrderId,
    userId,
    credits,
    baseCredits,
    bonusCredits,
    bonusKind,
    productKey,
    timestamp: '', // diisi pemanggil dgn header terverifikasi
  }
}

/** Verifikasi tanda tangan + skew + skema payload event PayCore. Fail-closed. */
export async function verifyPayCoreEvent(
  rawBody: string,
  timestampHeader: string | null | undefined,
  signatureHeader: string | null | undefined,
  opts: PayCoreVerifyOptions,
): Promise<PayCoreVerifyResult> {
  const provided = parseSha256Header(signatureHeader)
  if (!provided) return { ok: false, reason: 'MISSING_SIGNATURE' }
  if (!timestampHeader || timestampHeader.trim() === '') {
    return { ok: false, reason: 'MALFORMED_SIGNATURE' }
  }
  const t = Date.parse(timestampHeader)
  if (Number.isNaN(t)) return { ok: false, reason: 'MALFORMED_SIGNATURE' }

  const expected = await hmacSha256Hex(opts.secret, `${timestampHeader}.${rawBody}`)
  if (!timingSafeEqualHex(expected, provided)) {
    return { ok: false, reason: 'BAD_SIGNATURE' }
  }

  const now = opts.nowMs ?? Date.now()
  const tolerance = opts.toleranceMs ?? DEFAULT_TOLERANCE_MS
  if (Math.abs(now - t) > tolerance) {
    return { ok: false, reason: 'STALE_TIMESTAMP' }
  }

  const parsed = parsePayload(rawBody)
  if (parsed === null) return { ok: false, reason: 'MALFORMED_PAYLOAD' }
  if ('badType' in parsed) return { ok: false, reason: 'UNKNOWN_EVENT_TYPE' }

  return { ok: true, event: { ...parsed, timestamp: timestampHeader } }
}

export type PayCoreProcessOutcome =
  | { status: 'applied'; eventId: string; orderId: string; credits: number }
  | { status: 'duplicate'; eventId: string }
  | { status: 'rejected'; reason: PayCoreRejectReason }

export interface PayCoreProcessDeps {
  store: EntitlementStore
  secret: string
  toleranceMs?: number
  nowMs?: number
}

/**
 * Proses satu event PayCore mentah:
 *   verify → resolve snapshot → grant kredit idempoten (ref `paycore:{order_id}`).
 *  - rejected  → tanda tangan/payload tak valid: JANGAN pernah grant.
 *  - duplicate → order sudah pernah di-grant (ledger `ref` unik): no-op.
 *  - applied   → order baru terverifikasi: kredit di-grant sekali.
 *
 * Snapshot cross-check: bila `credit_orders` punya snapshot untuk `order_id`,
 * gunakan `total_credits` dari DB (lebih aman daripada fulfillment echo).
 * Bila tak ada snapshot, fallback ke `fulfillment_data.credits` ( masih aman
 * karena fulfillment dibuat server-side). Tetap idempoten via ledger `ref`.
 */
export async function processPayCoreWebhook(
  rawBody: string,
  headers: { timestamp: string | null | undefined; signature: string | null | undefined },
  deps: PayCoreProcessDeps,
): Promise<PayCoreProcessOutcome> {
  const verified = await verifyPayCoreEvent(rawBody, headers.timestamp, headers.signature, {
    secret: deps.secret,
    toleranceMs: deps.toleranceMs,
    nowMs: deps.nowMs,
  })
  if (!verified.ok) return { status: 'rejected', reason: verified.reason }

  const { event } = verified

  // Resolve snapshot dari credit_orders (lebih aman). Fallback ke fulfillment.
  let grantCredits = event.credits
  let productKey = event.productKey ?? 'credits'
  let bonusKind = event.bonusKind ?? 'none'

  const snapshot = await deps.store.resolveOrderSnapshot(event.orderId)
  if (snapshot) {
    grantCredits = snapshot.totalCredits
    productKey = snapshot.productKey
    bonusKind = snapshot.bonusKind as 'first_topup' | 'normal' | 'none'
  } else {
    console.log(
      `[v0] paycore webhook: no snapshot for order ${event.orderId}, using fulfillment credits`,
    )
  }

  const ref = `paycore:${event.orderId}`
  const reason = `topup:${productKey}:${bonusKind}`
  const result = await deps.store.grantCredits(event.userId, ref, grantCredits, reason)
  if (!result.granted) return { status: 'duplicate', eventId: event.eventId }

  // Tandai order sebagai paid (snapshot cross-check selesai).
  try {
    await deps.store.markOrderPaid(event.orderId)
  } catch (err) {
    // Non-fatal: kredit sudah di-grant. Log warning.
    console.log('[v0] paycore webhook: markOrderPaid gagal (non-fatal):', (err as Error)?.message)
  }

  return { status: 'applied', eventId: event.eventId, orderId: event.orderId, credits: grantCredits }
}
