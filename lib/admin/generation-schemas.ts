import { z } from 'zod'
import {
  ProviderCallCostSourceSchema,
  ProviderCallOutcomeSchema,
} from '@/lib/observability/generation-provider-call.contract'

const TimestampSchema = z.iso.datetime({ offset: true })
const NonnegativeDecimalStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/)
const NonnegativeIntegerStringSchema = z.string().regex(/^\d+$/)
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/)
const GenerationKindSchema = z.enum(['standard', 'personalized'])
const GenerationJobStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'RETRY_WAIT',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
])

export const AdminGenerationOverviewRowSchema = z.object({
  period_name: z.enum(['current', 'previous']),
  period_from: TimestampSchema,
  period_to: TimestampSchema,
  cost_currency: CurrencySchema.nullable(),
  call_count: NonnegativeIntegerStringSchema,
  input_token_count: NonnegativeDecimalStringSchema,
  output_token_count: NonnegativeDecimalStringSchema,
  total_token_count: NonnegativeDecimalStringSchema,
  success_count: NonnegativeIntegerStringSchema,
  error_count: NonnegativeIntegerStringSchema,
  fallback_call_count: NonnegativeIntegerStringSchema,
  success_rate: NonnegativeDecimalStringSchema,
  error_rate: NonnegativeDecimalStringSchema,
  fallback_rate: NonnegativeDecimalStringSchema,
  p50_elapsed_ms: NonnegativeDecimalStringSchema.nullable(),
  p95_elapsed_ms: NonnegativeDecimalStringSchema.nullable(),
  actual_cost_amount: NonnegativeDecimalStringSchema,
  estimated_cost_amount: NonnegativeDecimalStringSchema,
  unavailable_cost_count: NonnegativeIntegerStringSchema,
  active_job_count: NonnegativeIntegerStringSchema,
  failed_job_count: NonnegativeIntegerStringSchema,
  retrying_job_count: NonnegativeIntegerStringSchema,
  stale_job_count: NonnegativeIntegerStringSchema,
}).strict()

export const AdminGenerationOverviewSchema = z.array(AdminGenerationOverviewRowSchema)

export const AdminGenerationTimeseriesRowSchema = z.object({
  bucket_start: TimestampSchema,
  cost_currency: CurrencySchema.nullable(),
  call_count: NonnegativeIntegerStringSchema,
  success_count: NonnegativeIntegerStringSchema,
  error_count: NonnegativeIntegerStringSchema,
  fallback_call_count: NonnegativeIntegerStringSchema,
  input_token_count: NonnegativeDecimalStringSchema,
  output_token_count: NonnegativeDecimalStringSchema,
  total_token_count: NonnegativeDecimalStringSchema,
  actual_cost_amount: NonnegativeDecimalStringSchema,
  estimated_cost_amount: NonnegativeDecimalStringSchema,
  unavailable_cost_count: NonnegativeIntegerStringSchema,
  p50_elapsed_ms: NonnegativeDecimalStringSchema.nullable(),
  p95_elapsed_ms: NonnegativeDecimalStringSchema.nullable(),
}).strict()

export const AdminGenerationTimeseriesSchema = z.array(AdminGenerationTimeseriesRowSchema)

export const AdminModelPerformanceRowSchema = z.object({
  provider_id: z.string().trim().min(1).max(80),
  model_id: z.string().trim().min(1).max(200),
  cost_currency: CurrencySchema.nullable(),
  call_count: NonnegativeIntegerStringSchema,
  success_count: NonnegativeIntegerStringSchema,
  success_rate: NonnegativeDecimalStringSchema,
  fallback_call_count: NonnegativeIntegerStringSchema,
  fallback_rate: NonnegativeDecimalStringSchema,
  p50_elapsed_ms: NonnegativeDecimalStringSchema.nullable(),
  p95_elapsed_ms: NonnegativeDecimalStringSchema.nullable(),
  input_token_count: NonnegativeDecimalStringSchema,
  output_token_count: NonnegativeDecimalStringSchema,
  total_token_count: NonnegativeDecimalStringSchema,
  actual_cost_amount: NonnegativeDecimalStringSchema,
  estimated_cost_amount: NonnegativeDecimalStringSchema,
  unavailable_cost_count: NonnegativeIntegerStringSchema,
  average_cost_per_success: NonnegativeDecimalStringSchema.nullable(),
}).strict()

export const AdminModelPerformanceSchema = z.array(AdminModelPerformanceRowSchema)

