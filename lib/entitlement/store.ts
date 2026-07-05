/**
 * Port penyimpanan entitlement (M8/T8.3).
 *
 * Memisahkan keputusan (engine murni `webhook.ts`) dari efek samping DB.
 *  - `EntitlementStore` = kontrak: rekam event pembayaran secara idempoten &
 *    terapkan grant/revoke lewat SATU perintah.
 *  - `InMemoryEntitlementStore` = implementasi uji (fixture), tak butuh DB.
 *  - Implementasi Supabase riil ada di `store.server.ts` (server-only).
 *
 * Kontrak idempotensi (ARCH §7.4, §8.4):
 *  `recordPaymentEvent(eventId)` mengembalikan `firstSeen=false` bila `eventId`
 *  sudah pernah terlihat → pemanggil TIDAK boleh menerbitkan grant lagi
 *  (dedup replay webhook provider).
 */
import type { EntitlementAction, CheckoutEvent } from './webhook'

export interface RecordEventResult {
  /** true bila event ini pertama kali terlihat; false bila duplikat (replay). */
  firstSeen: boolean
}

export interface EntitlementStore {
  /** Catat event provider secara idempoten berdasarkan `eventId`. */
  recordPaymentEvent(event: CheckoutEvent): Promise<RecordEventResult>
  /** Terapkan grant/revoke untuk (userId, entitlementCode) — dipanggil sekali per event baru. */
  applyEntitlement(
    userId: string,
    entitlementCode: string,
    action: EntitlementAction,
  ): Promise<void>
}

/** Snapshot entitlement aktif (untuk assert di fixture). */
export type EntitlementKey = `${string}::${string}`

/** Implementasi in-memory untuk uji fixture — deterministik, tanpa I/O. */
export class InMemoryEntitlementStore implements EntitlementStore {
  private readonly seenEvents = new Set<string>()
  private readonly active = new Set<EntitlementKey>()
  /** Jumlah panggilan applyEntitlement (untuk assert "tak ada grant ganda"). */
  public applyCount = 0

  async recordPaymentEvent(event: CheckoutEvent): Promise<RecordEventResult> {
    if (this.seenEvents.has(event.eventId)) return { firstSeen: false }
    this.seenEvents.add(event.eventId)
    return { firstSeen: true }
  }

  async applyEntitlement(
    userId: string,
    entitlementCode: string,
    action: EntitlementAction,
  ): Promise<void> {
    this.applyCount += 1
    const key: EntitlementKey = `${userId}::${entitlementCode}`
    if (action === 'grant') this.active.add(key)
    else this.active.delete(key)
  }

  /** Helper uji: apakah entitlement aktif. */
  hasEntitlement(userId: string, entitlementCode: string): boolean {
    return this.active.has(`${userId}::${entitlementCode}`)
  }
}
