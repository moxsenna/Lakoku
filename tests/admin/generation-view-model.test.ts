import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdminGenerationDashboard } from '@/lib/admin/generation'
import type { AdminGenerationFilters } from '@/lib/admin/generation-filters'
import type {
  AdminGenerationJobDetailRow,
  AdminGenerationOverviewRow,
  AdminGenerationProviderCall,
  AdminGenerationTimeseriesRow,
} from '@/lib/admin/generation-schemas'
import {
  addDecimalStrings,
  buildGenerationViewModel,
  formatDecimal,
  generationJobHref,
} from '@/components/admin/generation/generation-view-model'
import { GenerationSummaryGrid } from '@/components/admin/generation/generation-summary-grid'
import { GenerationTimeseries } from '@/components/admin/generation/generation-timeseries'
import { ErrorFallbackDistribution } from '@/components/admin/generation/error-fallback-distribution'
import { GenerationCostBreakdown } from '@/components/admin/generation/generation-cost-breakdown'
import { GenerationDataQuality } from '@/components/admin/generation/generation-data-quality'
import { GenerationFilterBar } from '@/components/admin/generation/generation-filter-bar'
import { ProviderCallLedger } from '@/components/admin/generation/provider-call-ledger'
import { GenerationJobDrawer } from '@/components/admin/generation/generation-job-drawer'
import GenerationLoading from '@/app/admin/generation/loading'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const FROM = '2026-07-17T12:00:00.000Z'
const TO = '2026-07-18T12:00:00.000Z'

const filters: AdminGenerationFilters = {
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
  jobId: null,
  correlationId: null,
  chapterNumber: null,
  cursorStartedAt: null,
  cursorId: null,
  pageSize: 2,
}

function overview(overrides: Partial<AdminGenerationOverviewRow> = {}): AdminGenerationOverviewRow {
  return {
    period_name: 'current',
    period_from: FROM,
    period_to: TO,
    cost_currency: 'USD',
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
    actual_cost_amount: '1.25',
    estimated_cost_amount: '0.50',
    unavailable_cost_count: '2',
    active_job_count: '1',
    failed_job_count: '0',
    retrying_job_count: '0',
    stale_job_count: '0',
    ...overrides,
  }
}

function providerCall(overrides: Partial<AdminGenerationProviderCall> = {}): AdminGenerationProviderCall {
  return {
    id: UUID_A,
    provider_call_id: 'provider-call-1',
    started_at: FROM,
    ended_at: TO,
    elapsed_ms: '1000',
    user_id: UUID_B,
    masked_user_email: 'a***@example.com',
    story_id: 'story-1',
    story_title: 'Story One',
    chapter_number: 2,
    generation_kind: 'standard',
    job_id: UUID_C,
    correlation_id: UUID_A,
    attempt_number: 1,
    use_case: 'chapter',
    workflow_phase: 'CHAPTER_PROSE_INITIAL',
    provider_id: 'openrouter',
    model_id: 'anthropic/claude-sonnet-4',
    route_version: 'chapter-v1',
    fallback_index: 0,
    actual_model_resolved: true,
    outcome: 'SUCCEEDED',
    error_code: null,
    input_token_count: '100',
    output_token_count: '200',
    total_token_count: '300',
    cost_amount: '0.014',
    cost_currency: 'USD',
    cost_source: 'price_estimate',
    pricing_version_id: UUID_B,
    ...overrides,
  }
}

