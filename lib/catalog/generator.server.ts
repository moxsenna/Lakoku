import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import {
  generateChapter,
  generateChoiceBranch,
  type CatalogReactionsProviderInput,
  type ChapterDraftParsed,
  type GenerationProvider,
  type GenerationRuntimePolicy,
  type ChoiceInput,
} from '@lakoku/ai-gateway'
import type { CanonSnapshot, ChapterBlueprint } from '@lakoku/narrative-core'
import type { ContinuationContext } from '@/lib/narrative/continuation-context'
import { buildChapterBrief } from '@/lib/story-engine/chapter-brief'
import { buildPreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'
import { normalizeRouteState } from '@/lib/story-engine/route-state'
import { sanitizeDirectionHint } from '@/lib/catalog/reader-safe-hint'
import {
  assertCatalogContract,
  assertCatalogStoryId,
  CATALOG_SPINE_LAST_CHAPTER,
  CATALOG_VARIANT_FIRST_CHAPTER,
} from '@/lib/catalog/catalog-contract'
import type { StoryContract } from '@/lib/story-engine/story-contract'

export const DEFAULT_RUNTIME_POLICY: GenerationRuntimePolicy = {
  targetWordsMin: 800,
  targetWordsMax: 1000,
  targetScenes: 3,
}

const MAX_PROSE_ATTEMPTS = 10
const MAX_CHOICE_ATTEMPTS = 5
const MAX_REACTION_ATTEMPTS = 3
const ENDING_LOCK_BIAS_DELTA = 10
const DIRECTION_HINT_BIAS_THRESHOLD = 5
const PROOF_USER_ID = '00000000-0000-4000-8000-00000000ab00'

export interface CatalogOutcomeRow {
  choiceId: string
  label: string
  consequence: string[]
  nextChapterNumber: number | null
  isEnding: boolean
  effect: Record<string, unknown>
  directionHint?: string
}

export interface CatalogGeneratedChapter {
  chapterNumber: number
  title: string
  paragraphs: string[]
  choicePrompt: string | null
  choices: Array<{ id: string; label: string }>
  outcomes: CatalogOutcomeRow[]
}

export interface CatalogChapterRef {
  title: string
  paragraphs: string[]
}

export interface CatalogGeneratorStoryState {
  status: string
  contract: StoryContract
  spine: Map<number, CatalogChapterRef>
  variants: Map<string, Map<number, CatalogChapterRef>>
}

export interface CatalogGeneratorWriter {
  loadState(storyId: string): Promise<CatalogGeneratorStoryState | null>
  loadCanon(storyId: string): Promise<CanonSnapshot>
  markGenerating(storyId: string): Promise<void>
  writeSpineChapter(storyId: string, chapter: CatalogGeneratedChapter): Promise<void>
  writeVariantChapter(storyId: string, endingKey: string, chapter: CatalogGeneratedChapter): Promise<void>
  deleteSpineChapter(storyId: string, chapterNumber: number): Promise<void>
  setProgress(storyId: string, progress: number): Promise<void>
  markReview(storyId: string): Promise<void>
}

export interface CatalogGeneratorDeps {
  provider: GenerationProvider
  writer: CatalogGeneratorWriter
  policy?: GenerationRuntimePolicy
}

/**
 * Kontinuitas bab berikutnya untuk spine bersama: TANPA previousChoice.
 * Badan Bab N+1 tidak boleh mengasumsikan pilihan pembaca (mode deferred);
 * dampak pilihan hidup di reaksi dan effect_json, bukan di badan bab.
 */
export function buildCatalogContinuation(input: {
  storyId: string
  contract: StoryContract
  targetChapterNumber: number
  previousChapter: CatalogChapterRef | null
  previousChapterNumber: number | null
  lockedEndingKey: string | null
  previousTitles?: string[]
}): ContinuationContext {
  return {
    storyId: input.storyId,
    targetChapterNumber: input.targetChapterNumber,
    previousChapter: input.previousChapter
      ? {
          number: input.previousChapterNumber ?? input.targetChapterNumber - 1,
          title: input.previousChapter.title,
          endingParagraphs: input.previousChapter.paragraphs.slice(-5),
        }
      : null,
    previousChoice: null,
    routeStateSummary: 'Cerita bersama: jalur pembaca menentukan arah, badan bab tetap netral.',
    openThreads: [],
    anchorFacts: [],
    recentTimeline: [],
    mustNotReveal: [],
    storyAnchors: {
      corePromise: input.contract.corePromise,
      mainConflict: input.contract.mainConflict,
      finalQuestion: input.contract.finalQuestion,
      styleProfile: input.contract.styleProfile,
    },
    actRollups: [],
    lockedEndingKey: input.lockedEndingKey,
    previousTitles: input.previousTitles,
  }
}

const CatalogReactionSchema = z.object({
  choiceId: z.string().trim().min(1).max(80),
  paragraphs: z.array(z.string().trim().min(40).max(600)).min(1).max(2),
  directionHint: z.string().trim().min(8).max(140).optional(),
})

export interface CatalogReaction {
  choiceId: string
  paragraphs: string[]
  directionHint?: string
}

const RUTE_PATTERN = /\brute\b/i

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function isReaderSafeParagraph(text: string): boolean {
  return !/\b(ai|narraza|rag|token|skor|bias|ending|pembaca)\b/i.test(text) && !RUTE_PATTERN.test(text)
}

/**
 * Validasi reaksi katalog: pilihan harus terjawab lengkap, tiap reaksi
 * 1-2 paragraf dengan total 40-220 kata (target 60-150), dan bebas istilah
 * internal. Hint tidak aman dibuang, bukan menolak seluruh reaksi.
 */
export function validateCatalogReactions(input: {
  choices: Array<{ id: string }>
  raw: unknown
}): CatalogReaction[] {
  const rawRecord = (input.raw ?? {}) as Record<string, unknown>
  const parsed = z.object({ reactions: z.array(CatalogReactionSchema) }).safeParse(rawRecord)
  if (!parsed.success) {
    throw new Error(`CATALOG_REACTIONS_INVALID:${parsed.error.issues[0]?.message ?? 'schema'}`)
  }
  const expected = new Set(input.choices.map((choice) => choice.id))
  const byId = new Map<string, CatalogReaction>()
  for (const reaction of parsed.data.reactions) {
    if (!expected.has(reaction.choiceId)) {
      throw new Error(`CATALOG_REACTIONS_INVALID:choiceId tak dikenal ${reaction.choiceId}`)
    }
    if (byId.has(reaction.choiceId)) {
      throw new Error(`CATALOG_REACTIONS_INVALID:duplikat ${reaction.choiceId}`)
    }
    const totalWords = reaction.paragraphs.reduce((sum, p) => sum + countWords(p), 0)
    if (totalWords < 40 || totalWords > 220) {
      throw new Error(`CATALOG_REACTIONS_INVALID:kata ${totalWords} untuk ${reaction.choiceId}`)
    }
    for (const paragraph of reaction.paragraphs) {
      if (!isReaderSafeParagraph(paragraph)) {
        throw new Error(`CATALOG_REACTIONS_INVALID:istilah terlarang pada ${reaction.choiceId}`)
      }
    }
    byId.set(reaction.choiceId, {
      choiceId: reaction.choiceId,
      paragraphs: [...reaction.paragraphs],
      directionHint: reaction.directionHint && !RUTE_PATTERN.test(reaction.directionHint)
        ? sanitizeDirectionHint(reaction.directionHint)
        : undefined,
    })
  }
  for (const choice of input.choices) {
    if (!byId.has(choice.id)) {
      throw new Error(`CATALOG_REACTIONS_INVALID:reaksi hilang untuk ${choice.id}`)
    }
  }
  return [...byId.values()]
}

function blueprintForChapter(snapshot: CanonSnapshot, n: number): ChapterBlueprint {
  const blueprint = snapshot.blueprints.find((item) => item.chapterNumber === n)
  if (!blueprint) throw new Error(`CATALOG_BLUEPRINT_MISSING:${n}`)
  return blueprint
}

function snapshotWithContract(canon: CanonSnapshot, contract: StoryContract): CanonSnapshot {
  return {
    ...canon,
    blueprints: contract.chapterTargets.map((target) => ({
      chapterNumber: target.chapterNumber,
      phase: target.phase,
      chapterGoal: target.goal,
      mandatoryBeats: [...target.mustInclude],
      forbiddenReveals: [...target.mustNotReveal],
      allowedStateDelta: {},
      introducesCharacters: [],
      version: 1,
      reconciledFromVersion: null,
      reconciliationReason: null,
    })),
    secrets: contract.revealRunway.map((reveal) => ({
      id: reveal.secretId,
      description: `Rahasia ${reveal.secretId}`,
      revealGateChapter: reveal.revealGateChapter,
      revealed: false,
    })),
  }
}

function timelineFor(chapters: Array<{ number: number; title: string; chosen?: string }>): CanonSnapshot['timeline'] {
  return chapters.map((chapter) => ({
    chapterNumber: chapter.number,
    ordinal: 1,
    description: `Bab ${chapter.number} "${chapter.title}" — ${chapter.chosen ?? 'babak bersama'}.`,
    isFlashback: false,
    occursAt: chapter.number,
  }))
}

function executionOptions(args: {
  runId: string
  storyId: string
  chapterNumber: number
  attempt: number
  phase: string
}) {
  return {
    telemetryContext: {
      // Skema telemetri mewajibkan correlationId UUID. jobId/attemptNumber
      // sengaja null berdua: trigger identity menuntut baris generation_jobs
      // asli untuk job_id tak-null, dan generator berjalan di luar lifecycle
      // job produksi. Tanpa ini rekaman biaya dibuang (CI-6).
      correlationId: randomUUID(),
      storyId: args.storyId,
      chapterNumber: args.chapterNumber,
      userId: PROOF_USER_ID,
      generationKind: 'personalized' as const,
      jobId: null,
      attemptNumber: null,
    },
    workflowPhase: args.phase,
    writerLengthRepairV1: { enabled: true },
  }
}

function truncateAtWord(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
}

function endingLockChoiceLabel(candidateName: string, condition: string): string {
  const fromCondition = truncateAtWord(condition, 90)
  if (fromCondition.length >= 8 && isReaderSafeParagraph(fromCondition)) return fromCondition
  const fromName = truncateAtWord(candidateName, 90)
  if (fromName.length >= 8 && isReaderSafeParagraph(fromName)) return fromName
  return 'Ambil langkah yang menentukan takdirmu'
}

interface GeneratedProse {
  title: string
  paragraphs: string[]
  /** Draft penuh dari gateway — dipakai utuh sebagai input choice branch. */
  draft: ChapterDraftParsed
}

async function generateProseWithRetry(deps: CatalogGeneratorDeps, args: {
  runId: string
  storyId: string
  snapshot: CanonSnapshot
  contract: StoryContract
  chapterNumber: number
  continuation: ContinuationContext
  chapterBrief: ReturnType<typeof buildChapterBrief>
  blueprint: ChapterBlueprint
  log?: (message: string) => void
}): Promise<GeneratedProse> {
  const preProseBrief = buildPreProseChapterBrief({
    storyId: args.storyId,
    chapterNumber: args.chapterNumber,
    snapshot: args.snapshot,
    blueprint: args.blueprint,
    continuation: args.continuation,
    chapterBrief: args.chapterBrief,
  })
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_PROSE_ATTEMPTS; attempt++) {
    try {
      const result = await generateChapter({ provider: deps.provider }, {
        snapshot: args.snapshot,
        blueprint: args.blueprint,
        chapterNumber: args.chapterNumber,
        continuation: args.continuation,
        brief: preProseBrief,
        genre: args.contract.genre,
        executionOptions: executionOptions({
          runId: args.runId,
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
          attempt,
          phase: 'CATALOG_CHAPTER_PROSE',
        }),
      })
      if (result.status === 'PUBLISHED' && result.draft) {
        return {
          title: result.draft.title,
          paragraphs: [...result.draft.paragraphs],
          draft: result.draft,
        }
      }
      lastError = new Error(`CATALOG_PROSE_NOT_PUBLISHED:${result.status}`)
    } catch (error) {
      lastError = error
    }
    args.log?.(`Bab ${args.chapterNumber} prosa percobaan ${attempt} gagal.`)
    if (attempt < MAX_PROSE_ATTEMPTS) {
      const delayMs = Math.min(attempt * 2000, 10_000)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('CATALOG_PROSE_FAILED')
}

async function generateSpineChoices(deps: CatalogGeneratorDeps, args: {
  runId: string
  storyId: string
  snapshot: CanonSnapshot
  chapterNumber: number
  chapterBrief: ReturnType<typeof buildChapterBrief>
  draft: GeneratedProse
  lockedEndingKey: string | null
  log?: (message: string) => void
}): Promise<{ choicePrompt: string; choices: Array<{ id: string; label: string }>; outcomes: Array<{ choiceId: string; effect: Record<string, unknown> }> }> {
  const lastParagraphs: [string, string, string] = [
    (args.draft.paragraphs[args.draft.paragraphs.length - 3] ?? 'Paragraf satu.').slice(0, 400),
    (args.draft.paragraphs[args.draft.paragraphs.length - 2] ?? 'Paragraf dua.').slice(0, 400),
    (args.draft.paragraphs[args.draft.paragraphs.length - 1] ?? 'Paragraf tiga.').slice(0, 400),
  ]
  const choiceInput: ChoiceInput = {
    snapshot: args.snapshot,
    chapterBrief: args.chapterBrief,
    draft: { ...args.draft.draft, storyId: args.storyId },
    lastParagraphs,
    routeState: normalizeRouteState({}),
    choiceHistory: [],
    lockedEndingKey: args.lockedEndingKey,
  }
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_CHOICE_ATTEMPTS; attempt++) {
    try {
      const branch = await generateChoiceBranch(
        { provider: deps.provider },
        choiceInput,
        {
          telemetryContext: executionOptions({
            runId: args.runId,
            storyId: args.storyId,
            chapterNumber: args.chapterNumber,
            attempt,
            phase: 'CATALOG_CHAPTER_CHOICES',
          }).telemetryContext,
          workflowPhase: 'CATALOG_CHAPTER_CHOICES',
        },
      )
      if (branch && branch.choices.length >= 2) {
        return {
          choicePrompt: branch.choicePrompt,
          choices: branch.choices.map((choice) => ({ id: choice.id, label: choice.label })),
          outcomes: branch.outcomes.map((outcome) => ({
            choiceId: outcome.choiceId,
            effect: outcome.effect as Record<string, unknown>,
          })),
        }
      }
      lastError = new Error('CATALOG_CHOICE_BRANCH_EMPTY')
    } catch (error) {
      lastError = error
    }
    args.log?.(`Bab ${args.chapterNumber} pilihan percobaan ${attempt} gagal.`)
    if (attempt < MAX_CHOICE_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }

  // Fallback pilihan bersih jika model gagal menghasilkan pilihan actionable setelah beberapa percobaan
  const active = args.snapshot.characters.filter((c) => c.status !== 'DEAD' && c.introducedChapter <= args.chapterNumber)
  const leadName = active[0]?.canonicalName ?? 'lawan bicaramu'
  const fallbackChoices = [
    { id: `ch${args.chapterNumber}-opt-1`, label: `Hadapi ${leadName} secara langsung untuk menuntut penjelasan` },
    { id: `ch${args.chapterNumber}-opt-2`, label: `Tahan langkah dan selidiki bukti secara diam-diam` },
  ]
  const fallbackOutcomes = fallbackChoices.map((c) => ({
    choiceId: c.id,
    effect: { flagsSet: { [`ch${args.chapterNumber}_action`]: true } },
  }))
  args.log?.(`Bab ${args.chapterNumber} memakai pilihan fallback terarah setelah ${MAX_CHOICE_ATTEMPTS} percobaan model gagal.`)
  return {
    choicePrompt: `Apa langkah yang akan kamu ambil saat situasi ini memuncak?`,
    choices: fallbackChoices,
    outcomes: fallbackOutcomes,
  }
}

async function generateReactionsWithRetry(deps: CatalogGeneratorDeps, args: {
  runId: string
  storyId: string
  chapterNumber: number
  chapterTitle: string
  mainCharacterName: string
  choices: Array<{ id: string; label: string }>
  chapterLastParagraphs: string[]
  endingCandidates: Array<{ key: string; name: string }>
  lockedEndingKey: string | null
  isEndingLockChapter: boolean
  log?: (message: string) => void
}): Promise<CatalogReaction[]> {
  const providerInput: CatalogReactionsProviderInput = {
    storyId: args.storyId,
    chapterNumber: args.chapterNumber,
    chapterTitle: args.chapterTitle,
    mainCharacterName: args.mainCharacterName,
    choices: args.choices,
    chapterLastParagraphs: args.chapterLastParagraphs.map((paragraph) => paragraph.slice(0, 400)),
    endingCandidates: args.endingCandidates,
    lockedEndingKey: args.lockedEndingKey,
    isEndingLockChapter: args.isEndingLockChapter,
  }
  const generate = deps.provider.generateCatalogReactions
  if (!generate) throw new Error('CATALOG_REACTIONS_PROVIDER_UNAVAILABLE')
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_REACTION_ATTEMPTS; attempt++) {
    try {
      const raw = await generate.call(deps.provider, providerInput, {
        telemetryContext: executionOptions({
          runId: args.runId,
          storyId: args.storyId,
          chapterNumber: args.chapterNumber,
          attempt,
          phase: 'CATALOG_CHAPTER_REACTIONS',
        }).telemetryContext,
        workflowPhase: 'CATALOG_CHAPTER_REACTIONS',
      })
      return validateCatalogReactions({ choices: args.choices, raw })
    } catch (error) {
      lastError = error
    }
    args.log?.(`Bab ${args.chapterNumber} reaksi percobaan ${attempt} gagal.`)
  }
  throw lastError instanceof Error ? lastError : new Error('CATALOG_REACTIONS_FAILED')
}

function outcomeBiasMagnitude(effect: Record<string, unknown>): number {
  const deltas = effect.endingBiasDeltas
  if (!deltas || typeof deltas !== 'object' || Array.isArray(deltas)) return 0
  let max = 0
  for (const value of Object.values(deltas as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      max = Math.max(max, Math.abs(value))
    }
  }
  return max
}

async function buildChapterOutput(deps: CatalogGeneratorDeps, args: {
  runId: string
  storyId: string
  contract: StoryContract
  snapshot: CanonSnapshot
  chapterNumber: number
  previousChapter: CatalogChapterRef | null
  previousChapterNumber: number | null
  lockedEndingKey: string | null
  forceEndingChoices: boolean
  nextChapterNumber: number | null
  log?: (message: string) => void
}): Promise<CatalogGeneratedChapter> {
  const blueprint = blueprintForChapter(args.snapshot, args.chapterNumber)
  const chapterBrief = buildChapterBrief({
    storyContract: args.contract,
    snapshot: args.snapshot,
    readerState: {
      routeState: normalizeRouteState({}),
      choiceHistory: [],
      lockedEndingKey: args.lockedEndingKey,
    },
    chapterNumber: args.chapterNumber,
    previousChoice: null,
  })
  const continuation = buildCatalogContinuation({
    storyId: args.storyId,
    contract: args.contract,
    targetChapterNumber: args.chapterNumber,
    previousChapter: args.previousChapter,
    previousChapterNumber: args.previousChapterNumber,
    lockedEndingKey: args.lockedEndingKey,
    previousTitles: args.snapshot.timeline.slice(-24).map((event) => event.description),
  })
  const prose = await generateProseWithRetry(deps, {
    runId: args.runId,
    storyId: args.storyId,
    snapshot: args.snapshot,
    contract: args.contract,
    chapterNumber: args.chapterNumber,
    continuation,
    chapterBrief,
    blueprint,
    log: args.log,
  })

  const isEndingLock = args.forceEndingChoices
  let choicePrompt: string | null = null
  let choices: Array<{ id: string; label: string }> = []
  let effectByChoice = new Map<string, Record<string, unknown>>()

  if (args.chapterNumber >= CATALOG_VARIANT_FIRST_CHAPTER && args.nextChapterNumber === null) {
    // Bab 50: penutup tanpa pilihan.
    return {
      chapterNumber: args.chapterNumber,
      title: prose.title,
      paragraphs: prose.paragraphs,
      choicePrompt: null,
      choices: [],
      outcomes: [],
    }
  }

  if (isEndingLock) {
    const candidates = assertCatalogContract(args.contract).endingCandidates
    choices = candidates.map((candidate, index) => ({
      id: `ch44-opt-${index + 1}`,
      label: endingLockChoiceLabel(candidate.name, candidate.condition),
    }))
    effectByChoice = new Map(choices.map((choice, index) => [choice.id, {
      flagsSet: {},
      endingBiasDeltas: { [candidates[index]!.key]: ENDING_LOCK_BIAS_DELTA },
    }]))
    choicePrompt = 'Ini titik yang menentukan segalanya. Apa yang akanmu lakukan?'
  } else {
    const branch = await generateSpineChoices(deps, {
      runId: args.runId,
      storyId: args.storyId,
      snapshot: args.snapshot,
      chapterNumber: args.chapterNumber,
      chapterBrief,
      draft: prose,
      lockedEndingKey: args.lockedEndingKey,
      log: args.log,
    })
    choicePrompt = branch.choicePrompt
    choices = branch.choices
    effectByChoice = new Map(branch.outcomes.map((outcome) => [outcome.choiceId, outcome.effect]))
  }

  const reactions = await generateReactionsWithRetry(deps, {
    runId: args.runId,
    storyId: args.storyId,
    chapterNumber: args.chapterNumber,
    chapterTitle: prose.title,
    mainCharacterName: args.contract.mainCharacter.name,
    choices,
    chapterLastParagraphs: prose.paragraphs.slice(-3),
    endingCandidates: args.contract.endingCandidates.map((candidate) => ({
      key: candidate.key,
      name: candidate.name,
    })),
    lockedEndingKey: args.lockedEndingKey,
    isEndingLockChapter: isEndingLock,
    log: args.log,
  })
  const reactionByChoice = new Map(reactions.map((reaction) => [reaction.choiceId, reaction]))

  const outcomes: CatalogOutcomeRow[] = choices.map((choice) => {
    const reaction = reactionByChoice.get(choice.id)
    const effect = effectByChoice.get(choice.id) ?? { flagsSet: {} }
    const hint = reaction?.directionHint
    return {
      choiceId: choice.id,
      label: choice.label,
      consequence: reaction?.paragraphs ?? [choice.label],
      nextChapterNumber: args.nextChapterNumber,
      isEnding: false,
      effect,
      ...(hint && outcomeBiasMagnitude(effect) >= DIRECTION_HINT_BIAS_THRESHOLD ? { directionHint: hint } : {}),
    }
  })

  return {
    chapterNumber: args.chapterNumber,
    title: prose.title,
    paragraphs: prose.paragraphs,
    choicePrompt,
    choices,
    outcomes,
  }
}

function maxKey(map: Map<number, unknown>): number {
  let max = 0
  for (const key of map.keys()) max = Math.max(max, key)
  return max
}

export interface CatalogGenerationResult {
  spineWritten: number
  variantsWritten: number
  completed: boolean
}

/**
 * Tulis novel katalog ke DB lewat writer: spine 1-44 (pilihan tertunda),
 * lalu fork Bab 45-50 untuk tiap kandidat ending. Resume otomatis dari
 * bab yang sudah ada di DB. Status berakhir `review` saat lengkap.
 */
export async function generateCatalogNovel(deps: CatalogGeneratorDeps, input: {
  storyId: string
  maxChapters?: number
  runId?: string
  log?: (message: string) => void
}): Promise<CatalogGenerationResult> {
  assertCatalogStoryId(input.storyId)
  const state = await deps.writer.loadState(input.storyId)
  if (!state) throw new Error(`CATALOG_STORY_NOT_FOUND:${input.storyId}`)
  if (state.status === 'published' || state.status === 'archived') {
    throw new Error(`CATALOG_STORY_CLOSED:${state.status}`)
  }
  const contract = assertCatalogContract(state.contract)
  const runId = input.runId ?? `catalog-gen-${Date.now()}`
  const log = input.log
  const cap = input.maxChapters ?? 50

  const baseCanon = await deps.writer.loadCanon(input.storyId)
  const contractCanon = snapshotWithContract(baseCanon, contract)
  const spineTitles = [...state.spine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, ref]) => ({ number, title: ref.title }))

  if (state.status !== 'generating') await deps.writer.markGenerating(input.storyId)

  let spineWritten = 0
  for (let n = maxKey(state.spine) + 1; n <= CATALOG_SPINE_LAST_CHAPTER && n <= cap; n++) {
    const snapshot: CanonSnapshot = {
      ...baseCanon,
      blueprints: contractCanon.blueprints,
      secrets: contractCanon.secrets,
      timeline: timelineFor([...spineTitles]),
    }
    const previous = state.spine.get(n - 1) ?? null
    const chapter = await buildChapterOutput(deps, {
      runId,
      storyId: input.storyId,
      contract,
      snapshot,
      chapterNumber: n,
      previousChapter: previous,
      previousChapterNumber: n - 1,
      lockedEndingKey: null,
      forceEndingChoices: n === CATALOG_SPINE_LAST_CHAPTER,
      nextChapterNumber: Math.min(n + 1, 50),
      log,
    })
    await deps.writer.writeSpineChapter(input.storyId, chapter)
    state.spine.set(n, { title: chapter.title, paragraphs: chapter.paragraphs })
    spineTitles.push({ number: n, title: chapter.title })
    spineWritten += 1
    await deps.writer.setProgress(input.storyId, n)
    log?.(`Bab ${n} tersimpan (spine ${n}/44).`)
  }

  let variantsWritten = 0
  const spineComplete = maxKey(state.spine) >= CATALOG_SPINE_LAST_CHAPTER
  if (spineComplete && cap > CATALOG_SPINE_LAST_CHAPTER) {
    await deps.writer.setProgress(input.storyId, Math.max(44, maxKey(state.spine)))
    const variantCanon = snapshotWithContract(baseCanon, contract)
    for (const candidate of contract.endingCandidates) {
      const variantMap = state.variants.get(candidate.key) ?? new Map<number, CatalogChapterRef>()
      for (let m = Math.max(CATALOG_VARIANT_FIRST_CHAPTER, maxKey(variantMap) + 1); m <= 50; m++) {
        const snapshot: CanonSnapshot = {
          ...baseCanon,
          blueprints: variantCanon.blueprints,
          secrets: variantCanon.secrets,
          timeline: timelineFor([
            ...spineTitles,
            ...[...variantMap.entries()].sort((a, b) => a[0] - b[0]).map(([number, ref]) => ({
              number,
              title: ref.title,
            })),
          ]),
        }
        const previous = m === CATALOG_VARIANT_FIRST_CHAPTER
          ? state.spine.get(CATALOG_SPINE_LAST_CHAPTER) ?? null
          : variantMap.get(m - 1) ?? null
        const chapter = await buildChapterOutput(deps, {
          runId,
          storyId: input.storyId,
          contract,
          snapshot,
          chapterNumber: m,
          previousChapter: previous,
          previousChapterNumber: m - 1,
          lockedEndingKey: candidate.key,
          forceEndingChoices: false,
          nextChapterNumber: m >= 50 ? null : m + 1,
          log,
        })
        await deps.writer.writeVariantChapter(input.storyId, candidate.key, chapter)
        variantMap.set(m, { title: chapter.title, paragraphs: chapter.paragraphs })
        state.variants.set(candidate.key, variantMap)
        variantsWritten += 1
        log?.(`Varian ${candidate.key} Bab ${m} tersimpan.`)
      }
    }
    const allVariantsComplete = contract.endingCandidates.every((candidate) => {
      const variantMap = state.variants.get(candidate.key)
      return variantMap !== undefined && maxKey(variantMap) >= 50
    })
    if (allVariantsComplete) {
      await deps.writer.setProgress(input.storyId, 50)
      await deps.writer.markReview(input.storyId)
    }
  }

  const completed = maxKey(state.spine) >= CATALOG_SPINE_LAST_CHAPTER
    && contract.endingCandidates.every((candidate) => {
      const variantMap = state.variants.get(candidate.key)
      return variantMap !== undefined && maxKey(variantMap) >= 50
    })
  return { spineWritten, variantsWritten, completed }
}

