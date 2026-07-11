import { listAdminOrders } from '@/lib/admin/orders'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { StatusBadge } from '@/components/admin/status-badge'
import { idr, isoDatetime } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const sp = await searchParams
  const status = sp.status ?? 'all'
  const orders = await listAdminOrders({ status, limit: 50 })

  const statuses = ['all', 'paid', 'created', 'duplicate', 'failed']

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Payments</h1>
        <p className="text-xs text-muted-foreground">Riwayat order/topup.</p>
      </header>

      {/* Filter */}
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <a
            key={s}
            href={`/admin/payments${s !== 'all' ? `?status=${s}` : ''}`}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
              status === s
                ? 'bg-lavender text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </a>
        ))}
      </div>

      <AdminSectionCard title={`${orders.length} orders`}>
        {orders.length === 0 ? (
          <AdminEmptyState message="Tidak ada order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Order ID</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2">Bonus</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">{isoDatetime(o.createdAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{o.orderId.slice(0, 14)}...</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{o.userId.slice(0, 8)}...</td>
                    <td className="px-3 py-1.5">{o.productKey}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{idr(o.priceIdr)}</td>
                    <td className="px-3 py-1.5 text-right">{o.totalCredits}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={o.bonusKind} />
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>
    </div>
  )
}
