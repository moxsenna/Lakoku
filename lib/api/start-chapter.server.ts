/**
 * Server-only first-chapter kickoff — shared by Server Actions and REST API.
 * Schedules generation via next/server after(); returns immediately.
 * Mode (standard vs personalized) resolved by central dispatcher.
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
import { runChapterGenerationAttempt } from '@/lib/runtime/generation-mode'

export const STORY_NOT_FOUND_ERROR = 'Cerita tidak ditemukan.'

export type StartChapterKickoffStatus =
  | 'STARTED'
  | 'ALREADY_RUNNING'
  | 'ALREADY_READY'

export type StartChapterSuccess = {
  ok: true
  chapterNumber: number
  status: StartChapterKickoffStatus
  /** Durable attempt id when available (null until attempt table fully wired). */
  attemptId: string | null
}
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
      return { ok: true, chapterNumber, status: 'ALREADY_READY', attemptId: null }
    }
    if (await hasActiveLease(storyId, chapterNumber)) {
      await ensureReaderStateStarted(storyId, chapterNumber)
      return { ok: true, chapterNumber, status: 'ALREADY_RUNNING', attemptId: null }
    }

    const correlationId = crypto.randomUUID()
    const attemptId = correlationId
    after(async () => {
      const startedAt = Date.now()
      try {
        const dispatched = await runChapterGenerationAttempt({
          storyId,
          userId: user.id,
          chapterNumber,
          correlationId,
          attemptId,
        })
        if (!dispatched.ok) {
          console.log('START_CHAPTER_BACKGROUND_FAILED', {
            storyId,
            chapterNumber,
            correlationId,
            reason: dispatched.reason,
            elapsedMs: Date.now() - startedAt,
          })
          return
        }
        const result = dispatched.result as {
          ok: boolean
          reason?: string
          detail?: unknown
        }
        if (!result.ok && result.reason !== 'CHAPTER_EXISTS' && result.reason !== 'LEASE_HELD') {
          console.log('START_CHAPTER_BACKGROUND_FAILED', {
            storyId,
            chapterNumber,
            correlationId,
            mode: dispatched.mode,
            reason: result.reason,
            failedLayer:
              result.detail && typeof result.detail === 'object' && 'failedLayer' in result.detail
                ? (result.detail as { failedLayer?: string | null }).failedLayer ?? null
                : null,
            findingCodes:
              result.detail && typeof result.detail === 'object' && Array.isArray((result.detail as { findings?: unknown }).findings)
                ? ((result.detail as { findings: Array<{ severity?: string; code?: string }> }).findings)
                    .slice(0, 12)
                    .map((f) => `${f.severity ?? '?'}:${f.code ?? '?'}`)
                : [],
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
          errorName: info.errorName,
          errorMessage: info.errorMessage,
          errorStack: info.errorStack,
          elapsedMs: Date.now() - startedAt,
        })
      }
    })

    await ensureReaderStateStarted(storyId, chapterNumber)

    return { ok: true, chapterNumber, status: 'STARTED', attemptId }
  } catch (e) {
    return fail(e)
  }
}
