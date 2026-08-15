import { describe, expect, it } from 'vitest'
import {
  ASSUMPTION_AUTHORITY_SCHEMA,
  ATTEMPT_CLASSES,
  ATTEMPT_NUMBER_SCHEMA,
  BUDGET_GATES,
  CHAPTER_SEQUENCE,
  COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  E0_APPROVAL_AUTHORITY_SCHEMA,
  ENGINEERING_GATES,
  EXECUTION_PROFILES,
  MISSING_REASON_CODES,
  MODEL_AUTHORITY_SCHEMA,
  NOT_APPLICABLE_AUTHORITY_SCHEMA,
  RELEASE_READINESS_VALUES,
  SAFE_ALIAS_SCHEMA,
  STAGE_IDS,
  STAGE_ID_SCHEMA,
  TASK_IDS,
  TASK_ID_SCHEMA,
  assumedValue,
  businessAuthorityValue,
  canonicalAuthorityHash,
  chapterNumber,
  missingMeasurement,
  modeledValue,
  notApplicableMeasurement,
  observedValue,
  presentMeasurement,
  pricingDerivedValue,
  sortReasonCodes,
} from '../../lib/narrative-qa/reliability'

const hashAuthority = <T extends Record<string, unknown>>(payload: T) => ({
  ...payload,
  canonicalHash: canonicalAuthorityHash(payload),
})

