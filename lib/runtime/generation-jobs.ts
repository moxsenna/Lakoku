import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@lakoku/db'
import {
  FencedPublicationIdentitySchema,
  GenerationJobClaimResultSchema,
  GenerationJobFinishOutcomeSchema,
  GenerationJobHeartbeatResultSchema,
  GenerationJobLeaseResultSchema,
  GenerationJobRecoveryResultSchema,
  type GenerationJobClaimResult,
  type GenerationJobHeartbeatResult,
  type GenerationJobLeaseResult,
  type GenerationJobRecoveryResult,
} from './generation-jobs.contract'

export type GenerationJobErrorCode =
  | 'AUTH_REQUIRED'
  | 'STORY_NOT_FOUND'
  | 'GENERATION_JOB_CONFLICT'
  | 'GENERATION_JOB_OWNERSHIP_LOST'
  | 'LEASE_HELD'
  | 'GENERATION_DEADLINE_EXCEEDED'
  | 'GENERATION_RETRY_EXHAUSTED'
  | 'GENERATION_PUBLICATION_CONFLICT'
  | 'INVALID_GENERATION_JOB_TRANSITION'
  | 'INTERNAL_ERROR'

export class GenerationJobError extends Error {
  constructor(public readonly code: GenerationJobErrorCode) {
    super(code)
    this.name = 'GenerationJobError'
  }
}

const WorkerIdSchema = z.string().min(1).max(200)
  .refine((value) => value === value.trim())
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value))
const BoundedTextSchema = z.string().min(1).max(200)
  .refine((value) => value === value.trim())
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value))
const StoryIdSchema = BoundedTextSchema
const ChapterNumberSchema = z.number().int().min(1).max(50)
const UuidSchema = z.string().uuid()
const TimestampSchema = z.iso.datetime({ offset: true })
const TtlSecondsSchema = z.number().int().min(30).max(600)
const NonnegativeIntegerSchema = z.number().int().nonnegative()

const ClaimInputSchema = z.object({ workerId: WorkerIdSchema }).strict()
const LeaseInputSchema = z.object({
  jobId: UuidSchema,
  workerId: WorkerIdSchema,
  claimToken: UuidSchema,
  ttlSeconds: TtlSecondsSchema,
}).strict()
const HeartbeatInputSchema = LeaseInputSchema.extend({ leaseId: UuidSchema }).strict()
const FinishInputSchema = z.object({
  jobId: UuidSchema,
  workerId: WorkerIdSchema,
  claimToken: UuidSchema,
  outcome: GenerationJobFinishOutcomeSchema,
  availableAt: TimestampSchema.nullable(),
  errorCode: BoundedTextSchema.nullable(),
  errorClass: BoundedTextSchema.nullable(),
  workflowPhase: z.string().trim().min(1).max(100),
  providerId: BoundedTextSchema.nullable(),
  modelId: BoundedTextSchema.nullable(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  elapsedMs: NonnegativeIntegerSchema.nullable(),
  leaseAgeMs: NonnegativeIntegerSchema.nullable(),
  leaseRemainingMs: NonnegativeIntegerSchema.nullable(),
  retryDecision: BoundedTextSchema.nullable(),
}).strict().superRefine((input, context) => {
  if (input.outcome === 'RETRY_WAIT' && input.availableAt === null) {
    context.addIssue({
      code: 'custom',
      message: 'availableAt is required for RETRY_WAIT',
      path: ['availableAt'],
    })
  }
  if (input.endedAt !== null && Date.parse(input.endedAt) < Date.parse(input.startedAt)) {
    context.addIssue({
      code: 'custom',
      message: 'endedAt must not precede startedAt',
      path: ['endedAt'],
    })
  }
})
const CancelInputSchema = z.object({
  jobId: UuidSchema,
  reason: BoundedTextSchema,
}).strict()
const RecoverInputSchema = z.object({
  batchSize: z.number().int().min(1).max(100),
}).strict()

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]))
const PublicationInputSchema = FencedPublicationIdentitySchema.extend({
  storyId: StoryIdSchema,
  chapterNumber: ChapterNumberSchema,
  title: z.string().trim().min(1),
  paragraphs: z.array(z.string()),
  choicePrompt: z.string().nullable(),
  choices: z.array(JsonValueSchema).nullable(),
  outcomes: z.array(JsonValueSchema),
}).strict()

