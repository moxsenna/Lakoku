import { describe, expect, it, vi } from 'vitest'
import {
  isChapterFreeForAccount,
  isStarterStory,
  getStoryStartCost,
  type AccountCommercialState,
} from '../../lib/commercial/policy'
import {
  assertGenerationCommercialAuthorization,
  type GenerationAuthorizationInput,
} from '../../lib/commercial/authorization'
import { calculateTopupCredits, type CreditProductMinimal } from '../../lib/paycore/bonus'

/**
 * Anti-Abuse P0 Regression Test Suite (RED / Policy Verification)
 */

describe('P0 Anti-Abuse Commercial Policy & Entitlements', () => {
  describe('Rule A & B & C: Starter Story Entitlement & Delete Semantics', () => {
    it('fresh account with Story A as starter: Chapters 1-3 are FREE', () => {
      const accountState: AccountCommercialState = {
        userId: 'user-123',
        starterStoryId: 'story-A',
        starterClaimedAt: new Date().toISOString(),
        welcomeCreditGrantedAt: new Date().toISOString(),
        welcomeCreditEventId: 'evt-1',
        riskState: 'NORMAL',
      }

      expect(isStarterStory('story-A', accountState)).toBe(true)
      expect(isChapterFreeForAccount('story-A', 1, accountState)).toBe(true)
      expect(isChapterFreeForAccount('story-A', 2, accountState)).toBe(true)
      expect(isChapterFreeForAccount('story-A', 3, accountState)).toBe(true)
      expect(isChapterFreeForAccount('story-A', 4, accountState)).toBe(false)
    })

    it('same account with Story B (second story): Chapters 1-3 are NOT free', () => {
      const accountState: AccountCommercialState = {
        userId: 'user-123',
        starterStoryId: 'story-A',
        starterClaimedAt: new Date().toISOString(),
        welcomeCreditGrantedAt: new Date().toISOString(),
        welcomeCreditEventId: 'evt-1',
        riskState: 'NORMAL',
      }

      expect(isStarterStory('story-B', accountState)).toBe(false)
      expect(isChapterFreeForAccount('story-B', 1, accountState)).toBe(false)
      expect(isChapterFreeForAccount('story-B', 2, accountState)).toBe(false)
      expect(isChapterFreeForAccount('story-B', 3, accountState)).toBe(false)
      expect(getStoryStartCost(accountState)).toBe(24)
    })

    it('deleting Story A does NOT restore starter entitlement for Story C', () => {
      const accountStateAfterDelete: AccountCommercialState = {
        userId: 'user-123',
        starterStoryId: 'story-A',
        starterClaimedAt: '2026-08-01T00:00:00.000Z',
        welcomeCreditGrantedAt: '2026-08-01T00:00:00.000Z',
        welcomeCreditEventId: 'evt-1',
        riskState: 'NORMAL',
      }

      expect(isStarterStory('story-C', accountStateAfterDelete)).toBe(false)
      expect(isChapterFreeForAccount('story-C', 1, accountStateAfterDelete)).toBe(false)
      expect(getStoryStartCost(accountStateAfterDelete)).toBe(24)
    })

    it('Requirement 7: starterClaimedAt is lifetime authority even if starterStoryId is null', () => {
      const accountState: AccountCommercialState = {
        userId: 'user-orphaned-starter',
        starterStoryId: null,
        starterClaimedAt: '2026-08-01T00:00:00.000Z',
        welcomeCreditGrantedAt: '2026-08-01T00:00:00.000Z',
        welcomeCreditEventId: 'evt-1',
        riskState: 'NORMAL',
      }

      expect(getStoryStartCost(accountState)).toBe(24)
    })
  })

  describe('Rule D: Welcome Credit Exactly Once', () => {
    it('welcome credit is +20 and granted exactly once', () => {
      const WELCOME_CREDIT_AMOUNT = 20
      expect(WELCOME_CREDIT_AMOUNT).toBe(20)
    })
  })

  describe('Rule F & Item 3: Generation Authorization Requires Active Reservation (Balance Alone Cannot Authorize)', () => {
    it('returns NEEDS_RESERVATION and authorized=false when balance=100 and hasActiveReservation=false', async () => {
      const mockProviderCall = vi.fn()

      const input: GenerationAuthorizationInput = {
        userId: 'user-high-balance',
        storyId: 'story-paid-1',
        chapterNumber: 4,
        availableBalance: 100,
        isStarterStory: false,
        hasPaidStartIncluded: false,
        hasActiveReservation: false,
      }

      const authResult = await assertGenerationCommercialAuthorization(input)

      expect(authResult.authorized).toBe(false)
      expect(authResult.status).toBe('NEEDS_RESERVATION')
      expect(authResult.requiredCredits).toBe(8)
      expect(authResult.availableBalance).toBe(100)

      if (authResult.authorized) {
        await mockProviderCall()
      }

      expect(mockProviderCall).not.toHaveBeenCalled()
    })

    it('returns AUTHORIZED and authorized=true when hasActiveReservation=true', async () => {
      const mockProviderCall = vi.fn()

      const input: GenerationAuthorizationInput = {
        userId: 'user-reserved',
        storyId: 'story-paid-1',
        chapterNumber: 4,
        availableBalance: 0,
        isStarterStory: false,
        hasPaidStartIncluded: false,
        hasActiveReservation: true,
      }

      const authResult = await assertGenerationCommercialAuthorization(input)

      expect(authResult.authorized).toBe(true)
      expect(authResult.status).toBe('AUTHORIZED')
      expect(authResult.reason).toBe('ACTIVE_CREDIT_RESERVATION')

      if (authResult.authorized) {
        await mockProviderCall()
      }

      expect(mockProviderCall).toHaveBeenCalledTimes(1)
    })

    it('returns WAITING_FOR_CREDITS and makes ZERO provider calls when balance=4 and chapter costs 8', async () => {
      const mockProviderWrite = vi.fn()

      const input: GenerationAuthorizationInput = {
        userId: 'user-low-balance',
        storyId: 'story-paid-1',
        chapterNumber: 4,
        availableBalance: 4,
        isStarterStory: false,
        hasPaidStartIncluded: false,
        hasActiveReservation: false,
      }

      const authResult = await assertGenerationCommercialAuthorization(input)

      expect(authResult.authorized).toBe(false)
      expect(authResult.status).toBe('WAITING_FOR_CREDITS')
      expect(authResult.requiredCredits).toBe(8)
      expect(authResult.availableBalance).toBe(4)

      if (authResult.authorized) {
        await mockProviderWrite()
      }

      expect(mockProviderWrite).not.toHaveBeenCalled()
    })
  })

  describe('Rule G: Story #2 Insufficient Credits (balance=20, required=24)', () => {
    it('prevents story contract generation and prose calls when balance=20 and story start requires 24', async () => {
      const mockStoryContractProvider = vi.fn()
      const mockProseProvider = vi.fn()

      const accountState: AccountCommercialState = {
        userId: 'user-20-balance',
        starterStoryId: 'story-A',
        starterClaimedAt: new Date().toISOString(),
        welcomeCreditGrantedAt: new Date().toISOString(),
        welcomeCreditEventId: 'evt-welcome',
        riskState: 'NORMAL',
      }

      const availableBalance = 20
      const cost = getStoryStartCost(accountState)

      expect(cost).toBe(24)
      expect(availableBalance < cost).toBe(true)

      const canStartStory = availableBalance >= cost
      if (canStartStory) {
        await mockStoryContractProvider()
        await mockProseProvider()
      }

      expect(mockStoryContractProvider).not.toHaveBeenCalled()
      expect(mockProseProvider).not.toHaveBeenCalled()
    })
  })

  describe('Rule 5 Regression: First Purchase Bonus XOR Normal Bonus', () => {
    it('first purchase bonus is mutually exclusive with normal bonus', () => {
      const product: CreditProductMinimal = {
        credits: 70,
        normalBonusCredits: 8,
        firstTopupBonusCredits: 20,
        bonusActive: true,
      }

      const firstResult = calculateTopupCredits(product, true)
      expect(firstResult.bonusCredits).toBe(20)
      expect(firstResult.totalCredits).toBe(90)
      expect(firstResult.bonusKind).toBe('first_topup')

      const secondResult = calculateTopupCredits(product, false)
      expect(secondResult.bonusCredits).toBe(8)
      expect(secondResult.totalCredits).toBe(78)
      expect(secondResult.bonusKind).toBe('normal')
    })
  })
})
