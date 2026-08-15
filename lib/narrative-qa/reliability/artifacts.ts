import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import { missingMeasurement, presentMeasurement, type MeasurementState } from './contracts'
import {
  COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  EXECUTION_PROFILE_SCHEMA,
  SHA256_SCHEMA,
  STAGE_ID_SCHEMA,
  type CompatibleStratumIdentity,
  type ExecutionProfile,
} from './contracts'
import {
  M10_E_CUMULATIVE_MODEL_V1,
  M10_E_MONTE_CARLO_V1,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  validateChapterStageExchangeabilityAuthorities,
  validateCumulativeModelAuthority,
  validateJudgePlanAuthority,
  validateMonteCarloAuthority,
  validateStageCatalogAuthority,
  validateTaskMappingAuthority,
  type ChapterStageExchangeabilityAuthority,
  type JudgePlanAuthority,
} from './authorities'
import { validateTopologyAuthority } from './topology'
import { ASSUMPTION_AUTHORITY_SCHEMA, GATE_REASON_CODE_SCHEMA, type AssumptionAuthority } from './contracts'
import { decimalMean, type CanonicalDecimal } from './decimal'
import {
  aggregateReliabilityObservations,
  evaluateProfileThresholds,
  type P4EngineeringReason,
} from './aggregation'
import {
  runCumulativeModel,
  type CentralStageProbabilityInput,
  type CumulativeModelInput,
  type ModeledCumulativeOutput,
} from './cumulative-model'
import { validateReliabilityObservationSet, type ReliabilityObservationSet } from './measurements'
import {
  GENERATION_COST_KEY_SCHEMA,
  JUDGE_COST_KEY_SCHEMA,
  formatCostDistributionKey,
  type CostDistribution,
  type CostDistributionEntry,
  type CostDistributionKey,
} from './cost-distributions'
import {
  evaluateBudgetGate,
  type BudgetEvaluationResult,
  type BudgetGateInput,
  type ModeledBudgetComparators,
  type ObservedBudgetComparators,
} from './budget-policy'
import {
  evaluateEngineeringGate,
  type EngineeringGateInput,
  type EngineeringGateReason,
  type EngineeringGateVerdict,
} from './gate'
import {
  RELIABILITY_EXECUTION_METADATA_SCHEMA,
  RELIABILITY_NORMALIZATION_BLOCK_SCHEMA,
  RELIABILITY_NORMALIZED_EXECUTION_SCHEMA,
  normalizeExecutionMetadata,
  type ReliabilityExecutionMetadata,
  type ReliabilityNormalizationBlock,
  type ReliabilityNormalizedExecution,
} from './normalization'

type Money = CanonicalDecimal<'MONEY'>

export const RELIABILITY_SEMANTIC_PAYLOAD_SCHEMA_VERSION = 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1'
export const RELIABILITY_RAW_ENVELOPE_SCHEMA_VERSION = 'M10_E_RELIABILITY_RAW_ENVELOPE_V1'
export const RELIABILITY_NORMALIZED_ENVELOPE_SCHEMA_VERSION = 'M10_E_RELIABILITY_NORMALIZED_ENVELOPE_V1'

export const SOURCE_AUTHORITIES = ['CONTRACT_FIXTURE', 'GOVERNED_DISPOSABLE_LOCAL'] as const
export type ReliabilitySourceAuthority = (typeof SOURCE_AUTHORITIES)[number]

const CURRENCY_SCHEMA = z.string().regex(/^[A-Z]{3}$/)
const CANONICAL_PERCENTAGE_SCHEMA = z.string().regex(/^(0|[1-9][0-9]*)\.\d{6}$/)

export interface ReliabilityAuthoritiesSection {
  readonly stageCatalog: typeof M10_E_STAGE_CATALOG_V1
  readonly taskMapping: typeof M10_E_TASK_MAPPING_V1
  readonly topology: typeof M10_E_TOPOLOGY_V1
  readonly monteCarlo: typeof M10_E_MONTE_CARLO_V1
  readonly cumulativeModel: typeof M10_E_CUMULATIVE_MODEL_V1
  readonly judgePlan: JudgePlanAuthority
  readonly exchangeability: readonly ChapterStageExchangeabilityAuthority[]
  readonly independentDrawCorrelation: AssumptionAuthority
  readonly pricingSnapshotHash: string
}