const RawClaimResultSchema = z.object({
  claimed: z.boolean(),
  job: z.object({
    id: UuidSchema,
    story_id: StoryIdSchema,
    chapter_number: ChapterNumberSchema,
    user_id: UuidSchema,
    generation_kind: z.enum(['standard', 'personalized']),
    trigger_choice_id: BoundedTextSchema.nullable(),
    attempt_count: z.number().int().min(1).max(20),
    max_attempts: z.number().int().min(1).max(20),
    deadline_at: TimestampSchema,
    correlation_id: UuidSchema,
    worker_id: WorkerIdSchema,
    claim_token: UuidSchema,
  }).passthrough().optional(),
}).passthrough()
const RawLeaseResultSchema = z.object({
  ok: z.boolean(),
  lease_id: UuidSchema.optional(),
  reason: z.enum(['LEASE_HELD', 'OWNERSHIP_LOST']).optional(),
}).passthrough()
const RawHeartbeatResultSchema = z.object({
  ok: z.boolean(),
  reason: z.literal('OWNERSHIP_LOST').optional(),
}).passthrough()
const RawFinishResultSchema = z.object({
  ok: z.boolean(),
  status: GenerationJobFinishOutcomeSchema.optional(),
  reason: z.literal('OWNERSHIP_LOST').optional(),
}).passthrough()
const RawCancelResultSchema = z.object({
  ok: z.boolean(),
  status: z.literal('CANCELLED').optional(),
  reason: z.enum(['NOT_FOUND', 'NOT_CANCELLABLE']).optional(),
}).passthrough()
const RawRecoveryResultSchema = z.object({
  recovered_count: z.number().int().nonnegative(),
}).passthrough()
const RawPublicationResultSchema = z.object({
  ok: z.literal(true),
  chapter_number: ChapterNumberSchema,
  seq: z.number().int().nonnegative(),
  jobId: UuidSchema,
}).passthrough()

const FinishResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: GenerationJobFinishOutcomeSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.literal('OWNERSHIP_LOST'),
  }).strict(),
])
const CancelResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.literal('CANCELLED') }).strict(),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['NOT_FOUND', 'NOT_CANCELLABLE']),
  }).strict(),
])
const PublicationResultSchema = z.object({
  ok: z.literal(true),
  chapterNumber: ChapterNumberSchema,
  seq: z.number().int().nonnegative(),
  jobId: UuidSchema,
}).strict()

export type FinishGenerationJobAttemptResult = z.infer<typeof FinishResultSchema>
export type CancelGenerationJobResult = z.infer<typeof CancelResultSchema>
export type PublishGenerationJobChapterResult = z.infer<typeof PublicationResultSchema>
export type ClaimGenerationJobInput = z.input<typeof ClaimInputSchema>
export type AcquireGenerationJobLeaseInput = z.input<typeof LeaseInputSchema>
export type HeartbeatGenerationJobInput = z.input<typeof HeartbeatInputSchema>
export type FinishGenerationJobAttemptInput = z.input<typeof FinishInputSchema>
export type CancelGenerationJobInput = z.input<typeof CancelInputSchema>
export type RecoverStaleGenerationJobsInput = z.input<typeof RecoverInputSchema>
export type PublishGenerationJobChapterInput = z.input<typeof PublicationInputSchema>

type RpcError = { message?: unknown; code?: unknown }

