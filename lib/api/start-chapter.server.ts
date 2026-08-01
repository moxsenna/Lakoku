/**
 * Server-only first-chapter kickoff — shared by Server Actions and REST API.
 *
 * Flag LAKOKU_GENERATION_WORKER wraps the ENTIRE durable path:
 *   OFF (default) → legacy after()-direct, NO generation_job, attemptId null
 *   ON → resolve mode → enqueue job (committed) → STARTED with attemptId=jobId
 *        → after() claimAndRunGenerationJobById
 *
 * Mode (standard vs personalized) resolved by central dispatcher / enqueue mapping.
 */
import 'server-only'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureReaderStateStarted } from '@/lib/api/user-state'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import { publicAuthoringErrorMessage } from '@/lib/authoring/server'
import { safeErrorInfo } from '@/lib/observability/safe-error'
import {
  runChapterGenerationAttempt,
  resolveStoryGenerationMode,
} from '@/lib/runtime/generation-mode'
import {
  isGenerationWorkerEnabled,
  mapModeToGenerationKind,
} from '@/lib/runtime/generation-job-execution'
import {
  enqueueGenerationJob,
  GenerationJobError,
} from '@/lib/api/generation-job-enqueue.server'
import type { StartChapterSuccessResponse } from '../../packages/contracts/src/reader'

export const STORY_NOT_FOUND_ERROR = 'Cerita tidak ditemukan.'

export type StartChapterKickoffStatus =
  | 'STARTED'
  | 'ALREADY_RUNNING'
  | 'ALREADY_READY'

export type StartChapterSuccess = StartChapterSuccessResponse
export type StartChapterFailure = { ok: false; error: string }
export type StartChapterResult = StartChapterSuccess | StartChapterFailure

function fail(err: unknown): StartChapterFailure {
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.'
  const publicMessage = message === AUTHORING_AUTH_REQUIRED_ERROR
    ? AUTHORING_AUTH_REQUIRED_ERROR
    : message === STORY_NOT_FOUND_ERROR
      ? STORY_NOT_FOUND_ERROR
      : publicAuthoringErrorMessage(err)
  console.log('START_CHAPTER_FAILED', { publicMessage })
  return { ok: false, error: publicMessage }
}

async function chapterExists(storyId: string, chapterNumber: number): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chapters')
    .select('number')
    .eq('story_id', storyId)
    .eq('number', chapterNumber)
    .maybeSingle()
  if (error) throw new Error('INTERNAL_STATUS_CHECK_FAILED')
  return data != null
}

async function hasActiveLease(storyId: string, chapterNumber: number): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('generation_leases')
    .select('id')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .eq('status', 'ACTIVE')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('INTERNAL_STATUS_CHECK_FAILED')
  return data != null
}

/**
 * Owner-only. Idempotent: CHAPTER_EXISTS / LEASE_HELD treated as success in background.
 * chapterNumber defaults to 1 (onboarding kickoff).
 *
 * Preflight exact chapter status:
 *   ready → ALREADY_READY (no schedule)
 *   active lease → ALREADY_RUNNING (no schedule)
 *   else → schedule after() → STARTED
 */
