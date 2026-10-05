import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getDb: vi.fn(),
  rpcRows: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAdminClient: mocks.createAdminClient,
    getDb: mocks.getDb,
    rpcRows: mocks.rpcRows,
  }
})

const UUID_A = '11111111-1111-4111-8111-111111111111'
const FROM = '2026-07-17T12:00:00.000Z'
const TO = '2026-07-18T12:00:00.000Z'

const filters = {
  from: FROM,
  to: TO,
  providerId: 'openrouter',
  modelId: null,
  useCase: null,
  workflowPhase: null,
  outcome: null,
  errorCode: null,
  costSource: null,
  userId: null,
  storyId: null,
  generationKind: null,
  jobId: UUID_A,
  correlationId: null,
  chapterNumber: null,
  cursorStartedAt: null,
  cursorId: null,
  pageSize: 50,
} as const

const commonArgs = {
  p_from: FROM,
  p_to: TO,
  p_provider_id: 'openrouter',
  p_model_id: null,
  p_use_case: null,
  p_workflow_phase: null,
  p_outcome: null,
  p_error_code: null,
  p_cost_source: null,
  p_user_id: null,
  p_story_id: null,
  p_generation_kind: null,
  p_job_id: UUID_A,
  p_correlation_id: null,
  p_chapter_number: null,
}

const overviewRows = ['USD', 'IDR'].map((currency) => ({
  period_name: 'current',
  period_from: FROM,
  period_to: TO,
  cost_currency: currency,
  call_count: '10',
  input_token_count: '100',
  output_token_count: '200',
  total_token_count: '300',
  success_count: '8',
  error_count: '2',
  fallback_call_count: '1',
  success_rate: '0.8',
  error_rate: '0.2',
  fallback_rate: '0.1',
  p50_elapsed_ms: '1000',
  p95_elapsed_ms: null,
  actual_cost_amount: currency === 'USD' ? '1.25' : '1000',
  estimated_cost_amount: '0',
  unavailable_cost_count: '2',
  active_job_count: '1',
  failed_job_count: '0',
  retrying_job_count: '0',
  stale_job_count: '0',
}))

function createRpcClient(results?: Partial<Record<string, { data: unknown; error: unknown }>>) {
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    const res = results?.[name] ?? {
      data: name === 'admin_generation_overview_v1' ? overviewRows : [],
      error: null,
    }
    if (res.error) {
      const err = new Error(
        typeof res.error === 'object' && res.error !== null && 'message' in res.error
          ? String((res.error as { message: unknown }).message)
          : 'RPC error',
      )
      throw err
    }
    return res.data
  })
  return { rpc }
}

function wireMockDb(client: ReturnType<typeof createRpcClient>) {
  const selectQuery = {
    select: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    orderBy: vi.fn(() => selectQuery),
    limit: vi.fn(() => selectQuery),
    execute: vi.fn(async () => []),
  }
  const db = {
    ...client,
    selectFrom: vi.fn(() => selectQuery),
  }
  mocks.getDb.mockReturnValue(db)
  mocks.rpcRows.mockImplementation((_client: unknown, name: string, args: Record<string, unknown>) => {
    return {
      execute: vi.fn(async () => client.rpc(name, args)),
    }
  })
}

