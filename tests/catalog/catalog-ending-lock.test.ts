import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChoiceOutcome } from '@/packages/contracts/src/reader'

const mockState = {
  currentUser: { id: 'u-reader-1', email: 'reader1@example.com', name: 'Reader 1' } as { id: string; email?: string; name?: string } | null,
  readerState: null as Record<string, unknown> | null,
  catalogContract: null as Record<string, unknown> | null,
  outcomeRows: null as Array<{ effect_json: Record<string, unknown> }> | null,
  upsertedValues: null as Record<string, unknown> | null,
  upsertedUpdateSet: null as Record<string, unknown> | null,
}

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => {
        if (!mockState.currentUser) return null
        return { user: mockState.currentUser }
      }),
    },
  },
}))

vi.mock('@/lib/api/user-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/user-state')>()
  return {
    ...actual,
    getSessionUser: vi.fn(async () => mockState.currentUser),
  }
})

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => ({
      select: () => {
        const query = {
          where: () => query,
          limit: () => query,
          execute: async () => {
            if (table === 'reader_states') return mockState.readerState ? [mockState.readerState] : []
            if (table === 'catalog_stories') return mockState.catalogContract ? [mockState.catalogContract] : []
            if (table === 'choice_outcomes') return mockState.outcomeRows ?? [{ effect_json: { endingBiasDeltas: { ending_a: 5 } } }]
            return []
          },
        }
        return query
      },
    }),
    insertInto: () => ({
      values: (vals: Record<string, unknown>) => {
        mockState.upsertedValues = vals
        return {
          onConflict: (ocFn: (oc: unknown) => unknown) => {
            const fakeEb = {
              fn: {
                coalesce: (col: string, fallback: unknown) => ({ type: 'coalesce', col, fallback }),
              },
              ref: (refCol: string) => ({ type: 'ref', refCol }),
              val: (val: unknown) => ({ type: 'val', val }),
            }
            const ocHelper = {
              columns: () => ocHelper,
              doUpdateSet: (setter: unknown) => {
                const updateSetObj =
                  typeof setter === 'function'
                    ? (setter as (eb: unknown) => Record<string, unknown>)(fakeEb)
                    : (setter as Record<string, unknown>)
                mockState.upsertedUpdateSet = updateSetObj
                return { execute: async () => [] }
              },
              execute: async () => [],
            }
            const res = ocFn(ocHelper)
            return (res as { execute: () => Promise<unknown[]> }) ?? ocHelper
          },
        }
      },
    }),
  }),
  single: async (promise: Promise<unknown[]>) => ({ data: (await promise)[0] ?? null, error: null }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
}))

