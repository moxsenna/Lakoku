import { AdminStatCard } from '@/components/admin/admin-stat-card'
import type { GenerationViewModel } from './generation-view-model'
import { addDecimalStrings, formatComparison, formatDecimal, formatDuration, formatPercent } from './generation-view-model'

export interface GenerationSummaryGridProps {
  viewModel: GenerationViewModel
}

export function GenerationSummaryGrid({ viewModel }: GenerationSummaryGridProps) {
  const current = viewModel.current
  const previous = viewModel.previous
  if (!current) return null

  return (
    <>
      <section aria-labelledby="job-health-heading">
        <h2 id="job-health-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job health</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard title="Active jobs" value={current.active_job_count} description={formatComparison(current.active_job_count, previous?.active_job_count ?? null)} />
          <AdminStatCard title="Retrying jobs" value={current.retrying_job_count} tone={BigInt(current.retrying_job_count) > BigInt(0) ? 'warn' : 'good'} description={formatComparison(current.retrying_job_count, previous?.retrying_job_count ?? null)} />
          <AdminStatCard title="Failed jobs" value={current.failed_job_count} tone={BigInt(current.failed_job_count) > BigInt(0) ? 'bad' : 'good'} description={formatComparison(current.failed_job_count, previous?.failed_job_count ?? null)} />
          <AdminStatCard title="Stale jobs" value={current.stale_job_count} tone={BigInt(current.stale_job_count) > BigInt(0) ? 'bad' : 'good'} description={formatComparison(current.stale_job_count, previous?.stale_job_count ?? null)} />
        </div>
      </section>

      <section aria-labelledby="provider-summary-heading">
        <h2 id="provider-summary-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider summary</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard title="Provider calls" value={current.call_count} description={formatComparison(current.call_count, previous?.call_count ?? null)} />
          <AdminStatCard title="Total tokens" value={formatDecimal(current.total_token_count, 0)} description={formatComparison(current.total_token_count, previous?.total_token_count ?? null)} />
          <AdminStatCard title="Success rate" value={formatPercent(current.success_rate)} tone={Number(current.success_rate) >= 0.95 ? 'good' : 'warn'} description={formatComparison(current.success_rate, previous?.success_rate ?? null)} />
          <AdminStatCard title="Error rate" value={formatPercent(current.error_rate)} tone={Number(current.error_rate) > 0.05 ? 'bad' : 'good'} description={formatComparison(current.error_rate, previous?.error_rate ?? null)} />
          <AdminStatCard title="Fallback rate" value={formatPercent(current.fallback_rate)} tone={Number(current.fallback_rate) > 0.1 ? 'warn' : 'default'} description={formatComparison(current.fallback_rate, previous?.fallback_rate ?? null)} />
          <AdminStatCard title="P50 latency" value={formatDuration(current.p50_elapsed_ms)} description={formatComparison(current.p50_elapsed_ms, previous?.p50_elapsed_ms ?? null)} />
          <AdminStatCard title="P95 latency" value={formatDuration(current.p95_elapsed_ms)} description={formatComparison(current.p95_elapsed_ms, previous?.p95_elapsed_ms ?? null)} />
          <AdminStatCard title="Unpriced calls" value={viewModel.unavailableCostCount} tone={BigInt(viewModel.unavailableCostCount) > BigInt(0) ? 'warn' : 'good'} description={`${BigInt(viewModel.unavailableCostCount) > BigInt(0) ? 'Cost unavailable · ' : ''}${formatComparison(viewModel.unavailableCostCount, previous?.unavailable_cost_count ?? null)}`} />
          {viewModel.costs.map((cost) => (
            <AdminStatCard
              key={cost.currency}
              title={`Cost (${cost.currency})`}
              value={`${cost.currency} ${formatDecimal(addDecimalStrings(cost.actual, cost.estimated), 6)}`}
              description={`Actual ${formatDecimal(cost.actual, 6)} · Estimated ${formatDecimal(cost.estimated, 6)} · ${formatComparison(
                addDecimalStrings(cost.actual, cost.estimated),
                cost.previousActual === null || cost.previousEstimated === null
                  ? null
                  : addDecimalStrings(cost.previousActual, cost.previousEstimated),
              )}`}
            />
          ))}
        </div>
      </section>
    </>
  )
}
