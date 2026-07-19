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
  const visible = rows.filter((row) => BigInt(row.issue_count) > BigInt(0))
  const issues = visible.filter((row) => row.metric_name !== 'calls_lacking_durable_correlation')
  const synchronous = visible.filter((row) => row.metric_name === 'calls_lacking_durable_correlation')
  if (visible.length === 0) return null

  return (
    <div className="grid gap-3">
      {issues.length > 0 && (
        <AdminSectionCard title="Partial data" subtitle="Some metrics are unavailable or need operator review.">
          <QualityRows rows={issues} warning />
        </AdminSectionCard>
      )}
      {synchronous.length > 0 && (
        <AdminSectionCard title="Synchronous calls" subtitle="Valid calls without durable-job correlation; shown for context, not degraded quality.">
          <QualityRows rows={synchronous} warning={false} />
        </AdminSectionCard>
      )}
    </div>
  )
}

function QualityRows({
  rows,
  warning,
}: {
  rows: AdminGenerationDataQualityRow[]
  warning: boolean
}) {
  const tone = warning
    ? 'border-amber-500/20 bg-amber-500/5'
    : 'border-sky-500/20 bg-sky-500/5'
  const text = warning
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-sky-700 dark:text-sky-300'
  return (
    <ul className="grid gap-2 p-4 md:grid-cols-2" role={warning ? 'status' : undefined}>
      {rows.map((row) => (
        <li key={row.metric_name} className={`rounded-lg border p-3 text-xs ${tone}`}>
          <div className={`font-medium ${text}`}>{labels[row.metric_name]}: {row.issue_count}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Oldest {formatTimestamp(row.oldest_issue_at)} · Newest {formatTimestamp(row.newest_issue_at)}</div>
        </li>
      ))}
    </ul>
  )
}
