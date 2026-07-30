/**
 * Plot-debt closure — pure decision logic (no server, no DB, no I/O).
 *
 * The writer only ever PROPOSES a closure. This module decides which proposals
 * are admissible against the story contract debts plus the per-reader ledger of
 * already-closed debt IDs, and reports bounded result codes.
 *
 * Two readers may legitimately close the same debt with different closure forms
 * (divergent routes); closure form is therefore never compared across readers.
 */
import { z } from 'zod'
import {
  PlotDebtSchema,
  type PlotDebt,
} from './story-contract'

export const MAIN_MYSTERY_DEBT_ID = 'main_mystery' as const

/** Chapter from which the main mystery must already be closed. */
export const MAIN_MYSTERY_RESOLVE_BY_CHAPTER = 48
/** Final chapter; no debt may still be open here. */
export const FINAL_CHAPTER = 50

export const PLOT_DEBT_CLOSURE_FORMS = [
  'RESOLVED',
  'SUBVERTED',
  'TRANSFORMED',
  'ABANDONED',
] as const

export const MAX_PLOT_DEBT_CLOSURES = 20

export const PlotDebtClosureFormSchema = z.enum(PLOT_DEBT_CLOSURE_FORMS)
export type PlotDebtClosureForm = z.infer<typeof PlotDebtClosureFormSchema>

export const PlotDebtClosureProposalSchema = z.object({
  debtId: z.string().trim().min(1).max(100),
  closureForm: PlotDebtClosureFormSchema,
}).strict()

export type PlotDebtClosureProposal = z.infer<typeof PlotDebtClosureProposalSchema>

export const PlotDebtClosureResultCodeSchema = z.enum([
  'OK',
  'UNKNOWN_DEBT_ID',
  'DEBT_NOT_INTRODUCED',
  'DEBT_DEADLINE_VIOLATION',
  'MAIN_MYSTERY_ABANDONMENT_FORBIDDEN',
  'MAIN_MYSTERY_UNRESOLVED',
  'OPEN_DEBT_AT_END',
  'DEBT_CLOSURE_CONFLICT',
])

export type PlotDebtClosureResultCode = z.infer<typeof PlotDebtClosureResultCodeSchema>

/** Every code except OK can appear as a finding. */
export type PlotDebtClosureFindingCode = Exclude<PlotDebtClosureResultCode, 'OK'>

export interface PlotDebtClosureFinding {
  code: PlotDebtClosureFindingCode
  debtId: string
}

export interface PlotDebtClosureResult {
  ok: boolean
  /** First finding code in stable policy order, or OK when admissible. */
  code: PlotDebtClosureResultCode
  findings: PlotDebtClosureFinding[]
  acceptedClosures: PlotDebtClosureProposal[]
  /** Projected ledger: prior closed IDs followed by newly accepted ones. */
  closedDebtIds: string[]
}

export interface ResolveDebtClosuresInput {
  chapterNumber: number
  debts: PlotDebt[]
  closedDebtIds: string[]
  proposals: PlotDebtClosureProposal[]
}

const debtIdSchema = z.string().trim().min(1).max(100)

const ResolveDebtClosuresInputSchema = z.object({
  chapterNumber: z.number().int().min(1).max(50),
  debts: z.array(PlotDebtSchema).min(1).max(20).superRefine((debts, context) => {
    if (debts.filter((debt) => debt.id === MAIN_MYSTERY_DEBT_ID).length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Plot debts must contain exactly one main_mystery debt.',
      })
    }
  }),
  closedDebtIds: z.array(debtIdSchema).max(20),
  proposals: z.array(PlotDebtClosureProposalSchema).max(MAX_PLOT_DEBT_CLOSURES),
}).strict()

export interface MandatoryDebtsByChapter {
  mustProgress: string[]
  mustClose: string[]
}

/**
 * Contract-driven obligations for a chapter: which debts must show progress and
 * which reach their closure deadline exactly at this chapter.
 */
