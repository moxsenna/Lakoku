import { describe, expect, it, vi } from 'vitest'
import {
  createDeterministicProvider,
  DEFAULT_RUNTIME_POLICY,
  type CatalogReactionsProviderInput,
  type GenerationProvider,
} from '@lakoku/ai-gateway'
import type { CanonSnapshot } from '@lakoku/narrative-core'
import { fantasiPetualanganContract } from '@/fixtures/contracts/fantasi-petualangan'
import {
  buildCatalogContinuation,
  generateCatalogNovel,
  regenerateCatalogSpineChapter,
  validateCatalogReactions,
  type CatalogGeneratedChapter,
  type CatalogGeneratorStoryState,
  type CatalogGeneratorWriter,
} from '@/lib/catalog/generator.server'
import { normalizeCatalogEndings } from '@/lib/catalog/catalog-contract'

vi.mock('server-only', () => ({}))

const STORY_ID = 'catalog:uji-engine'
const CONTRACT = normalizeCatalogEndings({
  ...fantasiPetualanganContract,
  storyId: STORY_ID,
})

function emptyChapterRef(title = 'Bab'): { title: string; paragraphs: string[] } {
  return { title, paragraphs: ['Paragraf kontinuitas. Narasi berlanjut dari bab sebelumnya.'] }
}

function makeState(overrides?: Partial<CatalogGeneratorStoryState>): CatalogGeneratorStoryState {
  return {
    status: 'draft',
    contract: CONTRACT,
    spine: new Map(),
    variants: new Map(),
    ...overrides,
  }
}

interface WriterCalls {
  spine: CatalogGeneratedChapter[]
  variants: Array<{ endingKey: string; chapter: CatalogGeneratedChapter }>
  deleted: number[]
  progress: number[]
  generating: number
  reviews: number
}

