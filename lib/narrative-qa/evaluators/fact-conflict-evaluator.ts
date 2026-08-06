/**
 * B.3.9 — Entity/fact no-conflict evaluator — NTM `G5-NOCONFLICT`.
 *
 * ── DISPOSITION: OPEN / BLOCKED. NOT PROVEN. ─────────────────────────────
 *
 * This evaluator is intentionally INERT. It cannot produce
 * `ENTITY_FACT_CONFLICT` today, because the runtime has no structured
 * fact-conflict authority to evaluate against.
 *
 * Evidence (read-only, baseline `ef12234c`):
 *
 *   - `facts_ledger` columns are exactly:
 *       id, story_id, statement, subject_character_id,
 *       established_chapter, salience, load_bearing, paid_off
 *     (`supabase/migrations/20260707000000_core_runtime_baseline.sql`).
 *     `statement` is free text. There is no claim predicate, no claim value,
 *     no `supersedes`, no `retracted_at`, no conflict edge.
 *
 *   - The existing `STATE_FACT_CONFLICT` error in
 *     `lib/narrative/chapter-state-apply.ts` and
 *     `supabase/migrations/20260805020000_living_canon_publication_primitives.sql`
 *     is an IDENTITY collision guard (duplicate fact id / unknown
 *     `markPaidOff` target). It is NOT a semantic contradiction authority.
 *
 *   - `lib/ai-gateway/semantic-continuation-judge.ts` has
 *     `PREVIOUS_EVENT_CONTRADICTION`, but that is a model-scored signal.
 *     M10-B forbids model calls and semantic scoring, so it cannot back a
 *     deterministic gate.
 *
 * Two forbidden shortcuts are deliberately NOT taken here:
 *
 *   1. Using `CharacterStatus` DEAD→ALIVE as a stand-in. That is a different
 *      domain and already owned by `canon-drift-evaluator`
 *      (`ILLEGAL_DEAD_RESURRECTION`). Reusing it would make the NTM row look
 *      DONE while testing the wrong thing.
 *   2. Pseudo-semantic string matching over `statement` free text. That is
 *      semantic scoring wearing a deterministic costume.
 *
 * Unblocking `G5-NOCONFLICT` requires, in order:
 *   (a) schema: a structured claim dimension on `facts_ledger`
 *       (entity ref + claim predicate + claim value), or a dedicated
 *       `fact_claims` table with a uniqueness/conflict constraint;
 *   (b) runtime: publication-time enforcement that a conflicting claim for
 *       the same (entity, predicate) is rejected rather than last-write-wins,
 *       and that original canon remains unchanged;
 *   (c) fixture: the negative fixture from plan §B.3.9;
 *   (d) metric: `continuity_critical_rate`;
 *   (e) gate: negative gate wired to the deterministic suite.
 *
 * (a) and (b) do not exist. Per reviewer instruction, this is reported as a
 * blocker instead of being satisfied by substitution. This module keeps the
 * contract shape so the lane is ready once the runtime authority lands, and
 * the CLI reports the NTM row as OPEN.
 */

import type {
  ChapterRef,
  EvaluatorEnvelopeV1,
  LongHorizonFindingV1,
  TemporalExtractor,
} from '../contracts/evaluator-contract'
import { validateEvaluatorEnvelope } from '../contracts/evaluator-contract'

export const FACT_CONFLICT_EVALUATOR_ID = 'entity-fact-conflict'
export const FACT_CONFLICT_EVALUATOR_VERSION = '0.0.0-blocked'

export type G5Disposition = 'OPEN_BLOCKED_NO_RUNTIME_AUTHORITY'

export const G5_NOCONFLICT_DISPOSITION: G5Disposition = 'OPEN_BLOCKED_NO_RUNTIME_AUTHORITY'

export const G5_NOCONFLICT_BLOCKER_REASON =
  'facts_ledger has no structured claim dimension (entity/predicate/value) and no publication-time ' +
  'conflict authority. STATE_FACT_CONFLICT is an id-collision guard, not a contradiction gate. ' +
  'Deterministic ENTITY_FACT_CONFLICT cannot be proven at this baseline.'

/**
 * Placeholder input. Kept empty on purpose: there is no canonical structured
 * conflict evidence to accept yet, and accepting free-text statements would
 * invite a pseudo-semantic matcher.
 */
export interface FactConflictInputV1 {
  /**
   * Always `null` at this baseline. Reserved for the structured
   * (entity, predicate, value) claim rows once the schema exists.
   */
  structuredClaims: null
}

export const extractFactConflictChapters: TemporalExtractor<FactConflictInputV1> = () => {
  const refs: ChapterRef[] = []
  return refs
}

/**
 * Returns no findings by construction. Absence of findings here means
 * "not evaluated / not proven", NOT "no conflict". The CLI must surface
 * `G5_NOCONFLICT_DISPOSITION` so a green run can never be read as G5 closure.
 */
export function evaluateFactConflict(
  envelope: EvaluatorEnvelopeV1<FactConflictInputV1>,
): LongHorizonFindingV1[] {
  validateEvaluatorEnvelope(envelope, extractFactConflictChapters)
  return []
}