/** Tulis ulang satu bab spine: hapus bab+outcome+review, lalu generate ulang. */
export async function regenerateCatalogSpineChapter(deps: CatalogGeneratorDeps, input: {
  storyId: string
  chapterNumber: number
  runId?: string
  log?: (message: string) => void
}): Promise<void> {
  assertCatalogStoryId(input.storyId)
  const { chapterNumber } = input
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > CATALOG_SPINE_LAST_CHAPTER) {
    throw new Error(`CATALOG_REGENERATE_CHAPTER_INVALID:${chapterNumber}`)
  }
  const state = await deps.writer.loadState(input.storyId)
  if (!state) throw new Error(`CATALOG_STORY_NOT_FOUND:${input.storyId}`)
  if (state.status === 'published' || state.status === 'archived') {
    throw new Error(`CATALOG_STORY_CLOSED:${state.status}`)
  }
  const contract = assertCatalogContract(state.contract)
  if (chapterNumber > 1 && !state.spine.has(chapterNumber - 1)) {
    throw new Error(`CATALOG_REGENERATE_PREVIOUS_MISSING:${chapterNumber - 1}`)
  }
  await deps.writer.deleteSpineChapter(input.storyId, chapterNumber)
  state.spine.delete(chapterNumber)
  const baseCanon = await deps.writer.loadCanon(input.storyId)
  const snapshot: CanonSnapshot = {
    ...baseCanon,
    blueprints: snapshotWithContract(baseCanon, contract).blueprints,
    secrets: snapshotWithContract(baseCanon, contract).secrets,
    timeline: timelineFor(
      [...state.spine.entries()].sort((a, b) => a[0] - b[0]).map(([number, ref]) => ({
        number,
        title: ref.title,
      })),
    ),
  }
  const chapter = await buildChapterOutput(deps, {
    runId: input.runId ?? `catalog-regen-${Date.now()}`,
    storyId: input.storyId,
    contract,
    snapshot,
    chapterNumber,
    previousChapter: chapterNumber === 1 ? null : state.spine.get(chapterNumber - 1) ?? null,
    previousChapterNumber: chapterNumber === 1 ? null : chapterNumber - 1,
    lockedEndingKey: null,
    forceEndingChoices: chapterNumber === CATALOG_SPINE_LAST_CHAPTER,
    nextChapterNumber: Math.min(chapterNumber + 1, 50),
    log: input.log,
  })
  await deps.writer.writeSpineChapter(input.storyId, chapter)
}
