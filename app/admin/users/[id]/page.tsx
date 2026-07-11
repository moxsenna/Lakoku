import { loadAdminUserDetail } from '@/lib/admin/users'
import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminErrorState } from '@/components/admin/admin-error-state'
import { StatusBadge } from '@/components/admin/status-badge'
import { GrantCreditForm } from '@/components/admin/grant-credit-form'
import { idr, isoDatetime } from '@/lib/admin/format'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let detail = await loadAdminUserDetail(id)

  if (!detail) return notFound()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">
          {detail.email ?? detail.id}
        </h1>
        <p className="text-xs text-muted-foreground font-mono">{detail.id}</p>
      </header>

      {/* Identity + Balance */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard title="Credit Balance" value={detail.creditBalance} />
        <AdminStatCard title="Joined" value={isoDatetime(detail.createdAt)} />
        <AdminStatCard title="Purchased" value={detail.creditStats.purchased} />
        <AdminStatCard title="Spent" value={detail.creditStats.spent} tone="warn" />
      </div>

      {/* Grant Credit Form */}
      <AdminSectionCard title="Grant Kredit">
        <div className="p-3">
          <GrantCreditForm targetUserId={id} />
        </div>
      </AdminSectionCard>

      {/* Credit Ledger */}
      <AdminSectionCard title={`Credit Ledger (${detail.ledger.length})`} subtitle="50 transaksi terbaru">
        {detail.ledger.length === 0 ? (
          <AdminEmptyState message="Belum ada transaksi kredit." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Delta</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {detail.ledger.map((r, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {isoDatetime(r.createdAt)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                        r.delta >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {r.delta > 0 ? '+' : ''}
                      {r.delta}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={r.reason} />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground max-w-[150px] truncate">
                      {r.ref}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Orders */}
      <AdminSectionCard title={`Orders (${detail.orders.length})`}>
        {detail.orders.length === 0 ? (
          <AdminEmptyState message="Belum ada order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Order ID</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((o) => (
                  <tr key={o.orderId} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {isoDatetime(o.createdAt)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">
                      {o.orderId.slice(0, 12)}...
                    </td>
                    <td className="px-3 py-1.5">{o.productKey}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{idr(o.priceIdr)}</td>
                    <td className="px-3 py-1.5 text-right">
                      {o.totalCredits}
                      {o.bonusCredits > 0 && (
                        <span className="text-emerald-600">
                          {' (+'}
                          {o.bonusCredits}
                          {')'}
                        </span>
                      )}
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

      {/* Admin Grants */}
      <AdminSectionCard title={`Admin Grants (${detail.grants.length})`}>
        {detail.grants.length === 0 ? (
          <AdminEmptyState message="Belum ada admin grant." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {detail.grants.map((g, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {isoDatetime(g.createdAt)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600">
                      +{g.credits}
                    </td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate">
                      {g.reason}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground max-w-[150px] truncate">
                      {g.ledgerRef}
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
