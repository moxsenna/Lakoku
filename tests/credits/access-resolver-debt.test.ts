import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

interface StoryRow {
  [key: string]: unknown
  id: string
  owner_user_id: string
  story_mode: string
  commercial_origin: string | null
  visibility: string
}

interface LedgerRow {
  [key: string]: unknown
  id: string
  user_id: string
  ref: string
}

interface FeatureCreditCostRow {
  [key: string]: unknown
  feature_key: string
  credits_required: number
  is_active: boolean
}

const mockState = {
  stories: [] as StoryRow[],
  ledger: [] as LedgerRow[],
  featureCreditCosts: [
    { feature_key: 'story_start', credits_required: 24, is_active: true },
    { feature_key: 'chapter_unlock', credits_required: 8, is_active: true },
  ] as FeatureCreditCostRow[],
  /** Hasil `credit_balance_v1` untuk user terakhir; null = RPC error (fail-open). */
  balance: null as number | null,
  balanceError: false,
}

function createMockDb() {
  return {
    selectFrom: (table: unknown) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      let limitCount: number | undefined

      const builder = {
        select: () => builder,
        selectAll: () => builder,
        where: (col: unknown, op: unknown, val?: unknown) => {
          if (typeof col === 'string' && typeof op === 'string') {
            wheres.push({ col, op, val })
          }
          return builder
        },
        limit: (n: number) => {
          limitCount = n
          return builder
        },
        execute: async () => {
          // Panggilan RPC (selectFrom(sql-fn)) → kembalikan saldo mock.
          if (typeof table !== 'string') {
            if (mockState.balanceError) throw new Error('balance rpc down')
            return [{ fn: mockState.balance ?? 0 }]
          }
          const rows = (() => {
            if (table === 'stories') return mockState.stories
            if (table === 'credit_ledger') return mockState.ledger
            if (table === 'feature_credit_costs') return mockState.featureCreditCosts
            if (table === 'catalog_stories') return []
            return []
          })() as Array<Record<string, unknown>>
          let matched = rows.filter((row) =>
            wheres.every(({ col, op, val }) => {
              const rowVal = row[col]
              if (op === '=') return rowVal === val
              if (op === 'in') return Array.isArray(val) && val.includes(rowVal)
              return false
            }),
          )
          if (limitCount !== undefined) matched = matched.slice(0, limitCount)
          return matched
        },
      }
      return builder
    },
  }
}

vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getDb: vi.fn(() => createMockDb()),
  }
})

import { resolveChapterAccess } from '@/lib/credits/access-resolver.server'
import { unlockRef, readerUnlockRef } from '@/lib/credits/policy'

const USER = '10000000-0000-4000-8000-000000000001'

describe('resolveChapterAccess debt gate (audit M-A6)', () => {
  beforeEach(() => {
    mockState.stories = []
    mockState.ledger = []
    mockState.balance = 0
    mockState.balanceError = false
  })

  it('saldo minus memblokir bab berbayar walau ada bukti unlock ledger', async () => {
    mockState.stories = [{
      id: 'story-x', owner_user_id: USER, story_mode: 'standard',
      commercial_origin: null, visibility: 'public',
    }]
    mockState.ledger = [
      { id: 'l1', user_id: USER, ref: unlockRef('story-x', 4) },
      { id: 'l2', user_id: USER, ref: readerUnlockRef('story-x', 4, USER) },
    ]
    mockState.balance = -120

    const decision = await resolveChapterAccess({ userId: USER, storyId: 'story-x', chapterNumber: 4 })
    expect(decision).toMatchObject({ readable: false, reason: 'PAYMENT_REQUIRED' })
  })

  it('saldo minus memblokir proof bundle katalog juga', async () => {
    mockState.stories = [{
      id: 'catalog:novel', owner_user_id: USER, story_mode: 'catalog',
      commercial_origin: null, visibility: 'public',
    }]
    mockState.balance = -50

    const decision = await resolveChapterAccess({ userId: USER, storyId: 'catalog:novel', chapterNumber: 10 })
    expect(decision).toMatchObject({ readable: false, reason: 'PAYMENT_REQUIRED' })
  })

  it('bab gratis (1-3) tetap terbaca walau saldo minus', async () => {
    mockState.stories = [{
      id: 'story-x', owner_user_id: USER, story_mode: 'standard',
      commercial_origin: null, visibility: 'public',
    }]
    mockState.balance = -120

    const decision = await resolveChapterAccess({ userId: USER, storyId: 'story-x', chapterNumber: 2 })
    expect(decision).toMatchObject({ readable: true, reason: 'FREE_STANDARD', cost: 0 })
  })

  it('saldo 0 atau positif: ledger proof tetap membuka (perilaku lama utuh)', async () => {
    mockState.stories = [{
      id: 'story-x', owner_user_id: USER, story_mode: 'standard',
      commercial_origin: null, visibility: 'public',
    }]
    mockState.ledger = [{ id: 'l1', user_id: USER, ref: unlockRef('story-x', 4) }]

    const zero = await resolveChapterAccess({ userId: USER, storyId: 'story-x', chapterNumber: 4 })
    expect(zero).toMatchObject({ readable: true, reason: 'LEDGER_UNLOCKED' })

    mockState.balance = 300
    const positive = await resolveChapterAccess({ userId: USER, storyId: 'story-x', chapterNumber: 4 })
    expect(positive).toMatchObject({ readable: true, reason: 'LEDGER_UNLOCKED' })
  })

  it('komersial: bab included (PAID_START bab 1-3) tetap terbaca walau saldo minus', async () => {
    mockState.stories = [{
      id: 'story-komersial', owner_user_id: USER, story_mode: 'personalized_ai',
      commercial_origin: 'PAID_START', visibility: 'private',
    }]
    mockState.balance = -80

    const included = await resolveChapterAccess({ userId: USER, storyId: 'story-komersial', chapterNumber: 3 })
    expect(included).toMatchObject({ readable: true, reason: 'PAID_START_INCLUDED' })

    const paid = await resolveChapterAccess({ userId: USER, storyId: 'story-komersial', chapterNumber: 5 })
    expect(paid).toMatchObject({ readable: false, reason: 'PAYMENT_REQUIRED' })
  })

  it('fail-open: RPC saldo error tidak memblokir pembaca', async () => {
    mockState.stories = [{
      id: 'story-x', owner_user_id: USER, story_mode: 'standard',
      commercial_origin: null, visibility: 'public',
    }]
    mockState.ledger = [{ id: 'l1', user_id: USER, ref: unlockRef('story-x', 4) }]
    mockState.balanceError = true

    const decision = await resolveChapterAccess({ userId: USER, storyId: 'story-x', chapterNumber: 4 })
    expect(decision).toMatchObject({ readable: true, reason: 'LEDGER_UNLOCKED' })
  })
})