export interface ReliabilityModelInputRecord {
  readonly executionProfile: ExecutionProfile
  readonly compatibleStratum: CompatibleStratumIdentity
  readonly centralStageProbabilities: readonly CentralStageProbabilityInput[]
  readonly exchangeabilityAuthorities: readonly ChapterStageExchangeabilityAuthority[]
  readonly costDistributions: Readonly<{
    currency: string
    distributions: readonly Readonly<{
      key: CostDistributionKey
      provenance: 'OBSERVED' | 'MODELED_FROM_PRICING'
      currency: string
      entries: readonly CostDistributionEntry[]
      canonicalHash: string
    }>[]
  }>
  readonly judgePlan: JudgePlanAuthority
  readonly seed: string
  readonly iterations: 100000
}

const COST_DISTRIBUTION_RECORD_SCHEMA = z.strictObject({
  key: z.union([GENERATION_COST_KEY_SCHEMA, JUDGE_COST_KEY_SCHEMA]),
  provenance: z.union([z.literal('OBSERVED'), z.literal('MODELED_FROM_PRICING')]),
  currency: CURRENCY_SCHEMA,
  entries: z.array(z.strictObject({
    provenance: z.union([z.literal('OBSERVED'), z.literal('MODELED_FROM_PRICING')]),
    cost: z.string().min(1),
    observationId: z.string().min(1).max(256),
    pricingSnapshotHash: SHA256_SCHEMA.optional(),
  })),
  canonicalHash: SHA256_SCHEMA,
})

const MODEL_INPUT_RECORD_SCHEMA = z.strictObject({
  executionProfile: EXECUTION_PROFILE_SCHEMA,
  compatibleStratum: COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  centralStageProbabilities: z.array(z.strictObject({ stageId: STAGE_ID_SCHEMA, observed: z.unknown() })),
  exchangeabilityAuthorities: z.unknown(),
  costDistributions: z.strictObject({
    currency: CURRENCY_SCHEMA,
    distributions: z.array(COST_DISTRIBUTION_RECORD_SCHEMA),
  }),
  judgePlan: z.unknown(),
  seed: z.string().min(1),
  iterations: z.literal(100000),
})

export function toCumulativeModelInput(record: ReliabilityModelInputRecord): CumulativeModelInput {
  const parsed = MODEL_INPUT_RECORD_SCHEMA.parse(record)
  return {
    executionProfile: parsed.executionProfile,
    compatibleStratum: parsed.compatibleStratum,
    centralStageProbabilities: parsed.centralStageProbabilities as unknown as CumulativeModelInput['centralStageProbabilities'],
    exchangeabilityAuthorities: parsed.exchangeabilityAuthorities as readonly ChapterStageExchangeabilityAuthority[],
    costDistributions: {
      currency: parsed.costDistributions.currency,
      distributions: new Map(parsed.costDistributions.distributions.map((distribution) => [
        formatCostDistributionKey(distribution.key),
        distribution as unknown as CostDistribution,
      ])),
    },
    judgePlan: parsed.judgePlan as JudgePlanAuthority,
    seed: parsed.seed,
    iterations: parsed.iterations,
  }
}

export interface ReliabilitySemanticPayload {
  readonly schemaVersion: typeof RELIABILITY_SEMANTIC_PAYLOAD_SCHEMA_VERSION
  readonly executionProfile: ExecutionProfile
  readonly compatibleStratum: CompatibleStratumIdentity
  readonly sourceAuthority: ReliabilitySourceAuthority
  readonly baseGitSha: string
  readonly gitDirty: boolean
  readonly e2ClosureReference: string
  readonly authorities: ReliabilityAuthoritiesSection
  readonly completeness: Readonly<{
    engineeringGate: 'PASS' | 'HOLD' | 'FAIL'
    reasonCodes: readonly P4EngineeringReason[]
    profileCompleteness: ReturnType<typeof evaluateProfileThresholds>
  }>
  readonly observations: ReliabilityObservationSet
  readonly observationHash: string
  readonly aggregate: ReturnType<typeof aggregateReliabilityObservations>
  readonly aggregateHash: string
  readonly model: Readonly<{ input: ReliabilityModelInputRecord; output: ModeledCumulativeOutput }>
  readonly observedChapterCostMeans: readonly MeasurementState<Money>[]
  readonly observedChapterMeanDenominators: readonly number[]
  readonly comparators: Readonly<{
    modeled: ModeledBudgetComparators
    observed: ObservedBudgetComparators
    observedDiagnostics: ReturnType<typeof aggregateReliabilityObservations>['observedCostDiagnostics']
  }>
  readonly budget: Readonly<{ input: BudgetGateInput; result: BudgetEvaluationResult }>
  readonly engineeringGate: Readonly<{ input: EngineeringGateInput; result: EngineeringGateVerdict }>
  readonly reasonCodes: readonly EngineeringGateReason[]
  readonly artifactSemanticHash: string
}

