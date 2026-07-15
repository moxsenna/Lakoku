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

const ChoiceEffectSummarySchema = z.object({
  truth: z.number().int().min(-20).max(20).optional(),
  risk: z.number().int().min(-20).max(20).optional(),
  secrecy: z.number().int().min(-20).max(20).optional(),
  empathy: z.number().int().min(-20).max(20).optional(),
  flagsSet: boundedArray(32, 80),
}).strict()

export const ChoiceHistoryEntrySchema = z.object({
  chapterNumber: z.number().int().min(1).max(49),
  choiceId: boundedString(100),
  label: boundedString(240),
  consequence: boundedArray(2, 160).min(1),
  effectSummary: ChoiceEffectSummarySchema,
  createdAt: z.iso.datetime({ offset: true }),
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
  goals: boundedArray(1, 1200).length(1),
  routeSummary: boundedString(4096),
  debtsToProgress: boundedArray(20, 100),
  debtsToClose: boundedArray(20, 100),
  allowMajorNewConflict: z.boolean(),
  allowNewThread: z.boolean(),
  lockEnding: z.boolean(),
  endingKey: boundedString(80).nullable(),
  previousChoiceSummary: z.string().max(4096),
}).strict().superRefine((brief, context) => {
  const aliases: Array<[PropertyKey, unknown, unknown]> = [
    ['goals', brief.goals, [brief.chapterGoal]],
    ['routeSummary', brief.routeSummary, brief.routeStateSummary],
    ['debtsToProgress', brief.debtsToProgress, brief.plotDebtsToProgress],
    ['debtsToClose', brief.debtsToClose, brief.plotDebtsToClose],
    ['allowMajorNewConflict', brief.allowMajorNewConflict, brief.allowedMajorNewConflict],
    ['allowNewThread', brief.allowNewThread, brief.allowedNewThread],
    ['lockEnding', brief.lockEnding, brief.lockedEndingKey !== null],
    ['endingKey', brief.endingKey, brief.lockedEndingKey],
    ['previousChoiceSummary', brief.previousChoiceSummary, brief.choiceHistorySummary],
  ]

  for (const [field, alias, canonical] of aliases) {
    if (JSON.stringify(alias) !== JSON.stringify(canonical)) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${String(field)} must equal its canonical chapter brief value.`,
      })
    }
  }
})

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

function summarizeChoice(entry: ChoiceHistoryEntry): string {
  const effectParts = (['truth', 'risk', 'secrecy', 'empathy'] as const)
    .flatMap((key) => entry.effectSummary[key] === undefined
      ? []
      : [`${key}=${entry.effectSummary[key]}`])
  effectParts.push(
    `flagsSet=${entry.effectSummary.flagsSet.length > 0
      ? entry.effectSummary.flagsSet.join(',')
      : '-'}`,
  )

  return [
    `Bab ${entry.chapterNumber} [${entry.choiceId}]: ${entry.label}`,
    `Konsekuensi: ${entry.consequence.join(' / ')}`,
    `Efek: ${effectParts.join('; ')}`,
  ].join(' | ')
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
    .map(({ entry }) => summarizeChoice(entry))
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
  const plotDebtsToClose = stableUnique(openDebts
    .filter((debt) => debt.mustCloseBy <= chapterNumber)
    .map((debt) => debt.id))
  const closingIds = new Set(plotDebtsToClose)
  const plotDebtsToProgress = stableUnique(openDebts
    .filter((debt) => (
      !closingIds.has(debt.id)
      && debt.mustProgressBy.some((milestone) => milestone <= chapterNumber)
    ))
    .map((debt) => debt.id))
  const routeStateSummary = summarizeRouteStateForPrompt(readerState.routeState)
  const choiceHistorySummary = summarizeChoiceHistory(readerState.choiceHistory, previousChoice)
  const allowedNewThread = chapterNumber <= storyContract.closureRunway.noNewThreadAfter
  const allowedMajorNewConflict = chapterNumber <= storyContract.closureRunway.noNewMajorConflictAfter
  const lockedEndingKey = endingKeyFor(
    storyContract,
    chapterNumber,
    readerState.routeState,
    readerState.lockedEndingKey,
  )

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
    routeStateSummary,
    choiceHistorySummary,
    plotDebtsToProgress,
    plotDebtsToClose,
    allowedNewThread,
    allowedMajorNewConflict,
    endingRunway: runwayFor(chapterNumber),
    lockedEndingKey,
    allowsChoices: chapterNumber < storyContract.closureRunway.finalEndingChapter,
    finalChapter: chapterNumber === storyContract.closureRunway.finalEndingChapter,
    goals: [target.goal],
    routeSummary: routeStateSummary,
    debtsToProgress: plotDebtsToProgress,
    debtsToClose: plotDebtsToClose,
    allowMajorNewConflict: allowedMajorNewConflict,
    allowNewThread: allowedNewThread,
    lockEnding: lockedEndingKey !== null,
    endingKey: lockedEndingKey,
    previousChoiceSummary: choiceHistorySummary,
  }

  return ChapterBriefSchema.parse(brief)
}
