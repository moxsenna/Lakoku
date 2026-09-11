/**
 * M10-C C-R3-R2 regression guard — harness fixture debt topology must be closed.
 *
 * Counted Run 1 at 6e3af48 failed at Bab 12 with
 * STATE_DELTA_POLICY_VIOLATION / 'Debt "debt:b" wajib menunjukkan progress di
 * Bab 12 (milestone belum lunas)'. Root cause was a fixture defect, not a
 * runtime one: C-R3-R1 declared `debt:b` in PLOT_DEBTS with
 * mustProgressBy [12, 45] but wired it nowhere — no seed thread, no proposal
 * progress at its own milestones, no closure before mustCloseBy, and no ending
 * referencing it. buildValidatedChapterStateDelta then correctly fail-closed
 * because effectivePlotDebtState.debtsDueToProgress contained a debt the
 * proposal never advanced.
 *
 * These are pure fixture-consistency invariants (no DB, no `server-only`): any
 * debt declared in the harness contract must be advanceable and closeable by
 * the deterministic proposal that the same fixture emits. Adding a debt without
 * its proposal wiring now fails here instead of 12 chapters into a counted run.
 */

import { describe, expect, it } from 'vitest'

import {
  HARNESS_TOTAL_CHAPTERS,
  PLOT_DEBTS,
  buildHarnessContract,
  harnessProposalFor,
} from '../../lib/narrative-qa/harness/fixture'

const STORY_ID = 'm10c-sync'

describe('harness fixture debt topology', () => {
  it('declares every debt milestone as proposal progress at that exact chapter', () => {
    for (const debt of PLOT_DEBTS) {
      for (const milestone of debt.mustProgressBy) {
        const proposal = harnessProposalFor(STORY_ID, milestone)
        const advanced = proposal.plotDebts.progress.some(
          (entry) => entry.debtId === debt.id && entry.milestoneChapter === milestone,
        )
        expect(advanced, `debt "${debt.id}" milestone Bab ${milestone} has no proposal progress`).toBe(true)
      }
    }
  })

  it('closes every debt at or before its mustCloseBy chapter', () => {
    for (const debt of PLOT_DEBTS) {
      const closedAt = Array.from({ length: debt.mustCloseBy }, (_, i) => i + 1).find((chapter) =>
        harnessProposalFor(STORY_ID, chapter).plotDebts.closures.some((entry) => entry.debtId === debt.id),
      )
      expect(closedAt, `debt "${debt.id}" is never closed by Bab ${debt.mustCloseBy}`).toBeDefined()
    }
  })

  it('resolves every ending requiredPlotDebtIds to a declared debt', () => {
    const declared = new Set(PLOT_DEBTS.map((debt) => debt.id))
    for (const ending of buildHarnessContract(STORY_ID).endingCandidates) {
      for (const debtId of ending.requiredPlotDebtIds ?? []) {
        expect(declared.has(debtId), `ending "${ending.key}" requires unknown debt "${debtId}"`).toBe(true)
      }
    }
  })

  it('keeps every debt milestone and closure inside the 50-chapter spine', () => {
    for (const debt of PLOT_DEBTS) {
      for (const milestone of debt.mustProgressBy) {
        expect(milestone).toBeGreaterThanOrEqual(debt.introducedAt)
        expect(milestone).toBeLessThanOrEqual(HARNESS_TOTAL_CHAPTERS)
      }
      expect(debt.mustCloseBy).toBeLessThanOrEqual(HARNESS_TOTAL_CHAPTERS)
    }
  })
})
