import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadOverview: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/admin/generation', () => ({
  loadAdminGenerationOverview: mocks.loadOverview,
}))

function queryBuilder(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'gte', 'lt', 'eq', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return builder
}

function adminClient(providerCallRows: unknown[] = []) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'reader_taste_profiles') return queryBuilder({ count: 0, data: null, error: null })
      if (table === 'credit_ledger') return queryBuilder({ data: [], error: null })
      if (table === 'credit_orders') return queryBuilder({ count: 0, data: [], error: null })
      if (table === 'generation_provider_calls') return queryBuilder({ data: providerCallRows, error: null })
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

function overview(errorCount = '2') {
  return [{
    period_name: 'current',
    period_from: '2026-07-18T00:00:00.000Z',
    period_to: '2026-07-18T12:00:00.000Z',
    cost_currency: null,
    call_count: '10',
    input_token_count: '100',
    output_token_count: '200',
    total_token_count: '300',
    success_count: '8',
    error_count: errorCount,
    fallback_call_count: '1',
    success_rate: '0.8',
    error_rate: '0.2',
    fallback_rate: '0.1',
    p50_elapsed_ms: '1000',
    p95_elapsed_ms: null,
    actual_cost_amount: '0',
    estimated_cost_amount: '0',
    unavailable_cost_count: '2',
    active_job_count: '0',
    failed_job_count: '0',
    retrying_job_count: '0',
    stale_job_count: '0',
  }]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.createAdminClient.mockReturnValue(adminClient())
  mocks.loadOverview.mockResolvedValue(overview())
})

describe('admin dashboard generation summary', () => {
  it('uses shared generation overview loader and no story_events query', async () => {
    const db = adminClient()
    mocks.createAdminClient.mockReturnValue(db)
    const { loadAdminDashboardMetrics } = await import('@/lib/admin/dashboard')

    const result = await loadAdminDashboardMetrics(new Date('2026-07-18T12:00:00.000Z'))

    expect(result.generationAttemptsToday).toBe(10)
    expect(result.generationFailuresToday).toBe(2)
    expect(mocks.loadOverview).toHaveBeenCalledWith(expect.objectContaining({
      from: '2026-07-18T00:00:00.000Z',
      to: '2026-07-18T12:00:00.000Z',
    }))
    expect(db.from).not.toHaveBeenCalledWith('story_events')
  })

  it('does not catch generation query failure into zero metrics', async () => {
    const queryError = Object.assign(new Error('Generation observability query failed'), {
      name: 'AdminGenerationQueryError',
      code: 'QUERY_FAILED',
    })
    mocks.loadOverview.mockRejectedValue(queryError)
    const { loadAdminDashboardMetrics } = await import('@/lib/admin/dashboard')

    await expect(loadAdminDashboardMetrics(new Date('2026-07-18T12:00:00.000Z')))
      .rejects.toBe(queryError)
  })

  it('computes daily cost summary with E0 R1 ceilings from provider calls', async () => {
    const sampleRows = [
      {
        started_at: '2026-07-18T05:00:00.000Z',
        story_id: 'story-1',
        chapter_number: 1,
        job_id: 'job-1',
        provider_id: 'openrouter',
        model_id: 'model-a',
        outcome: 'SUCCEEDED',
        cost_amount: '0.15000000',
        cost_currency: 'USD',
        cost_source: 'provider_actual',
      },
      {
        started_at: '2026-07-18T06:00:00.000Z',
        story_id: 'story-1',
        chapter_number: 2,
        job_id: 'job-2',
        provider_id: 'openrouter',
        model_id: 'model-a',
        outcome: 'SUCCEEDED',
        cost_amount: null,
        cost_currency: null,
        cost_source: 'unavailable',
      },
    ]

    const db = adminClient(sampleRows)
    mocks.createAdminClient.mockReturnValue(db)
    const { loadAdminDailyCostSummary } = await import('@/lib/admin/dashboard')

    const summary = await loadAdminDailyCostSummary(1, new Date('2026-07-18T12:00:00.000Z'))

    expect(summary.status).toBe('UNMEASURED')
    expect(summary.callCount).toBe(2)
    expect(summary.pricedCallCount).toBe(1)
    expect(summary.unmeasuredCallCount).toBe(1)
    expect(summary.totalMeasuredCostUsd).toBe('0.15000000')
    expect(summary.chapterCeilingUsd).toBe('2.10000000')
    expect(summary.novelCeilingUsd).toBe('200.00000000')
    expect(db.from).toHaveBeenCalledWith('generation_provider_calls')
  })
})
