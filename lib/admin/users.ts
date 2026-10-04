import 'server-only'
import { countOf, getDb, result, rpcOne, rpcRows, single } from '@lakoku/db'

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
  const db = getDb()

  // Gunakan RPC untuk cari auth.users by email
  if (query && query.trim().length >= 2) {
    const { data } = await result(
      rpcRows(db, 'admin_search_users_v1', {
        p_email: query.trim(),
      }).execute(),
    )
    if (!data) return []
    return Promise.all(
      (data as { user_id: string; email: string }[]).map((u) =>
        enrichUserItem(u.user_id, u.email),
      ),
    )
  }

  // Fallback: recent users dari reader_taste_profiles
  // RLS_AUDIT: reader_taste_profiles_read
  const { data: rows } = await result(
    db
      .selectFrom('reader_taste_profiles')
      .select(['user_id', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute(),
  )

  if (!rows) return []
  return Promise.all(
    rows.map((r) =>
      enrichUserItem(r.user_id, null),
    ),
  )
}

async function enrichUserItem(
  userId: string,
  emailOverride: string | null,
): Promise<AdminUserListItem> {
  const db = getDb()

  // Credit balance
  let creditBalance = 0
  try {
    const { data } = await single(
      rpcOne(db, 'credit_balance_v1', { p_user_id: userId }).execute(),
    )
    const raw = data ? ((data as Record<string, unknown>).fn ?? data) : 0
    creditBalance = Number(raw ?? 0)
  } catch { /* No-op */ }

  // Paid orders count
  let paidOrdersCount = 0
  try {
    // RLS_AUDIT: credit_orders_read
    paidOrdersCount = await countOf(
      db
        .selectFrom('credit_orders')
        .select(db.fn.countAll().as('n'))
        .where('user_id', '=', userId)
        .where('status', '=', 'paid')
        .execute(),
    )
  } catch { /* No-op */ }

  // User metadata from reader_taste_profiles
  let createdAt: string | null = null
  try {
    // RLS_AUDIT: reader_taste_profiles_read
    const { data: prof } = await single(
      db
        .selectFrom('reader_taste_profiles')
        .select('created_at')
        .where('user_id', '=', userId)
        .limit(1)
        .execute(),
    )
    createdAt = prof?.created_at ? String(prof.created_at) : null
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
  const db = getDb()

  // Email from RPC
  const email: string | null = null
  let createdAt: string | null = null
  try {
    // RLS_AUDIT: reader_taste_profiles_read
    const { data: prof } = await single(
      db
        .selectFrom('reader_taste_profiles')
        .select('created_at')
        .where('user_id', '=', userId)
        .limit(1)
        .execute(),
    )
    createdAt = prof?.created_at ? String(prof.created_at) : null
  } catch { /* No-op */ }

  // Credit balance
  let creditBalance = 0
  try {
    const { data } = await single(
      rpcOne(db, 'credit_balance_v1', { p_user_id: userId }).execute(),
    )
    const raw = data ? ((data as Record<string, unknown>).fn ?? data) : 0
    creditBalance = Number(raw ?? 0)
  } catch { /* No-op */ }

  // Credit stats
  const creditStats = { purchased: 0, bonus: 0, adminGranted: 0, spent: 0 }

  // Ledger (50 rows)
  let ledger: AdminCreditLedgerRow[] = []
  try {
    // RLS_AUDIT: credit_ledger_read
    const { data: l } = await result(
      db
        .selectFrom('credit_ledger')
        .select(['delta', 'reason', 'ref', 'created_at'])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute(),
    )
    if (l) {
      ledger = l.map((r) => ({
        delta: Number(r.delta),
        reason: r.reason,
        ref: r.ref,
        createdAt: String(r.created_at),
      }))
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
    // RLS_AUDIT: credit_orders_read
    const { data: o } = await result(
      db
        .selectFrom('credit_orders')
        .select([
          'order_id',
          'product_key',
          'price_idr',
          'base_credits',
          'bonus_credits',
          'total_credits',
          'bonus_kind',
          'status',
          'created_at',
          'paid_at',
        ])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute(),
    )
    if (o) {
      orders = o.map((r) => ({
        orderId: r.order_id,
        productKey: r.product_key,
        priceIdr: Number(r.price_idr),
        baseCredits: Number(r.base_credits),
        bonusCredits: Number(r.bonus_credits),
        totalCredits: Number(r.total_credits),
        bonusKind: r.bonus_kind,
        status: r.status,
        createdAt: String(r.created_at),
        paidAt: r.paid_at ? String(r.paid_at) : null,
      }))
    }
  } catch { /* No-op */ }

  // Admin grants
  let grants: AdminCreditGrantRow[] = []
  try {
    // RLS_AUDIT: admin_credit_grants_read
    const { data: g } = await result(
      db
        .selectFrom('admin_credit_grants')
        .select(['created_at', 'admin_user_id', 'credits', 'reason', 'ledger_ref'])
        .where('target_user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute(),
    )
    if (g) {
      grants = g.map((r) => ({
        createdAt: String(r.created_at),
        adminUserId: r.admin_user_id,
        credits: Number(r.credits),
        reason: r.reason,
        ledgerRef: r.ledger_ref,
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
