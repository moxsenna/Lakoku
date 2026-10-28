import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bundleRef, DEFAULT_READING_POLICY, readerUnlockRef } from '@/lib/credits/policy'
import { isCommercialStoryMode } from '@/lib/commercial/resolver.server'

vi.mock('server-only', () => ({}))

const mockDbState = {
  stories: [] as Array<{
    id: string
    owner_user_id: string | null
    story_mode: string
    commercial_origin: string | null
    visibility: string
  }>,
  catalogStories: [] as Array<{
    story_id: string
    chapter_price: number
    bundle_price: number
    status: string
  }>,
  ledger: [] as Array<{
    id: string
    user_id: string
    ref: string
  }>,
}

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      let limitCount: number | undefined
      const builder = {
        select: (_cols: unknown) => builder,
        where: (col: string, op: string, val: unknown) => {
          wheres.push({ col, op, val })
          return builder
        },
        limit: (n: number) => {
          limitCount = n
          return builder
        },
        execute: async () => {
          const rows =
            table === 'stories'
              ? mockDbState.stories
              : table === 'catalog_stories'
                ? mockDbState.catalogStories
                : table === 'credit_ledger'
                  ? mockDbState.ledger
                  : []
          let matched = (rows as Array<Record<string, unknown>>).filter((r) =>
            wheres.every(({ col, op, val }) => {
              if (op === '=') return r[col] === val
              if (op === 'in') return Array.isArray(val) && val.includes(r[col])
              return false
            }),
          )
          if (limitCount !== undefined) matched = matched.slice(0, limitCount)
          return matched
        },
      }
      return builder
    },
  }),
  single: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows[0] ?? null, error: null }
  },
  result: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows, error: null }
  },
}))

describe('catalog access resolver & policy', () => {
  beforeEach(() => {
    mockDbState.stories = []
    mockDbState.catalogStories = []
    mockDbState.ledger = []
  })

  it('bundleRef generates canonical bundle idempotency key', () => {
    expect(bundleRef('catalog:misteri-desa', 'u123')).toBe('bundle:catalog:misteri-desa:u123')
  })

  it('isCommercialStoryMode returns false for catalog', () => {
    expect(isCommercialStoryMode('catalog')).toBe(false)
  })

  it('catalog story Bab 1-3 is FREE_STANDARD', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 2,
    })
    expect(decision).toEqual({ readable: true, reason: 'FREE_STANDARD', cost: 0 })
  })

  it('catalog story Bab 4 locked without purchase costs catalog_stories.chapter_price', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 7,
      bundle_price: 150,
      status: 'published',
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 4,
    })
    expect(decision).toEqual({ readable: false, reason: 'PAYMENT_REQUIRED', cost: 7 })
  })

  it('catalog story Bab 4 falls back to default 5 credits when catalog_stories row missing', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 4,
    })
    expect(decision).toEqual({ readable: false, reason: 'PAYMENT_REQUIRED', cost: 5 })
  })

  it('guest reader (userId: null) on locked catalog chapter gets PAYMENT_REQUIRED with catalog price', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 7,
      bundle_price: 150,
      status: 'published',
    })

    const decision = await resolveChapterAccess({
      userId: null,
      storyId: 'catalog:misteri-desa',
      chapterNumber: 4,
    })
    expect(decision).toEqual({ readable: false, reason: 'PAYMENT_REQUIRED', cost: 7 })
  })

  it('story with id catalog:spoof but story_mode: standard uses standard policy price and never unlocks via bundle ref', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:spoof',
      owner_user_id: null,
      story_mode: 'standard',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:spoof',
      chapter_price: 3,
      bundle_price: 50,
      status: 'published',
    })
    mockDbState.ledger.push({
      id: 'led-b',
      user_id: 'u123',
      ref: bundleRef('catalog:spoof', 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:spoof',
      chapterNumber: 4,
    })
    expect(decision).toEqual({
      readable: false,
      reason: 'PAYMENT_REQUIRED',
      cost: DEFAULT_READING_POLICY.creditsPerChapter,
    })
  })

  it('catalog story Bab 4 unlocked via readerUnlockRef is LEDGER_UNLOCKED', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'published',
    })
    mockDbState.ledger.push({
      id: 'led-1',
      user_id: 'u123',
      ref: readerUnlockRef('catalog:misteri-desa', 4, 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 4,
    })
    expect(decision).toEqual({ readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 })
  })

  it('catalog story Bab 10 unlocked via bundle ref is BUNDLE_UNLOCKED', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'published',
    })
    mockDbState.ledger.push({
      id: 'led-b',
      user_id: 'u123',
      ref: bundleRef('catalog:misteri-desa', 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 10,
    })
    expect(decision).toEqual({ readable: true, reason: 'BUNDLE_UNLOCKED', cost: 0 })
  })

  it('archived catalog story rejects new purchases without charging', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'archived',
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 10,
    })
    expect(decision).toEqual({ readable: false, reason: 'STORY_PENDING', cost: 0 })
  })

  it('archived catalog story still serves a guest its free chapters', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'archived',
    })

    const decision = await resolveChapterAccess({
      userId: null,
      storyId: 'catalog:misteri-desa',
      chapterNumber: 2,
    })
    expect(decision).toEqual({ readable: true, reason: 'FREE_STANDARD', cost: 0 })
  })

  it('archived catalog story keeps already-bought chapters readable', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'archived',
    })
    mockDbState.ledger.push({
      id: 'led-1',
      user_id: 'u123',
      ref: readerUnlockRef('catalog:misteri-desa', 10, 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 10,
    })
    expect(decision).toEqual({ readable: true, reason: 'LEDGER_UNLOCKED', cost: 0 })
  })

  it('archived catalog story keeps bundle buyers readable', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'public',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'archived',
    })
    mockDbState.ledger.push({
      id: 'led-b',
      user_id: 'u123',
      ref: bundleRef('catalog:misteri-desa', 'u123'),
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 10,
    })
    expect(decision).toEqual({ readable: true, reason: 'BUNDLE_UNLOCKED', cost: 0 })
  })

  it('catalog story still in review cannot be bought', async () => {
    const { resolveChapterAccess } = await import('@/lib/credits/access-resolver.server')
    mockDbState.stories.push({
      id: 'catalog:misteri-desa',
      owner_user_id: null,
      story_mode: 'catalog',
      commercial_origin: null,
      visibility: 'private',
    })
    mockDbState.catalogStories.push({
      story_id: 'catalog:misteri-desa',
      chapter_price: 5,
      bundle_price: 150,
      status: 'review',
    })

    const decision = await resolveChapterAccess({
      userId: 'u123',
      storyId: 'catalog:misteri-desa',
      chapterNumber: 10,
    })
    expect(decision).toEqual({ readable: false, reason: 'STORY_PENDING', cost: 0 })
  })
})
