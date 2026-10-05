import 'server-only'
import { getDb, result } from '@lakoku/db'

export interface AdminOrderRow {
  id: string
  orderId: string
  userId: string
  productKey: string
  priceIdr: number
  baseCredits: number
  bonusCredits: number
  totalCredits: number
  bonusKind: 'none' | 'normal' | 'first_topup'
  status: 'created' | 'paid' | 'duplicate' | 'failed'
  createdAt: string
  paidAt: string | null
}

export async function listAdminOrders(args?: {
  status?: string
  limit?: number
}): Promise<AdminOrderRow[]> {
  const db = getDb()
  const limit = args?.limit ?? 50

  // RLS_AUDIT: credit_orders_own_read
  let query = db
    .selectFrom('credit_orders')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)

  if (args?.status && args.status !== 'all') {
    query = query.where('status', '=', args.status)
  }

  const { data } = await result(query.execute())
  if (!data) return []

  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    orderId: r.order_id as string,
    userId: r.user_id as string,
    productKey: r.product_key as string,
    priceIdr: r.price_idr as number,
    baseCredits: r.base_credits as number,
    bonusCredits: r.bonus_credits as number,
    totalCredits: r.total_credits as number,
    bonusKind: r.bonus_kind as 'none' | 'normal' | 'first_topup',
    status: r.status as AdminOrderRow['status'],
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
    paidAt: r.paid_at ? (r.paid_at instanceof Date ? r.paid_at.toISOString() : String(r.paid_at)) : null,
  }))
}