const SEMANTIC_PAYLOAD_SCHEMA = z.strictObject({
  schemaVersion: z.literal(RELIABILITY_SEMANTIC_PAYLOAD_SCHEMA_VERSION),
  executionProfile: EXECUTION_PROFILE_SCHEMA,
  compatibleStratum: COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  sourceAuthority: z.enum(SOURCE_AUTHORITIES),
  baseGitSha: SHA256_SCHEMA,
  gitDirty: z.boolean(),
  e2ClosureReference: SHA256_SCHEMA,
  authorities: z.unknown(),
  completeness: z.unknown(),
  observations: z.unknown(),
  observationHash: SHA256_SCHEMA,
  aggregate: z.unknown(),
  aggregateHash: SHA256_SCHEMA,
  model: z.unknown(),
  observedChapterCostMeans: z.unknown(),
  observedChapterMeanDenominators: z.unknown(),
  comparators: z.unknown(),
  budget: z.unknown(),
  engineeringGate: z.unknown(),
  reasonCodes: z.array(GATE_REASON_CODE_SCHEMA),
  artifactSemanticHash: SHA256_SCHEMA,
})

export function deriveObservedChapterCostMeans(
  observations: ReliabilityObservationSet,
): Readonly<{ means: readonly MeasurementState<Money>[]; denominators: readonly number[] }> {
  const means: MeasurementState<Money>[] = []
  const denominators: number[] = []
  for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) {
    const executions = observations.chapterExecutions.filter((item) => item.chapterNumber === chapterNumber)
    const values = executions.flatMap((item) => item.generationCost.state === 'PRESENT' ? [item.generationCost.value] : [])
    denominators.push(executions.length)
    means.push(values.length === 0
      ? missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', `Chapter ${chapterNumber} has no complete observed generation cost`)
      : presentMeasurement(decimalMean(values, 'MONEY')))
  }
  return deepFreeze({ means, denominators })
}

export function computeReliabilitySemanticHash(value: unknown): string {
  return computeSha256(stableStringify(value))
}

export function finalizeReliabilitySemanticPayload(
  payload: Omit<ReliabilitySemanticPayload, 'artifactSemanticHash'>,
): ReliabilitySemanticPayload {
  return deepFreeze({ ...payload, artifactSemanticHash: computeReliabilitySemanticHash(payload) })
}

declare const validatedReliabilitySemanticArtifactBrand: unique symbol
export type ValidatedReliabilitySemanticArtifact = ReliabilitySemanticPayload & {
  readonly [validatedReliabilitySemanticArtifactBrand]: 'VALIDATED'
}

const RAW_ENVELOPE_SCHEMA = z.strictObject({
  schemaVersion: z.literal(RELIABILITY_RAW_ENVELOPE_SCHEMA_VERSION),
  semantic: z.unknown(),
  reportHash: SHA256_SCHEMA,
  execution: RELIABILITY_EXECUTION_METADATA_SCHEMA,
})

const NORMALIZED_ENVELOPE_SCHEMA = z.strictObject({
  schemaVersion: z.literal(RELIABILITY_NORMALIZED_ENVELOPE_SCHEMA_VERSION),
  semantic: z.unknown(),
  reportHash: SHA256_SCHEMA,
  execution: RELIABILITY_NORMALIZED_EXECUTION_SCHEMA,
  normalization: RELIABILITY_NORMALIZATION_BLOCK_SCHEMA,
})

