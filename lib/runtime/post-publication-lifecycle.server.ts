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

  // C-R3 (reviewer Entry 8): EndingCandidateSchema now has isSecret/kind + blockingConditions
  // — map them honestly to EndingDef so NCS §1.4 can be machine-checkable
  const endings: EndingDef[] = contract.endingCandidates.map((candidate) => ({
    id: candidate.key,
    isMain: candidate.kind === 'main' || !candidate.isSecret,
    isSecret: candidate.kind === 'secret' || candidate.isSecret,
    blockedByFlags: candidate.blockingConditions ?? [],
  }))

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
  }
}

/**
 * C-R2 (reviewer Entry 6 2026-08-08) — HONEST act-boundary ending-
 * reachability evidence (NCS §1.4).
 *
 * The C-R1 event asserted `passed` from a trivially-true gate (every
 * candidate mapped main/unblocked; no secret ever modeled). This version
 * splits the evidence into what the deterministic layer CAN prove from the
 * current contract model and what it CANNOT:
 *
 *   PROVABLE now:
 *    - ending-candidate count vs ENDING_RULES.minReachableEndings;
 *    - per-ending requiredClosure satisfiability (backing thread not
 *      ABANDONED_APPROVED) — deriveRequiredClosureSatisfiability;
 *    - violation findings detectable on the structured data that exists.
 *
 *   UNPROVEN on the current model (recorded, never faked):
 *    - secret-ending path: EndingCandidateSchema has no kind/isSecret field,
 *      so the contract cannot even express a secret ending (NCS §1.4 clause
 *      "jalur menuju secret ending harus tetap reachable" — PRD requires at
 *      least one);
 *    - flag-based reachability: the schema carries only free-text
 *      `condition`, no structured blocking condition.
 *
 * `ncs14Proven` is therefore false while any clause is unproven, and no
 * consumer may render this evidence as a reachability PASS. Full proof
 * requires a structured ending model (kind + blocking); until then NTM
 * G1-REACH remains IN_PROGRESS (#6 OPEN).
 */
export interface EndingReachabilityEvidenceV1 {
  actNumber: number
  checkpointChapter: number
  endingCandidateCount: number
  minRequiredMain: number
  /** Per-ending requiredClosure satisfiability (deterministic, honest). */
  requiredClosure: Array<{ endingId: string; satisfiable: boolean; blockingThreadIds: string[] }>
  closureAllSatisfiable: boolean
  /**
   * Finding codes from checkEndingReachability over the structured data the
   * model CAN express. Empty means "no violation detectable on this model" —
   * NOT "reachability proven". See the model-gap flags below.
   */
  reachabilityViolationFindingCodes: string[]
  /** Model-gap flags (C-R2). Schema facts, not runtime readings. */
  secretEndingModeled: boolean
  secretPathProven: boolean
  flagBlockingModeled: boolean
  ncs14Proven: boolean
}

/**
 * Flag-based reachability has no data source in the current contract model
 * (EndingCandidateSchema.condition is free text). This is a MODEL FACT, not a
 * runtime reading; it can only flip when the contract schema gains a
 * structured blocking model.
 */
export const FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL = false

export function deriveEndingReachabilityEvidence(args: {
  actNumber: number
  checkpointChapter: number
  endings: EndingDef[]
  state: ActualState
  closure: Array<{ endingId: string; satisfiable: boolean; blockingThreadIds: string[] }>
}): EndingReachabilityEvidenceV1 {
  const { actNumber, checkpointChapter, endings, state, closure } = args

  const violationFindings = checkEndingReachability(endings, state)
  const closureAllSatisfiable = closure.every((c) => c.satisfiable)
  const secretEnding = endings.find((e) => e.isSecret)
  const secretBlocked = violationFindings.some((f) => f.code === 'SECRET_ENDING_UNREACHABLE')
  const secretEndingModeled = secretEnding !== undefined
  // The secret-path clause is proven only when a secret ending IS modeled and
  // the gate finds it reachable. No secret can be modeled on the current
  // schema, so today this is always false — recorded UNPROVEN, never PASS.
  const secretPathProven = secretEndingModeled && !secretBlocked
  const flagBlockingModeled = endings.some((e) => (e.blockedByFlags ?? []).length > 0)

  return {
    actNumber,
    checkpointChapter,
    endingCandidateCount: endings.length,
    minRequiredMain: ENDING_RULES.minReachableEndings,
    requiredClosure: closure,
    closureAllSatisfiable,
    reachabilityViolationFindingCodes: violationFindings.map((f) => f.code),
    secretEndingModeled,
    secretPathProven,
    flagBlockingModeled,
    ncs14Proven:
      endings.length >= ENDING_RULES.minReachableEndings
      && closureAllSatisfiable
      && secretPathProven
      && FLAG_BLOCKING_PROVABLE_ON_CURRENT_MODEL,
  }
}

/**
 * Per-ending requiredClosure satisfiability: an ending stays reachable while
 * none of its required debts' backing threads was abandoned. Deterministic and
 * explicit — this is the blocking path EndingDef.blockedByFlags cannot express
 * for closure-based endings.
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
    for (const debtId of candidate.requiredClosure) {
      const threadId = debtBackedThreadId(storyId, debtId)
      const status = statusByThreadId.get(threadId)
      if (status === 'ABANDONED_APPROVED') blockingThreadIds.push(threadId)
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

  const closure = deriveRequiredClosureSatisfiability({ storyId, contract, snapshot })
  // C-R2 (reviewer Entry 6): persist the HONEST reachability evidence —
  // provable clauses plus explicit UNPROVEN model-gap markers. No `passed`
  // verdict: NCS §1.4 cannot be asserted true on the current contract model.
  const reachabilityEvidence = deriveEndingReachabilityEvidence({
    actNumber: derived.actNumber,
    checkpointChapter: chapterNumber,
    endings: derived.endings,
    state: derived.state,
    closure,
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
    // C-R3.3: DURABLE GATE — set generation_status to 'needs_review' and persist
    // as story_event. Future generation calls will check this status and refuse
    // to proceed until review resolves it. This is not just a log; it blocks NEXT chapter
    // admission (see personalized-generation.ts next-chapter check).
    const { error } = await admin
      .from('stories')
      .update({ generation_status: 'needs_review' })
      .eq('story_id', storyId)
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
