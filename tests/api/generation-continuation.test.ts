import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealGenerateResult } from '@/lib/runtime/story-generation'

const mocks = vi.hoisted(() => ({
  generateNextPersonalizedChapter: vi.fn(),
  after: vi.fn(),
  queryChoiceOutcome: vi.fn(),
  queryChapter: vi.fn(),
  applyChoiceToUserState: vi.fn(),
  getSessionUser: vi.fn(),
  cookieFactory: vi.fn(),
  adminFactory: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    after: mocks.after,
  }
})
vi.mock('@/lib/runtime/personalized-generation', () => ({
  generateNextPersonalizedChapter: mocks.generateNextPersonalizedChapter,
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

const userId = '10000000-0000-4000-8000-000000000001'
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

const metadataRow = {
  id: storyId,
  owner_user_id: userId,
  visibility: 'private',
  story_mode: 'personalized_ai',
}

const readerStateRow = {
  user_id: userId,
  story_id: storyId,
  status: 'BERJALAN',
  current_chapter: 1,
  jejak: [],
  ending_name: null,
  route_state: {
    truth: 1,
    risk: 0,
    secrecy: 0,
    empathy: 0,
    trust: {},
    evidence: [],
    flags: {},
    endingBias: {},
  },
  choice_history: [],
  locked_ending_key: null,
  updated_at: '2026-07-14T00:00:00.000Z',
}

const outcomeRow = {
  story_id: storyId,
  chapter_number: 1,
  choice_id: choiceId,
  consequence: ['Kebenaran mulai terlihat.'],
  next_chapter_number: 2,
  is_ending: false,
  effect_json: {
    routeDeltas: { truth: 2 },
    trustDeltas: {},
    flagsSet: {},
    evidenceAdded: [],
    endingBiasDeltas: {},
    threadTouches: [],
  },
  choice_kind: 'normal',
}

function publishedResult(chapterNumber = 2): RealGenerateResult {
  return { ok: true, chapterNumber, seq: 1, repairAttempts: 0 }
}

function createCookieDb(input?: {
  user?: { id: string } | null
  story?: { data: unknown; error: { message: string } | null }
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: input?.user ?? { id: userId } },
        error: null,
      })),
    },
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) {
        builder[method] = vi.fn(() => builder)
      }
      builder.maybeSingle = vi.fn(async () =>
        input?.story ?? { data: { id: storyId }, error: null },
      )
      return builder
    }),
  }
}

function createAdminDb(input?: {
  tables?: Record<string, Array<{ data: unknown; error: { message: string } | null }>>
  rpc?: { data: unknown; error: { message: string } | null }
}) {
  const tables = input?.tables ?? {}
  const indexes = new Map<string, number>()
  const next = (table: string) => {
    const index = indexes.get(table) ?? 0
    indexes.set(table, index + 1)
    return tables[table]?.[index] ?? { data: null, error: null }
  }
  return {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) {
        builder[method] = vi.fn(() => builder)
      }
      builder.maybeSingle = vi.fn(async () => next(table))
      return builder
    }),
    rpc: vi.fn(async () =>
      input?.rpc ?? {
        data: { outcome: publicOutcome, nextChapterNumber: 2, replayed: false },
        error: null,
      },
    ),
  }
}

function personalizedAdmin() {
  return createAdminDb({
    tables: {
      stories: [{ data: metadataRow, error: null }],
      reader_states: [{ data: readerStateRow, error: null }],
      choice_outcomes: [{ data: outcomeRow, error: null }],
      chapters: [{
        data: {
          story_id: storyId,
          number: 1,
          choices: [{ id: choiceId, label: 'Buka surat itu' }],
        },
        error: null,
      }],
    },
  })
}

function choiceRequest(options?: {
  id?: string
  key?: string | null
  body?: unknown
}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options?.key !== null) headers.set('Idempotency-Key', options?.key ?? idempotencyKey)
  return new Request(
    `http://localhost/api/stories/${encodeURIComponent(options?.id ?? storyId)}/choices`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(options?.body ?? { chapterNumber: 1, choiceId }),
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  mocks.after.mockImplementation(() => undefined)
  mocks.generateNextPersonalizedChapter.mockResolvedValue(publishedResult())
  mocks.cookieFactory.mockResolvedValue(createCookieDb())
  mocks.adminFactory.mockReturnValue(personalizedAdmin())
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
})

afterEach(() => {
  vi.useRealTimers()
})

