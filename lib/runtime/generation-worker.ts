/**
 * Durable generation-job worker executor.
 *
 * Two entry points (plan v4):
 * - claimAndRunGenerationJobById: after() path — claims exact job just enqueued
 * - runAlreadyClaimedGenerationJob: recovery path — job already claimed via global pop
 *
 * Never finish(SUCCEEDED). Success is only via fenced publish RPC.
 * Heartbeat ownership loss aborts provider calls via AbortSignal; no publish/finish.
 */
import 'server-only'
import {
  acquireGenerationJobLease,
  claimGenerationJob,
  claimGenerationJobById,
  finishGenerationJobAttempt,
  heartbeatGenerationJob,
  type ClaimedGenerationJob,
} from '@/lib/runtime/generation-jobs'
import {
  claimedJobToPartialContext,
  choiceRetryBackoffSeconds,
  normalizeGenerationDispatchResult,
  type GenerationJobExecutionContext,
  type GenerationWorkerOptions,
} from '@/lib/runtime/generation-job-execution'
import { resolveGenerationLeaseTtlSeconds } from '@/lib/runtime/generation-lease-ttl'
import { runChapterGenerationAttempt } from '@/lib/runtime/generation-mode'
import { safeErrorInfo } from '@/lib/observability/safe-error'

// Re-export ClaimedGenerationJob type for callers (recovery route).
export type { ClaimedGenerationJob }

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000

function workerIdFor(prefix: string): string {
  return `${prefix}:${process.pid}:${Date.now().toString(36)}`.slice(0, 200)
}

export type WorkerRunResult =
  | { ok: true; outcome: 'SUCCEEDED' | 'ALREADY_DONE'; jobId: string }
  | {
      ok: false
      outcome:
        | 'NOT_CLAIMED'
        | 'LEASE_FAILED'
        | 'OWNERSHIP_LOST'
        | 'RETRY_WAIT'
        | 'FAILED'
        | 'EXCEPTION'
      jobId?: string
      reason?: string
    }

/**
 * Request-path entry: claim the exact job just enqueued, then execute.
 */
export async function claimAndRunGenerationJobById(
  args: {
    jobId: string
    workerId?: string
  },
  options?: GenerationWorkerOptions,
): Promise<WorkerRunResult> {
  const workerId = args.workerId ?? workerIdFor('after')
  const claim = await claimGenerationJobById({ jobId: args.jobId, workerId })
  if (!claim.claimed || !('job' in claim) || !claim.job) {
    console.log('GENERATION_WORKER_NOT_CLAIMED', {
      jobId: args.jobId,
      workerId,
      path: 'by_id',
    })
    return { ok: false, outcome: 'NOT_CLAIMED', jobId: args.jobId }
  }
  return executeClaimedJob(claim.job, options)
}

/**
 * Recovery-path entry: job already claimed (global pop). Do NOT re-claim.
 */
export async function runAlreadyClaimedGenerationJob(
  job: ClaimedGenerationJob,
  options?: GenerationWorkerOptions,
): Promise<WorkerRunResult> {
  return executeClaimedJob(job, options)
}

/**
 * Recovery tick: global pop up to maxJobs, run each already-claimed job.
 * Used by /api/generation/recover. Safe under concurrent ticks (skip locked).
 */
export async function claimAndRunAvailableJobs(
  args: {
    maxJobs: number
    workerIdPrefix?: string
  },
  options?: GenerationWorkerOptions,
): Promise<{ ran: number; results: WorkerRunResult[] }> {
  const max = Math.min(Math.max(1, args.maxJobs), 20)
  const results: WorkerRunResult[] = []
  for (let i = 0; i < max; i++) {
    const workerId = workerIdFor(args.workerIdPrefix ?? 'recover')
    const claim = await claimGenerationJob({ workerId })
    if (!claim.claimed || !('job' in claim) || !claim.job) break
    results.push(await runAlreadyClaimedGenerationJob(claim.job, options))
  }
  return { ran: results.length, results }
}

/**
 * Core executor with explicit ownership/abort acceptance criteria (plan v4).
 */
