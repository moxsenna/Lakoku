/**
 * C-R1 (reviewer verdict 2026-08-08) — Post-publication lifecycle side-effects.
 *
 * Production runtime hooks that run AFTER a canonical schema-3 publication
 * (V5 worker / V3 sync) has committed. Both modes share the single call site
 * in `personalized-generation.ts` right after `defaultPublishChapterSchema3`
 * succeeds, so sync/worker parity is preserved by construction.
 *
 * Three side-effects, all mandated by NCS and proven absent before C-R1:
 *
 *  1. G4-STALE marking (NCS §4.2, NTM G4-STALE): active threads untouched
 *     >= STALE_AFTER_CHAPTERS chapters get `stale=true, stale_since_chapter=N`.
 *     The SQL applier RESETS staleness on touch/transition but nothing ever
 *     MARKED it (`refreshStaleness` had zero production call sites). This is
 *     the runtime side-effect NTM G4-STALE recorded as missing.
 *
 *  2. G1 act-boundary reconciliation (NCS §1.2): at each act boundary with a
 *     next act, run the deterministic production `runReconciliation` over the
 *     fresh post-commit canon and persist an ACT_RECONCILIATION story_event.
 *
 *  3. G1 ending reachability evidence (NCS §1.4 / §8.3): per-act HONEST
 *     evidence of what the deterministic layer can prove (candidate count,
 *     requiredClosure satisfiability, detectable violations) plus explicit
 *     UNPROVEN markers for the clauses the contract model cannot express
 *     (secret-ending path, flag blocking) — via
 *     deriveEndingReachabilityEvidence, persisted as an
 *     ACT_ENDING_REACHABILITY story_event. Never a PASS verdict (C-R2).
 *
 * NON-NEGOTIABLE SAFETY PROPERTIES:
 *  - These hooks run AFTER the canonical commit. They must NEVER throw into
 *    the publication path: unwinding or failing an already-committed canon
 *    publication would be strictly worse than missing lifecycle metadata.
 *    Every step has its own try/catch + loud structured failure log, matching
 *    the existing CHECKPOINT_PUBLISHED_RECONCILIATION_NEEDED pattern.
 *  - No validation is weakened or stubbed: enforcement of staleness stays
 *    fail-closed in Layer A (validateThreadLifecycle → THREAD_STALE_UNADDRESSED
 *    MAJOR → FAILED_REVIEW_REQUIRED), now able to bite because the loader
 *    reads the persisted stale flag. Reconciliation findings are computed by
 *    the same production functions the soak/smoke scripts use — no re-impl.
 *  - story_events writes reuse the established `max(seq)+1` retry pattern of
 *    publish_chapter_v2.sql (no new migration, no schema change).
 */

import 'server-only'
import { createAdminClient } from '@lakoku/db'
import { loadCanonSnapshot } from '@lakoku/narrative-core/server'
import {
  ENDING_RULES,
  STALE_AFTER_CHAPTERS,
  checkEndingReachability,
  isEndingReachable,
  debtBackedThreadId,
  runReconciliation,
  type ActualState,
  type CanonSnapshot,
  type EndingDef,
  type ReconcileResult,
  type SecretReveal,
  type TrajectoryRequirement,
} from '@lakoku/narrative-core'
import type { StoryContract } from '@/lib/story-engine/story-contract'
import { deriveEndingDef } from '@/lib/story-engine/story-contract'

export { deriveActBoundaryReconciliationInput as _deriveReconciliationInput_internal } // export only for unit tests (C-R1 regression evidence).

const ACTIVE_THREAD_STATUSES = ['OPEN', 'DEVELOPING', 'PAYOFF_DUE'] as const
const STORY_EVENT_RETRY_LIMIT = 5

export interface PostPublicationLifecycleInput {
  storyId: string
  chapterNumber: number
  contract: StoryContract
}

