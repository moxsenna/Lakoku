import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import type { AdminModelPerformanceRow } from '@/lib/admin/generation-schemas'
import { addDecimalStrings, formatDecimal, formatDuration, formatPercent } from './generation-view-model'

export function ModelPerformanceTable({ rows }: { rows: AdminModelPerformanceRow[] }) {
  return (
    <AdminSectionCard title="Model performance" subtitle="Provider/model comparison. Currency rows remain independent.">
      {rows.length === 0 ? <AdminEmptyState message="No model performance data for selected range." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30 text-left"><th className="px-3 py-2">Provider / model</th><th className="px-3 py-2 text-right">Calls</th><th className="px-3 py-2 text-right">Success</th><th className="px-3 py-2 text-right">Fallback</th><th className="px-3 py-2 text-right">P50 / P95</th><th className="px-3 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Cost</th></tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${row.provider_id}-${row.model_id}-${row.cost_currency ?? 'none'}-${index}`} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2"><div>{row.provider_id}</div><div className="font-mono text-[10px] text-muted-foreground">{row.model_id}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{row.call_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.success_rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.fallback_rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatDuration(row.p50_elapsed_ms)} / {formatDuration(row.p95_elapsed_ms)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatDecimal(row.total_token_count, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.cost_currency ? `${row.cost_currency} ${formatDecimal(addDecimalStrings(row.actual_cost_amount, row.estimated_cost_amount), 6)}` : 'Unavailable'}{BigInt(row.unavailable_cost_count) > BigInt(0) && <div className="text-[10px] text-amber-600">{row.unavailable_cost_count} unavailable</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
  )
}
