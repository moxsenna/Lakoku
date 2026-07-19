import type { AdminGenerationDashboard } from '@/lib/admin/generation'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import { serializeAdminGenerationFilters } from '@/lib/admin/generation-filters'
import type { AdminGenerationOverviewRow } from '@/lib/admin/generation-schemas'

export type GenerationDashboardState = 'ready' | 'empty' | 'partial' | 'error'

export interface GenerationCostSummary {
  currency: string
  actual: string
  estimated: string
  previousActual: string | null
  previousEstimated: string | null
}

export interface GenerationViewModel {
  state: GenerationDashboardState
  errorMessage: string | null
  current: AdminGenerationOverviewRow | null
  previous: AdminGenerationOverviewRow | null
  costs: GenerationCostSummary[]
  unavailableCostCount: string
  nextHref: string | null
}

function generationHref(filters: AdminGenerationFilters): string {
  return `/admin/generation?${serializeAdminGenerationFilters(filters).toString()}`
}

export function generationJobHref(filters: AdminGenerationFilters, jobId: string): string {
  return generationHref({
    ...filters,
    jobId,
    cursorStartedAt: null,
    cursorId: null,
  })
}

export function generationClearJobHref(filters: AdminGenerationFilters): string {
  return generationHref({ ...filters, jobId: null })
}

export function buildGenerationViewModel(
  filters: AdminGenerationFilters,
  dashboard: AdminGenerationDashboard | null,
  error?: unknown,
): GenerationViewModel {
  if (error || dashboard === null) {
    // Never surface raw DB/provider text. Only known loader codes are safe.
    const code = error instanceof Error ? error.message : ''
    const message = code === 'Generation observability query failed'
      || code === 'Generation observability response was invalid'
      ? code
      : 'Generation observability is unavailable.'
    return {
      state: 'error',
      errorMessage: message,
      current: null,
      previous: null,
      costs: [],
      unavailableCostCount: '0',
      nextHref: null,
    }
  }

  const currentRows = dashboard.overview.filter((row) => row.period_name === 'current')
  const previousRows = dashboard.overview.filter((row) => row.period_name === 'previous')
  const current = currentRows[0] ?? null
  const previous = previousRows[0] ?? null
  const costs = currentRows
    .filter((row): row is AdminGenerationOverviewRow & { cost_currency: string } => row.cost_currency !== null)
    .map((row) => {
      const previousCost = previousRows.find((candidate) =>
        candidate.cost_currency === row.cost_currency)
      return {
        currency: row.cost_currency,
        actual: row.actual_cost_amount,
        estimated: row.estimated_cost_amount,
        previousActual: previousCost?.actual_cost_amount ?? null,
        previousEstimated: previousCost?.estimated_cost_amount ?? null,
      }
    })

  const unavailableCostCount = current?.unavailable_cost_count ?? '0'
  const qualityIssues = dashboard.dataQuality.some((row) =>
    row.metric_name !== 'calls_lacking_durable_correlation'
    && BigInt(row.issue_count) > BigInt(0))
  const missingLedgerValues = dashboard.providerCalls.some((call) =>
    call.total_token_count === null || call.cost_source === 'unavailable')
  const partial = qualityIssues || BigInt(unavailableCostCount) > BigInt(0) || missingLedgerValues
  const empty = currentRows.length === 0
    || currentRows.every((row) => BigInt(row.call_count) === BigInt(0))

  const lastCall = dashboard.providerCalls.at(-1)
  const nextHref = dashboard.providerCalls.length === filters.pageSize && lastCall
    ? generationHref({
        ...filters,
        cursorStartedAt: lastCall.started_at,
        cursorId: lastCall.id,
      })
    : null

  return {
    state: empty ? 'empty' : partial ? 'partial' : 'ready',
    errorMessage: null,
    current,
    previous,
    costs,
    unavailableCostCount,
    nextHref,
  }
}

function decimalParts(value: string): { whole: string; fraction: string } {
  const [whole = '0', fraction = ''] = value.split('.')
  return { whole: whole.replace(/^0+(?=\d)/, ''), fraction }
}

export function addDecimalStrings(left: string, right: string): string {
  const leftParts = decimalParts(left)
  const rightParts = decimalParts(right)
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length)
  const leftScaled = BigInt(`${leftParts.whole}${leftParts.fraction.padEnd(scale, '0')}`)
  const rightScaled = BigInt(`${rightParts.whole}${rightParts.fraction.padEnd(scale, '0')}`)
  const sum = (leftScaled + rightScaled).toString().padStart(scale + 1, '0')
  if (scale === 0) return sum
  const whole = sum.slice(0, -scale)
  const fraction = sum.slice(-scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export function formatDecimal(value: string | null, maximumFractionDigits = 2): string {
  if (value === null) return 'Unavailable'
  const { whole, fraction } = decimalParts(value)
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const visibleFraction = fraction.slice(0, Math.max(0, maximumFractionDigits)).replace(/0+$/, '')
  return visibleFraction ? `${groupedWhole}.${visibleFraction}` : groupedWhole
}

export function formatPercent(value: string | null): string {
  if (value === null) return 'Unavailable'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : value
}

export function formatDuration(value: string | null): string {
  if (value === null) return 'Unavailable'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value
  if (numeric < 1000) return `${Math.round(numeric)} ms`
  return `${(numeric / 1000).toFixed(2)} s`
}

export function formatComparison(current: string | null, previous: string | null): string {
  if (current === null || previous === null) return 'Previous unavailable'
  const currentValue = Number(current)
  const previousValue = Number(previous)
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return 'Previous unavailable'
  }
  if (previousValue === 0) {
    return currentValue === 0 ? 'No change vs previous' : 'No previous activity'
  }
  const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100
  const sign = change > 0 ? '+' : ''
  return `${sign}${change.toFixed(1)}% vs previous`
}

export function formatTimestamp(value: string | null): string {
  if (value === null) return 'Unavailable'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}