export function listMandatoryDebtsByChapter(
  debts: readonly PlotDebt[],
  chapterNumber: number,
): MandatoryDebtsByChapter {
  const mustProgress: string[] = []
  const mustClose: string[] = []
  for (const debt of debts) {
    if (debt.mustCloseBy === chapterNumber) {
      mustClose.push(debt.id)
      continue
    }
    if (debt.mustProgressBy.includes(chapterNumber)) {
      mustProgress.push(debt.id)
    }
  }
  return { mustProgress, mustClose }
}

/**
 * Project contract debts against a reader ledger of closed debt IDs. Returns new
 * objects; the input debts are never mutated.
 */
export function projectClosedDebts(
  debts: readonly PlotDebt[],
  closedDebtIds: readonly string[],
): PlotDebt[] {
  const closed = new Set(closedDebtIds)
  return debts.map((debt) => (
    closed.has(debt.id) ? { ...debt, status: 'closed' as const } : { ...debt }
  ))
}

export function resolveDebtClosures(
  input: ResolveDebtClosuresInput,
): PlotDebtClosureResult {
  const parsed = ResolveDebtClosuresInputSchema.parse(input)
  const { chapterNumber, debts, proposals } = parsed

  const byId = new Map(debts.map((debt) => [debt.id, debt]))
  const ledgerClosed = dedupe(parsed.closedDebtIds)
  const ledgerClosedSet = new Set(ledgerClosed)

  const findings: PlotDebtClosureFinding[] = []
  const seen = new Set<string>()
  const addFinding = (code: PlotDebtClosureFindingCode, debtId: string): void => {
    const key = `${code}:${debtId}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ code, debtId })
  }

  // Proposals repeated within one chapter are always a conflict, whatever the
  // closure form: the chapter cannot claim two closures of one debt.
  const proposalCounts = new Map<string, number>()
  for (const proposal of proposals) {
    proposalCounts.set(proposal.debtId, (proposalCounts.get(proposal.debtId) ?? 0) + 1)
  }

  const acceptedClosures: PlotDebtClosureProposal[] = []
  for (const proposal of proposals) {
    const debt = byId.get(proposal.debtId)
    if (!debt) {
      addFinding('UNKNOWN_DEBT_ID', proposal.debtId)
      continue
    }
    if (chapterNumber < debt.introducedAt) {
      addFinding('DEBT_NOT_INTRODUCED', proposal.debtId)
      continue
    }
    if (
      proposal.debtId === MAIN_MYSTERY_DEBT_ID
      && proposal.closureForm === 'ABANDONED'
    ) {
      addFinding('MAIN_MYSTERY_ABANDONMENT_FORBIDDEN', proposal.debtId)
      continue
    }
    if (chapterNumber > debt.mustCloseBy) {
      addFinding('DEBT_DEADLINE_VIOLATION', proposal.debtId)
      continue
    }
    if (
      ledgerClosedSet.has(proposal.debtId)
      || (proposalCounts.get(proposal.debtId) ?? 0) > 1
    ) {
      addFinding('DEBT_CLOSURE_CONFLICT', proposal.debtId)
      continue
    }
    acceptedClosures.push({ ...proposal })
  }

  const closedDebtIds = [
    ...ledgerClosed,
    ...acceptedClosures.map((closure) => closure.debtId),
  ]
  const projected = projectClosedDebts(debts, closedDebtIds)

  for (const debt of projected) {
    if (debt.status !== 'closed' && chapterNumber > debt.mustCloseBy) {
      addFinding('DEBT_DEADLINE_VIOLATION', debt.id)
    }
  }

  const mainMystery = projected.find((debt) => debt.id === MAIN_MYSTERY_DEBT_ID)
  if (
    chapterNumber >= MAIN_MYSTERY_RESOLVE_BY_CHAPTER
    && mainMystery
    && mainMystery.status !== 'closed'
  ) {
    addFinding('MAIN_MYSTERY_UNRESOLVED', mainMystery.id)
  }

  if (chapterNumber === FINAL_CHAPTER) {
    for (const debt of projected) {
      if (debt.status !== 'closed') addFinding('OPEN_DEBT_AT_END', debt.id)
    }
  }

  return {
    ok: findings.length === 0,
    code: findings[0]?.code ?? 'OK',
    findings,
    acceptedClosures,
    closedDebtIds,
  }
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