const ERROR_TOKEN_MAP: ReadonlyArray<readonly [string, GenerationJobErrorCode]> = [
  ['INVALID_GENERATION_JOB_TRANSITION', 'INVALID_GENERATION_JOB_TRANSITION'],
  ['GENERATION_PUBLICATION_CONFLICT', 'GENERATION_PUBLICATION_CONFLICT'],
  ['GENERATION_JOB_DEADLINE_EXCEEDED', 'GENERATION_DEADLINE_EXCEEDED'],
  ['GENERATION_DEADLINE_EXCEEDED', 'GENERATION_DEADLINE_EXCEEDED'],
  ['GENERATION_RETRY_EXHAUSTED', 'GENERATION_RETRY_EXHAUSTED'],
  ['GENERATION_JOB_OWNERSHIP_LOST', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_LEASE_INVALID', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_TARGET_MISMATCH', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_NOT_RUNNING', 'GENERATION_JOB_OWNERSHIP_LOST'],
  ['GENERATION_JOB_TERMINAL', 'INVALID_GENERATION_JOB_TRANSITION'],
  ['GENERATION_JOB_NOT_FOUND', 'STORY_NOT_FOUND'],
  ['GENERATION_JOB_CONFLICT', 'GENERATION_JOB_CONFLICT'],
  ['STORY_NOT_FOUND', 'STORY_NOT_FOUND'],
  ['AUTH_REQUIRED', 'AUTH_REQUIRED'],
  ['LEASE_HELD', 'LEASE_HELD'],
]

function mapRpcError(error: RpcError): GenerationJobError {
  const message = typeof error.message === 'string' ? error.message : ''
  const mapped = ERROR_TOKEN_MAP.find(([token]) => message.includes(token))?.[1]
  return new GenerationJobError(mapped ?? 'INTERNAL_ERROR')
}

async function callRpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const client = createAdminClient()
  const { data, error } = await client.rpc(name, payload)
  if (error) throw mapRpcError(error)
  return data
}

export async function claimGenerationJob(input: ClaimGenerationJobInput): Promise<GenerationJobClaimResult> {
  const parsed = ClaimInputSchema.parse(input)
  const raw = RawClaimResultSchema.parse(await callRpc('claim_generation_job_v1', {
    p_worker_id: parsed.workerId,
  }))
  if (!raw.claimed) return GenerationJobClaimResultSchema.parse({ claimed: false })
  if (!raw.job) return GenerationJobClaimResultSchema.parse({ claimed: true })
  return GenerationJobClaimResultSchema.parse({
    claimed: true,
    job: {
      id: raw.job.id,
      storyId: raw.job.story_id,
      chapterNumber: raw.job.chapter_number,
      userId: raw.job.user_id,
      generationKind: raw.job.generation_kind,
      triggerChoiceId: raw.job.trigger_choice_id,
      attemptCount: raw.job.attempt_count,
      maxAttempts: raw.job.max_attempts,
      deadlineAt: raw.job.deadline_at,
      correlationId: raw.job.correlation_id,
      workerId: raw.job.worker_id,
      claimToken: raw.job.claim_token,
    },
  })
}

export async function acquireGenerationJobLease(
  input: AcquireGenerationJobLeaseInput,
): Promise<GenerationJobLeaseResult> {
  const parsed = LeaseInputSchema.parse(input)
  const raw = RawLeaseResultSchema.parse(await callRpc('acquire_generation_job_lease_v1', {
    p_job_id: parsed.jobId,
    p_worker_id: parsed.workerId,
    p_claim_token: parsed.claimToken,
    p_ttl_seconds: parsed.ttlSeconds,
  }))
  return GenerationJobLeaseResultSchema.parse(raw.ok
    ? { ok: true, leaseId: raw.lease_id }
    : { ok: false, reason: raw.reason })
}

export async function heartbeatGenerationJob(
  input: HeartbeatGenerationJobInput,
): Promise<GenerationJobHeartbeatResult> {
  const parsed = HeartbeatInputSchema.parse(input)
  const raw = RawHeartbeatResultSchema.parse(await callRpc('heartbeat_generation_job_v1', {
    p_job_id: parsed.jobId,
    p_worker_id: parsed.workerId,
    p_claim_token: parsed.claimToken,
    p_lease_id: parsed.leaseId,
    p_ttl_seconds: parsed.ttlSeconds,
  }))
  return GenerationJobHeartbeatResultSchema.parse(raw.ok
    ? { ok: true }
    : { ok: false, reason: raw.reason })
}