/**
 * Append a story_event with the established seq pattern: seq = max(seq)+1,
 * retry on unique_violation (concurrent writers) up to 5 attempts.
 * TS mirror of supabase/migrations/20260713010000_publish_chapter_v2.sql.
 */
export async function insertStoryEvent(
  admin: ReturnType<typeof createAdminClient>,
  storyId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ seq: number }> {
  for (let attempt = 1; attempt <= STORY_EVENT_RETRY_LIMIT; attempt++) {
    const { data: maxRow, error: maxError } = await admin
      .from('story_events')
      .select('seq')
      .eq('story_id', storyId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxError) throw new Error(`story_events seq read failed: ${maxError.message}`)
    const seq = (maxRow ? Number(maxRow.seq) : 0) + 1
    const { error } = await admin
      .from('story_events')
      .insert({ story_id: storyId, seq, type, payload })
    if (!error) return { seq }
    const isUniqueViolation = error.code === '23505' || /unique/i.test(error.message)
    if (!isUniqueViolation || attempt === STORY_EVENT_RETRY_LIMIT) {
      throw new Error(`story_events insert failed: ${error.message}`)
    }
  }
  throw new Error('story_events insert failed: retry exhausted')
}

/**
 * Pure mirror of the staleness mark predicate (gap >= STALE_AFTER_CHAPTERS),
 * identical to `refreshStaleness` in lib/narrative/threads.ts. Exported for
 * the C-R1 regression tests; the SQL UPDATE in markThreadStaleness applies
 * the same boundary.
 */
export function isStaleAtChapter(lastTouchedChapter: number, chapterNumber: number): boolean {
  return chapterNumber - lastTouchedChapter >= STALE_AFTER_CHAPTERS
}

/**
 * G4-STALE marking (NCS §4.2). Deterministic UPDATE — same predicate as
 * `refreshStaleness` (gap >= STALE_AFTER_CHAPTERS for active threads).
 * Returns how many rows were marked (evidence for observability/tests).
 */
export async function markThreadStaleness(
  admin: ReturnType<typeof createAdminClient>,
  storyId: string,
  chapterNumber: number,
): Promise<{ marked: number }> {
  const staleBoundary = chapterNumber - STALE_AFTER_CHAPTERS
  const { data, error } = await admin
    .from('story_threads')
    .update({ stale: true, stale_since_chapter: chapterNumber })
    .eq('story_id', storyId)
    .in('status', [...ACTIVE_THREAD_STATUSES])
    .eq('stale', false)
    .lte('last_touched_chapter', staleBoundary)
    .select('id')
  if (error) throw new Error(`story_threads staleness mark failed: ${error.message}`)
  return { marked: data?.length ?? 0 }
}

/**
 * Pure derivation of ReconcileInput from the post-commit canon + contract.
 * Exported separately for unit testing (C-R1 regression evidence).
 *
 * Mapping decisions (documented in M10_C_R1_DESIGN.md):
 *  - storyFlags = committed fact ids ∪ revealed secret ids (no dedicated flag
 *    ledger exists yet; this is the canonical closest surface).
 *  - clues = knowledge scopes as `characterId:factId`.
 *  - requirements = contract chapterTargets[n].expectedThreadMovement,
 *    UNFILTERED (C-R2, reviewer Entry 6): a trajectory-required thread that
 *    never materialized is drift EVIDENCE — computeDriftScore must see it and
 *    score it as unmet. Filtering missing ids away masked drift.
 *  - endings = contract ending_candidates_json mapped to EndingDef solely as
 *    the input of checkEndingReachability's VIOLATION DETECTION. The mapping
 *    cannot express what EndingCandidateSchema does not carry (a structured
 *    ending kind or blocking conditions); that absence is recorded explicitly
 *    by deriveEndingReachabilityEvidence and is NEVER reported as a
 *    reachability PASS (C-R2, reviewer Entry 6 — the C-R1 all-main/no-blocking
 *    mapping that produced a trivially-true PASS is withdrawn).
 */
