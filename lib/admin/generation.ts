import 'server-only'
import type { z } from 'zod'
import { getDb, result, rpcRows } from '@lakoku/db'
import type { Kysely } from 'kysely'
import type { Database } from '@/lib/supabase/db-types'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import {
  AdminGenerationCostBreakdownSchema,
  AdminGenerationDataQualitySchema,
  AdminGenerationErrorDistributionSchema,
  AdminGenerationJobDetailSchema,
  AdminGenerationOverviewSchema,
  AdminGenerationProviderCallPageSchema,
  AdminGenerationTimeseriesSchema,
  AdminModelPerformanceSchema,
} from '@/lib/admin/generation-schemas'
import type {
  AdminGenerationCostBreakdownRow,
  AdminGenerationDataQualityRow,
  AdminGenerationErrorDistributionRow,
  AdminGenerationJobDetailRow,
  AdminGenerationOverviewRow,
  AdminGenerationProviderCall,
  AdminGenerationTimeseriesRow,
  AdminModelPerformanceRow,
} from '@/lib/admin/generation-schemas'

export type AdminGenerationQueryErrorCode = 'QUERY_FAILED' | 'INVALID_RESPONSE'

export class AdminGenerationQueryError extends Error {
  readonly code: AdminGenerationQueryErrorCode

  constructor(code: AdminGenerationQueryErrorCode) {
    super(code === 'QUERY_FAILED'
      ? 'Generation observability query failed'
      : 'Generation observability response was invalid')
    this.name = 'AdminGenerationQueryError'
    this.code = code
  }
}

export type GenerationDbClient = Kysely<Database>
type RpcSchema<T> = z.ZodType<T>

function commonArgs(filters: AdminGenerationFilters): Record<string, unknown> {
  return {
    p_from: filters.from,
    p_to: filters.to,
    p_provider_id: filters.providerId,
    p_model_id: filters.modelId,
    p_use_case: filters.useCase,
    p_workflow_phase: filters.workflowPhase,
    p_outcome: filters.outcome,
    p_error_code: filters.errorCode,
    p_cost_source: filters.costSource,
    p_user_id: filters.userId,
    p_story_id: filters.storyId,
    p_generation_kind: filters.generationKind,
    p_job_id: filters.jobId,
    p_correlation_id: filters.correlationId,
    p_chapter_number: filters.chapterNumber,
  }
}

async function queryRpc<T>(
  client: GenerationDbClient,
  name: string,
  args: Record<string, unknown>,
  schema: RpcSchema<T>,
): Promise<T> {
  let rows: unknown
  try {
    const { data, error } = await result(rpcRows(client, name, args).execute())
    if (error) throw new AdminGenerationQueryError('QUERY_FAILED')
    rows = data
  } catch (err) {
    if (err instanceof AdminGenerationQueryError) throw err
    throw new AdminGenerationQueryError('QUERY_FAILED')
  }

  const parsed = schema.safeParse(rows)
  if (!parsed.success) throw new AdminGenerationQueryError('INVALID_RESPONSE')
  return parsed.data
}

export async function loadAdminGenerationOverview(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminGenerationOverviewRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_overview_v1',
    commonArgs(filters),
    AdminGenerationOverviewSchema,
  )
}

export async function loadAdminGenerationTimeseries(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminGenerationTimeseriesRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_timeseries_v1',
    commonArgs(filters),
    AdminGenerationTimeseriesSchema,
  )
}

export async function loadAdminModelPerformance(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminModelPerformanceRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_model_performance_v1',
    commonArgs(filters),
    AdminModelPerformanceSchema,
  )
}

export async function loadAdminGenerationProviderCalls(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminGenerationProviderCall[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_provider_calls_v2',
    {
      ...commonArgs(filters),
      p_cursor_started_at: filters.cursorStartedAt,
      p_cursor_id: filters.cursorId,
      p_page_size: filters.pageSize,
    },
    AdminGenerationProviderCallPageSchema,
  )
}

export async function loadAdminGenerationJobDetail(
  jobId: string,
  client?: GenerationDbClient,
): Promise<AdminGenerationJobDetailRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_job_detail_v1',
    { p_job_id: jobId },
    AdminGenerationJobDetailSchema,
  )
}

