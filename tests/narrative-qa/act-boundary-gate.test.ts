/**
 * M10-C R3.2 — act-boundary evidence parsing + completion gate regressions.
 *
 * Pure: no DB, no runtime, no `server-only`. Locks two properties the stale
 * harness violated:
 *   1. a legacy V1 ACT_ENDING_REACHABILITY payload can never pass as V2 proof;
 *   2. rollup + next-act blueprint alone do NOT prove an act boundary, while
 *      the TERMINAL boundary (no next act) legitimately needs neither
 *      reconciliation nor reachability, because production
 *      runActBoundaryReconciliation returns triggered:false there.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateActBoundaryGate,
  expectedActBoundaryCount,
  parseEndingReachabilityCaptureV2,
  renderEndingReachabilityDisplay,
} from '../../lib/narrative-qa/harness/act-boundary-evidence'
import type { ActBoundaryGateInputV1 } from '../../lib/narrative-qa/harness/act-boundary-evidence'
import { ACT_PLAN } from '../../lib/narrative-qa/harness/fixture'

/** Exactly what lib/runtime/post-publication-lifecycle.server.ts V2 writes. */
function v2Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actNumber: 1,
    checkpointChapter: 5,
    mainEndingCount: 3,
    minRequiredMain: 2,
    secretEndingCount: 1,
    minRequiredSecret: 1,
    requiredClosure: [
      { endingId: 'e1', endingKind: 'main', proven: true, satisfiable: true, blockedByFlags: [], flagsPresent: true },
    ],
    closureAllSatisfiable: true,
    closureProofComplete: true,
    mainReachable: true,
    secretReachable: true,
    reachabilityViolationFindingCodes: [],
    ncs14Proven: true,
    ...overrides,
  }
}

/** Exactly what the DEPRECATED V1 writer emitted (deriveEndingReachabilityEvidenceV1). */
function v1Payload(): Record<string, unknown> {
  return {
    actNumber: 1,
    checkpointChapter: 5,
    endingCandidateCount: 2,
    minRequiredMain: 2,
    requiredClosure: [],
    closureAllSatisfiable: true,
    secretEndingModeled: false,
    secretPathProven: false,
    flagBlockingModeled: false,
    ncs14Proven: false,
    reachabilityViolationFindingCodes: [],
  }
}

const PROVEN = parseEndingReachabilityCaptureV2(v2Payload())
const UNPROVEN = parseEndingReachabilityCaptureV2(v2Payload({
  secretReachable: false,
  ncs14Proven: false,
}))
const LEGACY_V1 = parseEndingReachabilityCaptureV2(v1Payload())
const MISSING = parseEndingReachabilityCaptureV2(null)

function boundary(
  actNumber: number,
  overrides: Partial<ActBoundaryGateInputV1> = {},
): ActBoundaryGateInputV1 {
  const hasNextAct = ACT_PLAN.some((a) => a.actNumber === actNumber + 1)
  return {
    actNumber,
    rollupPresent: true,
    reconciliationTriggered: hasNextAct,
    nextActFirstChapterBlueprintVersion: hasNextAct ? 1 : null,
    endingReachabilityV2: hasNextAct ? PROVEN : MISSING,
    ...overrides,
  }
}

/** Full 3-act fixture run: acts 1 and 2 have a next act, act 3 (Bab 50) is terminal. */
function fullRun(overrides: Partial<Record<number, Partial<ActBoundaryGateInputV1>>> = {}): ActBoundaryGateInputV1[] {
  return ACT_PLAN.map((a) => boundary(a.actNumber, overrides[a.actNumber] ?? {}))
}

