/**
 * M10-A Task 3 — Plot debt lifecycle (plan §10).
 *
 * Lifecycle debt "main_mystery": diperkenalkan Bab 5 (OPEN) -> progress Bab 10
 * (per-milestone) -> milestone kedua Bab 20 -> close Bab 35 (ledger) ->
 * reload Bab 36 (contract status basi). Ditambah deteksi close tidak
 * terpersist, milestone memory gap, dan progress tidak terpersist.
 *
 * Semantik saat ini (reviewer-confirmed): PROGRESS_NOT_PERSISTED ditekan saat
 * progress per-milestone ada — PLOT_DEBT_MILESTONE_MEMORY_GAP yang menembak.
 */
import { describe, expect, it } from 'vitest'
import { auditPlotDebts } from '../../lib/narrative-qa/plot-debt-audit'
import { mainMysteryDebt, plotDebtSample } from './sample-builder'
import { detailOf } from './sample-builder'

const DEBT = mainMysteryDebt()

function codesFor(overrides: Parameters<typeof plotDebtSample>[0]): string[] {
  return auditPlotDebts(plotDebtSample({ debts: [DEBT], ...overrides })).map((f) => f.code)
}

describe('plot-debt-lifecycle-audit — plan §10 lifecycle', () => {
  it('Bab 5: debt OPEN tanpa milestone jatuh tempo -> bersih (no finding)', () => {
    expect(codesFor({ chapter: 5 })).toEqual([])
  })

  it('Bab 10: progress per-milestone pertama tercatat -> bersih', () => {
    const codes = codesFor({
      chapter: 10,
      progressedMilestones: [{ debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 }],
    })
    expect(codes).toEqual([])
  })

  it('Bab 20: kedua milestone tercatat -> bersih', () => {
    const codes = codesFor({
      chapter: 20,
      progressedMilestones: [
        { debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 },
        { debtId: 'main_mystery', milestoneIndex: 1, progressedAt: 20 },
      ],
    })
    expect(codes).toEqual([])
  })

  it('Bab 20: hanya milestone kedua tercatat -> PLOT_DEBT_MILESTONE_MEMORY_GAP (bukan PROGRESS_NOT_PERSISTED)', () => {
    const findings = auditPlotDebts(plotDebtSample({
      chapter: 20,
      debts: [DEBT],
      progressedMilestones: [{ debtId: 'main_mystery', milestoneIndex: 1, progressedAt: 20 }],
    }))

    const gap = findings.find((f) => f.code === 'PLOT_DEBT_MILESTONE_MEMORY_GAP')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('MEDIUM')
    expect(detailOf(gap as NonNullable<typeof gap>).missingMilestones).toEqual([{ milestoneIndex: 0, milestoneChapter: 10 }])
    // Progress per-milestone ada -> PROGRESS_NOT_PERSISTED ditekan.
    expect(findings.some((f) => f.code === 'PLOT_DEBT_PROGRESS_NOT_PERSISTED')).toBe(false)
  })

  it('Bab 35: close dipersist (ledger + proposed + audit signals) -> tidak ada CLOSE_NOT_PERSISTED', () => {
    const findings = auditPlotDebts(plotDebtSample({
      chapter: 35,
      debts: [DEBT],
      ledgerClosedIds: ['main_mystery'],
      closesProposed: ['main_mystery'],
      auditSignalsClosesPlotDebts: ['main_mystery'],
      progressedMilestones: [
        { debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 },
        { debtId: 'main_mystery', milestoneIndex: 1, progressedAt: 20 },
      ],
    }))
    expect(findings.some((f) => f.code === 'PLOT_DEBT_CLOSE_NOT_PERSISTED')).toBe(false)
  })

  it('Bab 36: reload contract, status masih open walau ledger closed -> PLOT_DEBT_NEXT_CHAPTER_STATE_STALE HIGH', () => {
    const findings = auditPlotDebts(plotDebtSample({
      chapter: 36,
      debts: [DEBT], // status 'open' — contract tidak pernah dimutasi
      ledgerClosedIds: ['main_mystery'],
      closesProposed: ['main_mystery'],
      auditSignalsClosesPlotDebts: ['main_mystery'],
      progressedMilestones: [
        { debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 },
        { debtId: 'main_mystery', milestoneIndex: 1, progressedAt: 20 },
      ],
    }))

    const stale = findings.find((f) => f.code === 'PLOT_DEBT_NEXT_CHAPTER_STATE_STALE')
    expect(stale).toBeDefined()
    expect(stale?.severity).toBe('HIGH')
    expect(detailOf(stale as NonNullable<typeof stale>).contractStatus).toBe('open')
    expect(detailOf(stale as NonNullable<typeof stale>).ledgerState).toBe('closed')
  })
})

describe('plot-debt-lifecycle-audit — persistence detectors', () => {
  it('PLOT_DEBT_CLOSE_NOT_PERSISTED BLOCKER saat closure diusulkan tapi tidak ada di ledger maupun signals', () => {
    const findings = auditPlotDebts(plotDebtSample({
      chapter: 35,
      debts: [DEBT],
      closesProposed: ['main_mystery'],
      progressedMilestones: [
        { debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 },
        { debtId: 'main_mystery', milestoneIndex: 1, progressedAt: 20 },
      ],
    }))

    const close = findings.find((f) => f.code === 'PLOT_DEBT_CLOSE_NOT_PERSISTED')
    expect(close).toBeDefined()
    expect(close?.severity).toBe('BLOCKER')
    expect(findings).toHaveLength(1)
  })

  it('PLOT_DEBT_CLOSE_NOT_PERSISTED MEDIUM saat closure ada di signals tapi tidak di ledger', () => {
    const findings = auditPlotDebts(plotDebtSample({
      chapter: 35,
      debts: [DEBT],
      closesProposed: ['main_mystery'],
      auditSignalsClosesPlotDebts: ['main_mystery'],
      progressedMilestones: [
        { debtId: 'main_mystery', milestoneIndex: 0, progressedAt: 10 },
        { debtId: 'main_mystery', milestoneIndex: 1, progressedAt: 20 },
      ],
    }))

    const close = findings.find((f) => f.code === 'PLOT_DEBT_CLOSE_NOT_PERSISTED')
    expect(close).toBeDefined()
    expect(close?.severity).toBe('MEDIUM')
  })

  it('PLOT_DEBT_PROGRESS_NOT_PERSISTED HIGH saat milestone jatuh tempo tanpa progress apa pun', () => {
    const findings = auditPlotDebts(plotDebtSample({
      chapter: 10,
      debts: [DEBT],
    }))

    const progress = findings.find((f) => f.code === 'PLOT_DEBT_PROGRESS_NOT_PERSISTED')
    expect(progress).toBeDefined()
    expect(progress?.severity).toBe('HIGH')
    expect(detailOf(progress as NonNullable<typeof progress>).dueMilestones).toEqual([10])
    expect(detailOf(progress as NonNullable<typeof progress>).contractStatus).toBe('open')
  })

  it('MILESTONE_MEMORY_GAP hanya menembak saat SEBAGIAN milestone tercatat — tanpa progress sama sekali tidak', () => {
    const noProgress = auditPlotDebts(plotDebtSample({ chapter: 20, debts: [DEBT] }))
    expect(noProgress.some((f) => f.code === 'PLOT_DEBT_MILESTONE_MEMORY_GAP')).toBe(false)
    expect(noProgress.some((f) => f.code === 'PLOT_DEBT_PROGRESS_NOT_PERSISTED')).toBe(true)
  })
})
