// tests/catalog/catalog-variant-reads.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVariantDb = {
  stories: [] as Array<Record<string, unknown>>,
  chapters: [] as Array<Record<string, unknown>>,
  endingChapters: [] as Array<Record<string, unknown>>,
  readerStates: [] as Array<Record<string, unknown>>,
  choiceOutcomes: [] as Array<Record<string, unknown>>,
}

let mockCurrentUser: { id: string } | null = { id: 'u-reader-1' }

vi.mock('server-only', () => ({}))

vi.mock('@/lib/api/user-state', () => ({
  getSessionUser: vi.fn(async () => mockCurrentUser),
  getReaderState: vi.fn(async (storyId: string) => {
    if (!mockCurrentUser) return null
    const row = mockVariantDb.readerStates.find(
      (r) => r.user_id === mockCurrentUser!.id && r.story_id === storyId,
    )
    if (!row) return null
    return {
      storyId: row.story_id,
      status: row.status ?? 'BERJALAN',
      currentChapter: row.current_chapter ?? 1,
      jejak: row.jejak ?? [],
      lockedEndingKey: row.locked_ending_key ?? null,
    }
  }),
}))

vi.mock('@lakoku/db', () => ({
  getDb: () => ({
    selectFrom: (table: string) => {
      const wheres: Array<{ col: string; op: string; val: unknown }> = []
      let limitVal: number | null = null
      let orderByCol: string | null = null
      let orderDir: 'asc' | 'desc' = 'asc'

      const builder = {
        select: () => builder,
        where: (col: unknown, op?: unknown, val?: unknown) => {
          if (typeof col === 'string' && typeof op === 'string') {
            wheres.push({ col, op, val })
          }
          return builder
        },
        orderBy: (col: string, dir: 'asc' | 'desc' = 'asc') => {
          orderByCol = col
          orderDir = dir
          return builder
        },
        limit: (n: number) => {
          limitVal = n
          return builder
        },
        execute: async () => {
          const rows =
            table === 'catalog_ending_chapters'
              ? mockVariantDb.endingChapters
              : table === 'reader_states'
                ? mockVariantDb.readerStates
                : table === 'stories'
                  ? mockVariantDb.stories
                  : table === 'chapters'
                    ? mockVariantDb.chapters
                    : table === 'choice_outcomes'
                      ? mockVariantDb.choiceOutcomes
                      : []
          let filtered = rows.filter((r) =>
            wheres.every(({ col, op, val }) => {
              if (op === '=') return r[col] === val
              if (op === '>=') return Number(r[col]) >= Number(val)
              if (op === '<=') return Number(r[col]) <= Number(val)
              return false
            }),
          )
          if (orderByCol) {
            filtered = [...filtered].sort((a, b) => {
              const diff = Number(a[orderByCol!]) - Number(b[orderByCol!])
              return orderDir === 'desc' ? -diff : diff
            })
          }
          if (limitVal != null) {
            return filtered.slice(0, limitVal)
          }
          return filtered
        },
      }
      return builder
    },
  }),
  single: async (promise: Promise<unknown[]>) => ({ data: (await promise)[0] ?? null, error: null }),
  result: async (promise: Promise<unknown[]>) => ({ data: await promise, error: null }),
}))

