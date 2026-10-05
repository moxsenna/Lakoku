import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lakoku/db')>()
  return {
    ...actual,
    createAdminClient: mocks.adminFactory,
    getDb: mocks.getDb,
  }
})

import type { StoryCreativeDirection } from '@/lib/onboarding/creative-direction'

function validDirection(): StoryCreativeDirection {
  return {
    version: 1,
    sourceTasteProfileVersion: 2,
    genre: { primary: 'romance', secondary: null },
    preferences: {
      likedConflictIds: ['conflict_secret'],
      softAvoidanceIds: [],
      dramaIntensity: 'balanced',
      pacing: 'balanced',
      languageStyle: 'clear_concise',
      endingBias: 'bittersweet',
    },
    hardBoundaries: [],
    storySetup: {
      coreConflict: {
        id: 'conflict_secret',
        customText: null,
        resolvedFromAuto: false,
      },
      protagonistRole: {
        id: 'role_seeker',
        customText: null,
        resolvedFromAuto: false,
      },
      relationshipFocus: 'relationship_self_growth',
      agencyStyle: 'agency_observe',
    },
    source: 'brainstorm',
    promptContractVersion: 'story-creative-direction-v1',
    createdAt: '2026-07-24T00:00:00.000Z',
  }
}

function chainableDb(handler: (table: string) => { upsert: (...args: unknown[]) => Promise<{ error?: { code?: string; message?: string } | null }> }) {
  return {
    insertInto: vi.fn((table: string) => {
      const h = handler(table)
      return {
        values: vi.fn(() => ({
          onConflict: vi.fn(() => ({
            execute: vi.fn(async () => {
              const res = await h.upsert()
              if (res?.error) {
                const err = new Error(res.error.message)
                Object.assign(err, { code: res.error.code })
                throw err
              }
              return []
            }),
          })),
        })),
      }
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('persistStoryCreativeDirection safety', () => {
  it('writes only story_creative_directions on success', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const touched: string[] = []
    mocks.getDb.mockReturnValue(
      chainableDb((table) => {
        touched.push(table)
        return { upsert }
      }),
    )

    const { persistStoryCreativeDirection } = await import(
      '@/lib/authoring/persist-creative-direction'
    )
    const result = await persistStoryCreativeDirection({
      storyId: 'story-a',
      ownerUserId: 'a1000000-0000-4000-8000-000000000001',
      direction: validDirection(),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.storage).toBe('story_creative_directions')
      expect(result.fingerprint).toMatch(/^[a-f0-9]{16}$/)
    }
    expect(touched).toEqual(['story_creative_directions'])
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('never upserts story_generation_contracts when dedicated table fails', async () => {
    const contractUpsert = vi.fn()
    const dedicatedUpsert = vi.fn().mockResolvedValue({
      error: { code: '42P01', message: 'relation "story_creative_directions" does not exist' },
    })
    const touched: string[] = []
    mocks.getDb.mockReturnValue(
      chainableDb((table) => {
        touched.push(table)
        if (table === 'story_creative_directions') {
          return { upsert: dedicatedUpsert }
        }
        if (table === 'story_generation_contracts') {
          return { upsert: contractUpsert }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    )

    const { persistStoryCreativeDirection } = await import(
      '@/lib/authoring/persist-creative-direction'
    )
    const result = await persistStoryCreativeDirection({
      storyId: 'story-a',
      ownerUserId: 'a1000000-0000-4000-8000-000000000001',
      direction: validDirection(),
    })

    expect(result).toEqual({ ok: false, error: 'TABLE_UNAVAILABLE' })
    expect(touched).toEqual(['story_creative_directions'])
    expect(contractUpsert).not.toHaveBeenCalled()
  })

  it('returns WRITE_FAILED for non-missing-relation errors without contract write', async () => {
    const dedicatedUpsert = vi.fn().mockResolvedValue({
      error: { code: '42501', message: 'permission denied' },
    })
    const contractUpsert = vi.fn()
    mocks.getDb.mockReturnValue(
      chainableDb((table) => {
        if (table === 'story_creative_directions') return { upsert: dedicatedUpsert }
        if (table === 'story_generation_contracts') return { upsert: contractUpsert }
        throw new Error(`unexpected table ${table}`)
      }),
    )

    const { persistStoryCreativeDirection } = await import(
      '@/lib/authoring/persist-creative-direction'
    )
    const result = await persistStoryCreativeDirection({
      storyId: 'story-a',
      ownerUserId: 'a1000000-0000-4000-8000-000000000001',
      direction: validDirection(),
    })

    expect(result).toEqual({ ok: false, error: 'WRITE_FAILED' })
    expect(contractUpsert).not.toHaveBeenCalled()
  })

  it('returns INVALID_DIRECTION for bad payload', async () => {
    mocks.getDb.mockReturnValue(chainableDb(() => {
      throw new Error('db should not be called')
    }))

    const { persistStoryCreativeDirection } = await import(
      '@/lib/authoring/persist-creative-direction'
    )
    const result = await persistStoryCreativeDirection({
      storyId: 'story-a',
      ownerUserId: 'a1000000-0000-4000-8000-000000000001',
      direction: { version: 99 } as unknown as StoryCreativeDirection,
    })

    expect(result).toEqual({ ok: false, error: 'INVALID_DIRECTION' })
  })
})
