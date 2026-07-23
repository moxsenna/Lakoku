/**
 * AI Provider Gateway — kontrak internal `generatePlan()` / `writeChapter()`.
 *
 * Konsumen lain (runtime, narrative-core) hanya kenal kontrak ini, tak pernah
 * kode provider. Gateway:
 *   1. memanggil provider,
 *   2. memvalidasi output mentah via schema (tolak yang tak valid),
 *   3. menegakkan boundary consumer-safe (tak ada kebocoran model/prompt/token).
 */

import type { CanonSnapshot, ChapterBlueprint, Finding } from '@lakoku/narrative-core'
import { z } from 'zod'
import {
  ChapterDraftSchema,
  parsePlan,
  parseDraft,
  validateChoiceBranch,
  type ChapterPlan,
  type ChapterDraftParsed,
  type ChoiceBranch,
} from './schemas'
import {
  finalizeAiChoiceDraft,
  isAiChoiceDraftShape,
  parseAiChoiceDraft,
} from './choice-draft-v2'
import {
  type GenerationProvider,
  type DraftDefect,
  type ChoiceInput,
  type ChoiceProviderInput,
  type LastParagraphs,
  type StoryContractInput,
  type StoryContractCallOptions,
  type ModelCallExecutionOptions,
} from './provider'
import { ChapterBriefSchema, ChoiceHistoryEntrySchema } from '../story-engine/chapter-brief'
import { RouteStateSchema } from '../story-engine/route-state'
import { GatewayError, scanForLeaks } from './safety'
import {
  ContentRejectedError,
  InvalidModelResponseError,
} from './model-call-errors'

export { GatewayError, scanForLeaks } from './safety'

export interface GatewayDeps {
  provider: GenerationProvider
}

/** Teruskan generasi kontrak mentah; validasi dan repair dimiliki caller. */
export async function generateStoryContractRaw(
  deps: GatewayDeps,
  input: StoryContractInput,
  options?: StoryContractCallOptions,
): Promise<unknown> {
  const generateStoryContract = deps.provider.generateStoryContract
  if (!generateStoryContract) {
    throw new GatewayError(
      'Provider kontrak cerita tidak tersedia.',
      'CONTRACT_PROVIDER_UNAVAILABLE',
    )
  }
  return generateStoryContract.call(deps.provider, input, options)
}

export async function generatePlan(
  deps: GatewayDeps,
  args: { snapshot: CanonSnapshot; blueprint: ChapterBlueprint; chapterNumber: number },
): Promise<ChapterPlan> {
  const raw = await deps.provider.generatePlan(args)
  const parsed = parsePlan(raw)
  if (!parsed.ok) {
    throw new GatewayError('Rencana bab tidak valid.', 'PLAN_INVALID', parsed.errors)
  }
  return parsed.data
}

export async function writeChapter(
  deps: GatewayDeps,
  args: {
    snapshot: CanonSnapshot
    plan: ChapterPlan
    repairFindings?: Finding[]
    injectDefects?: DraftDefect[]
  },
  options?: ModelCallExecutionOptions,
): Promise<ChapterDraftParsed> {
  const raw = await deps.provider.writeChapter({
    snapshot: args.snapshot,
    plan: args.plan,
    repairFindings: args.repairFindings,
    injectDefects: args.injectDefects,
  }, options)
  const parsed = parseDraft(raw)
  if (!parsed.ok) {
    throw new GatewayError('Draft bab tidak valid.', 'DRAFT_INVALID', parsed.errors)
  }
  return parsed.data
}

const MAX_CHOICE_PROVIDER_INPUT_CHARS = 16_000
const MAX_CHOICE_SNAPSHOT_CHARS = 256_000
const MAX_CHOICE_DRAFT_CHARS = 128_000
const MAX_CHOICE_HISTORY_CHARS = 32_000
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum)
const boundedTextArray = (items: number, length: number) => z.array(boundedText(length)).max(items)

const ChoiceSnapshotSourceSchema = z.object({
  storyId: boundedText(128),
  characters: z.array(z.object({
    id: boundedText(128),
    canonicalName: boundedText(160),
    introducedChapter: z.number().int().min(1).max(50),
    status: z.enum(['ALIVE', 'DEAD', 'INACTIVE']),
  }).passthrough()).max(500),
  threads: z.array(z.object({
    id: boundedText(128),
    title: boundedText(240),
    status: z.enum(['OPEN', 'DEVELOPING', 'PAYOFF_DUE', 'RESOLVED', 'ABANDONED_APPROVED']),
  }).passthrough()).max(500),
  secrets: z.array(z.object({
    id: boundedText(128),
    description: boundedText(400),
    revealGateChapter: z.number().int().min(1).max(50),
    revealed: z.boolean(),
  }).passthrough()).max(500),
}).passthrough()

