/**
 * M10-C R3.2 — act-boundary evidence parsing + completion gate (PURE).
 *
 * No IO, no `server-only`, no DB. `captureActBoundary` stays a read-only DB
 * adapter and delegates all interpretation here so the semantics are unit
 * testable without a database.
 *
 * Authority for the payload shape is the production writer:
 *   lib/runtime/post-publication-lifecycle.server.ts
 *     :: deriveEndingReachabilityEvidence  (V2, current)
 *     -> insertStoryEvent(..., 'ACT_ENDING_REACHABILITY', { ...evidence })
 *
 * The legacy V1 writer (`deriveEndingReachabilityEvidenceV1`) emitted a
 * DIFFERENT set of keys (endingCandidateCount / secretPathProven /
 * secretEndingModeled / flagBlockingModeled) and hardcoded ncs14Proven=false.
 * A V1 payload is therefore NOT valid V2 evidence and must never satisfy the
 * gate; it is reported as `validV2:false`, not silently coerced.
 */

import { ACT_BOUNDARY_CHAPTERS, ACT_PLAN, HARNESS_TOTAL_CHAPTERS } from './fixture'

/**
 * Structured read-back of the production `ACT_ENDING_REACHABILITY` event.
 *
 * `validV2:false` means "this payload is not the current structured contract"
 * (missing event, legacy V1 shape, or a type mismatch). It does NOT mean the
 * reachability proof failed — a fully valid V2 payload carrying
 * `ncs14Proven:false` is valid evidence that the gate did not pass.
 */
export interface EndingReachabilityCaptureV2 {
  eventPresent: boolean
  validV2: boolean
  mainEndingCount: number | null
  minRequiredMain: number | null
  secretEndingCount: number | null
  minRequiredSecret: number | null
  mainReachable: boolean | null
  secretReachable: boolean | null
  closureProofComplete: boolean | null
  closureAllSatisfiable: boolean | null
  ncs14Proven: boolean | null
}

const ABSENT_EVIDENCE: EndingReachabilityCaptureV2 = {
  eventPresent: false,
  validV2: false,
  mainEndingCount: null,
  minRequiredMain: null,
  secretEndingCount: null,
  minRequiredSecret: null,
  mainReachable: null,
  secretReachable: null,
  closureProofComplete: null,
  closureAllSatisfiable: null,
  ncs14Proven: null,
}