describe('continuePersonalizedGeneration', () => {
  it('returns nextChapterReady true when generation finishes within wait window', async () => {
    mocks.generateNextPersonalizedChapter.mockResolvedValue(publishedResult(2))
    const { continuePersonalizedGeneration, CONTINUATION_WAIT_MS } = await import(
      '@/lib/api/generation-continuation.server'
    )

    const result = await continuePersonalizedGeneration({
      storyId: `${storyId}:ready`,
      userId,
      chapterNumber: 2,
      triggerChoiceId: choiceId,
    })

    expect(result).toEqual({ nextChapterReady: true })
    expect(CONTINUATION_WAIT_MS).toBe(25_000)
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledOnce()
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledWith({
      storyId: `${storyId}:ready`,
      userId,
      chapterNumber: 2,
      triggerChoiceId: choiceId,
    })
    expect(mocks.after).toHaveBeenCalledOnce()
  })

  it('maps CHAPTER_EXISTS to nextChapterReady true', async () => {
    mocks.generateNextPersonalizedChapter.mockResolvedValue({
      ok: false,
      reason: 'CHAPTER_EXISTS',
    })
    const { continuePersonalizedGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )

    await expect(continuePersonalizedGeneration({
      storyId: `${storyId}:exists`,
      userId,
      chapterNumber: 3,
      triggerChoiceId: choiceId,
    })).resolves.toEqual({ nextChapterReady: true })
  })

  it('returns false on timeout without cancelling shared generation', async () => {
    vi.useFakeTimers()
    let resolveGeneration!: (value: RealGenerateResult) => void
    const generation = new Promise<RealGenerateResult>((resolve) => {
      resolveGeneration = resolve
    })
    mocks.generateNextPersonalizedChapter.mockReturnValue(generation)

    const { continuePersonalizedGeneration, CONTINUATION_WAIT_MS } = await import(
      '@/lib/api/generation-continuation.server'
    )
    const wait = continuePersonalizedGeneration({
      storyId: `${storyId}:timeout`,
      userId,
      chapterNumber: 4,
      triggerChoiceId: choiceId,
    })

    await vi.advanceTimersByTimeAsync(CONTINUATION_WAIT_MS)
    await expect(wait).resolves.toEqual({ nextChapterReady: false })
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledOnce()
    expect(mocks.after).toHaveBeenCalledOnce()

    const afterCb = mocks.after.mock.calls[0]?.[0] as () => Promise<RealGenerateResult>
    const afterPromise = afterCb()
    resolveGeneration(publishedResult(4))
    await expect(afterPromise).resolves.toEqual(publishedResult(4))
    await expect(generation).resolves.toEqual(publishedResult(4))
  })

  it('reuses one shared in-flight promise for same storyId and chapterNumber', async () => {
    let resolveGeneration!: (value: RealGenerateResult) => void
    const generation = new Promise<RealGenerateResult>((resolve) => {
      resolveGeneration = resolve
    })
    mocks.generateNextPersonalizedChapter.mockReturnValue(generation)

    const { continuePersonalizedGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )
    const input = {
      storyId: `${storyId}:shared`,
      userId,
      chapterNumber: 5,
      triggerChoiceId: choiceId,
    }

    const first = continuePersonalizedGeneration(input)
    const second = continuePersonalizedGeneration(input)
    resolveGeneration(publishedResult(5))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { nextChapterReady: true },
      { nextChapterReady: true },
    ])
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledOnce()
    expect(mocks.after).toHaveBeenCalledTimes(2)
  })

  it('treats LEASE_HELD as in progress and returns nextChapterReady false', async () => {
    mocks.generateNextPersonalizedChapter.mockResolvedValue({
      ok: false,
      reason: 'LEASE_HELD',
    })
    const { continuePersonalizedGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )

    await expect(continuePersonalizedGeneration({
      storyId: `${storyId}:lease`,
      userId,
      chapterNumber: 6,
      triggerChoiceId: choiceId,
    })).resolves.toEqual({ nextChapterReady: false })
  })

  it('maps terminal generation failure to nextChapterReady false', async () => {
    mocks.generateNextPersonalizedChapter.mockResolvedValue({
      ok: false,
      reason: 'CANON_MISSING',
    })
    const { continuePersonalizedGeneration } = await import(
      '@/lib/api/generation-continuation.server'
    )

    await expect(continuePersonalizedGeneration({
      storyId: `${storyId}:fail`,
      userId,
      chapterNumber: 7,
      triggerChoiceId: choiceId,
    })).resolves.toEqual({ nextChapterReady: false })
  })

  it('exports stable job key helper', async () => {
    const { continuationJobKey } = await import('@/lib/api/generation-continuation.server')
    expect(continuationJobKey('story-a', 12)).toBe('story-a:12')
  })
})

describe('choice route generation continuation', () => {
  it('returns outcome and nextChapterReady for personalized non-ending next chapter', async () => {
    mocks.generateNextPersonalizedChapter.mockResolvedValue(publishedResult(2))
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: storyId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ outcome: publicOutcome, nextChapterReady: true })
    expect(mocks.generateNextPersonalizedChapter).toHaveBeenCalledWith({
      storyId,
      userId,
      chapterNumber: 2,
      triggerChoiceId: choiceId,
    })
    expect(mocks.after).toHaveBeenCalledOnce()
    expect(JSON.stringify(body)).not.toMatch(
      /effect_json|choice_kind|route_state|choice_history|locked_ending_key|owner_user_id|story_mode|expected_state|ledger|replayed|lease/,
    )
  })

  it('omits nextChapterReady on standard path', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest({
      id: 'demo:standard',
      body: { chapterNumber: 1, choiceId: 'standard-choice' },
    }), { params: Promise.resolve({ id: 'demo%3Astandard' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: publicOutcome })
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('skips continuation for personalized ending outcomes', async () => {
    const endingOutcome = {
      ...publicOutcome,
      nextChapterNumber: null,
      isEnding: true,
    }
    mocks.adminFactory.mockReturnValue(createAdminDb({
      tables: {
        stories: [{ data: metadataRow, error: null }],
        reader_states: [{ data: readerStateRow, error: null }],
        choice_outcomes: [{
          data: {
            ...outcomeRow,
            next_chapter_number: null,
            is_ending: true,
          },
          error: null,
        }],
        chapters: [{
          data: {
            story_id: storyId,
            number: 1,
            choices: [{ id: choiceId, label: 'Buka surat itu' }],
          },
          error: null,
        }],
      },
      rpc: {
        data: { outcome: endingOutcome, nextChapterNumber: null, replayed: false },
        error: null,
      },
    }))
    const { POST } = await import('@/app/api/stories/[id]/choices/route')

    const response = await POST(choiceRequest(), {
      params: Promise.resolve({ id: storyId }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: endingOutcome })
    expect(mocks.generateNextPersonalizedChapter).not.toHaveBeenCalled()
  })
})