function jobRow(overrides: Partial<AdminGenerationJobDetailRow> = {}): AdminGenerationJobDetailRow {
  return {
    row_kind: 'JOB',
    sequence_number: '0',
    job_id: UUID_C,
    job_status: 'RUNNING',
    user_id: UUID_B,
    masked_user_email: 'a***@example.com',
    story_id: 'story-1',
    story_title: 'Story One',
    chapter_number: 2,
    generation_kind: 'standard',
    correlation_id: UUID_A,
    job_attempt_count: 1,
    max_attempts: 4,
    available_at: FROM,
    deadline_at: TO,
    claimed_at: FROM,
    heartbeat_at: FROM,
    worker_id: 'worker-1',
    job_error_code: null,
    job_created_at: FROM,
    job_updated_at: TO,
    completed_at: null,
    attempt_id: null,
    attempt_number: null,
    workflow_phase: null,
    provider_id: null,
    model_id: null,
    started_at: null,
    ended_at: null,
    elapsed_ms: null,
    lease_age_ms: null,
    lease_remaining_ms: null,
    retry_decision: null,
    error_code: null,
    provider_call_row_id: null,
    provider_call_id: null,
    use_case: null,
    fallback_index: null,
    actual_model_resolved: null,
    outcome: null,
    input_token_count: null,
    output_token_count: null,
    total_token_count: null,
    cost_amount: null,
    cost_currency: null,
    cost_source: null,
    ...overrides,
  }
}

function dashboard(overrides: Partial<AdminGenerationDashboard> = {}): AdminGenerationDashboard {
  return {
    overview: [overview()],
    timeseries: [],
    modelPerformance: [],
    providerCalls: [],
    jobDetail: null,
    dataQuality: [],
    errorDistribution: [],
    costBreakdown: [],
    ...overrides,
  }
}

