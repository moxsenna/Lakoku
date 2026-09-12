import 'server-only'
import { createAdminClient } from '@lakoku/db'
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
].join(',')

export async function loadAdminDailyCostSummary(
  days = 1,
  now = new Date(),
): Promise<AdminDailyCostSummary> {
  const db = createAdminClient()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  let rows: ProviderCallCostRow[] = []
  try {
    const { data } = await db
      .from('generation_provider_calls')
      .select(COST_COLUMNS)
      .gte('started_at', from.toISOString())
      .lt('started_at', now.toISOString())
      .order('started_at', { ascending: true })
      .limit(1000)
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
  const db = createAdminClient()
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
    const { count: totalUsers } = await db
      .from('reader_taste_profiles')
      .select('*', { count: 'exact', head: true })
    metrics.totalUsers = totalUsers ?? 0
  } catch { /* No-op */ }

  try {
    const { count: newToday } = await db
      .from('reader_taste_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00`)
    metrics.newUsersToday = newToday ?? 0
  } catch { /* No-op */ }

  // --- Credit totals ---
  // Note: credit_balance_v1 is per-user; circulating total uses ledger sum below.

  try {
    const { data: circ } = await db
      .from('credit_ledger')
      .select('delta')
      .order('created_at', { ascending: false })
      .limit(5000)
    if (circ) {
      metrics.totalCreditsCirculating = (circ as { delta: number }[]).reduce(
        (s, r) => s + r.delta, 0,
      )
    }
  } catch { /* No-op */ }

  try {
    const { data: used } = await db
      .from('credit_ledger')
      .select('delta')
      .lt('delta', 0)
      .gte('created_at', `${today}T00:00:00`)
    if (used) {
      metrics.creditsUsedToday = (used as { delta: number }[]).reduce(
        (s, r) => s + Math.abs(r.delta), 0,
      )
    }
  } catch { /* No-op */ }

  // --- Orders ---
  try {
    const { count: paidToday } = await db
      .from('credit_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid')
      .gte('paid_at', `${today}T00:00:00`)
    metrics.paidOrdersToday = paidToday ?? 0

    const { data: revenueRows } = await db
      .from('credit_orders')
      .select('price_idr')
      .eq('status', 'paid')
      .gte('paid_at', `${today}T00:00:00`)
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