const ChoiceInputSchema = z.object({
  snapshot: ChoiceSnapshotSourceSchema,
  chapterBrief: ChapterBriefSchema,
  draft: ChapterDraftSchema,
  lastParagraphs: z.array(boundedText(400)).min(3).max(5),
  routeState: RouteStateSchema,
  choiceHistory: z.array(ChoiceHistoryEntrySchema).max(49),
  lockedEndingKey: boundedText(80).nullable(),
}).strict()

const ChoiceProviderInputSchema = z.object({
  storyId: boundedText(128),
  currentChapter: z.number().int().min(1).max(50),
  draft: z.object({
    title: boundedText(160),
    lastParagraphs: z.array(boundedText(400)).min(3).max(5),
  }).strict(),
  chapterBrief: z.object({
    phase: boundedText(120),
    chapterGoal: boundedText(1200),
    mustInclude: boundedTextArray(32, 700),
    mustNotInclude: boundedTextArray(16, 400),
    mustNotReveal: boundedTextArray(32, 240),
    plotDebtsToProgress: boundedTextArray(20, 100),
    plotDebtsToClose: boundedTextArray(20, 100),
    remainingChapters: z.number().int().min(0).max(49),
    endingRunway: ChapterBriefSchema.shape.endingRunway,
  }).strict(),
  routeState: RouteStateSchema,
  choiceHistory: z.array(ChoiceHistoryEntrySchema).max(49),
  lockedEndingKey: boundedText(80).nullable(),
  canon: z.object({
    activeCharacters: z.array(z.object({
      id: boundedText(128),
      name: boundedText(160),
    }).strict()).max(24),
    activeThreads: z.array(z.object({
      id: boundedText(128),
      title: boundedText(240),
    }).strict()).max(24),
    pendingReveals: z.array(z.object({
      id: boundedText(128),
      description: boundedText(400),
      gateChapter: z.number().int().min(1).max(50),
    }).strict()).max(32),
  }).strict(),
}).strict()

function choiceInputError(errors: string[]): GatewayError {
  return new GatewayError(
    'Pilihan cabang tidak dapat dihasilkan.',
    'CHOICE_INPUT_INVALID',
    errors,
  )
}