export async function finishGenerationJobAttempt(
  input: FinishGenerationJobAttemptInput,
): Promise<FinishGenerationJobAttemptResult> {
  const parsed = FinishInputSchema.parse(input)
  const raw = RawFinishResultSchema.parse(await callRpc('finish_generation_job_attempt_v1', {
    p_job_id: parsed.jobId,
    p_worker_id: parsed.workerId,
    p_claim_token: parsed.claimToken,
    p_outcome: parsed.outcome,
    p_available_at: parsed.availableAt,
    p_error_code: parsed.errorCode,
    p_error_class: parsed.errorClass,
    p_workflow_phase: parsed.workflowPhase,
    p_provider_id: parsed.providerId,
    p_model_id: parsed.modelId,
    p_started_at: parsed.startedAt,
    p_ended_at: parsed.endedAt,
    p_elapsed_ms: parsed.elapsedMs,
    p_lease_age_ms: parsed.leaseAgeMs,
    p_lease_remaining_ms: parsed.leaseRemainingMs,
    p_retry_decision: parsed.retryDecision,
  }))
  return FinishResultSchema.parse(raw.ok
    ? { ok: true, status: raw.status }
    : { ok: false, reason: raw.reason })
}

export async function cancelGenerationJob(
  input: CancelGenerationJobInput,
): Promise<CancelGenerationJobResult> {
  const parsed = CancelInputSchema.parse(input)
  const raw = RawCancelResultSchema.parse(await callRpc('cancel_generation_job_v1', {
    p_job_id: parsed.jobId,
    p_reason: parsed.reason,
  }))
  return CancelResultSchema.parse(raw.ok
    ? { ok: true, status: raw.status }
    : { ok: false, reason: raw.reason })
}

export async function recoverStaleGenerationJobs(
  input: RecoverStaleGenerationJobsInput,
): Promise<GenerationJobRecoveryResult> {
  const parsed = RecoverInputSchema.parse(input)
  const raw = RawRecoveryResultSchema.parse(await callRpc('recover_stale_generation_jobs_v1', {
    p_batch_size: parsed.batchSize,
  }))
  return GenerationJobRecoveryResultSchema.parse({ recoveredCount: raw.recovered_count })
}

async function publishGenerationJobChapter(
  rpcName: 'publish_generation_job_chapter_v1' | 'publish_generation_job_chapter_v2',
  input: PublishGenerationJobChapterInput,
): Promise<PublishGenerationJobChapterResult> {
  const parsed = PublicationInputSchema.parse(input)
  const raw = RawPublicationResultSchema.parse(await callRpc(rpcName, {
    p_job_id: parsed.jobId,
    p_worker_id: parsed.workerId,
    p_claim_token: parsed.claimToken,
    p_lease_id: parsed.leaseId,
    p_story_id: parsed.storyId,
    p_chapter_number: parsed.chapterNumber,
    p_title: parsed.title,
    p_paragraphs: parsed.paragraphs,
    p_choice_prompt: parsed.choicePrompt,
    p_choices: parsed.choices,
    p_outcomes: parsed.outcomes,
  }))
  return PublicationResultSchema.parse({
    ok: raw.ok,
    chapterNumber: raw.chapter_number,
    seq: raw.seq,
    jobId: raw.jobId,
  })
}

export function publishGenerationJobChapterV1(
  input: PublishGenerationJobChapterInput,
): Promise<PublishGenerationJobChapterResult> {
  return publishGenerationJobChapter('publish_generation_job_chapter_v1', input)
}

export function publishGenerationJobChapterV2(
  input: PublishGenerationJobChapterInput,
): Promise<PublishGenerationJobChapterResult> {
  return publishGenerationJobChapter('publish_generation_job_chapter_v2', input)
}
