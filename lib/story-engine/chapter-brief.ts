import { z } from 'zod'
import type { CanonSnapshot } from '@/lib/narrative/types'
import { resolveEnding } from './ending-resolver'
import {
  RouteStateSchema,
  summarizeRouteStateForPrompt,
} from './route-state'
import {
  StoryContractSchema,
  type StoryContract,
} from './story-contract'

const chapterNumberSchema = z.number().int().min(1).max(50)
const boundedString = (maxLength: number) => z.string().trim().min(1).max(maxLength)
const boundedArray = (maxItems: number, maxLength: number) => (
  z.array(boundedString(maxLength)).max(maxItems)
)

export const ChoiceHistoryEntrySchema = z.object({
  chapterNumber: z.number().int().min(1).max(49),
  choiceId: boundedString(100),
  label: boundedString(240),
}).strict()

export type ChoiceHistoryEntry = z.infer<typeof ChoiceHistoryEntrySchema>

export const EndingRunwaySchema = z.enum([
  'expansion',
  'closure-emphasis',
  'convergence',
  'ending-lock',
  'payoff',
  'emotional-resolution',
  'final',
])

export const ChapterBriefSchema = z.object({
  storyId: boundedString(128),
  chapterNumber: chapterNumberSchema,
  totalChapters: z.literal(50),
  phase: boundedString(120),
  remainingChapters: z.number().int().min(0).max(49),
  chapterGoal: boundedString(1200),
  mustInclude: boundedArray(32, 700),
  mustNotInclude: boundedArray(16, 400),
  mustNotReveal: boundedArray(32, 240),
  routeStateSummary: boundedString(4096),
  choiceHistorySummary: z.string().max(4096),
  plotDebtsToProgress: boundedArray(20, 100),
  plotDebtsToClose: boundedArray(20, 100),
  allowedNewThread: z.boolean(),
  allowedMajorNewConflict: z.boolean(),
  endingRunway: EndingRunwaySchema,
  lockedEndingKey: boundedString(80).nullable(),
  allowsChoices: z.boolean(),
  finalChapter: z.boolean(),
}).strict()

export type ChapterBrief = z.infer<typeof ChapterBriefSchema>

const ReaderStateSchema = z.object({
  routeState: RouteStateSchema,
  choiceHistory: z.array(ChoiceHistoryEntrySchema).max(49).default([]),
  lockedEndingKey: boundedString(80).nullable().default(null),
}).strict()

const BuildChapterBriefInputSchema = z.object({
  storyContract: StoryContractSchema,
  snapshot: z.custom<CanonSnapshot>((value) => isCanonSnapshot(value), {
    message: 'Invalid canon snapshot.',
  }),
  readerState: ReaderStateSchema,
  chapterNumber: chapterNumberSchema,
  previousChoice: ChoiceHistoryEntrySchema.nullable(),
}).strict()

export interface BuildChapterBriefInput {
  storyContract: StoryContract
  snapshot: CanonSnapshot
  readerState: {
    routeState: unknown
    choiceHistory?: ChoiceHistoryEntry[]
    lockedEndingKey?: string | null
  }
  chapterNumber: number
  previousChoice?: ChoiceHistoryEntry | null
}

function isCanonSnapshot(value: unknown): value is CanonSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const snapshot = value as Partial<CanonSnapshot>
  return typeof snapshot.storyId === 'string'
    && Array.isArray(snapshot.threads)
    && Array.isArray(snapshot.blueprints)
    && Array.isArray(snapshot.secrets)
}

function stableUnique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function runwayFor(chapterNumber: number): z.infer<typeof EndingRunwaySchema> {
  if (chapterNumber === 50) return 'final'
  if (chapterNumber === 49) return 'emotional-resolution'
  if (chapterNumber >= 46) return 'payoff'
  if (chapterNumber === 45) return 'ending-lock'
  if (chapterNumber >= 36) return 'convergence'
  if (chapterNumber >= 21) return 'closure-emphasis'
  return 'expansion'
}

function policyExclusions(chapterNumber: number): string[] {
  const exclusions: string[] = []
  if (chapterNumber >= 36) exclusions.push('Konflik besar baru.')
  if (chapterNumber >= 41) exclusions.push('Thread cerita baru.')
  if (chapterNumber >= 46) exclusions.push('Penyimpangan dari ending yang sudah dikunci.')
  if (chapterNumber === 49) exclusions.push('Konflik utama baru atau perluasan misteri.')
  if (chapterNumber === 50) exclusions.push('Pilihan pembaca, cliffhanger, atau konflik yang belum selesai.')
  return exclusions
}

