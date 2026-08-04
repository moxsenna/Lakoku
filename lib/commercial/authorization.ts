import { CHAPTER_UNLOCK_COST } from './policy'

export interface GenerationAuthorizationInput {
  userId: string
  storyId: string
  chapterNumber: number
  availableBalance: number
  isStarterStory: boolean
  hasPaidStartIncluded?: boolean
  hasActiveReservation?: boolean
}

export type CommercialAuthStatus = 'AUTHORIZED' | 'WAITING_FOR_CREDITS'

export interface GenerationAuthorizationResult {
  authorized: boolean
  status: CommercialAuthStatus
  requiredCredits: number
  availableBalance: number
  reason?: string
}

/**
 * Commercial Authorization Seam for AI Generation (P0).
 *
 * MUST be asserted before starting any AI provider call (standard, personalized, or worker recovery).
 * Returns `authorized: true` if:
 *  - Chapter is a free starter chapter (Chapters 1-3 on user's Starter Story)
 *  - Story has paid start included (Chapters 1-3 on a 24-credit paid story)
 *  - An active credit reservation is held for this chapter/job
 *  - Or user has availableBalance >= requiredCredits (8 credits for chapter unlock)
 *
 * Otherwise returns `authorized: false` with `status: 'WAITING_FOR_CREDITS'`.
 */
export async function assertGenerationCommercialAuthorization(
  input: GenerationAuthorizationInput,
): Promise<GenerationAuthorizationResult> {
  const {
    chapterNumber,
    availableBalance,
    isStarterStory,
    hasPaidStartIncluded = false,
    hasActiveReservation = false,
  } = input

  // 1. Free Starter Story Chapters 1-3
  if (isStarterStory && chapterNumber >= 1 && chapterNumber <= 3) {
    return {
      authorized: true,
      status: 'AUTHORIZED',
      requiredCredits: 0,
      availableBalance,
      reason: 'FREE_STARTER_CHAPTER',
    }
  }

  // 2. Paid Start Included Chapters 1-3 (24 credits paid for story creation)
  if (hasPaidStartIncluded && chapterNumber >= 1 && chapterNumber <= 3) {
    return {
      authorized: true,
      status: 'AUTHORIZED',
      requiredCredits: 0,
      availableBalance,
      reason: 'PAID_START_INCLUDED',
    }
  }

  // 3. Active Credit Reservation Held for this generation
  if (hasActiveReservation) {
    return {
      authorized: true,
      status: 'AUTHORIZED',
      requiredCredits: 0,
      availableBalance,
      reason: 'ACTIVE_CREDIT_RESERVATION',
    }
  }

  // 4. Paid Chapter Unlock (8 credits)
  const requiredCredits = CHAPTER_UNLOCK_COST
  if (availableBalance >= requiredCredits) {
    return {
      authorized: true,
      status: 'AUTHORIZED',
      requiredCredits,
      availableBalance,
      reason: 'SUFFICIENT_CREDITS',
    }
  }

  // 5. Insufficient credits -> Block provider call, persist choice, return WAITING_FOR_CREDITS
  return {
    authorized: false,
    status: 'WAITING_FOR_CREDITS',
    requiredCredits,
    availableBalance,
    reason: 'INSUFFICIENT_CREDITS',
  }
}
