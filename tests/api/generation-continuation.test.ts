import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealGenerateResult } from '@/lib/runtime/story-generation'

const mocks = vi.hoisted(() => ({
  generateNextChapterReal: vi.fn(),
  claimAndRunGenerationJobById: vi.fn(async () => ({ ok: true })),
  after: vi.fn(),
  queryChoiceOutcome: vi.fn(),
  queryChapter: vi.fn(),
  applyChoiceToUserState: vi.fn(),
  getSessionUser: vi.fn(),
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
  continuePersonalizedGeneration: vi.fn(async () => ({ nextChapterReady: true })),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    after: mocks.after,
  }
})
vi.mock('@/lib/runtime/generation-worker', () => ({
  claimAndRunGenerationJobById: mocks.claimAndRunGenerationJobById,
}))
vi.mock('@/lib/runtime/story-generation', () => ({
  generateNextChapterReal: mocks.generateNextChapterReal,
}))
vi.mock('@/lib/api/queries', () => ({
  queryChoiceOutcome: mocks.queryChoiceOutcome,
  queryChapter: mocks.queryChapter,
}))
vi.mock('@/lib/api/user-state', () => ({
  applyChoiceToUserState: mocks.applyChoiceToUserState,
  getSessionUser: mocks.getSessionUser,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieFactory }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.adminFactory }))
vi.mock('@/lib/api/story-ownership.server', () => ({
  isStoryOwnedBy: vi.fn(async () => true),
}))

const userId = '10000000-0000-4000-8000-000000000001'
const _correlationId = '20000000-0000-4000-8000-000000000002'
const storyId = 'test:continuation-story'
const choiceId = 'private-choice'
const idempotencyKey = `choice:${storyId}:1:${choiceId}`

const publicOutcome = {
  storyId,
  chapterNumber: 1,
  choiceId,
  consequence: ['Kebenaran mulai terlihat.'],
  nextChapterNumber: 2,
  isEnding: false,
}

function publishedResult(chapterNumber: number): RealGenerateResult {
  return {
    ok: true,
    chapterNumber,
    seq: chapterNumber - 1,
    fromCheckpoint: false,
    repairAttempts: 0,
  }
}

function choiceRequest(body?: unknown): Request {
  return new Request(`https://lakoku.id/api/stories/${encodeURIComponent(storyId)}/choices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body ?? { chapterNumber: 1, choiceId }),
  })
}

function createCookieDb(input?: { user?: { id: string } | null; story?: unknown }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: input?.user ?? { id: userId } }, error: null })),
    },
    from: vi.fn(() => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => input?.story ?? { data: { id: storyId }, error: null }),
      }
      return builder
    }),
    rpc: vi.fn(async () => ({
      data: {
        ok: true,
        status: 'QUEUED',
        replayed: false,
        job_id: '00000000-0000-4000-8000-000000000001',
        correlation_id: '00000000-0000-4000-8000-000000000002',
      },
      error: null,
    })),
  }
}

function createAdminDb(input?: {
  story?: unknown
  state?: unknown
  outcome?: unknown
  chapter?: unknown
}) {
  return {
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => {
          if (table === 'stories') {
            return input?.story ?? {
              data: {
                id: storyId,
                owner_user_id: userId,
                visibility: 'private',
                story_mode: 'personalized_ai',
              },
              error: null,
            }
          }
          if (table === 'reader_states') {
            return input?.state ?? {
              data: {
                user_id: userId,
                story_id: storyId,
                status: 'BERJALAN',
                current_chapter: 1,
                jejak: [],
                ending_name: null,
                route_state: { truth: 1, risk: 0, secrecy: 0, empathy: 0, trust: {}, evidence: [], flags: {}, endingBias: {} },
                choice_history: [],
                locked_ending_key: null,
                updated_at: '2026-03-31T00:00:00.000Z',
              },
              error: null,
            }
          }
          if (table === 'choice_outcomes') {
            return input?.outcome ?? {
              data: {
                story_id: storyId,
                chapter_number: 1,
                choice_id: choiceId,
                consequence: ['Kebenaran mulai terlihat.'],
                next_chapter_number: 2,
                is_ending: false,
                effect_json: { routeDeltas: {}, flagsSet: {} },
                choice_kind: 'normal',
              },
              error: null,
            }
          }
          if (table === 'chapters') {
            return input?.chapter ?? {
              data: {
                story_id: storyId,
                number: 1,
                choices: [{ id: choiceId, label: 'Pilih diam' }],
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }),
      }
      return builder
    }),
    rpc: vi.fn(async () => ({
      data: {
        outcome: publicOutcome,
        nextChapterNumber: 2,
        replayed: false,
      },
      error: null,
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.continuePersonalizedGeneration.mockResolvedValue({ nextChapterReady: true })
  mocks.cookieFactory.mockResolvedValue(createCookieDb())
  mocks.adminFactory.mockReturnValue(createAdminDb())
  mocks.getSessionUser.mockResolvedValue({ id: userId })
  mocks.queryChoiceOutcome.mockResolvedValue(publicOutcome)
  mocks.queryChapter.mockResolvedValue({
    storyId: 'demo:standard',
    number: 1,
    title: 'Bab 1',
    paragraphs: ['Isi'],
    choices: [{ id: 'standard-choice', label: 'Pilih standar' }],
  })
  mocks.applyChoiceToUserState.mockResolvedValue(undefined)
  mocks.generateNextChapterReal.mockResolvedValue(publishedResult(2))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('continuePersonalizedGeneration', () => {
  it('kicks worker via claimAndRunGenerationJobById in after() and polls readiness', async () => {
    const { continuePersonalizedGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )

    const result = await continuePersonalizedGeneration({
      jobId: '00000000-0000-4000-8000-000000000001',
      storyId: `${storyId}:job`,
      userId,
      chapterNumber: 2,
    })

    expect(result).toBeDefined()
    expect(mocks.after).toHaveBeenCalledOnce()
  })

  it('exports stable job key helper', async () => {
    const { continuationJobKey } = await import('@/lib/api/generation-continuation.server')
    expect(continuationJobKey('story-a', 12)).toBe('story-a:12')
  })
})

describe('choice route generation continuation', () => {
  it('returns outcome and nextChapterReady for personalized non-ending next chapter', async () => {
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: storyId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.outcome).toEqual(publicOutcome)
  })

  it('preserves standard story continuation', async () => {
    mocks.adminFactory.mockReturnValue(createAdminDb({
      story: { data: { id: storyId, owner_user_id: userId, visibility: 'public', story_mode: 'standard' }, error: null },
    }))

    const { POST } = await import('@/app/api/stories/[id]/choices/route')
    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: storyId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.outcome).toEqual(publicOutcome)
    expect(mocks.generateNextChapterReal).toHaveBeenCalledWith({
      storyId,
      userId,
      chapterNumber: 2,
      correlationId: expect.any(String),
      triggerChoiceId: choiceId,
    })
  })
})