function issueStrings(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function projectChoiceInput(input: ChoiceInput): ChoiceProviderInput {
  if (serializedLength(input.snapshot) > MAX_CHOICE_SNAPSHOT_CHARS) {
    throw choiceInputError([`snapshot: Serialized snapshot exceeds ${MAX_CHOICE_SNAPSHOT_CHARS} characters.`])
  }
  if (serializedLength(input.draft) > MAX_CHOICE_DRAFT_CHARS) {
    throw choiceInputError([`draft: Serialized draft exceeds ${MAX_CHOICE_DRAFT_CHARS} characters.`])
  }
  if (serializedLength(input.choiceHistory) > MAX_CHOICE_HISTORY_CHARS) {
    throw choiceInputError([`choiceHistory: Serialized history exceeds ${MAX_CHOICE_HISTORY_CHARS} characters.`])
  }

  const parsed = ChoiceInputSchema.safeParse(input)
  if (!parsed.success) throw choiceInputError(issueStrings(parsed.error))

  const { snapshot, chapterBrief, draft } = parsed.data
  const chapterNumber = draft.chapterNumber
  const mismatches: string[] = []
  if (chapterBrief.chapterNumber !== chapterNumber) {
    mismatches.push('chapterBrief.chapterNumber: CHAPTER_NUMBER_MISMATCH: chapterBrief.chapterNumber must equal draft.chapterNumber.')
  }
  if (chapterBrief.lockedEndingKey !== parsed.data.lockedEndingKey) {
    mismatches.push('lockedEndingKey: ENDING_LOCK_MISMATCH: lockedEndingKey must equal chapterBrief.lockedEndingKey.')
  }
  if (mismatches.length) throw choiceInputError(mismatches)

  const projected = ChoiceProviderInputSchema.safeParse({
    storyId: snapshot.storyId,
    currentChapter: chapterNumber,
    draft: {
      title: draft.title,
      lastParagraphs: parsed.data.lastParagraphs as LastParagraphs,
    },
    chapterBrief: {
      phase: chapterBrief.phase,
      chapterGoal: chapterBrief.chapterGoal,
      mustInclude: chapterBrief.mustInclude,
      mustNotInclude: chapterBrief.mustNotInclude,
      mustNotReveal: chapterBrief.mustNotReveal,
      plotDebtsToProgress: chapterBrief.plotDebtsToProgress,
      plotDebtsToClose: chapterBrief.plotDebtsToClose,
      remainingChapters: chapterBrief.remainingChapters,
      endingRunway: chapterBrief.endingRunway,
    },
    routeState: parsed.data.routeState,
    choiceHistory: parsed.data.choiceHistory,
    lockedEndingKey: parsed.data.lockedEndingKey,
    canon: {
      activeCharacters: snapshot.characters
        .filter((character) => character.status !== 'DEAD' && character.introducedChapter <= chapterNumber)
        .slice(0, 24)
        .map((character) => ({ id: character.id, name: character.canonicalName })),
      activeThreads: snapshot.threads
        .filter((thread) => thread.status !== 'RESOLVED' && thread.status !== 'ABANDONED_APPROVED')
        .slice(0, 24)
        .map((thread) => ({ id: thread.id, title: thread.title })),
      pendingReveals: snapshot.secrets
        .filter((secret) => !secret.revealed)
        .slice(0, 32)
        .map((secret) => ({
          id: secret.id,
          description: secret.description,
          gateChapter: secret.revealGateChapter,
        })),
    },
  })
  if (!projected.success) throw choiceInputError(issueStrings(projected.error))

  const serialized = JSON.stringify(projected.data)
  if (serialized.length > MAX_CHOICE_PROVIDER_INPUT_CHARS) {
    throw choiceInputError([
      `(root): Serialized choice provider input exceeds ${MAX_CHOICE_PROVIDER_INPUT_CHARS} characters.`,
    ])
  }
  return {
    ...projected.data,
    draft: {
      ...projected.data.draft,
      lastParagraphs: projected.data.draft.lastParagraphs as LastParagraphs,
    },
  }
}

/**
 * Potong teks aman-pembaca ke batas maksimum di batas kata. LLM sering menulis
 * choicePrompt/label sedikit lebih panjang dari batas UI; memotong lebih baik
 * daripada menolak seluruh cabang pilihan (akar CHOICE_REPAIR_EXHAUSTED).
 */
function truncateAtWord(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
}

const CHOICE_KEYS = new Set(['id', 'label', 'hint'])
const OUTCOME_KEYS = new Set(['choiceId', 'consequence', 'nextChapterNumber', 'isEnding', 'effect'])
const EFFECT_KEYS = new Set(['routeDeltas', 'trustDeltas', 'flagsSet', 'evidenceAdded', 'endingBiasDeltas', 'threadTouches'])
const ROUTE_DELTA_KEYS = new Set(['truth', 'risk', 'secrecy', 'empathy'])

function pick(value: unknown, keys: Set<string>): Record<string, unknown> {
  const source = (value ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(source)) if (keys.has(key)) out[key] = val
  return out
}

/** Clamp nilai numerik record ke rentang schema; buang non-numerik. */
function clampNumberRecord(value: unknown, min: number, max: number): Record<string, number> {
  const source = (value ?? {}) as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [key, val] of Object.entries(source)) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      out[key] = Math.round(Math.min(max, Math.max(min, val)))
    }
  }
  return out
}

/**
 * Normalisasi output pilihan LLM sebelum validasi ketat: (1) potong string
 * aman-pembaca ke batas UI, (2) buang key tak dikenal (mis. "label" di outcomes,
 * key rute tematik, field asing di effect) alih-alih menolak seluruh cabang.
 * Schema tetap `.strict()` — ini hanya membuat pipeline toleran pada kreativitas
 * model, bukan melonggarkan kontrak. Akar CHOICE_REPAIR_EXHAUSTED produksi.
 */
export function normalizeChoiceReaderText(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = structuredClone(raw) as Record<string, unknown>
  const result: Record<string, unknown> = {}

  result.choicePrompt = typeof r.choicePrompt === 'string'
    ? truncateAtWord(r.choicePrompt, 120)
    : r.choicePrompt

  result.choices = Array.isArray(r.choices)
    ? r.choices.map((choice) => {
        if (!choice || typeof choice !== 'object') return choice
        const picked = pick(choice, CHOICE_KEYS)
        if (typeof picked.label === 'string') picked.label = truncateAtWord(picked.label, 90)
        if (typeof picked.hint === 'string') picked.hint = truncateAtWord(picked.hint, 140)
        return picked
      })
    : r.choices

  result.outcomes = Array.isArray(r.outcomes)
    ? r.outcomes.map((outcome) => {
        if (!outcome || typeof outcome !== 'object') return outcome
        const picked = pick(outcome, OUTCOME_KEYS)
        if (Array.isArray(picked.consequence)) {
          // Schema membatasi 1..2 item; potong kelebihan, jangan tolak cabang.
          picked.consequence = picked.consequence.slice(0, 2).map((item) =>
            typeof item === 'string' ? truncateAtWord(item, 160) : item)
        }
        if (picked.effect && typeof picked.effect === 'object') {
          const effect = pick(picked.effect, EFFECT_KEYS)
          effect.routeDeltas = clampNumberRecord(pick(effect.routeDeltas, ROUTE_DELTA_KEYS), -20, 20)
          effect.trustDeltas = clampNumberRecord(effect.trustDeltas, -10, 10)
          effect.endingBiasDeltas = clampNumberRecord(effect.endingBiasDeltas, -100, 100)
          if (effect.flagsSet && typeof effect.flagsSet === 'object') {
            const flags: Record<string, boolean> = {}
            for (const [k, v] of Object.entries(effect.flagsSet as Record<string, unknown>)) {
              flags[k] = Boolean(v)
            }
            effect.flagsSet = flags
          }
          picked.effect = effect
        }
        return picked
      })
    : r.outcomes

  return result
}

