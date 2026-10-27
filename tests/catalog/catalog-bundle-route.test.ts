import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/stories/[id]/bundle/route'
import { getCatalogBundleQuote } from '@/lib/catalog/bundle.server'

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getCreditBalance: vi.fn(),
  getDb: vi.fn(),
  rpcOne: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getSessionUser,
}))

vi.mock('@/lib/credits/server', () => ({
  getCreditBalance: mocks.getCreditBalance,
  getReadingPolicy: async () => ({ freeChapters: 3, creditsPerChapter: 8 }),
}))

vi.mock('@lakoku/db', () => ({
  getDb: mocks.getDb,
  single: async (promise: Promise<unknown[]>) => {
    try {
      const rows = await promise
      return { data: rows[0] ?? null, error: null }
    } catch (err: unknown) {
      return {
        data: null,
        error: { message: (err as Error)?.message ?? 'DB error' },
      }
    }
  },
  result: async (promise: Promise<unknown[]>) => {
    try {
      const rows = await promise
      return { data: rows, error: null }
    } catch (err: unknown) {
      return {
        data: null,
        error: { message: (err as Error)?.message ?? 'DB error' },
      }
    }
  },
  rpcOne: mocks.rpcOne,
}))

function createChain(rowsOrExecute: unknown[] | (() => Promise<unknown[]>)) {
  const chain = {
    innerJoin: () => chain,
    leftJoin: () => chain,
    select: () => chain,
    where: () => chain,
    limit: () => chain,
    execute: typeof rowsOrExecute === 'function' ? rowsOrExecute : async () => rowsOrExecute,
  }
  return chain
}

