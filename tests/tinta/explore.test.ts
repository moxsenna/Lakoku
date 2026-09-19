import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  anonFactory: vi.fn(),
  cookieFactory: vi.fn(),
  getReaderStates: vi.fn(),
  getSessionUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.anonFactory }))
vi.mock('@/lib/supabase/env', () => ({
  requireSupabaseUrl: () => 'http://local.invalid',
  requireSupabaseAnonKey: () => 'anon-test-key',
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.adminFactory,
}))
vi.mock('@lakoku/db', () => ({
  createAdminClient: mocks.adminFactory,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.cookieFactory,
}))
vi.mock('@/lib/api/user-state', () => ({
  getReaderStates: mocks.getReaderStates,
  getSessionUser: mocks.getSessionUser,
}))

import {
  STORY_READER_COLUMNS,
  queryPublicUserStories,
} from '@/lib/api/queries'
import { listExploreStories, listPublicUserStories } from '@/lib/api/server'
import type { ReaderState } from '@/lib/api/user-state'

type QueryCall = { method: string; args: unknown[] }

function createMockDb(result: { data: unknown; error: { message: string } | null }) {
  const calls: QueryCall[] = []
  const builder: Record<string, unknown> = {}

  for (const method of ['select', 'eq', 'not', 'or', 'order', 'limit', 'in', 'lte', 'is']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    })
  }

  builder.then = (
    resolve: (value: { data: unknown; error: { message: string } | null }) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)

  const client = {
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] })
      return builder
    }),
  }

  return { client, calls }
}

const SAMPLE_STORY_ROW_1 = {
  id: 'story-user-1',
  title: 'Kisah Penulis Satu',
  cover: '/covers/story-1.webp',
  tagline: 'Tagline cerita satu',
  role: 'Detektif',
  tropes: ['misteri', 'investigasi'],
  total_chapters: 50,
  synopsis: 'Sinopsis cerita satu',
  status: 'BERJALAN' as const,
  current_chapter: 10,
  jejak: [{ chapter: 1, decision: 'Pilihan 1', consequence: 'Konsekuensi 1' }],
  ending_name: null,
}

const SAMPLE_STORY_ROW_2 = {
  id: 'story-user-2',
  title: 'Kisah Penulis Dua',
  cover: null,
  tagline: 'Tagline cerita dua',
  role: 'Petualang',
  tropes: ['fantasi'],
  total_chapters: 50,
  synopsis: 'Sinopsis cerita dua',
  status: 'SELESAI' as const,
  current_chapter: 50,
  jejak: [],
  ending_name: 'Ending Sejati',
}

