import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import snapshotJson from '../../fixtures/m10-g/pricing-snapshot-v1.json'
import {
  M10G_G1_PRICING_METADATA_ENDPOINT,
  M10G_G1_PRICING_TARGET_ALIASES,
  createM10GG1PricingSnapshot,
  multiplyDecimalByInteger,
  validateM10GG1PricingSnapshot,
} from '../../lib/narrative-qa/contracts/m10-g-g1-pricing-snapshot.contract'
import {
  M10G_G1_PRICING_AUTHORITY_BLOCKER_REASON,
  M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY,
  evaluateM10GG1PricingAuthority,
} from '../../lib/narrative-qa/evaluators/m10-g-g1-pricing-authority'

const snapshot = validateM10GG1PricingSnapshot(snapshotJson)

function tamperedSnapshot(mutator: (copy: typeof snapshotJson) => void): typeof snapshotJson {
  const copy = structuredClone(snapshotJson)
  mutator(copy)
  return copy
}

describe('M10G_G1_PRICING_SNAPSHOT_V1 fixture', () => {
  it('pins exact unauthenticated GET provenance and captured raw hashes', () => {
    expect(snapshot.schemaVersion).toBe('M10G_G1_PRICING_SNAPSHOT_V1')
    expect(snapshot.metadataRequest).toEqual({
      method: 'GET',
      endpoint: M10G_G1_PRICING_METADATA_ENDPOINT,
      provider: 'OpenRouter',
      authenticated: false,
    })
    expect(snapshot.retrievedAt).toBe('2026-09-07T23:20:20.000Z')
    expect(snapshot.rawResponseSha256).toBe('42deb0f12a5acd0cc199c52b919de919a3aa3416de6c63ce09d4287298d0e46c')
    expect(snapshot.rawResponseByteLength).toBe('704253')
    expect(snapshot.rawRetainedSubsetCanonicalSha256).toBe('3ce1186eff2e154cd9c6e68e34eb12ecc73c5e18c41dfac63eb16e6480a69e92')
    expect(snapshot.normalized.canonicalHash).toBe('587126f281730c3bd129f4ccd620a852610962320ab482775d757d6898bb8513')
  })

  it('covers exactly reachable aliases while preserving source canonical slugs', () => {
    expect(snapshot.normalized.targetAliases).toEqual(M10G_G1_PRICING_TARGET_ALIASES)
    expect(snapshot.normalized.models.map((model) => model.configuredAlias)).toEqual(M10G_G1_PRICING_TARGET_ALIASES)
    expect(snapshot.normalized.models.map((model) => model.metadataRowAlias)).toEqual(M10G_G1_PRICING_TARGET_ALIASES)
    expect(snapshot.normalized.models.map((model) => model.canonicalModelId)).toEqual([
      { state: 'VALUE', value: 'openai/gpt-5.6-sol-20260709' },
      { state: 'VALUE', value: 'openai/gpt-4.1-mini-2025-04-14' },
      { state: 'VALUE', value: 'deepseek/deepseek-v3.2-20251201' },
      { state: 'VALUE', value: 'deepseek/deepseek-v3.1-terminus' },
    ])
  })

  it('normalizes per-token prices to exact USD per 1M without Number money arithmetic', () => {
    expect(multiplyDecimalByInteger('0.000000269', BigInt(1_000_000))).toBe('0.269')
    expect(multiplyDecimalByInteger('0.0000001345', BigInt(1_000_000))).toBe('0.1345')
    expect(snapshot.normalized.models.map((model) => [model.configuredAlias, model.input.per1MTokensUsd, model.output.per1MTokensUsd])).toEqual([
      ['openai/gpt-5.6-sol', { state: 'VALUE', value: '2' }, { state: 'VALUE', value: '10' }],
      ['openai/gpt-4.1-mini', { state: 'VALUE', value: '0.4' }, { state: 'VALUE', value: '1.6' }],
      ['deepseek/deepseek-v3.2', { state: 'VALUE', value: '0.269' }, { state: 'VALUE', value: '0.4' }],
      ['deepseek/deepseek-v3.1-terminus', { state: 'VALUE', value: '0.27' }, { state: 'VALUE', value: '1' }],
    ])
  })

  it('preserves omitted fields, nonzero billable components, override tiers, and routing metadata', () => {
    const flagship = snapshot.normalized.models[0]!
    const deepseek = snapshot.normalized.models[2]!
    expect(flagship.reasoning.sourcePerTokenUsd).toEqual({ state: 'OMITTED' })
    expect(flagship.cacheWrite.per1MTokensUsd).toEqual({ state: 'VALUE', value: '2.5' })
    expect(flagship.perRequest.web_search).toEqual({ state: 'VALUE', value: '0.01' })
    expect(flagship.overrides).toEqual({
      state: 'VALUE',
      value: [{
        min_prompt_tokens: 272000,
        prompt: '0.000004',
        completion: '0.000015',
        input_cache_read: '0.0000004',
        input_cache_write: '0.000005',
      }],
    })
    expect(deepseek.cacheRead.sourcePerTokenUsd).toEqual({ state: 'VALUE', value: '0.0000001345' })
    expect(deepseek.cacheWrite.sourcePerTokenUsd).toEqual({ state: 'OMITTED' })
    expect(deepseek.routingSemantics.perRequestLimits).toEqual({ state: 'NULL' })
    expect(deepseek.contextLength).toBe(163840)
    expect(deepseek.maximumOutputTokens).toBe(65536)
  })

  it('allows extra source models but rejects missing or duplicate target rows', () => {
    const rawRows = structuredClone(snapshot.rawRetainedSubset.data)
    const rebuilt = createM10GG1PricingSnapshot({
      retrievedAt: snapshot.retrievedAt,
      rawResponseSha256: snapshot.rawResponseSha256,
      rawResponseByteLength: snapshot.rawResponseByteLength,
      rawModelsResponse: { data: [...rawRows, { id: 'extra/model', pricing: {} }] },
    })
    expect(rebuilt.normalized.models).toHaveLength(4)

    expect(() => createM10GG1PricingSnapshot({
      retrievedAt: snapshot.retrievedAt,
      rawResponseSha256: snapshot.rawResponseSha256,
      rawResponseByteLength: snapshot.rawResponseByteLength,
      rawModelsResponse: { data: rawRows.slice(1) },
    })).toThrow('M10G_G1_PRICING_TARGET_COVERAGE:openai/gpt-5.6-sol:0')

    expect(() => createM10GG1PricingSnapshot({
      retrievedAt: snapshot.retrievedAt,
      rawResponseSha256: snapshot.rawResponseSha256,
      rawResponseByteLength: snapshot.rawResponseByteLength,
      rawModelsResponse: { data: [...rawRows, rawRows[0]] },
    })).toThrow('M10G_G1_PRICING_TARGET_COVERAGE:openai/gpt-5.6-sol:2')
  })

  it('rejects negative/non-string prices, hash tampering, alias tampering, and endpoint substitution', () => {
    const rawRows = structuredClone(snapshot.rawRetainedSubset.data)
    const firstPricing = rawRows[0]!.pricing as Record<string, unknown>
    firstPricing.prompt = '-0.1'
    expect(() => createM10GG1PricingSnapshot({
      retrievedAt: snapshot.retrievedAt,
      rawResponseSha256: snapshot.rawResponseSha256,
      rawResponseByteLength: snapshot.rawResponseByteLength,
      rawModelsResponse: { data: rawRows },
    })).toThrow('M10G_G1_PRICING_DECIMAL_INVALID')

    const nonStringRows = structuredClone(snapshot.rawRetainedSubset.data)
    const nonStringPricing = nonStringRows[0]!.pricing as Record<string, unknown>
    nonStringPricing.prompt = 0.000002
    expect(() => createM10GG1PricingSnapshot({
      retrievedAt: snapshot.retrievedAt,
      rawResponseSha256: snapshot.rawResponseSha256,
      rawResponseByteLength: snapshot.rawResponseByteLength,
      rawModelsResponse: { data: nonStringRows },
    })).toThrow('M10G_G1_PRICING_NON_DECIMAL')

    expect(() => validateM10GG1PricingSnapshot(tamperedSnapshot((copy) => {
      copy.normalized.canonicalHash = 'a'.repeat(64)
    }))).toThrow('M10G_G1_PRICING_NORMALIZED_HASH_MISMATCH')
    expect(() => validateM10GG1PricingSnapshot(tamperedSnapshot((copy) => {
      copy.rawRetainedSubsetCanonicalSha256 = 'a'.repeat(64)
    }))).toThrow('M10G_G1_PRICING_RAW_SUBSET_HASH_MISMATCH')
    expect(() => validateM10GG1PricingSnapshot(tamperedSnapshot((copy) => {
      copy.normalized.models[0]!.metadataRowAlias = 'openai/derived-dated-slug'
    }))).toThrow('M10G_G1_PRICING_ALIAS_MISMATCH')
    expect(() => validateM10GG1PricingSnapshot({
      ...snapshot,
      metadataRequest: { ...snapshot.metadataRequest, endpoint: 'https://example.com/models' },
    })).toThrow('M10G_G1_PRICING_SNAPSHOT_INVALID')
    expect(() => validateM10GG1PricingSnapshot({
      ...snapshot,
      metadataRequest: { ...snapshot.metadataRequest, method: 'POST' },
    })).toThrow('M10G_G1_PRICING_SNAPSHOT_INVALID')
  })

  it('keeps pricing authority blocked despite valid measurement coverage', () => {
    expect(evaluateM10GG1PricingAuthority(snapshot)).toEqual({
      decisionId: 'M10G_G1_PRICING_AUTHORITY_DECISION_V2',
      status: 'BLOCKED_PRICING_AUTHORITY_MISSING',
      measurementSnapshotValid: true,
      snapshotUnchanged: true,
      additionalEndpointFetched: false,
      snapshotCanonicalHash: snapshot.normalized.canonicalHash,
      coveredReachableAliases: M10G_G1_PRICING_TARGET_ALIASES,
      provesHiddenUpstreamProviderWorstCase: false,
      provesRoutingTierWorstCase: false,
      provesPerRequestMinimumCharges: false,
      provesReasoningBillingSemantics: false,
      provesCacheWriteBillingSemantics: false,
      requiredAdditionalAuthority: M10G_G1_PRICING_REQUIRED_ADDITIONAL_AUTHORITY,
      reason: M10G_G1_PRICING_AUTHORITY_BLOCKER_REASON,
    })
  })
})

describe('pricing metadata fetch script static safety', () => {
  const source = readFileSync('scripts/m10-g-g1-fetch-pricing-metadata.ts', 'utf8')

  it('contains only pinned public metadata transport and no credential use', () => {
    expect(source).toContain("M10G_G1_PRICING_HTTP_METHOD = 'GET'")
    expect(source).toContain('M10G_G1_PRICING_METADATA_ENDPOINT')
    expect(source).toContain("redirect: 'manual'")
    expect(source).not.toMatch(/Authorization|API_KEY|Bearer/i)
    expect(source).not.toContain('openrouter.ai/api/v1/chat/completions')
    expect(source).not.toContain('openrouter.ai/api/v1/completions')
    expect(source).not.toMatch(/method:\s*['"]POST['"]/)
  })
})