function createDashboardAdminClient() {
  const query = (result: unknown) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'gte', 'lt', 'eq']) {
      builder[method] = vi.fn(() => builder)
    }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return builder
  }
  return {
    from: vi.fn((table: string) => {
      if (table === 'reader_taste_profiles') return query({ count: 0, data: null, error: null })
      if (table === 'credit_ledger') return query({ data: [], error: null })
      if (table === 'credit_orders') return query({ count: 0, data: [], error: null })
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  const client = createRpcClient()
  mocks.createClient.mockResolvedValue(client)
  wireMockDb(client)
})

describe('admin generation RPC loaders', () => {
  it('maps filters to exact eight RPC signatures using cookie-scoped client only', async () => {
    const client = createRpcClient()
    mocks.createClient.mockResolvedValue(client)
    wireMockDb(client)
    const generation = await import('@/lib/admin/generation')

    await generation.loadAdminGenerationOverview(filters)
    await generation.loadAdminGenerationTimeseries(filters)
    await generation.loadAdminModelPerformance(filters)
    await generation.loadAdminGenerationProviderCalls(filters)
    await generation.loadAdminGenerationJobDetail(UUID_A)
    await generation.loadAdminGenerationDataQuality(filters)
    await generation.loadAdminGenerationErrorDistribution(filters)
    await generation.loadAdminGenerationCostBreakdown(filters)

    expect(client.rpc.mock.calls).toEqual([
      ['admin_generation_overview_v1', commonArgs],
      ['admin_generation_timeseries_v1', commonArgs],
      ['admin_model_performance_v1', commonArgs],
      ['admin_generation_provider_calls_v2', {
        ...commonArgs,
        p_cursor_started_at: null,
        p_cursor_id: null,
        p_page_size: 50,
      }],
      ['admin_generation_job_detail_v1', { p_job_id: UUID_A }],
      ['admin_generation_data_quality_v1', { p_from: FROM, p_to: TO }],
      ['admin_generation_error_distribution_v1', commonArgs],
      ['admin_generation_cost_breakdown_v1', { ...commonArgs, p_limit: 100 }],
    ])
    expect(mocks.getDb).toHaveBeenCalledTimes(8)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('loads dashboard RPCs concurrently through one cookie-scoped client', async () => {
    const pendingResolvers: Array<() => void> = []
    const rpc = vi.fn((name: string, _args?: unknown) => new Promise<unknown>((resolve) => {
      pendingResolvers.push(() => resolve(name === 'admin_generation_overview_v1' ? overviewRows : []))
    }))
    const client = { rpc }
    mocks.createClient.mockResolvedValue(client)
    mocks.getDb.mockReturnValue(client)
    mocks.rpcRows.mockImplementation((_client: unknown, name: string, args: Record<string, unknown>) => ({
      execute: vi.fn(async () => client.rpc(name, args)),
    }))
    const { loadAdminGenerationDashboard } = await import('@/lib/admin/generation')

    const resultPromise = loadAdminGenerationDashboard(filters)
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(8))
    pendingResolvers.forEach((resolve) => resolve())
    const result = await resultPromise

    expect(mocks.getDb).toHaveBeenCalledTimes(1)
    expect(result.overview.map((row) => row.cost_currency)).toEqual(['USD', 'IDR'])
    expect(result.timeseries).toEqual([])
    expect(result.errorDistribution).toEqual([])
    expect(result.costBreakdown).toEqual([])
    expect(result.jobDetail).toEqual([])
  })

  it('omits job-detail RPC when no job filter exists', async () => {
    const client = createRpcClient()
    mocks.createClient.mockResolvedValue(client)
    wireMockDb(client)
    const { loadAdminGenerationDashboard } = await import('@/lib/admin/generation')

    const result = await loadAdminGenerationDashboard({ ...filters, jobId: null })

    expect(client.rpc).toHaveBeenCalledTimes(7)
    expect(result.jobDetail).toBeNull()
  })

  it('maps DB failures to stable QUERY_FAILED without raw DB text or zero metrics', async () => {
    const client = createRpcClient({
      admin_generation_overview_v1: {
        data: null,
        error: { message: 'secret relation detail', code: 'P0001' },
      },
    })
    mocks.createClient.mockResolvedValue(client)
    wireMockDb(client)
    const {
      AdminGenerationQueryError,
      loadAdminGenerationOverview,
    } = await import('@/lib/admin/generation')

    const error = await loadAdminGenerationOverview(filters).catch((value) => value)
    expect(error).toBeInstanceOf(AdminGenerationQueryError)
    expect(error.code).toBe('QUERY_FAILED')
    expect(error.message).not.toContain('secret relation detail')
    expect(error).not.toEqual(expect.objectContaining({ call_count: '0' }))
  })

  it('maps strict output mismatch to stable INVALID_RESPONSE', async () => {
    const client = createRpcClient({
      admin_generation_overview_v1: {
        data: [{ ...overviewRows[0], raw_error: 'secret' }],
        error: null,
      },
    })
    mocks.createClient.mockResolvedValue(client)
    wireMockDb(client)
    const { loadAdminGenerationOverview } = await import('@/lib/admin/generation')

    await expect(loadAdminGenerationOverview(filters)).rejects.toMatchObject({
      name: 'AdminGenerationQueryError',
      code: 'INVALID_RESPONSE',
      message: 'Generation observability response was invalid',
    })
  })

  it('dashboard summary keeps generation failure visible while other metrics load', async () => {
    mocks.createAdminClient.mockReturnValue(createDashboardAdminClient())
    const client = createRpcClient({
      admin_generation_overview_v1: {
        data: null,
        error: { message: 'secret DB detail' },
      },
    })
    mocks.createClient.mockResolvedValue(client)
    wireMockDb(client)
    const { loadAdminDashboardMetrics } = await import('@/lib/admin/dashboard')

    const error = await loadAdminDashboardMetrics(new Date(TO)).catch((value) => value)
    expect(error).toMatchObject({
      name: 'AdminGenerationQueryError',
      code: 'QUERY_FAILED',
    })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
