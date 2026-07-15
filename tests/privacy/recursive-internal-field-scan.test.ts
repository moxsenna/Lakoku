import { describe, expect, it } from 'vitest'
import {
  ChapterStatusResponseSchema,
  GetChapterResponseSchema,
  GetStoryResponseSchema,
  ListStoriesResponseSchema,
  SubmitChoiceResponseSchema,
} from '../../packages/contracts/src/reader'

const INTERNAL_KEYS = new Set([
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

  it('treats public status as legitimate and handles null and primitives', () => {
    expect(INTERNAL_KEYS.has('status')).toBe(false)
    expect(findInternalPaths({ status: 'ready', nested: [null, 1, 'ok', false] })).toEqual([])
  })
})
