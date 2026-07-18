import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminErrorState } from '@/components/admin/admin-error-state'
import { ErrorFallbackDistribution } from '@/components/admin/generation/error-fallback-distribution'
import { GenerationDataQuality } from '@/components/admin/generation/generation-data-quality'
import { GenerationFilterBar } from '@/components/admin/generation/generation-filter-bar'
import { GenerationJobDrawer } from '@/components/admin/generation/generation-job-drawer'
import { GenerationSummaryGrid } from '@/components/admin/generation/generation-summary-grid'
import { GenerationTimeseries } from '@/components/admin/generation/generation-timeseries'
import { buildGenerationViewModel, formatTimestamp } from '@/components/admin/generation/generation-view-model'
import { ModelPerformanceTable } from '@/components/admin/generation/model-performance-table'
import { ProviderCallLedger } from '@/components/admin/generation/provider-call-ledger'
import { loadAdminGenerationDashboard } from '@/lib/admin/generation'
import { parseAdminGenerationFilters } from '@/lib/admin/generation-filters'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

export default async function AdminGenerationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  let filters
  try {
    filters = parseAdminGenerationFilters(await searchParams)
  } catch {
    return (
      <div className="flex flex-col gap-6">
        <header><h1 className="font-serif text-xl text-foreground">Generation operations</h1><p className="text-xs text-muted-foreground">Read-only provider-call and durable-job observability.</p></header>
        <AdminErrorState error="Invalid generation filters. Use ISO timestamps and bounded values." />
      </div>
    )
  }

  const dashboard = await loadAdminGenerationDashboard(filters).catch(() => null)
  const viewModel = buildGenerationViewModel(
    filters,
    dashboard,
    dashboard === null ? new Error('QUERY_FAILED') : undefined,
  )

  if (dashboard === null) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="font-serif text-xl text-foreground">Generation operations</h1>
          <p className="text-xs text-muted-foreground">Selected range: {formatTimestamp(filters.from)} – {formatTimestamp(filters.to)}</p>
        </header>
        <GenerationFilterBar filters={filters} />
        <AdminErrorState error={viewModel.errorMessage ?? 'Generation observability is unavailable.'} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Generation operations</h1>
        <p className="text-xs text-muted-foreground">Read-only provider-call and durable-job observability.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Selected range: {formatTimestamp(filters.from)} – {formatTimestamp(filters.to)}</p>
      </header>

      <GenerationFilterBar filters={filters} />
      <GenerationDataQuality rows={dashboard.dataQuality} />

      {viewModel.state === 'empty' ? (
        <AdminEmptyState title="No generation activity" message="No provider calls exist for selected range and filters." />
      ) : (
        <>
          <GenerationSummaryGrid viewModel={viewModel} />
          <GenerationTimeseries rows={dashboard.timeseries} />
          <ModelPerformanceTable rows={dashboard.modelPerformance} />
          <ErrorFallbackDistribution calls={dashboard.providerCalls} />
          <ProviderCallLedger calls={dashboard.providerCalls} filters={filters} nextHref={viewModel.nextHref} />
        </>
      )}

      {filters.jobId !== null && <GenerationJobDrawer rows={dashboard.jobDetail ?? []} filters={filters} />}
    </div>
  )
}