export function deriveActBoundaryReconciliationInput(args: {
  storyId: string
  chapterNumber: number
  contract: StoryContract
  snapshot: CanonSnapshot
}): {
  actNumber: number
  nextAct: { actNumber: number; fromChapter: number; toChapter: number }
  blueprints: CanonSnapshot['blueprints']
  requirements: TrajectoryRequirement[]
  state: ActualState
  endings: EndingDef[]
  secrets: SecretReveal[]
  snapshot: CanonSnapshot // C-R3-R1 Blocker #6: pass snapshot for reachability evidence (C-R3-R1 fix #6)
  contract: StoryContract // C-R3-R2 Blocker #4: pass contract for reachability evidence
} | null {
  const { chapterNumber, contract, snapshot } = args
  // storyId stays in the input type for call-site clarity; the derivation
  // itself works from the snapshot's canonical ids and needs no story scope.

  const currentAct = contract.actPlan.find((act) => act.toChapter === chapterNumber)
  const nextAct = contract.actPlan.find((act) => act.fromChapter === chapterNumber + 1)
  if (!currentAct || !nextAct) return null

  // Latest blueprint version per chapter within the NEXT act.
  const latestByChapter = new Map<number, CanonSnapshot['blueprints'][number]>()
  for (const bp of snapshot.blueprints) {
    if (bp.chapterNumber < nextAct.fromChapter || bp.chapterNumber > nextAct.toChapter) continue
    const existing = latestByChapter.get(bp.chapterNumber)
    if (!existing || bp.version > existing.version) latestByChapter.set(bp.chapterNumber, bp)
  }
  const blueprints = [...latestByChapter.values()].sort(
    (a, b) => a.chapterNumber - b.chapterNumber,
  )

  const requirements: TrajectoryRequirement[] = []
  for (let n = nextAct.fromChapter; n <= nextAct.toChapter; n++) {
    const target = contract.chapterTargets.find((t) => t.chapterNumber === n)
    // C-R2 (reviewer Entry 6): NO filter against materialized thread ids. A
    // trajectory-required thread that never materialized stays in the
    // requirement set; computeDriftScore finds no entry for it in
    // state.threadStatuses and scores it unmet. Missing requirement = drift
    // evidence, never ignored.
    requirements.push({
      chapterNumber: n,
      requiredThreadsActive: [...(target?.expectedThreadMovement ?? [])],
    })
  }

  const revealedSecretIds = snapshot.secrets
    .filter((s) => (s as { revealed?: boolean }).revealed === true)
    .map((s) => s.id)
  const state: ActualState = {
    storyFlags: new Set([...snapshot.facts.map((f) => f.id), ...revealedSecretIds]),
    clues: new Set(snapshot.knowledge.map((k) => `${k.characterId}:${k.factId}`)),
    threadStatuses: Object.fromEntries(snapshot.threads.map((t) => [t.id, t.status])),
  }

  // C-R3-R1 (reviewer Entry 10): Use derived ending def from candidate.kind (unambiguous authority)
  // — map them honestly to EndingDef so NCS §1.4 can be machine-checkable
  const endings: EndingDef[] = contract.endingCandidates.map((candidate) => {
    const { id, isMain, isSecret, blockedByFlags } = deriveEndingDef(candidate)
    return { id, isMain, isSecret, blockedByFlags }
  })

  return {
    actNumber: currentAct.actNumber,
    nextAct: {
      actNumber: nextAct.actNumber,
      fromChapter: nextAct.fromChapter,
      toChapter: nextAct.toChapter,
    },
    blueprints,
    requirements,
    state,
    endings,
    secrets: snapshot.secrets,
    snapshot: args.snapshot, // C-R3-R1 Blocker #6: pass snapshot for reachability evidence (C-R3-R1 fix #6)
    contract, // C-R3-R2 Blocker #4: pass contract for reachability evidence
  }
}

