import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type CommercialAuthorizationStatus =
  | 'AUTHORIZED'
  | 'NEEDS_RESERVATION'
  | 'WAITING_FOR_CREDITS'
  | 'DENIED'

export interface CommercialAuthorizationDecision {
  status: CommercialAuthorizationStatus
  origin: string | null
  requiredCredits: number
  reservationRef?: string
  reason?: string
}

export function isCommercialStoryMode(storyMode: string | null | undefined): boolean {
  return storyMode === 'personalized_ai' || storyMode === 'premium_instance'
}

export async function resolveCommercialAuthorization(input: {
  userId: string
  storyId: string
  chapterNumber: number
}): Promise<CommercialAuthorizationDecision> {
  const db = createAdminClient()

  // 1. Fetch active pricing from DB with zero hardcoded fallbacks
  const { data: pricingRows, error: pricingErr } = await db
    .from('feature_credit_costs')
    .select('feature_key, credits_required, is_active')
    .in('feature_key', ['story_start', 'chapter_unlock'])

  if (pricingErr || !pricingRows) {
    return { status: 'DENIED', origin: null, requiredCredits: 0, reason: 'INTERNAL_CONFIG_ERROR' }
  }

  const storyStartPrice = pricingRows.find((r) => r.feature_key === 'story_start' && r.is_active)?.credits_required
  const chapterUnlockPrice = pricingRows.find((r) => r.feature_key === 'chapter_unlock' && r.is_active)?.credits_required

  if (storyStartPrice == null || chapterUnlockPrice == null || storyStartPrice <= 0 || chapterUnlockPrice <= 0) {
    return { status: 'DENIED', origin: null, requiredCredits: 0, reason: 'INTERNAL_CONFIG_ERROR' }
  }

  // 2. Load story
  const { data: story, error: storyErr } = await db
    .from('stories')
    .select('id, owner_user_id, story_mode, commercial_origin, visibility')
    .eq('id', input.storyId)
    .maybeSingle()

  if (storyErr) {
    return { status: 'DENIED', origin: null, requiredCredits: 0, reason: 'INTERNAL_CONFIG_ERROR' }
  }
  if (!story) {
    return { status: 'DENIED', origin: null, requiredCredits: 0, reason: 'STORY_NOT_FOUND' }
  }

  // Standard / shared public stories stay outside commercial resolver rollout
  if (!isCommercialStoryMode(story.story_mode) || story.owner_user_id !== input.userId) {
    return { status: 'DENIED', origin: story.commercial_origin, requiredCredits: 0, reason: 'NOT_COMMERCIAL_MODE' }
  }

  const origin = story.commercial_origin

  // 3. Bab 1-3 for STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED
  if (input.chapterNumber >= 1 && input.chapterNumber <= 3) {
    if (origin === 'STARTER_FREE' || origin === 'PAID_START' || origin === 'LEGACY_GRANDFATHERED') {
      return { status: 'AUTHORIZED', origin, requiredCredits: 0 }
    }
    if (origin === 'PENDING_PAID_START') {
      if (input.chapterNumber === 1) {
        // Check exact active STORY_START reservation matching Phase 1 schema
        const { data: res, error: resErr } = await db
          .from('credit_reservations')
          .select('ref, amount, status, expires_at')
          .eq('user_id', input.userId)
          .eq('story_id', input.storyId)
          .eq('chapter_number', 1)
          .eq('reservation_kind', 'STORY_START')
          .eq('status', 'ACTIVE')
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (resErr) {
          return { status: 'DENIED', origin, requiredCredits: storyStartPrice, reason: 'INTERNAL_CONFIG_ERROR' }
        }

        if (res && res.amount === storyStartPrice) {
          return { status: 'AUTHORIZED', origin, requiredCredits: storyStartPrice, reservationRef: res.ref }
        }
        return { status: 'NEEDS_RESERVATION', origin, requiredCredits: storyStartPrice }
      }
      // Bab 2-3 denied for PENDING_PAID_START until Bab 1 publish capture promotes story to PAID_START
      return { status: 'DENIED', origin, requiredCredits: 0, reason: 'STORY_START_PENDING' }
    }
    return { status: 'DENIED', origin, requiredCredits: 0, reason: 'INVALID_COMMERCIAL_ORIGIN' }
  }

  // 4. Bab 4+ for STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED (unpublished)
  if (input.chapterNumber >= 4) {
    if (origin === 'PENDING_PAID_START') {
      return { status: 'DENIED', origin, requiredCredits: 0, reason: 'STORY_START_PENDING' }
    }

    if (origin === 'STARTER_FREE' || origin === 'PAID_START' || origin === 'LEGACY_GRANDFATHERED') {
      // Check exact active CHAPTER_UNLOCK reservation matching Phase 1 schema
      const { data: res, error: resErr } = await db
        .from('credit_reservations')
        .select('ref, amount, status, expires_at')
        .eq('user_id', input.userId)
        .eq('story_id', input.storyId)
        .eq('chapter_number', input.chapterNumber)
        .eq('reservation_kind', 'CHAPTER_UNLOCK')
        .eq('status', 'ACTIVE')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (resErr) {
        return { status: 'DENIED', origin, requiredCredits: chapterUnlockPrice, reason: 'INTERNAL_CONFIG_ERROR' }
      }

      if (res && res.amount === chapterUnlockPrice) {
        return { status: 'AUTHORIZED', origin, requiredCredits: chapterUnlockPrice, reservationRef: res.ref }
      }
      return { status: 'NEEDS_RESERVATION', origin, requiredCredits: chapterUnlockPrice }
    }
  }

  return { status: 'DENIED', origin, requiredCredits: 0, reason: 'UNSUPPORTED_CHAPTER_OR_ORIGIN' }
}
