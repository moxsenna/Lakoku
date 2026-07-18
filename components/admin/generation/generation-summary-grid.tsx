import { AdminStatCard } from '@/components/admin/admin-stat-card'
import type { GenerationViewModel } from './generation-view-model'
import { addDecimalStrings, formatDecimal, formatDuration, formatPercent } from './generation-view-model'

export interface GenerationSummaryGridProps {
  viewModel: GenerationViewModel
}

export function GenerationSummaryGrid({ viewModel }: GenerationSummaryGridProps) {
  const current = viewModel.current
  if (!current) return null

  return (
    <>
      <section aria-labelledby="job-health-heading">
        <h2 id="job-health-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job health</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard title="Active jobs" value={current.active_job_count} />
          <AdminStatCard title="Retrying jobs" value={current.retrying_job_count} tone={BigInt(current.retrying_job_count) > BigInt(0) ? 'warn' : 'good'} />
          <AdminStatCard title="Failed jobs" value={current.failed_job_count} tone={BigInt(current.failed_job_count) > BigInt(0) ? 'bad' : 'good'} />
          <AdminStatCard title="Stale jobs" value={current.stale_job_count} tone={BigInt(current.stale_job_count) > BigInt(0) ? 'bad' : 'good'} />
        </div>
      </section>

      <section aria-labelledby="provider-summary-heading">
        <h2 id="provider-summary-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider summary</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard title="Provider calls" value={current.call_count} />
          <AdminStatCard title="Total tokens" value={formatDecimal(current.total_token_count, 0)} />
          <AdminStatCard title="Success rate" value={formatPercent(current.success_rate)} tone={Number(current.success_rate) >= 0.95 ? 'good' : 'warn'} />
          <AdminStatCard title="Error rate" value={formatPercent(current.error_rate)} tone={Number(current.error_rate) > 0.05 ? 'bad' : 'good'} />
          <AdminStatCard title="Fallback rate" value={formatPercent(current.fallback_rate)} tone={Number(current.fallback_rate) > 0.1 ? 'warn' : 'default'} />
          <AdminStatCard title="P50 latency" value={formatDuration(current.p50_elapsed_ms)} />
          <AdminStatCard title="P95 latency" value={formatDuration(current.p95_elapsed_ms)} />
          <AdminStatCard title="Unpriced calls" value={viewModel.unavailableCostCount} tone={BigInt(viewModel.unavailableCostCount) > BigInt(0) ? 'warn' : 'good'} description={BigInt(viewModel.unavailableCostCount) > BigInt(0) ? 'Cost Unavailable' : undefined} />
          {viewModel.costs.map((cost) => (
            <AdminStatCard
              key={cost.currency}
              title={`Cost (${cost.currency})`}
              value={`${cost.currency} ${formatDecimal(addDecimalStrings(cost.actual, cost.estimated), 6)}`}
              description={`Actual ${formatDecimal(cost.actual, 6)} · Estimated ${formatDecimal(cost.estimated, 6)}`}
            />
          ))}
        </div>
      </section>
    </>
  )
}
