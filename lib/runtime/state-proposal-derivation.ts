/**
 * M10-A1d — Deterministic default derivation of StructuredStateProposalV1.
 *
 * Murni (tanpa server-only). Sumber struktur: kanon + kontrak + proyeksi
 * ledger — BUKAN model (koreksi #6: real prose model prose-only, tidak pernah
 * menentukan mutasi state).
 *
 * Default produksi (living v1) hanya memancarkan kewajiban plot-debt eksplisit
 * (koreksi #3) dan act-rollup deterministik (koreksi #1: act boundary ≡
 * `actPlan.find(act => act.toChapter === chapterNumber)`). Tanpa narasi sastra,
 * tanpa inventing fakta/karakter/timeline. Driver deterministik (A1d.3) bebas
 * memasok proposal penuh lewat `input.stateProposal` — default ini hanya
 * fallback produksi yang aman.
 */
import {
  STRUCTURED_STATE_PROPOSAL_SCHEMA_VERSION,
  type StructuredStateProposalV1,
} from '@lakoku/narrative-core'
import type { EffectivePlotDebtState } from '@lakoku/narrative-core'
import type { StoryContract } from '@/lib/story-engine/story-contract'

export interface DeriveStructuredStateProposalDefaultInput {
  storyId: string
  chapterNumber: number
  storyContract: StoryContract
  effectivePlotDebtState: EffectivePlotDebtState
}

export function deriveStructuredStateProposalDefault(
  input: DeriveStructuredStateProposalDefaultInput,
): StructuredStateProposalV1 {
  const { storyId, chapterNumber, storyContract, effectivePlotDebtState } = input

  if (effectivePlotDebtState.chapterNumber !== chapterNumber) {
    throw new Error(
      `STATE_PROPOSAL_CHAPTER_MISMATCH: proyeksi untuk Bab ${effectivePlotDebtState.chapterNumber}, bukan ${chapterNumber}.`,
    )
  }

  // Koreksi #3: progress EKSPLISIT, bukan materializer auto-insert. Milestone
  // yang wajib progress tepat bab ini = debtsDueToProgress (unpaid milestone == bab).
  const progress = effectivePlotDebtState.debtsDueToProgress.map((debtId) => ({
    debtId,
    milestoneChapter: chapterNumber,
  }))

  // Closure deadline tepat bab ini; bentuk deterministik RESOLVED.
  const closures = effectivePlotDebtState.debtsDueToClose.map((debtId) => ({
    debtId,
    closureForm: 'RESOLVED' as const,
  }))

  // Koreksi #1: act boundary ≡ actPlan entry dengan toChapter === bab ini.
  const actEntry = storyContract.actPlan.find((act) => act.toChapter === chapterNumber)
  const actRollup: StructuredStateProposalV1['actRollup'] = actEntry
    ? { summary: null }
    : null

  return {
    schemaVersion: STRUCTURED_STATE_PROPOSAL_SCHEMA_VERSION,
    storyId,
    chapterNumber,
    facts: { add: [], markPaidOff: [] },
    knowledge: { grants: [] },
    secrets: { revealIds: [] },
    timeline: { append: [] },
    characters: { statusChanges: [] },
    threads: { touches: [], transitions: [] },
    plotDebts: { progress, closures },
    actRollup,
  }
}