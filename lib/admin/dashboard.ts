import 'server-only'
import { getDb, result, countOf } from '@lakoku/db'
import { loadAdminGenerationOverview } from '@/lib/admin/generation'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import {
  buildDailyCostReport,
  type ProviderCallCostRow,
  type DailyCostReportStatus,
} from '@/lib/commercial/daily-cost-report'

export interface AdminDailyCostSummary {
  readonly status: DailyCostReportStatus
  readonly totalMeasuredCostUsd: string
  readonly maxChapterCostUsd: string
  readonly callCount: number
  readonly pricedCallCount: number
  readonly unmeasuredCallCount: number
  readonly chapterCeilingUsd: string
  readonly novelCeilingUsd: string
  readonly watchpointsCount: number
  readonly breachesCount: number
}

const COST_COLUMNS = [
  'started_at',
  'story_id',
  'chapter_number',
  'job_id',
  'provider_id',
  'model_id',
  'outcome',
  'cost_amount',
  'cost_currency',
  'cost_source',
] as const

export async function loadAdminDailyCostSummary(
  days = 1,
  now = new Date(),
): Promise<AdminDailyCostSummary> {
  const db = getDb()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  let rows: ProviderCallCostRow[] = []
  try {
    const { data } = await result(
      db
        .selectFrom('generation_provider_calls')
        .select(COST_COLUMNS)
        .where('started_at', '>=', from)
        .where('started_at', '<', now)
        .orderBy('started_at', 'asc')
        .limit(1000)
        .execute(),
    )
    if (data) {
      rows = data as unknown as ProviderCallCostRow[]
    }
  } catch {
    // Database table may be empty or unconfigured in tests
  }

  const report = buildDailyCostReport(rows)
  return {
    status: report.status,
    totalMeasuredCostUsd: report.totalMeasuredCostUsd,
    maxChapterCostUsd: report.maxChapterCostUsd,
    callCount: report.callCount,
    pricedCallCount: report.pricedCallCount,
    unmeasuredCallCount: report.unmeasuredCallCount,
    chapterCeilingUsd: report.ceilings.maxCostPerChapterUsd,
    novelCeilingUsd: report.ceilings.maxCostPerNovelUsd,
    watchpointsCount: report.watchpoints.length,
    breachesCount: report.breaches.length,
  }
}

export interface AdminDashboardMetrics {
  totalUsers: number
  newUsersToday: number
  totalCreditsCirculating: number
  creditsUsedToday: number
  paidOrdersToday: number
  revenueTodayIdr: number
  generationAttemptsToday: number
  generationFailuresToday: number
  consistencyCriticalRate: number | null
}

export async function loadAdminDashboardMetrics(
  now = new Date(),
): Promise<AdminDashboardMetrics> {
  const db = getDb()
  const today = now.toISOString().slice(0, 10) // YYYY-MM-DD

  const metrics: AdminDashboardMetrics = {
    totalUsers: 0,
    newUsersToday: 0,
    totalCreditsCirculating: 0,
    creditsUsedToday: 0,
    paidOrdersToday: 0,
    revenueTodayIdr: 0,
    generationAttemptsToday: 0,
    generationFailuresToday: 0,
    consistencyCriticalRate: null,
  }

  // --- Users (auth.users via admin API) ---
  try {
    const totalUsers = await countOf(
      db
        .selectFrom('reader_taste_profiles')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .execute(),
    )
    metrics.totalUsers = totalUsers
  } catch { /* No-op */ }

  try {
    const newToday = await countOf(
      db
        .selectFrom('reader_taste_profiles')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('created_at', '>=', new Date(`${today}T00:00:00`))
        .execute(),
    )
    metrics.newUsersToday = newToday
  } catch { /* No-op */ }

  // --- Credit totals ---
  // Note: credit_balance_v1 is per-user; circulating total uses ledger sum below.

  try {
    const { data: circ } = await result(
      db
        .selectFrom('credit_ledger')
        .select('delta')
        .orderBy('created_at', 'desc')
        .limit(5000)
        .execute(),
    )
    if (circ) {
      metrics.totalCreditsCirculating = (circ as { delta: number }[]).reduce(
        (s, r) => s + r.delta, 0,
      )
    }
  } catch { /* No-op */ }

  try {
    const { data: used } = await result(
      db
        .selectFrom('credit_ledger')
        .select('delta')
        .where('delta', '<', 0)
        .where('created_at', '>=', new Date(`${today}T00:00:00`))
        .execute(),
    )
    if (used) {
      metrics.creditsUsedToday = (used as { delta: number }[]).reduce(
        (s, r) => s + Math.abs(r.delta), 0,
      )
    }
  } catch { /* No-op */ }

  // --- Orders ---
  try {
    // RLS_AUDIT: credit_orders_own_read
    const paidToday = await countOf(
      db
        .selectFrom('credit_orders')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('status', '=', 'paid')
        .where('paid_at', '>=', new Date(`${today}T00:00:00`))
        .execute(),
    )
    metrics.paidOrdersToday = paidToday

    // RLS_AUDIT: credit_orders_own_read
    const { data: revenueRows } = await result(
      db
        .selectFrom('credit_orders')
        .select('price_idr')
        .where('status', '=', 'paid')
        .where('paid_at', '>=', new Date(`${today}T00:00:00`))
        .execute(),
    )
    if (revenueRows) {
      metrics.revenueTodayIdr = (revenueRows as { price_idr: number }[]).reduce(
        (s, r) => s + r.price_idr, 0,
      )
    }
  } catch { /* No-op */ }

  // --- Generation (same authorized observability overview as generation dashboard) ---
  const generationFilters: AdminGenerationFilters = {
    from: `${today}T00:00:00.000Z`,
    to: now.toISOString(),
    providerId: null,
    modelId: null,
    useCase: null,
    workflowPhase: null,
    outcome: null,
    errorCode: null,
    costSource: null,
    userId: null,
    storyId: null,
    generationKind: null,
    jobId: null,
    correlationId: null,
    chapterNumber: null,
    cursorStartedAt: null,
    cursorId: null,
    pageSize: 1,
  }
  const generationOverview = await loadAdminGenerationOverview(generationFilters)
  const currentGeneration = generationOverview.find((row) => row.period_name === 'current')
  if (currentGeneration) {
    metrics.generationAttemptsToday = Number(currentGeneration.call_count)
    metrics.generationFailuresToday = Number(currentGeneration.error_count)
  }

  return metrics
}