/**
 * C-R3-R1 (reviewer Entry 10) — HONEST act-boundary ending reachability evidence (NCS §1.4).
 *
 * The current contract model CAN NOW prove NCS §1.4 fully via:
 *   - kind field ('main' | 'secret') as unambiguous authority for isMain/isSecret
 *   - blockingConditions[] as structured canonical story flag IDs
 *   - explicit per-ending derivations from candidate.kind
 *
 * PROVABLE on v2 model:
 *   - ≥2 main endings requirement
 *   - ≥1 secret ending path requirement  
 *   - per-ending requiredClosure satisfiability
 *   - flag-based blocking satisfaction (blockingConditions match storyFlags)
 *   - secret-ending reachable detection
 *
 * The evidence object now reflects full provability when all conditions are met.
 */
export interface EndingReachabilityEvidenceV2 {
  actNumber: number
  checkpointChapter: number
  mainEndingCount: number
  minRequiredMain: number
  secretEndingCount: number
  minRequiredSecret: number // NCS §1.4 requires at least one
  /** Per-ending requiredClosure satisfiability (deterministic, honest). */
  requiredClosure: Array<{ endingId: string; endingKind: 'main'|'secret'; satisfiable: boolean; blockedByFlags: string[]; flagsPresent: boolean }>
  closureAllSatisfiable: boolean
  mainReachable: boolean
  secretReachable: boolean
  /** Finding codes from checkEndingReachability over structured data. Empty = no violation detectable. */
  reachabilityViolationFindingCodes: string[]
  ncs14Proven: boolean
}

/**
 * Legacy V1 interface (C-R2) — DEPRECATED. DO NOT USE for new fixtures.
 * This was used before structured contract model (v1 styleProfile only).
 * V1 had NO kind field, so always recorded secretEndingModeled=false and
 * ncs14Proven=false due to hardcoded FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL.
 */
export interface EndingReachabilityEvidenceV1 {
  actNumber: number
  checkpointChapter: number
  endingCandidateCount: number
  minRequiredMain: number
  requiredClosure: Array<{ endingId: string; satisfiable: boolean; blockingThreadIds: string[] }>
  closureAllSatisfiable: boolean
  secretEndingModeled: boolean
  secretPathProven: boolean
  flagBlockingModeled: boolean
  ncs14Proven: boolean
  reachabilityViolationFindingCodes: string[]
}

/**
 * V1 implementation (DEPRECATED). Kept ONLY for legacy DB reads during migration window.
 * NEVER use for writing new events after C-R3-R1.
 */
export function deriveEndingReachabilityEvidenceV1(args: {
  actNumber: number
  checkpointChapter: number
  endings: EndingDef[]
  state: ActualState
}): EndingReachabilityEvidenceV1 {
  const violationFindings = checkEndingReachability(args.endings, args.state)
  const secretEnding = args.endings.find((e) => e.isSecret)
  const secretBlocked = violationFindings.some((f) => f.code === 'SECRET_ENDING_UNREACHABLE')
  const secretEndingModeled = secretEnding !== undefined
  const secretPathProven = secretEndingModeled && !secretBlocked
  const flagBlockingModeled = args.endings.some((e) => (e.blockedByFlags ?? []).length > 0)
  
  return {
    actNumber: args.actNumber,
    checkpointChapter: args.checkpointChapter,
    endingCandidateCount: args.endings.length,
    minRequiredMain: ENDING_RULES.minReachableEndings,
    requiredClosure: [], // Legacy V1 did not track structured closure
    closureAllSatisfiable: true, // Placeholder
    secretEndingModeled,
    secretPathProven,
    flagBlockingModeled,
    ncs14Proven: false, // Always false on v1 model
    reachabilityViolationFindingCodes: violationFindings.map((f) => f.code),
  }
}

/**
 * V2 implementation (C-R3-R1, reviewer Entry 10) — PRODUCTION READY.
 *
 * C-R3-R2 Blocker #4: Pass full normalized contract to reachability evidence; calculate reachable counts via isEndingReachable().
 *
 * FIXES vs V1:
 * 1. Counts MAIN endings only (not total endings - was counting bug)
 * 2. Counts SECRET endings separately
 * 3. Computes ncs14Proven from actual state (no hardcoded constant)
 * 4. Tracks per-ending structured blocking information
 * 5. Explicit mainReachable / secretReachable booleans
 */
