import { EvaluatorEnvelopeV1, LongHorizonFindingV1, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export interface PlotDebtLedgerEntry {
  debtId: string
  introducedChapter: number
  mustCloseByChapter: number
  closedChapter?: number
  progresses?: number[]
}

export interface PlotDebtLifecycleInputV1 {
  debts: PlotDebtLedgerEntry[]
  effectiveStateProjected: boolean
  mainMysteryClosedAt48?: boolean
}

export function evaluatePlotDebtLifecycle(envelope: EvaluatorEnvelopeV1<PlotDebtLifecycleInputV1>): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []

  if (!input.effectiveStateProjected) {
    findings.push({
      schemaVersion: 1,
      code: 'PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED',
      severity: 'BLOCKER',
      domain: 'Plot Debt',
      storyId,
      chapterNumber: evaluatedChapter,
      evidence: [
        {
          kind: 'commit',
          ref: `plot_debt:ch:${evaluatedChapter}`,
          detail: { effectiveStateProjected: false },
        },
      ],
      message: `Effective plot debt state not projected before generation at chapter ${evaluatedChapter}.`,
      remediationClass: 'dataflow',
    })
  }

  const currentCh = evaluatedChapter ?? 50
  for (const debt of input.debts) {
    if (!debt.closedChapter && currentCh > debt.mustCloseByChapter) {
      findings.push({
        schemaVersion: 1,
        code: 'PLOT_DEBT_OVERDUE_UNCLOSED',
        severity: 'HIGH',
        domain: 'Plot Debt',
        storyId,
        chapterNumber: currentCh,
        evidence: [
          {
            kind: 'commit',
            ref: `plot_debt:${debt.debtId}`,
            detail: { debtId: debt.debtId, mustCloseBy: debt.mustCloseByChapter, currentChapter: currentCh },
          },
        ],
        message: `Plot debt ${debt.debtId} overdue: must close by chapter ${debt.mustCloseByChapter}, still open at chapter ${currentCh}.`,
        remediationClass: 'runtime',
      })
    }
  }

  if (currentCh >= 48 && input.mainMysteryClosedAt48 === false) {
    findings.push({
      schemaVersion: 1,
      code: 'MAIN_MYSTERY_UNCLOSED_AT_48',
      severity: 'BLOCKER',
      domain: 'Plot Debt',
      storyId,
      chapterNumber: currentCh,
      evidence: [
        {
          kind: 'commit',
          ref: `plot_debt:main_mystery`,
          detail: { chapter: currentCh, mainMysteryClosedAt48: false },
        },
      ],
      message: `Main mystery remains unclosed at chapter ${currentCh} (must close by chapter 48).`,
      remediationClass: 'runtime',
    })
  }

  return findings
}
