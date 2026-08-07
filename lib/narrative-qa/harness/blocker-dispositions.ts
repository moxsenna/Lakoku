/**
 * M10-C recovery — per-blocker dispositions with proof (reviewer mandate:
 * "Enam observability blocker harus ditutup atau direclassify dengan proof
 * sampai C PASS").
 *
 * The six capture blockers recorded in ./capture.ts are NOT removed — they are
 * carried into every artifact verbatim. This module attaches an auditable
 * disposition to each: either CLOSED (an honest runtime source now exists) or
 * RECLASSIFIED (the missing wire is proven to be out of M10-C's deterministic
 * scope or a tracked production observability defect, with the code evidence).
 * A blocker without a CLOSED/RECLASSIFIED disposition keeps forcing result
 * BLOCKED, exactly as before.
 *
 * Every reclassification here is PENDING REVIEWER RATIFICATION: the manifest
 * result computed with these dispositions is only final once the reviewer
 * accepts each proof. The harness writes the full disposition table into
 * blockers.json and summary.json so the audit trail travels with the evidence.
 */

import type { CaptureBlockerV1 } from './capture'
import {
  ACT_ENDING_REACHABILITY_BLOCKER,
  ACT_RECONCILIATION_TRIGGER_BLOCKER,
  CONTEXT_MEMORY_BUDGET_BLOCKER,
  CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER,
  ENDING_LOCK_TX_BLOCKER,
  ENDING_RESOLUTION_BEAT_BLOCKER,
} from './capture'

export type BlockerDispositionKind = 'UNRESOLVED' | 'CLOSED' | 'RECLASSIFIED'

export interface BlockerDispositionV1 {
  code: string
  disposition: BlockerDispositionKind
  /** Where the concern now lives, when reclassified. */
  reclassifiedTo: string | null
  /** Code-level evidence. No claim here may rest on harness behavior alone. */
  proof: string
  /** Findings that remain as recorded consequences of the missing wire. */
  consequenceFindings: string[]
  /** Reclassifications are evidence for the reviewer, not self-approval. */
  ratifiedByReviewer: boolean
}

/**
 * Verified on current main (21cb682 + recovery branch) — each proof cites the
 * files/lines checked at recovery time.
 */
