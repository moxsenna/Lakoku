import { AdminEmptyState } from '@/components/admin/admin-empty-state'
import { AdminErrorState } from '@/components/admin/admin-error-state'
import { ErrorFallbackDistribution } from '@/components/admin/generation/error-fallback-distribution'
import { GenerationCostBreakdown } from '@/components/admin/generation/generation-cost-breakdown'
import { GenerationDataQuality } from '@/components/admin/generation/generation-data-quality'
import { GenerationFilterBar } from '@/components/admin/generation/generation-filter-bar'
import { GenerationJobDrawer } from '@/components/admin/generation/generation-job-drawer'
import { GenerationSummaryGrid } from '@/components/admin/generation/generation-summary-grid'
import { GenerationTimeseries } from '@/components/admin/generation/generation-timeseries'
import { buildGenerationViewModel, formatTimestamp } from '@/components/admin/generation/generation-view-model'
import { ModelPerformanceTable } from '@/components/admin/generation/model-performance-table'
import { ProviderCallLedger } from '@/components/admin/generation/provider-call-ledger'
import {
  AdminGenerationQueryError,
  loadAdminGenerationDashboard,
} from '@/lib/admin/generation'
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
        <header>
          <h1 className="font-serif text-xl text-foreground">Generation operations</h1>
          <p className="text-xs text-muted-foreground">
            Pakai tombol 24 jam / 7 hari / 30 hari. Filter lanjutan opsional.
          </p>
        </header>
        <AdminErrorState error="Filter tidak valid. Coba reset ke 24 jam." />
      </div>
    )
  }

  let loadError: unknown
  const dashboard = await loadAdminGenerationDashboard(filters).catch((error) => {
    loadError = error
    return null
  })
  const viewModel = buildGenerationViewModel(
    filters,
    dashboard,
    loadError ?? (dashboard === null ? new Error('QUERY_FAILED') : undefined),
  )

  if (dashboard === null) {
    const detail = loadError instanceof AdminGenerationQueryError
      ? loadError.message
      : (viewModel.errorMessage ?? 'Generation observability is unavailable.')
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="font-serif text-xl text-foreground">Generation operations</h1>
          <p className="text-xs text-muted-foreground">
            Rentang: {formatTimestamp(filters.from)} – {formatTimestamp(filters.to)}
          </p>
        </header>
        <GenerationFilterBar filters={filters} />
        <AdminErrorState error={detail} />
        <p className="text-[11px] text-muted-foreground">
          Coba preset <strong>24 jam</strong> tanpa filter lanjutan. Field kosong = tampilkan semua.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl text-foreground">Generation operations</h1>
        <p className="text-xs text-muted-foreground">
          Read-only: call provider, biaya, latency, job health.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Rentang: {formatTimestamp(filters.from)} – {formatTimestamp(filters.to)}
        </p>
      </header>

      <GenerationFilterBar filters={filters} />
      <GenerationDataQuality rows={dashboard.dataQuality} />

      {viewModel.state === 'empty' ? (
        <AdminEmptyState
          title="Belum ada aktivitas generasi"
          message="Tidak ada provider call di rentang ini. Generate 1 chapter dulu, atau perlebar rentang waktu."
        />
      ) : (
        <>
          <GenerationSummaryGrid viewModel={viewModel} />
          <GenerationTimeseries rows={dashboard.timeseries} />
          <ModelPerformanceTable rows={dashboard.modelPerformance} />
          <ErrorFallbackDistribution rows={dashboard.errorDistribution} />
          <GenerationCostBreakdown rows={dashboard.costBreakdown} />
          <ProviderCallLedger
            calls={dashboard.providerCalls}
            filters={filters}
            nextHref={viewModel.nextHref}
          />
        </>
      )}

      {filters.jobId !== null && (
        <GenerationJobDrawer rows={dashboard.jobDetail ?? []} filters={filters} />
      )}
    </div>
  )
}
