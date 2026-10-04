/**
 * Implementasi Supabase dari EntitlementStore (M8/T8.3) — SERVER-ONLY.
 *
 * Memakai service-role admin client (melewati RLS) sebab ini jalur backend
 * tepercaya, sesuai ARCH §8.3/§8.4. Idempotensi & grant otoritatif dijaga di
 * DB:
 *  - `recordPaymentEvent` menulis ke `payment_events` dengan `event_id` UNIQUE.
 *    Konflik unik → event duplikat (replay) → firstSeen=false, tanpa grant ulang.
 *  - `applyEntitlement` memanggil SATU perintah `grant_entitlement_v1`
 *    (SECURITY DEFINER) yang menerapkan grant/revoke secara idempoten.
 *
 * Catatan: tabel `payment_events`/`entitlements` dan RPC `grant_entitlement_v1`
 * adalah bagian skema commercial (ARCH §16, §12). Bila belum ada di lingkungan,
 * pemanggilan akan gagal terkendali — route webhook memetakan kegagalan ini ke
 * 5xx agar provider melakukan retry (bukan fail-open ke grant).
 */
import 'server-only'
import { getDb, result, rpcOne, single } from '@lakoku/db'
import type { EntitlementAction, CheckoutEvent } from './webhook'
import type { EntitlementStore, RecordEventResult, GrantCreditsResult, OrderSnapshotResult } from './store'

const UNIQUE_VIOLATION = '23505'

export class SupabaseEntitlementStore implements EntitlementStore {
  async recordPaymentEvent(event: CheckoutEvent): Promise<RecordEventResult> {
    const db = getDb()
    const { error } = await result(
      db
        .insertInto('payment_events')
        .values({
          event_id: event.eventId,
          event_type: event.type,
          user_id: event.userId,
          entitlement_code: event.entitlementCode,
          action: event.action,
          signed_at: new Date(event.signedAt * 1000).toISOString(),
        })
        .execute(),
    )
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { firstSeen: false }
      throw new Error(`recordPaymentEvent: ${error.message}`)
    }
    return { firstSeen: true }
  }

  async applyEntitlement(
    userId: string,
    entitlementCode: string,
    action: EntitlementAction,
  ): Promise<void> {
    const db = getDb()
    const { error } = await single(
      rpcOne(db, 'grant_entitlement_v1', {
        p_user_id: userId,
        p_entitlement_code: entitlementCode,
        p_action: action,
      }).execute(),
    )
    if (error) throw new Error(`applyEntitlement: ${error.message}`)
  }

  async grantCredits(
    userId: string,
    ref: string,
    credits: number,
    reason: string,
  ): Promise<GrantCreditsResult> {
    const db = getDb()
    const { data, error } = await single(
      rpcOne(db, 'grant_credits_v1', {
        p_user_id: userId,
        p_ref: ref,
        p_credits: credits,
        p_reason: reason,
      }).execute(),
    )
    if (error) throw new Error(`grantCredits: ${error.message}`)
    const granted = (data ? ((data as Record<string, unknown>).fn ?? data) : false) === true
    return { granted }
  }

  async resolveOrderSnapshot(orderId: string): Promise<OrderSnapshotResult | null> {
    const db = getDb()
    // RLS_AUDIT: credit_orders_own_read
    const { data, error } = await single(
      db
        .selectFrom('credit_orders')
        .select(['total_credits', 'bonus_kind', 'product_key', 'status'])
        .where('order_id', '=', orderId)
        .limit(1)
        .execute(),
    )
    if (error) throw new Error(`resolveOrderSnapshot: ${error.message}`)
    if (!data) return null
    return {
      totalCredits: data.total_credits,
      bonusKind: data.bonus_kind,
      productKey: data.product_key,
      status: data.status,
    }
  }

  async markOrderPaid(orderId: string): Promise<void> {
    const db = getDb()
    // RLS_AUDIT: credit_orders_own_read
    const { error } = await result(
      db
        .updateTable('credit_orders')
        .set({ status: 'paid', paid_at: new Date().toISOString() })
        .where('order_id', '=', orderId)
        .where('status', 'in', ['created'])
        .execute(),
    )
    if (error) throw new Error(`markOrderPaid: ${error.message}`)
  }
}