export interface ReliabilityRawEnvelope {
  readonly schemaVersion: 'M10_E_RELIABILITY_RAW_ENVELOPE_V1'
  readonly semantic: ValidatedReliabilitySemanticArtifact
  readonly reportHash: string
  readonly execution: ReliabilityExecutionMetadata
}

export interface ReliabilityNormalizedEnvelope {
  readonly schemaVersion: 'M10_E_RELIABILITY_NORMALIZED_ENVELOPE_V1'
  readonly semantic: ValidatedReliabilitySemanticArtifact
  readonly reportHash: string
  readonly execution: ReliabilityNormalizedExecution
  readonly normalization: ReliabilityNormalizationBlock
}

const MODEL_OUTPUT_CACHE = new Map<string, ModeledCumulativeOutput>()

export function recomputeModelInputHash(input: CumulativeModelInput): string {
  const payload = {
    executionProfile: input.executionProfile,
    compatibleStratum: input.compatibleStratum,
    centralStageProbabilities: [...input.centralStageProbabilities]
      .sort((left, right) => (left.stageId < right.stageId ? -1 : 1))
      .map((item) => ({
        stageId: item.stageId,
        provenance: item.observed.provenance,
        value: item.observed.value,
        observationRefs: item.observed.observationRefs,
      })),
    exchangeabilityAuthorities: input.exchangeabilityAuthorities,
    costDistributionHashes: [...input.costDistributions.distributions.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, distribution]) => ({ key, provenance: distribution.provenance, canonicalHash: distribution.canonicalHash })),
    judgePlan: input.judgePlan,
    seed: input.seed,
    iterations: input.iterations,
  }
  return computeSha256(stableStringify(payload))
}

function runModelMemoized(input: CumulativeModelInput): ModeledCumulativeOutput {
  const key = recomputeModelInputHash(input)
  const cached = MODEL_OUTPUT_CACHE.get(key)
  if (cached !== undefined) return cached
  const output = runCumulativeModel(input)
  MODEL_OUTPUT_CACHE.set(key, output)
  return output
}

