/**
 * Orkestrator pemrosesan webhook checkout (M8/T8.3).
 *
 * Alur otoritatif tunggal (ARCH §8.4, §7.4):
 *   verifikasi tanda tangan → rekam event idempoten → SATU grant/revoke.
 *
 * Bebas framework/DB konkret: menerima `EntitlementStore` (port) sehingga bisa
 * diuji penuh dengan `InMemoryEntitlementStore` tanpa jaringan. Route Next.js
 * menyuntik implementasi Supabase + rahasia dari env.
 */
import { verifyCheckoutWebhook, type VerifyOptions, type WebhookRejectReason } from './webhook'
import type { EntitlementStore } from './store'

export type ProcessOutcome =
  | { status: 'applied'; action: 'grant' | 'revoke'; eventId: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'rejected'; reason: WebhookRejectReason }

export interface ProcessDeps {
  store: EntitlementStore
  verify?: Omit<VerifyOptions, 'secret'> & { secret: string }
}

/**
 * Proses satu payload webhook mentah.
 *  - `rejected` → tanda tangan/payload tak valid: JANGAN pernah menerbitkan akses.
 *  - `duplicate` → replay event yang sudah diproses: no-op idempoten.
 *  - `applied`  → event baru terverifikasi: grant/revoke diterapkan sekali.
 */
export async function processCheckoutWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  deps: ProcessDeps,
): Promise<ProcessOutcome> {
  const verified = verifyCheckoutWebhook(rawBody, signatureHeader, deps.verify!)
  if (!verified.ok) {
    return { status: 'rejected', reason: verified.reason }
  }

  const { event } = verified
  const record = await deps.store.recordPaymentEvent(event)
  if (!record.firstSeen) {
    return { status: 'duplicate', eventId: event.eventId }
  }

  await deps.store.applyEntitlement(event.userId, event.entitlementCode, event.action)
  return { status: 'applied', action: event.action, eventId: event.eventId }
}
