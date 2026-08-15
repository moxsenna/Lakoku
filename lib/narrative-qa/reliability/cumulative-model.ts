import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  CHAPTER_SEQUENCE,
  COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  STAGE_IDS,
  missingMeasurement,
  presentMeasurement,
  type AttemptClass,
  type CompatibleStratumIdentity,
  type ExecutionProfile,
  type MeasurementState,
  type ObservedValue,
  type StageId,
  type TaskId,
} from './contracts'
import {
  M10_E_CUMULATIVE_MODEL_V1,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  validateChapterStageExchangeabilityAuthorities,
  type ChapterStageExchangeabilityAuthority,
  type JudgePlanAuthority,
} from './authorities'
import {
  decimalMean,
  failureProbabilityThreshold,
  percentileCont,
  ratioOf,
  type CanonicalDecimal,
} from './decimal'
import { getStageSemantics, getStageTransition } from './topology'
import { createXoshiro128StarStar, seedXoshiro128StarStar, type Xoshiro128StarStarRun } from './seeded-rng'
import {
  formatCostDistributionKey,
  getAllGenerationCostKeys,
  getAllJudgeCostKeys,
  type CostDistribution,
  type GenerationProviderStage,
} from './cost-distributions'

type Money = CanonicalDecimal<'MONEY'>
type Probability = CanonicalDecimal<'PROBABILITY'>

const MONEY_SCALE = BigInt(100000000)
const EXPECTED_COUNT_SCALE = BigInt(1000000)

declare const expectedCountBrand: unique symbol
export type ExpectedCount = string & { readonly [expectedCountBrand]: 'M10_E_EXPECTED_COUNT_SCALE_6' }

export interface CentralStageProbabilityInput {
  readonly stageId: StageId
  readonly observed: ObservedValue<Probability>
}

export interface ModelCostDistributionSet {
  readonly currency: string
  readonly distributions: ReadonlyMap<string, CostDistribution>
}

export interface CumulativeModelInput {
  readonly executionProfile: ExecutionProfile
  readonly compatibleStratum: CompatibleStratumIdentity
  readonly centralStageProbabilities: readonly CentralStageProbabilityInput[]
  readonly exchangeabilityAuthorities: readonly ChapterStageExchangeabilityAuthority[]
  readonly costDistributions: ModelCostDistributionSet
  readonly judgePlan: JudgePlanAuthority
  readonly seed: string
  readonly iterations: number
}

export interface IterationResult {
  readonly completed: boolean
  readonly outcomeDrawCount: number
  readonly costDrawCount: number
  readonly judgeCostDrawCount: number
  readonly generationProviderCallCount: number
  readonly judgeProviderCallCount: number
  readonly retryCount: number
  readonly chapterSpendCoefficients: readonly bigint[]
  readonly chapterReachedFlags: readonly boolean[]
  readonly iterationSpendCoefficient: bigint
  readonly successfulGenerationCostCoefficient: bigint | null
  readonly judgeTotalCoefficient: bigint | null
}

export interface CumulativeModelResult {
  readonly executionProfile: ExecutionProfile
  readonly compatibleStratum: CompatibleStratumIdentity
  readonly modelVersion: string
  readonly iterations: number
  readonly seed: string
  readonly completionProbability: Probability
  readonly completionCount: number
  readonly terminalFailureProbability: Probability
  readonly terminalFailureCount: number
  readonly expectedRetryCount: ExpectedCount
  readonly expectedGenerationProviderCallCount: ExpectedCount
  readonly expectedJudgeProviderCallCount: ExpectedCount
  readonly expectedTotalProviderCallCount: ExpectedCount
  readonly totalOutcomeDrawCount: number
  readonly totalCostDrawCount: number
  readonly totalJudgeCostDrawCount: number
  readonly chapterMeans: readonly MeasurementState<Money>[]
  readonly chapterMeanDenominators: readonly number[]
  readonly chapterCostP50: readonly MeasurementState<Money>[]
  readonly chapterCostP95: readonly MeasurementState<Money>[]
  readonly maxExpectedCostPerChapter: MeasurementState<Money>
  readonly successfulRunGenerationMean: MeasurementState<Money>
  readonly successfulRunCount: number
  readonly startedAttemptGenerationSpendDiagnostic: Money
  readonly startedAttemptCount: number
  readonly modeledJudgeTotal: MeasurementState<Money>
  readonly generationCostP50: MeasurementState<Money>
  readonly generationCostP95: MeasurementState<Money>
  readonly combinedTotalNovelCostP50: MeasurementState<Money>
  readonly combinedTotalNovelCostP95: MeasurementState<Money>
}