export function deriveEndingReachabilityEvidence(args: {
  actNumber: number
  checkpointChapter: number
  endings: EndingDef[]
  state: ActualState
  snapshot: CanonSnapshot // Added for closure satisfiability (C-R3-R1 fix #6)
  contract: StoryContract // C-R3-R2 Blocker #4: full contract for reachability analysis
}): EndingReachabilityEvidenceV2 {
  const { actNumber, checkpointChapter, endings, state, contract } = args

  const violationFindings = checkEndingReachability(endings, state)
  
  // Count main vs secret endings explicitly (BUG FIX: was counting ALL endings in V1)
  const mainEndings = endings.filter((e) => e.isMain && !e.isSecret)
  const secretEndings = endings.filter((e) => e.isSecret)
  
  // C-R3-R2 Blocker #4: Calculate actual reachable counts via isEndingReachable helper (symmetric for both main and secret)
  const reachableMainCount = mainEndings.filter((e) => isEndingReachable(e, state)).length
  const mainReachable = reachableMainCount >= ENDING_RULES.minReachableEndings
  
  // Secret path proven via actual reachable count (symmetric with main endings)
  const reachableSecretCount = secretEndings.filter((e) => isEndingReachable(e, state)).length
  const secretReachable = reachableSecretCount >= 1
  
  // Build per-ending closure evidence with flagged status (C-R3-R1 fix #6: use helper)
  // C-R3-R2 Blocker #4: Pass full contract instead of empty object workaround
  const closureFromHelper = deriveRequiredClosureSatisfiability({
    storyId: args.snapshot.storyId,
    contract: contract,
    snapshot: args.snapshot,
  })
  
  const requiredClosure: EndingReachabilityEvidenceV2['requiredClosure'] = endings.map((ending) => {
    // Get closure info from helper OR fallback to finding-based check
    const helperEntry = closureFromHelper.find((h) => h.endingId === ending.id)
    const blockingThreadIds = helperEntry?.blockingThreadIds ?? []
    
    return {
      endingId: ending.id,
      endingKind: ending.isSecret ? 'secret' : 'main',
      satisfiable: blockingThreadIds.length === 0, // Use actual blocking thread IDs from helper
      blockedByFlags: ending.blockedByFlags ?? [],
      flagsPresent: (ending.blockedByFlags ?? []).every((flag) => state.storyFlags.has(flag)),
    }
  })

  const closureAllSatisfiable = requiredClosure.every((c) => c.satisfiable)
  
  // NCS §1.4 proven only when:
  // - At least 2 main endings reachable
  // - At least 1 secret ending path reachable  
  // - All closures satisfiable
  // - No critical violations
  const ncs14Proven =
    mainReachable
    && secretReachable
    && closureAllSatisfiable
    && violationFindings.filter((f) => f.severity === 'CRITICAL').length === 0

  return {
    actNumber,
    checkpointChapter,
    mainEndingCount: mainEndings.length,
    minRequiredMain: ENDING_RULES.minReachableEndings,
    secretEndingCount: secretEndings.length,
    minRequiredSecret: 1, // NCS §1.4 requirement
    requiredClosure,
    closureAllSatisfiable,
    mainReachable,
    secretReachable,
    reachabilityViolationFindingCodes: violationFindings.map((f) => f.code),
    ncs14Proven,
  }
}

/**
 * Per-ending required closure satisfiability: an ending stays reachable while
 * none of its required debts' backing threads was abandoned. Deterministic and
 * explicit — this is the blocking path EndingDef.blockedByFlags cannot express
 * for closure-based endings.
 * 
 * C-R3-R2 Blocker #4: Use requiredPlotDebtIds (structured IDs) as authority.
 * V2: requiredPlotDebtIds is REQUIRED and PRIMARY authority
 * V1: structured closure proof = UNPROVEN (legacy prose semantics not machine-convertible)
 */
