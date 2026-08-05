import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCommercialStoryMode } from '@/lib/commercial/resolver.server'
import { isChapterFree, unlockRef, DEFAULT_READING_POLICY, type ReadingPolicy } from './policy'

export interface ChapterAccessDecision {
  readable: boolean
  reason:
    | 'FREE_STANDARD'
    | 'STARTER_INCLUDED'
    | 'PAID_START_INCLUDED'
    | 'LEGACY_INCLUDED'
    | 'LEDGER_UNLOCKED'
    | 'PAYMENT_REQUIRED'
    | 'STORY_PENDING'
    | 'NOT_AUTHORIZED'
  cost: number
}

export async function resolveChapterAccess(input: {
  userId: string | null
  storyId: string
  chapterNumber: number
  policy?: ReadingPolicy
}): Promise<ChapterAccessDecision> {
  const db = createAdminClient()

  // 1. Fetch story
  const { data: story } = await db
    .from('stories')
    .select('id, owner_user_id, story_mode, commercial_origin')
    .eq('id', input.storyId)
    .maybeSingle()

  if (!story) {
    return { readable: false, reason: 'NOT_AUTHORIZED', cost: 0 }
  }

  const isCommercial = isCommercialStoryMode(story.story_mode)

  // Standard / shared public stories preserve existing ReadingPolicy behavior
  if (!isCommercial) {
    const policy = input.policy ?? DEFAULT_READING_POLICY
    const free = isChapterFree(input.chapterNumber, policy)
    if (free) {
      return { readable: true, reason: 'FREE_STANDARD', cost: 0 }
    }
    if (!input.userId) {
      return { readable: false, reason: 'PAYMENT_REQUIRED', cost: policy.creditsPerChapter }
    }
    // Check ledger proof
    const { data: ledger } = await db
      .from('credit_ledger')
      .select('id')
      .eq('user_id', input.userId)
      .eq('ref', unlockRef(input.storyId, input.chapterNumber))
      .maybeSingle()

    if (ledger) {
      return { readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 }
    }
    return { readable: false, reason: 'PAYMENT_REQUIRED', cost: policy.creditsPerChapter }
  }

  // Commercial mode (personalized_ai / premium_instance)
  const origin = story.commercial_origin

  // PENDING_PAID_START: Not readable until Bab 1 publish capture promotes story to PAID_START
  if (origin === 'PENDING_PAID_START') {
    return { readable: false, reason: 'STORY_PENDING', cost: 24 }
  }

  // Bab 1-3 for STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED
  if (input.chapterNumber >= 1 && input.chapterNumber <= 3) {
    if (origin === 'STARTER_FREE') {
      return { readable: true, reason: 'STARTER_INCLUDED', cost: 0 }
    }
    if (origin === 'PAID_START') {
      return { readable: true, reason: 'PAID_START_INCLUDED', cost: 0 }
    }
    if (origin === 'LEGACY_GRANDFATHERED') {
      return { readable: true, reason: 'LEGACY_INCLUDED', cost: 0 }
    }
  }

  // Bab 4+ or unhandled origin
  if (!input.userId) {
    return { readable: false, reason: 'PAYMENT_REQUIRED', cost: 8 }
  }

  // Check ledger proof unlock:{storyId}:{chapter}
  const { data: ledger } = await db
    .from('credit_ledger')
    .select('id')
    .eq('user_id', input.userId)
    .eq('ref', unlockRef(input.storyId, input.chapterNumber))
    .maybeSingle()

  if (ledger) {
    return { readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 }
  }

  return { readable: false, reason: 'PAYMENT_REQUIRED', cost: 8 }
}
