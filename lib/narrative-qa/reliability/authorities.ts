import { z } from 'zod'
import { SEMANTIC_RUBRIC_IDS } from '../contracts/semantic-judge-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  ATTEMPT_CLASS_SCHEMA,
  CHAPTER_SEQUENCE,
  COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  EXECUTION_PROFILE_SCHEMA,
  SAFE_ALIAS_SCHEMA,
  SHA256_SCHEMA,
  STAGE_IDS,
  STAGE_ID_SCHEMA,
  TASK_ID_SCHEMA,
  canonicalAuthorityHash,
  type CompatibleStratumIdentity,
  type ExecutionProfile,
} from './contracts'

const AUTHORITY_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
const CURRENCY_SCHEMA = z.string().regex(/^[A-Z]{3}$/)
const HASH_FIELDS = { decisionRef: z.string().min(1), canonicalHash: SHA256_SCHEMA }

const STAGE_CATALOG_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_STAGE_CATALOG_V1'),
  ...HASH_FIELDS,
  stages: z.array(STAGE_ID_SCHEMA).length(11),
})

const TASK_MAPPING_ROW_SCHEMA = z.strictObject({
  stageId: STAGE_ID_SCHEMA,
  taskId: TASK_ID_SCHEMA,
  providerCallState: z.enum(['APPLICABLE', 'NOT_APPLICABLE']),
  attemptClass: ATTEMPT_CLASS_SCHEMA.nullable(),
})
const TASK_MAPPING_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_TASK_MAPPING_V1'),
  ...HASH_FIELDS,
  mapping: z.array(TASK_MAPPING_ROW_SCHEMA).length(11),
})

export const M10_E_STAGE_CATALOG_V1 = freezeHashed({
  authorityVersion: 'M10_E_STAGE_CATALOG_V1' as const,
  decisionRef: AUTHORITY_DECISION_REF,
  stages: [...STAGE_IDS],
})

export const M10_E_TASK_MAPPING_V1 = freezeHashed({
  authorityVersion: 'M10_E_TASK_MAPPING_V1' as const,
  decisionRef: AUTHORITY_DECISION_REF,
  mapping: [
    { stageId: 'PROSE_PRIMARY', taskId: 'CHAPTER_PROSE', providerCallState: 'APPLICABLE', attemptClass: 'PRIMARY' },
    { stageId: 'PROSE_RETRY', taskId: 'CHAPTER_PROSE', providerCallState: 'APPLICABLE', attemptClass: 'RETRY' },
    { stageId: 'PROVIDER_FALLBACK', taskId: 'CHAPTER_PROSE', providerCallState: 'APPLICABLE', attemptClass: 'FALLBACK' },
    { stageId: 'CHECKPOINT_RECOVERY', taskId: 'RUNTIME_RECOVERY', providerCallState: 'NOT_APPLICABLE', attemptClass: null },
    { stageId: 'STRUCTURED_OUTPUT', taskId: 'CHAPTER_STRUCTURED_OUTPUT', providerCallState: 'APPLICABLE', attemptClass: 'PRIMARY' },
    { stageId: 'STRUCTURED_RETRY', taskId: 'CHAPTER_STRUCTURED_OUTPUT', providerCallState: 'APPLICABLE', attemptClass: 'RETRY' },
    { stageId: 'OWNERSHIP', taskId: 'RUNTIME_RECOVERY', providerCallState: 'NOT_APPLICABLE', attemptClass: null },
    { stageId: 'OWNERSHIP_RECOVERY', taskId: 'RUNTIME_RECOVERY', providerCallState: 'NOT_APPLICABLE', attemptClass: null },
    { stageId: 'PUBLICATION', taskId: 'RUNTIME_RECOVERY', providerCallState: 'NOT_APPLICABLE', attemptClass: null },
    { stageId: 'PUBLICATION_RECOVERY', taskId: 'RUNTIME_RECOVERY', providerCallState: 'NOT_APPLICABLE', attemptClass: null },
    { stageId: 'POST_PUBLISH', taskId: 'RUNTIME_RECOVERY', providerCallState: 'NOT_APPLICABLE', attemptClass: null },
  ],
})

