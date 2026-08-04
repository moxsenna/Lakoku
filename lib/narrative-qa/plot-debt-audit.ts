/**
 * M10-A Task 2 — Plot debt persistence detectors.
 *
 * Traces the real plot-debt path: contract plotDebts (pure projection), the
 * closure ledger (reader_plot_debt_closures), checkpoint audit signals
 * (closesPlotDebts), and the v4 publication RPC that persists closures atomically.
 *
 * Evidence cited (source strings):
 *   - lib/story-engine/story-contract.ts :: PlotDebtSchema — actual shape is
 *     { id, question, introducedAt, mustProgressBy: number[], mustCloseBy, status:
 *     'open'|'progressing'|'closed' } (note: NO openedChapter/milestones/closedChapter
 *     fields — the plan brief sketch does not match the committed schema).
 *   - lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures — pure
 *     projection: ledger of closed ids + accepted proposals projected onto debts
 *     via projectClosedDebts; contract rows are never mutated.
 *   - lib/story-engine/plot-debt.ts :: auditPlotDebts — deterministic per-chapter
 *     audit (MAJOR_MYSTERY_AFTER_35, THREAD_AFTER_40, ENDING_NOT_LOCKED,
 *     MAIN_MYSTERY_OPEN, OPEN_CONFLICT_AT_END, NEW_CONFLICT_AT_END).
 *   - lib/story-engine/chapter-brief.ts :: buildChapterBrief — plotDebtsToProgress
 *     / plotDebtsToClose computed from contract debt.status and milestones ONLY;
 *     the reader closure ledger is not consulted, so a closed-in-ledger debt still
 *     shows as open in the next chapter brief.
 *   - lib/runtime/continuation-context.server.ts :: loadPreviousChapterRow /
 *     choiceHistoryFrom... — loadChapter -> buildChapterBrief uses
 *     storyContract.plotDebts with no ledger overlay (effective state never
 *     projected from reader_plot_debt_closures).
 *   - supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql
 *     :: publish_generation_job_chapter_v4 — atomically inserts reader_plot_debt_closures
 *     (on conflict do nothing), verifies checkpoint closesPlotDebts matches the
 *     caller payload exactly (CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH), validates
 *     DEBT_CLOSURE_DEADLINE_VIOLATION / MAIN_MYSTERY_UNRESOLVED / OPEN_DEBT_AT_END.
 */

import type {
  AuditSeverity,
  StoryBibleAuditFinding,
  StructuredEvidence,
} from './story-bible-audit-contract'

export type PlotDebtStatus = 'open' | 'progressing' | 'closed'

export interface PlotDebtState {
  id: string
  introducedAt: number
  mustProgressBy: number[]
  mustCloseBy: number
  status: PlotDebtStatus
}

export interface PlotDebtMilestoneProgress {
  debtId: string
  /** Index into the debt's mustProgressBy array. */
  milestoneIndex: number
  progressedAt?: number
}

export interface PlotDebtAuditSample {
  chapter: number
  debts: PlotDebtState[]
  /** Debt ids already closed in the reader ledger (reader_plot_debt_closures). */
  ledgerClosedIds: string[]
  /**
   * Whether buildChapterBrief consults the reader ledger when projecting
   * plotDebtsToProgress/ToClose. Production: false — the brief reads contract
   * status only, so closures persisted in the ledger are invisible to the
   * effective state (BLOCKER umbrella).
   */
  briefConsultsLedger?: boolean
  /** Closure proposals made by this chapter's draft. */
  closesProposed: string[]
  /** closesPlotDebts carried by the checkpoint audit signals. */
  auditSignalsClosesPlotDebts: string[]
  /** Debts with a recorded progress signal this chapter (debt-level). */
  progressRecordedThisChapter: string[]
  /** Per-milestone progress records (debtId + milestoneIndex into mustProgressBy). */
  progressedMilestones?: PlotDebtMilestoneProgress[]
}

