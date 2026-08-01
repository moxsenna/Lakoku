/**
 * Durable generation-job execution identity + flag helpers.
 * Pure-ish surface (no DB). Worker + generators share this contract.
 */
import 'server-only'
import type { ClaimedGenerationJob } from './generation-jobs.contract'
import type { StoryGenerationMode } from './generation-mode'
import type { ProviderRuntime } from '@lakoku/ai-gateway'

export type GenerationWorkerOptions = Readonly<{
  providerRuntime?: ProviderRuntime
}>

/**
 * Feature flag: wraps the ENTIRE durable worker path.
 * OFF (default) → legacy after()-direct, NO generation_job enqueued, attemptId null.
 * ON → enqueue before STARTED → claim-by-id → fenced worker.
 */
export function isGenerationWorkerEnabled(): boolean {
  const raw = process.env.LAKOKU_GENERATION_WORKER?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes'
}

/**
 * Fenced execution identity for a claimed generation job.
 * Generators that receive this must:
 * - skip their own lease acquire (reuse leaseId)
 * - publish via publishGenerationJobChapterV2
 * - propagate signal into provider calls
 */
export type GenerationJobExecutionContext = {
  jobId: string
  workerId: string
  claimToken: string
  leaseId: string
  attemptNumber: number
  correlationId: string
  generationKind: 'standard' | 'personalized'
  triggerChoiceId?: string | null
  deadlineAt?: string
  deadlineAtMs?: number
  signal: AbortSignal
}

export function claimedJobToPartialContext(
  job: ClaimedGenerationJob,
  leaseId: string,
  signal: AbortSignal,
): GenerationJobExecutionContext {
  const deadlineAtMs = Date.parse(job.deadlineAt)
  if (!Number.isFinite(deadlineAtMs)) {
    throw new GenerationDeadlineError('GENERATION_JOB_DEADLINE_INVALID')
  }
  return {
    jobId: job.id,
    workerId: job.workerId,
    claimToken: job.claimToken,
    leaseId,
    attemptNumber: job.attemptCount,
    correlationId: job.correlationId,
    generationKind: job.generationKind,
    triggerChoiceId: job.triggerChoiceId,
    deadlineAt: job.deadlineAt,
    deadlineAtMs,
    signal,
  }
}

export class GenerationDeadlineError extends Error {
  readonly code: 'GENERATION_JOB_DEADLINE_INVALID'

  constructor(code: 'GENERATION_JOB_DEADLINE_INVALID') {
    super(code)
    this.name = 'GenerationDeadlineError'
    this.code = code
  }
}

export function mapModeToGenerationKind(
  mode: StoryGenerationMode,
): 'standard' | 'personalized' {
  return mode === 'personalized_ai' ? 'personalized' : 'standard'
}

/**
 * Flatten dispatcher outer/inner ok nesting.
 * Outer ok:true only means mode resolved + generator invoked — not success.
 */
export type NormalizedGenerationAttempt =
  | {
      ok: true
      mode: StoryGenerationMode
      chapterNumber: number
      seq: number
      fromCheckpoint?: boolean
    }
  | {
      ok: false
      mode?: StoryGenerationMode
      reason: string
      retryable: boolean
      stage: string
      detail?: unknown
    }

const RETRYABLE_REASONS = new Set([
  'CHOICE_GENERATION_FAILED',
  'CAPACITY_BUSY',
  'CAPACITY_TIMEOUT',
  'LEASE_HELD',
  'PROVIDER_FAILED',
  'INVALID_RESPONSE',
  'SCHEMA_REJECTED',
  'REPAIR_EXHAUSTED',
  'TIMEOUT',
  'RATE_LIMITED',
  'TRANSIENT',
])

const TERMINAL_REASONS = new Set([
  'CHAPTER_EXISTS',
  'CANON_MISSING',
  'FAILED_REVIEW_REQUIRED',
  'PROVENANCE_CONFLICT',
  'GENERATION_CONTRACT_INVALID',
  'FINAL_CHAPTER',
  'UNSAFE',
])

export function isRetryableGenerationReason(reason: string): boolean {
  if (TERMINAL_REASONS.has(reason)) return false
  if (RETRYABLE_REASONS.has(reason)) return true
  // Default: treat unknown failures as retryable so recovery can re-attempt.
  // Terminal classification should be explicit.
  return true
}

/**
 * Normalize runChapterGenerationAttempt (or raw generator) result.
 */
export function normalizeGenerationDispatchResult(
  dispatchResult:
    | { ok: true; result: unknown; mode: StoryGenerationMode }
    | { ok: false; reason: string; mode?: StoryGenerationMode },
): NormalizedGenerationAttempt {
  if (!dispatchResult.ok) {
    return {
      ok: false,
      mode: dispatchResult.mode,
      reason: dispatchResult.reason,
      retryable: isRetryableGenerationReason(dispatchResult.reason),
      stage: 'DISPATCH',
    }
  }

  const mode = dispatchResult.mode
  const inner = dispatchResult.result
  if (inner && typeof inner === 'object' && 'ok' in inner) {
    const r = inner as {
      ok: boolean
      reason?: string
      chapterNumber?: number
      seq?: number
      fromCheckpoint?: boolean
      detail?: unknown
    }
    if (
      r.ok === true &&
      typeof r.chapterNumber === 'number' &&
      Number.isFinite(r.chapterNumber) &&
      typeof r.seq === 'number' &&
      Number.isFinite(r.seq)
    ) {
      // Generator success contract: chapter publication is already durable. Worker
      // mode reaches this shape only after fenced publish committed job success.
      return {
        ok: true,
        mode,
        chapterNumber: r.chapterNumber,
        seq: r.seq,
        fromCheckpoint: r.fromCheckpoint,
      }
    }
    if (r.ok === true) {
      return {
        ok: false,
        mode,
        reason: 'GENERATOR_RESULT_INVALID',
        retryable: false,
        stage: 'NORMALIZE',
        detail: inner,
      }
    }
    const reason = typeof r.reason === 'string' ? r.reason : 'GENERATOR_FAILED'
    return {
      ok: false,
      mode,
      reason,
      retryable: isRetryableGenerationReason(reason),
      stage: 'GENERATOR',
      detail: r.detail,
    }
  }

  // Unexpected shape — treat as terminal so we do not silently SUCCEED.
  return {
    ok: false,
    mode,
    reason: 'GENERATOR_RESULT_INVALID',
    retryable: false,
    stage: 'NORMALIZE',
    detail: inner,
  }
}

/** Default backoff for RETRY_WAIT (seconds). */
export function choiceRetryBackoffSeconds(attemptNumber: number): number {
  // 30s, 60s, 120s, 240s capped at 5 min
  const base = 30 * Math.pow(2, Math.max(0, attemptNumber - 1))
  return Math.min(300, base)
}
