/**
 * Server-only first-chapter kickoff — shared by Server Actions and REST API.
 * Schedules generateNextChapterReal via next/server after(); returns immediately.
 */
import 'server-only'
import { after } from 'next/server'
import { generateNextChapterReal } from '@lakoku/runtime'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureReaderStateStarted } from '@/lib/api/user-state'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import { publicAuthoringErrorMessage } from '@/lib/authoring/server'

export const STORY_NOT_FOUND_ERROR = 'Cerita tidak ditemukan.'

export type StartChapterSuccess = { ok: true; chapterNumber: number }
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

/**
 * Owner-only. Idempotent: CHAPTER_EXISTS / LEASE_HELD treated as success in background.
 * chapterNumber defaults to 1 (onboarding kickoff).
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

    const correlationId = crypto.randomUUID()
    after(async () => {
      try {
        const result = await generateNextChapterReal({
          storyId,
          userId: user.id,
          chapterNumber,
          correlationId,
        })
        if (!result.ok && result.reason !== 'CHAPTER_EXISTS' && result.reason !== 'LEASE_HELD') {
          console.log('START_CHAPTER_BACKGROUND_FAILED', {
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
          })
        }
      } catch {
        // Ensure after() never dies silently — release path is inside generateNextChapterReal catch.
        console.log('START_CHAPTER_BACKGROUND_EXCEPTION')
      }
    })

    await ensureReaderStateStarted(storyId, chapterNumber)

    return { ok: true, chapterNumber }
  } catch (e) {
    return fail(e)
  }
}