export const M10_E_TOPOLOGY_V1 = freezeHashed({
  authorityVersion: 'M10_E_TOPOLOGY_V1' as const,
  decisionRef: AUTHORITY_DECISION_REF,
  entryStageId: 'PROSE_PRIMARY' as const,
  nodes: [
    topologyNode('PROSE_PRIMARY', ['STRUCTURED_OUTPUT'], ['PROSE_RETRY'], 'NONE'),
    topologyNode('PROSE_RETRY', ['STRUCTURED_OUTPUT'], ['PROVIDER_FALLBACK'], 'INCREMENT'),
    topologyNode('PROVIDER_FALLBACK', ['STRUCTURED_OUTPUT'], ['CHECKPOINT_RECOVERY'], 'NONE'),
    topologyNode('CHECKPOINT_RECOVERY', ['STRUCTURED_OUTPUT'], [], 'INCREMENT', 'TERMINAL_FAILURE'),
    topologyNode('STRUCTURED_OUTPUT', ['OWNERSHIP'], ['STRUCTURED_RETRY'], 'NONE'),
    topologyNode('STRUCTURED_RETRY', ['OWNERSHIP'], [], 'INCREMENT', 'TERMINAL_FAILURE'),
    topologyNode('OWNERSHIP', ['PUBLICATION'], ['OWNERSHIP_RECOVERY'], 'NONE'),
    topologyNode('OWNERSHIP_RECOVERY', ['PUBLICATION'], [], 'INCREMENT', 'TERMINAL_FAILURE'),
    topologyNode('PUBLICATION', ['POST_PUBLISH'], ['PUBLICATION_RECOVERY'], 'NONE'),
    topologyNode('PUBLICATION_RECOVERY', ['POST_PUBLISH'], [], 'INCREMENT', 'TERMINAL_FAILURE'),
    topologyNode('POST_PUBLISH', [], [], 'NONE', 'CHAPTER_COMPLETE', 'CHAPTER_COMPLETE'),
  ],
})

function topologyNode(
  stageId: (typeof STAGE_IDS)[number],
  successNextStageIds: (typeof STAGE_IDS)[number][],
  failureNextStageIds: (typeof STAGE_IDS)[number][],
  retryCounterEffect: 'NONE' | 'INCREMENT',
  failureChapterEffect: 'CONTINUE' | 'TERMINAL_FAILURE' | 'CHAPTER_COMPLETE' = 'CONTINUE',
  successChapterEffect: 'CONTINUE' | 'CHAPTER_COMPLETE' = 'CONTINUE',
) {
  const mapping = M10_E_TASK_MAPPING_V1.mapping.find((row) => row.stageId === stageId)
  if (!mapping) throw new Error(`Missing task mapping for ${stageId}`)
  return {
    stageId,
    taskId: mapping.taskId,
    providerCallState: mapping.providerCallState,
    attemptClass: mapping.attemptClass,
    retryCounterEffect,
    transitions: {
      SUCCESS: { nextStageIds: successNextStageIds, chapterEffect: successChapterEffect },
      FAILURE: { nextStageIds: failureNextStageIds, chapterEffect: failureChapterEffect },
    },
  }
}

