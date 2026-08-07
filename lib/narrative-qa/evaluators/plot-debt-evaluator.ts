/**
 * B.3.3 — Plot-debt lifecycle evaluator.
 *
 * Inputs are raw ledger rows + the effective-state projection the runtime
 * actually produced. The evaluator recomputes the projection itself and
 * compares; it never accepts a caller-supplied "projected: true" verdict.
 */

import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { deadline, observed, validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const PLOT_DEBT_EVALUATOR_ID = 'plot-debt-lifecycle'
export const PLOT_DEBT_EVALUATOR_VERSION = '1.1.0'

export const MAIN_MYSTERY_CLOSURE_CHAPTER = 48

export type PlotDebtEventKind = 'INTRODUCED' | 'PROGRESS' | 'CLOSED'

/** Raw append-only ledger event for a plot debt. */
export interface PlotDebtLedgerEvent {
  debtId: string
  kind: PlotDebtEventKind
  chapterNumber: number
  /** Milestone identifier for PROGRESS events; null otherwise. */
  milestoneId: string | null
}

/** Contractual definition of a debt, independent of what happened to it. */
export interface PlotDebtContract {
  debtId: string
  isMainMystery: boolean
  allowedIntroductionFromChapter: number
  allowedIntroductionToChapter: number
  mustCloseByChapter: number
  requiredMilestoneIds: string[]
}

/** Effective state the runtime projected for the evaluated chapter. */
export interface ProjectedDebtState {
  debtId: string
  isOpen: boolean
  dueInBrief: boolean
}

export interface PlotDebtLifecycleInputV1 {
  contracts: PlotDebtContract[]
  ledgerEvents: PlotDebtLedgerEvent[]
  /** null = runtime produced no projection before generation at all. */
  projectedState: ProjectedDebtState[] | null
}

export const extractPlotDebtChapters: TemporalExtractor<PlotDebtLifecycleInputV1> = (input) => {
  const refs: ChapterRef[] = []
  input.ledgerEvents.forEach((event, i) => {
    refs.push(...observed(`ledgerEvents[${i}].chapterNumber`, event.chapterNumber))
  })
  input.contracts.forEach((contract, i) => {
    // Contractual windows are forward-looking declarations, not observations.
    refs.push(
      ...deadline(
        `contracts[${i}].allowedIntroductionFromChapter`,
        contract.allowedIntroductionFromChapter,
      ),
    )
    refs.push(
      ...deadline(
        `contracts[${i}].allowedIntroductionToChapter`,
        contract.allowedIntroductionToChapter,
      ),
    )
    refs.push(...deadline(`contracts[${i}].mustCloseByChapter`, contract.mustCloseByChapter))
  })
  return refs
}

export function evaluatePlotDebtLifecycle(
  envelope: EvaluatorEnvelopeV1<PlotDebtLifecycleInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractPlotDebtChapters)
  const { storyId, input, evaluatedChapter } = envelope
  const findings: LongHorizonFindingV1[] = []
  const currentChapter = evaluatedChapter ?? envelope.horizon?.toChapter ?? 0

  if (input.projectedState === null) {
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
          ref: `plot_debt:projection:ch:${currentChapter}`,
          detail: { projectionPresent: false, ledgerEventCount: input.ledgerEvents.length },
        },
      ],
      message: `Effective plot debt state was not projected before generation at chapter ${currentChapter}.`,
      remediationClass: 'dataflow',
    })
  }

  const contracts = [...input.contracts].sort((a, b) => a.debtId.localeCompare(b.debtId))
  const events = [...input.ledgerEvents].sort(
    (a, b) =>
      a.chapterNumber - b.chapterNumber ||
      a.debtId.localeCompare(b.debtId) ||
      a.kind.localeCompare(b.kind) ||
      (a.milestoneId ?? '').localeCompare(b.milestoneId ?? ''),
  )

  const projectedById = new Map((input.projectedState ?? []).map((row) => [row.debtId, row]))

  for (const contract of contracts) {
    const own = events.filter((event) => event.debtId === contract.debtId)
    const introductions = own.filter((event) => event.kind === 'INTRODUCED')
    const closures = own.filter((event) => event.kind === 'CLOSED')
    const progresses = own.filter((event) => event.kind === 'PROGRESS')

    // ── introduction window ────────────────────────────────────────────────
    for (const introduction of introductions) {
      if (
        introduction.chapterNumber < contract.allowedIntroductionFromChapter ||
        introduction.chapterNumber > contract.allowedIntroductionToChapter
      ) {
        findings.push({
          schemaVersion: 1,
          code: 'PLOT_DEBT_INTRODUCED_OUTSIDE_WINDOW',
          severity: 'HIGH',
          domain: 'Plot Debt',
          storyId,
          chapterNumber: introduction.chapterNumber,
          evidence: [
            {
              kind: 'commit',
              ref: `plot_debt:${contract.debtId}:introduced`,
              detail: {
                debtId: contract.debtId,
                introducedChapter: introduction.chapterNumber,
                allowedFrom: contract.allowedIntroductionFromChapter,
                allowedTo: contract.allowedIntroductionToChapter,
              },
            },
          ],
          message: `Plot debt ${contract.debtId} introduced at chapter ${introduction.chapterNumber}, outside its allowed window ${contract.allowedIntroductionFromChapter}..${contract.allowedIntroductionToChapter}.`,
          remediationClass: 'runtime',
        })
      }
    }

    // ── duplicate milestone writes ─────────────────────────────────────────
    const milestoneCounts = new Map<string, number>()
    for (const progress of progresses) {
      const key = progress.milestoneId ?? '<null>'
      milestoneCounts.set(key, (milestoneCounts.get(key) ?? 0) + 1)
    }
    for (const [milestoneId, count] of [...milestoneCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      if (count > 1) {
        findings.push({
          schemaVersion: 1,
          code: 'PLOT_DEBT_MILESTONE_DUPLICATE',
          severity: 'HIGH',
          domain: 'Plot Debt',
          storyId,
          chapterNumber: currentChapter,
          evidence: [
            {
              kind: 'commit',
              ref: `plot_debt:${contract.debtId}:milestone:${milestoneId}`,
              detail: { debtId: contract.debtId, milestoneId, writeCount: count },
            },
          ],
          message: `Plot debt ${contract.debtId} milestone ${milestoneId} written ${count} times.`,
          remediationClass: 'runtime',
        })
      }
    }

    const firstClosure = closures[0]

    // ── required milestone omitted before closure ──────────────────────────
    if (firstClosure) {
      const recorded = new Set(
        progresses
          .filter((progress) => progress.chapterNumber <= firstClosure.chapterNumber)
          .map((progress) => progress.milestoneId ?? '<null>'),
      )
      for (const requiredId of [...contract.requiredMilestoneIds].sort()) {
        if (!recorded.has(requiredId)) {
          findings.push({
            schemaVersion: 1,
            code: 'PLOT_DEBT_MILESTONE_OMITTED',
            severity: 'HIGH',
            domain: 'Plot Debt',
            storyId,
            chapterNumber: firstClosure.chapterNumber,
            evidence: [
              {
                kind: 'commit',
                ref: `plot_debt:${contract.debtId}:milestone:${requiredId}`,
                detail: {
                  debtId: contract.debtId,
                  missingMilestoneId: requiredId,
                  closedChapter: firstClosure.chapterNumber,
                },
              },
            ],
            message: `Plot debt ${contract.debtId} closed at chapter ${firstClosure.chapterNumber} without required milestone ${requiredId}.`,
            remediationClass: 'runtime',
          })
        }
      }
    }

    // ── double closure ─────────────────────────────────────────────────────
    if (closures.length > 1) {
      findings.push({
        schemaVersion: 1,
        code: 'PLOT_DEBT_CLOSED_TWICE',
        severity: 'HIGH',
        domain: 'Plot Debt',
        storyId,
        chapterNumber: closures[closures.length - 1].chapterNumber,
        evidence: [
          {
            kind: 'commit',
            ref: `plot_debt:${contract.debtId}:closed`,
            detail: {
              debtId: contract.debtId,
              closureChapters: closures.map((closure) => closure.chapterNumber),
            },
          },
        ],
        message: `Plot debt ${contract.debtId} closed ${closures.length} times.`,
        remediationClass: 'runtime',
      })
    }

    // ── closure after mustCloseBy ──────────────────────────────────────────
    if (firstClosure && firstClosure.chapterNumber > contract.mustCloseByChapter) {
      findings.push({
        schemaVersion: 1,
        code: 'PLOT_DEBT_CLOSED_AFTER_DEADLINE',
        severity: 'HIGH',
        domain: 'Plot Debt',
        storyId,
        chapterNumber: firstClosure.chapterNumber,
        evidence: [
          {
            kind: 'commit',
            ref: `plot_debt:${contract.debtId}:closed`,
            detail: {
              debtId: contract.debtId,
              closedChapter: firstClosure.chapterNumber,
              mustCloseByChapter: contract.mustCloseByChapter,
            },
          },
        ],
        message: `Plot debt ${contract.debtId} closed at chapter ${firstClosure.chapterNumber}, after its deadline chapter ${contract.mustCloseByChapter}.`,
        remediationClass: 'runtime',
      })
    }

    // ── overdue and still open ─────────────────────────────────────────────
    if (!firstClosure && currentChapter > contract.mustCloseByChapter) {
      findings.push({
        schemaVersion: 1,
        code: 'PLOT_DEBT_OVERDUE_UNCLOSED',
        severity: 'HIGH',
        domain: 'Plot Debt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'commit',
            ref: `plot_debt:${contract.debtId}`,
            detail: {
              debtId: contract.debtId,
              mustCloseByChapter: contract.mustCloseByChapter,
              currentChapter,
            },
          },
        ],
        message: `Plot debt ${contract.debtId} overdue: must close by chapter ${contract.mustCloseByChapter}, still open at chapter ${currentChapter}.`,
        remediationClass: 'runtime',
      })
    }

    // ── main mystery closure at Bab 48 ─────────────────────────────────────
    if (
      contract.isMainMystery &&
      currentChapter >= MAIN_MYSTERY_CLOSURE_CHAPTER &&
      (!firstClosure || firstClosure.chapterNumber > MAIN_MYSTERY_CLOSURE_CHAPTER)
    ) {
      findings.push({
        schemaVersion: 1,
        code: 'MAIN_MYSTERY_UNCLOSED_AT_48',
        severity: 'BLOCKER',
        domain: 'Plot Debt',
        storyId,
        chapterNumber: currentChapter,
        evidence: [
          {
            kind: 'commit',
            ref: `plot_debt:${contract.debtId}:main_mystery`,
            detail: {
              debtId: contract.debtId,
              closedChapter: firstClosure?.chapterNumber ?? null,
              requiredClosureChapter: MAIN_MYSTERY_CLOSURE_CHAPTER,
              currentChapter,
            },
          },
        ],
        message: `Main mystery ${contract.debtId} is not closed by chapter ${MAIN_MYSTERY_CLOSURE_CHAPTER} (evaluated at chapter ${currentChapter}).`,
        remediationClass: 'runtime',
      })
    }

    // ── ledger vs effective-state projection divergence ────────────────────
    if (input.projectedState !== null) {
      const projected = projectedById.get(contract.debtId)
      const derivedOpen =
        introductions.some((introduction) => introduction.chapterNumber <= currentChapter) &&
        !closures.some((closure) => closure.chapterNumber <= currentChapter)

      if (!projected) {
        findings.push({
          schemaVersion: 1,
          code: 'PLOT_DEBT_PROJECTION_DIVERGENCE',
          severity: 'BLOCKER',
          domain: 'Plot Debt',
          storyId,
          chapterNumber: currentChapter,
          evidence: [
            {
              kind: 'commit',
              ref: `plot_debt:${contract.debtId}:projection`,
              detail: { debtId: contract.debtId, presentInProjection: false, derivedOpen },
            },
          ],
          message: `Plot debt ${contract.debtId} is absent from the effective-state projection at chapter ${currentChapter}.`,
          remediationClass: 'dataflow',
        })
      } else {
        if (projected.isOpen !== derivedOpen) {
          findings.push({
            schemaVersion: 1,
            code: 'PLOT_DEBT_PROJECTION_DIVERGENCE',
            severity: 'BLOCKER',
            domain: 'Plot Debt',
            storyId,
            chapterNumber: currentChapter,
            evidence: [
              {
                kind: 'commit',
                ref: `plot_debt:${contract.debtId}:projection`,
                detail: {
                  debtId: contract.debtId,
                  projectedOpen: projected.isOpen,
                  ledgerDerivedOpen: derivedOpen,
                },
              },
            ],
            message: `Plot debt ${contract.debtId} projection disagrees with the ledger at chapter ${currentChapter}.`,
            remediationClass: 'dataflow',
          })
        }
        if (!derivedOpen && projected.dueInBrief) {
          findings.push({
            schemaVersion: 1,
            code: 'CLOSED_PLOT_DEBT_STILL_DUE_IN_BRIEF',
            severity: 'HIGH',
            domain: 'Plot Debt',
            storyId,
            chapterNumber: currentChapter,
            evidence: [
              {
                kind: 'commit',
                ref: `plot_debt:${contract.debtId}:brief`,
                detail: {
                  debtId: contract.debtId,
                  closedChapter: firstClosure?.chapterNumber ?? null,
                  dueInBrief: true,
                },
              },
            ],
            message: `Closed plot debt ${contract.debtId} is still presented as due in the chapter ${currentChapter} brief.`,
            remediationClass: 'dataflow',
          })
        }
      }
    }
  }

  return findings
}
