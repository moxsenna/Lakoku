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
 *  3. G1 ending reachability (NCS §1.4 / §8.3): per-act execution proof that
 *     endings remain reachable, via the production `checkEndingReachability`
 *     plus a requiredClosure-satisfiability predicate, persisted as an
 *     ACT_ENDING_REACHABILITY story_event.
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
 *  - requirements = contract chapterTargets[n].expectedThreadMovement ∩ ids of
 *    threads that actually exist (unknown ids ignored defensively — production
 *    contracts may reference planned threads that never materialized).
 *  - endings = contract ending_candidates_json mapped to EndingDef with
 *    blockedByFlags=[] (no canon flag blocks them); the real blocking path is
 *    requiredClosure abandonment, captured by the explicit satisfiability
 *    predicate in runActBoundaryReconciliation.
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

  const existingThreadIds = new Set(snapshot.threads.map((t) => t.id))
  const requirements: TrajectoryRequirement[] = []
  for (let n = nextAct.fromChapter; n <= nextAct.toChapter; n++) {
    const target = contract.chapterTargets.find((t) => t.chapterNumber === n)
    const requiredThreadsActive = (target?.expectedThreadMovement ?? []).filter((id) =>
      existingThreadIds.has(id),
    )
    requirements.push({ chapterNumber: n, requiredThreadsActive })
  }

  const revealedSecretIds = snapshot.secrets
    .filter((s) => (s as { revealed?: boolean }).revealed === true)
    .map((s) => s.id)
  const state: ActualState = {
    storyFlags: new Set([...snapshot.facts.map((f) => f.id), ...revealedSecretIds]),
    clues: new Set(snapshot.knowledge.map((k) => `${k.characterId}:${k.factId}`)),
    threadStatuses: Object.fromEntries(snapshot.threads.map((t) => [t.id, t.status])),
  }

  const endings: EndingDef[] = contract.endingCandidates.map((candidate) => ({
    id: candidate.key,
    isMain: true,
    isSecret: false,
    blockedByFlags: [],
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

  const reachabilityFindings = checkEndingReachability(derived.endings, derived.state)
  const mainEndingCount = derived.endings.filter((e) => e.isMain).length
  // Exact reachable-main count: when the gate fails, the finding carries the
  // count in detail.reachableMain; when it passes, every main ending stands.
  const unreachableFinding = reachabilityFindings.find((f) => f.code === 'ENDING_UNREACHABLE')
  const reachableMain = unreachableFinding
    ? Number((unreachableFinding.detail as { reachableMain?: number } | undefined)?.reachableMain ?? 0)
    : mainEndingCount
  const secretEnding = derived.endings.find((e) => e.isSecret)
  const secretBlocked = reachabilityFindings.some((f) => f.code === 'SECRET_ENDING_UNREACHABLE')
  const closure = deriveRequiredClosureSatisfiability({ storyId, contract, snapshot })

  await insertStoryEvent(admin, storyId, 'ACT_RECONCILIATION', {
    actNumber: derived.actNumber,
    checkpointChapter: chapterNumber,
    nextAct: derived.nextAct,
    status: result.status,
    driftByChapter: result.driftByChapter,
    reconciledChapters: result.reconciledChapters,
    findingCodes: result.findings.map((f) => f.code),
  })

  await insertStoryEvent(admin, storyId, 'ACT_ENDING_REACHABILITY', {
    actNumber: derived.actNumber,
    checkpointChapter: chapterNumber,
    reachableMain,
    minRequired: 2,
    secretEndingPresent: secretEnding !== null && secretEnding !== undefined,
    secretReachable: secretEnding ? !secretBlocked : null,
    requiredClosure: closure,
    passed: reachabilityFindings.length === 0 && closure.every((c) => c.satisfiable),
  })

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
    // Evidence is durable (events above). A blueprint review workflow for this
    // state is M10-D scope (D-OBS-6); C-R1 must not let publication unwind,
    // but the failure IS loud and persisted.
    console.error('ACT_RECONCILIATION_FAILED_REVIEW_REQUIRED', {
      storyId,
      chapterNumber,
      actNumber: derived.actNumber,
      findingCodes: result.findings.map((f) => f.code),
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
