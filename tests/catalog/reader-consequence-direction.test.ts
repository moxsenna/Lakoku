import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChoiceOutcomeSchema,
  JejakItemSchema,
  type Chapter,
  type JejakItem,
  type StoryDetail,
} from '@/packages/contracts/src/reader'
import { recordLastChoiceSummary, getLastChoiceSummary } from '@/lib/api/last-choice-summary'
import { isReaderSafeHint, sanitizeDirectionHint } from '@/lib/catalog/reader-safe-hint'
import { ChoiceOutcomeReaction } from '@/components/choice-outcome-reaction'
import { ReaderView } from '@/components/reader-view'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...props }, children),
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

const sampleStory: StoryDetail = {
  id: 'catalog:test-story',
  title: 'Bayang Tak Bertuan',
  cover: '/cover.jpg',
  tagline: 'Misteri lereng Lawu.',
  role: 'Raka',
  tropes: ['Rahasia Keluarga'],
  totalChapters: 50,
  currentChapter: 12,
  status: 'BERJALAN',
  synopsis: 'Perjalanan mencari kebenaran.',
  jejak: [],
}

function createSampleChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    storyId: sampleStory.id,
    number: 12,
    title: 'Bab 12: Pertemuan Kabut',
    paragraphs: ['Kabut menyelimuti jalan setapak di lereng gunung.'],
    choicePrompt: 'Ke mana langkahmu?',
    choices: [{ id: 'opt-1', label: 'Lari ke barat' }],
    ...overrides,
  }
}

const store = new Map<string, string>()