export interface ModeledCumulativeOutput {
  readonly provenance: 'MODELED'
  readonly result: CumulativeModelResult
  readonly modelAuthority: typeof M10_E_CUMULATIVE_MODEL_V1
  readonly inputHash: string
  readonly outputHash: string
}

interface CostSampler {
  readonly size: number
  readonly coefficients: readonly bigint[]
}

interface PreparedStage {
  readonly providerApplicable: boolean
  readonly taskId: TaskId
  readonly attemptClass: AttemptClass | null
  readonly retryIncrement: boolean
}

interface PreparedTransition {
  readonly chapterEffect: 'CONTINUE' | 'TERMINAL_FAILURE' | 'CHAPTER_COMPLETE'
  readonly nextStageId: StageId | null
}

interface PreparedModel {
  readonly thresholds: ReadonlyMap<StageId, bigint>
  readonly stages: ReadonlyMap<StageId, PreparedStage>
  readonly transitions: ReadonlyMap<StageId, Readonly<{ SUCCESS: PreparedTransition; FAILURE: PreparedTransition }>>
  readonly generationSamplers: ReadonlyMap<StageId, readonly CostSampler[]>
  readonly judgeSamplers: readonly CostSampler[]
  readonly judgePlan: JudgePlanAuthority
}

function buildCostSampler(distribution: CostDistribution): CostSampler {
  if (distribution.entries.length === 0) throw new Error('Cost sampler requires at least one entry')
  return Object.freeze({
    size: distribution.entries.length,
    coefficients: Object.freeze(distribution.entries.map((entry) => moneyCoefficient(entry.cost))),
  })
}

function sampleCostCoefficient(sampler: CostSampler, rng: Xoshiro128StarStarRun): bigint {
  const index = Number((BigInt(rng.nextWord()) * BigInt(sampler.size)) >> BigInt(32))
  return sampler.coefficients[index]!
}

export function prepareModel(input: CumulativeModelInput): PreparedModel {
  const thresholds = new Map<StageId, bigint>()
  for (const item of input.centralStageProbabilities) {
    if (item.observed.value.state !== 'PRESENT') throw new Error(`Central probability for ${item.stageId} is not present`)
    thresholds.set(item.stageId, failureProbabilityThreshold(item.observed.value.value))
  }
  const stages = new Map<StageId, PreparedStage>()
  const transitions = new Map<StageId, Readonly<{ SUCCESS: PreparedTransition; FAILURE: PreparedTransition }>>()
  for (const stageId of STAGE_IDS) {
    const semantics = getStageSemantics(stageId)
    const stageTransition = (outcome: 'SUCCESS' | 'FAILURE'): PreparedTransition => {
      const transition = getStageTransition(stageId, outcome)
      return { chapterEffect: transition.chapterEffect, nextStageId: transition.nextStageIds[0] ?? null }
    }
    stages.set(stageId, {
      providerApplicable: semantics.providerCall.state === 'APPLICABLE',
      taskId: semantics.taskId,
      attemptClass: semantics.attemptClass,
      retryIncrement: semantics.retryCounterEffect === 'INCREMENT',
    })
    transitions.set(stageId, { SUCCESS: stageTransition('SUCCESS'), FAILURE: stageTransition('FAILURE') })
  }

  const generationSamplers = new Map<StageId, readonly CostSampler[]>()
  for (const stageId of STAGE_IDS) {
    const stage = stages.get(stageId)!
    if (!stage.providerApplicable) continue
    const samplers: CostSampler[] = []
    for (let chapterIndex = 0; chapterIndex < 50; chapterIndex += 1) {
      const key = formatCostDistributionKey({
        kind: 'GENERATION',
        chapterNumber: chapterIndex + 1,
        stageId: stageId as GenerationProviderStage,
        taskId: stage.taskId as 'CHAPTER_PROSE' | 'CHAPTER_STRUCTURED_OUTPUT',
        attemptClass: stage.attemptClass ?? 'PRIMARY',
        providerModelPolicyId: input.compatibleStratum.providerModelPolicyId,
      })
      const distribution = input.costDistributions.distributions.get(key)
      if (!distribution) throw new Error(`Missing selected distribution for ${key}`)
      samplers.push(buildCostSampler(distribution))
    }
    generationSamplers.set(stageId, samplers)
  }

  const judgeSamplers = input.judgePlan.evaluations.map((evaluation) => {
    const key = formatCostDistributionKey({
      kind: 'JUDGE',
      judgeTaskId: evaluation.judgeTaskId,
      evaluationIndex: evaluation.evaluationIndex,
      providerModelPolicyId: evaluation.providerModelPolicyId,
    })
    const distribution = input.costDistributions.distributions.get(key)
    if (!distribution) throw new Error(`Missing selected judge distribution for ${key}`)
    return buildCostSampler(distribution)
  })

  return Object.freeze({
    thresholds,
    stages,
    transitions,
    generationSamplers,
    judgeSamplers,
    judgePlan: input.judgePlan,
  })
}

