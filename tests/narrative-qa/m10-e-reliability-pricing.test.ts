import { describe, expect, it } from 'vitest'
import {
  E0_APPROVAL_AUTHORITY_SCHEMA,
  PRICING_SNAPSHOT_SCHEMA,
  businessAuthorityValue,
  canonicalAuthorityHash,
  createPricingSnapshot,
  estimateCostFromTokens,
  missingMeasurement,
  observedValue,
  presentMeasurement,
  pricingDerivedValue,
  validatePricingSnapshot,
} from '../../lib/narrative-qa/reliability'

function sampleSnapshot() {
  return createPricingSnapshot({
    pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
    providerId: 'provider_alpha',
    exactModelId: 'model-text-1',
    currency: 'IDR',
    inputPricePerUnit: '2.00000000',
    outputPricePerUnit: '10.00000000',
    unitSize: 1000000,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: '2026-12-31T23:59:59.000Z',
  })
}

describe('M10-E pricing snapshot authority', () => {
  it('binds schema, policy version, provider, model, currency, prices, unit, interval, source, and self-hash', () => {
    const snapshot = sampleSnapshot()
    expect(snapshot.authorityVersion).toBe('M10_E_PRICING_SNAPSHOT_V1')
    expect(snapshot.provenance).toBe('ASSUMPTION')
    expect(snapshot.currency).toBe('IDR')
    expect(snapshot.exactModelId).toBe('model-text-1')
    expect(snapshot.unitSize).toBe(1000000)
    expect(snapshot.canonicalHash).toMatch(/^[0-9a-f]{64}$/)
    const { canonicalHash: _hash, ...payload } = snapshot
    expect(snapshot.canonicalHash).toBe(canonicalAuthorityHash(payload))
    expect(() => validatePricingSnapshot(snapshot)).not.toThrow()
  })

  it('canonicalizes prices to money scale 8 before binding the hash', () => {
    const snapshot = createPricingSnapshot({
      pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
      providerId: 'provider_alpha',
      exactModelId: 'model-text-1',
      currency: 'IDR',
      inputPricePerUnit: '2',
      outputPricePerUnit: '10.5',
      unitSize: 1000000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    })
    expect(snapshot.inputPricePerUnit).toBe('2.00000000')
    expect(snapshot.outputPricePerUnit).toBe('10.50000000')
    const { canonicalHash: _hash, ...payload } = snapshot
    expect(snapshot.canonicalHash).toBe(canonicalAuthorityHash(payload))
  })

  it('rejects invalid effective intervals and non-canonical prices', () => {
    expect(() => sampleSnapshot()).not.toThrow()
    expect(() => createPricingSnapshot({
      pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
      providerId: 'provider_alpha',
      exactModelId: 'model-text-1',
      currency: 'IDR',
      inputPricePerUnit: '2.00000000',
      outputPricePerUnit: '10.00000000',
      unitSize: 1000000,
      effectiveFrom: '2026-12-31T00:00:00.000Z',
      effectiveTo: '2026-01-01T00:00:00.000Z',
    })).toThrow()
    expect(() => createPricingSnapshot({
      pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
      providerId: 'provider_alpha',
      exactModelId: 'model-text-1',
      currency: 'IDR',
      inputPricePerUnit: 'not-a-price',
      outputPricePerUnit: '10.00000000',
      unitSize: 1000000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    })).toThrow()
  })

  it('rejects hash tampering and non-ASSUMPTION provenance', () => {
    const snapshot = sampleSnapshot()
    expect(() => validatePricingSnapshot({ ...snapshot, canonicalHash: '0'.repeat(64) })).toThrow()
    expect(() => validatePricingSnapshot({ ...snapshot, provenance: 'OBSERVED' })).toThrow()
    expect(() => validatePricingSnapshot({ ...snapshot, currency: 'USD' })).toThrow()
  })

  it('enforces exact provider/model/currency identity', () => {
    expect(() => createPricingSnapshot({
      pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
      providerId: 'PROVIDER_UPPER',
      exactModelId: 'model-text-1',
      currency: 'IDR',
      inputPricePerUnit: '2.00000000',
      outputPricePerUnit: '10.00000000',
      unitSize: 1000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    })).toThrow()
    expect(() => sampleSnapshot()).not.toThrow()
    expect(() => createPricingSnapshot({
      pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
      providerId: 'provider_alpha',
      exactModelId: 'model-text-1',
      currency: 'idr',
      inputPricePerUnit: '2.00000000',
      outputPricePerUnit: '10.00000000',
      unitSize: 1000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    })).toThrow()
  })

  it('yields only MODELED_FROM_PRICING estimates while actual stays OBSERVED and ceiling stays BUSINESS_AUTHORITY', () => {
    const snapshot = sampleSnapshot()
    const actual = observedValue(presentMeasurement('3.50000000'), ['obs-actual-1'])
    const estimate = pricingDerivedValue(presentMeasurement('2.50000000'), snapshot.canonicalHash)
    const approvalPayload = {
      authorityVersion: 'M10_E_E0_APPROVAL_V1',
      approvalStatus: 'APPROVED' as const,
      policyId: 'lakoku-budget-v1',
      policyVersion: '1.0.0',
      decisionRef: 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md',
    }
    const approval = E0_APPROVAL_AUTHORITY_SCHEMA.parse({
      ...approvalPayload,
      canonicalHash: canonicalAuthorityHash(approvalPayload),
    })
    const ceiling = businessAuthorityValue('1000.00000000', approval)
    expect(actual.provenance).toBe('OBSERVED')
    expect(estimate.provenance).toBe('MODELED_FROM_PRICING')
    expect(estimate.pricingSnapshotHash).toBe(snapshot.canonicalHash)
    expect(ceiling.provenance).toBe('BUSINESS_AUTHORITY')
    expect(estimate.value.state).toBe('PRESENT')
    expect(actual.value.state).toBe('PRESENT')
    expect(ceiling.value).toBe('1000.00000000')
  })

  it('keeps pricing snapshot unusable as observed spend or E0 authority', () => {
    const snapshot = sampleSnapshot()
    expect(snapshot.provenance).toBe('ASSUMPTION')
    expect(snapshot).not.toHaveProperty('approvalStatus')
    expect(snapshot).not.toHaveProperty('approval')
    // A snapshot cannot be re-labeled OBSERVED without failing schema validation.
    expect(() => PRICING_SNAPSHOT_SCHEMA.parse({ ...snapshot, provenance: 'OBSERVED' })).toThrow()
  })

  it('allows missing actual cost to coexist with a pricing estimate', () => {
    const snapshot = sampleSnapshot()
    const missing = observedValue(missingMeasurement('COST_UNAVAILABLE', 'Actual cost not recorded'), [])
    const estimate = pricingDerivedValue(presentMeasurement('2.50000000'), snapshot.canonicalHash)
    expect(missing.value.state).toBe('MISSING')
    expect(estimate.value.state).toBe('PRESENT')
    if (missing.value.state === 'MISSING') {
      expect(missing.value.reasonCode).toBe('COST_UNAVAILABLE')
    }
  })

  it('never defaults missing prices to zero', () => {
    expect(() => PRICING_SNAPSHOT_SCHEMA.parse({
      provenance: 'ASSUMPTION',
      authorityVersion: 'M10_E_PRICING_SNAPSHOT_V1',
      pricingPolicyVersion: 'M10_E_PRICING_POLICY_V1',
      providerId: 'provider_alpha',
      exactModelId: 'model-text-1',
      currency: 'IDR',
      unitSize: 1000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      decisionRef: 'ref',
      canonicalHash: '0'.repeat(64),
    })).toThrow()
  })

  it('estimates cost exactly from input and output tokens and unit size', () => {
    const snapshot = sampleSnapshot()
    expect(estimateCostFromTokens(1000000, 0, snapshot)).toBe('2.00000000')
    expect(estimateCostFromTokens(0, 1000000, snapshot)).toBe('10.00000000')
    expect(estimateCostFromTokens(1000000, 1000000, snapshot)).toBe('12.00000000')
    expect(estimateCostFromTokens(500000, 0, snapshot)).toBe('1.00000000')
    expect(() => estimateCostFromTokens(-1, 0, snapshot)).toThrow()
    expect(() => estimateCostFromTokens(0, 1.5, snapshot)).toThrow()
  })
})