export function validateReliabilitySemanticArtifact(value: unknown): ValidatedReliabilitySemanticArtifact {
  const parsed = SEMANTIC_PAYLOAD_SCHEMA.parse(value)
  validateAuthoritiesSection(parsed)
  const observations = validateReliabilityObservationSet(parsed.observations)
  assertEqualStringified(observations.executionProfile, parsed.executionProfile, 'observation execution profile')
  assertEqualStringified(observations.compatibleStratum, parsed.compatibleStratum, 'observation compatible stratum')
  assertEqual(computeSha256(stableStringify(observations)), parsed.observationHash, 'observation hash')
  const aggregate = aggregateReliabilityObservations(observations)
  assertEqualStringified(aggregate, parsed.aggregate, 'aggregate')
  assertEqual(computeSha256(stableStringify(aggregate)), parsed.aggregateHash, 'aggregate hash')
  const model = parsed.model as Readonly<{ input: ReliabilityModelInputRecord; output: ModeledCumulativeOutput }>
  const authorities = parsed.authorities as ReliabilityAuthoritiesSection
  assertEqualStringified(model.input.executionProfile, parsed.executionProfile, 'model execution profile')
  assertEqualStringified(model.input.compatibleStratum, parsed.compatibleStratum, 'model compatible stratum')
  assertEqualStringified(model.input.exchangeabilityAuthorities, authorities.exchangeability, 'model exchangeability authorities')
  assertEqualStringified(model.input.judgePlan, authorities.judgePlan, 'model judge plan')
  const modelInput = toCumulativeModelInput(model.input)
  assertEqual(recomputeModelInputHash(modelInput), model.output.inputHash, 'model input hash')
  const modelOutput = runModelMemoized(modelInput)
  assertEqual(modelOutput.inputHash, model.output.inputHash, 'model output input hash')
  assertEqual(modelOutput.outputHash, model.output.outputHash, 'model output hash')
  assertEqualStringified(modelOutput.result, model.output.result, 'model result')
  assertEqualStringified(modelOutput.modelAuthority, authorities.cumulativeModel, 'model authority binding')
  const observedChapters = deriveObservedChapterCostMeans(observations)
  assertEqualStringified(observedChapters.means, parsed.observedChapterCostMeans, 'observed chapter cost means')
  assertEqualStringified(observedChapters.denominators, parsed.observedChapterMeanDenominators, 'observed chapter mean denominators')
  const comparators = parsed.comparators as Readonly<{
    observed: ObservedBudgetComparators
    observedDiagnostics: unknown
    modeled: ModeledBudgetComparators
  }>
  assertEqualStringified(comparators.observed, aggregate.observedCostComparators, 'observed budget comparators')
  assertEqualStringified(comparators.observedDiagnostics, aggregate.observedCostDiagnostics, 'observed cost diagnostics')
  assertModeledComparators(comparators.modeled, modelOutput.result)
  const budget = parsed.budget as Readonly<{ input: BudgetGateInput; result: BudgetEvaluationResult }>
  assertEqualStringified(budget.input.compatibleStratum, parsed.compatibleStratum, 'budget compatible stratum')
  assertEqual(budget.input.currency, firstObservationCurrency(observations), 'budget comparator currency')
  const budgetResult = evaluateBudgetGate(budget.input)
  assertEqualStringified(budgetResult, budget.result, 'budget evaluation')
  const gate = parsed.engineeringGate as Readonly<{ input: EngineeringGateInput; result: EngineeringGateVerdict }>
  const completeness = parsed.completeness as Readonly<{
    engineeringGate: 'PASS' | 'HOLD' | 'FAIL'
    reasonCodes: readonly P4EngineeringReason[]
    profileCompleteness: unknown
  }>
  assertEqual(gate.input.executionProfile, parsed.executionProfile, 'gate execution profile')
  assertEqualStringified(gate.input.budget, budgetResult, 'gate budget binding')
  assertEqualStringified(gate.input.evidence, {
    engineeringGate: completeness.engineeringGate,
    reasonCodes: completeness.reasonCodes,
  }, 'gate evidence binding')
  const gateResult = evaluateEngineeringGate(gate.input)
  assertEqualStringified(gateResult, gate.result, 'engineering gate')
  assertEqualStringified(gateResult.reasonCodes, parsed.reasonCodes, 'gate reason codes')
  assertEqual(computeReliabilitySemanticHash(stripOwnHash(parsed)), parsed.artifactSemanticHash, 'artifact semantic hash')
  return deepFreeze(parsed) as unknown as ValidatedReliabilitySemanticArtifact
}

function stripOwnHash(value: Record<string, unknown>): unknown {
  const { artifactSemanticHash: _artifactSemanticHash, ...payload } = value
  return payload
}

function validateAuthoritiesSection(parsed: z.infer<typeof SEMANTIC_PAYLOAD_SCHEMA>): void {
  const authorities = parsed.authorities as ReliabilityAuthoritiesSection
  const stratum = parsed.compatibleStratum
  validateStageCatalogAuthority(authorities.stageCatalog)
  validateTaskMappingAuthority(authorities.taskMapping)
  validateTopologyAuthority(authorities.topology)
  validateMonteCarloAuthority(authorities.monteCarlo)
  validateCumulativeModelAuthority(authorities.cumulativeModel)
  assertVersionHashPair(stratum.stageCatalogVersion, stratum.stageCatalogHash, M10_E_STAGE_CATALOG_V1, 'Stage catalog')
  assertVersionHashPair(stratum.taskMappingVersion, stratum.taskMappingHash, M10_E_TASK_MAPPING_V1, 'Task mapping')
  assertVersionHashPair(stratum.topologyVersion, stratum.topologyHash, M10_E_TOPOLOGY_V1, 'Topology')
  assertEqual(authorities.pricingSnapshotHash, stratum.pricingSnapshotHash, 'pricing snapshot binding')
  validateJudgePlanAuthority(authorities.judgePlan, stratum.providerModelPolicyId)
  validateChapterStageExchangeabilityAuthorities(authorities.exchangeability, parsed.executionProfile, stratum)
  ASSUMPTION_AUTHORITY_SCHEMA.parse(authorities.independentDrawCorrelation)
  const expectedSource = parsed.executionProfile === 'CONTRACT_FIXTURE' ? 'CONTRACT_FIXTURE' : 'GOVERNED_DISPOSABLE_LOCAL'
  assertEqual(parsed.sourceAuthority, expectedSource, 'source authority')
}

