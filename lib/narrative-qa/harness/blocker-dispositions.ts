/**
 * M10-C recovery — per-blocker dispositions with proof.
 *
 * History: the six capture blockers recorded in ./capture.ts were first
 * RECLASSIFIED (deferred) during recovery. Reviewer verdict 2026-08-08
 * (M10_GOVERNANCE_LEDGER.md Entry 2) rejected five of those deferrals and
 * ordered the narrow C-R1 corrective package: #2, #3, #4, #5, #6. C-R1
 * implements the missing production wires and the capture adapters that read
 * them back, so five blockers are now CLOSED with code-level proof. The sixth
 * (prompt layers) is RECLASSIFIED to M10-F with reviewer ratification
 * (#1 APPROVED → F): writer prompt text is a real-model artifact that does
 * not exist on the deterministic C path, so nothing can be observed there
 * without fabrication.
 *
 * A blocker without a CLOSED/RECLASSIFIED disposition keeps forcing result
 * BLOCKED, exactly as before. The harness writes the full disposition table
 * into blockers.json and summary.json so the audit trail travels with the
 * evidence. CLOSED dispositions here are pending the reviewer's C verdict;
 * each proof cites the exact files/lines that implement the closure.
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
 * C-R1 closure proofs. Every CLOSED entry names the production wire that now
 * exists and the capture read-back that consumes it — closure is runtime
 * evidence, not a paperwork change.
 */
export const BLOCKER_DISPOSITIONS: BlockerDispositionV1[] = [
  {
    code: CONTEXT_MEMORY_PROMPT_LAYER_BLOCKER.code,
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'M10-F scope (real-model prompt observability)',
    proof:
      'Writer prompt layers 1a/3 are real-model artifacts. buildWriterPrompt '
      + '(lib/prose/prompt-engine/build-writer-prompt.ts) has exactly ONE '
      + 'production caller on current main: lib/ai-gateway/gateway-provider.ts '
      + '(verified by repo-wide grep; every other reference is narrative-qa '
      + 'audit docs). M10-C is deterministic-only by contract '
      + '(assertDeterministicProvider refuses NARRATIVE_PROVIDER=gateway), so '
      + 'no writer prompt text exists to observe on the C path — the absence '
      + 'is structural, not a missing wire. Populating the fields would '
      + 'violate the no-fabrication rule. Reviewer verdict 2026-08-08 '
      + 'ratified the deferral: #1 APPROVED → F.',
    consequenceFindings: [],
    ratifiedByReviewer: true,
  },
  {
    code: CONTEXT_MEMORY_BUDGET_BLOCKER.code,
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R1 #2 (reviewer 2026-08-08: "Fix capture seam/runtime observability '
      + 'di C"). Runtime wire: lib/runtime/continuation-context.server.ts now '
      + 'calls persistRetrievalLog(storyId, n, packet) after the sole '
      + 'production compileContext() call — the existing best-effort writer '
      + '(lib/narrative/loader.ts :: persistRetrievalLog) into retrieval_logs '
      + '{story_id, target_chapter, included_ids, excluded_ids, '
      + 'budget_report}; both sync and worker modes share '
      + 'loadContinuationContextForChapter, so parity is preserved. Capture '
      + 'read-back: captureChapter reads the retrieval_logs row per chapter '
      + 'into ChapterCaptureV1.contextBudget (counts + budgetReport; '
      + 'story-scoped ids excluded as provenance) and throws when a chapter '
      + '>= 2 has no row. Bab 1 records NO_RETRIEVAL_AT_STORY_START (n<=1 '
      + 'early return — no retrieval exists at story start by construction).',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: ENDING_RESOLUTION_BEAT_BLOCKER.code,
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R1 #3 (formal decision: docs/qa/m10/'
      + 'M10_C_R1_DECISION_3_BEAT_CONTRACT.md). Reviewer ruling: B 1.1.0 '
      + 'already made emotional-resolution beats deterministic ending '
      + 'evidence. captureEndingRunway therefore derives '
      + 'emotionalResolutionBeatIds for Bab 49 from the committed '
      + 'deterministic ending evidence — "deterministic-ending-evidence:'
      + '<lockedEndingKey>" — when the Bab-49 commit exists and the ending '
      + 'key is locked. This is runtime state, not invented prose beats, and '
      + 'it is the B-contract semantics (no evaluator-logic change), so '
      + 'CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING clears without touching the '
      + 'frozen 1.1.0 beat rule.',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: ENDING_LOCK_TX_BLOCKER.code,
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R1 #4 (reviewer: "durability berasal dari canonical publication '
      + 'proof, bukan keberadaan tx-id"). Adapter: ending-runway evaluator '
      + '1.1.0 → 1.2.0; EndingLockEvidence.committedInPublicationTxId '
      + 'replaced by canonicalPublicationProof {lockAtCorrectChapter, '
      + 'chapterCommittedRevision, chapterPublished}. captureEndingRunway '
      + 'builds it from three persisted artifacts of the publication commit: '
      + 'the ending_lock_json row (lockedAtChapter), the chapter_state_commits '
      + 'ledger row for Bab 45, and the published chapters row. Same-'
      + 'transaction atomicity is proven separately by publisher SQL '
      + 'inspection (persist_ending_lock_v1 called inside the single V3/V5 '
      + 'publication transaction) and by the harness fencing/tamper probes — '
      + 'the tx identifier itself was never the requirement.',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: ACT_RECONCILIATION_TRIGGER_BLOCKER.code,
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R1 #5 (reviewer: "tidak ada publication-path call site" — fixed). '
      + 'Production wire: lib/runtime/post-publication-lifecycle.server.ts :: '
      + 'runPostPublicationLifecycle is invoked from '
      + 'lib/runtime/personalized-generation.ts immediately after schema-3 '
      + 'publication success — the single shared point both sync/V3 and '
      + 'worker/V5 pass. At an act boundary it runs production '
      + 'runReconciliation over a fresh post-commit canon snapshot and '
      + 'persists an ACT_RECONCILIATION story_event {actNumber, '
      + 'checkpointChapter, status, driftByChapter, reconciledChapters, '
      + 'findingCodes}. Capture read-back: captureActBoundary reads the event '
      + '(reconciliationTriggered = event exists, reconciliationResult = '
      + 'payload.status). RECONCILED persists new blueprint versions; '
      + 'FAILED_REVIEW_REQUIRED logs loud and escalates to D (D-OBS-6).',
    consequenceFindings: [],
    ratifiedByReviewer: false,
  },
  {
    code: ACT_ENDING_REACHABILITY_BLOCKER.code,
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R1 #6 (reviewer: "C harus membuktikan ending reachability pada '
      + 'checkpoint/act boundary melalui production runtime"). Same '
      + 'post-publication lifecycle hook runs checkEndingReachability over '
      + 'endings derived from contract ending_candidates_json and actual '
      + 'state derived from the post-commit canon snapshot, then persists an '
      + 'ACT_ENDING_REACHABILITY story_event {actNumber, checkpointChapter, '
      + 'passed, reachableMain, minRequired, requiredClosure}. Capture '
      + 'read-back: captureActBoundary renders endingReachability = '
      + 'PASS/FAIL:reachableMain=<n>/min=<m> plus required-closure '
      + 'satisfiability — a persisted per-act projection produced by the '
      + 'production runtime, not re-derived from fixture constants.',
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