export const M10_E_MONTE_CARLO_V1 = freezeHashed({
  authorityVersion: 'M10_E_MONTE_CARLO_V1' as const,
  methodVersion: 'M10_E_MONTE_CARLO_V1' as const,
  decisionRef: AUTHORITY_DECISION_REF,
  iterations: 100000,
  probabilitySemantic: 'FAILURE_PROBABILITY' as const,
  chapterOrder: [...CHAPTER_SEQUENCE],
  stageOrder: [...STAGE_IDS],
  skippedNodeDraws: 'NONE' as const,
  reachedProviderNodeDrawOrder: ['STAGE_OUTCOME_UINT32', 'PROVIDER_COST_UINT32'] as const,
  reachedRuntimeNodeDrawOrder: ['STAGE_OUTCOME_UINT32'] as const,
  judgeEvaluationDrawOrder: ['PROVIDER_COST_UINT32'] as const,
  prng: {
    algorithmId: 'xoshiro128**' as const,
    algorithmVersion: 1,
    seedEncoding: 'EXACT_UTF8' as const,
    seedDigest: 'SHA-256' as const,
    seedToStateVersion: 'SHA256_BYTES_0_15_FOUR_UINT32_BIG_ENDIAN_V1' as const,
    allZeroStateReplacement: ['0x6d2b79f5', '0x00000000', '0x00000000', '0x00000000'] as const,
    wordArithmetic: 'UINT32_MODULO_2_POW_32' as const,
    nextWordOperations: 'U=ROTL(S1*5,7)*9;T=S1<<9;S2^=S0;S3^=S1;S1^=S2;S0^=S3;S2^=T;S3=ROTL(S3,11);RETURN_U' as const,
    uniformDivisor: '4294967296' as const,
  },
  analyticalMethodEligibility: 'INDEPENDENT_BERNOULLI_WITHOUT_RETRY_RECOVERY_FALLBACK_OR_COST_ONLY' as const,
  outcomeComparator: 'UINT32_LT_FLOOR_FAILURE_PROBABILITY_TIMES_2_POW_32' as const,
  boundaryDrawConsumption: 'P_ZERO_AND_P_ONE_REACHED_NODES_CONSUME_ONE_OUTCOME_DRAW' as const,
  costSampling: 'SORT_NUMERIC_MONEY_THEN_UTF8_OBSERVATION_ID_INVERSE_EMPIRICAL_CDF' as const,
  percentileMethod: 'PERCENTILE_CONT_LINEAR_INTERPOLATION' as const,
  numeric: {
    probabilityScale: 12,
    moneyScale: 8,
    percentageScale: 6,
    latencyMillisecondsScale: 3,
    intermediateScale: 20,
    roundingMode: 'HALF_UP_TIES_AWAY_FROM_ZERO' as const,
    coefficientLimit: '99999999999999999999999999999999999999' as const,
    binaryFloatingPointAuthority: false,
  },
})

const ASSUMPTION_SCHEMA = z.strictObject({
  provenance: z.literal('ASSUMPTION'),
  authorityVersion: z.string().min(1),
  decisionRef: z.string().min(1),
  rationale: z.string().min(1),
  canonicalHash: SHA256_SCHEMA,
})

const INDEPENDENT_DRAW_ASSUMPTION = freezeHashed({
  provenance: 'ASSUMPTION' as const,
  authorityVersion: 'M10_E_INDEPENDENT_DRAW_ASSUMPTION_V1',
  decisionRef: AUTHORITY_DECISION_REF,
  rationale: 'Generation-node outcomes, chapters, generation costs, and judge cost samples use independent PRNG draws in model version 1.',
})
const DETERMINISTIC_JUDGE_ASSUMPTION = freezeHashed({
  provenance: 'ASSUMPTION' as const,
  authorityVersion: 'M10_E_DETERMINISTIC_JUDGE_ASSUMPTION_V1',
  decisionRef: AUTHORITY_DECISION_REF,
  rationale: 'Every required judge evaluation is traversed deterministically after successful chapter 50; judge reliability is out of scope.',
})

const CUMULATIVE_MODEL_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_CUMULATIVE_MODEL_V1'),
  modelVersion: z.literal('M10_E_CUMULATIVE_MODEL_V1'),
  ...HASH_FIELDS,
  stageCatalogVersion: z.literal('M10_E_STAGE_CATALOG_V1'),
  stageCatalogHash: SHA256_SCHEMA,
  taskMappingVersion: z.literal('M10_E_TASK_MAPPING_V1'),
  taskMappingHash: SHA256_SCHEMA,
  topologyVersion: z.literal('M10_E_TOPOLOGY_V1'),
  topologyHash: SHA256_SCHEMA,
  probabilityKey: z.literal('stageId'),
  centralProbabilityProvenance: z.literal('OBSERVED_ONLY'),
  novelCostConditioning: z.literal('SUCCESSFUL_50_CHAPTER_RUN'),
  monteCarlo: z.custom<typeof M10_E_MONTE_CARLO_V1>(),
  independentDrawAssumption: ASSUMPTION_SCHEMA,
  deterministicJudgeAssumption: ASSUMPTION_SCHEMA,
})

