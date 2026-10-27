import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChapterLocked } from '@/components/chapter-locked'
import type { StoryDetail } from '@/lib/api'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...props }, children),
}))

vi.mock('@/lib/analytics/client', () => ({
  trackEvent: vi.fn(),
}))

const mockStory: StoryDetail = {
  id: 'catalog:bayang-tak-bertuan',
  title: 'Bayang Tak Bertuan',
  cover: '/covers/bayang.webp',
  tagline: 'Tagline',
  role: 'Raka',
  tropes: ['Rahasia Keluarga'],
  totalChapters: 50,
  synopsis: 'Sinopsis',
  status: 'BERJALAN',
  currentChapter: 4,
  jejak: [],
  endingName: undefined,
}

describe('ChapterLocked dual-button UI for catalog', () => {
  it('renders both single chapter and novel bundle unlock buttons with prices for catalog story', () => {
    const html = renderToStaticMarkup(
      createElement(ChapterLocked, {
        story: mockStory,
        chapterNumber: 4,
        cost: 5,
        balance: 200,
        bundleQuote: { price: 140, savings: 85 },
      }),
    )

    // Both single chapter and bundle buttons with prices render
    expect(html).toContain('Buka bab ini (5 Lakoin)')
    expect(html).toContain('Buka semua bab (140 Lakoin, hemat 85)')
    expect(html).toContain('Bayang Tak Bertuan')
    expect(html).toContain('Bab 4 terkunci')
  })

  it('renders only single chapter unlock button when bundleQuote is omitted (non-catalog story)', () => {
    const regularStory: StoryDetail = {
      ...mockStory,
      id: 'demo:regular',
      title: 'Cerita Reguler',
    }

    const html = renderToStaticMarkup(
      createElement(ChapterLocked, {
        story: regularStory,
        chapterNumber: 4,
        cost: 8,
        balance: 50,
        bundleQuote: null,
      }),
    )

    // Only single chapter button renders
    expect(html).toContain('Buka bab ini (8 Lakoin)')
    expect(html).not.toContain('Buka semua bab')
  })

  it('renders top-up link instead of single chapter button when balance is insufficient', () => {
    const html = renderToStaticMarkup(
      createElement(ChapterLocked, {
        story: mockStory,
        chapterNumber: 4,
        cost: 5,
        balance: 2,
        bundleQuote: { price: 140, savings: 85 },
      }),
    )

    expect(html).toContain('Beli Lakoin')
    expect(html).not.toContain('Buka bab ini (5 Lakoin)')
    expect(html).toContain('Buka semua bab')
  })

  it('omits savings label when savings is 0', () => {
    const html = renderToStaticMarkup(
      createElement(ChapterLocked, {
        story: mockStory,
        chapterNumber: 4,
        cost: 5,
        balance: 200,
        bundleQuote: { price: 150, savings: 0 },
      }),
    )

    expect(html).toContain('Buka semua bab (150 Lakoin)')
    expect(html).not.toContain('hemat')
  })

  it('does not contain prohibited terms (brand guard)', () => {
    const html = renderToStaticMarkup(
      createElement(ChapterLocked, {
        story: mockStory,
        chapterNumber: 4,
        cost: 5,
        balance: 200,
        bundleQuote: { price: 140, savings: 85 },
      }),
    )

    expect(html).not.toMatch(/\b(AI|token|Narraza|RAG)\b/i)
  })
})
