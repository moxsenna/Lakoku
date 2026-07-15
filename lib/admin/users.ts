import 'server-only'
import { createAdminClient } from '@lakoku/db'

export interface AdminUserListItem {
  id: string
  email: string | null
  createdAt: string | null
  lastSignInAt: string | null
  creditBalance: number
  paidOrdersCount: number
}

/** Cari user dari tabel reader_taste_profiles (proxy untuk registered users). */
export async function searchAdminUsers(query?: string): Promise<AdminUserListItem[]> {
  const db = createAdminClient()

  // Gunakan RPC untuk cari auth.users by email
  if (query && query.trim().length >= 2) {
    const { data } = await db.rpc('admin_search_users_v1', {
      p_email: query.trim(),
    })
    if (!data) return []
    return Promise.all(
      (data as { user_id: string; email: string }[]).map((u) =>
        enrichUserItem(u.user_id, u.email),
      ),
    )
  }

  // Fallback: recent users dari reader_taste_profiles
  const { data: rows } = await db
    .from('reader_taste_profiles')
    .select('user_id,created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  if (!rows) return []
  return Promise.all(
    (rows as { user_id: string; created_at: string }[]).map((r) =>
      enrichUserItem(r.user_id, null),
    ),
  )
}

async function enrichUserItem(
  userId: string,
  emailOverride: string | null,
): Promise<AdminUserListItem> {
  const db = createAdminClient()

  // Credit balance
  let creditBalance = 0
  try {
    const { data } = await db.rpc('credit_balance_v1', { p_user_id: userId })
    creditBalance = (data as number) ?? 0
  } catch { /* No-op */ }

  // Paid orders count
  let paidOrdersCount = 0
  try {
    const { count } = await db
      .from('credit_orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'paid')
    paidOrdersCount = count ?? 0
  } catch { /* No-op */ }

  // User metadata from reader_taste_profiles
  let createdAt: string | null = null
  try {
    const { data: prof } = await db
      .from('reader_taste_profiles')
      .select('created_at')
      .eq('user_id', userId)
      .maybeSingle()
    createdAt = (prof as { created_at: string } | null)?.created_at ?? null
  } catch { /* No-op */ }

  return {
    id: userId,
    email: emailOverride,
    createdAt,
    lastSignInAt: null,
    creditBalance,
    paidOrdersCount,
  }
}

export interface AdminCreditLedgerRow {
  delta: number
  reason: string
  ref: string
  createdAt: string
}

export interface AdminCreditGrantRow {
  createdAt: string
  adminUserId: string
  credits: number
  reason: string
  ledgerRef: string
}

export interface AdminOrderRow {
  orderId: string
  productKey: string
  priceIdr: number
  baseCredits: number
  bonusCredits: number
  totalCredits: number
  bonusKind: string
  status: string
  createdAt: string
  paidAt: string | null
}

export interface AdminUserDetail {
  id: string
  email: string | null
  createdAt: string | null
  lastSignInAt: string | null
  creditBalance: number
  creditStats: {
    purchased: number
    bonus: number
    adminGranted: number
    spent: number
  }
  ledger: AdminCreditLedgerRow[]
  orders: AdminOrderRow[]
  grants: AdminCreditGrantRow[]
}

export async function loadAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const db = createAdminClient()

  // Email from RPC
  const email: string | null = null
  let createdAt: string | null = null
  try {
    const { data: prof } = await db
      .from('reader_taste_profiles')
      .select('created_at')
      .eq('user_id', userId)
      .maybeSingle()
    createdAt = (prof as { created_at: string } | null)?.created_at ?? null
  } catch { /* No-op */ }

  // Credit balance
  let creditBalance = 0
  try {
    const { data } = await db.rpc('credit_balance_v1', { p_user_id: userId })
    creditBalance = (data as number) ?? 0
  } catch { /* No-op */ }

  // Credit stats
  const creditStats = { purchased: 0, bonus: 0, adminGranted: 0, spent: 0 }

  // Ledger (50 rows)
  let ledger: AdminCreditLedgerRow[] = []
  try {
    const { data: l } = await db
      .from('credit_ledger')
      .select('delta,reason,ref,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (l) {
      ledger = (l as { delta: number; reason: string; ref: string; created_at: string }[]).map(
        (r) => ({
          delta: r.delta,
          reason: r.reason,
          ref: r.ref,
          createdAt: r.created_at,
        }),
      )
      for (const row of ledger) {
        if (row.reason.startsWith('topup:')) {
          creditStats.purchased += Math.max(0, row.delta)
        } else if (row.reason === 'admin_grant') {
          creditStats.adminGranted += row.delta
        }
        if (row.delta < 0) creditStats.spent += Math.abs(row.delta)
      }
    }
  } catch { /* No-op */ }

  // Orders
  let orders: AdminOrderRow[] = []
  try {
    const { data: o } = await db
      .from('credit_orders')
      .select(
        'order_id,product_key,price_idr,base_credits,bonus_credits,total_credits,bonus_kind,status,created_at,paid_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (o) {
      orders = (o as Record<string, unknown>[]).map((r) => ({
        orderId: r.order_id as string,
        productKey: r.product_key as string,
        priceIdr: r.price_idr as number,
        baseCredits: r.base_credits as number,
        bonusCredits: r.bonus_credits as number,
        totalCredits: r.total_credits as number,
        bonusKind: r.bonus_kind as string,
        status: r.status as string,
        createdAt: r.created_at as string,
        paidAt: (r.paid_at as string) ?? null,
      }))
    }
  } catch { /* No-op */ }

  // Admin grants
  let grants: AdminCreditGrantRow[] = []
  try {
    const { data: g } = await db
      .from('admin_credit_grants')
      .select('created_at,admin_user_id,credits,reason,ledger_ref')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (g) {
      grants = (g as Record<string, unknown>[]).map((r) => ({
        createdAt: r.created_at as string,
        adminUserId: r.admin_user_id as string,
        credits: r.credits as number,
        reason: r.reason as string,
        ledgerRef: r.ledger_ref as string,
      }))
    }
  } catch { /* No-op */ }

  return {
    id: userId,
    email,
    createdAt,
    lastSignInAt: null,
    creditBalance,
    creditStats,
    ledger,
    orders,
    grants,
  }
}