export function simulateIteration(prepared: PreparedModel, rng: Xoshiro128StarStarRun): IterationResult {
  const chapterSpendCoefficients = new Array<bigint>(50).fill(BigInt(0))
  const chapterReachedFlags = new Array<boolean>(50).fill(false)
  let iterationSpendCoefficient = BigInt(0)
  let retryCount = 0
  let generationProviderCallCount = 0
  let outcomeDrawCount = 0
  let costDrawCount = 0
  let terminalFailure = false

  for (const chapterNumber of CHAPTER_SEQUENCE) {
    if (terminalFailure) break
    chapterReachedFlags[chapterNumber - 1] = true
    let stageId: StageId = 'PROSE_PRIMARY'
    let chapterComplete = false
    while (!chapterComplete && !terminalFailure) {
      const stage = prepared.stages.get(stageId)!
      const threshold = prepared.thresholds.get(stageId)
      if (threshold === undefined) throw new Error(`Missing central threshold for stage ${stageId}`)
      const word = rng.nextWord()
      outcomeDrawCount += 1
      const fails = word < threshold
      if (stage.providerApplicable) {
        const samplers = prepared.generationSamplers.get(stageId)!
        const cost = sampleCostCoefficient(samplers[chapterNumber - 1]!, rng)
        costDrawCount += 1
        generationProviderCallCount += 1
        iterationSpendCoefficient += cost
        chapterSpendCoefficients[chapterNumber - 1] = chapterSpendCoefficients[chapterNumber - 1] + cost
      }
      if (stage.retryIncrement) retryCount += 1
      const transition: Readonly<{ SUCCESS: PreparedTransition; FAILURE: PreparedTransition }> = prepared.transitions.get(stageId)!
      const chosen: PreparedTransition = fails ? transition.FAILURE : transition.SUCCESS
      if (chosen.chapterEffect === 'TERMINAL_FAILURE') {
        terminalFailure = true
        break
      }
      if (chosen.chapterEffect === 'CHAPTER_COMPLETE') {
        chapterComplete = true
        break
      }
      if (chosen.nextStageId === null) throw new Error(`Topology transition without next stage for ${stageId}`)
      stageId = chosen.nextStageId
    }
  }

  let completed = false
  let successfulGenerationCostCoefficient: bigint | null = null
  let judgeTotalCoefficient: bigint | null = null
  let judgeCostDrawCount = 0
  let judgeProviderCallCount = 0
  if (!terminalFailure) {
    completed = true
    successfulGenerationCostCoefficient = iterationSpendCoefficient
    let judgeTotal = BigInt(0)
    for (const sampler of prepared.judgeSamplers) {
      judgeTotal += sampleCostCoefficient(sampler, rng)
      judgeCostDrawCount += 1
      judgeProviderCallCount += 1
    }
    judgeTotalCoefficient = judgeTotal
  }

  return Object.freeze({
    completed,
    outcomeDrawCount,
    costDrawCount,
    judgeCostDrawCount,
    generationProviderCallCount,
    judgeProviderCallCount,
    retryCount,
    chapterSpendCoefficients,
    chapterReachedFlags,
    iterationSpendCoefficient,
    successfulGenerationCostCoefficient,
    judgeTotalCoefficient,
  })
}

