import 'server-only'

import type { PremiseDraft } from './schema'
import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'
import { proposeCast, proposeMystery, proposeWorld } from './brainstorm'
import { lockStoryBibleForSession } from '@/lib/api/authoring-lock.server'

export interface AssembleBibleParams {
  premise: PremiseDraft
  creativeDirection?: StoryCreativeDirection | null
  userId: string
}

export interface AssembleBibleResult {
  ok: boolean
  storyId?: string
  error?: string
  needsAuthor?: boolean
}

/**
 * Merakit story bible (Cast -> Mystery -> World) dan menguncinya ke DB
 * dalam satu siklus terkoordinasi di server tanpa round-trip bolak-balik klien.
 */
export async function assembleAndLockStoryBible(
  params: AssembleBibleParams,
): Promise<AssembleBibleResult> {
  const { premise, creativeDirection } = params
  const opts = creativeDirection ? { direction: creativeDirection } : undefined

  // 1. Propose Cast
  const castRes = await proposeCast(premise, undefined, undefined, opts)

  // 2. Propose Mystery
  const mysteryRes = await proposeMystery(premise, castRes.cast, undefined, undefined, opts)

  // 3. Propose World
  const worldRes = await proposeWorld(
    premise,
    castRes.cast,
    mysteryRes.mystery,
    undefined,
    undefined,
    opts,
  )

  // 4. Lock & persist Bible
  const draft = {
    premise,
    cast: castRes.cast,
    mystery: mysteryRes.mystery,
    world: worldRes.world,
    creativeDirection: creativeDirection ?? undefined,
  }

  const lockRes = await lockStoryBibleForSession(draft)
  if (!lockRes.ok) {
    const isNeedsAuthor = 'needsAuthor' in lockRes && lockRes.needsAuthor
    return {
      ok: false,
      error: isNeedsAuthor
        ? 'Cerita ini butuh sedikit penyesuaian. Coba pilih premis lain atau ulangi setup.'
        : ('error' in lockRes ? lockRes.error : 'Gagal mengunci bible cerita.'),
      needsAuthor: isNeedsAuthor ? true : undefined,
    }
  }

  return {
    ok: true,
    storyId: lockRes.storyId,
  }
}
