import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  loadCanonSnapshot: vi.fn(),
  persistRetrievalLog: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@lakoku/db', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
vi.mock('@lakoku/narrative-core/server', () => ({
  loadCanonSnapshot: mocks.loadCanonSnapshot,
  // C-R1 #2: loadContinuationContextForChapter now fire-and-forgets the
  // retrieval log write; the fail-closed contract under test is unaffected.
  persistRetrievalLog: mocks.persistRetrievalLog.mockResolvedValue(undefined),
}))

import { loadContinuationContextForChapter } from '@/lib/runtime/continuation-context.server'

const OWNER_ID = '11111111-1111-4111-8111-111111111111'

const SNAPSHOT = {
  storyId: 'story-fc',
  characters: [
    {
      id: 'nadia',
      storyId: 'story-fc',
      canonicalName: 'Nadia',
      role: 'Protagonis',
      motivation: 'Mencari kebenaran',
      introducedChapter: 1,
      status: 'ALIVE' as const,
    },
  ],
  aliases: [],
  voiceSheets: [],
  facts: [],
  knowledge: [],
  secrets: [],
  timeline: [],
  threads: [],
  actRollups: [],
  blueprints: [],
}

const PREV_CHAPTER_WITH_CHOICES = {
  number: 1,
  title: 'Galeri Seni Malam Hari',
  paragraphs: ['Nadia menatap Raka.', 'Lukisan hancur.', 'Keputusan harus diambil.'],
  choices: [
    { id: 'choice-a', label: 'Hadapi pengadilan' },
    { id: 'choice-b', label: 'Cari bukti' },
  ],
}

const READER_ROW = {
  route_state: {},
  choice_history: [
    {
      chapterNumber: 1,
      choiceId: 'choice-a',
      label: 'Hadapi pengadilan',
      consequence: ['Nadia membawa kasus ke pengadilan'],
      effectSummary: { flagsSet: ['court_path'] },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  locked_ending_key: null,
}

/**
 * Table-router untuk klien Supabase palsu. Setiap tabel mengembalikan
 * builder ber-chain yang berakhir di maybeSingle().
 */
function installDb(options: {
  prevChapter?: unknown
  reader?: unknown | null
}) {
  const readerData = 'reader' in options ? options.reader : READER_ROW
  const prevData = 'prevChapter' in options ? options.prevChapter : PREV_CHAPTER_WITH_CHOICES
  mocks.from.mockImplementation((table: string) => {
    const result =
      table === 'stories'
        ? { data: { owner_user_id: OWNER_ID }, error: null }
        : table === 'reader_states'
          ? { data: readerData, error: null }
          : table === 'chapters'
            ? { data: prevData, error: null }
            : { data: null, error: null }

    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => result,
    }
    return builder
  })
}

describe('loadContinuationContextForChapter fail-closed contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadCanonSnapshot.mockResolvedValue(SNAPSHOT)
    installDb({})
  })

  it('chapter 1 is a legal no-op with null continuation', async () => {
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 1,
    })
    expect(result).toEqual({ ok: true, continuation: null })
  })

  it('N>1 with prior choices and explicit null trigger => REVIEW_REQUIRED', async () => {
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
      triggerChoiceId: null,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'REVIEW_REQUIRED',
      detail: 'TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER',
    })
  })

  it('HARDENING: N>1 with prior choices and trigger property ABSENT => REVIEW_REQUIRED', async () => {
    // A future caller must not be able to bypass the gate merely by omitting
    // the property. Data shape decides, not call shape.
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'REVIEW_REQUIRED',
      detail: 'TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER',
    })
  })

  it('N>1 with a trigger that has no matching history entry => REVIEW_REQUIRED', async () => {
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
      triggerChoiceId: 'choice-does-not-exist',
    })
    expect(result).toEqual({
      ok: false,
      kind: 'REVIEW_REQUIRED',
      detail: 'TRIGGER_CHOICE_NOT_FOUND',
    })
  })

  it('N>1 with a matching trigger resolves the exact history entry', async () => {
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
      triggerChoiceId: 'choice-a',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.continuation?.previousChoice?.choiceId).toBe('choice-a')
    expect(result.continuation?.previousChapter?.number).toBe(1)
  })

  it('N>1 without prior choices and no trigger is legal (choice rules skipped)', async () => {
    installDb({ prevChapter: { ...PREV_CHAPTER_WITH_CHOICES, choices: [] } })
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.continuation?.previousChoice ?? null).toBeNull()
  })

  it('missing reader state is TRANSIENT, never a silent continue', async () => {
    installDb({ reader: null })
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
      triggerChoiceId: 'choice-a',
    })
    expect(result).toEqual({
      ok: false,
      kind: 'TRANSIENT',
      detail: 'READER_STATE_MISSING',
    })
  })

  it('snapshot load failure is TRANSIENT', async () => {
    mocks.loadCanonSnapshot.mockRejectedValue(new Error('db down'))
    const result = await loadContinuationContextForChapter({
      storyId: 'story-fc',
      chapterNumber: 2,
      triggerChoiceId: 'choice-a',
    })
    expect(result).toEqual({
      ok: false,
      kind: 'TRANSIENT',
      detail: 'SNAPSHOT_LOAD_FAILED',
    })
  })
})
