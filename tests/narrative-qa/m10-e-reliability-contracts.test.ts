import { z } from 'zod'
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
  assumedValueSchema,
  businessAuthorityValue,
  businessAuthorityValueSchema,
  canonicalAuthorityHash,
  chapterNumber,
  measurementStateSchema,
  missingMeasurement,
  modeledValue,
  modeledValueSchema,
  notApplicableMeasurement,
  observedValue,
  observedValueSchema,
  presentMeasurement,
  pricingDerivedValue,
  pricingDerivedValueSchema,
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

  it('strictly validates and copies caller measurement states in observed and pricing constructors', () => {
    const hash = 'b'.repeat(64)
    const malformedStates = [
      { state: 'PRESENT', value: '1', extra: true },
      { state: 'MISSING', reasonCode: 'WRONG_REASON', detail: 'missing' },
      { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: '' },
      { state: 'MISSING', reasonCode: 'COST_UNAVAILABLE', detail: 'missing', extra: true },
      { state: 'NOT_APPLICABLE', authority: { authorityVersion: 'M10_E_TOPOLOGY_V1' } },
      { state: 'UNKNOWN', value: '1' },
    ]
    for (const malformed of malformedStates) {
      expect(() => Reflect.apply(observedValue, undefined, [malformed, ['obs-1']])).toThrow()
      expect(() => Reflect.apply(pricingDerivedValue, undefined, [malformed, hash])).toThrow()
    }

    const mutable = { state: 'PRESENT' as const, value: { calls: 0 } }
    const observed = observedValue(mutable, ['obs-1'])
    const priced = pricingDerivedValue(mutable, hash)
    expect(observed.value).not.toBe(mutable)
    expect(priced.value).not.toBe(mutable)
    expect(Object.isFrozen(observed.value)).toBe(true)
    expect(Object.isFrozen(priced.value)).toBe(true)
    if (observed.value.state === 'PRESENT' && priced.value.state === 'PRESENT') {
      expect(observed.value.value).not.toBe(mutable.value)
      expect(priced.value.value).not.toBe(mutable.value)
      expect(Object.isFrozen(observed.value.value)).toBe(true)
      expect(Object.isFrozen(priced.value.value)).toBe(true)
    }
  })

  it('strictly parses every provenance wrapper schema and rejects forged wrappers', () => {
    const assumption = hashAuthority({ authorityVersion: 'a/v1', rationale: 'Sensitivity only', decisionRef: 'D-1' })
    const model = hashAuthority({ authorityVersion: 'm/v1', modelVersion: 'model/v1', decisionRef: 'D-2' })
    const approval = hashAuthority({
      authorityVersion: 'e0/v1',
      approvalStatus: 'APPROVED' as const,
      policyId: 'policy',
      policyVersion: '1',
      decisionRef: 'D-3',
    })
    const schemasAndInputs = [
      [observedValueSchema(z.string()), { provenance: 'OBSERVED', value: { state: 'PRESENT', value: '1' }, observationRefs: ['obs-1'] }],
      [assumedValueSchema(z.string()), { provenance: 'ASSUMPTION', value: '1', source: assumption }],
      [modeledValueSchema(z.string()), { provenance: 'MODELED', value: '1', modelAuthority: model, inputHash: 'a'.repeat(64) }],
      [pricingDerivedValueSchema(z.string()), { provenance: 'MODELED_FROM_PRICING', value: { state: 'PRESENT', value: '1' }, pricingSnapshotHash: 'b'.repeat(64) }],
      [businessAuthorityValueSchema(z.string()), { provenance: 'BUSINESS_AUTHORITY', value: '1', approval }],
    ] as const

    for (const [schema, input] of schemasAndInputs) {
      expect(schema.parse(input)).toMatchObject(input)
      expect(() => schema.parse({ ...input, extra: true })).toThrow()
      expect(() => schema.parse({ ...input, provenance: 'FORGED' })).toThrow()
    }
  })

  it('keeps present-only boundaries distinct and provenance non-substitutable at runtime', () => {
    const presentOnly = z.strictObject({ state: z.literal('PRESENT'), value: z.number() })
    expect(presentOnly.parse(presentMeasurement(0))).toEqual({ state: 'PRESENT', value: 0 })
    expect(() => presentOnly.parse(missingMeasurement('COST_UNAVAILABLE', 'cost absent'))).toThrow()
    expect(measurementStateSchema(z.number()).parse({ state: 'PRESENT', value: 0 })).toEqual({ state: 'PRESENT', value: 0 })

    for (const zeroKind of ['calls', 'tokens', 'failures', 'cost']) {
      expect(observedValue(presentMeasurement(0), [`${zeroKind}-0`]).value).toEqual({ state: 'PRESENT', value: 0 })
    }

    const priced = pricingDerivedValue(presentMeasurement('0.00000000'), 'b'.repeat(64))
    expect(() => observedValueSchema(z.string()).parse(priced)).toThrow()
    expect(() => businessAuthorityValueSchema(z.string()).parse(priced)).toThrow()
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
