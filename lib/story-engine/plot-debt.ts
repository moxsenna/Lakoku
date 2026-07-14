import { z } from 'zod'
import {
  PlotDebtSchema,
  type PlotDebt,
  type StoryContract,
} from './story-contract'

export const PlotDebtFindingCodeSchema = z.enum([
  'MAJOR_MYSTERY_AFTER_35',
  'THREAD_AFTER_40',
  'ENDING_NOT_LOCKED',
  'MAIN_MYSTERY_OPEN',
  'OPEN_CONFLICT_AT_END',
  'NEW_CONFLICT_AT_END',
])

export type PlotDebtFindingCode = z.infer<typeof PlotDebtFindingCodeSchema>

export interface PlotDebtFinding {
  code: PlotDebtFindingCode
  debtId?: string
}

export interface PlotDebtAuditResult {
  ok: boolean
  findings: PlotDebtFinding[]
}

export interface PlotDebtAuditInput {
  chapterNumber: number
  debts: StoryContract['plotDebts']
  opensMajorMystery: boolean
  opensNewThread: boolean
  endingLocked: boolean
  opensNewConflict: boolean
}

const PlotDebtAuditInputSchema = z.object({
  chapterNumber: z.number().int().min(1).max(50),
  debts: z.array(PlotDebtSchema).min(1).max(20).superRefine((debts, context) => {
    if (debts.filter((debt) => debt.id === 'main_mystery').length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Plot debts must contain exactly one main_mystery debt.',
      })
    }
  }),
  opensMajorMystery: z.boolean(),
  opensNewThread: z.boolean(),
  endingLocked: z.boolean(),
  opensNewConflict: z.boolean(),
}).strict()

const CLOSURE_RUNWAY = {
  noNewMajorConflictAfter: 35,
  noNewThreadAfter: 40,
  endingLockChapter: 45,
  mainMysteryResolveBy: 48,
  finalEndingChapter: 50,
} as const

function unresolved(debt: PlotDebt): boolean {
  return debt.status !== 'closed'
}

export function auditPlotDebts(input: PlotDebtAuditInput): PlotDebtAuditResult {
  const parsed = PlotDebtAuditInputSchema.parse(input)
  const { chapterNumber, debts } = parsed
  const closureRunway = CLOSURE_RUNWAY
  const findings: PlotDebtFinding[] = []

  if (
    parsed.opensMajorMystery
    && chapterNumber > closureRunway.noNewMajorConflictAfter
  ) {
    findings.push({ code: 'MAJOR_MYSTERY_AFTER_35' })
  }

  if (parsed.opensNewThread && chapterNumber > closureRunway.noNewThreadAfter) {
    findings.push({ code: 'THREAD_AFTER_40' })
  }

  if (
    chapterNumber >= closureRunway.endingLockChapter
    && !parsed.endingLocked
  ) {
    findings.push({ code: 'ENDING_NOT_LOCKED' })
  }

  const openMainMystery = debts.find(
    (debt) => debt.id === 'main_mystery' && unresolved(debt),
  )
  if (
    chapterNumber >= closureRunway.mainMysteryResolveBy
    && openMainMystery
  ) {
    findings.push({
      code: 'MAIN_MYSTERY_OPEN',
      debtId: openMainMystery.id,
    })
  }

  if (chapterNumber === closureRunway.finalEndingChapter) {
    if (debts.some(unresolved) || parsed.opensNewConflict) {
      findings.push({ code: 'OPEN_CONFLICT_AT_END' })
    }
    if (parsed.opensNewConflict) {
      findings.push({ code: 'NEW_CONFLICT_AT_END' })
    }
  }

  return { ok: findings.length === 0, findings }
}