function validateCumulativeModelInput(input: CumulativeModelInput): void {
  z.strictObject({
    executionProfile: z.enum(['CONTRACT_FIXTURE', 'RELEASE_EVIDENCE']),
    compatibleStratum: COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
    seed: z.string().min(1),
    iterations: z.literal(100000),
  }).parse({
    executionProfile: input.executionProfile,
    compatibleStratum: input.compatibleStratum,
    seed: input.seed,
    iterations: input.iterations,
  })
  if (input.compatibleStratum.stageCatalogHash !== M10_E_STAGE_CATALOG_V1.canonicalHash
    || input.compatibleStratum.stageCatalogVersion !== M10_E_STAGE_CATALOG_V1.authorityVersion) {
    throw new Error('Stratum stage catalog identity does not match frozen V1 authority')
  }
  if (input.compatibleStratum.taskMappingHash !== M10_E_TASK_MAPPING_V1.canonicalHash
    || input.compatibleStratum.taskMappingVersion !== M10_E_TASK_MAPPING_V1.authorityVersion) {
    throw new Error('Stratum task mapping identity does not match frozen V1 authority')
  }
  if (input.compatibleStratum.topologyHash !== M10_E_TOPOLOGY_V1.canonicalHash
    || input.compatibleStratum.topologyVersion !== M10_E_TOPOLOGY_V1.authorityVersion) {
    throw new Error('Stratum topology identity does not match frozen V1 authority')
  }
  validateChapterStageExchangeabilityAuthorities(
    input.exchangeabilityAuthorities,
    input.executionProfile,
    input.compatibleStratum,
  )
  if (input.centralStageProbabilities.length !== STAGE_IDS.length) {
    throw new Error('Central model requires exactly one observed stage probability per stage')
  }
  const probabilityStageIds = new Set<string>()
  for (const item of input.centralStageProbabilities) {
    if (probabilityStageIds.has(item.stageId)) throw new Error(`Duplicate central probability for stage ${item.stageId}`)
    probabilityStageIds.add(item.stageId)
    if (!STAGE_IDS.includes(item.stageId)) throw new Error(`Unknown stage in central probability: ${item.stageId}`)
    if (item.observed.provenance !== 'OBSERVED') {
      throw new Error(`Central probability for ${item.stageId} must be OBSERVED, assumed central probabilities are forbidden`)
    }
    if (item.observed.value.state !== 'PRESENT') {
      throw new Error(`Central probability for ${item.stageId} must be PRESENT, missing pools cannot populate the model`)
    }
  }
  const requiredGenerationKeys = getAllGenerationCostKeys(input.compatibleStratum.providerModelPolicyId)
  const requiredJudgeKeys = getAllJudgeCostKeys(input.compatibleStratum.providerModelPolicyId)
  const providedKeys = new Set(input.costDistributions.distributions.keys())
  for (const key of requiredGenerationKeys) {
    if (!providedKeys.has(formatCostDistributionKey(key))) {
      throw new Error(`Missing generation cost distribution for ${formatCostDistributionKey(key)}`)
    }
  }
  for (const key of requiredJudgeKeys) {
    if (!providedKeys.has(formatCostDistributionKey(key))) {
      throw new Error(`Missing judge cost distribution for ${formatCostDistributionKey(key)}`)
    }
  }
  for (const distribution of input.costDistributions.distributions.values()) {
    if (distribution.currency !== input.costDistributions.currency) {
      throw new Error(`Cost distribution currency mismatch: ${distribution.currency}`)
    }
    if (distribution.entries.length === 0) throw new Error('Cost distribution must not be empty')
    if (distribution.provenance !== 'OBSERVED') {
      throw new Error('Model requires selected OBSERVED cost distributions; pricing fallback must be selected before model input')
    }
  }
  if (input.judgePlan.currency !== input.costDistributions.currency) {
    throw new Error('Judge plan currency must match cost distribution currency')
  }
}

