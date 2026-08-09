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
 *     structured ending model exists.
 * C-R3 then closed #6: the structured ending model landed, the production V2
 * writer emits computed ACT_ENDING_REACHABILITY evidence, and the capture reads
 * it back into a structured `endingReachabilityV2`. The failure mode moved from
 * a permanent BLOCKED verdict into the ACT_BOUNDARY_HOOKS_PROVEN completion
 * gate. Reviewer ratified that closure against exact source 3fbcad2.
 * #4 (durability) stays CLOSED but rebaselined: ending-runway 1.3.0 now
 * computes durability itself from RAW rows (caller conclusions forbidden).
 * The sixth blocker (prompt layers) remains RECLASSIFIED to M10-F (#1
 * APPROVED → F): writer prompt text is a real-model artifact that does not
 * exist on the deterministic C path, so nothing can be observed there without
 * fabrication.
 *
 * Current topology (C-R3): four CLOSED (context budget, ending-lock
 * durability, act-reconciliation trigger, ending reachability) and two
 * RECLASSIFIED (prompt layers → M10-F, Bab-49 emotional resolution → M10-D).
 * Zero UNRESOLVED.
 *
 * A blocker without a CLOSED/RECLASSIFIED disposition keeps forcing result
 * BLOCKED, exactly as before. The harness writes the full disposition table
 * into blockers.json and summary.json so the audit trail travels with the
 * evidence. Each proof cites the exact files/lines that implement the closure;
 * `ratifiedByReviewer` records whether the reviewer has verified it against an
 * exact SHA, so an unratified closure is still visible in the artifacts.
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
    disposition: 'CLOSED',
    reclassifiedTo: null,
    proof:
      'C-R3 (supersedes the C-R2 UNRESOLVED entry). The blocker was recorded '
      + 'because EndingCandidateSchema could not express a secret ending or a '
      + 'blocking condition, so the C-R1 all-main/no-blocking mapping produced '
      + 'a trivially-true PASS (reviewer Entry 6: NOT RATIFIED). That model '
      + 'gap is now closed. (1) CONTRACT: ending candidates carry structured '
      + 'ending kind and structured closure ids, so EndingDef derivation has '
      + 'real isSecret / blockedByFlags / requiredPlotDebtIds instead of a '
      + 'fabricated constant. (2) PRODUCTION WIRE: '
      + 'lib/runtime/post-publication-lifecycle.server.ts :: '
      + 'deriveEndingReachabilityEvidence (V2) counts MAIN and SECRET endings '
      + 'separately, computes reachable counts per ending via '
      + 'isEndingReachable, and derives per-ending closure from '
      + 'deriveRequiredClosureSatisfiability using requiredPlotDebtIds only '
      + '(prose requiredClosure is never treated as debt ids; absent '
      + 'structured data yields proven=false / satisfiable=null). '
      + 'runActBoundaryReconciliation persists it verbatim as the '
      + 'ACT_ENDING_REACHABILITY story_event. ncs14Proven is COMPUTED, not '
      + 'constant: mainReachable (>= ENDING_RULES.minReachableEndings '
      + 'reachable main endings) AND secretReachable (>= 1 reachable secret) '
      + 'AND closureProofComplete AND closureAllSatisfiable AND zero CRITICAL '
      + 'checkEndingReachability findings. The deprecated V1 writer '
      + '(deriveEndingReachabilityEvidenceV1, hardcoded ncs14Proven=false) is '
      + 'retained only for legacy reads and never writes new events. '
      + '(3) CAPTURE READ-BACK: parseEndingReachabilityCaptureV2 '
      + '(lib/narrative-qa/harness/act-boundary-evidence.ts) reads the event '
      + 'into ActBoundaryCaptureV1.endingReachabilityV2; a V1-shaped or '
      + 'type-mismatched payload yields validV2=false and can never satisfy '
      + 'the gate. CLOSURE SCOPE: this closes OBSERVABILITY, it does NOT '
      + 'assert that reachability always passes. The failure mode moved into '
      + 'the completion gate — evaluateActBoundaryGate requires, at every '
      + 'boundary that has a next act, reconciliationTriggered=true AND '
      + 'validV2=true AND ncs14Proven=true AND a next-act blueprint version; a '
      + 'failing act now fails ACT_BOUNDARY_HOOKS_PROVEN instead of forcing a '
      + 'permanent BLOCKED verdict that no run could ever clear. The terminal '
      + 'boundary (Bab 50, no next act) requires none of those because '
      + 'runActBoundaryReconciliation returns triggered:false when no next act '
      + 'exists; Bab 45/48/49/50 obligations stay with the ending-runway '
      + 'evaluator. RATIFICATION: the reviewer verified this closure against '
      + 'exact source 3fbcad2b083c6a9648af4e850e129aea83c473fa and ratified it '
      + '(V2 capture parser PASS, terminal-act semantics PASS, reachability '
      + 'completion gate PASS).',
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
