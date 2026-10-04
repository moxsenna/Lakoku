import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const mockCreateAdminClient = vi.fn()

function adaptMockDbToKysely(mockDb: any) {
  if (!mockDb) return {}
  return {
    selectFrom: vi.fn((table: string) => {
      let currentQuery = mockDb.from ? mockDb.from(table) : null
      const builder: any = {
        select: vi.fn((_cols: any) => {
          if (currentQuery?.select) {
            currentQuery = currentQuery.select()
          }
          return builder
        }),
        where: vi.fn((col: string, op: string, val: any) => {
          if (op === '=' && currentQuery?.eq) {
            currentQuery = currentQuery.eq(col, val)
          } else if (op === 'in' && currentQuery?.in) {
            currentQuery = currentQuery.in(col, val)
          } else if (op === '>' && currentQuery?.gt) {
            currentQuery = currentQuery.gt(col, val instanceof Date ? val.toISOString() : val)
          }
          return builder
        }),
        execute: vi.fn(async () => {
          if (!currentQuery) return []
          if (currentQuery.maybeSingle) {
            const res = await currentQuery.maybeSingle()
            if (res?.error) throw res.error
            return res?.data ? [res.data] : []
          }
          const res = await (typeof currentQuery === 'function' ? currentQuery() : currentQuery)
          if (res?.error) throw res.error
          if (Array.isArray(res?.data)) return res.data
          return res?.data ? [res.data] : []
        }),
      }
      return builder
    }),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAdminClient: () => mockCreateAdminClient(),
    getDb: vi.fn(() => adaptMockDbToKysely(mockCreateAdminClient())),
  }
})

import { isCommercialStoryMode, resolveCommercialAuthorization } from '@/lib/commercial/resolver.server'
import type { createAdminClient } from '@/lib/supabase/admin'

describe('Phase 2B Commercial Worker Preflight & V5 Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Worker Pre-Provider Authorization Contract', () => {
    it('requires active reservation before provider invocation for commercial Bab 4+', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'feature_credit_costs') {
            return {
              select: () => ({
                in: async () => ({
                  data: [
                    { feature_key: 'story_start', credits_required: 24, is_active: true },
                    { feature_key: 'chapter_unlock', credits_required: 8, is_active: true },
                  ],
                  error: null,
                }),
              }),
            }
          }
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-v5-paid',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'PAID_START',
                      visibility: 'private',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'account_commercial_states') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { starter_story_id: 'story-starter', starter_claimed_at: '2026-08-01T00:00:00Z' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'credit_ledger') {
            return {
              select: () => ({
                eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
              }),
            }
          }
          if (table === 'credit_reservations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        eq: () => ({
                          gt: () => ({
                            maybeSingle: async () => ({ data: null, error: null }),
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const decision = await resolveCommercialAuthorization({
        userId: 'user-1',
        storyId: 'story-v5-paid',
        chapterNumber: 4,
      })

      expect(decision.status).toBe('NEEDS_RESERVATION')
      expect(decision.requiredCredits).toBe(8)
    })

    it('authorizes commercial Bab 4+ when active canonical reservation ref exists', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'feature_credit_costs') {
            return {
              select: () => ({
                in: async () => ({
                  data: [
                    { feature_key: 'story_start', credits_required: 24, is_active: true },
                    { feature_key: 'chapter_unlock', credits_required: 8, is_active: true },
                  ],
                  error: null,
                }),
              }),
            }
          }
          if (table === 'stories') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'story-v5-paid',
                      owner_user_id: 'user-1',
                      story_mode: 'personalized_ai',
                      commercial_origin: 'PAID_START',
                      visibility: 'private',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'account_commercial_states') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { starter_story_id: 'story-starter', starter_claimed_at: '2026-08-01T00:00:00Z' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'credit_ledger') {
            return {
              select: () => ({
                eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
              }),
            }
          }
          if (table === 'credit_reservations') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        eq: () => ({
                          gt: () => ({
                            maybeSingle: async () => ({
                              data: {
                                ref: 'chapter-reservation:user-1:story-v5-paid:4',
                                user_id: 'user-1',
                                story_id: 'story-v5-paid',
                                chapter_number: 4,
                                reservation_kind: 'CHAPTER_UNLOCK',
                                amount: 8,
                                status: 'ACTIVE',
                              },
                              error: null,
                            }),
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockDb as unknown as ReturnType<typeof createAdminClient>)

      const decision = await resolveCommercialAuthorization({
        userId: 'user-1',
        storyId: 'story-v5-paid',
        chapterNumber: 4,
      })

      expect(decision.status).toBe('AUTHORIZED')
      expect(decision.reservationRef).toBe('chapter-reservation:user-1:story-v5-paid:4')
    })
  })

  describe('V5 Atomic Publication & Capture Intent Contracts', () => {
    it('verifies commercial story mode identification for V5 cutover', () => {
      expect(isCommercialStoryMode('personalized_ai')).toBe(true)
      expect(isCommercialStoryMode('premium_instance')).toBe(true)
      expect(isCommercialStoryMode('standard')).toBe(false)
    })
  })
})
