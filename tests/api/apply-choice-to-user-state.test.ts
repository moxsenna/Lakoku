import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChoiceOutcome } from '@/packages/contracts/src/reader'

const mocks = vi.hoisted(() => ({
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/supabase/env', () => ({
  requireSupabaseAnonKey: () => 'anon-key',
  requireSupabaseUrl: () => 'https://example.supabase.co',
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map()),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const STORY_ID = 'pulang-ke-tanah-yang-masih-marah-o9bple'

describe('applyChoiceToUserState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates choice_history and route_state on reader_states', async () => {
    let upsertPayload: Record<string, unknown> | null = null

    mocks.cookieFactory.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: USER_ID } },
          error: null,
        })),
      },
    })

    mocks.adminFactory.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'reader_states') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({
              data: {
                status: 'BERJALAN',
                current_chapter: 1,
                jejak: [],
                ending_name: null,
                route_state: { truth: 0, risk: 0, secrecy: 0, empathy: 0 },
                choice_history: [],
              },
              error: null,
            })),
            upsert: vi.fn(async (payload: Record<string, unknown>) => {
              upsertPayload = payload
              return { error: null }
            }),
          }
        }
        if (table === 'choice_outcomes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({
              data: {
                effect_json: {
                  routeDeltas: { risk: 5, truth: 2, empathy: -1 },
                  trustDeltas: { 'char:pak-darsono': -2 },
                  flagsSet: { met_penagih: true },
                },
              },
              error: null,
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { applyChoiceToUserState } = await import('@/lib/api/user-state')

    const outcome: ChoiceOutcome = {
      storyId: STORY_ID,
      chapterNumber: 1,
      choiceId: 'chapter-1-choice-1',
      consequence: ['Nara langsung berhadapan dengan penagih misterius.'],
      nextChapterNumber: 2,
      isEnding: false,
    }

    await applyChoiceToUserState(
      STORY_ID,
      1,
      'Buka pintu dan hadapi pria yang menagih surat itu',
      outcome,
    )

    expect(upsertPayload).not.toBeNull()
    expect(upsertPayload!.user_id).toBe(USER_ID)
    expect(upsertPayload!.story_id).toBe(STORY_ID)
    expect(upsertPayload!.current_chapter).toBe(2)
    expect(upsertPayload!.status).toBe('BERJALAN')

    // Verify choice_history is populated
    const history = upsertPayload!.choice_history as Array<Record<string, unknown>>
    expect(history).toHaveLength(1)
    expect(history[0].chapterNumber).toBe(1)
    expect(history[0].choiceId).toBe('chapter-1-choice-1')
    expect(history[0].label).toBe('Buka pintu dan hadapi pria yang menagih surat itu')
    expect(history[0].consequence).toEqual(['Nara langsung berhadapan dengan penagih misterius.'])
    expect(history[0].effectSummary).toMatchObject({
      risk: 5,
      truth: 2,
      empathy: -1,
      flagsSet: ['met_penagih'],
    })

    // Verify route_state is updated
    const route = upsertPayload!.route_state as Record<string, unknown>
    expect(route.risk).toBe(5)
    expect(route.truth).toBe(2)
  })

  it('no-ops cleanly when user is not authenticated', async () => {
    let upsertCalled = false

    mocks.cookieFactory.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: null,
        })),
      },
    })

    mocks.adminFactory.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn(async () => {
          upsertCalled = true
          return { error: null }
        }),
      })),
    })

    const { applyChoiceToUserState } = await import('@/lib/api/user-state')

    const outcome: ChoiceOutcome = {
      storyId: STORY_ID,
      chapterNumber: 1,
      choiceId: 'chapter-1-choice-1',
      consequence: ['Nara langsung berhadapan dengan penagih misterius.'],
      nextChapterNumber: 2,
      isEnding: false,
    }

    await applyChoiceToUserState(
      STORY_ID,
      1,
      'Buka pintu dan hadapi pria yang menagih surat itu',
      outcome,
    )

    expect(upsertCalled).toBe(false)
  })
})
