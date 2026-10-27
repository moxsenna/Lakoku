import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

interface WhereClause {
  col: string
  op: string
  val: unknown
}

interface ExecutedQuery {
  table: string
  selectCols?: unknown
  wheres: WhereClause[]
  limitCount?: number
}

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

interface MockQueryBuilder<TRow> {
  select: (cols: unknown) => MockQueryBuilder<TRow>
  where: (col: string, op: string, val: unknown) => MockQueryBuilder<TRow>
  limit: (n: number) => MockQueryBuilder<TRow>
  execute: () => Promise<TRow[]>
}

function filterRows<T extends Record<string, unknown>>(
  rows: T[],
  wheres: WhereClause[],
  limit?: number,
): T[] {
  let matched = rows.filter((row) => {
    return wheres.every(({ col, op, val }) => {
      const rowVal = row[col]
      if (op === '=') {
        return rowVal === val
      }
      if (op === 'in') {
        return Array.isArray(val) && val.includes(rowVal)
      }
      return false
    })
  })
  if (limit !== undefined) {
    matched = matched.slice(0, limit)
  }
  return matched
}

const mockState = {
  stories: [] as StoryRow[],
  ledger: [] as LedgerRow[],
  executedQueries: [] as ExecutedQuery[],
}

function createMockDb() {
  return {
    selectFrom: (table: string) => {
      const wheres: WhereClause[] = []
      let selectCols: unknown
      let limitCount: number | undefined

      const builder: MockQueryBuilder<Record<string, unknown>> = {
        select: (cols: unknown) => {
          selectCols = cols
          return builder
        },
        where: (col: string, op: string, val: unknown) => {
          wheres.push({ col, op, val })
          return builder
        },
        limit: (n: number) => {
          limitCount = n
          return builder
        },
        execute: async () => {
          mockState.executedQueries.push({
            table,
            selectCols,
            wheres: [...wheres],
            limitCount,
          })
          if (table === 'stories') {
            return filterRows(mockState.stories, wheres, limitCount)
          }
          if (table === 'credit_ledger') {
            return filterRows(mockState.ledger, wheres, limitCount)
          }
          return []
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

import { readerUnlockRef, unlockRef } from '@/lib/credits/policy'
import { resolveChapterAccess } from '@/lib/credits/access-resolver.server'

describe('Task 1: Shared Story Unlock Ref and Resolver Access', () => {
  const storyId = 'story-standard-1'
  const userA = 'user-A'
  const userB = 'user-B'
  const chapterNumber = 4

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.stories = [
      {
        id: storyId,
        owner_user_id: 'author-original',
        story_mode: 'standard',
        commercial_origin: null,
        visibility: 'public',
      },
    ]
    mockState.ledger = []
    mockState.executedQueries = []
  })

  it('1. standard story, Bab 4, ledger user B has reader ref -> LEDGER_UNLOCKED', async () => {
    mockState.ledger = [
      {
        id: 'ledger-b-reader',
        user_id: userB,
        ref: readerUnlockRef(storyId, chapterNumber, userB),
      },
    ]

    const decision = await resolveChapterAccess({
      userId: userB,
      storyId,
      chapterNumber,
    })

    expect(decision).toEqual({
      readable: true,
      reason: 'LEDGER_UNLOCKED',
      cost: 0,
    })
  })

  it('2. standard story, Bab 4, ledger user B has old canonical ref -> LEDGER_UNLOCKED (backward compatibility)', async () => {
    mockState.ledger = [
      {
        id: 'ledger-b-canonical',
        user_id: userB,
        ref: unlockRef(storyId, chapterNumber),
      },
    ]

    const decision = await resolveChapterAccess({
      userId: userB,
      storyId,
      chapterNumber,
    })

    expect(decision).toEqual({
      readable: true,
      reason: 'LEDGER_UNLOCKED',
      cost: 0,
    })
  })

  it('3. standard story, Bab 4, ledger B is empty (even if user A has unlock:S:4:A) -> PAYMENT_REQUIRED', async () => {
    mockState.ledger = [
      {
        id: 'ledger-a-reader',
        user_id: userA,
        ref: readerUnlockRef(storyId, chapterNumber, userA),
      },
    ]

    const decision = await resolveChapterAccess({
      userId: userB,
      storyId,
      chapterNumber,
    })

    expect(decision).toEqual({
      readable: false,
      reason: 'PAYMENT_REQUIRED',
      cost: 8,
    })
  })

  it('4. non-commercial ledger query filters by user_id = userId and both refs in where', async () => {
    await resolveChapterAccess({
      userId: userB,
      storyId,
      chapterNumber,
    })

    const ledgerQuery = mockState.executedQueries.find((q) => q.table === 'credit_ledger')
    expect(ledgerQuery).toBeDefined()
    expect(ledgerQuery?.wheres).toEqual([
      { col: 'user_id', op: '=', val: userB },
      {
        col: 'ref',
        op: 'in',
        val: [
          readerUnlockRef(storyId, chapterNumber, userB),
          unlockRef(storyId, chapterNumber),
        ],
      },
    ])
  })

  it('5. readerUnlockRef format matches unlock:S:C:U and unlockRef remains unlock:S:C', () => {
    expect(readerUnlockRef('S', 4, 'u1')).toBe('unlock:S:4:u1')
    expect(unlockRef('S', 4)).toBe('unlock:S:4')
  })
})