export const M10_E_CUMULATIVE_MODEL_V1 = freezeHashed({
  authorityVersion: 'M10_E_CUMULATIVE_MODEL_V1' as const,
  modelVersion: 'M10_E_CUMULATIVE_MODEL_V1' as const,
  decisionRef: AUTHORITY_DECISION_REF,
  stageCatalogVersion: 'M10_E_STAGE_CATALOG_V1' as const,
  stageCatalogHash: M10_E_STAGE_CATALOG_V1.canonicalHash,
  taskMappingVersion: 'M10_E_TASK_MAPPING_V1' as const,
  taskMappingHash: M10_E_TASK_MAPPING_V1.canonicalHash,
  topologyVersion: M10_E_TOPOLOGY_V1.authorityVersion,
  topologyHash: M10_E_TOPOLOGY_V1.canonicalHash,
  probabilityKey: 'stageId' as const,
  centralProbabilityProvenance: 'OBSERVED_ONLY' as const,
  novelCostConditioning: 'SUCCESSFUL_50_CHAPTER_RUN' as const,
  monteCarlo: M10_E_MONTE_CARLO_V1,
  independentDrawAssumption: INDEPENDENT_DRAW_ASSUMPTION,
  deterministicJudgeAssumption: DETERMINISTIC_JUDGE_ASSUMPTION,
})

const JUDGE_TASK_ID_SCHEMA = z.enum(SEMANTIC_RUBRIC_IDS)
const JUDGE_EVALUATION_SCHEMA = z.strictObject({
  judgeTaskId: JUDGE_TASK_ID_SCHEMA,
  evaluationIndex: z.number().int().min(0).max(2),
  providerModelPolicyId: SAFE_ALIAS_SCHEMA,
})
const JUDGE_PLAN_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_JUDGE_PLAN_V1'),
  decisionRef: z.string().min(1),
  currency: CURRENCY_SCHEMA,
  evaluations: z.array(JUDGE_EVALUATION_SCHEMA).length(24),
  canonicalHash: SHA256_SCHEMA,
})

export type JudgePlanAuthority = z.infer<typeof JUDGE_PLAN_SCHEMA>

export function createJudgePlanAuthority(providerModelPolicyId: string, currency: string): JudgePlanAuthority {
  const policyId = SAFE_ALIAS_SCHEMA.parse(providerModelPolicyId)
  const evaluations = SEMANTIC_RUBRIC_IDS.flatMap((judgeTaskId) => [0, 1, 2].map((evaluationIndex) => ({
    judgeTaskId,
    evaluationIndex,
    providerModelPolicyId: policyId,
  })))
  return freezeHashed({
    authorityVersion: 'M10_E_JUDGE_PLAN_V1' as const,
    decisionRef: AUTHORITY_DECISION_REF,
    currency: CURRENCY_SCHEMA.parse(currency),
    evaluations,
  })
}

export function validateJudgePlanAuthority(value: unknown, providerModelPolicyId: string): JudgePlanAuthority {
  const parsed = JUDGE_PLAN_SCHEMA.parse(value)
  assertHash(parsed)
  const expected = createJudgePlanAuthority(providerModelPolicyId, parsed.currency)
  assertSemanticIdentity(parsed, expected, 'Judge plan')
  return deepFreeze(parsed)
}

const EXCHANGEABILITY_SCHEMA = z.strictObject({
  provenance: z.literal('ASSUMPTION'),
  authorityVersion: z.literal('M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1'),
  decisionRef: z.string().min(1),
  rationale: z.string().min(1),
  stageId: STAGE_ID_SCHEMA,
  executionProfile: EXECUTION_PROFILE_SCHEMA,
  compatibleStratum: COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  chapters: z.array(z.number().int().min(1).max(50)).length(50),
  canonicalHash: SHA256_SCHEMA,
})
export type ChapterStageExchangeabilityAuthority = z.infer<typeof EXCHANGEABILITY_SCHEMA>

export function createChapterStageExchangeabilityAuthorities(
  executionProfile: ExecutionProfile,
  compatibleStratum: CompatibleStratumIdentity,
): ChapterStageExchangeabilityAuthority[] {
  const profile = EXECUTION_PROFILE_SCHEMA.parse(executionProfile)
  const stratum = validateCompatibleStratumAuthorityBindings(compatibleStratum)
  return deepFreeze(STAGE_IDS.map((stageId) => freezeHashed({
    provenance: 'ASSUMPTION' as const,
    authorityVersion: 'M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1' as const,
    decisionRef: AUTHORITY_DECISION_REF,
    rationale: `Chapter occurrences of ${stageId} are assumed exchangeable for central pooled hazard reuse; authority supplies no probability.`,
    stageId,
    executionProfile: profile,
    compatibleStratum: structuredClone(stratum),
    chapters: [...CHAPTER_SEQUENCE],
  })))
}

