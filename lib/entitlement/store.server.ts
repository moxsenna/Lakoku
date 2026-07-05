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
import { createAdminClient } from '@lakoku/db'
import type { EntitlementAction, CheckoutEvent } from './webhook'
import type { EntitlementStore, RecordEventResult } from './store'

const UNIQUE_VIOLATION = '23505'

export class SupabaseEntitlementStore implements EntitlementStore {
  async recordPaymentEvent(event: CheckoutEvent): Promise<RecordEventResult> {
    const supabase = createAdminClient()
    const { error } = await supabase.from('payment_events').insert({
      event_id: event.eventId,
      event_type: event.type,
      user_id: event.userId,
      entitlement_code: event.entitlementCode,
      action: event.action,
      signed_at: new Date(event.signedAt * 1000).toISOString(),
    })
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
    const supabase = createAdminClient()
    const { error } = await supabase.rpc('grant_entitlement_v1', {
      p_user_id: userId,
      p_entitlement_code: entitlementCode,
      p_action: action,
    })
    if (error) throw new Error(`applyEntitlement: ${error.message}`)
  }
}