export function runCumulativeModel(input: CumulativeModelInput): ModeledCumulativeOutput {
  validateCumulativeModelInput(input)
  const prepared = prepareModel(input)
  const rng = createXoshiro128StarStar(seedXoshiro128StarStar(input.seed))

  let completionCount = 0
  let terminalFailureCount = 0
  let retryTotal = 0
  let generationProviderCallTotal = 0
  let judgeProviderCallTotal = 0
  let outcomeDrawTotal = 0
  let costDrawTotal = 0
  let judgeCostDrawTotal = 0
  const chapterSpendSums = new Array<bigint>(50).fill(BigInt(0))
  const chapterReachedCounts = new Array<number>(50).fill(0)
  const chapterValueCoefficients: bigint[][] = Array.from({ length: 50 }, () => [])
  const successfulGenerationCosts: bigint[] = []
  const startedAttemptSpends: bigint[] = []
  const judgeTotals: bigint[] = []
  const combinedTotals: bigint[] = []

  for (let iterationIndex = 0; iterationIndex < input.iterations; iterationIndex += 1) {
    const result = simulateIteration(prepared, rng)
    startedAttemptSpends.push(result.iterationSpendCoefficient)
    retryTotal += result.retryCount
    generationProviderCallTotal += result.generationProviderCallCount
    judgeProviderCallTotal += result.judgeProviderCallCount
    outcomeDrawTotal += result.outcomeDrawCount
    costDrawTotal += result.costDrawCount
    judgeCostDrawTotal += result.judgeCostDrawCount
    if (result.completed) {
      completionCount += 1
      if (result.successfulGenerationCostCoefficient !== null) successfulGenerationCosts.push(result.successfulGenerationCostCoefficient)
      if (result.judgeTotalCoefficient !== null) {
        judgeTotals.push(result.judgeTotalCoefficient)
        combinedTotals.push(result.successfulGenerationCostCoefficient! + result.judgeTotalCoefficient)
      }
    } else {
      terminalFailureCount += 1
    }
    for (let chapterIndex = 0; chapterIndex < 50; chapterIndex += 1) {
      if (!result.chapterReachedFlags[chapterIndex]) continue
      chapterSpendSums[chapterIndex] = chapterSpendSums[chapterIndex] + result.chapterSpendCoefficients[chapterIndex]
      chapterReachedCounts[chapterIndex] += 1
      chapterValueCoefficients[chapterIndex].push(result.chapterSpendCoefficients[chapterIndex])
    }
  }

  const chapterMeans: MeasurementState<Money>[] = []
  const chapterCostP50: MeasurementState<Money>[] = []
  const chapterCostP95: MeasurementState<Money>[] = []
  for (let chapterIndex = 0; chapterIndex < 50; chapterIndex += 1) {
    const values = chapterValueCoefficients[chapterIndex].map(coefficientToMoney)
    if (values.length === 0) {
      const missing = missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', `Chapter ${chapterIndex + 1} was never reached`)
      chapterMeans.push(missing)
      chapterCostP50.push(missing)
      chapterCostP95.push(missing)
      continue
    }
    chapterMeans.push(presentMeasurement(decimalMean(values, 'MONEY')))
    chapterCostP50.push(percentileCont(values, '0.50', 'MONEY'))
    chapterCostP95.push(percentileCont(values, '0.95', 'MONEY'))
  }
  const maxExpectedCostPerChapter = maxMoney(chapterMeans)

  const successfulRunCount = completionCount
  const successfulRunGenerationMean = successfulRunCount === 0
    ? missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', 'Successful-run generation mean requires at least one successful run')
    : presentMeasurement(decimalMean(successfulGenerationCosts.map(coefficientToMoney), 'MONEY'))
  const startedAttemptGenerationSpendDiagnostic = decimalMean(startedAttemptSpends.map(coefficientToMoney), 'MONEY')
  const modeledJudgeTotal = judgeTotals.length === 0
    ? missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', 'Modeled judge total requires at least one successful run')
    : presentMeasurement(decimalMean(judgeTotals.map(coefficientToMoney), 'MONEY'))

  const result: CumulativeModelResult = Object.freeze({
    executionProfile: input.executionProfile,
    compatibleStratum: input.compatibleStratum,
    modelVersion: M10_E_CUMULATIVE_MODEL_V1.modelVersion,
    iterations: input.iterations,
    seed: input.seed,
    completionProbability: ratioOf(BigInt(completionCount), BigInt(input.iterations)),
    completionCount,
    terminalFailureProbability: ratioOf(BigInt(terminalFailureCount), BigInt(input.iterations)),
    terminalFailureCount,
    expectedRetryCount: expectedCount(retryTotal, input.iterations),
    expectedGenerationProviderCallCount: expectedCount(generationProviderCallTotal, input.iterations),
    expectedJudgeProviderCallCount: expectedCount(judgeProviderCallTotal, input.iterations),
    expectedTotalProviderCallCount: expectedCount(generationProviderCallTotal + judgeProviderCallTotal, input.iterations),
    totalOutcomeDrawCount: outcomeDrawTotal,
    totalCostDrawCount: costDrawTotal,
    totalJudgeCostDrawCount: judgeCostDrawTotal,
    chapterMeans,
    chapterMeanDenominators: chapterReachedCounts,
    chapterCostP50,
    chapterCostP95,
    maxExpectedCostPerChapter,
    successfulRunGenerationMean,
    successfulRunCount,
    startedAttemptGenerationSpendDiagnostic,
    startedAttemptCount: input.iterations,
    modeledJudgeTotal,
    generationCostP50: percentileCont(successfulGenerationCosts.map(coefficientToMoney), '0.50', 'MONEY'),
    generationCostP95: percentileCont(successfulGenerationCosts.map(coefficientToMoney), '0.95', 'MONEY'),
    combinedTotalNovelCostP50: percentileCont(combinedTotals.map(coefficientToMoney), '0.50', 'MONEY'),
    combinedTotalNovelCostP95: percentileCont(combinedTotals.map(coefficientToMoney), '0.95', 'MONEY'),
  })
  const outputHash = computeSha256(stableStringify(result))
  return Object.freeze({
    provenance: 'MODELED' as const,
    result,
    modelAuthority: M10_E_CUMULATIVE_MODEL_V1,
    inputHash: computeInputHash(input),
    outputHash,
  })
}