export async function startOwnedChapterGeneration(
  storyId: string,
  chapterNumber = 1,
): Promise<StartChapterResult> {
  try {
    const user = await requireAuthoringSessionUser()

    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return { ok: false, error: 'chapterNumber wajib bilangan bulat >= 1.' }
    }

    const admin = createAdminClient()
    const { data: ownedStory, error: ownerError } = await admin
      .from('stories')
      .select('id')
      .eq('id', storyId)
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (ownerError || !ownedStory) {
      return { ok: false, error: STORY_NOT_FOUND_ERROR }
    }

    // Preflight — avoid useless after() when chapter already ready / in flight.
    if (await chapterExists(storyId, chapterNumber)) {
      await ensureReaderStateStarted(storyId, chapterNumber)
      return {
        ok: true,
        chapterNumber,
        status: 'ALREADY_READY',
        attemptId: null,
        correlationId: crypto.randomUUID(),
      }
    }
    if (await hasActiveLease(storyId, chapterNumber)) {
      await ensureReaderStateStarted(storyId, chapterNumber)
      return {
        ok: true,
        chapterNumber,
        status: 'ALREADY_RUNNING',
        attemptId: null,
        correlationId: crypto.randomUUID(),
      }
    }

    const workerEnabled = isGenerationWorkerEnabled()

    if (!workerEnabled) {
      // ---- LEGACY PATH (flag OFF): no generation_job, attemptId null ----
      const correlationId = crypto.randomUUID()
      after(async () => {
        const startedAt = Date.now()
        try {
          const dispatched = await runChapterGenerationAttempt({
            storyId,
            userId: user.id,
            chapterNumber,
            correlationId,
            attemptId: null,
          })
          if (!dispatched.ok) {
            console.log('START_CHAPTER_BACKGROUND_FAILED', {
              storyId,
              chapterNumber,
              correlationId,
              reason: dispatched.reason,
              path: 'legacy',
              elapsedMs: Date.now() - startedAt,
            })
            return
          }
          const result = dispatched.result as {
            ok: boolean
            reason?: string
          }
          if (!result.ok && result.reason !== 'CHAPTER_EXISTS' && result.reason !== 'LEASE_HELD') {
            console.log('START_CHAPTER_BACKGROUND_FAILED', {
              storyId,
              chapterNumber,
              correlationId,
              mode: dispatched.mode,
              reason: result.reason,
              path: 'legacy',
              elapsedMs: Date.now() - startedAt,
            })
          }
        } catch (err) {
          const info = safeErrorInfo(err)
          console.error('START_CHAPTER_BACKGROUND_EXCEPTION', {
            storyId,
            chapterNumber,
            correlationId,
            stage: 'AFTER_CALLBACK',
            path: 'legacy',
            errorName: info.errorName,
            errorMessage: info.errorMessage,
            errorStack: info.errorStack,
            elapsedMs: Date.now() - startedAt,
          })
        }
      })

      await ensureReaderStateStarted(storyId, chapterNumber)
      return {
        ok: true,
        chapterNumber,
        status: 'STARTED',
        attemptId: null,
        correlationId,
      }
    }

    // ---- WORKER PATH (flag ON): enqueue before STARTED ----
    const modeResolved = await resolveStoryGenerationMode(storyId)
    if (!modeResolved.ok) {
      return {
        ok: false,
        error: publicAuthoringErrorMessage(new Error(modeResolved.error)),
      }
    }
    const generationKind = mapModeToGenerationKind(modeResolved.mode)

    let enqueued: Awaited<ReturnType<typeof enqueueGenerationJob>>
    try {
      enqueued = await enqueueGenerationJob({
        storyId,
        chapterNumber,
        generationKind,
        triggerChoiceId: null,
      })
    } catch (err) {
      if (err instanceof GenerationJobError) {
        if (err.code === 'GENERATION_JOB_CONFLICT' || err.code === 'LEASE_HELD') {
          await ensureReaderStateStarted(storyId, chapterNumber)
          return {
            ok: true,
            chapterNumber,
            status: 'ALREADY_RUNNING',
            attemptId: null,
            correlationId: crypto.randomUUID(),
          }
        }
        if (err.code === 'STORY_NOT_FOUND') {
          return { ok: false, error: STORY_NOT_FOUND_ERROR }
        }
        if (err.code === 'AUTH_REQUIRED') {
          return { ok: false, error: AUTHORING_AUTH_REQUIRED_ERROR }
        }
      }
      throw err
    }

    if (enqueued.alreadyComplete) {
      await ensureReaderStateStarted(storyId, chapterNumber)
      return {
        ok: true,
        chapterNumber,
        status: 'ALREADY_READY',
        attemptId: enqueued.jobId ?? null,
        correlationId: enqueued.correlationId ?? crypto.randomUUID(),
      }
    }

    if (!enqueued.jobId || !enqueued.correlationId) {
      throw new Error('ENQUEUE_MISSING_JOB_ID')
    }

    const jobId = enqueued.jobId
    const correlationId = enqueued.correlationId

    // Job row is committed. Only now schedule the worker claim.
    after(async () => {
      const startedAt = Date.now()
      try {
        const { claimAndRunGenerationJobById } = await import(
          '@/lib/runtime/generation-worker'
        )
        const run = await claimAndRunGenerationJobById({ jobId })
        if (!run.ok && run.outcome !== 'RETRY_WAIT') {
          console.log('START_CHAPTER_WORKER_FAILED', {
            storyId,
            chapterNumber,
            jobId,
            correlationId,
            outcome: run.outcome,
            reason: run.reason ?? null,
            path: 'worker',
            elapsedMs: Date.now() - startedAt,
          })
        } else {
          console.log('START_CHAPTER_WORKER_DONE', {
            storyId,
            chapterNumber,
            jobId,
            correlationId,
            outcome: run.ok ? run.outcome : run.outcome,
            path: 'worker',
            elapsedMs: Date.now() - startedAt,
          })
        }
      } catch (err) {
        const info = safeErrorInfo(err)
        console.error('START_CHAPTER_BACKGROUND_EXCEPTION', {
          storyId,
          chapterNumber,
          jobId,
          correlationId,
          stage: 'AFTER_CALLBACK',
          path: 'worker',
          errorName: info.errorName,
          errorMessage: info.errorMessage,
          errorStack: info.errorStack,
          elapsedMs: Date.now() - startedAt,
        })
      }
    })

    await ensureReaderStateStarted(storyId, chapterNumber)

    return {
      ok: true,
      chapterNumber,
      status: 'STARTED',
      attemptId: jobId,
      correlationId,
    }
  } catch (e) {
    return fail(e)
  }
}