function summarizeChoiceHistory(
  history: readonly ChoiceHistoryEntry[],
  previousChoice: ChoiceHistoryEntry | null,
): string {
  const combined = previousChoice == null ? [...history] : [...history, previousChoice]
  const sorted = combined
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      left.entry.chapterNumber - right.entry.chapterNumber || left.index - right.index
    ))

  return sorted
    .map(({ entry }) => `Bab ${entry.chapterNumber} [${entry.choiceId}]: ${entry.label}`)
    .join('\n')
    .slice(0, 4096)
}

function endingKeyFor(
  storyContract: StoryContract,
  chapterNumber: number,
  routeState: unknown,
  lockedEndingKey: string | null,
): string | null {
  if (chapterNumber < storyContract.closureRunway.endingLockChapter) {
    return lockedEndingKey
  }
  return resolveEnding({
    storyContract,
    chapterNumber,
    routeState,
    lockedEndingKey,
  }).key
}

export function buildChapterBrief(input: BuildChapterBriefInput): ChapterBrief {
  const parsed = BuildChapterBriefInputSchema.parse({
    ...input,
    previousChoice: input.previousChoice ?? null,
  })
  const { storyContract, snapshot, readerState, chapterNumber, previousChoice } = parsed

  if (snapshot.storyId !== storyContract.storyId) {
    throw new Error('Canon snapshot storyId does not match story contract.')
  }

  const target = storyContract.chapterTargets.find(
    (candidate) => candidate.chapterNumber === chapterNumber,
  )
  if (!target) throw new Error(`Missing story contract target for chapter ${chapterNumber}.`)

  const blueprint = snapshot.blueprints.find(
    (candidate) => candidate.chapterNumber === chapterNumber,
  )
  if (!blueprint) throw new Error(`Missing canon blueprint for chapter ${chapterNumber}.`)

  const openDebts = storyContract.plotDebts.filter((debt) => debt.status !== 'closed')
  const plotDebtsToClose = openDebts
    .filter((debt) => debt.mustCloseBy === chapterNumber)
    .map((debt) => debt.id)
  const closingIds = new Set(plotDebtsToClose)
  const plotDebtsToProgress = openDebts
    .filter((debt) => (
      !closingIds.has(debt.id) && debt.mustProgressBy.includes(chapterNumber)
    ))
    .map((debt) => debt.id)

  const brief: ChapterBrief = {
    storyId: storyContract.storyId,
    chapterNumber,
    totalChapters: 50,
    phase: target.phase,
    remainingChapters: 50 - chapterNumber,
    chapterGoal: target.goal,
    mustInclude: stableUnique([
      ...target.mustInclude,
      target.emotionalTurn,
      ...target.expectedThreadMovement,
      ...blueprint.mandatoryBeats,
      ...snapshot.threads
        .filter((thread) => thread.status === 'PAYOFF_DUE' && chapterNumber >= 41)
        .map((thread) => `Majukan payoff thread: ${thread.id}.`),
    ]),
    mustNotInclude: policyExclusions(chapterNumber),
    mustNotReveal: stableUnique([
      ...target.mustNotReveal,
      ...blueprint.forbiddenReveals,
    ]),
    routeStateSummary: summarizeRouteStateForPrompt(readerState.routeState),
    choiceHistorySummary: summarizeChoiceHistory(readerState.choiceHistory, previousChoice),
    plotDebtsToProgress,
    plotDebtsToClose,
    allowedNewThread: chapterNumber <= storyContract.closureRunway.noNewThreadAfter,
    allowedMajorNewConflict: chapterNumber <= storyContract.closureRunway.noNewMajorConflictAfter,
    endingRunway: runwayFor(chapterNumber),
    lockedEndingKey: endingKeyFor(
      storyContract,
      chapterNumber,
      readerState.routeState,
      readerState.lockedEndingKey,
    ),
    allowsChoices: chapterNumber < storyContract.closureRunway.finalEndingChapter,
    finalChapter: chapterNumber === storyContract.closureRunway.finalEndingChapter,
  }

  return ChapterBriefSchema.parse(brief)
}