export const AdminGenerationProviderCallRowSchema = z.object({
  id: z.string().uuid(),
  provider_call_id: z.string().trim().min(1).max(200),
  started_at: TimestampSchema,
  ended_at: TimestampSchema,
  elapsed_ms: NonnegativeIntegerStringSchema,
  user_id: z.string().uuid(),
  masked_user_email: z.string().nullable(),
  story_id: z.string().trim().min(1).max(200),
  story_title: z.string().nullable(),
  chapter_number: z.number().int().min(1).max(50).nullable(),
  generation_kind: GenerationKindSchema.nullable(),
  job_id: z.string().uuid().nullable(),
  correlation_id: z.string().uuid(),
  attempt_number: z.number().int().min(1).max(20).nullable(),
  use_case: z.string().trim().min(1).max(100),
  workflow_phase: z.string().trim().min(1).max(100),
  provider_id: z.string().trim().min(1).max(80),
  model_id: z.string().trim().min(1).max(200),
  route_version: z.string().trim().min(1).max(100).nullable(),
  fallback_index: z.number().int().min(0).max(32),
  actual_model_resolved: z.boolean(),
  outcome: ProviderCallOutcomeSchema,
  error_code: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(),
  input_token_count: NonnegativeIntegerStringSchema.nullable(),
  output_token_count: NonnegativeIntegerStringSchema.nullable(),
  total_token_count: NonnegativeIntegerStringSchema.nullable(),
  cost_amount: NonnegativeDecimalStringSchema.nullable(),
  cost_currency: CurrencySchema.nullable(),
  cost_source: ProviderCallCostSourceSchema,
  pricing_version_id: z.string().uuid().nullable(),
}).strict()

export const AdminGenerationProviderCallPageSchema = z.array(AdminGenerationProviderCallRowSchema)

export const AdminGenerationJobDetailRowSchema = z.object({
  row_kind: z.enum(['JOB', 'ATTEMPT', 'CALL']),
  sequence_number: NonnegativeIntegerStringSchema,
  job_id: z.string().uuid(),
  job_status: GenerationJobStatusSchema,
  user_id: z.string().uuid(),
  masked_user_email: z.string().nullable(),
  story_id: z.string().trim().min(1).max(200),
  story_title: z.string().nullable(),
  chapter_number: z.number().int().min(1).max(50),
  generation_kind: GenerationKindSchema,
  correlation_id: z.string().uuid(),
  job_attempt_count: z.number().int().min(0).max(20),
  max_attempts: z.number().int().min(1).max(20),
  available_at: TimestampSchema,
  deadline_at: TimestampSchema,
  claimed_at: TimestampSchema.nullable(),
  heartbeat_at: TimestampSchema.nullable(),
  worker_id: z.string().trim().min(1).max(200).nullable(),
  job_error_code: z.string().trim().min(1).max(200).nullable(),
  job_created_at: TimestampSchema,
  job_updated_at: TimestampSchema,
  completed_at: TimestampSchema.nullable(),
  attempt_id: z.string().uuid().nullable(),
  attempt_number: z.number().int().min(1).max(20).nullable(),
  workflow_phase: z.string().trim().min(1).max(100).nullable(),
  provider_id: z.string().trim().min(1).max(200).nullable(),
  model_id: z.string().trim().min(1).max(200).nullable(),
  started_at: TimestampSchema.nullable(),
  ended_at: TimestampSchema.nullable(),
  elapsed_ms: NonnegativeIntegerStringSchema.nullable(),
  lease_age_ms: NonnegativeIntegerStringSchema.nullable(),
  lease_remaining_ms: NonnegativeIntegerStringSchema.nullable(),
  retry_decision: z.string().trim().min(1).max(200).nullable(),
  error_code: z.string().trim().min(1).max(200).nullable(),
  provider_call_row_id: z.string().uuid().nullable(),
  provider_call_id: z.string().trim().min(1).max(200).nullable(),
  use_case: z.string().trim().min(1).max(100).nullable(),
  fallback_index: z.number().int().min(0).max(32).nullable(),
  actual_model_resolved: z.boolean().nullable(),
  outcome: ProviderCallOutcomeSchema.nullable(),
  input_token_count: NonnegativeIntegerStringSchema.nullable(),
  output_token_count: NonnegativeIntegerStringSchema.nullable(),
  total_token_count: NonnegativeIntegerStringSchema.nullable(),
  cost_amount: NonnegativeDecimalStringSchema.nullable(),
  cost_currency: CurrencySchema.nullable(),
  cost_source: ProviderCallCostSourceSchema.nullable(),
}).strict()

export const AdminGenerationJobDetailSchema = z.array(AdminGenerationJobDetailRowSchema)

export const AdminGenerationDataQualityRowSchema = z.object({
  metric_name: z.enum([
    'missing_usage',
    'unavailable_pricing',
    'unresolved_actual_model',
    'calls_lacking_durable_correlation',
    'terminal_job_shape_failures',
    'detail_approaching_retention_cutoff',
  ]),
  issue_count: NonnegativeIntegerStringSchema,
  oldest_issue_at: TimestampSchema.nullable(),
  newest_issue_at: TimestampSchema.nullable(),
}).strict()

export const AdminGenerationDataQualitySchema = z.array(AdminGenerationDataQualityRowSchema)

export type AdminGenerationOverviewRow = z.infer<typeof AdminGenerationOverviewRowSchema>
export type AdminGenerationTimeseriesRow = z.infer<typeof AdminGenerationTimeseriesRowSchema>
export type AdminModelPerformanceRow = z.infer<typeof AdminModelPerformanceRowSchema>
export type AdminGenerationProviderCall = z.infer<typeof AdminGenerationProviderCallRowSchema>
export type AdminGenerationJobDetailRow = z.infer<typeof AdminGenerationJobDetailRowSchema>
export type AdminGenerationDataQualityRow = z.infer<typeof AdminGenerationDataQualityRowSchema>
