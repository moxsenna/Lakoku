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
 * `buildChapterBrief()` (stateful) wajib memakai proyeksi ini, bukan
 * `contract.status + milestone <= chapter`.
 */

import { z } from 'zod'
import type { PlotDebt } from '../story-engine/story-contract'

/** Milestone per debt yang sudah tercatat selesai (sorted unique). */
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
  closedDebtIds: string[]
  /** Sorted unique. */
  progressedMilestones: ProgressedMilestones
}

const milestoneChapter = z.number().int().min(1).max(50)

export interface ProjectEffectivePlotDebtStateInput {
  plotDebts: readonly PlotDebt[]
  progressedMilestones: ProgressedMilestones
  closedDebtIds: readonly string[]
  chapterNumber: number
}

export function projectEffectivePlotDebtState(
  input: ProjectEffectivePlotDebtStateInput,
): EffectivePlotDebtState {
  const { plotDebts, closedDebtIds, chapterNumber } = input

  const closed = new Set(closedDebtIds)
  const milestones = normalizeProgressedMilestones(input.progressedMilestones)

  const debts: Record<string, EffectiveDebtProjection> = {}
  const debtsDueToProgress: string[] = []
  const debtsDueToClose: string[] = []

  for (const debt of plotDebts) {
    const completedMilestones = milestones[debt.id] ?? []
    const nextUnpaidMilestones = debt.mustProgressBy
      .filter((chapter) => !completedMilestones.includes(chapter))

    let effectiveStatus: EffectiveDebtStatus = debt.status
    if (closed.has(debt.id)) {
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
    debtsDueToProgress,
    debtsDueToClose,
    closedDebtIds: [...closed],
    progressedMilestones: milestones,
  }
}

/** Normalisasi: sorted unique, hanya milestone legal 1..50. */
export function normalizeProgressedMilestones(
  input: ProgressedMilestones,
): ProgressedMilestones {
  const out: ProgressedMilestones = {}
  for (const [debtId, chapters] of Object.entries(input)) {
    const unique = [...new Set(chapters)]
      .filter((chapter) => milestoneChapter.safeParse(chapter).success)
      .sort((a, b) => a - b)
    if (unique.length > 0) out[debtId] = unique
  }
  return out
}
