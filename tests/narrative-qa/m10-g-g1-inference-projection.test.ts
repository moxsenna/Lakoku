import { describe, expect, it } from 'vitest'
import {
  M10G_G1_HISTORICAL_INFERENCE_COUNT,
  deriveM10GG1InferenceEconomicsProjection,
} from '@/lib/narrative-qa/harness/m10-g-g1-inference-projection'

function callClass(name: string) {
  const item = deriveM10GG1InferenceEconomicsProjection().callClassBreakdown
    .find((entry) => entry.callClass === name)
  if (!item) throw new Error(`Missing call class: ${name}`)
  return item
}

describe('M10-G G-1 deterministic inference and economics projection', () => {
  it('includes every legal outer chapter attempt in the maximum transport count', () => {
    const projection = deriveM10GG1InferenceEconomicsProjection()

    expect(callClass('CHAPTER_PROSE')).toMatchObject({
      minimumExpectedInferenceCount: 50,
      maximumPolicyPermittedInferenceCount: 1794,
      maximumChapterAttempts: 3,
      maximumCandidateTransportsPerLogicalCall: 1,
    })
    expect(callClass('CONTINUITY_JUDGE')).toMatchObject({
      minimumExpectedInferenceCount: 49,
      maximumPolicyPermittedInferenceCount: 588,
      maximumChapterAttempts: 3,
      maximumCandidateTransportsPerLogicalCall: 2,
    })
    expect(callClass('CHOICE_GENERATION')).toMatchObject({
      minimumExpectedInferenceCount: 49,
      maximumPolicyPermittedInferenceCount: 245,
      maximumChapterAttempts: 3,
      maximumCandidateTransportsPerLogicalCall: 3,
      maximumActualCandidateRequestsPerWorkflow: 5,
    })
    expect(callClass('LONG_HORIZON_SEMANTIC_JUDGE')).toMatchObject({
      minimumExpectedInferenceCount: 36,
      maximumPolicyPermittedInferenceCount: 36,
      maximumChapterAttempts: 1,
      maximumCandidateTransportsPerLogicalCall: 1,
    })
    expect(projection.minimumExpectedInferenceCount).toBe(184)
    expect(projection.maximumPolicyPermittedInferenceCount).toBe(2663)
    expect(projection.chapterAttemptTopology).toEqual({
      maximumAttemptsPerChapter: 3,
      maximumTransportsPerSingleAttemptAcrossNovel: 1039,
      maximumTransportsAcrossChapterAttempts: 2627,
      postChapterSemanticTransports: 36,
      rule: 'OUTER_ATTEMPT_REENTERS_CHAPTER_PIPELINE_WITH_SAME_GLOBAL_BUDGET',
    })
  })

  it('proves frozen-off writer length repair contributes exactly zero transports', () => {
    expect(deriveM10GG1InferenceEconomicsProjection().mutuallyExclusiveWriterTopology).toEqual({
      selectedPolicy: 'WRITER_LENGTH_REPAIR_DISABLED',
      writerLengthRepairEnabled: false,
      writerLengthRepairMaximumTransportsContributed: 0,
      writerLengthRepairDisabledMaximum: 1794,
      writerLengthRepairEnabledAlternativeMaximum: 300,
      rule: 'ALTERNATIVES_NOT_ADDITIVE',
      explanation: expect.stringContaining('explicit false execution policy'),
    })
  })

  it('maps every reachable provider candidate and reservation boundary', () => {
    expect(callClass('CHAPTER_PROSE')).toMatchObject({
      models: ['openai/gpt-5.6-sol'],
      sharedBudgetReservationPoint: 'executeCandidate immediately before candidateTransport',
      sdkMaxRetries: 0,
      fallbackAuthority: 'FROZEN_OFF_BY_G1_FLAGSHIP_ROUTE',
    })
    expect(callClass('CHOICE_GENERATION')).toMatchObject({
      models: ['openai/gpt-4.1-mini', 'deepseek/deepseek-v3.2'],
      sharedBudgetReservationPoint: 'executeCandidate immediately before candidateTransport',
      sdkMaxRetries: 0,
      fallbackAuthority: 'FROZEN_ORDERED_CANDIDATE_FALLBACK_BOUND_TO_G1_ROUTE_AUTHORITY',
    })
    expect(callClass('CONTINUITY_JUDGE')).toMatchObject({
      models: ['deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.1-terminus'],
      sharedBudgetReservationPoint: 'executeCandidate immediately before candidateTransport',
      sdkMaxRetries: 0,
      fallbackAuthority: 'FROZEN_ORDERED_CANDIDATE_FALLBACK_BOUND_TO_G1_ROUTE_AUTHORITY',
    })
    expect(callClass('LONG_HORIZON_SEMANTIC_JUDGE')).toMatchObject({
      models: ['deepseek/deepseek-v3.2'],
      sharedBudgetReservationPoint: 'semantic executor immediately before transport',
      sdkMaxRetries: 0,
      fallbackAuthority: 'FROZEN_OFF_BY_SEMANTIC_AUTHORITY',
    })
  })

  it('proves G-1 long-horizon semantic topology is exactly 12 cases times 3 samples', () => {
    const projection = deriveM10GG1InferenceEconomicsProjection()
    expect(projection.longHorizonSemanticJudgeCalls).toBe(36)
    expect(callClass('LONG_HORIZON_SEMANTIC_JUDGE').derivation).toContain('12 frozen M10-G cases × 3 required samples')
  })

  it('marks 138 historical-only and never uses it as live min, max, or hard authority', () => {
    const projection = deriveM10GG1InferenceEconomicsProjection()
    expect(M10G_G1_HISTORICAL_INFERENCE_COUNT).toBe(138)
    expect(projection.historicalInferenceCount).toEqual({
      value: 138,
      authority: 'HISTORICAL_ONLY',
      liveAuthority: false,
    })
    expect(projection.minimumExpectedInferenceCount).not.toBe(138)
    expect(projection.maximumPolicyPermittedInferenceCount).not.toBe(138)
    expect(projection.hardInferenceLimit).toBeNull()
  })

  it('stops token authority on unbounded production inputs and outputs', () => {
    const projection = deriveM10GG1InferenceEconomicsProjection()

    expect(callClass('CHAPTER_PROSE').tokenEnvelope).toMatchObject({
      maximumInputTokens: null,
      maximumOutputTokens: 4096,
      status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
    })
    expect(callClass('CHOICE_GENERATION').tokenEnvelope).toMatchObject({
      maximumInputTokens: null,
      maximumOutputTokens: 1024,
      deterministicInputCharacterLimit: 16000,
      status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
    })
    expect(callClass('CONTINUITY_JUDGE').tokenEnvelope).toMatchObject({
      maximumInputTokens: null,
      maximumOutputTokens: 512,
      status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
    })
    expect(callClass('LONG_HORIZON_SEMANTIC_JUDGE').tokenEnvelope).toMatchObject({
      maximumInputTokens: null,
      maximumOutputTokens: null,
      status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
    })
    expect(projection.nominalTokenEnvelope).toMatchObject({ status: 'UNAVAILABLE', totalInputTokens: null, totalOutputTokens: null })
    expect(projection.worstCaseTokenEnvelope).toMatchObject({ status: 'UNAVAILABLE', totalInputTokens: null, totalOutputTokens: null })
  })

  it('binds pricing provenance to the metadata-only M10-G snapshot while retaining hidden-tier blocker', () => {
    const projection = deriveM10GG1InferenceEconomicsProjection()

    expect(projection.pricingAuthority).toEqual({
      status: 'BLOCKED_PRICING_AUTHORITY_MISSING',
      authorityVersion: 'M10G_G1_PRICING_SNAPSHOT_V1',
      pricingPolicyVersion: 'M10G_G1_PRICING_SNAPSHOT_V1',
      source: 'fixtures/m10-g/pricing-snapshot-v1.json',
      snapshotHash: '587126f281730c3bd129f4ccd620a852610962320ab482775d757d6898bb8513',
      effectiveFrom: '2026-09-07T23:20:20.000Z',
      currency: 'USD',
      coveredModels: [
        'deepseek/deepseek-v3.1-terminus',
        'deepseek/deepseek-v3.2',
        'openai/gpt-4.1-mini',
        'openai/gpt-5.6-sol',
      ],
      missingReachableModels: [],
    })
  })

  it('terminates fail-closed without costs or hard limit', () => {
    const projection = deriveM10GG1InferenceEconomicsProjection()
    const expectedBlockers = [
      'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
      'BLOCKED_PRICING_AUTHORITY_MISSING',
      'G1_EXECUTE_CHAPTER_TOPOLOGY_UNBOUND',
    ]

    expect(projection.transportTopology).toEqual({
      minimumTransportCount: 184,
      maximumPolicyPermittedTransportCount: 2663,
      basis: 'MANDATORY_CALLS_AND_POLICY_PERMITTED_MAXIMUM_TRANSPORTS',
    })
    expect(projection.minimumTopologyCostUpperBound).toEqual({
      status: 'UNAVAILABLE', amountUsd: null, blockers: expectedBlockers,
    })
    expect(projection.maximumTopologyCostUpperBound).toEqual({
      status: 'UNAVAILABLE', amountUsd: null, blockers: expectedBlockers,
    })
    expect(projection.nominalProjectedCost).toEqual({
      status: 'UNAVAILABLE', amountUsd: null, blockers: expectedBlockers,
    })
    expect(projection.worstCasePolicyPermittedCost).toEqual({
      status: 'UNAVAILABLE', amountUsd: null, blockers: expectedBlockers,
    })
    expect(projection.economicsStatus).toMatchObject({
      track: 'M10G_G1_ECONOMICS_AUTHORITY_V1',
      status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
      pricingAuthority: 'BLOCKED_PRICING_AUTHORITY_MISSING',
      tokenEnvelope: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
      hardInferenceLimit: null,
      comparisonStatus: 'NOT_EVALUATED',
      blockerCodes: expectedBlockers,
      frozenCeilings: {
        decisionRef: 'LAKOKU-E0-2026-08-26-LOOSE-200-R1',
        maxExpectedCostPerChapterUsd: '2.10000000',
        maxExpectedCostPerNovelUsd: '200.00000000',
        maxJudgeEvaluationCostPerNovelUsd: '2.40000000',
        maxRetryOverheadPercentage: '173.684249',
      },
    })
  })
})
