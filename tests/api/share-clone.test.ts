import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  cookieFactory: vi.fn(),
  getUserMock: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.adminFactory,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.cookieFactory,
}))
vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: mocks.getUserMock,
}))
vi.mock('@lakoku/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getDb: mocks.getDb,
  }
})

function createKyselyDb(handlers: {
  selectFrom?: (table: string) => unknown[]
  insertInto?: (table: string, payload: unknown) => unknown
  updateTable?: (table: string, setValues: unknown) => void
}) {
  return {
    selectFrom: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      b.select = vi.fn(() => b)
      b.selectAll = vi.fn(() => b)
      b.where = vi.fn(() => b)
      b.orderBy = vi.fn(() => b)
      b.limit = vi.fn(() => b)
      b.execute = vi.fn(async () => {
        const rows = handlers.selectFrom ? handlers.selectFrom(table) : []
        return rows ?? []
      })
      return b
    }),
    insertInto: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      let valuesPayload: unknown = null
      b.values = vi.fn((vals: unknown) => {
        valuesPayload = vals
        return b
      })
      b.returning = vi.fn(() => b)
      b.execute = vi.fn(async () => {
        const res = handlers.insertInto ? handlers.insertInto(table, valuesPayload) : null
        return res ? (Array.isArray(res) ? res : [res]) : []
      })
      return b
    }),
    updateTable: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      let setPayload: unknown = null
      b.set = vi.fn((vals: unknown) => {
        setPayload = vals
        return b
      })
      b.where = vi.fn(() => b)
      b.execute = vi.fn(async () => {
        if (handlers.updateTable) handlers.updateTable(table, setPayload)
        return []
      })
      return b
    }),
    deleteFrom: vi.fn(() => {
      const b: Record<string, unknown> = {}
      b.where = vi.fn(() => b)
      b.execute = vi.fn(async () => [])
      return b
    }),
  }
}

