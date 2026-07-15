import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChapterStatusResponseSchema,
  ErrorResponseSchema,
  GetChapterResponseSchema,
  GetStoryResponseSchema,
  ListChaptersResponseSchema,
  ListStoriesResponseSchema,
  SubmitChoiceResponseSchema,
  SubmitReportResponseSchema,
} from '../../packages/contracts/src/reader'

const routeMocks = vi.hoisted(() => ({
  listExploreStories: vi.fn(),
  getStory: vi.fn(),
  listChapterMetadatas: vi.fn(),
  getChapter: vi.fn(),
  submitContentReport: vi.fn(),
  createClient: vi.fn(),
  queryChoiceOutcome: vi.fn(),
  queryChapter: vi.fn(),
  applyChoiceToUserState: vi.fn(),
  getSessionUser: vi.fn(),
  continuePersonalizedGeneration: vi.fn(),
  getChapterStatusForUser: vi.fn(),
  createPersonalizedStory: vi.fn(),
  clonePremiumStoryForUser: vi.fn(),
}))

vi.mock('@/lib/api/server', () => ({
  listExploreStories: routeMocks.listExploreStories,
  getStory: routeMocks.getStory,
  listChapterMetadatas: routeMocks.listChapterMetadatas,
  getChapter: routeMocks.getChapter,
}))
vi.mock('@/lib/api/reports', () => ({ submitContentReport: routeMocks.submitContentReport }))
vi.mock('@/lib/supabase/server', () => ({ createClient: routeMocks.createClient }))
vi.mock('@lakoku/contracts', async () => import('../../packages/contracts/src/index'))
vi.mock('@/lib/api/queries', () => ({
  queryChoiceOutcome: routeMocks.queryChoiceOutcome,
  queryChapter: routeMocks.queryChapter,
}))
vi.mock('@/lib/api/user-state', () => ({
  applyChoiceToUserState: routeMocks.applyChoiceToUserState,
  getSessionUser: routeMocks.getSessionUser,
}))
vi.mock('@/lib/api/personalized-choice.server', () => ({
  applyPersonalizedChoice: vi.fn(),
  PersonalizedChoiceError: class PersonalizedChoiceError extends Error {},
}))
vi.mock('@/lib/api/generation-continuation.server', () => ({
  continuePersonalizedGeneration: routeMocks.continuePersonalizedGeneration,
}))
vi.mock('@/lib/api/chapter-status.server', () => ({
  getChapterStatusForUser: routeMocks.getChapterStatusForUser,
  ChapterStatusError: class ChapterStatusError extends Error {},
}))
vi.mock('@/lib/api/personalized-stories.server', () => ({
  createPersonalizedStory: routeMocks.createPersonalizedStory,
  PersonalizedStoryError: class PersonalizedStoryError extends Error {},
}))
vi.mock('@/lib/api/premium-clone.server', () => ({
  clonePremiumStoryForUser: routeMocks.clonePremiumStoryForUser,
  PremiumCloneError: class PremiumCloneError extends Error {},
}))

const INTERNAL_KEYS = new Set([
  'effect',
  'effectJson',
  'effect_json',
  'routeState',
  'route_state',
  'choiceHistory',
  'choice_history',
  'storyContract',
  'story_contract',
  'storyContractJson',
  'story_contract_json',
  'plotDebts',
  'plot_debts',
  'plotDebtsJson',
  'plot_debts_json',
  'endingCandidates',
  'ending_candidates',
  'endingCandidatesJson',
  'ending_candidates_json',
  'endingLock',
  'ending_lock',
  'endingLockJson',
  'ending_lock_json',
  'lockedEnding',
  'locked_ending',
  'lockedEndingKey',
  'locked_ending_key',
  'ownerUserId',
  'owner_user_id',
  'sourceStoryId',
  'source_story_id',
  'storyMode',
  'story_mode',
  'generationStatus',
  'generation_status',
  'choiceKind',
  'choice_kind',
  'reservationRequest',
  'reservation_request',
  'requestHash',
  'request_hash',
  'requestKey',
  'request_key',
  'idempotencyKey',
  'idempotency_key',
  'requestError',
  'request_error',
  'errorCode',
  'error_code',
  'leaseId',
  'lease_id',
  'attempt',
  'attempts',
  'sqlstate',
])

function findInternalPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => findInternalPaths(child, `${path}[${index}]`))
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`
    return [
      ...(INTERNAL_KEYS.has(key) ? [childPath] : []),
      ...findInternalPaths(child, childPath),
    ]
  })
}

const storySummary = {
  id: 'demo:arsip-hujan',
  title: 'Arsip Hujan',
  cover: '/covers/arsip-hujan.webp',
  tagline: 'Rahasia lama menunggu dibuka.',
  role: 'Maya',
  tropes: ['Rahasia Keluarga'] as const,
  totalChapters: 50,
  currentChapter: 2,
  status: 'BERJALAN' as const,
  endingName: 'Arsip Dibuka',
}

const publicShapes = {
  explore: ListStoriesResponseSchema.parse({ stories: [storySummary] }),
  detail: GetStoryResponseSchema.parse({
    story: { ...storySummary, synopsis: 'Maya memburu kebenaran.', jejak: [] },
  }),
  chapter: GetChapterResponseSchema.parse({
    chapter: {
      storyId: storySummary.id,
      number: 2,
      title: 'Surat Basah',
      paragraphs: ['Maya membuka surat yang tersimpan di arsip.'],
      choicePrompt: 'Apa langkah berikutnya?',
      choices: [{ id: 'read', label: 'Baca surat', hint: 'Nama pengirim mungkin terlihat.' }],
    },
  }),
  chapters: ListChaptersResponseSchema.parse({
    chapters: [{ number: 1, title: 'Pintu Arsip' }, { number: 2, title: 'Surat Basah' }],
    maxReachedChapter: 2,
  }),
  report: SubmitReportResponseSchema.parse({ ok: true, reportId: 'report-1' }),
  error: ErrorResponseSchema.parse({ error: 'Cerita tidak ditemukan.' }),
  choice: SubmitChoiceResponseSchema.parse({
    outcome: {
      storyId: storySummary.id,
      chapterNumber: 2,
      choiceId: 'read',
      consequence: ['Nama lama akhirnya terlihat.'],
      nextChapterNumber: 3,
      isEnding: false,
    },
    nextChapterReady: true,
  }),
  status: ChapterStatusResponseSchema.parse({ status: 'ready', chapterNumber: 3 }),
  personalizedCreate: {
    storyId: 'ai:personalized:11111111-1111-4111-8111-111111111111',
    redirectUrl: '/baca/ai%3Apersonalized%3A11111111-1111-4111-8111-111111111111?bab=1',
  },
  premiumCloneFirst: {
    storyId: 'ai:premium:rain-archive:11111111-1111-4111-8111-111111111111',
    redirectUrl: '/baca/ai%3Apremium%3Arain-archive%3A11111111-1111-4111-8111-111111111111?bab=1',
    replayed: false,
  },
  premiumCloneReplay: {
    storyId: 'ai:premium:rain-archive:11111111-1111-4111-8111-111111111111',
    redirectUrl: '/baca/ai%3Apremium%3Arain-archive%3A11111111-1111-4111-8111-111111111111?bab=1',
    replayed: true,
  },
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  routeMocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
        error: null,
      })),
    },
  })
  routeMocks.getSessionUser.mockResolvedValue(null)
  routeMocks.queryChoiceOutcome.mockResolvedValue(publicShapes.choice.outcome)
  routeMocks.queryChapter.mockResolvedValue(publicShapes.chapter.chapter)
  routeMocks.applyChoiceToUserState.mockResolvedValue(undefined)
  routeMocks.getChapterStatusForUser.mockResolvedValue('ready')
  routeMocks.createPersonalizedStory.mockResolvedValue({
    ...publicShapes.personalizedCreate,
    replayed: false,
  })
  routeMocks.clonePremiumStoryForUser.mockResolvedValue(publicShapes.premiumCloneFirst)
})

describe('reader route response privacy', () => {
  it('scans actual explore, detail, chapter, list, and report response bodies before Zod can strip fields', async () => {
    routeMocks.listExploreStories.mockResolvedValue([{ ...storySummary }])
    routeMocks.getStory.mockResolvedValue({
      ...storySummary,
      synopsis: 'Maya memburu kebenaran.',
      jejak: [],
    })
    routeMocks.getChapter.mockResolvedValue({
      storyId: storySummary.id,
      number: 2,
      title: 'Surat Basah',
      paragraphs: ['Maya membuka surat yang tersimpan di arsip.'],
      choicePrompt: 'Apa langkah berikutnya?',
      choices: [{ id: 'read', label: 'Baca surat', hint: 'Nama pengirim mungkin terlihat.' }],
    })
    routeMocks.listChapterMetadatas.mockResolvedValue({
      chapters: [{ number: 1, title: 'Pintu Arsip' }, { number: 2, title: 'Surat Basah' }],
      maxReachedChapter: 2,
    })
    routeMocks.submitContentReport.mockResolvedValue({ reportId: 'report-1' })

    const [{ GET: explore }, { GET: detail }, { GET: chapter }, { GET: chapters }, { POST: report }] = await Promise.all([
      import('@/app/api/stories/route'),
      import('@/app/api/stories/[id]/route'),
      import('@/app/api/stories/[id]/chapters/[number]/route'),
      import('@/app/api/stories/[id]/chapters/route'),
      import('@/app/api/stories/[id]/report/route'),
    ])

    const bodies = {
      explore: await responseBody(await explore()),
      detail: await responseBody(await detail(new Request('http://localhost/api/stories/demo'), {
        params: Promise.resolve({ id: storySummary.id }),
      })),
      chapter: await responseBody(await chapter(
        new Request('http://localhost/api/stories/demo/chapters/2'),
        { params: Promise.resolve({ id: storySummary.id, number: '2' }) },
      )),
      chapters: await responseBody(await chapters(
        new Request('http://localhost/api/stories/demo/chapters'),
        { params: Promise.resolve({ id: storySummary.id }) },
      )),
      report: await responseBody(await report(
        new Request('http://localhost/api/stories/demo/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterNumber: 2, category: 'ALUR_MEMBINGUNGKAN' }),
        }),
        { params: Promise.resolve({ id: storySummary.id }) },
      )),
    }

    expect(bodies).toEqual({
      explore: publicShapes.explore,
      detail: publicShapes.detail,
      chapter: publicShapes.chapter,
      chapters: publicShapes.chapters,
      report: publicShapes.report,
    })
    expect(findInternalPaths(bodies)).toEqual([])
  })

  it('scans route error bodies for all reader-facing read/report endpoints', async () => {
    routeMocks.listExploreStories.mockRejectedValue(new Error('private list failure'))
    routeMocks.getStory.mockResolvedValue(null)
    routeMocks.getChapter.mockResolvedValue(null)
    routeMocks.listChapterMetadatas.mockRejectedValue(new Error('private chapter list failure'))
    routeMocks.submitContentReport.mockRejectedValue(new Error('private report failure'))

    const [{ GET: explore }, { GET: detail }, { GET: chapter }, { GET: chapters }, { POST: report }] = await Promise.all([
      import('@/app/api/stories/route'),
      import('@/app/api/stories/[id]/route'),
      import('@/app/api/stories/[id]/chapters/[number]/route'),
      import('@/app/api/stories/[id]/chapters/route'),
      import('@/app/api/stories/[id]/report/route'),
    ])

    const bodies = [
      await responseBody(await explore()),
      await responseBody(await detail(new Request('http://localhost/api/stories/missing'), {
        params: Promise.resolve({ id: 'missing' }),
      })),
      await responseBody(await chapter(
        new Request('http://localhost/api/stories/missing/chapters/2'),
        { params: Promise.resolve({ id: 'missing', number: '2' }) },
      )),
      await responseBody(await chapters(
        new Request('http://localhost/api/stories/missing/chapters'),
        { params: Promise.resolve({ id: 'missing' }) },
      )),
      await responseBody(await report(
        new Request('http://localhost/api/stories/missing/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterNumber: 2, category: 'ALUR_MEMBINGUNGKAN' }),
        }),
        { params: Promise.resolve({ id: 'missing' }) },
      )),
    ]

    expect(bodies.every((body) => ErrorResponseSchema.safeParse(body).success)).toBe(true)
    expect(findInternalPaths(bodies)).toEqual([])
  })

  it('scans actual choice, status, personalized create, and premium clone route bodies', async () => {
    const [{ POST: choice }, { GET: status }, { POST: create }, { POST: clone }] = await Promise.all([
      import('@/app/api/stories/[id]/choices/route'),
      import('@/app/api/stories/[id]/chapters/[number]/status/route'),
      import('@/app/api/stories/personalized/route'),
      import('@/app/api/stories/premium/[templateId]/clone/route'),
    ])

    const choiceBody = await responseBody(await choice(
      new Request('http://localhost/api/stories/demo/choices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterNumber: 2, choiceId: 'read' }),
      }),
      { params: Promise.resolve({ id: storySummary.id }) },
    ))
    const statusBody = await responseBody(await status(
      new Request('http://localhost/api/stories/demo/chapters/3/status'),
      { params: Promise.resolve({ id: storySummary.id, number: '3' }) },
    ))
    const createBody = await responseBody(await create(new Request(
      'http://localhost/api/stories/personalized',
      { method: 'POST', headers: { 'Idempotency-Key': 'create-1' } },
    )))
    const cloneBody = await responseBody(await clone(new Request(
      'http://localhost/api/stories/premium/rain-archive/clone',
      { method: 'POST', headers: { 'Idempotency-Key': 'clone-1' }, body: '{}' },
    ), { params: Promise.resolve({ templateId: 'premium:rain-archive' }) }))

    expect({ choiceBody, statusBody, createBody, cloneBody }).toEqual({
      choiceBody: { outcome: publicShapes.choice.outcome },
      statusBody: publicShapes.status,
      createBody: publicShapes.personalizedCreate,
      cloneBody: publicShapes.premiumCloneFirst,
    })
    expect(findInternalPaths({ choiceBody, statusBody, createBody, cloneBody })).toEqual([])
  })
})

describe('recursive public response internal-field scanner', () => {
  it('reports exact paths for deliberately nested leaks', () => {
    const leaked = {
      stories: [{
        id: 'demo:aman',
        chapters: [{ payload: { effect_json: {}, storyContractJson: {} } }],
      }],
      meta: { debug: { ending_lock_json: {}, leaseId: 'private-lease' } },
    }

    expect(findInternalPaths(leaked)).toEqual([
      '$.stories[0].chapters[0].payload.effect_json',
      '$.stories[0].chapters[0].payload.storyContractJson',
      '$.meta.debug.ending_lock_json',
      '$.meta.debug.leaseId',
    ])
  })

  it('keeps representative reader responses free of internal keys at every depth', () => {
    expect(findInternalPaths(publicShapes)).toEqual([])
  })

  it('flags semantically internal effect objects without blocking public prose words', () => {
    expect(findInternalPaths({ outcome: { effect: { routeDeltas: {} } } })).toEqual([
      '$.outcome.effect',
    ])
    expect(findInternalPaths({
      title: 'Efek Rumah Kaca',
      tagline: 'Pilihanmu memberi effect dramatis.',
      status: 'ready',
    })).toEqual([])
  })

  it('treats public status as legitimate and handles null and primitives', () => {
    expect(INTERNAL_KEYS.has('status')).toBe(false)
    expect(findInternalPaths({ status: 'ready', nested: [null, 1, 'ok', false] })).toEqual([])
  })
})
