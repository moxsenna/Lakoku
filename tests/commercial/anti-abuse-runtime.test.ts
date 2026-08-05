import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/admin', () => {
  return {
    createAdminClient: vi.fn(),
  }
})

import { isCommercialStoryMode, resolveCommercialAuthorization } from '@/lib/commercial/resolver.server'
import { resolveChapterAccess } from '@/lib/credits/access-resolver.server'
import { createAdminClient } from '@/lib/supabase/admin'

const mockCreateAdminClient = vi.mocked(createAdminClient)

describe('Phase 2A Commercial Anti-Abuse Runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Commercial Story Mode Classification', () => {
    it('correctly identifies commercial vs non-commercial modes', () => {
      expect(isCommercialStoryMode('personalized_ai')).toBe(true)
      expect(isCommercialStoryMode('premium_instance')).toBe(true)
      expect(isCommercialStoryMode('standard')).toBe(false)
      expect(isCommercialStoryMode('premium_template')).toBe(false)
      expect(isCommercialStoryMode(null)).toBe(false)
    })
  })

  describe('Commercial Authorization Resolver', () => {
    it('authorizes Bab 1-3 for STARTER_FREE story', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-1',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'STARTER_FREE',
                      visibility: 'private',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const result = await resolveCommercialAuthorization({
        userId: 'user-1',
        storyId: 'story-1',
        chapterNumber: 1,
      })

      expect(result.status).toBe('AUTHORIZED')
      expect(result.origin).toBe('STARTER_FREE')
      expect(result.requiredCredits).toBe(0)
    })

    it('requires 8 credits reservation for Bab 4 on STARTER_FREE story', async () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      }
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-1',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'STARTER_FREE',
                      visibility: 'private',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'credit_reservations') {
            return chain
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const result = await resolveCommercialAuthorization({
        userId: 'user-1',
        storyId: 'story-1',
        chapterNumber: 4,
      })

      expect(result.status).toBe('NEEDS_RESERVATION')
      expect(result.origin).toBe('STARTER_FREE')
      expect(result.requiredCredits).toBe(8)
    })

    it('denies Bab 2 for PENDING_PAID_START story before Bab 1 publish capture', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-2',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'PENDING_PAID_START',
                      visibility: 'private',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const result = await resolveCommercialAuthorization({
        userId: 'user-1',
        storyId: 'story-2',
        chapterNumber: 2,
      })

      expect(result.status).toBe('DENIED')
      expect(result.reason).toBe('STORY_START_PENDING')
    })
  })

  describe('Unified Reader Access Resolver', () => {
    it('returns STORY_PENDING for PENDING_PAID_START story on any chapter', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-pending',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'PENDING_PAID_START',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const decision = await resolveChapterAccess({
        userId: 'user-1',
        storyId: 'story-pending',
        chapterNumber: 1,
      })

      expect(decision.readable).toBe(false)
      expect(decision.reason).toBe('STORY_PENDING')
      expect(decision.cost).toBe(24)
    })

    it('returns LEDGER_UNLOCKED if canonical ledger entry exists for Bab 4+', async () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: 'ledger-1' }, error: null }),
      }
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-paid',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'PAID_START',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'credit_ledger') {
            return chain
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const decision = await resolveChapterAccess({
        userId: 'user-1',
        storyId: 'story-paid',
        chapterNumber: 4,
      })

      expect(decision.readable).toBe(true)
      expect(decision.reason).toBe('LEDGER_UNLOCKED')
      expect(decision.cost).toBe(0)
    })
  })
})
