'use server'

/**
 * Server actions brainstorm (T7.4) — jembatan client wizard ↔ engine authoring.
 *
 * Tiap tahap membungkus fungsi brainstorm (server-only, LLM). `lockStoryBible`
 * menjalankan TANGGA KEGAGALAN: validate → AI repair (1x) → validate →
 * deterministic transform → validate → escalate ke author. Spine (act/gate/ending)
 * tak pernah diubah — hanya konten trajectory/canon.
 */
import {
  proposePremises,
  refinePremise,
  proposeCast,
  proposeMystery,
  proposeWorld,
  publicAuthoringErrorMessage,
} from '@/lib/authoring/server'
import {
  AUTHORING_AUTH_REQUIRED_ERROR,
  requireAuthoringSessionUser,
} from '@/lib/authoring/action-auth'
import {
  lockStoryBibleForSession,
  type AuthoringLockResult,
} from '@/lib/api/authoring-lock.server'
import {
  startOwnedChapterGeneration,
  type StartChapterResult,
} from '@/lib/api/start-chapter.server'
import type {
  PremiseDraft,
  CastDraft,
  MysteryDraft,
  WorldDraft,
} from '@/lib/authoring/schema'

export interface ActionError {
  ok: false
  error: string
}
export type ActionResult<T> = ({ ok: true } & T) | ActionError

function fail(err: unknown): ActionError {
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan tak terduga.'
  const publicMessage = message === AUTHORING_AUTH_REQUIRED_ERROR
    ? AUTHORING_AUTH_REQUIRED_ERROR
    : publicAuthoringErrorMessage(err)
  console.log('[v0] brainstorm action error:', message, { publicMessage })
  return { ok: false, error: publicMessage }
}

export async function actProposePremises(idea: string): Promise<ActionResult<{ proposals: PremiseDraft[] }>> {
  try {
    await requireAuthoringSessionUser()
    const { proposals } = await proposePremises(idea)
    return { ok: true, proposals }
  } catch (e) {
    return fail(e)
  }
}

export async function actRefinePremise(current: PremiseDraft, feedback: string): Promise<ActionResult<{ premise: PremiseDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { premise } = await refinePremise(current, feedback)
    return { ok: true, premise }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeCast(premise: PremiseDraft, feedback?: string, previous?: CastDraft): Promise<ActionResult<{ cast: CastDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { cast } = await proposeCast(premise, feedback, previous)
    return { ok: true, cast }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeMystery(premise: PremiseDraft, cast: CastDraft, feedback?: string, previous?: MysteryDraft): Promise<ActionResult<{ mystery: MysteryDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { mystery } = await proposeMystery(premise, cast, feedback, previous)
    return { ok: true, mystery }
  } catch (e) {
    return fail(e)
  }
}

export async function actProposeWorld(premise: PremiseDraft, cast: CastDraft, mystery: MysteryDraft, feedback?: string, previous?: WorldDraft): Promise<ActionResult<{ world: WorldDraft }>> {
  try {
    await requireAuthoringSessionUser()
    const { world } = await proposeWorld(premise, cast, mystery, feedback, previous)
    return { ok: true, world }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Thin wrapper — logic lives in lib/api/authoring-lock.server.ts
 * Prefer POST /api/stories/authoring/lock for web/Android clients.
 */
export async function lockStoryBible(rawDraft: unknown): Promise<AuthoringLockResult> {
  return lockStoryBibleForSession(rawDraft)
}

/**
 * Thin wrapper — logic lives in lib/api/start-chapter.server.ts
 * Prefer POST /api/stories/[id]/start-chapter for web/Android clients.
 */
export async function startFirstChapter(
  storyId: string,
): Promise<StartChapterResult> {
  return startOwnedChapterGeneration(storyId, 1)
}
