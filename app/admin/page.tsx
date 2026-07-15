import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { loadAdminDashboardMetrics } from '@/lib/admin/dashboard'
import { idr, compactNumber } from '@/lib/admin/format'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  const m = await loadAdminDashboardMetrics()

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
        <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-4">
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
        </div>
      </AdminSectionCard>
    </div>
  )
}
