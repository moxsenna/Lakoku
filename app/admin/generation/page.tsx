import {
  loadAdminGenerationMetrics,
  listAdminGenerationEvents,
} from '@/lib/admin/generation'
import { AdminStatCard } from '@/components/admin/admin-stat-card'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { StatusBadge } from '@/components/admin/status-badge'
import { isoDatetime } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

export default async function AdminGenerationPage() {
  const metrics = await loadAdminGenerationMetrics()
  const events = await listAdminGenerationEvents(30)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Generation</h1>
        <p className="text-xs text-muted-foreground">
          Kesehatan AI generation & failure monitor.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard title="Attempts Today" value={metrics.attemptsToday} />
        <AdminStatCard title="Success Today" value={metrics.successToday} tone="good" />
        <AdminStatCard
          title="Failed Today"
          value={metrics.failedToday}
          tone={metrics.failedToday > 0 ? 'bad' : 'good'}
        />
        <AdminStatCard
          title="Failure Rate"
          value={`${Math.round(metrics.failureRate * 100)}%`}
          tone={metrics.failureRate > 0.1 ? 'warn' : 'good'}
        />
      </div>

      <AdminSectionCard title="Latest Generation Events" subtitle="30 event terbaru dari story_events">
        {events.length === 0 ? (
          <AdminEmptyState message="Belum ada generation event." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Story</th>
                  <th className="px-3 py-2">Chapter</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-muted-foreground">{isoDatetime(e.createdAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">
                      {e.storyId ? `${e.storyId.slice(0, 8)}...` : '-'}
                    </td>
                    <td className="px-3 py-1.5">{e.chapterId ?? '-'}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={e.status} />
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
