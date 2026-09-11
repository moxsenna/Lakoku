import pricingSnapshotJson from '../../../fixtures/m10-g/pricing-snapshot-v1.json'
import { E0_R1_CEILINGS, E0_R1_DECISION_REF } from '../../../fixtures/m10-e/e0-budget-authority'
import { M10_G_SEMANTIC_AUTHORITY } from '../../../fixtures/m10-g/semantic-authority'
import { M10_G_G1_ROUTE_AUTHORITY } from '../../../fixtures/m10-g/g1-route-authority'

export const M10G_G1_PROJECTION_POLICY_ID = 'M10G_G1_REACHABLE_INFERENCE_TOPOLOGY_V1' as const
export const M10G_G1_HISTORICAL_INFERENCE_COUNT = 138 as const

export type M10GG1CallClass =
  | 'CHAPTER_PROSE'
  | 'CONTINUITY_JUDGE'
  | 'CHOICE_GENERATION'
  | 'LONG_HORIZON_SEMANTIC_JUDGE'

export type M10GG1EconomicsBlocker =
  | 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED'
  | 'BLOCKED_PRICING_AUTHORITY_MISSING'
  | 'G1_CHOICE_ROUTE_AUTHORITY_UNBOUND'
  | 'G1_CONTINUITY_ROUTE_AUTHORITY_UNBOUND'
  | 'G1_EXECUTE_CHAPTER_TOPOLOGY_UNBOUND'

export type UnavailableProjection = Readonly<{
  status: 'UNAVAILABLE'
  totalInputTokens?: null
  totalOutputTokens?: null
  amountUsd?: null
  blockers: readonly M10GG1EconomicsBlocker[]
}>

export type M10GG1TokenEnvelope = Readonly<{
  maximumInputTokens: null
  maximumOutputTokens: number | null
  deterministicInputCharacterLimit: number | null
  reasoningPolicy: string
  status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED'
  blocker: string
}>

export type M10GG1CallClassProjection = Readonly<{
  callClass: M10GG1CallClass
  trigger: string
  models: readonly string[]
  minimumExpectedInferenceCount: number
  maximumPolicyPermittedInferenceCount: number
  standaloneMaximumPolicyPermittedInferenceCount: number
  maximumChapterAttempts: number
  maximumCandidateTransportsPerLogicalCall: number
  maximumActualCandidateRequestsPerWorkflow: number | null
  sharedBudgetReservationPoint: string
  retryAuthority: string
  fallbackAuthority: string
  derivation: string
  sdkMaxRetries: 0
  tokenEnvelope: M10GG1TokenEnvelope
}>

export type M10GG1InferenceEconomicsProjection = Readonly<{
  policyId: typeof M10G_G1_PROJECTION_POLICY_ID
  chapterCount: 50
  nonTerminalChapterCount: 49
  minimumExpectedInferenceCount: number
  maximumPolicyPermittedInferenceCount: number
  hardInferenceLimit: null
  callClassBreakdown: readonly M10GG1CallClassProjection[]
  chapterAttemptTopology: Readonly<{
    maximumAttemptsPerChapter: 3
    maximumTransportsPerSingleAttemptAcrossNovel: number
    maximumTransportsAcrossChapterAttempts: number
    postChapterSemanticTransports: 36
    rule: 'OUTER_ATTEMPT_REENTERS_CHAPTER_PIPELINE_WITH_SAME_GLOBAL_BUDGET'
  }>
  mutuallyExclusiveWriterTopology: Readonly<{
    selectedPolicy: 'WRITER_LENGTH_REPAIR_DISABLED'
    writerLengthRepairEnabled: false
    writerLengthRepairMaximumTransportsContributed: 0
    writerLengthRepairDisabledMaximum: number
    writerLengthRepairEnabledAlternativeMaximum: number
    rule: 'ALTERNATIVES_NOT_ADDITIVE'
    explanation: string
  }>
  longHorizonSemanticJudgeCalls: 36
  sdkMaxRetries: 0
  historicalInferenceCount: Readonly<{
    value: typeof M10G_G1_HISTORICAL_INFERENCE_COUNT
    authority: 'HISTORICAL_ONLY'
    liveAuthority: false
  }>
  nominalTokenEnvelope: UnavailableProjection
  worstCaseTokenEnvelope: UnavailableProjection
  pricingAuthority: Readonly<{
    status: 'BLOCKED_PRICING_AUTHORITY_MISSING'
    authorityVersion: string
    pricingPolicyVersion: string
    source: 'fixtures/m10-g/pricing-snapshot-v1.json'
    snapshotHash: string
    effectiveFrom: string
    currency: string
    coveredModels: readonly string[]
    missingReachableModels: readonly string[]
  }>
  transportTopology: Readonly<{
    minimumTransportCount: number
    maximumPolicyPermittedTransportCount: number
    basis: 'MANDATORY_CALLS_AND_POLICY_PERMITTED_MAXIMUM_TRANSPORTS'
  }>
  minimumTopologyCostUpperBound: UnavailableProjection
  maximumTopologyCostUpperBound: UnavailableProjection
  nominalProjectedCost: UnavailableProjection
  worstCasePolicyPermittedCost: UnavailableProjection
  economicsStatus: Readonly<{
    track: 'M10G_G1_ECONOMICS_AUTHORITY_V1'
    status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED'
    pricingAuthority: 'BLOCKED_PRICING_AUTHORITY_MISSING'
    tokenEnvelope: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED'
    hardInferenceLimit: null
    comparisonStatus: 'NOT_EVALUATED'
    blockerCodes: readonly M10GG1EconomicsBlocker[]
    frozenCeilings: Readonly<{
      decisionRef: typeof E0_R1_DECISION_REF
      maxExpectedCostPerChapterUsd: string
      maxExpectedCostPerNovelUsd: string
      maxJudgeEvaluationCostPerNovelUsd: string
      maxRetryOverheadPercentage: string
    }>
  }>
}>

