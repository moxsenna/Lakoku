import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import type {
  ChapterStatusResponse,
  StoryDetail,
  Chapter,
  JejakItem,
} from '../packages/contracts/src/reader'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...props }, children),
}))
vi.mock('@/lib/api', () => ({
  clearPendingChoice: vi.fn(),
  getPendingChoice: vi.fn(() => null),
  recordChapterReached: vi.fn(),
  recordLastChoiceSummary: vi.fn(),
  getLastChoiceSummary: vi.fn(() => null),
  recordPendingChoice: vi.fn((value) => value),
  retryPendingChoiceWithReadiness: vi.fn(),
}))
vi.mock('@/components/report-dialog', () => ({ ReportDialog: () => null }))
vi.mock('@/components/chapter-list-dialog', () => ({ ChapterListDialog: () => null }))
vi.mock('@/components/chapter-unavailable-banner', () => ({ ChapterUnavailableBanner: () => null }))
vi.mock('@/components/mulai/poetry-lottie', () => ({ PoetryLottie: () => null }))
vi.mock('@/components/font-size-provider', () => ({
  useReaderFontSize: () => ({
    fontSize: 18,
    decreaseFontSize: vi.fn(),
    increaseFontSize: vi.fn(),
  }),
}))

import {
  CHAPTER_STATUS_POLL_MS,
  GenerationFailedView,
  ReaderView,
  getChoiceAdvanceAction,
  pollChapterGenerationStatus,
} from '@/components/reader-view'

const story: StoryDetail = {
  id: 'story/final',
  title: 'Cerita Ujung',
  cover: '/cover.jpg',
  tagline: 'Satu keputusan terakhir.',
  role: 'Tokoh utama',
  tropes: [],
  totalChapters: 3,
  currentChapter: 3,
  status: 'SELESAI',
  synopsis: 'Perjalanan sampai ujung.',
  jejak: [],
}

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    storyId: story.id,
    number: 3,
    title: 'Bab Terakhir',
    paragraphs: ['Semua perjalanan menemukan akhirnya.'],
    ...overrides,
  }
}