export const PLOT_DEBT_AUDIT_EVIDENCE: StructuredEvidence[] = [
  {
    source: 'lib/story-engine/story-contract.ts :: PlotDebtSchema',
    evidenceClass: 'SCHEMA_CONTRACT',
    observation:
      'Actual plot debt shape: { id, question, introducedAt, mustProgressBy: chapter[], mustCloseBy, status: open|progressing|closed }. No openedChapter/milestones/closedChapter fields exist in the committed schema.',
  },
  {
    source: 'lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Closures are decided PURELY in memory: ledger closed ids + accepted proposals are projected via projectClosedDebts; the input debts are never mutated, so contract rows keep status open/progressing until a persistence step writes the ledger.',
  },
  {
    source: 'lib/story-engine/chapter-brief.ts :: buildChapterBrief',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'plotDebtsToClose = open debts with mustCloseBy <= chapter; plotDebtsToProgress = remaining open debts with a mustProgressBy milestone <= chapter. Computed from CONTRACT status only — reader_plot_debt_closures is not read here.',
  },
  {
    source: 'lib/runtime/continuation-context.server.ts :: loadChapter / buildChapterBrief',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'loadChapter -> buildChapterBrief uses storyContract.plotDebts with no ledger overlay; effective plot-debt state is never projected from reader_plot_debt_closures into the brief.',
  },
  {
    source: 'lib/story-engine/plot-debt.ts :: auditPlotDebts',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Deterministic per-chapter debt audit with CLOSURE_RUNWAY constants (noNewMajorConflictAfter 35, noNewThreadAfter 40, endingLockChapter 45, mainMysteryResolveBy 48, finalEndingChapter 50).',
  },
  {
    source: 'supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'The v4 RPC canonicalizes p_closures, requires checkpoint audit signals closesPlotDebts to match exactly (CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH), validates ledger conflicts (DEBT_CLOSURE_CONFLICT), and inserts reader_plot_debt_closures rows in the same transaction (on conflict do nothing).',
  },
  {
    source: 'lib/runtime/personalized-generation.ts :: derivePlotDebtAuditFlags',
    evidenceClass: 'SOURCE_TRACE',
    observation:
      'Audit flags (opensNewThread/opensMajorMystery/opensNewConflict/endingLocked) are derived from draft + findings + state delta, then persisted into checkpoint audit signals V2; closures flow from the checkpoint to the v4 publication call.',
  },
]

/**
 * Emit plot-debt persistence findings for one chapter sample.
 * - PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED (BLOCKER): the brief builds
 *   plotDebtsToProgress/ToClose from CONTRACT status only, ignoring the
 *   reader_plot_debt_closures ledger. Closure proposals can be durable in the
 *   ledger yet never projected into effective state. Emitted when the ledger
 *   has closures AND brief selection ignores the ledger (briefConsultsLedger
 *   false/absent).
 * - PLOT_DEBT_PROGRESS_NOT_PERSISTED (HIGH child): a debt has a mustProgressBy
 *   milestone at or before this chapter, is still contract-open, and no progress
 *   was recorded (neither debt-level nor per-milestone). Progression memory
 *   alone — the milestone memory gap semantics stay folded into this single
 *   HIGH child (no separate PLOT_DEBT_MILESTONE_MEMORY_GAP).
 * - PLOT_DEBT_CLOSE_NOT_PERSISTED: a closure was proposed but never persisted
 *   (absent from both the ledger and the checkpoint audit signals).
 * - PLOT_DEBT_NEXT_CHAPTER_STATE_STALE: debt is closed in the ledger while the
 *   contract row still says open/progressing — kept for traceability; the
 *   umbrella BLOCKER is the headline finding.
 */