const CHAPTER_COUNT = 50 as const
const NON_TERMINAL_CHAPTER_COUNT = 49 as const
const MAXIMUM_CHAPTER_ATTEMPTS = 3 as const
const WRITER_CANDIDATE_COUNT = 1
const PROSE_LEAK_ATTEMPT_LIMIT = 2
const LAYER_A_REPAIR_LIMIT = 2
const LAYER_B_REPAIR_LIMIT = 2
const SEMANTIC_REWRITE_LIMIT = 1
const WRITER_LENGTH_REPAIR_BUDGET = 2
const CONTINUITY_JUDGE_CANDIDATE_LIMIT = 2
const CONTINUITY_JUDGE_CALLS_PER_REWRITE_PATH = 2
const CHOICE_WORKFLOW_CALL_LIMIT = 5

/**
 * Choice and continuity model routes are frozen in the hashed route authority.
 * Live executor identity is capability-bound, but full chapter topology remains
 * unbound until deterministic choice advance and immutable generation policy are
 * carried across all 50 chapters. Token and pricing blockers also remain.
 */
const ECONOMICS_BLOCKERS = Object.freeze([
  'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
  'BLOCKED_PRICING_AUTHORITY_MISSING',
  'G1_EXECUTE_CHAPTER_TOPOLOGY_UNBOUND',
] satisfies readonly M10GG1EconomicsBlocker[])

function unavailableTokens(): UnavailableProjection {
  return Object.freeze({
    status: 'UNAVAILABLE',
    totalInputTokens: null,
    totalOutputTokens: null,
    blockers: ECONOMICS_BLOCKERS,
  })
}

function unavailableCost(): UnavailableProjection {
  return Object.freeze({
    status: 'UNAVAILABLE',
    amountUsd: null,
    blockers: ECONOMICS_BLOCKERS,
  })
}

function blockedTokenEnvelope(args: {
  maximumOutputTokens: number | null
  deterministicInputCharacterLimit?: number | null
  reasoningPolicy: string
  blocker: string
}): M10GG1TokenEnvelope {
  return Object.freeze({
    maximumInputTokens: null,
    maximumOutputTokens: args.maximumOutputTokens,
    deterministicInputCharacterLimit: args.deterministicInputCharacterLimit ?? null,
    reasoningPolicy: args.reasoningPolicy,
    status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED',
    blocker: args.blocker,
  })
}

