/**
 * M10-A1 — Effective plot-debt state (pure).
 *
 * Contract `plot_debts_json` adalah dokumen terkunci (bootstrap) dan TIDAK
 * boleh dimutasi untuk merepresentasikan rute satu reader. State efektif
 * per-reader diproyeksikan dari:
 *   - StoryContract.plotDebts (kewajiban statis),
 *   - reader_plot_debt_progress (milestone selesai),
 *   - reader_plot_debt_closures (debt tertutup).
 *
 * Point 6 R1:
 *  - Fail-closed ledger validation: unknown debt ID atau milestone di luar
 *    contract `mustProgressBy` melempar `EffectivePlotDebtStateError`.
 *  - `closedDebtIds` diurutkan kanonik & divalidasi vs contract.
 */

import { z } from 'zod'
import type { PlotDebt } from '../story-engine/story-contract'

export type ProgressedMilestones = Record<string, number[]>

export type EffectiveDebtStatus = 'open' | 'progressing' | 'closed'

export interface EffectiveDebtProjection {
  debtId: string
  contractStatus: PlotDebt['status']
  effectiveStatus: EffectiveDebtStatus
  completedMilestones: number[]
  /** Milestone mustProgressBy yang belum tercatat (urut). */
  nextUnpaidMilestones: number[]
}

export interface EffectivePlotDebtState {
  /** Kunci: debtId. */
  debts: Record<string, EffectiveDebtProjection>
  /** Debt terbuka yang wajib menunjukkan progress TEPAT bab ini (milestone belum lunas). */
  debtsDueToProgress: string[]
  /** Debt terbuka yang deadline closure-nya TEPAT bab ini. */
  debtsDueToClose: string[]
  /** Sorted unique. */
  closedDebtIds: string[]
  /** Sorted unique. */
  progressedMilestones: ProgressedMilestones
}

const milestoneChapter = z.number().int().min(1).max(50)

export class EffectivePlotDebtStateError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'EffectivePlotDebtStateError'
    this.code = code
  }
}

export interface ProjectEffectivePlotDebtStateInput {
  plotDebts: readonly PlotDebt[]
  progressedMilestones: ProgressedMilestones
  closedDebtIds: readonly string[]
  chapterNumber: number
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function projectEffectivePlotDebtState(
  input: ProjectEffectivePlotDebtStateInput,
): EffectivePlotDebtState {
  const { plotDebts, chapterNumber } = input
  const debtMap = new Map(plotDebts.map((debt) => [debt.id, debt]))

  // Point 6 R1: Validate & canonicalize closedDebtIds
  const closedSet = new Set<string>()
  for (const id of input.closedDebtIds) {
    if (!debtMap.has(id)) {
      throw new EffectivePlotDebtStateError(
        'UNKNOWN_CLOSED_DEBT_ID',
        `Closed debt ledger berisi debt ID tak dikenal "${id}".`,
      )
    }
    closedSet.add(id)
  }
  const closedDebtIds = [...closedSet].sort(compareIds)

  // Point 6 R1: Validate & canonicalize progressedMilestones fail-closed
  const milestones: ProgressedMilestones = {}
  for (const [debtId, chapters] of Object.entries(input.progressedMilestones)) {
    const debt = debtMap.get(debtId)
    if (!debt) {
      throw new EffectivePlotDebtStateError(
        'UNKNOWN_PROGRESS_DEBT_ID',
        `Progress milestone ledger berisi debt ID tak dikenal "${debtId}".`,
      )
    }
    const uniqueChapters = [...new Set(chapters)].sort((a, b) => a - b)
    for (const ch of uniqueChapters) {
      if (!milestoneChapter.safeParse(ch).success) {
        throw new EffectivePlotDebtStateError(
          'INVALID_MILESTONE_CHAPTER',
          `Milestone chapter ${ch} untuk debt "${debtId}" di luar range 1..50.`,
        )
      }
      if (!debt.mustProgressBy.includes(ch)) {
        throw new EffectivePlotDebtStateError(
          'UNAUTHORIZED_MILESTONE_CHAPTER',
          `Milestone chapter ${ch} tidak terdaftar di mustProgressBy untuk debt "${debtId}".`,
        )
      }
    }
    if (uniqueChapters.length > 0) {
      milestones[debtId] = uniqueChapters
    }
  }

  const debts: Record<string, EffectiveDebtProjection> = {}
  const debtsDueToProgress: string[] = []
  const debtsDueToClose: string[] = []

  for (const debt of plotDebts) {
    const completedMilestones = milestones[debt.id] ?? []
    const nextUnpaidMilestones = debt.mustProgressBy
      .filter((ch) => !completedMilestones.includes(ch))

    let effectiveStatus: EffectiveDebtStatus = debt.status
    if (closedSet.has(debt.id)) {
      effectiveStatus = 'closed'
    } else if (completedMilestones.length > 0) {
      effectiveStatus = 'progressing'
    }

    debts[debt.id] = {
      debtId: debt.id,
      contractStatus: debt.status,
      effectiveStatus,
      completedMilestones,
      nextUnpaidMilestones,
    }

    if (effectiveStatus === 'closed') continue

    // Deadline closure tepat bab ini → wajib tutup (prioritas atas progress).
    if (debt.mustCloseBy === chapterNumber) {
      debtsDueToClose.push(debt.id)
      continue
    }
    // Milestone TEPAT bab ini dan belum lunas → wajib progress.
    if (nextUnpaidMilestones.includes(chapterNumber)) {
      debtsDueToProgress.push(debt.id)
    }
  }

  return {
    debts,
    debtsDueToProgress: debtsDueToProgress.sort(compareIds),
    debtsDueToClose: debtsDueToClose.sort(compareIds),
    closedDebtIds,
    progressedMilestones: milestones,
  }
}