export function auditPlotDebts(sample: PlotDebtAuditSample): StoryBibleAuditFinding[] {
  const findings: StoryBibleAuditFinding[] = []

  const ledger = new Set(sample.ledgerClosedIds)
  const proposed = new Set(sample.closesProposed)
  const signaled = new Set(sample.auditSignalsClosesPlotDebts)
  const progressed = new Set(sample.progressRecordedThisChapter)
  const milestoneProgress = new Set(
    (sample.progressedMilestones ?? []).map((p) => `${p.debtId}:${p.milestoneIndex}`),
  )

  // --- Umbrella BLOCKER: effective state not projected ---
  // The ledger carries closures but the brief selection (buildChapterBrief)
  // ignores the ledger (reads contract status only). A closed-in-ledger debt
  // still shows as open in the next chapter brief.
  if (ledger.size > 0 && sample.briefConsultsLedger !== true) {
    findings.push(baseFinding('PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED', 'BLOCKER', {
      detail: {
        chapter: sample.chapter,
        ledgerClosedIds: [...ledger],
        briefConsultsLedger: false,
      },
      risk: 'reader_plot_debt_closures ledger contains persisted closures, but buildChapterBrief derives plotDebtsToProgress/plotDebtsToClose from CONTRACT status only (lib/story-engine/chapter-brief.ts). The closure is durable in the ledger yet never projected into effective state — the next chapter brief keeps demanding progress/closure on debts that are already closed. Combined with the missing Living Canon writeback (LIVING_CANON_WRITEBACK_MISSING), plot-debt state cannot converge.',
      followUp: 'Project the ledger over contract status (projectClosedDebts) before building the brief — the ledger must be an input to buildChapterBrief plotDebtsToProgress/plotDebtsToClose.',
    }))
  }

  for (const debt of sample.debts) {
    const dueMilestones = debt.mustProgressBy
      .map((milestoneChapter, milestoneIndex) => ({ milestoneChapter, milestoneIndex }))
      .filter((m) => m.milestoneChapter <= sample.chapter)
    const closedInLedger = ledger.has(debt.id)
    const progressedDue = dueMilestones.filter((m) =>
      milestoneProgress.has(`${debt.id}:${m.milestoneIndex}`),
    )

    // --- Close not persisted ---
    if (proposed.has(debt.id) && !ledger.has(debt.id) && !signaled.has(debt.id)) {
      findings.push(baseFinding('PLOT_DEBT_CLOSE_NOT_PERSISTED', 'BLOCKER', {
        detail: { chapter: sample.chapter, debtId: debt.id, mustCloseBy: debt.mustCloseBy },
        risk: `Debt "${debt.id}" closure proposed at chapter ${sample.chapter} but persisted nowhere: absent from reader_plot_debt_closures ledger AND from checkpoint closesPlotDebts. The v4 RPC would reject the publish with CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH or the closure silently vanishes.`,
        followUp: 'Ensure closesPlotDebts flows draft -> checkpoint audit signals -> v4 p_closures in the same generation attempt.',
      }))
    } else if (proposed.has(debt.id) && signaled.has(debt.id) && !ledger.has(debt.id)) {
      findings.push(baseFinding('PLOT_DEBT_CLOSE_NOT_PERSISTED', 'MEDIUM', {
        detail: { chapter: sample.chapter, debtId: debt.id },
        risk: `Debt "${debt.id}" closure reached checkpoint signals but not the reader ledger. The v4 RPC inserts ledger rows transactionally, so this indicates a pre-v4 path (publishChapterV2 sync) or a retry that re-proposed after the ledger write failed.`,
        followUp: 'Verify which publish path was used; v2 sync path has no closure ledger.',
      }))
    }

    // --- Progress not persisted (HIGH child; milestone memory gap folded in) ---
    const missingMilestones = dueMilestones.filter((m) =>
      !milestoneProgress.has(`${debt.id}:${m.milestoneIndex}`),
    )
    if (
      dueMilestones.length > 0
      && !closedInLedger
      && debt.status === 'open'
      && !progressed.has(debt.id)
      && progressedDue.length === 0
    ) {
      findings.push(baseFinding('PLOT_DEBT_PROGRESS_NOT_PERSISTED', 'HIGH', {
        detail: {
          chapter: sample.chapter,
          debtId: debt.id,
          dueMilestones: dueMilestones.map((m) => m.milestoneChapter),
          contractStatus: debt.status,
        },
        risk: `Debt "${debt.id}" has milestone(s) ${dueMilestones.map((m) => m.milestoneChapter).join(', ')} at or before chapter ${sample.chapter}, contract status is still 'open', and no progress was recorded (neither debt-level nor per-milestone). The milestones pass without a durable trace; buildChapterBrief will keep demanding progress in later chapters.`,
        followUp: 'Persist a progress signal (status transitioning to progressing, or an explicit per-milestone progress record) when a milestone chapter is reached.',
      }))
    }

    if (progressedDue.length > 0 && missingMilestones.length > 0) {
      findings.push(baseFinding('PLOT_DEBT_PROGRESS_NOT_PERSISTED', 'HIGH', {
        detail: {
          chapter: sample.chapter,
          debtId: debt.id,
          progressedMilestones: progressedDue.map((m) => ({
            milestoneIndex: m.milestoneIndex,
            milestoneChapter: m.milestoneChapter,
          })),
          missingMilestones: missingMilestones.map((m) => ({
            milestoneIndex: m.milestoneIndex,
            milestoneChapter: m.milestoneChapter,
          })),
        },
        risk: `Debt "${debt.id}" has per-milestone progress for ${progressedDue.length} of ${dueMilestones.length} due milestones but NO record for ${missingMilestones.map((m) => m.milestoneChapter).join(', ')}. Progression memory is incomplete: the engine cannot tell whether those milestones were ever satisfied (milestone memory gap), because milestone satisfaction is not persisted per milestone.`,
        followUp: 'Introduce a per-milestone ledger so the brief builder and next-chapter state can distinguish met vs skipped milestones.',
      }))
    }

    // --- Next chapter state stale (traceability; umbrella is the headline) ---
    if (closedInLedger && debt.status !== 'closed') {
      findings.push(baseFinding('PLOT_DEBT_NEXT_CHAPTER_STATE_STALE', 'MEDIUM', {
        detail: {
          chapter: sample.chapter,
          debtId: debt.id,
          contractStatus: debt.status,
          ledgerState: 'closed',
        },
        risk: `Debt "${debt.id}" is closed in the reader ledger but the contract row still says '${debt.status}'. buildChapterBrief derives plotDebtsToProgress/plotDebtsToClose from contract status only, so the NEXT chapter brief may demand progress/closure on an already-closed debt. Headline finding: PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED.`,
        followUp: 'Project the ledger over contract status (projectClosedDebts) before building the brief, or sync contract status on closure.',
      }))
    }
  }

  return findings
}

function baseFinding(
  code: string,
  severity: AuditSeverity,
  args: { detail: Record<string, unknown>; risk: string; followUp: string },
): StoryBibleAuditFinding {
  return {
    code,
    severity,
    domain: 'Plot Debt',
    status: severity === 'BLOCKER' ? 'WRITE_PATH_UNPROVEN' : 'BOUNDED_LOSS_RISK',
    sourceOfTruth: ['story_generation_contracts.plot_debts_json', 'reader_plot_debt_closures'],
    producers: [
      'lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures',
      'lib/runtime/personalized-generation.ts :: derivePlotDebtAuditFlags',
    ],
    consumers: ['lib/story-engine/chapter-brief.ts :: buildChapterBrief'],
    validators: ['supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4'],
    evidence: [
      ...PLOT_DEBT_AUDIT_EVIDENCE,
      {
        source: `lib/narrative-qa/plot-debt-audit.ts :: ${code}`,
        evidenceClass: 'PURE_CHARACTERIZATION',
        observation: `Detector emitted from input data: ${JSON.stringify(args.detail)}`,
      } satisfies StructuredEvidence,
    ],
    risk: args.risk,
    recommendedFollowUp: args.followUp,
  }
}