function makeWriter(state: CatalogGeneratorStoryState): { writer: CatalogGeneratorWriter; calls: WriterCalls } {
  const calls: WriterCalls = { spine: [], variants: [], deleted: [], progress: [], generating: 0, reviews: 0 }
  const writer: CatalogGeneratorWriter = {
    async loadState() {
      return {
        ...state,
        spine: new Map(state.spine),
        variants: new Map([...state.variants].map(([key, map]) => [key, new Map(map)])),
      }
    },
    async loadCanon(): Promise<CanonSnapshot> {
      return {
        storyId: STORY_ID,
        characters: [{
          id: 'c:main',
          storyId: STORY_ID,
          canonicalName: CONTRACT.mainCharacter.name,
          role: 'protagonis',
          motivation: 'Menutup masa lalu yang menagihnya pulang.',
          introducedChapter: 1,
          status: 'ALIVE',
        }],
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
    },
    async markGenerating() {
      calls.generating += 1
    },
    async writeSpineChapter(_storyId, chapter) {
      calls.spine.push(chapter)
    },
    async writeVariantChapter(_storyId, endingKey, chapter) {
      calls.variants.push({ endingKey, chapter })
    },
    async deleteSpineChapter(_storyId, chapterNumber) {
      calls.deleted.push(chapterNumber)
    },
    async setProgress(_storyId, progress) {
      calls.progress.push(progress)
    },
    async markReview() {
      calls.reviews += 1
    },
  }
  return { writer, calls }
}

function recordingProvider() {
  const base = createDeterministicProvider(DEFAULT_RUNTIME_POLICY)
  const choiceInputs: Array<Record<string, unknown>> = []
  const reactionInputs: CatalogReactionsProviderInput[] = []
  const provider: GenerationProvider = {
    ...base,
    name: 'recording-deterministic',
    async generateChoices(input, options) {
      choiceInputs.push(input as unknown as Record<string, unknown>)
      return base.generateChoices!(input, options)
    },
    async generateCatalogReactions(input, options) {
      reactionInputs.push(input)
      return base.generateCatalogReactions!(input, options)
    },
  }
  return { provider, choiceInputs, reactionInputs }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

describe('buildCatalogContinuation', () => {
  it('never carries a previous choice into the next spine brief', () => {
    const continuation = buildCatalogContinuation({
      storyId: STORY_ID,
      contract: CONTRACT,
      targetChapterNumber: 7,
      previousChapter: { title: 'Bab 6', paragraphs: ['Satu.', 'Dua.', 'Tiga.', 'Empat.', 'Lima.', 'Enam.'] },
      previousChapterNumber: 6,
      lockedEndingKey: null,
    })
    expect(continuation.previousChoice).toBeNull()
    expect(continuation.previousChapter?.number).toBe(6)
    expect(continuation.previousChapter?.endingParagraphs).toHaveLength(5)
    expect(continuation.storyAnchors?.corePromise).toBe(CONTRACT.corePromise)
    expect(continuation.lockedEndingKey).toBeNull()
  })

  it('passes the locked ending key for variant chapters', () => {
    const continuation = buildCatalogContinuation({
      storyId: STORY_ID,
      contract: CONTRACT,
      targetChapterNumber: 46,
      previousChapter: { title: 'Bab 45', paragraphs: ['Isi.'] },
      previousChapterNumber: 45,
      lockedEndingKey: CONTRACT.endingCandidates[2]!.key,
    })
    expect(continuation.lockedEndingKey).toBe(CONTRACT.endingCandidates[2]!.key)
    expect(continuation.previousChoice).toBeNull()
  })
})

describe('normalizeCatalogEndings', () => {
  it('keeps exactly 2 main + 1 secret endings from a wider contract', () => {
    const normalized = normalizeCatalogEndings({ ...fantasiPetualanganContract, storyId: STORY_ID })
    expect(normalized.endingCandidates).toHaveLength(3)
    expect(normalized.endingCandidates.filter((candidate) => candidate.kind === 'main')).toHaveLength(2)
    expect(normalized.endingCandidates.filter((candidate) => candidate.kind === 'secret')).toHaveLength(1)
  })

  it('rejects a contract without a secret ending', () => {
    const noSecret = {
      ...fantasiPetualanganContract,
      storyId: STORY_ID,
      endingCandidates: fantasiPetualanganContract.endingCandidates.filter((c) => c.kind === 'main'),
    }
    expect(() => normalizeCatalogEndings(noSecret as typeof fantasiPetualanganContract)).toThrow(
      /CATALOG_ENDINGS_INVALID/,
    )
  })
})

describe('validateCatalogReactions', () => {
  const choices = [{ id: 'opt-1' }, { id: 'opt-2' }]

  function reactionFor(id: string, words: number, hint?: string) {
    const paragraph = Array.from({ length: words }, (_, i) => `kata${i}`).join(' ')
    return { choiceId: id, paragraphs: [paragraph], ...(hint ? { directionHint: hint } : {}) }
  }

  it('accepts reactions covering every choice and keeps safe hints', () => {
    const reactions = validateCatalogReactions({
      choices,
      raw: { reactions: [reactionFor('opt-1', 60, 'Suasanamu perlahan berubah mengikuti langkah ini.'), reactionFor('opt-2', 50)] },
    })
    expect(reactions).toHaveLength(2)
    expect(reactions[0]?.directionHint).toBe('Suasanamu perlahan berubah mengikuti langkah ini.')
    expect(reactions[1]?.directionHint).toBeUndefined()
  })

  it('rejects reactions below the 40-word floor', () => {
    expect(() => validateCatalogReactions({
      choices,
      raw: { reactions: [reactionFor('opt-1', 10), reactionFor('opt-2', 60)] },
    })).toThrow(/CATALOG_REACTIONS_INVALID:kata/)
  })

  it('rejects a missing or unknown choice reaction', () => {
    expect(() => validateCatalogReactions({
      choices,
      raw: { reactions: [reactionFor('opt-1', 60)] },
    })).toThrow(/reaksi hilang/)
    expect(() => validateCatalogReactions({
      choices,
      raw: { reactions: [reactionFor('opt-1', 60), reactionFor('opt-9', 60)] },
    })).toThrow(/tak dikenal/)
  })

  it('drops hints that leak internal routing language', () => {
    const reactions = validateCatalogReactions({
      choices,
      raw: { reactions: [reactionFor('opt-1', 60, 'Pilihan ini menggeser rute cerita.'), reactionFor('opt-2', 60)] },
    })
    expect(reactions[0]?.directionHint).toBeUndefined()
  })
})

describe('generateCatalogNovel', () => {
  it('writes 44 deferred spine chapters, forks 3 ending variants, and finishes in review', { timeout: 300_000 }, async () => {
    const { provider, choiceInputs } = recordingProvider()
    const { writer, calls } = makeWriter(makeState())
    const result = await generateCatalogNovel(
      { provider, writer },
      { storyId: STORY_ID, runId: 'test-full', log: () => {} },
    )

    expect(result.completed).toBe(true)
    expect(calls.spine).toHaveLength(44)
    expect(calls.variants).toHaveLength(18)
    expect(new Set(calls.variants.map((entry) => entry.endingKey))).toEqual(
      new Set(CONTRACT.endingCandidates.map((candidate) => candidate.key)),
    )

    // Deferred mode: brief pilihan tanpa jejak pilihan pembaca.
    expect(choiceInputs.length).toBeGreaterThan(0)
    for (const input of choiceInputs) {
      expect(input.choiceHistory).toEqual([])
      const routeState = input.routeState as { endingBias?: Record<string, number> }
      expect(routeState.endingBias ?? {}).toEqual({})
    }

    // Bab 44 memaksa 3 pilihan ending dengan bias kandidat.
    const bab44 = calls.spine.find((chapter) => chapter.chapterNumber === 44)
    expect(bab44?.choices).toHaveLength(3)
    expect(bab44?.outcomes).toHaveLength(3)
    const bab44Keys = new Set(CONTRACT.endingCandidates.map((candidate) => candidate.key))
    for (const outcome of bab44?.outcomes ?? []) {
      const deltas = outcome.effect.endingBiasDeltas as Record<string, number>
      expect(Object.keys(deltas)).toHaveLength(1)
      expect(bab44Keys.has(Object.keys(deltas)[0]!)).toBe(true)
      expect(Object.values(deltas)[0]).toBe(10)
      expect(outcome.nextChapterNumber).toBe(45)
      expect(outcome.directionHint).toBeTruthy()
      expect(outcome.consequence.reduce((sum, p) => sum + countWords(p), 0)).toBeGreaterThanOrEqual(40)
    }

    // Reaksi semua pilihan spine lolos batas bawah kata.
    for (const chapter of calls.spine) {
      for (const outcome of chapter.outcomes) {
        expect(outcome.consequence.length).toBeGreaterThanOrEqual(1)
        expect(outcome.consequence.reduce((sum, p) => sum + countWords(p), 0)).toBeGreaterThanOrEqual(40)
      }
    }

    // Bab 50 tiap varian: tanpa pilihan, tanpa outcome.
    for (const entry of calls.variants.filter((entry) => entry.chapter.chapterNumber === 50)) {
      expect(entry.chapter.choices).toEqual([])
      expect(entry.chapter.outcomes).toEqual([])
      expect(entry.chapter.choicePrompt).toBeNull()
    }

    // Progres dan status.
    expect(calls.generating).toBe(1)
    expect(calls.progress.at(-1)).toBe(50)
    expect(calls.reviews).toBe(1)
    expect(choiceInputs.every((input) => (input.lockedEndingKey ?? null) === null || typeof input.lockedEndingKey === 'string')).toBe(true)
  })

  it('resumes from chapters already stored in the DB state', { timeout: 300_000 }, async () => {
    const { provider } = recordingProvider()
    const state = makeState()
    for (let n = 1; n <= 3; n++) state.spine.set(n, emptyChapterRef(`Bab ${n}`))
    const { writer, calls } = makeWriter(state)
    await generateCatalogNovel({ provider, writer }, { storyId: STORY_ID, runId: 'test-resume', log: () => {} })
    expect(calls.spine[0]?.chapterNumber).toBe(4)
    expect(calls.spine).toHaveLength(41)
  })

  it('stops at the chapter cap without marking review', { timeout: 120_000 }, async () => {
    const { provider } = recordingProvider()
    const { writer, calls } = makeWriter(makeState())
    const result = await generateCatalogNovel(
      { provider, writer },
      { storyId: STORY_ID, maxChapters: 5, runId: 'test-cap', log: () => {} },
    )
    expect(result.completed).toBe(false)
    expect(calls.spine).toHaveLength(5)
    expect(calls.variants).toHaveLength(0)
    expect(calls.progress.at(-1)).toBe(5)
    expect(calls.reviews).toBe(0)
  })

  it('refuses to run for unknown or closed stories', async () => {
    const { provider } = recordingProvider()
    const missingWriter = makeWriter(makeState())
    await expect(generateCatalogNovel(
      { provider, writer: { ...missingWriter.writer, loadState: async () => null } },
      { storyId: STORY_ID, runId: 'test-missing', log: () => {} },
    )).rejects.toThrow(/CATALOG_STORY_NOT_FOUND/)

    const closedWriter = makeWriter(makeState({ status: 'published' }))
    await expect(generateCatalogNovel(
      { provider, writer: closedWriter.writer },
      { storyId: STORY_ID, runId: 'test-closed', log: () => {} },
    )).rejects.toThrow(/CATALOG_STORY_CLOSED/)
  })
})

describe('regenerateCatalogSpineChapter', () => {
  it('deletes then rewrites one spine chapter', { timeout: 120_000 }, async () => {
    const { provider } = recordingProvider()
    const state = makeState({ status: 'review' })
    for (let n = 1; n <= 10; n++) state.spine.set(n, emptyChapterRef(`Bab ${n}`))
    const { writer, calls } = makeWriter(state)

    await regenerateCatalogSpineChapter(
      { provider, writer },
      { storyId: STORY_ID, chapterNumber: 7, runId: 'test-regen', log: () => {} },
    )
    expect(calls.deleted).toEqual([7])
    expect(calls.spine).toHaveLength(1)
    expect(calls.spine[0]?.chapterNumber).toBe(7)
    expect(calls.spine[0]?.outcomes.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects invalid chapter numbers and missing previous chapters', async () => {
    const { provider } = recordingProvider()
    const state = makeState()
    const { writer } = makeWriter(state)

    await expect(regenerateCatalogSpineChapter(
      { provider, writer },
      { storyId: STORY_ID, chapterNumber: 45, runId: 'x', log: () => {} },
    )).rejects.toThrow(/CATALOG_REGENERATE_CHAPTER_INVALID/)

    const emptyState = makeWriter(makeState())
    await expect(regenerateCatalogSpineChapter(
      { provider, writer: emptyState.writer },
      { storyId: STORY_ID, chapterNumber: 9, runId: 'x', log: () => {} },
    )).rejects.toThrow(/CATALOG_REGENERATE_PREVIOUS_MISSING/)
  })
})
