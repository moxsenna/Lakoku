import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import type { AdminGenerationErrorDistributionRow } from '@/lib/admin/generation-schemas'
import { StatusBadge } from '@/components/admin/status-badge'

export function ErrorFallbackDistribution({
  rows,
}: {
  rows: AdminGenerationErrorDistributionRow[]
}) {
  return (
    <AdminSectionCard title="Error and fallback distribution" subtitle="Controlled outcomes and error codes across full selected range.">
      {rows.length === 0 ? <AdminEmptyState message="No provider calls available for distribution." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30 text-left"><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Error code</th><th className="px-3 py-2">Request path</th><th className="px-3 py-2 text-right">Calls</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.outcome}|${row.error_code ?? 'NONE'}|${row.fallback_bucket}`} className="border-b border-border"><td className="px-3 py-2"><StatusBadge status={row.outcome} /></td><td className="px-3 py-2 font-mono text-[10px]">{row.error_code ?? 'None'}</td><td className="px-3 py-2 font-mono text-[10px]">{row.fallback_bucket}</td><td className="px-3 py-2 text-right tabular-nums">{row.call_count}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
  )
}
