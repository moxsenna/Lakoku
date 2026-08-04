/**
 * Pure policy logic for anti-abuse & commercial entitlements (P0).
 *
 * Rules:
 *  - 1 account has at most 1 lifetime Starter Story (`starterStoryId`).
 *  - Only the Starter Story gets Chapters 1–3 free (`FREE_STARTER_CHAPTER`).
 *  - Welcome credits = 20 (granted once per account lifetime).
 *  - Additional story start cost = 24 credits.
 *  - Chapter unlock cost = 8 credits.
 */

export interface AccountCommercialState {
  userId: string
  starterStoryId: string | null
  starterClaimedAt: string | null
  welcomeCreditGrantedAt: string | null
  welcomeCreditEventId: string | null
  firstPurchaseAt?: string | null
  riskState: 'NORMAL' | 'WATCH' | 'CHALLENGE' | 'BLOCK'
}

export const WELCOME_CREDITS_AMOUNT = 20
export const STARTER_FREE_CHAPTERS_COUNT = 3
export const CHAPTER_UNLOCK_COST = 8
export const ADDITIONAL_STORY_START_COST = 24

/**
 * Returns true if the given storyId matches the account's registered lifetime starter story.
 */
export function isStarterStory(storyId: string, accountState: AccountCommercialState | null): boolean {
  if (!accountState || !accountState.starterStoryId) return false
  return accountState.starterStoryId === storyId
}

/**
 * Returns true if chapter `chapterNumber` is free for `storyId` on `accountState`.
 * ONLY Chapters 1–3 on the registered Starter Story are FREE.
 */
export function isChapterFreeForAccount(
  storyId: string,
  chapterNumber: number,
  accountState: AccountCommercialState | null,
): boolean {
  if (!isStarterStory(storyId, accountState)) return false
  return chapterNumber >= 1 && chapterNumber <= STARTER_FREE_CHAPTERS_COUNT
}

/**
 * Returns the cost to start a new story.
 * If user has no starter story claimed yet, cost is 0 (included in Starter Story entitlement).
 * If user already has a starter story, cost is 24 credits.
 */
export function getStoryStartCost(accountState: AccountCommercialState | null): number {
  if (!accountState || !accountState.starterStoryId) {
    return 0 // First story is free Starter
  }
  return ADDITIONAL_STORY_START_COST // Story #2+ costs 24
}