describe('parseEndingReachabilityCaptureV2', () => {
  it('valid V2 payload with ncs14Proven=true -> validV2=true, proven=true', () => {
    expect(PROVEN.eventPresent).toBe(true)
    expect(PROVEN.validV2).toBe(true)
    expect(PROVEN.ncs14Proven).toBe(true)
    expect(PROVEN.mainEndingCount).toBe(3)
    expect(PROVEN.minRequiredMain).toBe(2)
    expect(PROVEN.secretEndingCount).toBe(1)
    expect(PROVEN.minRequiredSecret).toBe(1)
    expect(PROVEN.mainReachable).toBe(true)
    expect(PROVEN.secretReachable).toBe(true)
    expect(PROVEN.closureProofComplete).toBe(true)
    expect(PROVEN.closureAllSatisfiable).toBe(true)
  })

  it('valid V2 payload with ncs14Proven=false is VALID evidence of failure, not an invalid payload', () => {
    expect(UNPROVEN.eventPresent).toBe(true)
    expect(UNPROVEN.validV2).toBe(true)
    expect(UNPROVEN.ncs14Proven).toBe(false)
    expect(UNPROVEN.secretReachable).toBe(false)
  })

  it('legacy V1 payload -> eventPresent=true, validV2=false, all value fields null', () => {
    expect(LEGACY_V1.eventPresent).toBe(true)
    expect(LEGACY_V1.validV2).toBe(false)
    expect(LEGACY_V1.ncs14Proven).toBeNull()
    expect(LEGACY_V1.mainEndingCount).toBeNull()
    expect(LEGACY_V1.secretEndingCount).toBeNull()
    expect(LEGACY_V1.mainReachable).toBeNull()
    expect(LEGACY_V1.secretReachable).toBeNull()
    expect(LEGACY_V1.closureProofComplete).toBeNull()
  })

  it('missing event -> eventPresent=false, validV2=false', () => {
    expect(MISSING.eventPresent).toBe(false)
    expect(MISSING.validV2).toBe(false)
    expect(MISSING.ncs14Proven).toBeNull()
    expect(parseEndingReachabilityCaptureV2(undefined).eventPresent).toBe(false)
  })

  it('partial or mistyped V2 payload -> validV2=false', () => {
    const missingField = v2Payload()
    delete missingField.secretEndingCount
    expect(parseEndingReachabilityCaptureV2(missingField).validV2).toBe(false)

    const mistyped = parseEndingReachabilityCaptureV2(v2Payload({ ncs14Proven: 'true' }))
    expect(mistyped.eventPresent).toBe(true)
    expect(mistyped.validV2).toBe(false)

    const numericFlag = parseEndingReachabilityCaptureV2(v2Payload({ mainReachable: 1 }))
    expect(numericFlag.validV2).toBe(false)

    expect(parseEndingReachabilityCaptureV2([]).validV2).toBe(false)
    expect(parseEndingReachabilityCaptureV2('PROVEN').validV2).toBe(false)
  })

  it('display string is presentation-only and never claims PROVEN for a V1 payload', () => {
    expect(renderEndingReachabilityDisplay(MISSING)).toBeNull()
    expect(renderEndingReachabilityDisplay(LEGACY_V1)).toBe('INVALID_V2_PAYLOAD')
    expect(renderEndingReachabilityDisplay(PROVEN)).toContain('PROVEN')
    expect(renderEndingReachabilityDisplay(UNPROVEN)).toContain('UNPROVEN')
  })
})

describe('evaluateActBoundaryGate', () => {
  it('boundary with next act + rollup + reconciliation + valid V2 proven + blueprint -> PASS', () => {
    const result = evaluateActBoundaryGate(fullRun())
    expect(result.passed).toBe(true)
    expect(result.detail.violations).toEqual([])
    expect(result.detail.observedBoundaryCount).toBe(expectedActBoundaryCount())
  })

  it('boundary with next act + valid V2 but ncs14Proven=false -> FAIL', () => {
    const result = evaluateActBoundaryGate(fullRun({ 1: { endingReachabilityV2: UNPROVEN } }))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain('act1:ncs14Unproven')
  })

  it('boundary with next act + legacy V1 reachability payload -> FAIL', () => {
    const result = evaluateActBoundaryGate(fullRun({ 2: { endingReachabilityV2: LEGACY_V1 } }))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain('act2:reachabilityPayloadNotV2')
  })

  it('boundary with next act + missing reachability event -> FAIL', () => {
    const result = evaluateActBoundaryGate(fullRun({ 1: { endingReachabilityV2: MISSING } }))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain('act1:reachabilityEventMissing')
  })

  it('boundary with next act + missing reconciliation event -> FAIL', () => {
    const result = evaluateActBoundaryGate(fullRun({ 2: { reconciliationTriggered: false } }))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain('act2:reconciliationMissing')
  })

  it('boundary with next act + missing next-act blueprint -> FAIL', () => {
    const result = evaluateActBoundaryGate(fullRun({ 1: { nextActFirstChapterBlueprintVersion: null } }))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain('act1:nextBlueprintMissing')
  })

  it('TERMINAL boundary with rollup only (no reconciliation, no reachability, no blueprint) -> PASS', () => {
    const terminalAct = ACT_PLAN[ACT_PLAN.length - 1].actNumber
    const result = evaluateActBoundaryGate(fullRun({
      [terminalAct]: {
        reconciliationTriggered: false,
        nextActFirstChapterBlueprintVersion: null,
        endingReachabilityV2: MISSING,
      },
    }))
    expect(result.passed).toBe(true)
    expect(result.detail.violations).toEqual([])
    const rows = result.detail.actBoundaries as Array<Record<string, unknown>>
    expect(rows.find((r) => r.act === terminalAct)?.terminal).toBe(true)
  })

  it('TERMINAL boundary with rollup missing -> FAIL', () => {
    const terminalAct = ACT_PLAN[ACT_PLAN.length - 1].actNumber
    const result = evaluateActBoundaryGate(fullRun({ [terminalAct]: { rollupPresent: false } }))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain(`act${terminalAct}:rollupMissing`)
  })

  it('missing a configured boundary entirely -> FAIL', () => {
    const result = evaluateActBoundaryGate(fullRun().slice(0, ACT_PLAN.length - 1))
    expect(result.passed).toBe(false)
    expect(result.detail.violations).toContain(`boundaryCount:${ACT_PLAN.length - 1}!=${expectedActBoundaryCount()}`)
  })
})
