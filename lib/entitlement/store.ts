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

export interface GrantCreditsResult {
  /** true bila baris ledger baru ditulis; false bila `ref` sudah pernah di-grant. */
  granted: boolean
}

export interface OrderSnapshotResult {
  totalCredits: number
  bonusKind: string
  productKey: string
  status: string
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
  /**
   * Tambah kredit ke ledger user secara idempoten berdasarkan `ref`
   * (mis. `paycore:{order_id}`). Dipanggil sekali per event pembayaran baru.
   */
  grantCredits(
    userId: string,
    ref: string,
    credits: number,
    reason: string,
  ): Promise<GrantCreditsResult>
  /**
   * Cari snapshot order di `credit_orders` berdasarkan `orderId`.
   * Return `null` bila tak ada snapshot (fallback ke fulfillment credits).
   */
  resolveOrderSnapshot(orderId: string): Promise<OrderSnapshotResult | null>
  /**
   * Tandai order sebagai `paid` (status + paid_at). Idempoten.
   */
  markOrderPaid(orderId: string): Promise<void>
}

/** Snapshot entitlement aktif (untuk assert di fixture). */
export type EntitlementKey = `${string}::${string}`

/** Implementasi in-memory untuk uji fixture — deterministik, tanpa I/O. */
export class InMemoryEntitlementStore implements EntitlementStore {
  private readonly seenEvents = new Set<string>()
  private readonly active = new Set<EntitlementKey>()
  private readonly seenRefs = new Set<string>()
  private readonly balances = new Map<string, number>()
  private readonly orderSnapshots = new Map<string, OrderSnapshotResult>()
  private readonly paidOrders = new Set<string>()
  /** Jumlah panggilan applyEntitlement (untuk assert "tak ada grant ganda"). */
  public applyCount = 0
  /** Jumlah panggilan grantCredits yang benar-benar menulis (untuk assert idempoten). */
  public grantCreditsCount = 0

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

  async grantCredits(
    userId: string,
    ref: string,
    credits: number,
    _reason: string,
  ): Promise<GrantCreditsResult> {
    if (this.seenRefs.has(ref)) return { granted: false }
    this.seenRefs.add(ref)
    this.grantCreditsCount += 1
    this.balances.set(userId, (this.balances.get(userId) ?? 0) + credits)
    return { granted: true }
  }

  async resolveOrderSnapshot(orderId: string): Promise<OrderSnapshotResult | null> {
    return this.orderSnapshots.get(orderId) ?? null
  }

  async markOrderPaid(orderId: string): Promise<void> {
    this.paidOrders.add(orderId)
    const snap = this.orderSnapshots.get(orderId)
    if (snap) this.orderSnapshots.set(orderId, { ...snap, status: 'paid' })
  }

  /** Helper uji: injeksi snapshot order untuk simulasi. */
  setOrderSnapshot(orderId: string, snapshot: OrderSnapshotResult): void {
    this.orderSnapshots.set(orderId, snapshot)
  }

  /** Helper uji: apakah entitlement aktif. */
  hasEntitlement(userId: string, entitlementCode: string): boolean {
    return this.active.has(`${userId}::${entitlementCode}`)
  }

  /** Helper uji: saldo kredit user. */
  creditBalance(userId: string): number {
    return this.balances.get(userId) ?? 0
  }
}
