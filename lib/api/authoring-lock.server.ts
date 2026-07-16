/**
 * Server-only lock story bible core — shared by Server Actions and REST API.
 * Android/web both call POST /api/stories/authoring/lock; actions stay thin wrappers.
 */
import 'server-only'
import {
  persistStoryBible,
  makeVoiceSheetAuthor,
  publicAuthoringErrorMessage,
  proposeMystery,
  proposeWorld,
} from '@/lib/authoring/server'
import { runLockLadder, type AiRepairFn } from '@/lib/authoring/repair'
import { enrichOpeningVoiceSheets } from '@/lib/authoring'
import { ensureReaderStateStarted } from '@/lib/api/user-state'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import { StoryBibleDraftSchema } from '@/lib/authoring/schema'
import type { Finding } from '@lakoku/narrative-core'

export type AuthoringLockSuccess = {
  ok: true
  storyId: string
  resolvedBy: string
  transforms: string[]
}

export type AuthoringLockFailure =
  | { ok: false; error: string }
  | { ok: false; needsAuthor: true; findings: Finding[]; transforms: string[] }

export type AuthoringLockResult = AuthoringLockSuccess | AuthoringLockFailure

function findingsToFeedback(findings: Finding[]): string {
  const lines = findings
    .filter((f) => f.severity === 'CRITICAL')
    .map((f) => `- ${f.message}`)
  return [
    'Story bible melanggar aturan berikut. Perbaiki HANYA konten agar patuh, jangan ubah struktur bab/act:',
    ...lines,
    'Ingat: setiap rahasia hanya boleh dibuka pada bab 12, 20, 32, atau 45. Misteri utama harus terbayar sebelum bab 48. Subjek fakta harus salah satu nama karakter atau kosong. Jangan pakai istilah teknis internal.',
  ].join('\n')
}

function fail(err: unknown): AuthoringLockFailure {
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.'
  const publicMessage = message === AUTHORING_AUTH_REQUIRED_ERROR
    ? AUTHORING_AUTH_REQUIRED_ERROR
    : publicAuthoringErrorMessage(err)
  console.log('[v0] authoring lock error:', message, { publicMessage })
  return { ok: false, error: publicMessage }
}

/**
 * Auth via session cookie (web) or same getSessionUser path.
 * rawDraft validated with StoryBibleDraftSchema.
 */
export async function lockStoryBibleForSession(
  rawDraft: unknown,
): Promise<AuthoringLockResult> {
  try {
    const user = await requireAuthoringSessionUser()
    const draft = StoryBibleDraftSchema.parse(rawDraft)

    const aiRepair: AiRepairFn = async (d, findings) => {
      const feedback = findingsToFeedback(findings)
      const [{ mystery }, worldBase] = [
        await proposeMystery(d.premise, d.cast, feedback, d.mystery),
        d,
      ]
      const { world } = await proposeWorld(d.premise, d.cast, mystery, feedback, worldBase.world)
      return { premise: d.premise, cast: d.cast, mystery, world }
    }

    const result = await runLockLadder(draft, { aiRepair })
    if (result.status === 'NEEDS_AUTHOR') {
      return {
        ok: false,
        needsAuthor: true,
        findings: result.findings,
        transforms: result.transforms,
      }
    }

    const opening = await enrichOpeningVoiceSheets(result.compiled, makeVoiceSheetAuthor())
    if (opening.enrichedIds.length || opening.fallbackIds.length) {
      console.log(
        '[v0] opening package voice — diperkaya:',
        opening.enrichedIds,
        'fallback:',
        opening.fallbackIds,
      )
    }

    const { storyId } = await persistStoryBible(opening.compiled, user.id)
    await ensureReaderStateStarted(storyId, 1, 'BARU')

    return {
      ok: true,
      storyId,
      resolvedBy: result.resolvedBy,
      transforms: result.transforms,
    }
  } catch (e) {
    return fail(e)
  }
}
