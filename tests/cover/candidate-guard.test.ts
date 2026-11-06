import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

interface CandidateRow {
  [key: string]: unknown
  id: string
  story_id: string
  user_id: string
  url: string
  expires_at: Date
}

const mockState = {
  candidates: [] as CandidateRow[],
}

function createMockDb() {
  return {
    selectFrom: (table: string) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      const builder = {
        select: () => builder,
        where: (col: string, op: string, val: unknown) => {
          wheres.push({ col, op, val })
          return builder
        },
        limit: () => builder,
        execute: async () => {
          if (table !== 'story_cover_candidates') return []
          return mockState.candidates.filter((row) =>
            wheres.every(({ col, op, val }) => {
              const rowVal = row[col]
              if (op === '=') return rowVal === val
              if (op === 'in') return Array.isArray(val) && val.includes(rowVal)
              if (op === '>') return new Date(String(rowVal)) > new Date(String(val))
              return false
            }),
          )
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

import { isKnownCoverCandidate } from '../../lib/cover/server'

const USER = '10000000-0000-4000-8000-000000000001'
const FUTURE = new Date('2030-01-01T00:00:00.000Z')
const PAST = new Date('2020-01-01T00:00:00.000Z')

describe('isKnownCoverCandidate (audit M-A4)', () => {
  beforeEach(() => {
    mockState.candidates = []
  })

  it('menerima URL kandidat milik (storyId, userId) yang belum kedaluwarsa', async () => {
    mockState.candidates = [{
      id: 'c1', story_id: 'story-a', user_id: USER,
      url: 'story-a/20261107T0930.webp', expires_at: FUTURE,
    }]
    await expect(isKnownCoverCandidate('story-a', USER, 'story-a/20261107T0930.webp')).resolves.toBe(true)
  })

  it('menolak URL yang bukan kandidat (path arbitrer / milik orang lain)', async () => {
    mockState.candidates = [{
      id: 'c1', story_id: 'story-a', user_id: USER,
      url: 'story-a/20261107T0930.webp', expires_at: FUTURE,
    }]
    await expect(isKnownCoverCandidate('story-a', USER, 'story-lain/rahasia.webp')).resolves.toBe(false)
    await expect(isKnownCoverCandidate('story-a', 'user-lain', 'story-a/20261107T0930.webp')).resolves.toBe(false)
  })

  it('menolak kandidat yang sudah kedaluwarsa', async () => {
    mockState.candidates = [{
      id: 'c2', story_id: 'story-a', user_id: USER,
      url: 'story-a/lama.webp', expires_at: PAST,
    }]
    await expect(isKnownCoverCandidate('story-a', USER, 'story-a/lama.webp')).resolves.toBe(false)
  })

  it('gagal query → fail-closed (false)', async () => {
    vi.mocked(
      (await import('@lakoku/db')).getDb as unknown as ReturnType<typeof vi.fn>,
    ).mockImplementation(() => {
      throw new Error('db down')
    })
    try {
      await expect(isKnownCoverCandidate('story-a', USER, 'story-a/x.webp')).resolves.toBe(false)
    } finally {
      vi.mocked(
        (await import('@lakoku/db')).getDb as unknown as ReturnType<typeof vi.fn>,
      ).mockImplementation(() => createMockDb())
    }
  })
})