describe('M10-E reliability contracts', () => {
  it('freezes exact contract unions and chapter identity', () => {
    expect(EXECUTION_PROFILES).toEqual(['CONTRACT_FIXTURE', 'RELEASE_EVIDENCE'])
    expect(ENGINEERING_GATES).toEqual(['PASS', 'FAIL', 'HOLD'])
    expect(RELEASE_READINESS_VALUES).toEqual(['HOLD', 'BLOCKED', 'READY'])
    expect(BUDGET_GATES).toEqual(['PASS', 'FAIL', 'BLOCKED_E0_COST_CEILING_NOT_APPROVED'])
    expect(ATTEMPT_CLASSES).toEqual(['PRIMARY', 'RETRY', 'FALLBACK'])
    expect(STAGE_IDS).toHaveLength(11)
    expect(TASK_IDS).toEqual(['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT', 'RUNTIME_RECOVERY'])
    expect(CHAPTER_SEQUENCE).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    expect(chapterNumber(1)).toBe(1)
    expect(chapterNumber(50)).toBe(50)
    expect(() => chapterNumber(0)).toThrow()
    expect(() => chapterNumber(51)).toThrow()
    expect(ATTEMPT_NUMBER_SCHEMA.parse(1)).toBe(1)
    expect(() => ATTEMPT_NUMBER_SCHEMA.parse(0)).toThrow()
    expect(() => TASK_ID_SCHEMA.parse('WRONG_TASK')).toThrow()
    expect(() => STAGE_ID_SCHEMA.parse('WRONG_STAGE')).toThrow()
  })

  it('keeps zero present and missing explicit', () => {
    for (const value of [0, '0', '0.00000000']) {
      expect(presentMeasurement(value)).toEqual({ state: 'PRESENT', value })
    }
    expect(missingMeasurement('TELEMETRY_UNAVAILABLE', 'provider row absent')).toEqual({
      state: 'MISSING',
      reasonCode: 'TELEMETRY_UNAVAILABLE',
      detail: 'provider row absent',
    })
    expect(() => missingMeasurement('TELEMETRY_UNAVAILABLE', '')).toThrow()
  })

  it('requires exact runtime topology authority for NOT_APPLICABLE', () => {
    const authority = hashAuthority({
      authorityVersion: 'M10_E_TOPOLOGY_V1' as const,
      stageId: 'OWNERSHIP_RECOVERY' as const,
      taskId: 'RUNTIME_RECOVERY' as const,
      applicability: 'PROVIDER_CALL_NOT_APPLICABLE' as const,
      decisionRef: 'E3A-E4-DESIGN-SECTION-9',
    })
    expect(notApplicableMeasurement(authority)).toEqual({ state: 'NOT_APPLICABLE', authority })
    expect(NOT_APPLICABLE_AUTHORITY_SCHEMA.parse(authority)).toEqual(authority)

    const prose = hashAuthority({ ...authority, stageId: 'PROSE_PRIMARY' as const })
    expect(() => NOT_APPLICABLE_AUTHORITY_SCHEMA.parse(prose)).toThrow()
    const callerZero = { state: 'PRESENT', value: 0 }
    expect(() => NOT_APPLICABLE_AUTHORITY_SCHEMA.parse(callerZero)).toThrow()
    expect(() => NOT_APPLICABLE_AUTHORITY_SCHEMA.parse({ ...authority, extra: true })).toThrow()
    expect(() => NOT_APPLICABLE_AUTHORITY_SCHEMA.parse({ ...authority, canonicalHash: '0'.repeat(64) })).toThrow()
  })

  it('validates and freezes each provenance constructor', () => {
    const assumption = hashAuthority({
      authorityVersion: 'assumption/v1',
      rationale: 'Sensitivity boundary only',
      decisionRef: 'DECISION-1',
    })
    const model = hashAuthority({
      authorityVersion: 'model/v1',
      modelVersion: 'm10-e-model/v1',
      decisionRef: 'DECISION-2',
    })
    const approval = hashAuthority({
      authorityVersion: 'e0-approval/v1',
      approvalStatus: 'APPROVED' as const,
      policyId: 'cost-policy',
      policyVersion: '1',
      decisionRef: 'E0-DECISION',
    })

    const observed = observedValue(presentMeasurement(0), ['obs-2', 'obs-1'])
    expect(observed.observationRefs).toEqual(['obs-1', 'obs-2'])
    expect(Object.isFrozen(observed)).toBe(true)
    expect(() => observedValue(presentMeasurement(0), [])).toThrow()
    expect(() => observedValue(presentMeasurement(0), [''])).toThrow()
    expect(assumedValue('0.1', assumption)).toMatchObject({ provenance: 'ASSUMPTION' })
    expect(modeledValue('0.2', model, 'a'.repeat(64))).toMatchObject({ provenance: 'MODELED' })
    expect(pricingDerivedValue(presentMeasurement('1.00'), 'b'.repeat(64))).toMatchObject({ provenance: 'MODELED_FROM_PRICING' })
    expect(businessAuthorityValue('5.00', approval)).toMatchObject({ provenance: 'BUSINESS_AUTHORITY' })
    expect(() => assumedValue('0.1', { ...assumption, canonicalHash: '0'.repeat(64) })).toThrow()
    expect(() => modeledValue('0.2', model, 'bad')).toThrow()
    expect(() => pricingDerivedValue(presentMeasurement('1.00'), 'bad')).toThrow()
    const approvalWithExtra = { ...approval, extra: true }
    expect(() => E0_APPROVAL_AUTHORITY_SCHEMA.parse(approvalWithExtra)).toThrow()
    expect(ASSUMPTION_AUTHORITY_SCHEMA.parse(assumption)).toEqual(assumption)
    expect(MODEL_AUTHORITY_SCHEMA.parse(model)).toEqual(model)
    expect(E0_APPROVAL_AUTHORITY_SCHEMA.parse(approval)).toEqual(approval)
  })

  it('rejects forged provenance and unknown keys through strict schemas', () => {
    expect(() => ASSUMPTION_AUTHORITY_SCHEMA.parse({ provenance: 'OBSERVED' })).toThrow()
    expect(() => SAFE_ALIAS_SCHEMA.parse('raw-production-id')).toThrow()
    expect(SAFE_ALIAS_SCHEMA.parse('story_01')).toBe('story_01')
    expect(() => SAFE_ALIAS_SCHEMA.parse('Story 01')).toThrow()
    expect(() => COMPATIBLE_STRATUM_IDENTITY_SCHEMA.parse({ retryFallbackPolicyId: 'r' })).toThrow()
  })

  it('sorts stable reason codes by frozen order', () => {
    expect(MISSING_REASON_CODES.length).toBeGreaterThan(2)
    expect(sortReasonCodes(['CURRENCY_CONVERSION_UNAVAILABLE', 'TELEMETRY_UNAVAILABLE', 'COST_UNAVAILABLE'])).toEqual([
      'TELEMETRY_UNAVAILABLE',
      'COST_UNAVAILABLE',
      'CURRENCY_CONVERSION_UNAVAILABLE',
    ])
  })
})
