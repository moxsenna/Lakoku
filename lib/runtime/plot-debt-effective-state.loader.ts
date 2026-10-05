/**
 * M10-A1d — Loader ledger plot-debt efektif (server-only).
 *
 * Membaca SEMUA baris `reader_plot_debt_progress` (milestone rows) dan
 * `reader_plot_debt_closures` milik satu reader, lalu memproyeksikan
 * `EffectivePlotDebtState` dengan `projectEffectivePlotDebtState()` (pure,
 * fail-closed). Proyeksi ini dimasukkan SEBELUM `buildChapterBrief()` agar
 * kewajiban plot-debt terlihat oleh generation, dan resolver memakai
 * proyeksi YANG SAMA (snapshot S era).
 *
 * Ledger hanya memiliki SELECT untuk service_role; DML diblok (migrasi
 * `chapter_state_delta_expand`). Koneksi wajib admin (server-only).
 */

import 'server-only'
import { getDb, result } from '@lakoku/db'
import {
  projectEffectivePlotDebtState,
  type EffectivePlotDebtState,
  type ProgressedMilestones,
} from '@lakoku/narrative-core'
import type { PlotDebt } from '@/lib/story-engine/story-contract'

export interface LoadEffectivePlotDebtInput {
  userId: string
  storyId: string
  chapterNumber: number
  plotDebts: readonly PlotDebt[]
}

/** Proyeksi effective plot-debt state per-reader dari ledger append-only. */
export async function loadEffectivePlotDebtState(
  input: LoadEffectivePlotDebtInput,
): Promise<EffectivePlotDebtState> {
  const db = getDb()

  // RLS_AUDIT(reader_plot_debt_progress): SERVICE_ROLE_BYPASS - read reader plot debt progress ledger
  // RLS_AUDIT(reader_plot_debt_closures): SERVICE_ROLE_BYPASS - read reader plot debt closures ledger
  const [progressRes, closuresRes] = await Promise.all([
    result(
      db
        .selectFrom('reader_plot_debt_progress')
        .select(['debt_id', 'milestone_chapter'])
        .where('user_id', '=', input.userId)
        .where('story_id', '=', input.storyId)
        .execute()
    ),
    result(
      db
        .selectFrom('reader_plot_debt_closures')
        .select('debt_id')
        .where('user_id', '=', input.userId)
        .where('story_id', '=', input.storyId)
        .execute()
    ),
  ])

  if (progressRes.error) {
    throw new Error(`loadEffectivePlotDebtState.progress: ${progressRes.error.message}`)
  }
  if (closuresRes.error) {
    throw new Error(`loadEffectivePlotDebtState.closures: ${closuresRes.error.message}`)
  }

  const progressedMilestones: ProgressedMilestones = {}
  for (const row of progressRes.data ?? []) {
    const debtId = String(row.debt_id)
    const milestone = Number(row.milestone_chapter)
    const existing = progressedMilestones[debtId] ?? []
    if (!existing.includes(milestone)) {
      existing.push(milestone)
    }
    progressedMilestones[debtId] = existing
  }

  const closedDebtIds = (closuresRes.data ?? []).map((row) => String(row.debt_id))

  return projectEffectivePlotDebtState({
    plotDebts: input.plotDebts,
    progressedMilestones,
    closedDebtIds,
    chapterNumber: input.chapterNumber,
  })
}