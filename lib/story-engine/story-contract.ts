import { z } from 'zod'

const chapterReference = z.number().int().min(1).max(50)
const boundedString = (max: number) => z.string().trim().min(1).max(max)
const boundedStringArray = (maxItems: number, maxLength: number, minItems = 0) =>
  z.array(boundedString(maxLength)).min(minItems).max(maxItems)

export const MainCharacterSchema = z.object({
  name: boundedString(100),
  role: boundedString(120),
  wound: boundedString(500),
  desire: boundedString(500),
}).strict()

export const ActPlanEntrySchema = z.object({
  actNumber: z.number().int().min(1).max(12),
  fromChapter: chapterReference,
  toChapter: chapterReference,
  goal: boundedString(500),
}).strict()

export const ChapterTargetSchema = z.object({
  chapterNumber: chapterReference,
  phase: boundedString(80),
  goal: boundedString(700),
  mustInclude: boundedStringArray(8, 400, 1),
  mustNotReveal: boundedStringArray(20, 160),
  emotionalTurn: boundedString(500),
  expectedThreadMovement: boundedStringArray(8, 500, 1),
}).strict()

export const EndingCandidateSchema = z.object({
  key: boundedString(80),
  name: boundedString(160),
  condition: boundedString(500),
  requiredClosure: boundedStringArray(8, 400, 1),
}).strict()

export const PlotDebtSchema = z.object({
  id: boundedString(100),
  question: boundedString(500),
  introducedAt: chapterReference,
  mustProgressBy: z.array(chapterReference).min(1).max(12),
  mustCloseBy: chapterReference,
  status: z.enum(['open', 'progressing', 'closed']),
}).strict()

export const RevealRunwayEntrySchema = z.object({
  secretId: boundedString(100),
  revealGateChapter: chapterReference,
}).strict()

export const ClosureRunwaySchema = z.object({
  noNewMajorConflictAfter: z.literal(35),
  noNewThreadAfter: z.literal(40),
  endingLockChapter: z.literal(45),
  mainMysteryResolveBy: z.literal(48),
  emotionalResolutionChapter: z.literal(49),
  finalEndingChapter: z.literal(50),
}).strict()

export const StoryContractSchema = z.object({
  storyId: boundedString(128),
  totalChapters: z.literal(50),
  title: boundedString(160),
  genre: boundedString(80),
  tone: boundedString(160),
  styleProfile: z.literal('lakoku_mobile_drama_v1'),
  mainCharacter: MainCharacterSchema,
  mainConflict: boundedString(800),
  finalQuestion: boundedString(500),
  corePromise: boundedString(800),
  actPlan: z.array(ActPlanEntrySchema).min(1).max(12),
  chapterTargets: z.array(ChapterTargetSchema).length(50),
  endingCandidates: z.array(EndingCandidateSchema).min(2).max(8),
  plotDebts: z.array(PlotDebtSchema).min(1).max(20),
  revealRunway: z.array(RevealRunwayEntrySchema).min(1).max(20),
  closureRunway: ClosureRunwaySchema,
}).strict().superRefine((contract, context) => {
  contract.chapterTargets.forEach((target, index) => {
    const expected = index + 1
    if (target.chapterNumber !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['chapterTargets', index, 'chapterNumber'],
        message: `chapterTargets must be ordered sequentially; expected chapter ${expected}.`,
      })
    }
  })

  contract.actPlan.forEach((act, index) => {
    const expectedActNumber = index + 1
    if (act.actNumber !== expectedActNumber) {
      context.addIssue({
        code: 'custom',
        path: ['actPlan', index, 'actNumber'],
        message: `actPlan must use ordered act numbers; expected act ${expectedActNumber}.`,
      })
    }
    if (act.fromChapter > act.toChapter) {
      context.addIssue({
        code: 'custom',
        path: ['actPlan', index],
        message: 'Act range cannot end before it starts.',
      })
    }
    const expectedStart = index === 0 ? 1 : contract.actPlan[index - 1].toChapter + 1
    if (act.fromChapter !== expectedStart) {
      context.addIssue({
        code: 'custom',
        path: ['actPlan', index, 'fromChapter'],
        message: `actPlan must cover chapters contiguously; expected chapter ${expectedStart}.`,
      })
    }
  })

  if (contract.actPlan.at(-1)?.toChapter !== 50) {
    context.addIssue({
      code: 'custom',
      path: ['actPlan', contract.actPlan.length - 1, 'toChapter'],
      message: 'actPlan must cover through chapter 50.',
    })
  }

  addDuplicateIssues(
    contract.endingCandidates.map((ending) => ending.key),
    ['endingCandidates'],
    'Ending candidate keys must be unique.',
    context,
  )
  addDuplicateIssues(
    contract.plotDebts.map((debt) => debt.id),
    ['plotDebts'],
    'Plot debt IDs must be unique.',
    context,
  )
  addDuplicateIssues(
    contract.revealRunway.map((reveal) => reveal.secretId),
    ['revealRunway'],
    'Reveal secret IDs must be unique.',
    context,
  )

  contract.plotDebts.forEach((debt, debtIndex) => {
    debt.mustProgressBy.forEach((chapter, chapterIndex) => {
      if (chapter < debt.introducedAt || chapter > debt.mustCloseBy) {
        context.addIssue({
          code: 'custom',
          path: ['plotDebts', debtIndex, 'mustProgressBy', chapterIndex],
          message: 'Debt progression must fall between introduction and closure chapters.',
        })
      }
      if (chapterIndex > 0 && chapter <= debt.mustProgressBy[chapterIndex - 1]) {
        context.addIssue({
          code: 'custom',
          path: ['plotDebts', debtIndex, 'mustProgressBy', chapterIndex],
          message: 'Debt progression chapters must be sorted and unique.',
        })
      }
    })
    if (debt.mustCloseBy < debt.introducedAt) {
      context.addIssue({
        code: 'custom',
        path: ['plotDebts', debtIndex, 'mustCloseBy'],
        message: 'Debt closure cannot precede introduction.',
      })
    }
  })
})

function addDuplicateIssues(
  values: string[],
  path: PropertyKey[],
  message: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({ code: 'custom', path: [...path, index], message })
    }
    seen.add(value)
  })
}

export type MainCharacter = z.infer<typeof MainCharacterSchema>
export type ActPlanEntry = z.infer<typeof ActPlanEntrySchema>
export type ChapterTarget = z.infer<typeof ChapterTargetSchema>
export type EndingCandidate = z.infer<typeof EndingCandidateSchema>
export type PlotDebt = z.infer<typeof PlotDebtSchema>
export type RevealRunwayEntry = z.infer<typeof RevealRunwayEntrySchema>
export type ClosureRunway = z.infer<typeof ClosureRunwaySchema>
export type StoryContract = z.infer<typeof StoryContractSchema>

export function parseStoryContract(input: unknown): StoryContract {
  return StoryContractSchema.parse(input)
}