export function validateChapterStageExchangeabilityAuthorities(
  value: unknown,
  executionProfile: ExecutionProfile,
  compatibleStratum: CompatibleStratumIdentity,
): ChapterStageExchangeabilityAuthority[] {
  const parsed = z.array(EXCHANGEABILITY_SCHEMA).length(11).parse(value)
  for (const authority of parsed) assertHash(authority)
  const expected = createChapterStageExchangeabilityAuthorities(executionProfile, compatibleStratum)
  assertSemanticIdentity(parsed, expected, 'Chapter-stage exchangeability authority set')
  return deepFreeze(parsed)
}

function validateCompatibleStratumAuthorityBindings(value: CompatibleStratumIdentity): CompatibleStratumIdentity {
  const stratum = COMPATIBLE_STRATUM_IDENTITY_SCHEMA.parse(value)
  assertVersionHashPair(
    stratum.stageCatalogVersion,
    stratum.stageCatalogHash,
    M10_E_STAGE_CATALOG_V1.authorityVersion,
    M10_E_STAGE_CATALOG_V1.canonicalHash,
    'Stage catalog',
  )
  assertVersionHashPair(
    stratum.taskMappingVersion,
    stratum.taskMappingHash,
    M10_E_TASK_MAPPING_V1.authorityVersion,
    M10_E_TASK_MAPPING_V1.canonicalHash,
    'Task mapping',
  )
  assertVersionHashPair(
    stratum.topologyVersion,
    stratum.topologyHash,
    M10_E_TOPOLOGY_V1.authorityVersion,
    M10_E_TOPOLOGY_V1.canonicalHash,
    'Topology',
  )
  return stratum
}

function assertVersionHashPair(
  version: string,
  hash: string,
  expectedVersion: string,
  expectedHash: string,
  label: string,
): void {
  if (version !== expectedVersion || hash !== expectedHash) {
    throw new Error(`${label} version/hash pair does not match frozen V1 authority`)
  }
}

export function validateStageCatalogAuthority(value: unknown): typeof M10_E_STAGE_CATALOG_V1 {
  const parsed = STAGE_CATALOG_SCHEMA.parse(value)
  assertHash(parsed)
  assertSemanticIdentity(parsed, M10_E_STAGE_CATALOG_V1, 'Stage catalog')
  return deepFreeze(parsed) as typeof M10_E_STAGE_CATALOG_V1
}

export function validateTaskMappingAuthority(value: unknown): typeof M10_E_TASK_MAPPING_V1 {
  const parsed = TASK_MAPPING_SCHEMA.parse(value)
  assertHash(parsed)
  assertSemanticIdentity(parsed, M10_E_TASK_MAPPING_V1, 'Task mapping')
  return deepFreeze(parsed) as typeof M10_E_TASK_MAPPING_V1
}

export function validateMonteCarloAuthority(value: unknown): typeof M10_E_MONTE_CARLO_V1 {
  if (value === null || typeof value !== 'object' || !('canonicalHash' in value)) throw new Error('Invalid Monte Carlo authority')
  const authority = value as { canonicalHash: string }
  SHA256_SCHEMA.parse(authority.canonicalHash)
  assertHash(authority)
  assertSemanticIdentity(value, M10_E_MONTE_CARLO_V1, 'Monte Carlo')
  return deepFreeze(value) as typeof M10_E_MONTE_CARLO_V1
}

export function validateCumulativeModelAuthority(value: unknown): typeof M10_E_CUMULATIVE_MODEL_V1 {
  const parsed = CUMULATIVE_MODEL_SCHEMA.parse(value)
  assertHash(parsed)
  validateMonteCarloAuthority(parsed.monteCarlo)
  assertHash(parsed.independentDrawAssumption)
  assertHash(parsed.deterministicJudgeAssumption)
  assertSemanticIdentity(parsed, M10_E_CUMULATIVE_MODEL_V1, 'Cumulative model')
  return deepFreeze(parsed) as typeof M10_E_CUMULATIVE_MODEL_V1
}

function freezeHashed<T extends Record<string, unknown>>(payload: T): T & { canonicalHash: string } {
  return deepFreeze({ ...payload, canonicalHash: computeSha256(stableStringify(payload)) })
}

function assertHash(value: { canonicalHash: string }): void {
  if (canonicalAuthorityHash(value) !== value.canonicalHash) throw new Error('Canonical authority hash mismatch')
}

function assertSemanticIdentity(actual: unknown, expected: unknown, label: string): void {
  if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`${label} does not match frozen version identity`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