describe('applyChoiceToUserState ending lock for catalog', () => {
  const contractFixture = {
    closureRunway: {
      endingLockChapter: 45,
    },
    endingCandidates: [
      {
        key: 'ending_a',
        name: 'Ending Damai',
        kind: 'main' as const,
        condition: 'Raka memilih jalur damai.',
        requiredClosure: ['Konflik lereng Lawu terselesaikan dengan damai.'],
        blockingConditions: [],
      },
      {
        key: 'ending_b',
        name: 'Ending Gelap',
        kind: 'main' as const,
        condition: 'Raka memilih jalur balas dendam.',
        requiredClosure: ['Raka membalas pengkhianatan Arya.'],
        blockingConditions: [],
      },
      {
        key: 'ending_secret',
        name: 'Ending Rahasia',
        kind: 'secret' as const,
        condition: 'Raka mengungkap rahasia terdalam.',
        requiredClosure: ['Misteri kuno terbongkar seutuhnya.'],
        blockingConditions: [],
      },
    ],
  }

  beforeEach(() => {
    mockState.currentUser = { id: 'u-reader-1', email: 'reader1@example.com', name: 'Reader 1' }
    mockState.readerState = null
    mockState.catalogContract = { contract_json: contractFixture }
    mockState.outcomeRows = null
    mockState.upsertedValues = null
    mockState.upsertedUpdateSet = null
  })

  it('locks ending at Bab 44 choice using coalesce to prevent overwrite races', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-1',
      consequence: ['Keputusan besar Bab 44.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilihan 1', outcome)

    expect(mockState.upsertedValues).not.toBeNull()
    expect(mockState.upsertedValues?.locked_ending_key).toBe('ending_a')
    // Asserts update uses coalesce to preserve existing lock
    expect(mockState.upsertedUpdateSet?.locked_ending_key).toEqual({
      type: 'coalesce',
      col: 'reader_states.locked_ending_key',
      fallback: { type: 'ref', refCol: 'excluded.locked_ending_key' },
    })
  })

  it('does not mutate locked_ending_key if already locked', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    mockState.readerState = {
      status: 'BERJALAN',
      current_chapter: 44,
      jejak: [],
      ending_name: null,
      route_state: { endingBias: { ending_b: 10 } },
      choice_history: [],
      locked_ending_key: 'ending_secret',
    }

    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-retry',
      consequence: ['Keputusan ulang Bab 44.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilihan Ulang', outcome)

    expect(mockState.upsertedValues?.locked_ending_key).toBe('ending_secret')
  })

  it('computes lock from route_state AFTER merging Bab-44 choice effect', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    mockState.readerState = {
      status: 'BERJALAN',
      current_chapter: 44,
      jejak: [],
      ending_name: null,
      route_state: { endingBias: { ending_a: 5, ending_b: 0 } },
      choice_history: [],
      locked_ending_key: null,
    }
    // Effect of Bab-44 choice pushes ending_b by 10, overtaking ending_a (total: ending_b 10 > ending_a 5)
    mockState.outcomeRows = [{ effect_json: { endingBiasDeltas: { ending_b: 10 } } }]

    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-b',
      consequence: ['Pilihan menuju Ending B.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilih B', outcome)

    expect(mockState.upsertedValues?.locked_ending_key).toBe('ending_b')
  })

  it('logs CATALOG_CONTRACT_SNAPSHOT_INVALID and leaves lock null when snapshot schema fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockState.catalogContract = { contract_json: { invalid: true } }
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')

    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-1',
      consequence: ['Keputusan Bab 44.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilihan 1', outcome)

    expect(errorSpy).toHaveBeenCalledWith('CATALOG_CONTRACT_SNAPSHOT_INVALID', expect.anything())
    // Lock is left null so subsequent retry can succeed
    expect(mockState.upsertedValues?.locked_ending_key).toBeNull()
    errorSpy.mockRestore()
  })

  it('leaves lock null for non-catalog stories with zero behavior change', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    const outcome: ChoiceOutcome = {
      storyId: 'standard-story-xyz',
      chapterNumber: 44,
      choiceId: 'choice-44-standard',
      consequence: ['Pilihan cerita standar.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('standard-story-xyz', 44, 'Pilihan Standar', outcome)

    expect(mockState.upsertedValues).not.toBeNull()
    expect(mockState.upsertedValues?.locked_ending_key).toBeNull()
  })

  it('does not lock on catalog story before Bab 44 (e.g. Bab 43)', async () => {
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 43,
      choiceId: 'choice-43-1',
      consequence: ['Pilihan Bab 43.'],
      nextChapterNumber: 44,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 43, 'Pilihan 43', outcome)

    expect(mockState.upsertedValues).not.toBeNull()
    expect(mockState.upsertedValues?.locked_ending_key).toBeNull()
  })

  it('guest reader (no user session) never writes to database', async () => {
    mockState.currentUser = null
    const { applyChoiceToUserState } = await import('@/lib/api/user-state')
    const outcome: ChoiceOutcome = {
      storyId: 'catalog:novel-1',
      chapterNumber: 44,
      choiceId: 'choice-44-guest',
      consequence: ['Pilihan Tamu.'],
      nextChapterNumber: 45,
      isEnding: false,
    }

    await applyChoiceToUserState('catalog:novel-1', 44, 'Pilihan Tamu', outcome)

    expect(mockState.upsertedValues).toBeNull()
    expect(mockState.upsertedUpdateSet).toBeNull()
  })
})
