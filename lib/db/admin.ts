import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Client service-role — HANYA untuk kode server tepercaya (runtime lifecycle,
 * fake generation, RPC atomik). Melewati RLS, jadi JANGAN pernah diimpor dari
 * komponen client atau diekspos ke browser. Tabel runtime (story_events,
 * idempotency_keys, generation_leases, outbox) hanya boleh disentuh lewat sini
 * atau lewat RPC SECURITY DEFINER.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'createAdminClient: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.',
    )
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
