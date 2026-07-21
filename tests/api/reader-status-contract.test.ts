import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ChapterGenerationStatusSchema,
  ChapterStatusResponseSchema,
  SubmitChoiceResponseSchema,
  type ChoiceOutcome,
} from '../../packages/contracts/src/reader'
import {
  getChapterGenerationStatus,
  submitChoice,
  submitChoiceWithReadiness,
} from '@/lib/api/client'
import {
  recordPendingChoice,
  retryPendingChoiceWithReadiness,
} from '@/lib/api/pending-choice'

const values = new Map<string, string>()
const storageMock = {
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  removeItem: (key: string) => values.delete(key),
  setItem: (key: string, value: string) => values.set(key, value),
}

const outcome: ChoiceOutcome = {
  storyId: 'story/id',
  chapterNumber: 1,
  choiceId: 'choice-1',
  consequence: ['Pintu berikutnya terbuka.'],
  nextChapterNumber: 2,
  isEnding: false,
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('window', { localStorage: storageMock })
  storageMock.clear()
})

describe('reader chapter status contracts', () => {
  it('accepts only reader-safe chapter generation statuses', () => {
    expect(ChapterGenerationStatusSchema.options).toEqual(['ready', 'generating', 'failed'])
    expect(ChapterGenerationStatusSchema.safeParse('queued').success).toBe(false)
  })

  it('requires exact public status fields', () => {
    expect(ChapterStatusResponseSchema.parse({
      status: 'ready',
      chapterNumber: 2,
    })).toEqual({ status: 'ready', chapterNumber: 2 })

    expect(ChapterStatusResponseSchema.safeParse({
      status: 'generating',
      chapterNumber: 2,
      lease: { id: 'internal' },
    }).success).toBe(false)
    expect(ChapterStatusResponseSchema.safeParse({
      status: 'ready',
      chapterNumber: 0,
    }).success).toBe(false)
  })

  it('accepts optional readiness and rejects internal choice fields', () => {
    expect(SubmitChoiceResponseSchema.parse({ outcome })).toEqual({ outcome })
    expect(SubmitChoiceResponseSchema.parse({
      outcome,
      nextChapterReady: false,
    })).toEqual({ outcome, nextChapterReady: false })
    expect(SubmitChoiceResponseSchema.safeParse({
      outcome,
      nextChapterReady: true,
      replayed: true,
    }).success).toBe(false)
  })
})

describe('reader status API client', () => {
  it('keeps submitChoice outcome-only while exposing readiness envelope', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome,
        nextChapterReady: false,
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const legacyResult = submitChoice('story/id', 1, 'choice-1')
    expectTypeOf(legacyResult).toEqualTypeOf<Promise<ChoiceOutcome>>()
    await expect(legacyResult).resolves.toEqual(outcome)
    await expect(submitChoiceWithReadiness('story/id', 1, 'choice-1')).resolves.toEqual({
      outcome,
      nextChapterReady: false,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/stories/story%2Fid/choices',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('fetches encoded exact chapter status and parses response schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'generating', chapterNumber: 7 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getChapterGenerationStatus('private/story id', 7)).resolves.toEqual({
      status: 'generating',
      chapterNumber: 7,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stories/private%2Fstory%20id/chapters/7/status',
      {
        signal: undefined,
        credentials: 'same-origin',
        cache: 'no-store',
      },
    )
  })

  it('passes an optional AbortSignal to the active status request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'generating', chapterNumber: 7 }), { status: 200 }),
    )
    const controller = new AbortController()
    vi.stubGlobal('fetch', fetchMock)

    await getChapterGenerationStatus('story-id', 7, controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stories/story-id/chapters/7/status',
      {
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      },
    )
  })

  it.each([
    [new Response('private database error', { status: 500 })],
    [new Response(JSON.stringify({
      status: 'ready',
      chapterNumber: 2,
      owner_user_id: 'private-user',
    }), { status: 200 })],
  ])('returns reader-safe status errors without leaking response details', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(getChapterGenerationStatus('story-id', 2)).rejects.toThrow(
      'Status bab belum berhasil diperiksa.',
    )
    await expect(getChapterGenerationStatus('story-id', 2)).rejects.not.toThrow(
      /database|owner_user_id|private-user/,
    )
  })

  it('preserves readiness when retrying a pending choice', async () => {
    recordPendingChoice({
      storyId: 'story/id',
      chapterNumber: 1,
      choiceId: 'choice-1',
    }, 123)
    const submit = vi.fn().mockResolvedValue({ outcome, nextChapterReady: false })

    await expect(retryPendingChoiceWithReadiness(submit)).resolves.toEqual({
      outcome,
      nextChapterReady: false,
    })
    expect(submit).toHaveBeenCalledWith('story/id', 1, 'choice-1')
  })

  it('returns reader-safe choice errors for invalid envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome, internalState: 'private' }), { status: 200 }),
    ))

    await expect(submitChoiceWithReadiness('story-id', 1, 'choice-1')).rejects.toThrow(
      'Pilihan belum berhasil dikirim.',
    )
    await expect(submitChoiceWithReadiness('story-id', 1, 'choice-1')).rejects.not.toThrow(
      /internalState|private/,
    )
  })
})
