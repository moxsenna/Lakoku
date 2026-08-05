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

  // 1. Load story
  const { data: story, error: storyErr } = await db
    .from('stories')
    .select('id, owner_user_id, story_mode, commercial_origin, visibility')
    .eq('id', input.storyId)
    .maybeSingle()

  if (storyErr || !story) {
    return { status: 'DENIED', origin: null, requiredCredits: 0, reason: 'STORY_NOT_FOUND' }
  }

  // Standard / shared public stories stay outside commercial resolver rollout
  if (!isCommercialStoryMode(story.story_mode) || story.owner_user_id !== input.userId) {
    return { status: 'DENIED', origin: story.commercial_origin, requiredCredits: 0, reason: 'NOT_COMMERCIAL_MODE' }
  }

  const origin = story.commercial_origin

  // 2. Bab 1-3 for STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED
  if (input.chapterNumber >= 1 && input.chapterNumber <= 3) {
    if (origin === 'STARTER_FREE' || origin === 'PAID_START' || origin === 'LEGACY_GRANDFATHERED') {
      return { status: 'AUTHORIZED', origin, requiredCredits: 0 }
    }
    if (origin === 'PENDING_PAID_START') {
      if (input.chapterNumber === 1) {
        // Check exact active STORY_START reservation
        const { data: res } = await db
          .from('credit_reservations')
          .select('reservation_ref, status, expires_at')
          .eq('user_id', input.userId)
          .eq('reservation_kind', 'STORY_START')
          .eq('target_story_id', input.storyId)
          .eq('status', 'ACTIVE')
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (res) {
          return { status: 'AUTHORIZED', origin, requiredCredits: 24, reservationRef: res.reservation_ref }
        }
        return { status: 'NEEDS_RESERVATION', origin, requiredCredits: 24 }
      }
      // Bab 2-3 denied for PENDING_PAID_START until Bab 1 publish capture promotes story to PAID_START
      return { status: 'DENIED', origin, requiredCredits: 0, reason: 'STORY_START_PENDING' }
    }
    return { status: 'DENIED', origin, requiredCredits: 0, reason: 'INVALID_COMMERCIAL_ORIGIN' }
  }

  // 3. Bab 4+ for STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED (unpublished)
  if (input.chapterNumber >= 4) {
    if (origin === 'PENDING_PAID_START') {
      return { status: 'DENIED', origin, requiredCredits: 0, reason: 'STORY_START_PENDING' }
    }

    if (origin === 'STARTER_FREE' || origin === 'PAID_START' || origin === 'LEGACY_GRANDFATHERED') {
      // Check exact active CHAPTER_UNLOCK reservation
      const { data: res } = await db
        .from('credit_reservations')
        .select('reservation_ref, status, expires_at')
        .eq('user_id', input.userId)
        .eq('reservation_kind', 'CHAPTER_UNLOCK')
        .eq('target_story_id', input.storyId)
        .eq('target_chapter_number', input.chapterNumber)
        .eq('status', 'ACTIVE')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (res) {
        return { status: 'AUTHORIZED', origin, requiredCredits: 8, reservationRef: res.reservation_ref }
      }
      return { status: 'NEEDS_RESERVATION', origin, requiredCredits: 8 }
    }
  }

  return { status: 'DENIED', origin, requiredCredits: 0, reason: 'UNSUPPORTED_CHAPTER_OR_ORIGIN' }
}
