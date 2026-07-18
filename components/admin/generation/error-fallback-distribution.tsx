import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminSectionCard } from '@/components/admin/admin-section-card'
import type { AdminGenerationProviderCall } from '@/lib/admin/generation-schemas'
import { StatusBadge } from '@/components/admin/status-badge'

interface DistributionRow {
  key: string
  outcome: string
  errorCode: string
  fallbackIndex: number
  count: number
}

export function ErrorFallbackDistribution({ calls }: { calls: AdminGenerationProviderCall[] }) {
  const distribution = Array.from(calls.reduce((map, call) => {
    const key = `${call.outcome}|${call.error_code ?? 'NONE'}|${call.fallback_index}`
    const current = map.get(key)
    map.set(key, current
      ? { ...current, count: current.count + 1 }
      : { key, outcome: call.outcome, errorCode: call.error_code ?? 'None', fallbackIndex: call.fallback_index, count: 1 })
    return map
  }, new Map<string, DistributionRow>()).values()).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  return (
    <AdminSectionCard title="Error and fallback distribution" subtitle="Controlled error codes from current ledger page.">
      {distribution.length === 0 ? <AdminEmptyState message="No provider calls available for distribution." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border bg-muted/30 text-left"><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Error code</th><th className="px-3 py-2 text-right">Fallback index</th><th className="px-3 py-2 text-right">Calls</th></tr></thead>
            <tbody>{distribution.map((row) => (
              <tr key={row.key} className="border-b border-border"><td className="px-3 py-2"><StatusBadge status={row.outcome} /></td><td className="px-3 py-2 font-mono text-[10px]">{row.errorCode}</td><td className="px-3 py-2 text-right tabular-nums">{row.fallbackIndex}</td><td className="px-3 py-2 text-right tabular-nums">{row.count}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
  )
}
