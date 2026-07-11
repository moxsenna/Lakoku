import 'server-only'
import { createAdminClient } from '@lakoku/db'

/**
 * Helper untuk grant kredit manual oleh admin (server-only).
 *
 * Memakai RPC `admin_grant_credits_v1` yang atomic: insert audit row + ledger
 * row dalam satu transaksi. Idempoten via `ledger_ref` unique.
 *
 * Admin identity: untuk MVP, admin diidentifikasi via `RUNTIME_ADMIN_TOKEN`
 * (shared-secret guard). `adminUserId` di sini adalah ID user admin dari sesi
 * auth (bila guard berbasis user dikembangkan nanti). Saat ini fallback
 * ke sentinel 'admin-token' bila tak ada user session.
 */

/**
 * Grant kredit manual ke user target. Semua grant tercatat di
 * `admin_credit_grants` (audit trail) + `credit_ledger` (append-only).
 *
 * @returns `{ granted: true, ref }` bila baru; `{ granted: false, ref }` bila duplikat.
 */
export async function adminGrantCredits(args: {
  targetUserId: string
  adminUserId: string
  credits: number
  reason: string
  requestId?: string
}): Promise<{ granted: boolean; ref: string }> {
  const ref =
    args.requestId ??
    `admin_grant:${args.targetUserId}:${Date.now()}:${crypto.randomUUID()}`

  const db = createAdminClient()

  const { data, error } = await db.rpc('admin_grant_credits_v1', {
    p_target_user_id: args.targetUserId,
    p_admin_user_id: args.adminUserId,
    p_credits: args.credits,
    p_reason: args.reason,
    p_ref: ref,
  })

  if (error) throw new Error(`adminGrantCredits: ${error.message}`)

  return { granted: data === true, ref }
}