function invalidEvidence(): EndingReachabilityCaptureV2 {
  return { ...ABSENT_EVIDENCE, eventPresent: true }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strictBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Parse a persisted `ACT_ENDING_REACHABILITY` payload into structured evidence.
 * `payload` is `null`/`undefined` when the event does not exist at all.
 */
export function parseEndingReachabilityCaptureV2(payload: unknown): EndingReachabilityCaptureV2 {
  if (payload === null || payload === undefined) return { ...ABSENT_EVIDENCE }
  if (typeof payload !== 'object' || Array.isArray(payload)) return invalidEvidence()

  const row = payload as Record<string, unknown>

  const mainEndingCount = finiteNumber(row.mainEndingCount)
  const minRequiredMain = finiteNumber(row.minRequiredMain)
  const secretEndingCount = finiteNumber(row.secretEndingCount)
  const minRequiredSecret = finiteNumber(row.minRequiredSecret)
  const mainReachable = strictBoolean(row.mainReachable)
  const secretReachable = strictBoolean(row.secretReachable)
  const closureProofComplete = strictBoolean(row.closureProofComplete)
  const closureAllSatisfiable = strictBoolean(row.closureAllSatisfiable)
  const ncs14Proven = strictBoolean(row.ncs14Proven)

  // Every V2 field must be present with the right primitive type. A single
  // missing/mistyped field (the V1 shape, or a truncated write) is reported as
  // invalid rather than partially trusted.
  const complete =
    mainEndingCount !== null
    && minRequiredMain !== null
    && secretEndingCount !== null
    && minRequiredSecret !== null
    && mainReachable !== null
    && secretReachable !== null
    && closureProofComplete !== null
    && closureAllSatisfiable !== null
    && ncs14Proven !== null
  if (!complete) return invalidEvidence()

  return {
    eventPresent: true,
    validV2: true,
    mainEndingCount,
    minRequiredMain,
    secretEndingCount,
    minRequiredSecret,
    mainReachable,
    secretReachable,
    closureProofComplete,
    closureAllSatisfiable,
    ncs14Proven,
  }
}

/**
 * Deterministic display string for the DEPRECATED
 * `ActBoundaryCaptureV1.endingReachability` field. Presentation only — the gate
 * never reads it.
 */
export function renderEndingReachabilityDisplay(evidence: EndingReachabilityCaptureV2): string | null {
  if (!evidence.eventPresent) return null
  if (!evidence.validV2) return 'INVALID_V2_PAYLOAD'
  return `${evidence.ncs14Proven === true ? 'PROVEN' : 'UNPROVEN'}`
    + `:main=${String(evidence.mainEndingCount)}/min=${String(evidence.minRequiredMain)}`
    + `,secret=${String(evidence.secretEndingCount)}/min=${String(evidence.minRequiredSecret)}`
    + `,mainReachable=${String(evidence.mainReachable)}`
    + `,secretReachable=${String(evidence.secretReachable)}`
    + `,closureProof=${String(evidence.closureProofComplete)}`
    + `,closureSatisfiable=${String(evidence.closureAllSatisfiable)}`
}

/**
 * Structural subset of ActBoundaryCaptureV1 the gate needs. Declared locally so
 * this pure module never imports the DB-facing capture module.
 */
export interface ActBoundaryGateInputV1 {
  actNumber: number
  rollupPresent: boolean
  reconciliationTriggered: boolean
  nextActFirstChapterBlueprintVersion: number | null
  endingReachabilityV2: EndingReachabilityCaptureV2
}

export interface ActBoundaryGateResult {
  passed: boolean
  detail: Record<string, unknown>
}

export function expectedActBoundaryCount(): number {
  return ACT_BOUNDARY_CHAPTERS.filter((c) => c <= HARNESS_TOTAL_CHAPTERS).length
}

/**
 * ACT_BOUNDARY_HOOKS_PROVEN.
 *
 * EVERY configured boundary must carry a committed act rollup.
 *
 * A boundary that HAS a next act (fixture C: acts 1 and 2, Bab 5 and Bab 12)
 * must additionally prove the production post-publication hook fired and that
 * its structured evidence passes:
 *   - reconciliationTriggered === true      (ACT_RECONCILIATION event exists)
 *   - endingReachabilityV2.validV2 === true (current structured contract)
 *   - endingReachabilityV2.ncs14Proven === true
 *   - nextActFirstChapterBlueprintVersion !== null
 *
 * The TERMINAL boundary (fixture C: act 3, Bab 50) requires NONE of those:
 * production `runActBoundaryReconciliation` only derives a reconciliation input
 * when a next act exists and returns `{ triggered: false }` otherwise, so there
 * is no next-act blueprint and no act reconciliation/reachability event by
 * construction. Final-ending obligations for Bab 45/48/49/50 are proven by the
 * ending-runway evaluator, not by forcing next-act reconciliation at Bab 50.
 */
export function evaluateActBoundaryGate(boundaries: ActBoundaryGateInputV1[]): ActBoundaryGateResult {
  const expectedCount = expectedActBoundaryCount()
  const violations: string[] = []

  if (boundaries.length !== expectedCount) {
    violations.push(`boundaryCount:${boundaries.length}!=${expectedCount}`)
  }

  const perBoundary = boundaries.map((b) => {
    const hasNextAct = ACT_PLAN.some((a) => a.actNumber === b.actNumber + 1)
    const terminal = !hasNextAct
    const v2 = b.endingReachabilityV2

    if (!b.rollupPresent) violations.push(`act${b.actNumber}:rollupMissing`)
    if (hasNextAct) {
      if (!b.reconciliationTriggered) violations.push(`act${b.actNumber}:reconciliationMissing`)
      if (!v2.eventPresent) violations.push(`act${b.actNumber}:reachabilityEventMissing`)
      else if (!v2.validV2) violations.push(`act${b.actNumber}:reachabilityPayloadNotV2`)
      else if (v2.ncs14Proven !== true) violations.push(`act${b.actNumber}:ncs14Unproven`)
      if (b.nextActFirstChapterBlueprintVersion === null) {
        violations.push(`act${b.actNumber}:nextBlueprintMissing`)
      }
    }

    return {
      act: b.actNumber,
      terminal,
      rollup: b.rollupPresent,
      reconciliation: b.reconciliationTriggered,
      reachabilityEventPresent: v2.eventPresent,
      validV2: v2.validV2,
      ncs14Proven: v2.ncs14Proven,
      nextBlueprint: b.nextActFirstChapterBlueprintVersion,
    }
  })

  return {
    passed: violations.length === 0,
    detail: {
      expectedBoundaryCount: expectedCount,
      observedBoundaryCount: boundaries.length,
      actBoundaries: perBoundary,
      violations,
    },
  }
}