export async function loadAdminGenerationDataQuality(
  filters: Pick<AdminGenerationFilters, 'from' | 'to'>,
  client?: GenerationDbClient,
): Promise<AdminGenerationDataQualityRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_data_quality_v1',
    { p_from: filters.from, p_to: filters.to },
    AdminGenerationDataQualitySchema,
  )
}

export async function loadAdminGenerationErrorDistribution(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminGenerationErrorDistributionRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_error_distribution_v1',
    commonArgs(filters),
    AdminGenerationErrorDistributionSchema,
  )
}

export async function loadAdminGenerationCostBreakdown(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminGenerationCostBreakdownRow[]> {
  return queryRpc(
    client ?? getDb(),
    'admin_generation_cost_breakdown_v1',
    { ...commonArgs(filters), p_limit: 100 },
    AdminGenerationCostBreakdownSchema,
  )
}

export interface AdminGenerationDashboard {
  overview: AdminGenerationOverviewRow[]
  timeseries: AdminGenerationTimeseriesRow[]
  modelPerformance: AdminModelPerformanceRow[]
  providerCalls: AdminGenerationProviderCall[]
  jobDetail: AdminGenerationJobDetailRow[] | null
  dataQuality: AdminGenerationDataQualityRow[]
  errorDistribution: AdminGenerationErrorDistributionRow[]
  costBreakdown: AdminGenerationCostBreakdownRow[]
}

export async function loadAdminGenerationDashboard(
  filters: AdminGenerationFilters,
  client?: GenerationDbClient,
): Promise<AdminGenerationDashboard> {
  const db = client ?? getDb()
  const jobDetailPromise = filters.jobId === null
    ? Promise.resolve(null)
    : loadAdminGenerationJobDetail(filters.jobId, db)

  const [
    overview,
    timeseries,
    modelPerformance,
    providerCalls,
    jobDetail,
    dataQuality,
    errorDistribution,
    costBreakdown,
  ] = await Promise.all([
    loadAdminGenerationOverview(filters, db),
    loadAdminGenerationTimeseries(filters, db),
    loadAdminModelPerformance(filters, db),
    loadAdminGenerationProviderCalls(filters, db),
    jobDetailPromise,
    loadAdminGenerationDataQuality(filters, db),
    loadAdminGenerationErrorDistribution(filters, db),
    loadAdminGenerationCostBreakdown(filters, db),
  ])

  return {
    overview,
    timeseries,
    modelPerformance,
    providerCalls,
    jobDetail,
    dataQuality,
    errorDistribution,
    costBreakdown,
  }
}

// Compatibility readers for existing Task 11 page. Task 12 replaces its view model.
export interface AdminGenerationMetric {
  attemptsToday: number
  successToday: number
  failedToday: number
  failureRate: number
}

export interface AdminGenerationEvent {
  id: string
  createdAt: string
  userId: string | null
  storyId: string | null
  chapterId: string | null
  status: string
  error: string | null
  durationMs: number | null
}

function todayFilters(now = new Date()): AdminGenerationFilters {
  const from = new Date(now)
  from.setUTCHours(0, 0, 0, 0)
  return {
    from: from.toISOString(),
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
    pageSize: 30,
  }
}

export async function loadAdminGenerationMetrics(): Promise<AdminGenerationMetric> {
  const rows = await loadAdminGenerationOverview(todayFilters())
  const current = rows.find((row) => row.period_name === 'current')
  if (!current) throw new AdminGenerationQueryError('INVALID_RESPONSE')
  return {
    attemptsToday: Number(current.call_count),
    successToday: Number(current.success_count),
    failedToday: Number(current.error_count),
    failureRate: Number(current.error_rate),
  }
}

export async function listAdminGenerationEvents(limit = 30): Promise<AdminGenerationEvent[]> {
  const filters = { ...todayFilters(), pageSize: Math.max(1, Math.min(100, limit)) }
  const rows = await loadAdminGenerationProviderCalls(filters)
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.started_at,
    userId: row.user_id,
    storyId: row.story_id,
    chapterId: row.chapter_number === null ? null : String(row.chapter_number),
    status: row.outcome,
    error: row.error_code,
    durationMs: Number(row.elapsed_ms),
  }))
}