export async function executeClaimedJob(
  job: ClaimedGenerationJob,
  options?: GenerationWorkerOptions,
): Promise<WorkerRunResult> {
  const startedAt = new Date()
  const ttlSeconds = await resolveGenerationLeaseTtlSeconds()

  // 1) Acquire bound lease.
  const lease = await acquireGenerationJobLease({
    jobId: job.id,
    workerId: job.workerId,
    claimToken: job.claimToken,
    ttlSeconds,
  })
  if (!lease.ok) {
    console.log('GENERATION_WORKER_LEASE_FAILED', {
      jobId: job.id,
      workerId: job.workerId,
      reason: lease.reason,
    })
    return {
      ok: false,
      outcome: lease.reason === 'OWNERSHIP_LOST' ? 'OWNERSHIP_LOST' : 'LEASE_FAILED',
      jobId: job.id,
      reason: lease.reason,
    }
  }
  const leaseId = lease.leaseId

  // 2) AbortController + first heartbeat BEFORE any provider call.
  const controller = new AbortController()
  let ownershipLost = false
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const markOwnershipLost = (source: string) => {
    if (ownershipLost) return
    ownershipLost = true
    console.log('GENERATION_WORKER_OWNERSHIP_LOST', {
      jobId: job.id,
      workerId: job.workerId,
      source,
    })
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }

  const doHeartbeat = async (source: string): Promise<boolean> => {
    try {
      const hb = await heartbeatGenerationJob({
        jobId: job.id,
        workerId: job.workerId,
        claimToken: job.claimToken,
        leaseId,
        ttlSeconds,
      })
      if (!hb.ok) {
        markOwnershipLost(source)
        return false
      }
      return true
    } catch (err) {
      const info = safeErrorInfo(err)
      console.log('GENERATION_WORKER_HEARTBEAT_EXCEPTION', {
        jobId: job.id,
        source,
        errorName: info.errorName,
      })
      markOwnershipLost(source)
      return false
    }
  }

  try {
    const firstOk = await doHeartbeat('first')
    if (!firstOk) {
      // Provider never called. Do not finish — another worker may own the job.
      return { ok: false, outcome: 'OWNERSHIP_LOST', jobId: job.id }
    }

    // 3) Start periodic heartbeat.
    heartbeatTimer = setInterval(() => {
      void doHeartbeat('interval')
    }, DEFAULT_HEARTBEAT_INTERVAL_MS)

    // 4) Build execution context + run generator.
    let jobContext: GenerationJobExecutionContext
    try {
      jobContext = claimedJobToPartialContext(job, leaseId, controller.signal)
    } catch (err) {
      if (err instanceof Error && err.name === 'GenerationDeadlineError') {
        const finish = await finishGenerationJobAttempt({
          jobId: job.id,
          workerId: job.workerId,
          claimToken: job.claimToken,
          outcome: 'FAILED',
          availableAt: null,
          errorCode: 'GENERATION_JOB_DEADLINE_INVALID',
          errorClass: 'TERMINAL',
          workflowPhase: 'CONTEXT',
          providerId: null,
          modelId: null,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt.getTime(),
          leaseAgeMs: null,
          leaseRemainingMs: null,
          retryDecision: 'FAILED',
        })
        return finish.ok
          ? { ok: false, outcome: 'FAILED', jobId: job.id, reason: 'GENERATION_JOB_DEADLINE_INVALID' }
          : { ok: false, outcome: 'OWNERSHIP_LOST', jobId: job.id }
      }
      throw err
    }

    let dispatchResult: Awaited<ReturnType<typeof runChapterGenerationAttempt>>
    try {
      dispatchResult = await runChapterGenerationAttempt({
        storyId: job.storyId,
        userId: job.userId,
        chapterNumber: job.chapterNumber,
        correlationId: job.correlationId,
        attemptId: job.id,
        triggerChoiceId: job.triggerChoiceId,
        jobContext,
        ...(options === undefined ? {} : { options }),
      })
    } catch (err) {
      if (ownershipLost || controller.signal.aborted) {
        return { ok: false, outcome: 'OWNERSHIP_LOST', jobId: job.id }
      }
      const info = safeErrorInfo(err)
      console.error('GENERATION_WORKER_GENERATOR_EXCEPTION', {
        jobId: job.id,
        errorName: info.errorName,
        errorMessage: info.errorMessage,
      })
      // Fall through to finish FAILED below via synthetic result.
      dispatchResult = {
        ok: false,
        reason: 'GENERATOR_EXCEPTION',
      }
    }

    // 6) Normalize before checking ownership. normalized.ok is the generator
    // contract that fenced publish committed success; a heartbeat can lose ownership
    // while post-publish reconciliation is still completing.
    const normalized = normalizeGenerationDispatchResult(dispatchResult)
    if (normalized.ok) {
      // Success path: fenced publish already marked job SUCCEEDED. Never finish it,
      // even if a later heartbeat observed ownership loss during reconciliation.
      console.log('GENERATION_WORKER_SUCCEEDED', {
        jobId: job.id,
        chapterNumber: normalized.chapterNumber,
        fromCheckpoint: normalized.fromCheckpoint ?? false,
      })
      return { ok: true, outcome: 'SUCCEEDED', jobId: job.id }
    }

    // Failure or unfinished work must not publish/finish after ownership loss.
    if (ownershipLost || controller.signal.aborted) {
      return { ok: false, outcome: 'OWNERSHIP_LOST', jobId: job.id }
    }

    // Publication ownership outcomes mean this claimant must stop without finish.
    // A retry transition would mutate job now owned by another worker.
    if (normalized.reason === 'LEASE_HELD') {
      console.log('GENERATION_WORKER_PUBLICATION_OWNERSHIP_LOST', { jobId: job.id })
      return {
        ok: false,
        outcome: 'OWNERSHIP_LOST',
        jobId: job.id,
        reason: normalized.reason,
      }
    }

    // CHAPTER_EXISTS / already done — treat as success-ish (no finish needed if
    // chapter row exists; finish FAILED would be wrong). Leave job for recovery
    // or operator if still RUNNING; try finish FAILED only for real failures.
    if (normalized.reason === 'CHAPTER_EXISTS') {
      // Best-effort: nothing to publish; job may still be RUNNING. Recovery will
      // eventually mark it. Prefer not to invent SUCCEEDED without publication.
      console.log('GENERATION_WORKER_CHAPTER_EXISTS', { jobId: job.id })
      return { ok: true, outcome: 'ALREADY_DONE', jobId: job.id }
    }

    const endedAt = new Date()
    const jobDeadlineAtMs = Date.parse(job.deadlineAt)
    const backoffSec = choiceRetryBackoffSeconds(job.attemptCount)
    const availableAtMs = Date.now() + backoffSec * 1000
    const minimumRetryWindowMs = 46_000
    const retryFitsDeadline = Number.isFinite(jobDeadlineAtMs)
      && availableAtMs + minimumRetryWindowMs < jobDeadlineAtMs
    if (normalized.retryable && retryFitsDeadline) {
      const availableAt = new Date(availableAtMs).toISOString()
      const finish = await finishGenerationJobAttempt({
        jobId: job.id,
        workerId: job.workerId,
        claimToken: job.claimToken,
        outcome: 'RETRY_WAIT',
        availableAt,
        errorCode: normalized.reason.slice(0, 200),
        errorClass: 'RETRYABLE',
        workflowPhase: normalized.stage.slice(0, 100),
        providerId: null,
        modelId: null,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        elapsedMs: endedAt.getTime() - startedAt.getTime(),
        leaseAgeMs: null,
        leaseRemainingMs: null,
        retryDecision: 'RETRY_BACKOFF',
      })
      if (!finish.ok) {
        return { ok: false, outcome: 'OWNERSHIP_LOST', jobId: job.id, reason: finish.reason }
      }
      console.log('GENERATION_WORKER_RETRY_WAIT', {
        jobId: job.id,
        reason: normalized.reason,
        availableAt,
        status: finish.status,
      })
      return {
        ok: false,
        outcome: 'RETRY_WAIT',
        jobId: job.id,
        reason: normalized.reason,
      }
    }

    const finish = await finishGenerationJobAttempt({
      jobId: job.id,
      workerId: job.workerId,
      claimToken: job.claimToken,
      outcome: 'FAILED',
      availableAt: null,
      errorCode: normalized.reason.slice(0, 200),
      errorClass: 'TERMINAL',
      workflowPhase: normalized.stage.slice(0, 100),
      providerId: null,
      modelId: null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      elapsedMs: endedAt.getTime() - startedAt.getTime(),
      leaseAgeMs: null,
      leaseRemainingMs: null,
      retryDecision: 'FAILED',
    })
    if (!finish.ok) {
      return { ok: false, outcome: 'OWNERSHIP_LOST', jobId: job.id, reason: finish.reason }
    }
    console.log('GENERATION_WORKER_FAILED', {
      jobId: job.id,
      reason: normalized.reason,
      status: finish.status,
    })
    return { ok: false, outcome: 'FAILED', jobId: job.id, reason: normalized.reason }
  } catch (err) {
    const info = safeErrorInfo(err)
    console.error('GENERATION_WORKER_EXCEPTION', {
      jobId: job.id,
      errorName: info.errorName,
      errorMessage: info.errorMessage,
    })
    return { ok: false, outcome: 'EXCEPTION', jobId: job.id, reason: info.errorName }
  } finally {
    // 5) clearInterval ALWAYS.
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}