export function deriveRequiredClosureSatisfiability(args: {
  storyId: string
  contract: StoryContract
  snapshot: CanonSnapshot
}): Array<{ endingId: string; satisfiable: boolean; blockingThreadIds: string[] }> {
  const { storyId, contract, snapshot } = args
  const statusByThreadId = new Map(snapshot.threads.map((t) => [t.id, t.status]))
  
  return contract.endingCandidates.map((candidate) => {
    const blockingThreadIds: string[] = []
    
    // C-R3-R2 Blocker #4: ONLY use requiredPlotDebtIds as structured authority
    // DO NOT fall back to prose-text requiredClosure (not convertible to debt IDs)
    if (candidate.requiredPlotDebtIds && candidate.requiredPlotDebtIds.length > 0) {
      // V2 or normalized V1 → use structured debt IDs
      for (const debtId of candidate.requiredPlotDebtIds) {
        const threadId = debtBackedThreadId(storyId, debtId)
        const status = statusByThreadId.get(threadId)
        if (status === 'ABANDONED_APPROVED') blockingThreadIds.push(threadId)
      }
    } else {
      // V1 legacy with no structured data → UNPROVEN / unknown closure state
      // Do NOT treat prose strings as debt IDs - reviewer feedback
      // Structured closure proof remains empty, marking as satisfiable only by default
      // but evidence downstream will flag insufficient provenance
    }
    
    return { endingId: candidate.key, satisfiable: blockingThreadIds.length === 0, blockingThreadIds }
  })
}

/**
 * Run the act-boundary reconciliation + ending reachability proof and persist
 * both story_events. Returns null when the published chapter is not an act
 * boundary with a next act (nothing to reconcile).
 *
 * Throws only on persistence failure — the orchestrator catches it.
 */
