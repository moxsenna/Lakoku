import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression: private story chapters must be readable after publish.
 *
 * Root cause of perpetual PREPARING UI:
 * - Chapter row exists (service role / admin can see it)
 * - queryChapter used cookie client + RLS story_is_owned_by_auth
 * - Cookie JWT missing/stale → null chapter → PREPARING forever
 * even though getStory authorized via admin path.
 */

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  cookieFactory: vi.fn(),
  anonFactory: vi.fn(),
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
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.cookieFactory,
}))

type Call = { method: string; args: unknown[] }

function createAdminDb(chapterRow: unknown | null) {
  const calls: Call[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] })
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'lte', 'order', 'limit']) {
        builder[method] = vi.fn((...args: unknown[]) => {
          calls.push({ method, args })
          return builder
        })
      }
      builder.maybeSingle = vi.fn(async () => {
        calls.push({ method: 'maybeSingle', args: [] })
        return { data: chapterRow, error: null }
      })
      return builder
    }),
  }
  return { client, calls }
}

const chapterRow = {
  story_id: 'kontrak-hati-yang-tertukar-853915',
  number: 1,
  title: 'Bekas Luka di Langit Senja',
  paragraphs: ['Aku membuka pintu.', 'Bau cat basah menusuk.'],
  choice_prompt: 'Apa yang kau lakukan?',
  choices: [
    { id: 'hadap', label: 'Hadapi' },
    { id: 'lari', label: 'Lari' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // Cookie client must NOT be required for private chapter read.
  mocks.cookieFactory.mockRejectedValue(new Error('cookie client should not be used'))
})

describe('private chapter read after publish', () => {
  it('reads chapter via admin client (not cookie RLS)', async () => {
    const db = createAdminDb(chapterRow)
    mocks.adminFactory.mockReturnValue(db.client)
    const { queryChapter } = await import('@/lib/api/queries')

    const chapter = await queryChapter('kontrak-hati-yang-tertukar-853915', 1)

    expect(chapter).not.toBeNull()
    expect(chapter?.title).toBe('Bekas Luka di Langit Senja')
    expect(chapter?.paragraphs).toHaveLength(2)
    expect(db.calls).toContainEqual({ method: 'from', args: ['chapters'] })
    expect(mocks.cookieFactory).not.toHaveBeenCalled()
    expect(mocks.adminFactory).toHaveBeenCalled()
  })

  it('returns null when chapter missing without throwing', async () => {
    const db = createAdminDb(null)
    mocks.adminFactory.mockReturnValue(db.client)
    const { queryChapter } = await import('@/lib/api/queries')

    await expect(queryChapter('missing-story', 1)).resolves.toBeNull()
  })
})
