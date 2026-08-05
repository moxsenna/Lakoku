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
    | 'COMMERCIAL_ACCESS_NOT_FINALIZED'
    | 'NOT_AUTHORIZED'
    | 'CONFIG_ERROR'
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
  const { data: story, error: storyErr } = await db
    .from('stories')
    .select('id, owner_user_id, story_mode, commercial_origin, visibility')
    .eq('id', input.storyId)
    .maybeSingle()

  if (storyErr || !story) {
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

  // Commercial mode (personalized_ai / premium_instance): STRICT OWNER CHECK & VISIBILITY CHECK
  if (!input.userId || story.owner_user_id !== input.userId) {
    return { readable: false, reason: 'NOT_AUTHORIZED', cost: 0 }
  }

  if (story.visibility && story.visibility !== 'private' && story.visibility !== 'unlisted') {
    return { readable: false, reason: 'NOT_AUTHORIZED', cost: 0 }
  }

  // Fetch active feature costs from DB
  const { data: pricingRows, error: pricingErr } = await db
    .from('feature_credit_costs')
    .select('feature_key, credits_required, is_active')
    .in('feature_key', ['story_start', 'chapter_unlock'])

  if (pricingErr || !pricingRows) {
    return { readable: false, reason: 'CONFIG_ERROR', cost: 0 }
  }

  const storyStartCost = pricingRows.find((r) => r.feature_key === 'story_start' && r.is_active)?.credits_required
  const chapterUnlockCost = pricingRows.find((r) => r.feature_key === 'chapter_unlock' && r.is_active)?.credits_required

  if (storyStartCost == null || chapterUnlockCost == null || storyStartCost <= 0 || chapterUnlockCost <= 0) {
    return { readable: false, reason: 'CONFIG_ERROR', cost: 0 }
  }

  const origin = story.commercial_origin

  // PENDING_PAID_START: Not readable until Bab 1 publish capture promotes story to PAID_START
  if (origin === 'PENDING_PAID_START') {
    return { readable: false, reason: 'STORY_PENDING', cost: storyStartCost }
  }

  // Bab 1-3 for STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED
  if (input.chapterNumber >= 1 && input.chapterNumber <= 3) {
    if (origin === 'STARTER_FREE') {
      const { data: accountState, error: accountErr } = await db
        .from('account_commercial_states')
        .select('starter_story_id, starter_claimed_at')
        .eq('user_id', input.userId)
        .maybeSingle()

      if (
        accountErr
        || !accountState
        || accountState.starter_story_id !== story.id
        || accountState.starter_claimed_at == null
      ) {
        return { readable: false, reason: 'NOT_AUTHORIZED', cost: 0 }
      }

      return { readable: true, reason: 'STARTER_INCLUDED', cost: 0 }
    }
    if (origin === 'PAID_START') {
      return { readable: true, reason: 'PAID_START_INCLUDED', cost: 0 }
    }
    if (origin === 'LEGACY_GRANDFATHERED') {
      return { readable: true, reason: 'LEGACY_INCLUDED', cost: 0 }
    }
  }

  // Bab 4+: Check ledger proof unlock:{storyId}:{chapter}
  const { data: ledger } = await db
    .from('credit_ledger')
    .select('id')
    .eq('user_id', input.userId)
    .eq('ref', unlockRef(input.storyId, input.chapterNumber))
    .maybeSingle()

  if (ledger) {
    return { readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 }
  }

  // Check if chapter row exists in DB
  const { data: chRow } = await db
    .from('chapters')
    .select('number')
    .eq('story_id', input.storyId)
    .eq('number', input.chapterNumber)
    .maybeSingle()

  if (chRow) {
    if (origin === 'STARTER_FREE' || origin === 'PAID_START') {
      // Modern story chapter exists but unlock ledger missing -> publication reconciliation invariant failure
      return { readable: false, reason: 'COMMERCIAL_ACCESS_NOT_FINALIZED', cost: 0 }
    }
  }

  return { readable: false, reason: 'PAYMENT_REQUIRED', cost: chapterUnlockCost }
}
