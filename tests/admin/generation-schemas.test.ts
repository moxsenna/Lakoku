import { describe, expect, it } from 'vitest'
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

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const FROM = '2026-07-17T12:00:00.000Z'
const TO = '2026-07-18T12:00:00.000Z'

const overviewRow = {
  period_name: 'current',
  period_from: FROM,
  period_to: TO,
  cost_currency: 'USD',
  call_count: '9007199254740993',
  input_token_count: '10000000000000000',
  output_token_count: '20000000000000000',
  total_token_count: '30000000000000000',
  success_count: '8',
  error_count: '2',
  fallback_call_count: '1',
  success_rate: '0.8',
  error_rate: '0.2',
  fallback_rate: '0.1',
  p50_elapsed_ms: '1200.5',
  p95_elapsed_ms: null,
  actual_cost_amount: '12.34000000',
  estimated_cost_amount: '1.23000000',
  unavailable_cost_count: '2',
  active_job_count: '3',
  failed_job_count: '1',
  retrying_job_count: '1',
  stale_job_count: '0',
} as const

const timeseriesRow = {
  bucket_start: FROM,
  cost_currency: 'USD',
  call_count: '10',
  success_count: '8',
  error_count: '2',
  fallback_call_count: '1',
  input_token_count: '100',
  output_token_count: '200',
  total_token_count: '300',
  actual_cost_amount: '0.01000000',
  estimated_cost_amount: '0.02000000',
  unavailable_cost_count: '2',
  p50_elapsed_ms: '1000',
  p95_elapsed_ms: '2000.25',
} as const

const modelRow = {
  provider_id: 'openrouter',
  model_id: 'anthropic/claude-sonnet-4',
  cost_currency: 'USD',
  call_count: '10',
  success_count: '8',
  success_rate: '0.8',
  fallback_call_count: '1',
  fallback_rate: '0.1',
  p50_elapsed_ms: '1000',
  p95_elapsed_ms: null,
  input_token_count: '100',
  output_token_count: '200',
  total_token_count: '300',
  actual_cost_amount: '0.01000000',
  estimated_cost_amount: '0.02000000',
  unavailable_cost_count: '2',
  average_cost_per_success: null,
} as const

const providerCallRow = {
  id: UUID_A,
  provider_call_id: 'provider-call-1',
  started_at: FROM,
  ended_at: TO,
  elapsed_ms: '86400000',
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
  cost_amount: '0.01400000',
  cost_currency: 'USD',
  cost_source: 'price_estimate',
  pricing_version_id: UUID_B,
} as const

const jobRow = {
  row_kind: 'JOB',
  sequence_number: '0',
  job_id: UUID_A,
  job_status: 'RUNNING',
  user_id: UUID_B,
  masked_user_email: 'a***@example.com',
  story_id: 'story-1',
  story_title: 'Story One',
  chapter_number: 2,
  generation_kind: 'standard',
  correlation_id: UUID_C,
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
} as const

describe('admin generation RPC schemas', () => {
  it('keeps overview decimal and bigint values as strings', () => {
    const result = AdminGenerationOverviewSchema.parse([overviewRow])
    expect(result[0]?.call_count).toBe('9007199254740993')
    expect(result[0]?.p95_elapsed_ms).toBeNull()
  })

  it('keeps currencies as separate overview rows', () => {
    const rows = AdminGenerationOverviewSchema.parse([
      overviewRow,
      { ...overviewRow, cost_currency: 'IDR', actual_cost_amount: '1000' },
    ])
    expect(rows.map((row) => row.cost_currency)).toEqual(['USD', 'IDR'])
  })

  it('accepts exact timeseries and model-performance outputs', () => {
    expect(AdminGenerationTimeseriesSchema.parse([timeseriesRow])).toHaveLength(1)
    expect(AdminModelPerformanceSchema.parse([modelRow])).toHaveLength(1)
  })

  it('accepts exact provider-call, job-detail, distribution, breakdown, and data-quality outputs', () => {
    expect(AdminGenerationProviderCallPageSchema.parse([providerCallRow])).toHaveLength(1)
    expect(AdminGenerationJobDetailSchema.parse([jobRow])).toHaveLength(1)
    expect(AdminGenerationErrorDistributionSchema.parse([{
      outcome: 'TIMEOUT',
      error_code: 'PROVIDER_TIMEOUT',
      fallback_bucket: 'FALLBACK',
      call_count: '2',
    }])).toHaveLength(1)
    expect(AdminGenerationCostBreakdownSchema.parse([{
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
    }])).toHaveLength(1)
    expect(AdminGenerationDataQualitySchema.parse([{
      metric_name: 'missing_usage',
      issue_count: '2',
      oldest_issue_at: FROM,
      newest_issue_at: TO,
    }])).toHaveLength(1)
  })

  it.each([
    ['overview', AdminGenerationOverviewSchema, [overviewRow]],
    ['timeseries', AdminGenerationTimeseriesSchema, [timeseriesRow]],
    ['model performance', AdminModelPerformanceSchema, [modelRow]],
    ['provider calls', AdminGenerationProviderCallPageSchema, [providerCallRow]],
    ['job detail', AdminGenerationJobDetailSchema, [jobRow]],
    ['error distribution', AdminGenerationErrorDistributionSchema, [{
      outcome: 'TIMEOUT', error_code: 'PROVIDER_TIMEOUT', fallback_bucket: 'FALLBACK', call_count: '2',
    }]],
    ['cost breakdown', AdminGenerationCostBreakdownSchema, [{
      use_case: 'chapter', user_id: UUID_B, masked_user_email: 'a***@example.com',
      generation_kind: 'standard', provider_id: 'openrouter', model_id: 'model-a',
      cost_currency: 'USD', call_count: '2', actual_cost_amount: '1.25',
      estimated_cost_amount: '0.5', unavailable_cost_count: '0',
    }]],
    ['data quality', AdminGenerationDataQualitySchema, [{
      metric_name: 'missing_usage', issue_count: '2', oldest_issue_at: null, newest_issue_at: null,
    }]],
  ])('rejects unknown %s RPC fields', (_name, schema, rows) => {
    expect(schema.safeParse(rows.map((row) => ({ ...row, raw_error: 'secret' }))).success).toBe(false)
  })

  it('rejects unsafe numeric coercion for bigint output', () => {
    expect(AdminGenerationOverviewSchema.safeParse([{
      ...overviewRow,
      call_count: 9_007_199_254_740_992,
    }]).success).toBe(false)
  })
})
