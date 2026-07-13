import { z } from 'zod'
import {
  StoryContractSchema,
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
  message: string
  debtIds?: string[]
}

export interface PlotDebtAuditResult {
  ok: boolean
  findings: PlotDebtFinding[]
}

export interface PlotDebtAuditInput {
  chapterNumber: number
  contract: StoryContract
  opensMajorMystery: boolean
  opensNewThread: boolean
  endingLocked: boolean
  opensNewConflict: boolean
}

const PlotDebtAuditInputSchema = z.object({
  chapterNumber: z.number().int().min(1).max(50),
  contract: StoryContractSchema,
  opensMajorMystery: z.boolean(),
  opensNewThread: z.boolean(),
  endingLocked: z.boolean(),
  opensNewConflict: z.boolean(),
}).strict()

function unresolved(debt: PlotDebt): boolean {
  return debt.status !== 'closed'
}

export function auditPlotDebt(input: PlotDebtAuditInput): PlotDebtAuditResult {
  const parsed = PlotDebtAuditInputSchema.parse(input)
  const { chapterNumber, contract } = parsed
  const { closureRunway } = contract
  const findings: PlotDebtFinding[] = []

  if (
    parsed.opensMajorMystery
    && chapterNumber > closureRunway.noNewMajorConflictAfter
  ) {
    findings.push({
      code: 'MAJOR_MYSTERY_AFTER_35',
      message: `Chapter ${chapterNumber} cannot open a major mystery after chapter ${closureRunway.noNewMajorConflictAfter}.`,
    })
  }

  if (parsed.opensNewThread && chapterNumber > closureRunway.noNewThreadAfter) {
    findings.push({
      code: 'THREAD_AFTER_40',
      message: `Chapter ${chapterNumber} cannot open a thread after chapter ${closureRunway.noNewThreadAfter}.`,
    })
  }

  if (
    chapterNumber >= closureRunway.endingLockChapter
    && !parsed.endingLocked
  ) {
    findings.push({
      code: 'ENDING_NOT_LOCKED',
      message: `Ending must be locked from chapter ${closureRunway.endingLockChapter}.`,
    })
  }

  const openMainMystery = contract.plotDebts.find(
    (debt) => debt.id === 'main_mystery' && unresolved(debt),
  )
  if (
    chapterNumber >= closureRunway.mainMysteryResolveBy
    && openMainMystery
  ) {
    findings.push({
      code: 'MAIN_MYSTERY_OPEN',
      message: `Main mystery must be closed by chapter ${closureRunway.mainMysteryResolveBy}.`,
      debtIds: [openMainMystery.id],
    })
  }

  if (chapterNumber === closureRunway.finalEndingChapter) {
    const openDebtIds = contract.plotDebts.filter(unresolved).map((debt) => debt.id)
    if (openDebtIds.length > 0 || parsed.opensNewConflict) {
      findings.push({
        code: 'OPEN_CONFLICT_AT_END',
        message: `Chapter ${closureRunway.finalEndingChapter} cannot end with open plot debts or conflicts.`,
        ...(openDebtIds.length > 0 ? { debtIds: openDebtIds } : {}),
      })
    }
    if (parsed.opensNewConflict) {
      findings.push({
        code: 'NEW_CONFLICT_AT_END',
        message: `Chapter ${closureRunway.finalEndingChapter} cannot open a new conflict.`,
      })
    }
  }

  return { ok: findings.length === 0, findings }
}