describe('catalog variant reader Bab 45-50', () => {
  beforeEach(() => {
    mockVariantDb.stories = []
    mockVariantDb.chapters = []
    mockVariantDb.endingChapters = []
    mockVariantDb.readerStates = []
    mockVariantDb.choiceOutcomes = []
    mockCurrentUser = { id: 'u-reader-1' }
  })

  it('returns null and does not leak variant when user has no locked ending key', async () => {
    const { getCatalogVariantChapter, getReaderLockedEndingKey } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.stories.push({
      id: 'catalog:test',
      story_mode: 'catalog',
    })
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:test',
      ending_key: 'ending_a',
      number: 45,
      title: 'Bab 45 Varian A',
      paragraphs: ['Paragraf varian A'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [],
    })

    const lock = await getReaderLockedEndingKey('catalog:test', 'u-reader-1')
    expect(lock).toBeNull()

    // Without lock key, variant chapter cannot be accessed
    const chapter = lock ? await getCatalogVariantChapter('catalog:test', 45, lock) : null
    expect(chapter).toBeNull()
  })

  it('reads variant chapter when reader has locked ending key', async () => {
    const { getCatalogVariantChapter } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.stories.push({
      id: 'catalog:test',
      story_mode: 'catalog',
    })
    mockVariantDb.endingChapters.push(
      {
        story_id: 'catalog:test',
        ending_key: 'ending_a',
        number: 45,
        title: 'Bab 45 Varian A',
        paragraphs: ['Paragraf varian A'],
        choices: [{ id: 'lanjut', label: 'Lanjut' }],
        choice_prompt: 'Pilihan 45',
        outcomes_json: [],
      },
      {
        story_id: 'catalog:test',
        ending_key: 'ending_b',
        number: 45,
        title: 'Bab 45 Varian B',
        paragraphs: ['Paragraf varian B'],
        choices: [{ id: 'lanjut', label: 'Lanjut' }],
        choice_prompt: 'Pilihan 45',
        outcomes_json: [],
      },
    )

    const chapterA = await getCatalogVariantChapter('catalog:test', 45, 'ending_a')
    expect(chapterA).not.toBeNull()
    expect(chapterA?.title).toBe('Bab 45 Varian A')
    expect(chapterA?.paragraphs).toEqual(['Paragraf varian A'])

    const chapterB = await getCatalogVariantChapter('catalog:test', 45, 'ending_b')
    expect(chapterB?.title).toBe('Bab 45 Varian B')
  })

  it('reads variant choice outcome from outcomes_json including directionHint', async () => {
    const { getCatalogVariantOutcome } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.stories.push({
      id: 'catalog:test',
      story_mode: 'catalog',
    })
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:test',
      ending_key: 'ending_a',
      number: 45,
      title: 'Bab 45 Varian A',
      paragraphs: ['...'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [
        {
          storyId: 'catalog:test',
          chapterNumber: 45,
          choiceId: 'choice-variant-1',
          consequence: ['Reaksi varian 45'],
          nextChapterNumber: 46,
          isEnding: false,
          directionHint: 'Petunjuk arah halus.',
        },
      ],
    })

    const outcome = await getCatalogVariantOutcome('catalog:test', 45, 'choice-variant-1', 'ending_a')
    expect(outcome).not.toBeNull()
    expect(outcome?.choiceId).toBe('choice-variant-1')
    expect(outcome?.consequence).toEqual(['Reaksi varian 45'])
    expect(outcome?.nextChapterNumber).toBe(46)
    expect(outcome?.isEnding).toBe(false)
    expect(outcome?.directionHint).toBe('Petunjuk arah halus.')
  })

  it('returns variant metadatas within number range', async () => {
    const { getCatalogVariantMetadatas } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.endingChapters.push(
      {
        story_id: 'catalog:test',
        ending_key: 'ending_a',
        number: 45,
        title: 'Bab 45 Varian A',
      },
      {
        story_id: 'catalog:test',
        ending_key: 'ending_a',
        number: 46,
        title: 'Bab 46 Varian A',
      },
      {
        story_id: 'catalog:test',
        ending_key: 'ending_b',
        number: 45,
        title: 'Bab 45 Varian B',
      },
    )

    const metadatas = await getCatalogVariantMetadatas('catalog:test', 45, 50, 'ending_a')
    expect(metadatas).toEqual([
      { number: 45, title: 'Bab 45 Varian A' },
      { number: 46, title: 'Bab 46 Varian A' },
    ])
  })

  it('decides catalog identity by DATA (stories.story_mode = catalog) not by prefix alone', async () => {
    const { isCatalogStory } = await import('@/lib/catalog/variant-reader.server')

    mockVariantDb.stories.push(
      { id: 'catalog:spoof', story_mode: 'standard' },
      { id: 'custom-catalog-999', story_mode: 'catalog' },
    )

    expect(await isCatalogStory('catalog:spoof')).toBe(false)
    expect(await isCatalogStory('custom-catalog-999')).toBe(true)
    expect(await isCatalogStory('nonexistent')).toBe(false)
  })

  it('queryChapter integration: reads variant for catalog story >= 45 when lock key is supplied', async () => {
    const { queryChapter } = await import('@/lib/api/queries')
    mockVariantDb.stories.push({
      id: 'catalog:novel-1',
      story_mode: 'catalog',
    })
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:novel-1',
      ending_key: 'ending_peace',
      number: 45,
      title: 'Bab 45 Akhir Damai',
      paragraphs: ['Paragraf damai.'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [],
    })

    // Without endingKey -> returns null (no leak)
    const withoutKey = await queryChapter('catalog:novel-1', 45, null)
    expect(withoutKey).toBeNull()

    // With matching endingKey -> returns variant
    const withKey = await queryChapter('catalog:novel-1', 45, 'ending_peace')
    expect(withKey).not.toBeNull()
    expect(withKey?.title).toBe('Bab 45 Akhir Damai')
  })

  it('queryChapter integration: Bab < 45 queries standard chapters table without extra catalog check', async () => {
    const { queryChapter } = await import('@/lib/api/queries')
    mockVariantDb.chapters.push({
      story_id: 'standard-story',
      number: 10,
      title: 'Bab 10 Biasa',
      paragraphs: ['Paragraf bab 10.'],
      choices: [],
      choice_prompt: '',
    })

    const chapter = await queryChapter('standard-story', 10)
    expect(chapter).not.toBeNull()
    expect(chapter?.title).toBe('Bab 10 Biasa')
  })

  it('queryChoiceOutcome integration: reads variant outcome for catalog >= 45', async () => {
    const { queryChoiceOutcome } = await import('@/lib/api/queries')
    mockVariantDb.stories.push({
      id: 'catalog:novel-1',
      story_mode: 'catalog',
    })
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:novel-1',
      ending_key: 'ending_peace',
      number: 45,
      title: 'Bab 45 Akhir Damai',
      paragraphs: ['...'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [
        {
          storyId: 'catalog:novel-1',
          chapterNumber: 45,
          choiceId: 'choice-45-a',
          consequence: ['Reaksi damai.'],
          nextChapterNumber: 46,
          isEnding: false,
          directionHint: 'Petunjuk damai.',
        },
      ],
    })

    const outcomeWithoutLock = await queryChoiceOutcome('catalog:novel-1', 45, 'choice-45-a', null)
    expect(outcomeWithoutLock).toBeNull()

    const outcomeWithLock = await queryChoiceOutcome('catalog:novel-1', 45, 'choice-45-a', 'ending_peace')
    expect(outcomeWithLock).not.toBeNull()
    expect(outcomeWithLock?.consequence).toEqual(['Reaksi damai.'])
    expect(outcomeWithLock?.directionHint).toBe('Petunjuk damai.')
  })

  it('queryChapterMetadatas integration: appends variant metadatas only when endingKey is provided', async () => {
    const { queryChapterMetadatas } = await import('@/lib/api/queries')
    mockVariantDb.stories.push({
      id: 'catalog:novel-1',
      story_mode: 'catalog',
    })
    for (let i = 1; i <= 44; i++) {
      mockVariantDb.chapters.push({
        story_id: 'catalog:novel-1',
        number: i,
        title: `Bab ${i}`,
      })
    }
    mockVariantDb.endingChapters.push(
      { story_id: 'catalog:novel-1', ending_key: 'ending_peace', number: 45, title: 'Bab 45 Damai' },
      { story_id: 'catalog:novel-1', ending_key: 'ending_peace', number: 46, title: 'Bab 46 Damai' },
    )

    const listWithoutLock = await queryChapterMetadatas('catalog:novel-1', 46, null)
    expect(listWithoutLock.length).toBe(44)
    expect(listWithoutLock[listWithoutLock.length - 1].number).toBe(44)

    const listWithLock = await queryChapterMetadatas('catalog:novel-1', 46, 'ending_peace')
    expect(listWithLock.length).toBe(46)
    expect(listWithLock[44].title).toBe('Bab 45 Damai')
    expect(listWithLock[45].title).toBe('Bab 46 Damai')
  })

  it('getChapterStatusForUser: ready when variant exists for locked user, failed when unlocked', async () => {
    const { getChapterStatusForUser } = await import('@/lib/api/chapter-status.server')
    mockVariantDb.stories.push({
      id: 'catalog:novel-1',
      title: 'Katalog Novel 1',
      story_mode: 'catalog',
      visibility: 'public',
      owner_user_id: null,
      cover: 'cover.jpg',
      tagline: 'Tagline',
      role: 'Protagonis',
      tropes: [],
      total_chapters: 50,
      synopsis: 'Sinopsis',
      status: 'BERJALAN',
      current_chapter: 45,
      jejak: [],
    })
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:novel-1',
      ending_key: 'ending_peace',
      number: 45,
      title: 'Bab 45 Damai',
      paragraphs: ['Paragraf damai.'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [],
    })

    // Unlocked user -> failed (chapter does not exist for this user)
    const unlockedStatus = await getChapterStatusForUser({
      userId: '10000000-0000-4000-8000-000000000001',
      storyId: 'catalog:novel-1',
      chapterNumber: 45,
    })
    expect(unlockedStatus.status).toBe('failed')

    // Locked user -> ready
    mockVariantDb.readerStates.push({
      user_id: '10000000-0000-4000-8000-000000000002',
      story_id: 'catalog:novel-1',
      locked_ending_key: 'ending_peace',
    })
    const lockedStatus = await getChapterStatusForUser({
      userId: '10000000-0000-4000-8000-000000000002',
      storyId: 'catalog:novel-1',
      chapterNumber: 45,
    })
    expect(lockedStatus.status).toBe('ready')
  })

  it('getChapter: unlocked reader on catalog Bab >= 45 returns null and never falls back to Bab 44', async () => {
    const { getChapter } = await import('@/lib/api/server')
    mockVariantDb.stories.push({
      id: 'catalog:novel-1',
      title: 'Katalog Novel 1',
      story_mode: 'catalog',
      visibility: 'public',
      owner_user_id: null,
      cover: 'cover.jpg',
      tagline: 'Tagline',
      role: 'Protagonis',
      tropes: [],
      total_chapters: 50,
      synopsis: 'Sinopsis',
      status: 'BERJALAN',
      current_chapter: 45,
      jejak: [],
    })
    // Bab 44 exists in standard spine
    mockVariantDb.chapters.push({
      story_id: 'catalog:novel-1',
      number: 44,
      title: 'Bab 44 Pilihan Kunci',
      paragraphs: ['Paragraf bab 44.'],
      choices: [],
      choice_prompt: '',
    })
    // Bab 45 variant exists
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:novel-1',
      ending_key: 'ending_peace',
      number: 45,
      title: 'Bab 45 Akhir Damai',
      paragraphs: ['Paragraf damai.'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [],
    })

    // Unlocked user (no locked_ending_key in readerStates)
    mockCurrentUser = { id: 'u-unlocked' }
    const chUnlocked = await getChapter('catalog:novel-1', 45)
    expect(chUnlocked).toBeNull()

    // Locked user -> returns variant chapter
    mockVariantDb.readerStates.push({
      user_id: 'u-locked',
      story_id: 'catalog:novel-1',
      status: 'BERJALAN',
      current_chapter: 45,
      jejak: [],
      locked_ending_key: 'ending_peace',
    })
    mockCurrentUser = { id: 'u-locked' }
    const chLocked = await getChapter('catalog:novel-1', 45)
    expect(chLocked).not.toBeNull()
    expect(chLocked?.title).toBe('Bab 45 Akhir Damai')
  })

  it('queryChoiceOutcome on spine drops unsafe direction_hint and keeps safe hint', async () => {
    const { queryChoiceOutcome } = await import('@/lib/api/queries')
    mockVariantDb.choiceOutcomes.push(
      {
        story_id: 'story:spine-safe',
        chapter_number: 10,
        choice_id: 'opt-safe',
        consequence: ['Reaksi aman.'],
        next_chapter_number: 11,
        is_ending: false,
        direction_hint: 'Raka mulai mempercayaimu.',
      },
      {
        story_id: 'story:spine-unsafe',
        chapter_number: 10,
        choice_id: 'opt-unsafe',
        consequence: ['Reaksi dengan istilah terlarang.'],
        next_chapter_number: 11,
        is_ending: false,
        direction_hint: 'Sistem AI menghitung skor bias menuju ending.',
      },
    )

    const safeOutcome = await queryChoiceOutcome('story:spine-safe', 10, 'opt-safe')
    expect(safeOutcome?.directionHint).toBe('Raka mulai mempercayaimu.')

    const unsafeOutcome = await queryChoiceOutcome('story:spine-unsafe', 10, 'opt-unsafe')
    expect(unsafeOutcome?.directionHint).toBeUndefined()
  })

  it('getCatalogVariantOutcome drops unsafe directionHint in variant outcome', async () => {
    const { getCatalogVariantOutcome } = await import('@/lib/catalog/variant-reader.server')
    mockVariantDb.endingChapters.push({
      story_id: 'catalog:test-variant-unsafe',
      ending_key: 'ending_secret',
      number: 46,
      title: 'Bab 46 Rahasia',
      paragraphs: ['...'],
      choices: [],
      choice_prompt: '',
      outcomes_json: [
        {
          storyId: 'catalog:test-variant-unsafe',
          chapterNumber: 46,
          choiceId: 'choice-unsafe',
          consequence: ['Konsekuensi varian'],
          nextChapterNumber: 47,
          isEnding: false,
          directionHint: 'Model narraza memperbarui token cerita.',
        },
      ],
    })

    const outcome = await getCatalogVariantOutcome(
      'catalog:test-variant-unsafe',
      46,
      'choice-unsafe',
      'ending_secret',
    )
    expect(outcome).not.toBeNull()
    expect(outcome?.directionHint).toBeUndefined()
  })
})
