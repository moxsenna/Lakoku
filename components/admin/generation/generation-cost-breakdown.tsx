import Link from 'next/link'
import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import type { AdminGenerationCostBreakdownRow } from '@/lib/admin/generation-schemas'
import { addDecimalStrings, formatDecimal } from './generation-view-model'

export function GenerationCostBreakdown({
  rows,
}: {
  rows: AdminGenerationCostBreakdownRow[]
}) {
  return (
    <AdminSectionCard title="Cost breakdown" subtitle="Bounded top 100 groups; user emails are masked in database output.">
      {rows.length === 0 ? <AdminEmptyState message="No cost breakdown data for selected range." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30 text-left"><th className="px-3 py-2">Use case</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Provider / model</th><th className="px-3 py-2 text-right">Calls</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Unpriced</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.use_case}|${row.user_id}|${row.generation_kind ?? 'none'}|${row.provider_id}|${row.model_id}|${row.cost_currency ?? 'none'}`} className="border-b border-border">
                <td className="px-3 py-2">{row.use_case}</td>
                <td className="px-3 py-2"><Link href={`/admin/users/${row.user_id}`} className="underline underline-offset-4">{row.masked_user_email ?? row.user_id}</Link></td>
                <td className="px-3 py-2">{row.generation_kind ?? 'Unavailable'}</td>
                <td className="px-3 py-2"><div>{row.provider_id}</div><div className="font-mono text-[10px] text-muted-foreground">{row.model_id}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{row.call_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.cost_currency ? `${row.cost_currency} ${formatDecimal(addDecimalStrings(row.actual_cost_amount, row.estimated_cost_amount), 6)}` : 'Unavailable'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.unavailable_cost_count}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
  )
}