describe('reader consequence, direction hint & brand guard', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('ChoiceOutcomeSchema validates optional directionHint without crashing on valid strings', () => {
    const valid = ChoiceOutcomeSchema.parse({
      storyId: 'catalog:test',
      chapterNumber: 12,
      choiceId: 'choice-1',
      consequence: ['Paragraf reaksi pertama.', 'Paragraf reaksi kedua.'],
      nextChapterNumber: 13,
      isEnding: false,
      directionHint: 'Raka mulai mempercayaimu.',
    })
    expect(valid.directionHint).toBe('Raka mulai mempercayaimu.')
    expect(valid.consequence).toHaveLength(2)
  })

  it('JejakItemSchema validates optional directionHint', () => {
    const valid = JejakItemSchema.parse({
      chapter: 12,
      decision: 'Tetap bertahan',
      consequence: 'Paragraf satu.\n\nParagraf dua.',
      directionHint: 'Raka mulai mempercayaimu.',
    })
    expect(valid.directionHint).toBe('Raka mulai mempercayaimu.')
  })

  it('last-choice-summary records and retrieves multi-paragraph consequence and directionHint', () => {
    recordLastChoiceSummary({
      storyId: 'catalog:test-summary',
      fromChapter: 10,
      toChapter: 11,
      decision: 'Lari ke barat',
      consequence: 'Paragraf 1.\n\nParagraf 2.',
      directionHint: 'Langkahmu terasa lebih ringan.',
    })

    const summary = getLastChoiceSummary('catalog:test-summary', 11)
    expect(summary).not.toBeNull()
    expect(summary?.consequence).toBe('Paragraf 1.\n\nParagraf 2.')
    expect(summary?.directionHint).toBe('Langkahmu terasa lebih ringan.')
  })

  it('isReaderSafeHint allows reader-safe narrative text and safe substrings', () => {
    expect(isReaderSafeHint('Raka mulai mempercayaimu.')).toBe(true)
    // Substring occurrences like "klaim" containing "ai" or "terbaik" are safe due to word boundary
    expect(isReaderSafeHint('Raka mengklaim hak atas tanah warisan.')).toBe(true)
    expect(isReaderSafeHint('Keputusan terbaik untuk keluargamu.')).toBe(true)
  })

  it('isReaderSafeHint rejects forbidden internal/brand terms at word boundaries', () => {
    expect(isReaderSafeHint('Sistem AI telah menentukan arahmu.')).toBe(false)
    expect(isReaderSafeHint('Model narraza mengubah takdir.')).toBe(false)
    expect(isReaderSafeHint('Konstruksi rag diperbarui.')).toBe(false)
    expect(isReaderSafeHint('Dapatkan token untuk melanjutkan.')).toBe(false)
    expect(isReaderSafeHint('Skor karakter meningkat pesat.')).toBe(false)
    expect(isReaderSafeHint('Arah bias cerita bergeser.')).toBe(false)
    expect(isReaderSafeHint('Menuju ending yang tidak terduga.')).toBe(false)
    expect(isReaderSafeHint('')).toBe(false)
    expect(isReaderSafeHint(null)).toBe(false)
    expect(isReaderSafeHint(undefined)).toBe(false)
  })

  it('sanitizeDirectionHint drops unsafe hint and preserves safe hint', () => {
    // Unsafe hint dropped to undefined
    expect(sanitizeDirectionHint('Skor bias AI meningkat.')).toBeUndefined()
    expect(sanitizeDirectionHint('Ending rahasia terbuka.')).toBeUndefined()
    // Safe hint preserved
    expect(sanitizeDirectionHint('Langkahmu mulai meyakinkan tetua desa.')).toBe(
      'Langkahmu mulai meyakinkan tetua desa.',
    )
  })

  it('renders multi-paragraph consequence and directionHint in ChoiceOutcomeReaction', () => {
    const item: JejakItem = {
      chapter: 12,
      decision: 'Lari ke barat',
      consequence: 'Langkah kakimu berderap menembus ilalang.\n\nDi kejauhan bayangan Lawu membimbing arahmu.',
      directionHint: 'Raka mulai mempercayaimu.',
    }

    const html = renderToStaticMarkup(createElement(ChoiceOutcomeReaction, { item }))

    expect(html).toContain('Pilihanmu sebelumnya')
    expect(html).toContain('Lari ke barat')
    expect(html).toContain('Langkah kakimu berderap menembus ilalang.')
    expect(html).toContain('Di kejauhan bayangan Lawu membimbing arahmu.')
    expect(html).toContain('Raka mulai mempercayaimu.')
    expect(html).toContain('italic')
  })

  it('renders single-paragraph consequence without directionHint as clean legacy format', () => {
    const item: JejakItem = {
      chapter: 12,
      decision: 'Tetap bertahan',
      consequence: 'Kamu memilih bertahan di gubuk tua.',
    }

    const html = renderToStaticMarkup(createElement(ChoiceOutcomeReaction, { item }))

    expect(html).toContain('Pilihanmu sebelumnya')
    expect(html).toContain('Tetap bertahan')
    expect(html).toContain('Kamu memilih bertahan di gubuk tua.')
    expect(html).not.toContain('italic')
  })

  it('ReaderView renders previous choice multi-paragraph reaction and directionHint', () => {
    const previousChoice: JejakItem = {
      chapter: 11,
      decision: 'Buka peti tua',
      consequence: 'Kunci berkarat itu akhirnya berputar perlahan.\n\nSebuah surat bersampul kain lusuh tergeletak di dasar peti.',
      directionHint: 'Kebenaran masa lalu mulai terkuak.',
    }

    const html = renderToStaticMarkup(
      createElement(ReaderView, {
        story: sampleStory,
        chapter: createSampleChapter({ number: 12 }),
        previousChapterJejak: previousChoice,
      }),
    )

    expect(html).toContain('Pilihanmu sebelumnya')
    expect(html).toContain('Buka peti tua')
    expect(html).toContain('Kunci berkarat itu akhirnya berputar perlahan.')
    expect(html).toContain('Sebuah surat bersampul kain lusuh tergeletak di dasar peti.')
    expect(html).toContain('Kebenaran masa lalu mulai terkuak.')
  })
})