export const BLOCKER_DISPOSITIONS: BlockerDispositionV1[] = [
  {
    code: CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'M10-F scope (real-model prompt observability)',
    proof:
      'Writer prompt layers 1a/3 are real-model artifacts. buildWriterPrompt '
      + '(lib/prose/prompt-engine/build-writer-prompt.ts) has exactly ONE '
      + 'production caller on current main: lib/ai-gateway/gateway-provider.ts:421 '
      + '(verified by repo-wide grep; every other reference is narrative-qa audit '
      + 'docs). M10-C is deterministic-only by contract (assertDeterministicProvider '
      + 'refuses NARRATIVE_PROVIDER=gateway), so no writer prompt text exists to '
      + 'observe on the C path — the absence is structural, not a missing wire in '
      + 'the narrative runtime. Populating the fields would violate the '
      + 'no-fabrication rule. The context-memory evaluator contract retains the '
      + 'fields for M10-F, where the gateway path runs and the layers exist.',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: CONTEXT_MEMORY_BUDGET_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'Production observability defect D-OBS-1 (dead wire, tracked)',
    proof:
      'persistRetrievalLog (lib/narrative/loader.ts:221) is wired into '
      + 'PersonalizedGenerationDeps (lib/runtime/personalized-generation.ts:206 '
      + 'deps declaration, :705 deps object) but has ZERO invocation sites anywhere '
      + 'in lib/runtime or lib/narrative on current main (verified by grep for '
      + '"persistRetrievalLog(" excluding definition/wiring/import lines — no '
      + 'matches). The retrieval budget therefore affects no canonical state and '
      + 'never has: it is a production observability defect identical for sync, '
      + 'worker, and real-model paths, not a harness-specific gap. It cannot '
      + 'invalidate C parity (both clones drop the identical nothing). Fixing it '
      + 'requires a call site in lib/runtime/personalized-generation.ts, which the '
      + 'M10-C recovery constraints declare read-only; recorded as tracked defect '
      + 'D-OBS-1 for the runtime team instead of being papered over.',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: ENDING_RESOLUTION_BEAT_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'Production observability defect D-OBS-2 (no beat persistence anywhere)',
    proof:
      'No production table, checkpoint field, or audit-signal records an '
      + 'emotional-resolution beat on current main: grep for '
      + '"emotionalResolution|emotional_resolution" across lib/runtime, lib/prose '
      + 'and supabase/migrations returns ZERO matches outside lib/narrative-qa. '
      + 'CheckpointAuditSignalsV2 carries only opensNewThread/opensMajorMystery/'
      + 'opensNewConflict/closesPlotDebts. The Bab-49 beat is a narrative-quality '
      + 'concept the runtime never persists; M10-B froze the evaluator field so F '
      + '(real-model stage) can score it once persistence exists. The capture '
      + 'leaves the field empty rather than synthesizing beats. Downstream finding '
      + 'CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING (HIGH) is retained in every run '
      + 'as the recorded consequence of this missing wire.',
    consequenceFindings: ['CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING'],
    ratifiedByReviewer: false,
  },
  {
    code: ENDING_LOCK_TX_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'Production observability defect D-OBS-3 (atomicity proven, tx-id unpersisted)',
    proof:
      'The load-bearing claim — the ending lock commits ATOMICALLY with its '
      + 'publication — IS provable on current main, and the harness proves it two '
      + 'ways. (1) Code: both V3 (sync) and V5 (worker) in '
      + 'supabase/migrations/20260805015000_living_canon_publication_primitives.sql '
      + 'call persist_ending_lock_v1 INSIDE the publication transaction (lines '
      + '~1289 and ~2050), acquiring the E2 advisory lock 130600 reentrantly in '
      + 'the same tx — a single SQL function body is one transaction. (2) Runtime: '
      + 'completion check ENDING_LOCKED verifies ending_lock_json carries the lock '
      + 'and reader_states.locked_ending_key matches it after Bab 50 in both '
      + 'modes. What is missing is only a persisted transaction IDENTIFIER '
      + '(persist_ending_lock_v1 stores {key,name,lockedAtChapter}; neither '
      + 'publisher writes a tx id), i.e. an observability column, not the '
      + 'atomic-commit behavior. Adding the column requires a migration, which '
      + 'the recovery constraints forbid. Downstream ENDING_LOCK_NOT_DURABLE '
      + '(HIGH) is retained as the recorded consequence.',
    consequenceFindings: ['ENDING_LOCK_NOT_DURABLE'],
    ratifiedByReviewer: false,
  },
  {
    code: ACT_RECONCILIATION_TRIGGER_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'Production observability defect D-OBS-4 (no publication-path call site)',
    proof:
      'runReconciliation / runReconciliationAdaptive (lib/narrative/'
      + 'reconciliation.ts) have NO call site on any publication path on current '
      + 'main: verified grep shows invocations only in evidence tooling '
      + '(scripts/m5-soak.ts, scripts/m7b-reconcile-smoke.ts); lib/authoring/'
      + 'reconcile-goal.ts references them only in doc comments. Reconciliation is '
      + 'an authoring-side instrument, not a reader-path side-effect. The '
      + 'act-boundary obligations the runtime DOES execute — act rollup commit and '
      + 'next-act blueprint version — are positively VERIFIED by completion check '
      + 'ACT_BOUNDARY_HOOKS_PROVEN at every boundary (5, 12, 50) in both modes, '
      + 'and a missing rollup is itself a BLOCKER finding '
      + '(ACT_ROLLUP_MISSING_AT_BOUNDARY). A trigger/result capture for a function '
      + 'the runtime never calls would be fabrication.',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: ACT_ENDING_REACHABILITY_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'Runtime enforcement proven by completion; persisted projection is defect D-OBS-5',
    proof:
      'The closure runway (no new thread after Bab 35 captured at publication, '
      + 'ending lock at 45, main-mystery resolve at 48, all debts closed at 50) '
      + 'is enforced FAIL-CLOSED by the publication SQL state machine '
      + '(apply_validated_chapter_state_v1 in '
      + '20260805015000_living_canon_publication_primitives.sql): any violation '
      + 'rejects the publication, which would abort the harness run. ALL_50_'
      + 'CHAPTERS_PUBLISHED + ENDING_LOCKED + zero BLOCKER ending findings in BOTH '
      + 'modes therefore constitutes positive runtime proof the enforcement held '
      + 'for every chapter of both runs. What does not exist is a PERSISTED '
      + 'per-act reachability projection a capture could read back — that is a '
      + 'missing observability artifact (tracked D-OBS-5), not missing runtime '
      + 'behavior. Deriving a projection from fixture constants would be the '
      + 'fabrication the capture rules forbid.',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
]

const byCode = new Map(BLOCKER_DISPOSITIONS.map((d) => [d.code, d]))

export function dispositionFor(blocker: CaptureBlockerV1): BlockerDispositionV1 | null {
  return byCode.get(blocker.code) ?? null
}

/** Blockers whose disposition is still UNRESOLVED (or missing) force BLOCKED. */
export function unresolvedBlockers(blockers: CaptureBlockerV1[]): CaptureBlockerV1[] {
  return blockers.filter((b) => {
    const d = dispositionFor(b)
    return !d || d.disposition === 'UNRESOLVED'
  })
}