export function deriveM10GG1InferenceEconomicsProjection(): M10GG1InferenceEconomicsProjection {
  const longHorizonSemanticJudgeCalls = (
    M10_G_SEMANTIC_AUTHORITY.requiredCaseCount
    * M10_G_SEMANTIC_AUTHORITY.sampleCountPerCase
  )
  if (longHorizonSemanticJudgeCalls !== 36) {
    throw new Error('M10G_G1_LONG_HORIZON_JUDGE_TOPOLOGY_MISMATCH')
  }
  if (M10_G_SEMANTIC_AUTHORITY.executionIdentity.maxRetries !== 0) {
    throw new Error('M10G_G1_SEMANTIC_SDK_RETRY_POLICY_MISMATCH')
  }

  const writerLogicalInvocationsPerAttempt = CHAPTER_COUNT
    * (1 + LAYER_A_REPAIR_LIMIT + LAYER_B_REPAIR_LIMIT)
    + NON_TERMINAL_CHAPTER_COUNT * SEMANTIC_REWRITE_LIMIT
  const writerPerAttemptMaximum = writerLogicalInvocationsPerAttempt
    * WRITER_CANDIDATE_COUNT
    * PROSE_LEAK_ATTEMPT_LIMIT
  const writerLengthRepairDisabledMaximum = writerPerAttemptMaximum * MAXIMUM_CHAPTER_ATTEMPTS
  const writerLengthRepairEnabledAlternativeMaximum = CHAPTER_COUNT
    * WRITER_LENGTH_REPAIR_BUDGET
    * MAXIMUM_CHAPTER_ATTEMPTS
  const continuityPerAttemptMaximum = NON_TERMINAL_CHAPTER_COUNT
    * CONTINUITY_JUDGE_CALLS_PER_REWRITE_PATH
    * CONTINUITY_JUDGE_CANDIDATE_LIMIT
  const choicePerAttemptMaximum = NON_TERMINAL_CHAPTER_COUNT * CHOICE_WORKFLOW_CALL_LIMIT

  const callClassBreakdown = Object.freeze([
    Object.freeze({
      callClass: 'CHAPTER_PROSE',
      trigger: 'initial chapter write plus bounded Layer A, Layer B, semantic, and leak recovery',
      models: Object.freeze(['openai/gpt-5.6-sol']),
      minimumExpectedInferenceCount: CHAPTER_COUNT,
      maximumPolicyPermittedInferenceCount: writerLengthRepairDisabledMaximum,
      standaloneMaximumPolicyPermittedInferenceCount: writerLengthRepairDisabledMaximum,
      maximumChapterAttempts: MAXIMUM_CHAPTER_ATTEMPTS,
      maximumCandidateTransportsPerLogicalCall: WRITER_CANDIDATE_COUNT,
      maximumActualCandidateRequestsPerWorkflow: null,
      sharedBudgetReservationPoint: 'executeCandidate immediately before candidateTransport',
      retryAuthority: 'two prose leak attempts per logical write; two Layer A; two Layer B; one semantic rewrite; outer chapter attempt maximum three',
      fallbackAuthority: 'FROZEN_OFF_BY_G1_FLAGSHIP_ROUTE',
      derivation: 'max=((50 initial + 50×2 Layer A + 50×2 Layer B + 49×1 semantic rewrite)×1 candidate×2 prose leak attempts)×3 outer chapter attempts',
      sdkMaxRetries: 0 as const,
      tokenEnvelope: blockedTokenEnvelope({
        maximumOutputTokens: 4096,
        reasoningPolicy: 'none',
        blocker: 'writer prompt has no enforced total character or token maximum',
      }),
    }),
    Object.freeze({
      callClass: 'CONTINUITY_JUDGE',
      trigger: 'chapters 2..50 after deterministic Layer A/B acceptance',
      models: Object.freeze(['deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.1-terminus']),
      minimumExpectedInferenceCount: NON_TERMINAL_CHAPTER_COUNT,
      maximumPolicyPermittedInferenceCount: continuityPerAttemptMaximum * MAXIMUM_CHAPTER_ATTEMPTS,
      standaloneMaximumPolicyPermittedInferenceCount: continuityPerAttemptMaximum * MAXIMUM_CHAPTER_ATTEMPTS,
      maximumChapterAttempts: MAXIMUM_CHAPTER_ATTEMPTS,
      maximumCandidateTransportsPerLogicalCall: CONTINUITY_JUDGE_CANDIDATE_LIMIT,
      maximumActualCandidateRequestsPerWorkflow: null,
      sharedBudgetReservationPoint: 'executeCandidate immediately before candidateTransport',
      retryAuthority: 'initial judge plus one post-semantic-rewrite judge; outer chapter attempt maximum three',
      fallbackAuthority: 'FROZEN_ORDERED_CANDIDATE_FALLBACK_BOUND_TO_G1_ROUTE_AUTHORITY',
      derivation: 'max=49 chapters×2 logical judges×2 candidates×3 outer chapter attempts',
      sdkMaxRetries: 0 as const,
      tokenEnvelope: blockedTokenEnvelope({
        maximumOutputTokens: 512,
        reasoningPolicy: 'omitted by frozen G-1 continuity route; provider default applies',
        blocker: 'bounded characters do not establish a maximum input-token authority',
      }),
    }),
    Object.freeze({
      callClass: 'CHOICE_GENERATION',
      trigger: 'chapters 1..49 after accepted final prose',
      models: Object.freeze(['openai/gpt-4.1-mini', 'deepseek/deepseek-v3.2']),
      minimumExpectedInferenceCount: NON_TERMINAL_CHAPTER_COUNT,
      maximumPolicyPermittedInferenceCount: choicePerAttemptMaximum,
      standaloneMaximumPolicyPermittedInferenceCount: choicePerAttemptMaximum * MAXIMUM_CHAPTER_ATTEMPTS,
      maximumChapterAttempts: MAXIMUM_CHAPTER_ATTEMPTS,
      maximumCandidateTransportsPerLogicalCall: 3,
      maximumActualCandidateRequestsPerWorkflow: CHOICE_WORKFLOW_CALL_LIMIT,
      sharedBudgetReservationPoint: 'executeCandidate immediately before candidateTransport',
      retryAuthority: 'shared workflow budget permits five actual candidate requests; outer chapter attempt maximum three',
      fallbackAuthority: 'FROZEN_ORDERED_CANDIDATE_FALLBACK_BOUND_TO_G1_ROUTE_AUTHORITY',
      derivation: 'max=49 chapters×5 actual candidate requests across attempts; durable prose checkpoint makes choice retries mutually exclusive with prose and continuity replay',
      sdkMaxRetries: 0 as const,
      tokenEnvelope: blockedTokenEnvelope({
        maximumOutputTokens: M10_G_G1_ROUTE_AUTHORITY.routes.choice.maxOutput.presence === 'VALUE'
          ? Number(M10_G_G1_ROUTE_AUTHORITY.routes.choice.maxOutput.value)
          : null,
        deterministicInputCharacterLimit: 16_000,
        reasoningPolicy: 'omitted by frozen G-1 choice route; provider default applies',
        blocker: 'character cap lacks a deterministic tokenizer projection to billed input tokens',
      }),
    }),
    Object.freeze({
      callClass: 'LONG_HORIZON_SEMANTIC_JUDGE',
      trigger: 'post-chapter frozen 12-case by 3-sample schedule',
      models: Object.freeze([M10_G_SEMANTIC_AUTHORITY.executionIdentity.configuredModelId]),
      minimumExpectedInferenceCount: longHorizonSemanticJudgeCalls,
      maximumPolicyPermittedInferenceCount: longHorizonSemanticJudgeCalls,
      standaloneMaximumPolicyPermittedInferenceCount: longHorizonSemanticJudgeCalls,
      maximumChapterAttempts: 1,
      maximumCandidateTransportsPerLogicalCall: 1,
      maximumActualCandidateRequestsPerWorkflow: null,
      sharedBudgetReservationPoint: 'semantic executor immediately before transport',
      retryAuthority: 'maxRetries=0; one mandatory transport per schedule entry',
      fallbackAuthority: 'FROZEN_OFF_BY_SEMANTIC_AUTHORITY',
      derivation: '12 frozen M10-G cases × 3 required samples; fallbackAllowed=false; maxRetries=0',
      sdkMaxRetries: 0 as const,
      tokenEnvelope: blockedTokenEnvelope({
        maximumOutputTokens: null,
        reasoningPolicy: 'not specified by frozen semantic authority',
        blocker: 'no transport maxOutputTokens and no deterministic tokenizer projection for bounded source characters',
      }),
    }),
  ] satisfies readonly M10GG1CallClassProjection[])

  const minimumExpectedInferenceCount = callClassBreakdown.reduce(
    (sum, item) => sum + item.minimumExpectedInferenceCount,
    0,
  )
  const maximumPolicyPermittedInferenceCount = callClassBreakdown.reduce(
    (sum, item) => sum + item.maximumPolicyPermittedInferenceCount,
    0,
  )
  const maximumTransportsPerSingleAttemptAcrossNovel = writerPerAttemptMaximum
    + continuityPerAttemptMaximum
    + choicePerAttemptMaximum
  const maximumTransportsAcrossChapterAttempts = writerLengthRepairDisabledMaximum
    + continuityPerAttemptMaximum * MAXIMUM_CHAPTER_ATTEMPTS
    + choicePerAttemptMaximum
  const reachableModels = Array.from(new Set(
    callClassBreakdown.flatMap((entry) => entry.models),
  )).sort()
  const coveredModels = Object.freeze(
    pricingSnapshotJson.normalized.models
      .map((model) => model.metadataRowAlias)
      .sort(),
  )
  const missingReachableModels = Object.freeze(
    reachableModels.filter((model) => !coveredModels.includes(model)),
  )

  return Object.freeze({
    policyId: M10G_G1_PROJECTION_POLICY_ID,
    chapterCount: CHAPTER_COUNT,
    nonTerminalChapterCount: NON_TERMINAL_CHAPTER_COUNT,
    minimumExpectedInferenceCount,
    maximumPolicyPermittedInferenceCount,
    hardInferenceLimit: null,
    callClassBreakdown,
    chapterAttemptTopology: Object.freeze({
      maximumAttemptsPerChapter: MAXIMUM_CHAPTER_ATTEMPTS,
      maximumTransportsPerSingleAttemptAcrossNovel,
      maximumTransportsAcrossChapterAttempts,
      postChapterSemanticTransports: 36 as const,
      rule: 'OUTER_ATTEMPT_REENTERS_CHAPTER_PIPELINE_WITH_SAME_GLOBAL_BUDGET' as const,
    }),
    mutuallyExclusiveWriterTopology: Object.freeze({
      selectedPolicy: 'WRITER_LENGTH_REPAIR_DISABLED' as const,
      writerLengthRepairEnabled: false as const,
      writerLengthRepairMaximumTransportsContributed: 0 as const,
      writerLengthRepairDisabledMaximum,
      writerLengthRepairEnabledAlternativeMaximum,
      rule: 'ALTERNATIVES_NOT_ADDITIVE' as const,
      explanation: 'G-1 chapter execution carries an explicit false execution policy. The guarded repair branch is unreachable and contributes zero transports. Enabled max-two writer budget is a separate alternative; both maxima cannot occur in one run.',
    }),
    longHorizonSemanticJudgeCalls: 36 as const,
    sdkMaxRetries: 0 as const,
    historicalInferenceCount: Object.freeze({
      value: M10G_G1_HISTORICAL_INFERENCE_COUNT,
      authority: 'HISTORICAL_ONLY' as const,
      liveAuthority: false as const,
    }),
    nominalTokenEnvelope: unavailableTokens(),
    worstCaseTokenEnvelope: unavailableTokens(),
    pricingAuthority: Object.freeze({
      // Metadata-only M10-G snapshot now covers every reachable model, but the
      // hidden upstream provider/tier worst case is still unproven, so the
      // pricing authority stays blocked. M10-E ceilings remain byte-unchanged.
      status: 'BLOCKED_PRICING_AUTHORITY_MISSING' as const,
      authorityVersion: pricingSnapshotJson.schemaVersion,
      pricingPolicyVersion: pricingSnapshotJson.schemaVersion,
      source: 'fixtures/m10-g/pricing-snapshot-v1.json' as const,
      snapshotHash: pricingSnapshotJson.normalized.canonicalHash,
      effectiveFrom: pricingSnapshotJson.retrievedAt,
      currency: 'USD',
      coveredModels,
      missingReachableModels,
    }),
    transportTopology: Object.freeze({
      minimumTransportCount: minimumExpectedInferenceCount,
      maximumPolicyPermittedTransportCount: maximumPolicyPermittedInferenceCount,
      basis: 'MANDATORY_CALLS_AND_POLICY_PERMITTED_MAXIMUM_TRANSPORTS' as const,
    }),
    // Mandatory calls multiplied by maximum token caps can only ever be an
    // upper bound. No frozen authoritative nominal estimator exists, so the
    // nominal projection stays UNAVAILABLE rather than borrowing an upper bound.
    minimumTopologyCostUpperBound: unavailableCost(),
    maximumTopologyCostUpperBound: unavailableCost(),
    nominalProjectedCost: unavailableCost(),
    worstCasePolicyPermittedCost: unavailableCost(),
    economicsStatus: Object.freeze({
      track: 'M10G_G1_ECONOMICS_AUTHORITY_V1' as const,
      status: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED' as const,
      pricingAuthority: 'BLOCKED_PRICING_AUTHORITY_MISSING' as const,
      tokenEnvelope: 'BLOCKED_TOKEN_ENVELOPE_UNBOUNDED' as const,
      hardInferenceLimit: null,
      comparisonStatus: 'NOT_EVALUATED' as const,
      blockerCodes: ECONOMICS_BLOCKERS,
      frozenCeilings: Object.freeze({
        decisionRef: E0_R1_DECISION_REF,
        maxExpectedCostPerChapterUsd: E0_R1_CEILINGS.maxExpectedCostPerChapter,
        maxExpectedCostPerNovelUsd: E0_R1_CEILINGS.maxExpectedCostPerNovel,
        maxJudgeEvaluationCostPerNovelUsd: E0_R1_CEILINGS.maxJudgeEvaluationCostPerNovel,
        maxRetryOverheadPercentage: E0_R1_CEILINGS.maxRetryOverheadPercentage,
      }),
    }),
  })
}
