import 'server-only'
import { createAdminClient } from '@lakoku/db'

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
  const db = createAdminClient()
  const limit = args?.limit ?? 50

  let query = db
    .from('credit_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (args?.status && args.status !== 'all') {
    query = query.eq('status', args.status)
  }

  const { data } = await query
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
    createdAt: r.created_at as string,
    paidAt: (r.paid_at as string) ?? null,
  }))
}
