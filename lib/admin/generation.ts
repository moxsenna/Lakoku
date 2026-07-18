import 'server-only'
import type { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import {
  AdminGenerationDataQualitySchema,
  AdminGenerationJobDetailSchema,
  AdminGenerationOverviewSchema,
  AdminGenerationProviderCallPageSchema,
  AdminGenerationTimeseriesSchema,
  AdminModelPerformanceSchema,
} from '@/lib/admin/generation-schemas'
import type {
  AdminGenerationDataQualityRow,
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

type RpcResult = Promise<{ data: unknown; error: unknown }>
type GenerationRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => RpcResult
}

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
  client: GenerationRpcClient,
  name: string,
  args: Record<string, unknown>,
  schema: RpcSchema<T>,
): Promise<T> {
  let result: Awaited<RpcResult>
  try {
    result = await client.rpc(name, args)
  } catch {
    throw new AdminGenerationQueryError('QUERY_FAILED')
  }

  if (result.error) throw new AdminGenerationQueryError('QUERY_FAILED')

  const parsed = schema.safeParse(result.data)
  if (!parsed.success) throw new AdminGenerationQueryError('INVALID_RESPONSE')
  return parsed.data
}

async function cookieClient(): Promise<GenerationRpcClient> {
  return await createClient() as unknown as GenerationRpcClient
}

export async function loadAdminGenerationOverview(
  filters: AdminGenerationFilters,
  client?: GenerationRpcClient,
): Promise<AdminGenerationOverviewRow[]> {
  return queryRpc(
    client ?? await cookieClient(),
    'admin_generation_overview_v1',
    commonArgs(filters),
    AdminGenerationOverviewSchema,
  )
}

export async function loadAdminGenerationTimeseries(
  filters: AdminGenerationFilters,
  client?: GenerationRpcClient,
): Promise<AdminGenerationTimeseriesRow[]> {
  return queryRpc(
    client ?? await cookieClient(),
    'admin_generation_timeseries_v1',
    commonArgs(filters),
    AdminGenerationTimeseriesSchema,
  )
}

export async function loadAdminModelPerformance(
  filters: AdminGenerationFilters,
  client?: GenerationRpcClient,
): Promise<AdminModelPerformanceRow[]> {
  return queryRpc(
    client ?? await cookieClient(),
    'admin_model_performance_v1',
    commonArgs(filters),
    AdminModelPerformanceSchema,
  )
}

export async function loadAdminGenerationProviderCalls(
  filters: AdminGenerationFilters,
  client?: GenerationRpcClient,
): Promise<AdminGenerationProviderCall[]> {
  return queryRpc(
    client ?? await cookieClient(),
    'admin_generation_provider_calls_v1',
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
  client?: GenerationRpcClient,
): Promise<AdminGenerationJobDetailRow[]> {
  return queryRpc(
    client ?? await cookieClient(),
    'admin_generation_job_detail_v1',
    { p_job_id: jobId },
    AdminGenerationJobDetailSchema,
  )
}

export async function loadAdminGenerationDataQuality(
  filters: Pick<AdminGenerationFilters, 'from' | 'to'>,
  client?: GenerationRpcClient,
): Promise<AdminGenerationDataQualityRow[]> {
  return queryRpc(
    client ?? await cookieClient(),
    'admin_generation_data_quality_v1',
    { p_from: filters.from, p_to: filters.to },
    AdminGenerationDataQualitySchema,
  )
}

export interface AdminGenerationDashboard {
  overview: AdminGenerationOverviewRow[]
  timeseries: AdminGenerationTimeseriesRow[]
  modelPerformance: AdminModelPerformanceRow[]
  providerCalls: AdminGenerationProviderCall[]
  jobDetail: AdminGenerationJobDetailRow[] | null
  dataQuality: AdminGenerationDataQualityRow[]
}

export async function loadAdminGenerationDashboard(
  filters: AdminGenerationFilters,
): Promise<AdminGenerationDashboard> {
  const client = await cookieClient()
  const jobDetailPromise = filters.jobId === null
    ? Promise.resolve(null)
    : loadAdminGenerationJobDetail(filters.jobId, client)

  const [overview, timeseries, modelPerformance, providerCalls, jobDetail, dataQuality] =
    await Promise.all([
      loadAdminGenerationOverview(filters, client),
      loadAdminGenerationTimeseries(filters, client),
      loadAdminModelPerformance(filters, client),
      loadAdminGenerationProviderCalls(filters, client),
      jobDetailPromise,
      loadAdminGenerationDataQuality(filters, client),
    ])

  return { overview, timeseries, modelPerformance, providerCalls, jobDetail, dataQuality }
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
