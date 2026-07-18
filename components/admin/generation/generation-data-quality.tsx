import { AdminSectionCard } from '@/components/admin/admin-section-card'
import type { AdminGenerationDataQualityRow } from '@/lib/admin/generation-schemas'
import { formatTimestamp } from './generation-view-model'

const labels: Record<AdminGenerationDataQualityRow['metric_name'], string> = {
  missing_usage: 'Missing token usage',
  unavailable_pricing: 'Unavailable pricing',
  unresolved_actual_model: 'Unresolved actual model',
  calls_lacking_durable_correlation: 'Calls lacking durable correlation',
  terminal_job_shape_failures: 'Terminal job shape failures',
  detail_approaching_retention_cutoff: 'Detail approaching retention cutoff',
}

export function GenerationDataQuality({ rows }: { rows: AdminGenerationDataQualityRow[] }) {
  const issues = rows.filter((row) => BigInt(row.issue_count) > BigInt(0))
  if (issues.length === 0) return null

  return (
    <AdminSectionCard title="Partial data" subtitle="Some metrics are unavailable or need operator review.">
      <ul className="grid gap-2 p-4 md:grid-cols-2" role="status">
        {issues.map((row) => (
          <li key={row.metric_name} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
            <div className="font-medium text-amber-700 dark:text-amber-300">{labels[row.metric_name]}: {row.issue_count}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Oldest {formatTimestamp(row.oldest_issue_at)} · Newest {formatTimestamp(row.newest_issue_at)}</div>
          </li>
        ))}
      </ul>
    </AdminSectionCard>
  )
}