function renderReader(value: Chapter) {
  return renderToStaticMarkup(createElement(ReaderView, { story, chapter: value }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('final reader chapter', () => {
  it.each([
    ['choices absent', chapter()],
    ['choices empty', chapter({ choices: [] })],
    ['stale choices present', chapter({
      choicePrompt: 'Pilihan usang',
      choices: [{ id: 'stale', label: 'Pilihan usang' }],
    })],
    ['chapter exceeds configured total', chapter({ number: 4 })],
  ])('shows completion links and no choice section when %s', (_label, value) => {
    const html = renderReader(value)

    expect(html).not.toContain('PILIHANMU')
    expect(html).toContain('Kembali ke Library')
    expect(html).toContain('href="/koleksiku"')
    expect(html).toContain('Buat Cerita Baru')
    expect(html).toContain('href="/mulai"')
    expect(html).not.toMatch(/mode|generation_status|owner_user_id|effect_json/)
  })

  it('keeps choice hint visible on a non-final choice chapter', () => {
    const html = renderReader(chapter({
      number: 2,
      choicePrompt: 'Apa langkahmu?',
      choices: [{ id: 'open', label: 'Buka pintu', hint: 'Kebenaran mungkin menunggu.' }],
    }))

    expect(html).toContain('PILIHANMU')
    expect(html).toContain('Kebenaran mungkin menunggu.')
    expect(html).not.toContain('Kembali ke Library')
  })

  it('renders a local previous choice snapshot without changing server precedence', () => {
    const localChoice: JejakItem = {
      chapter: 1,
      decision: 'Buka pintu',
      consequence: 'Lorong rahasia terbuka.',
    }
    const serverChoice: JejakItem = {
      chapter: 1,
      decision: 'Tutup pintu',
      consequence: 'Rahasia tetap tersembunyi.',
    }

    const localHtml = renderToStaticMarkup(createElement(ReaderView, {
      story,
      chapter: chapter({ number: 2 }),
      initialLocalPreviousChoice: localChoice,
    }))
    const serverHtml = renderToStaticMarkup(createElement(ReaderView, {
      story,
      chapter: chapter({ number: 2 }),
      previousChapterJejak: serverChoice,
      initialLocalPreviousChoice: localChoice,
    }))

    expect(localHtml).toContain('Buka pintu')
    expect(localHtml).toContain('Lorong rahasia terbuka.')
    expect(serverHtml).toContain('Tutup pintu')
    expect(serverHtml).not.toContain('Buka pintu')
  })
})

describe('choice readiness compatibility', () => {
  const nonEndingOutcome = {
    storyId: story.id,
    chapterNumber: 1,
    choiceId: 'open',
    consequence: ['Jalan terbuka.'],
    nextChapterNumber: 2,
    isEnding: false,
  }

  it('polls only explicit false readiness so standard omitted readiness still advances', () => {
    expect(getChoiceAdvanceAction({
      outcome: nonEndingOutcome,
      nextChapterReady: false,
    })).toBe('poll')
    expect(getChoiceAdvanceAction({ outcome: nonEndingOutcome })).toBe('navigate')
    expect(getChoiceAdvanceAction({
      outcome: nonEndingOutcome,
      nextChapterReady: true,
    })).toBe('navigate')
    expect(getChoiceAdvanceAction({
      outcome: { ...nonEndingOutcome, isEnding: true, nextChapterNumber: null },
      nextChapterReady: false,
    })).toBe('ending')
  })
})

describe('failed chapter generation UI', () => {
  it('keeps failure guidance without offering fake retry polling', () => {
    const html = renderToStaticMarkup(createElement(GenerationFailedView, {
      storyId: story.id,
    }))

    expect(html).toContain('Bab berikutnya belum siap.')
    expect(html).toContain('Penulisan bab mengalami kendala.')
    expect(html).not.toContain('Coba periksa lagi')
    expect(html).not.toContain('<button')
    expect(html).toContain(`href="/cerita/${story.id}"`)
  })
})

describe('chapter status polling', () => {
  it('checks exact next chapter every 1500ms until ready', async () => {
    vi.useFakeTimers()
    const statuses: ChapterStatusResponse[] = [
      { status: 'generating', chapterNumber: 4 },
      { status: 'ready', chapterNumber: 4 },
    ]
    const getStatus = vi.fn(async () => statuses.shift()!)
    const controller = new AbortController()

    const result = pollChapterGenerationStatus({
      storyId: 'private/story',
      chapterNumber: 4,
      signal: controller.signal,
      getStatus,
    })

    expect(CHAPTER_STATUS_POLL_MS).toBe(1500)
    expect(getStatus).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(getStatus).toHaveBeenLastCalledWith('private/story', 4, controller.signal)
    await vi.advanceTimersByTimeAsync(1500)

    await expect(result).resolves.toBe('ready')
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops on failed and leaves no scheduled poll', async () => {
    vi.useFakeTimers()
    const getStatus = vi.fn(async () => ({
      status: 'failed' as const,
      chapterNumber: 5,
    }))

    const result = pollChapterGenerationStatus({
      storyId: story.id,
      chapterNumber: 5,
      signal: new AbortController().signal,
      getStatus,
    })
    await vi.advanceTimersByTimeAsync(1500)

    await expect(result).resolves.toBe('failed')
    expect(getStatus).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes the polling signal to each status request', async () => {
    vi.useFakeTimers()
    const getStatus = vi.fn(async () => ({
      status: 'ready' as const,
      chapterNumber: 2,
    }))
    const controller = new AbortController()

    const result = pollChapterGenerationStatus({
      storyId: story.id,
      chapterNumber: 2,
      signal: controller.signal,
      getStatus,
    })
    await vi.advanceTimersByTimeAsync(1500)

    await expect(result).resolves.toBe('ready')
    expect(getStatus).toHaveBeenCalledWith(story.id, 2, controller.signal)
  })

  it('aborts an active status request when the unmount signal aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const getStatus = vi.fn((
      _storyId: string,
      _chapterNumber: number,
      signal?: AbortSignal,
    ) => new Promise<ChapterStatusResponse>((_resolve, reject) => {
      requestSignal = signal
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))

    const result = pollChapterGenerationStatus({
      storyId: story.id,
      chapterNumber: 2,
      signal: controller.signal,
      getStatus,
    })
    await vi.advanceTimersByTimeAsync(1500)
    controller.abort()

    await expect(result).resolves.toBe('aborted')
    expect(requestSignal).toBe(controller.signal)
    expect(requestSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a transient status request error until an explicit terminal status', async () => {
    vi.useFakeTimers()
    const getStatus = vi.fn()
      .mockRejectedValueOnce(new Error('private status detail'))
      .mockResolvedValueOnce({ status: 'ready', chapterNumber: 2 })

    const result = pollChapterGenerationStatus({
      storyId: story.id,
      chapterNumber: 2,
      signal: new AbortController().signal,
      getStatus,
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(getStatus).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1500)

    await expect(result).resolves.toBe('ready')
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts and clears pending timer on unmount signal', async () => {
    vi.useFakeTimers()
    const getStatus = vi.fn()
    const controller = new AbortController()

    const result = pollChapterGenerationStatus({
      storyId: story.id,
      chapterNumber: 2,
      signal: controller.signal,
      getStatus,
    })
    controller.abort()

    await expect(result).resolves.toBe('aborted')
    expect(getStatus).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