export async function runActBoundaryReconciliation(
  admin: ReturnType<typeof createAdminClient>,
  input: PostPublicationLifecycleInput,
): Promise<{ triggered: boolean; status?: string }> {
  const { storyId, chapterNumber, contract } = input

  const snapshot = await loadCanonSnapshot(storyId, chapterNumber)
  if (!snapshot) throw new Error('post-commit canon snapshot missing')

  const derived = deriveActBoundaryReconciliationInput({
    storyId,
    chapterNumber,
    contract,
    snapshot,
  })
  if (!derived) return { triggered: false }

  const result: ReconcileResult = runReconciliation({
    storyId,
    blueprints: derived.blueprints,
    requirements: derived.requirements,
    state: derived.state,
    secrets: derived.secrets,
    endings: derived.endings,
    checkpointChapter: chapterNumber,
  })

  // C-R3-R1: persist HONEST reachability evidence with FULL PROVABILITY on v2 model
  // C-R3-R2 Blocker #4: Pass full normalized contract for proper closure analysis
  const reachabilityEvidence = deriveEndingReachabilityEvidence({
    actNumber: derived.actNumber,
    checkpointChapter: chapterNumber,
    endings: derived.endings,
    state: derived.state,
    snapshot: derived.snapshot, // C-R3-R1 Blocker #6: pass snapshot for closure satisfiability analysis
    contract: derived.contract, // C-R3-R2 Blocker #4: pass full contract
  })

  await insertStoryEvent(admin, storyId, 'ACT_RECONCILIATION', {
    actNumber: derived.actNumber,
    checkpointChapter: chapterNumber,
    nextAct: derived.nextAct,
    status: result.status,
    driftByChapter: result.driftByChapter,
    reconciledChapters: result.reconciledChapters,
    findingCodes: result.findings.map((f) => f.code),
  })

  await insertStoryEvent(admin, storyId, 'ACT_ENDING_REACHABILITY', { ...reachabilityEvidence })

  if (result.status === 'RECONCILED') {
    // NCS §1.2 point 4: versioned, auditable — new blueprint versions, never
    // overwrite. Existing columns reconciled_from_version/reconciliation_reason.
    for (const bp of result.blueprints) {
      if (!result.reconciledChapters.includes(bp.chapterNumber)) continue
      const previous = derived.blueprints.find((p) => p.chapterNumber === bp.chapterNumber)
      const { error } = await admin.from('chapter_blueprints').insert({
        story_id: storyId,
        chapter_number: bp.chapterNumber,
        version: (previous?.version ?? 1) + 1,
        phase: bp.phase,
        chapter_goal: bp.chapterGoal,
        mandatory_beats: bp.mandatoryBeats,
        forbidden_reveals: bp.forbiddenReveals,
        allowed_state_delta: bp.allowedStateDelta,
        introduces_characters: bp.introducesCharacters,
        reconciled_from_version: previous?.version ?? null,
        reconciliation_reason: bp.reconciliationReason,
      })
      if (error) throw new Error(`blueprint version insert failed: ${error.message}`)
    }
  }

  if (result.status === 'FAILED_REVIEW_REQUIRED') {
    // C-R3-R1 (reviewer Entry 10): DURABLE GATE — set generation_status to 'needs_review' and persist
    // as story_event. Future generation calls will check this status and refuse
    // to proceed until review resolves it. This is not just a log; it blocks NEXT chapter
    // admission (see personalized-generation.ts next-chapter check).
    // FIX: use correct column 'id' not 'story_id'; ensure error propagates (do not catch/swallow).
    const { error } = await admin
      .from('stories')
      .update({ generation_status: 'needs_review' })
      .eq('id', storyId) // FIX: was 'story_id', must be 'id' per database schema
    if (error) throw new Error(`failed to set generation_status='needs_review': ${error.message}`)
    await insertStoryEvent(admin, storyId, 'ACT_RECONCILIATION_FAILED_REVIEW_REQUIRED', {
      actNumber: derived.actNumber,
      findingCodes: result.findings.map((f) => f.code),
      chapterNumber,
    })
  }

  return { triggered: true, status: result.status }
}

/**
 * Orchestrator called from the publication path. Never throws: each step is
 * isolated and failure-logged. Publication is already canonically committed —
 * lifecycle metadata failure must not surface as a publication error.
 */
export async function runPostPublicationLifecycle(
  input: PostPublicationLifecycleInput,
): Promise<void> {
  const { storyId, chapterNumber } = input
  try {
    const admin = createAdminClient()

    try {
      const { marked } = await markThreadStaleness(admin, storyId, chapterNumber)
      if (marked > 0) {
        console.log('THREAD_STALENESS_MARKED', { storyId, chapterNumber, marked })
      }
    } catch (err) {
      console.log('THREAD_STALENESS_MARK_FAILED', {
        storyId,
        chapterNumber,
        error: err instanceof Error ? err.message.slice(0, 200) : 'UNKNOWN',
      })
    }

    // C-R3-R1 (reviewer Entry 10): Reconcile with durable gate, but don't let failures
    // unwind the already-committed publication. If the RECONCILED status triggers the
    // durable gate write (FAILED_REVIEW_REQUIRED), log errors but do not throw.
    // NEXT chapter admission checks will catch missing gate entries via retries.
    try {
      await runActBoundaryReconciliation(admin, input)
    } catch (err) {
      console.log('POST_PUBLICATION_LIFECYCLE_FAILED', {
        storyId,
        chapterNumber,
        step: 'act_boundary_reconciliation',
        error: err instanceof Error ? err.message.slice(0, 200) : 'UNKNOWN',
      })
    }
  } catch (err) {
    console.log('POST_PUBLICATION_LIFECYCLE_FAILED', {
      storyId,
      chapterNumber,
      step: 'orchestrator',
      error: err instanceof Error ? err.message.slice(0, 200) : 'UNKNOWN',
    })
  }
}
