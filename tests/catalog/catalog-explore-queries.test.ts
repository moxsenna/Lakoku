// tests/catalog/catalog-explore-queries.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStories: Array<Record<string, unknown>> = []
const mockCatalogStories: Array<Record<string, unknown>> = []

vi.mock('server-only', () => ({}))

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (_table: string) => {
      let isLeftJoin = false
      const wheres: Array<(item: Record<string, unknown>) => boolean> = []

      const builder = {
        leftJoin: (joinedTable: string) => {
          if (joinedTable === 'catalog_stories') isLeftJoin = true
          return builder
        },
        select: () => builder,
        where: (arg1: unknown, arg2?: unknown, arg3?: unknown) => {
          if (typeof arg1 === 'function') {
            // Mock custom eb evaluator
            wheres.push((item) => {
              const id = String(item.id || item['stories.id'] || '')
              const catalogStatus = item.catalog_status
              if (id.startsWith('demo:') || id.startsWith('premium:')) return true
              if (id.startsWith('catalog:') && catalogStatus === 'published') return true
              return false
            })
            return builder
          }
          if (typeof arg1 === 'string' && arg2 === '=') {
            wheres.push((item) => item[arg1] === arg3 || item[arg1.replace('stories.', '')] === arg3)
          }
          if (typeof arg1 === 'string' && arg2 === 'not like') {
            const prefix = String(arg3).replace('%', '')
            wheres.push((item) => !String(item[arg1] ?? '').startsWith(prefix))
          }
          return builder
        },
        orderBy: () => builder,
        limit: () => builder,
        execute: async () => {
          const joined = mockStories.map((s) => {
            const cat = isLeftJoin ? mockCatalogStories.find((c) => c.story_id === s.id) : undefined
            return {
              ...s,
              'stories.id': s.id,
              'stories.title': s.title,
              catalog_status: cat?.status,
            }
          })
          return joined.filter((row) => wheres.every((predicate) => predicate(row)))
        },
      }
      return builder
    },
  }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
  single: async (promise: Promise<unknown[]>) => {
    const rows = await promise
    return { data: rows[0] ?? null, error: null }
  },
}))

describe('catalog explore queries', () => {
  beforeEach(() => {
    mockStories.length = 0
    mockCatalogStories.length = 0
  })

  it('queryExploreStories includes published catalog stories and excludes draft catalog stories', async () => {
    mockStories.push(
      { id: 'demo:cinta', title: 'Demo Cinta', visibility: 'public' },
      { id: 'catalog:published-novel', title: 'Novel Tayang', visibility: 'public' },
      { id: 'catalog:draft-novel', title: 'Novel Draf', visibility: 'public' },
    )
    mockCatalogStories.push(
      { story_id: 'catalog:published-novel', status: 'published' },
      { story_id: 'catalog:draft-novel', status: 'draft' },
    )

    const { queryExploreStories } = await import('@/lib/api/queries')
    const stories = await queryExploreStories()
    const ids = stories.map((s) => s.id)
    expect(ids).toContain('demo:cinta')
    expect(ids).toContain('catalog:published-novel')
    expect(ids).not.toContain('catalog:draft-novel')
  })

  it('queryPublicUserStories excludes catalog stories', async () => {
    mockStories.push(
      { id: 'user:cerita-saya', title: 'User Story', visibility: 'public', owner_user_id: 'u1' },
      { id: 'catalog:published-novel', title: 'Novel Tayang', visibility: 'public', owner_user_id: null },
    )

    const { queryPublicUserStories } = await import('@/lib/api/queries')
    const stories = await queryPublicUserStories()
    const ids = stories.map((s) => s.id)
    expect(ids).toContain('user:cerita-saya')
    expect(ids).not.toContain('catalog:published-novel')
  })
})