function assertModeledComparators(modeled: ModeledBudgetComparators, result: ModeledCumulativeOutput['result']): void {
  assertEqualStringified(modeled.maxExpectedCostPerChapter, result.maxExpectedCostPerChapter, 'modeled chapter comparator')
  assertEqualStringified(modeled.maxExpectedCostPerNovel, result.successfulRunGenerationMean, 'modeled novel comparator')
  assertEqualStringified(modeled.maxJudgeEvaluationCostPerNovel, result.modeledJudgeTotal, 'modeled judge comparator')
  assertEqualStringified(modeled.combinedTotalNovelCostP95, result.combinedTotalNovelCostP95, 'modeled p95 comparator')
  if (modeled.maxRetryOverheadPercentage.state === 'PRESENT') {
    if (!CANONICAL_PERCENTAGE_SCHEMA.safeParse(modeled.maxRetryOverheadPercentage.value).success) {
      throw new Error('Modeled retry-overhead comparator must be canonical percentage scale 6')
    }
  }
}

function assertVersionHashPair(
  version: string,
  hash: string,
  expected: { authorityVersion: string; canonicalHash: string },
  label: string,
): void {
  if (version !== expected.authorityVersion || hash !== expected.canonicalHash) {
    throw new Error(`${label} version/hash pair does not match frozen V1 authority`)
  }
}

function firstObservationCurrency(observations: ReliabilityObservationSet): string {
  return observations.providerCalls[0]?.currency
    ?? observations.chapterExecutions[0]?.currency
    ?? observations.novelExecutions[0]?.currency
    ?? observations.judgeEvaluations[0]?.currency
    ?? observations.judgePlanAuthority.currency
}

export function computeReportHash(reportBytes: string): string {
  if (typeof reportBytes !== 'string') throw new TypeError('Report bytes must be a string')
  return computeSha256(reportBytes)
}

export interface ValidatedReliabilityArtifactPair {
  readonly artifactSemanticHash: string
  readonly reportHash: string
  readonly semantic: ValidatedReliabilitySemanticArtifact
  readonly raw: ReliabilityRawEnvelope
  readonly normalized: ReliabilityNormalizedEnvelope
}

export function validateReliabilityArtifactPair(input: Readonly<{
  raw: unknown
  normalized: unknown
  reportBytes: string
}>): ValidatedReliabilityArtifactPair {
  const parsedRaw = RAW_ENVELOPE_SCHEMA.parse(input.raw)
  const parsedNormalized = NORMALIZED_ENVELOPE_SCHEMA.parse(input.normalized)
  const semantic = validateReliabilitySemanticArtifact(parsedRaw.semantic)
  const normalizedSemantic = validateReliabilitySemanticArtifact(parsedNormalized.semantic)
  assertEqualStringified(semantic, normalizedSemantic, 'raw/normalized semantic artifact')
  const recomputedNormalization = normalizeExecutionMetadata(parsedRaw.execution)
  assertEqualStringified(recomputedNormalization.execution, parsedNormalized.execution, 'normalized execution metadata')
  assertEqualStringified(recomputedNormalization.normalization, parsedNormalized.normalization, 'normalization block')
  const reportHash = computeReportHash(input.reportBytes)
  assertEqual(reportHash, parsedRaw.reportHash, 'raw report hash')
  assertEqual(reportHash, parsedNormalized.reportHash, 'normalized report hash')
  return deepFreeze({
    artifactSemanticHash: semantic.artifactSemanticHash,
    reportHash,
    semantic,
    raw: parsedRaw as unknown as ReliabilityRawEnvelope,
    normalized: parsedNormalized as unknown as ReliabilityNormalizedEnvelope,
  })
}

function assertEqual(actual: string | boolean | number, expected: string | boolean | number, label: string): void {
  if (actual !== expected) throw new Error(`${label} recomputation mismatch`)
}

function assertEqualStringified(actual: unknown, expected: unknown, label: string): void {
  if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`${label} recomputation mismatch`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}