function computeInputHash(input: CumulativeModelInput): string {
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

function moneyCoefficient(value: Money): bigint {
  const [whole, fraction = ''] = value.split('.')
  const coefficient = BigInt(whole + fraction.padEnd(8, '0'))
  if (coefficient < BigInt(0)) throw new RangeError('Money coefficient must be nonnegative')
  return coefficient
}

function coefficientToMoney(coefficient: bigint): Money {
  if (coefficient < BigInt(0)) throw new RangeError('Money coefficient must be nonnegative')
  const whole = coefficient / MONEY_SCALE
  const fraction = (coefficient % MONEY_SCALE).toString().padStart(8, '0')
  return `${whole.toString()}.${fraction}` as Money
}

function maxMoney(values: readonly MeasurementState<Money>[]): MeasurementState<Money> {
  const presentValues = values.flatMap((value) => value.state === 'PRESENT' ? [value.value] : [])
  if (presentValues.length === 0) {
    return missingMeasurement<Money>('OBSERVATION_COVERAGE_INCOMPLETE', 'Max expected cost requires at least one reached chapter')
  }
  let maximum = presentValues[0]!
  for (const value of presentValues.slice(1)) {
    if (compareMoneyV(value, maximum) > 0) maximum = value
  }
  return presentMeasurement(maximum)
}

function compareMoneyV(left: Money, right: Money): number {
  const leftCoefficient = moneyCoefficient(left)
  const rightCoefficient = moneyCoefficient(right)
  if (leftCoefficient < rightCoefficient) return -1
  if (leftCoefficient > rightCoefficient) return 1
  return 0
}

function expectedCount(numerator: number, denominator: number): ExpectedCount {
  if (denominator === 0) throw new RangeError('Expected count requires a nonzero denominator')
  const numeratorCoefficient = BigInt(numerator) * EXPECTED_COUNT_SCALE
  const quotient = numeratorCoefficient / BigInt(denominator)
  const remainder = numeratorCoefficient % BigInt(denominator)
  const rounded = remainder * BigInt(2) >= BigInt(denominator) ? quotient + BigInt(1) : quotient
  const whole = rounded / EXPECTED_COUNT_SCALE
  const fraction = (rounded % EXPECTED_COUNT_SCALE).toString().padStart(6, '0')
  return `${whole.toString()}.${fraction}` as ExpectedCount
}