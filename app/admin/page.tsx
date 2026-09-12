import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { loadAdminDashboardMetrics, loadAdminDailyCostSummary } from '@/lib/admin/dashboard'
import { idr, compactNumber } from '@/lib/admin/format'
import { E0_R1_CEILINGS } from '@/fixtures/m10-e/e0-budget-authority'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  const [m, cost] = await Promise.all([
    loadAdminDashboardMetrics(),
    loadAdminDailyCostSummary(7).catch(() => null),
  ])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Overview</h1>
        <p className="text-xs text-muted-foreground">
          Ringkasan operasional Lakoku hari ini.
        </p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        <AdminStatCard title="Total Users" value={compactNumber(m.totalUsers)} />
        <AdminStatCard title="New Users Today" value={m.newUsersToday} />
        <AdminStatCard
          title="Credits Circulating"
          value={compactNumber(m.totalCreditsCirculating)}
        />
        <AdminStatCard title="Used Today" value={m.creditsUsedToday} />
        <AdminStatCard title="Paid Orders Today" value={m.paidOrdersToday} />
        <AdminStatCard title="Revenue Today" value={idr(m.revenueTodayIdr)} />
        <AdminStatCard title="Gen Attempts Today" value={m.generationAttemptsToday} />
        <AdminStatCard
          title="Gen Failures Today"
          value={m.generationFailuresToday}
          tone={m.generationFailuresToday > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* E0 Cost & Operational Status */}
      <AdminSectionCard
        title="Biaya & Batasan AI (E0 R1)"
        subtitle={`Plafon: $${E0_R1_CEILINGS.maxExpectedCostPerChapter}/bab, $${E0_R1_CEILINGS.maxExpectedCostPerNovel}/novel`}
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status Monitor (7 Hari):</span>
              <span
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                  cost?.status === 'OK'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : cost?.status === 'WATCH'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : cost?.status === 'UNMEASURED'
                    ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                }`}
              >
                {cost?.status ?? 'UNKNOWN'}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Terukur: ${cost?.totalMeasuredCostUsd ?? '0.00000000'} | Panggilan: {cost?.pricedCallCount ?? 0} berbayar, {cost?.unmeasuredCallCount ?? 0} unmeasured
            </span>
          </div>

          {cost?.status === 'UNMEASURED' && (
            <p className="text-[11px] text-muted-foreground">
              ℹ <strong>Defek CI-6 Aktif:</strong> Transport model belum mengembalikan data <code>usage.cost</code> dari provider. Volume panggilan tercatat, namun verifikasi pengeluaran riil harus dipantau manual di dashboard provider.
            </p>
          )}

          {cost?.status === 'BREACH' && (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              🚨 <strong>Pelanggaran Plafon:</strong> Terdeteksi panggilan melewati batas $2.10/bab atau $200/novel. Segera periksa log generasi!
            </p>
          )}
        </div>
      </AdminSectionCard>

      {/* Perlu Perhatian */}
      {(m.generationFailuresToday > 0) && (
        <AdminSectionCard title="⚠ Perlu Perhatian" subtitle="Potensi masalah yang perlu dicek">
          <div className="flex flex-col gap-1 px-4 py-3">
            {m.generationFailuresToday > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {m.generationFailuresToday} generation failure hari ini —{' '}
                <Link href="/admin/generation" className="underline">
                  lihat detail
                </Link>
              </p>
            )}
          </div>
        </AdminSectionCard>
      )}

      {/* Shortcuts */}
      <AdminSectionCard title="Shortcut">
        <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-5">
          <Link href="/admin/credits" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted">
            💰 Grant Kredit
          </Link>
          <Link href="/admin/users" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted">
            🔍 Cari User
          </Link>
          <Link href="/admin/payments" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted">
            💳 Pembayaran
          </Link>
          <Link href="/admin/consistency" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted">
            📊 Konsistensi
          </Link>
          <Link href="/admin/blueprint-review" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted">
            📋 Blueprint Review
          </Link>
        </div>
      </AdminSectionCard>
    </div>
  )
}