describe('Task P9: Public User Stories Explore & Rail (AC9.1 - AC9.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC9.1 & AC9.5: queryPublicUserStories query builder and filter guarantees', () => {
    it('executes admin query with visibility=public, owner not null, and non-demo/premium exclusions', async () => {
      const { client, calls } = createMockDb({
        data: [SAMPLE_STORY_ROW_1, SAMPLE_STORY_ROW_2],
        error: null,
      })
      mocks.adminFactory.mockReturnValue(client)

      const results = await queryPublicUserStories(12)

      // Verifikasi tabel dan select kolom reader
      expect(calls[0]).toEqual({ method: 'from', args: ['stories'] })
      expect(calls[1]).toEqual({ method: 'select', args: [STORY_READER_COLUMNS] })

      // Verifikasi filter ketat (AC9.1, AC9.5)
      const eqCalls = calls.filter((c) => c.method === 'eq')
      expect(eqCalls).toContainEqual({ method: 'eq', args: ['visibility', 'public'] })

      const notCalls = calls.filter((c) => c.method === 'not')
      expect(notCalls).toContainEqual({ method: 'not', args: ['owner_user_id', 'is', null] })
      expect(notCalls).toContainEqual({ method: 'not', args: ['id', 'like', 'demo:%'] })
      expect(notCalls).toContainEqual({ method: 'not', args: ['id', 'like', 'premium:%'] })

      // Verifikasi order terbaru dan limit
      const orderCall = calls.find((c) => c.method === 'order')
      expect(orderCall).toEqual({
        method: 'order',
        args: ['created_at', { ascending: false }],
      })

      const limitCall = calls.find((c) => c.method === 'limit')
      expect(limitCall).toEqual({ method: 'limit', args: [12] })

      // Verifikasi mapping hasil
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('story-user-1')
      expect(results[0].title).toBe('Kisah Penulis Satu')
      expect(results[0].cover).toBe('/covers/story-1.webp')
      expect(results[0].totalChapters).toBe(50)

      // Null cover di-resolve ke default
      expect(results[1].id).toBe('story-user-2')
      expect(results[1].cover).toBe('/covers/default-cover.webp')
      expect(results[1].endingName).toBe('Ending Sejati')
    })

    it('custom limit passed to queryPublicUserStories is respected', async () => {
      const { client, calls } = createMockDb({ data: [], error: null })
      mocks.adminFactory.mockReturnValue(client)

      await queryPublicUserStories(5)

      const limitCall = calls.find((c) => c.method === 'limit')
      expect(limitCall).toEqual({ method: 'limit', args: [5] })
    })

    it('throws error when database query fails', async () => {
      const { client } = createMockDb({
        data: null,
        error: { message: 'DB connection timeout' },
      })
      mocks.adminFactory.mockReturnValue(client)

      await expect(queryPublicUserStories(12)).rejects.toThrow(
        'queryPublicUserStories: DB connection timeout',
      )
    })
  })

  describe('AC9.2 (Amandemen PM): listExploreStories remains unchanged and separate', () => {
    it('listExploreStories queries only official demo/premium and does NOT call queryPublicUserStories', async () => {
      const { client, calls } = createMockDb({
        data: [
          {
            ...SAMPLE_STORY_ROW_1,
            id: 'demo:nusantara-1',
          },
        ],
        error: null,
      })
      mocks.adminFactory.mockReturnValue(client)
      mocks.getReaderStates.mockResolvedValue(new Map())

      const results = await listExploreStories()

      // listExploreStories menggunakan EXPLORE_STORY_FILTER (demo:%, premium:%)
      const orCalls = calls.filter((c) => c.method === 'or')
      expect(orCalls.length).toBeGreaterThan(0)
      expect(orCalls[0].args[0]).toBe('id.like.demo:%,id.like.premium:%')

      // Tidak ada filter not like demo:% di listExploreStories
      const notCalls = calls.filter((c) => c.method === 'not')
      expect(notCalls).toHaveLength(0)

      // Hasil demo yang belum dibaca statusnya BARU
      expect(results[0].id).toBe('demo:nusantara-1')
      expect(results[0].status).toBe('BARU')
      expect(results[0].currentChapter).toBe(1)
    })
  })

  describe('AC9.2 / AC9.3: listPublicUserStories personal progress overlay and dedupe', () => {
    it('overlays reader progress when reader_state exists for the public user story', async () => {
      const { client } = createMockDb({
        data: [SAMPLE_STORY_ROW_1],
        error: null,
      })
      mocks.adminFactory.mockReturnValue(client)

      const userStates = new Map<string, ReaderState>()
      userStates.set('story-user-1', {
        storyId: 'story-user-1',
        currentChapter: 15,
        status: 'BERJALAN',
        jejak: [{ chapter: 1, decision: 'Pilihan A', consequence: 'Konsekuensi A' }],
        endingName: undefined,
      })
      mocks.getReaderStates.mockResolvedValue(userStates)

      const results = await listPublicUserStories(12)

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('story-user-1')
      // Sesuai overlay personal pembaca
      expect(results[0].currentChapter).toBe(15)
      expect(results[0].status).toBe('BERJALAN')
      expect((results[0] as unknown as { jejak: unknown[] }).jejak).toHaveLength(1)
    })

    it('defaults to status BARU and currentChapter 1 when user has no reader_state', async () => {
      const { client } = createMockDb({
        data: [SAMPLE_STORY_ROW_1],
        error: null,
      })
      mocks.adminFactory.mockReturnValue(client)
      mocks.getReaderStates.mockResolvedValue(new Map())

      const results = await listPublicUserStories(12)

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('story-user-1')
      // Status bawaan row adalah BERJALAN, tapi bagi pembaca baru harus BARU & bab 1
      expect(results[0].status).toBe('BARU')
      expect(results[0].currentChapter).toBe(1)
      expect((results[0] as unknown as { jejak: unknown[] }).jejak).toEqual([])
      expect(results[0].endingName).toBeUndefined()
    })

    it('deduplicates duplicate IDs returned by query so the rail has unique story IDs', async () => {
      const { client } = createMockDb({
        data: [SAMPLE_STORY_ROW_1, SAMPLE_STORY_ROW_1, SAMPLE_STORY_ROW_2],
        error: null,
      })
      mocks.adminFactory.mockReturnValue(client)
      mocks.getReaderStates.mockResolvedValue(new Map())

      const results = await listPublicUserStories(12)

      expect(results).toHaveLength(2)
      expect(results.map((s) => s.id)).toEqual(['story-user-1', 'story-user-2'])
    })
  })

  describe('AC9.3 & AC9.4: Beranda Page wiring & rail guarantees', () => {
    it('app/(shell)/beranda/page.tsx imports and calls listPublicUserStories', () => {
      const filePath = join(process.cwd(), 'app/(shell)/beranda/page.tsx')
      const source = readFileSync(filePath, 'utf-8')

      expect(source).toContain('listPublicUserStories')
      expect(source).toContain('Dari Pembaca Lain')
      expect(source).toContain('DARI PENULIS')
    })

    it('filters out running/berjalan story from pembacaLain rail', () => {
      const filePath = join(process.cwd(), 'app/(shell)/beranda/page.tsx')
      const source = readFileSync(filePath, 'utf-8')

      // Sesuai pola existing: cerita yang sedang berjalan dikecualikan dari rail
      expect(source).toMatch(
        /pembacaLain\s*=\s*publicUserStories\.filter\(\s*\(s\)\s*=>\s*s\.id\s*!==\s*berjalan\?\.id\s*\)/,
      )
    })

    it('hides rail when pembacaLain is empty (empty state: section hilang)', () => {
      const filePath = join(process.cwd(), 'app/(shell)/beranda/page.tsx')
      const source = readFileSync(filePath, 'utf-8')

      // Section hanya dirender bila ada cerita: {pembacaLain.length > 0 && (...)}
      expect(source).toMatch(/pembacaLain\.length\s*>\s*0\s*&&/)
    })
  })
})