describe('generation operations view model', () => {
  it('renders explicit loading, empty, and query-error states', () => {
    expect(renderToStaticMarkup(createElement(GenerationLoading))).toMatch(/Loading generation observability/i)
    expect(buildGenerationViewModel(filters, dashboard({ overview: [] })).state).toBe('empty')
    expect(buildGenerationViewModel(filters, null, new Error('raw DB secret'))).toMatchObject({
      state: 'error',
      errorMessage: 'Generation observability is unavailable.',
    })
    expect(JSON.stringify(buildGenerationViewModel(filters, null, new Error('raw DB secret')))).not.toContain('raw DB secret')
  })

  it('keeps currencies separate and marks missing values unavailable instead of zero', () => {
    expect(addDecimalStrings('9007199254740993.12345678', '0.87654322')).toBe('9007199254740994')
    expect(formatDecimal('9007199254740993', 0)).toBe('9,007,199,254,740,993')

    const vm = buildGenerationViewModel(filters, dashboard({
      overview: [
        overview({ cost_currency: 'USD', actual_cost_amount: '1.25' }),
        overview({ cost_currency: 'IDR', actual_cost_amount: '20000' }),
      ],
      providerCalls: [providerCall({ input_token_count: null, output_token_count: null, total_token_count: null, cost_amount: null, cost_currency: null, cost_source: 'unavailable' })],
      dataQuality: [{ metric_name: 'missing_usage', issue_count: '1', oldest_issue_at: FROM, newest_issue_at: TO }],
    }))

    expect(vm.state).toBe('partial')
    expect(vm.costs.map((cost) => cost.currency)).toEqual(['USD', 'IDR'])
    const rendered = renderToStaticMarkup(createElement(GenerationSummaryGrid, { viewModel: vm }))
    expect(rendered).toContain('USD')
    expect(rendered).toContain('IDR')
    expect(rendered).toContain('Unavailable')
  })

  it('keeps valid synchronous calls informational instead of degraded', () => {
    const quality = [{
      metric_name: 'calls_lacking_durable_correlation' as const,
      issue_count: '3',
      oldest_issue_at: FROM,
      newest_issue_at: TO,
    }]
    const vm = buildGenerationViewModel(filters, dashboard({
      overview: [overview({ unavailable_cost_count: '0' })],
      dataQuality: quality,
    }))

    expect(vm.state).toBe('ready')
    const rendered = renderToStaticMarkup(createElement(GenerationDataQuality, { rows: quality }))
    expect(rendered).toContain('Synchronous calls')
    expect(rendered).not.toContain('Partial data')
  })

  it('renders previous-period comparisons including zero and unavailable baselines', () => {
    const vm = buildGenerationViewModel(filters, dashboard({
      overview: [
        overview({ unavailable_cost_count: '0' }),
        overview({
          period_name: 'previous',
          call_count: '0',
          total_token_count: '0',
          success_rate: '0.4',
          error_rate: '0',
          fallback_rate: '0',
          p50_elapsed_ms: null,
          p95_elapsed_ms: null,
          actual_cost_amount: '0',
          estimated_cost_amount: '0',
          unavailable_cost_count: '0',
        }),
      ],
    }))
    const rendered = renderToStaticMarkup(createElement(GenerationSummaryGrid, { viewModel: vm }))

    expect(rendered).toContain('vs previous')
    expect(rendered).toContain('No previous activity')
    expect(rendered).toContain('Previous unavailable')
    expect(rendered.match(/previous/gi) ?? []).toHaveLength(13)
  })

  it('deduplicates daily call and token totals while rendering currency-separated cost series', () => {
    const base: AdminGenerationTimeseriesRow = {
      bucket_start: FROM,
      cost_currency: 'USD',
      call_count: '10',
      success_count: '8',
      error_count: '2',
      fallback_call_count: '1',
      input_token_count: '100',
      output_token_count: '200',
      total_token_count: '300',
      actual_cost_amount: '1',
      estimated_cost_amount: '0.5',
      unavailable_cost_count: '0',
      p50_elapsed_ms: '1000',
      p95_elapsed_ms: '2000',
    }
    const rendered = renderToStaticMarkup(createElement(GenerationTimeseries, {
      rows: [base, { ...base, cost_currency: 'EUR', actual_cost_amount: '2' }],
    }))

    expect((rendered.match(/>10<\/td>/g) ?? [])).toHaveLength(1)
    expect((rendered.match(/>300<\/td>/g) ?? [])).toHaveLength(1)
    expect(rendered).toContain('Cost USD')
    expect(rendered).toContain('Cost EUR')
    expect(rendered).toContain('USD 1.5')
    expect(rendered).toContain('EUR 2.5')
  })

  it('renders full-range aggregate distribution and cost breakdown dimensions', () => {
    const distribution = renderToStaticMarkup(createElement(ErrorFallbackDistribution, { rows: [{
      outcome: 'TIMEOUT',
      error_code: 'PROVIDER_TIMEOUT',
      fallback_bucket: 'FALLBACK',
      call_count: '42',
    }] }))
    expect(distribution).toContain('full selected range')
    expect(distribution).toContain('FALLBACK')
    expect(distribution).toContain('42')

    const breakdown = renderToStaticMarkup(createElement(GenerationCostBreakdown, { rows: [{
      use_case: 'chapter',
      user_id: UUID_B,
      masked_user_email: 'a***@example.com',
      generation_kind: 'standard',
      provider_id: 'openrouter',
      model_id: 'model-a',
      cost_currency: 'USD',
      call_count: '2',
      actual_cost_amount: '1.25',
      estimated_cost_amount: '0.5',
      unavailable_cost_count: '0',
    }] }))
    expect(breakdown).toContain('Cost breakdown')
    expect(breakdown).toContain('a***@example.com')
    expect(breakdown).toContain('chapter')
    expect(breakdown).toContain('standard')
    expect(breakdown).toContain('openrouter')
    expect(breakdown).toContain('model-a')
    expect(breakdown).toContain('USD 1.75')
  })

  it('renders every filter control and resets cursors on submission', () => {
    const rendered = renderToStaticMarkup(createElement(GenerationFilterBar, {
      filters: {
        ...filters,
        errorCode: 'PROVIDER_TIMEOUT',
        userId: UUID_A,
        storyId: 'story-1',
        generationKind: 'standard',
        jobId: UUID_C,
        correlationId: UUID_B,
        chapterNumber: 2,
        cursorStartedAt: FROM,
        cursorId: UUID_A,
      },
    }))

    for (const name of [
      'from', 'to', 'provider', 'model', 'useCase', 'phase', 'outcome',
      'errorCode', 'costSource', 'userId', 'storyId', 'generationKind',
      'jobId', 'correlationId', 'chapter', 'pageSize',
    ]) expect(rendered).toContain(`name="${name}"`)
    expect(rendered).not.toContain('name="cursorStartedAt"')
    expect(rendered).not.toContain('name="cursorId"')
    expect(rendered.match(/type="hidden"/g) ?? []).toHaveLength(0)
  })

  it('builds deterministic next cursor and preserves active filters for large pages', () => {
    const calls = [
      providerCall({ id: UUID_A, started_at: TO }),
      providerCall({ id: UUID_B, started_at: FROM }),
    ]
    const vm = buildGenerationViewModel(filters, dashboard({ providerCalls: calls }))

    expect(vm.nextHref).toContain('cursorStartedAt=')
    expect(vm.nextHref).toContain(`cursorId=${UUID_B}`)
    expect(vm.nextHref).toContain('provider=openrouter')
    expect(vm.nextHref).toContain('pageSize=2')
    expect(generationJobHref(filters, UUID_C)).toContain('provider=openrouter')
    expect(generationJobHref(filters, UUID_C)).toContain(`jobId=${UUID_C}`)
  })

  it('renders masked identity with authorized user link and no mutation controls', () => {
    const calls = [providerCall()]
    const vm = buildGenerationViewModel(filters, dashboard({ providerCalls: calls }))
    const rendered = renderToStaticMarkup(createElement(ProviderCallLedger, {
      calls,
      filters,
      nextHref: vm.nextHref,
    }))

    expect(rendered).toContain('a***@example.com')
    expect(rendered).toContain(`/admin/users/${UUID_B}`)
    expect(rendered).not.toContain('a@example.com')
    expect(rendered).not.toMatch(/retry job|cancel job|recover job|edit route/i)
  })

  it('orders job drawer attempts and calls without exposing sensitive job fields', () => {
    const rows = [
      jobRow({ row_kind: 'CALL', sequence_number: '3', provider_call_row_id: UUID_A, provider_call_id: 'call-2', attempt_number: 2, started_at: TO, provider_id: 'openrouter', model_id: 'model-b', workflow_phase: 'CHAPTER_PROSE_INITIAL', fallback_index: 1, outcome: 'SUCCEEDED', cost_source: 'unavailable' }),
      jobRow(),
      jobRow({ row_kind: 'ATTEMPT', sequence_number: '1', attempt_id: UUID_A, attempt_number: 1, started_at: FROM, workflow_phase: 'CHAPTER_PROSE_INITIAL', retry_decision: 'RETRY', error_code: 'PROVIDER_TIMEOUT' }),
      jobRow({ row_kind: 'CALL', sequence_number: '2', provider_call_row_id: UUID_B, provider_call_id: 'call-1', attempt_number: 1, started_at: FROM, provider_id: 'openrouter', model_id: 'model-a', workflow_phase: 'CHAPTER_PROSE_INITIAL', fallback_index: 0, outcome: 'TIMEOUT', error_code: 'PROVIDER_TIMEOUT', cost_source: 'unavailable' }),
    ]
    const rendered = renderToStaticMarkup(createElement(GenerationJobDrawer, { rows, filters }))

    expect(rendered.indexOf('Attempt 1')).toBeLessThan(rendered.indexOf('call-1'))
    expect(rendered.indexOf('call-1')).toBeLessThan(rendered.indexOf('call-2'))
    expect(rendered).toContain(`/admin/users/${UUID_B}`)
    expect(rendered).not.toMatch(/claim[_ ]?token|publication[_ ]?(result|json)|raw content/i)
    expect(rendered).not.toMatch(/retry job|cancel job|recover job|edit route/i)
  })
})