describe('cloneStoryFromShare (T-SHARE-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when recipient user is not authenticated', async () => {
    mocks.getUserMock.mockResolvedValue(null)
    const { cloneStoryFromShare } = await import('@/lib/api/share')

    await expect(cloneStoryFromShare('test-slug')).rejects.toThrow(
      'Harus masuk untuk mencoba jalur sendiri.',
    )
  })

  it('fails closed when share link is not found', async () => {
    mocks.getUserMock.mockResolvedValue({ id: 'user-recipient-1' })
    const mockDb = createKyselyDb({
      selectFrom: () => [],
    })
    mocks.getDb.mockReturnValue(mockDb)

    const { cloneStoryFromShare } = await import('@/lib/api/share')
    await expect(cloneStoryFromShare('non-existent')).rejects.toThrow(
      'Tautan share tidak ditemukan.',
    )
  })

  it('reuses existing untouched clone when recipient already has one', async () => {
    mocks.getUserMock.mockResolvedValue({ id: 'user-recipient-1' })

    const linkData = {
      id: 'link-123',
      source_story_id: 'story-source-original',
      title: 'Kisah Asli',
      revoked_at: null,
      expires_at: null,
    }

    const startInsertData = { id: 'start-new-1' }

    const existingStart = {
      new_story_id: 'story-cloned-previous',
    }

    const existingStory = {
      id: 'story-cloned-previous',
      current_chapter: 1,
      jejak: [],
      status: 'BERJALAN',
    }

    const updateMock = vi.fn()
    const mockDb = createKyselyDb({
      selectFrom: (table) => {
        if (table === 'shared_story_links') return [linkData]
        if (table === 'shared_story_starts') return [existingStart]
        if (table === 'stories') return [existingStory]
        return []
      },
      insertInto: (table) => {
        if (table === 'shared_story_starts') return startInsertData
        return null
      },
      updateTable: (table, setValues) => {
        if (table === 'shared_story_starts') updateMock(setValues)
      },
    })
    mocks.getDb.mockReturnValue(mockDb)

    const { cloneStoryFromShare } = await import('@/lib/api/share')
    const result = await cloneStoryFromShare('valid-slug')

    expect(result.storyId).toBe('story-cloned-previous')
    expect(result.startId).toBe('start-new-1')
    expect(updateMock).toHaveBeenCalledWith({ new_story_id: 'story-cloned-previous' })
  })

  it('creates fresh cloned instance with remapped canon and Chapter 1', async () => {
    mocks.getUserMock.mockResolvedValue({ id: 'user-recipient-1' })

    const linkData = {
      id: 'link-456',
      source_story_id: 'story-src',
      title: 'Misteri Warung Tua',
      revoked_at: null,
      expires_at: null,
    }
    const startInsertData = { id: 'start-fresh-1' }

    const sourceStory = {
      id: 'story-src',
      title: 'Misteri Warung Tua',
      cover: '/covers/warung.webp',
      tagline: 'Misteri bersemi',
      role: 'Detektif Muda',
      tropes: ['misteri', 'investigasi'],
      total_chapters: 50,
      synopsis: 'Sinopsis lengkap misteri.',
      status: 'SELESAI',
      story_mode: 'personalized_ai',
      story_contract_version: 2,
    }

    const charactersData = [
      {
        id: 'story-src:char:nara-1',
        story_id: 'story-src',
        canonical_name: 'Nara',
        role: 'Protagonis',
        motivation: 'Menemukan kebenaran',
        introduced_chapter: 1,
      },
    ]

    const chapter1Data = {
      story_id: 'story-src',
      number: 1,
      title: 'Bab 1: Pintu yang Terbuka',
      paragraphs: ['Paragraf pembuka bab 1.'],
      choice_prompt: 'Apa yang kamu lakukan?',
      choices: [
        { id: 'pilih-1', text: 'Masuk ke dalam' },
        { id: 'pilih-2', text: 'Kembali besok' },
      ],
    }

    const outcome1Data = [
      {
        story_id: 'story-src',
        chapter_number: 1,
        choice_id: 'pilih-1',
        consequence: ['Kamu melangkah masuk ke ruangan pengap.'],
        next_chapter_number: 2,
        is_ending: false,
        effect_json: null,
        choice_kind: 'BRANCH',
      },
    ]

    const insertedRows: Record<string, unknown[]> = {}
    const updateMock = vi.fn()

    const mockDb = createKyselyDb({
      selectFrom: (table) => {
        if (table === 'shared_story_links') return [linkData]
        if (table === 'shared_story_starts') return []
        if (table === 'stories') return [sourceStory]
        if (table === 'characters') return charactersData
        if (table === 'chapters') return [chapter1Data]
        if (table === 'choice_outcomes') return outcome1Data
        return []
      },
      insertInto: (table, payload) => {
        if (table === 'shared_story_starts') return startInsertData
        insertedRows[table] = Array.isArray(payload) ? (payload as unknown[]) : [payload]
        return null
      },
      updateTable: (table, setValues) => {
        if (table === 'shared_story_starts') updateMock(setValues)
      },
    })
    mocks.getDb.mockReturnValue(mockDb)

    const { cloneStoryFromShare } = await import('@/lib/api/share')
    const result = await cloneStoryFromShare('valid-slug')

    expect(result.startId).toBe('start-fresh-1')
    expect(result.storyId).toMatch(/^misteri-warung-tua-[a-z0-9]{6}$/)

    // Verifikasi stories row
    const insertedStory = insertedRows['stories']?.[0] as Record<string, unknown>
    expect(insertedStory).toBeDefined()
    expect(insertedStory.id).toBe(result.storyId)
    expect(insertedStory.owner_user_id).toBe('user-recipient-1')
    expect(insertedStory.status).toBe('BERJALAN')
    expect(insertedStory.current_chapter).toBe(1)
    expect(insertedStory.jejak).toEqual([])
    expect(insertedStory.source_story_id).toBe('story-src')
    expect(insertedStory.visibility).toBe('private')

    // Verifikasi characters row remapped
    const insertedChar = insertedRows['characters']?.[0] as Record<string, unknown>
    expect(insertedChar).toBeDefined()
    expect(insertedChar.story_id).toBe(result.storyId)
    expect(insertedChar.id).toMatch(new RegExp(`^${result.storyId}:char:nara-[a-z0-9]{4}$`))
    expect(insertedChar.canonical_name).toBe('Nara')

    // Verifikasi chapter 1 row
    const insertedChapter = insertedRows['chapters']?.[0] as Record<string, unknown>
    expect(insertedChapter).toBeDefined()
    expect(insertedChapter.story_id).toBe(result.storyId)
    expect(insertedChapter.number).toBe(1)
    expect(insertedChapter.paragraphs).toEqual(['Paragraf pembuka bab 1.'])

    // Verifikasi choice outcome 1 row
    const insertedOutcome = insertedRows['choice_outcomes']?.[0] as Record<string, unknown>
    expect(insertedOutcome).toBeDefined()
    expect(insertedOutcome.story_id).toBe(result.storyId)
    expect(insertedOutcome.chapter_number).toBe(1)
    expect(insertedOutcome.choice_id).toBe('pilih-1')

    // Verifikasi reader states row
    const insertedReaderState = insertedRows['reader_states']?.[0] as Record<string, unknown>
    expect(insertedReaderState).toBeDefined()
    expect(insertedReaderState.user_id).toBe('user-recipient-1')
    expect(insertedReaderState.story_id).toBe(result.storyId)
    expect(insertedReaderState.status).toBe('BERJALAN')
    expect(insertedReaderState.current_chapter).toBe(1)

    // Verifikasi update ke shared_story_starts
    expect(updateMock).toHaveBeenCalledWith({ new_story_id: result.storyId })
  })
})
