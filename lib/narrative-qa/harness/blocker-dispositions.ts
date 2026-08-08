/**
 * M10-C recovery — per-blocker dispositions with proof.
 *
 * History: the six capture blockers recorded in ./capture.ts were first
 * RECLASSIFIED (deferred) during recovery. Reviewer verdict 2026-08-08
 * (M10_GOVERNANCE_LEDGER.md Entry 2) rejected five of those deferrals and
 * ordered the narrow C-R1 corrective package: #2, #3, #4, #5, #6. C-R1
 * implemented the missing production wires and the capture adapters that read
 * them back. Reviewer Entry 6 (2026-08-08) then re-opened TWO of those five:
 *   - #3 (emotional-resolution beat): the C-R1 derivation was VETOED as
 *     evaluator-input fabrication → RECLASSIFIED to the M10-D semantic judge;
 *   - #6 (ending reachability): the C-R1 proof was NOT RATIFIED (fabricated
 *     all-main/no-blocking mapping, trivially-true PASS) → UNRESOLVED until a
 *     structured ending model exists; #6 OPEN, G1-REACH IN_PROGRESS.
 * #4 (durability) stays CLOSED but rebaselined: ending-runway 1.3.0 now
 * computes durability itself from RAW rows (caller conclusions forbidden).
 * The sixth blocker (prompt layers) remains RECLASSIFIED to M10-F (#1
 * APPROVED → F): writer prompt text is a real-model artifact that does not
 * exist on the deterministic C path, so nothing can be observed there without
 * fabrication.
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
    disposition: 'RECLASSIFIED',
    reclassifiedTo: 'M10-D scope (semantic judge over real prose)',
    proof:
      'C-R2 (reviewer Entry 6 2026-08-08, BLOCKER 1 — VETO of C-R1 #3). The '
      + 'C-R1 derivation made Bab-49 emotionalResolutionBeatIds non-empty '
      + 'merely because reader_states.locked_ending_key exists. That lock is '
      + 'a Bab-45 artifact, NOT a Bab-49 beat; renaming it does not change '
      + 'the semantics, and it is the forbidden "caller supplies the '
      + 'conclusion so the evaluator passes" pattern (M10-B no-cheating). '
      + 'Decision #3 is VETOED; the corrective path ordered: version bump and '
      + 'rebaseline of B.3.7. Implemented: ending-runway 1.2.0 → 1.3.0 '
      + '(lib/narrative-qa/evaluators/ending-evaluator.ts); the '
      + 'emotionalResolutionBeatIds field and the '
      + 'CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING check are WITHDRAWN from the '
      + 'deterministic suite; captureEndingRunway fabricates no beat '
      + '(lib/narrative-qa/harness/capture.ts). Emotional-resolution CONTENT '
      + 'moves to the M10-D semantic judge, which can read real prose; '
      + 'deterministic B/C checks only structured runtime obligations that '
      + 'actually exist. Formal record: docs/qa/m10/'
      + 'M10_C_R2_DECISION_B37_REBASELINE.md (supersedes '
      + 'M10_C_R1_DECISION_3_BEAT_CONTRACT.md).',
    consequenceFindings: [],
    ratifiedByReviewer: true,
  },
  {
    code: ENDING_LOCK_TX_BLOCKER.code,
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R1 #4, REBASELINED by C-R2 (reviewer Entry 6 2026-08-08, BLOCKER 2). '
      + 'The 1.2.0 canonicalPublicationProof still carried caller-computed '
      + 'conclusions (lockAtCorrectChapter, chapterPublished booleans); the '
      + 'M10-B architecture lock forbids conclusion booleans from callers. '
      + 'ending-runway 1.2.0 → 1.3.0: inputs are now RAW persisted rows — '
      + 'endingLock.lockedAtChapter, commit45.chapterNumber, '
      + 'commit45.committedCanonRevision, publishedChapterNumbers — and the '
      + 'EVALUATOR itself computes lock chapter == 45 ∧ commit Bab 45 exists '
      + '∧ published Bab 45 exists. captureEndingRunway reads the three raw '
      + 'artifacts (story_generation_contracts.ending_lock_json, '
      + 'chapter_state_commits ledger row for Bab 45, public.chapters) and '
      + 'precomputes nothing. Same-transaction atomicity remains proven by '
      + 'publisher SQL inspection (persist_ending_lock_v1 called inside the '
      + 'single V3/V5 publication transaction) plus harness fencing/tamper '
      + 'probes.',
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
    disposition: 'UNRESOLVED',
    reclassifiedTo: null,
    proof:
      'C-R2 (reviewer Entry 6 2026-08-08, BLOCKER 3 — C-R1 #6 proof NOT '
      + 'RATIFIED). The C-R1 mapping sent EVERY contract endingCandidate to '
      + 'checkEndingReachability as {isMain:true, isSecret:false, '
      + 'blockedByFlags:[]}, so a secret ending could never exist and '
      + 'blocking could never occur; PASS:reachableMain=2/min=2 was '
      + 'trivially true and did not prove NCS §1.4. That fabrication is '
      + 'withdrawn from deriveActBoundaryReconciliationInput '
      + '(lib/runtime/post-publication-lifecycle.server.ts). What the '
      + 'lifecycle hook persists now is the HONEST deterministic subset: '
      + 'ending-candidate count vs ENDING_RULES.minReachableEndings, '
      + 'per-ending requiredClosure satisfiability '
      + '(deriveRequiredClosureSatisfiability — unchanged, real evidence), '
      + 'the violation-finding codes detectable on the structured data that '
      + 'exists, and explicit model-gap markers: secretEndingModeled=false, '
      + 'secretPathProven=false, ncs14Proven=false, because '
      + 'EndingCandidateSchema (lib/story-engine/story-contract.ts) carries '
      + 'only key/name/condition(free-text)/requiredClosure — no structured '
      + 'ending kind, no blocking condition. Capture renders '
      + 'UNPROVEN:candidates=.../closure=.../secretPath=UNPROVEN, never '
      + 'PASS. Disposition stays UNRESOLVED (forces BLOCKED): full NCS §1.4 '
      + 'proof requires a structured ending model (secret path + blocking) '
      + 'that does not exist yet. #6 = OPEN; G1-REACH = IN_PROGRESS; never '
      + 'mark done because story_events exist.',
    consequenceFindings: [],
    ratifiedByReviewer: true,
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
