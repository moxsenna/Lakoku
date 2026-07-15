import { createAdminClient } from '@lakoku/db'
import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { StatusBadge } from '@/components/admin/status-badge'
import { GrantCreditForm } from '@/components/admin/grant-credit-form'
import { isoDatetime } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

export default async function AdminCreditsPage() {
  const db = createAdminClient()

  // Aggregate stats
  let totalCirculating = 0
  let totalPurchased = 0
  let totalAdminGranted = 0
  let totalSpent = 0
  let grantsToday = 0

  try {
    const { data: ledger } = await db.from('credit_ledger').select('delta,reason')
    if (ledger) {
      for (const r of ledger as { delta: number; reason: string }[]) {
        totalCirculating += r.delta
        if (r.reason === 'admin_grant') totalAdminGranted += r.delta
        if (r.reason.startsWith('topup:')) totalPurchased += r.delta
        if (r.delta < 0) totalSpent += Math.abs(r.delta)
      }
    }
  } catch {/* No-op */}

  // Latest ledger (30 rows)
  let ledgerRows: { createdAt: string; userId: string; delta: number; reason: string; ref: string }[] = []
  try {
    const { data } = await db
      .from('credit_ledger')
      .select('created_at,user_id,delta,reason,ref')
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) {
      ledgerRows = (data as Record<string, unknown>[]).map((r) => ({
        createdAt: r.created_at as string,
        userId: r.user_id as string,
        delta: r.delta as number,
        reason: r.reason as string,
        ref: r.ref as string,
      }))
    }
  } catch {/* No-op */}

  // Latest admin grants (20 rows)
  let grantRows: { createdAt: string; targetUserId: string; adminUserId: string; credits: number; reason: string; ledgerRef: string }[] = []
  try {
    const { data } = await db
      .from('admin_credit_grants')
      .select('created_at,target_user_id,admin_user_id,credits,reason,ledger_ref')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) {
      grantRows = (data as Record<string, unknown>[]).map((r) => ({
        createdAt: r.created_at as string,
        targetUserId: r.target_user_id as string,
        adminUserId: r.admin_user_id as string,
        credits: r.credits as number,
        reason: r.reason as string,
        ledgerRef: r.ledger_ref as string,
      }))
    }
  } catch {/* No-op */}

  const today = new Date().toISOString().slice(0, 10)
  try {
    const { count } = await db
      .from('admin_credit_grants')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00`)
    grantsToday = count ?? 0
  } catch {/* No-op */}

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Credits</h1>
        <p className="text-xs text-muted-foreground">Operasional kredit dan grant manual.</p>
      </header>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <AdminStatCard title="Credits Circulating" value={totalCirculating} />
        <AdminStatCard title="Purchased" value={totalPurchased} tone="good" />
        <AdminStatCard title="Admin Granted" value={totalAdminGranted} />
        <AdminStatCard title="Spent" value={totalSpent} tone="warn" />
        <AdminStatCard title="Grants Today" value={grantsToday} />
      </div>

      {/* Grant Form */}
      <AdminSectionCard title="Grant Kredit Manual">
        <div className="p-3">
          <GrantCreditForm />
        </div>
      </AdminSectionCard>

      {/* Latest Admin Grants */}
      <AdminSectionCard title="Latest Admin Grants">
        {grantRows.length === 0 ? (
          <AdminEmptyState message="Belum ada admin grant." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Admin</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {grantRows.map((g, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">{isoDatetime(g.createdAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{g.targetUserId.slice(0, 8)}...</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{g.adminUserId.slice(0, 8)}...</td>
                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600">+{g.credits}</td>
                    <td className="px-3 py-1.5 max-w-[150px] truncate">{g.reason}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate">{g.ledgerRef}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Latest Ledger */}
      <AdminSectionCard title="Latest Credit Ledger">
        {ledgerRows.length === 0 ? (
          <AdminEmptyState message="Belum ada transaksi ledger." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2 text-right">Delta</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((r, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">{isoDatetime(r.createdAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{r.userId.slice(0, 8)}...</td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${
                        r.delta >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {r.delta > 0 ? '+' : ''}{r.delta}
                    </td>
                    <td className="px-3 py-1.5"><StatusBadge status={r.reason} /></td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground max-w-[150px] truncate">{r.ref}</td>
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