/** Hasilkan pilihan dinamis dari chapter draft kanonis dan input provider terbatas. */
export async function generateChoiceBranch(
  deps: GatewayDeps,
  input: ChoiceInput,
  options?: ModelCallExecutionOptions,
): Promise<ChoiceBranch | null> {
  const providerInput = projectChoiceInput(input)
  if (providerInput.currentChapter === 50) return null

  const generateChoices = deps.provider.generateChoices
  if (!generateChoices) {
    throw new GatewayError(
      'Provider pilihan tidak tersedia.',
      'CHOICE_PROVIDER_UNAVAILABLE',
    )
  }

  const validate = (raw: unknown): ChoiceBranch => {
    try {
      // Protocol V2: creative draft → deterministic finalizer → existing ChoiceBranch.
      let branchInput: unknown = raw
      if (isAiChoiceDraftShape(raw)) {
        const draftParsed = parseAiChoiceDraft(raw)
        if (!draftParsed.ok) {
          throw new GatewayError(
            'Cabang pilihan tidak valid.',
            'CHOICE_INVALID',
            draftParsed.errors,
          )
        }
        branchInput = finalizeAiChoiceDraft({
          aiDraft: draftParsed.data,
          chapterNumber: providerInput.currentChapter,
          activeCharacters: providerInput.canon.activeCharacters,
          activeThreads: providerInput.canon.activeThreads.map((t) => ({
            id: t.id,
            title: t.title,
          })),
          lockedEndingKey: providerInput.lockedEndingKey,
        })
      }
      return validateChoiceBranch(
        normalizeChoiceReaderText(branchInput),
        providerInput.currentChapter,
      )
    } catch (error) {
      if (error instanceof GatewayError && error.code === 'CHOICE_INVALID') {
        const contentRejected = error.errors?.some((item) => (
          item.includes('INTERNAL_LANGUAGE_LEAK') || item.includes('RUTE_NOT_ALLOWED')
        ))
        const ObservedError = contentRejected ? ContentRejectedError : InvalidModelResponseError
        throw new ObservedError(error.message, error.errors)
      }
      throw error
    }
  }

  try {
    const raw = await generateChoices.call(
      deps.provider,
      structuredClone(providerInput),
      options ? { ...options, consume: validate } : options,
    )
    return validate(raw)
  } catch (error) {
    if (error instanceof ContentRejectedError || error instanceof InvalidModelResponseError) {
      throw new GatewayError(
        'Cabang pilihan tidak valid.',
        'CHOICE_INVALID',
        error.validationErrors,
      )
    }
    throw error
  }
}

// ---------- Boundary consumer-safe ----------

export interface ReaderSafeChapter {
  chapterNumber: number
  title: string
  paragraphs: string[]
  hasChoiceOrGate: boolean
}

/** Payload aman-pembaca: hanya konten naratif, tanpa metadata internal. */
export function toReaderSafe(draft: ChapterDraftParsed): ReaderSafeChapter {
  return {
    chapterNumber: draft.chapterNumber,
    title: draft.title,
    paragraphs: draft.paragraphs,
    hasChoiceOrGate: draft.hasChoiceOrGate,
  }
}

/** Lempar bila payload aman-pembaca mengandung kebocoran istilah internal. */
export function assertConsumerSafe(chapter: ReaderSafeChapter): void {
  const blob = [chapter.title, ...chapter.paragraphs].join('\n')
  const leaks = scanForLeaks(blob)
  if (leaks.length) {
    throw new GatewayError(
      'Konten mengandung istilah internal yang bocor.',
      'CONSUMER_LEAK',
      leaks,
    )
  }
}