describe('POST & GET /api/stories/[id]/bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST returns 401 when user is not authenticated', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Tidak diizinkan.')
  })

  it('POST returns 404 when story is not found', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([]),
    })

    const req = new Request('http://localhost/api/stories/catalog:missing/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:missing' }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Cerita tidak ditemukan.')
  })

  it('POST returns 400 when story is not a catalog story', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([{ id: 'demo:regular', story_mode: 'standard' }]),
    })

    const req = new Request('http://localhost/api/stories/demo:regular/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'demo:regular' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Hanya novel katalog yang memiliki paket.')
  })

  it('POST returns 400 when story has catalog id prefix but story_mode is standard (detection by story_mode ONLY)', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([{ id: 'catalog:spoof', story_mode: 'standard' }]),
    })

    const req = new Request('http://localhost/api/stories/catalog:spoof/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:spoof' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Hanya novel katalog yang memiliki paket.')
  })

  it('POST returns 404 when catalog story is in draft/review/archived status', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: (table: string) => {
        if (table === 'stories') {
          return createChain([{ id: 'catalog:draft', story_mode: 'catalog' }])
        }
        return createChain([{ story_id: 'catalog:draft', status: 'draft' }])
      },
    })

    const req = new Request('http://localhost/api/stories/catalog:draft/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:draft' }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Cerita tidak ditemukan.')
  })

  it('POST normalizes encoded id (catalog%3Atest -> catalog:test)', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    const queriedStoryIds: string[] = []
    const builder = {
      select: () => builder,
      where: (col: string, op: string, val: string) => {
        if (col === 'id' || col === 'story_id') {
          queriedStoryIds.push(val)
        }
        return builder
      },
      limit: () => builder,
      execute: async () => [{ id: 'catalog:test', story_id: 'catalog:test', story_mode: 'catalog', status: 'published' }],
    }
    mocks.getDb.mockReturnValue({
      selectFrom: () => builder,
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => [{ fn: { status: 'ok', price_paid: 150, spent_offset: 0 } }],
    })
    mocks.getCreditBalance.mockResolvedValue(50)

    const req = new Request('http://localhost/api/stories/catalog%3Atest/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog%3Atest' }) })
    expect(res.status).toBe(200)
    expect(queriedStoryIds).toContain('catalog:test')
    expect(queriedStoryIds).not.toContain('catalog%3Atest')
  })

  it('POST returns 402 when balance is insufficient', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([{ id: 'catalog:test', story_mode: 'catalog', status: 'published' }]),
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => [{ fn: { status: 'insufficient', required: 150, available: 20 } }],
    })
    mocks.getCreditBalance.mockResolvedValue(20)

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.status).toBe('WAITING_FOR_CREDITS')
    expect(json.requiredCredits).toBe(150)
  })

  it('POST returns 200 on successful bundle unlock', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([{ id: 'catalog:test', story_mode: 'catalog', status: 'published' }]),
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => [{ fn: { status: 'ok', price_paid: 140, spent_offset: 10 } }],
    })
    mocks.getCreditBalance.mockResolvedValue(60)

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ status: 'ok', pricePaid: 140, balance: 60 })
  })

  it('POST returns 200 on duplicate purchase (idempotent)', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([{ id: 'catalog:test', story_mode: 'catalog', status: 'published' }]),
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => [{ fn: { status: 'duplicate', price_paid: 0 } }],
    })
    mocks.getCreditBalance.mockResolvedValue(60)

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ status: 'ok', pricePaid: 0, balance: 60 })
  })

  it('POST returns 500 when spendCatalogBundle throws error', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([{ id: 'catalog:test', story_mode: 'catalog', status: 'published' }]),
    })
    mocks.rpcOne.mockReturnValue({
      execute: async () => {
        throw new Error('Database connection failed')
      },
    })

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Gagal memproses pembelian paket.')
  })

  it('GET returns 404 when story is not found or not published', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    mocks.getDb.mockReturnValue({
      selectFrom: () => createChain([]),
    })

    const req = new Request('http://localhost/api/stories/catalog:missing/bundle', { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ id: 'catalog:missing' }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Cerita tidak ditemukan.')
  })

  it('GET returns bundle quote with fair price and savings from the shared SQL spent function', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    const catalogChain = createChain([
      { bundle_price: 150, chapter_price: 5, total_chapters: 50, story_mode: 'catalog', status: 'published' },
    ])
    mocks.getDb.mockReturnValue({
      selectFrom: () => catalogChain,
    })
    mocks.rpcOne.mockReturnValue({ execute: async () => [{ fn: 10 }] })

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(mocks.rpcOne).toHaveBeenCalledWith(expect.anything(), 'catalog_bundle_spent_v1', {
      p_user_id: 'u1',
      p_story_id: 'catalog:test',
    })
    expect(json.bundlePrice).toBe(150)
    expect(json.alreadySpent).toBe(10)
    expect(json.price).toBe(140)
    // 47 bab berbayar x 5 = 235 eceran; bayar total 10 + 140 = 150 -> hemat 85
    expect(json.savings).toBe(85)
  })

  it('GET returns quote for guest user (user is null) without querying rpc and alreadySpent 0', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const catalogChain = createChain([
      { bundle_price: 150, chapter_price: 5, total_chapters: 50, story_mode: 'catalog', status: 'published' },
    ])
    mocks.getDb.mockReturnValue({
      selectFrom: () => catalogChain,
    })

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(mocks.rpcOne).not.toHaveBeenCalled()
    expect(json.bundlePrice).toBe(150)
    expect(json.alreadySpent).toBe(0)
    expect(json.price).toBe(150)
    expect(json.savings).toBe(85)
  })

  it('GET normalizes encoded id (catalog%3Atest -> catalog:test)', async () => {
    mocks.getSessionUser.mockResolvedValue(null)
    const queriedStoryIds: string[] = []
    const builder = {
      innerJoin: () => builder,
      leftJoin: () => builder,
      select: () => builder,
      where: (col: string, op: string, val: string) => {
        if (col === 'catalog_stories.story_id') {
          queriedStoryIds.push(val)
        }
        return builder
      },
      limit: () => builder,
      execute: async () => [
        { bundle_price: 150, chapter_price: 5, total_chapters: 50, story_mode: 'catalog', status: 'published' },
      ],
    }
    mocks.getDb.mockReturnValue({
      selectFrom: () => builder,
    })

    const req = new Request('http://localhost/api/stories/catalog%3Atest/bundle', { method: 'GET' })
    const res = await GET(req, { params: Promise.resolve({ id: 'catalog%3Atest' }) })
    expect(res.status).toBe(200)
    expect(queriedStoryIds).toContain('catalog:test')
    expect(queriedStoryIds).not.toContain('catalog%3Atest')
  })

  it('getCatalogBundleQuote returns null when status is null', async () => {
    mocks.getDb.mockReturnValue({
      selectFrom: () =>
        createChain([
          { bundle_price: 150, chapter_price: 5, total_chapters: 50, story_mode: 'catalog', status: null },
        ]),
    })

    const quote = await getCatalogBundleQuote('catalog:test', null)
    expect(quote).toBeNull()
  })

  it('getCatalogBundleQuote returns null when story_mode is null', async () => {
    mocks.getDb.mockReturnValue({
      selectFrom: () =>
        createChain([
          { bundle_price: 150, chapter_price: 5, total_chapters: 50, story_mode: null, status: 'published' },
        ]),
    })

    const quote = await getCatalogBundleQuote('catalog:test', null)
    expect(quote).toBeNull()
  })

  it('POST returns 500 when stories query errors', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: () =>
        createChain(async () => {
          throw new Error('Database connection failed')
        }),
    })

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Gagal memuat paket cerita.')
  })

  it('POST returns 500 when catalog_stories query errors', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'u1' })
    mocks.getDb.mockReturnValue({
      selectFrom: (table: string) => {
        if (table === 'stories') {
          return createChain([{ id: 'catalog:test', story_mode: 'catalog' }])
        }
        return createChain(async () => {
          throw new Error('Catalog DB error')
        })
      },
    })

    const req = new Request('http://localhost/api/stories/catalog:test/bundle', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ id: 'catalog:test' }) })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Gagal memuat paket cerita.')
  })
})
