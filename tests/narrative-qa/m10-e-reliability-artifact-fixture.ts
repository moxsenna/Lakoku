import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import {
  M10_E_CUMULATIVE_MODEL_V1,
  M10_E_MONTE_CARLO_V1,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  aggregateReliabilityObservations,
  canonicalAuthorityHash,
  classifyReliabilityObservations,
  computeCostDistributionHash,
  computeReportHash,
  createChapterStageExchangeabilityAuthorities,
  createFixtureTopologyAuthority,
  createJudgePlanAuthority,
  createObservationSourceAuthority,
  createTimingSourceAuthority,
  evaluateBudgetGate,
  evaluateEngineeringGate,
  finalizeReliabilitySemanticPayload,
  generationCostKey,
  judgeCostKey,
  observedCostEntry,
  percentageOf,
  presentMeasurement,
  renderReliabilityReport,
  runCumulativeModel,
  sortCostDistributionEntries,
  toCumulativeModelInput,
  validateReliabilityArtifactPair,
  validateReliabilityObservationSet,
  validateReliabilitySemanticArtifact,
  type BudgetGateInput,
  type CanonicalDecimal,
  type ChapterStageExchangeabilityAuthority,
  type CompatibleStratumIdentity,
  type EngineeringGateInput,
  type ModeledBudgetComparators,
  type ObservedBudgetComparators,
  type ReliabilityObservationSet,
  type ReliabilitySemanticPayload,
  type ValidatedReliabilityArtifactPair,
} from '../../lib/narrative-qa/reliability'
import {
  deriveObservedChapterCostMeans,
  type ReliabilityModelInputRecord,
} from '../../lib/narrative-qa/reliability/artifacts'
import type {
  CanonicalInvariantCheckObservation,
  ChapterExecutionObservation,
  JudgeEvaluationObservation,
  LogicalGenerationUnitObservation,
  NovelExecutionObservation,
  ProviderCallObservation,
  PublicationAttemptObservation,
  RecoveryActionObservation,
  StageOutcomeObservation,
} from '../../lib/narrative-qa/reliability/measurements'

type Money = CanonicalDecimal<'MONEY'>
type Percentage = CanonicalDecimal<'PERCENTAGE'>

export const FIXTURE_CURRENCY = 'IDR'
export const FIXTURE_BASE_GIT_SHA = 'b'.repeat(64)
export const FIXTURE_DIRTY = false
export const FIXTURE_E2_CLOSURE_REFERENCE = computeSha256('914cf30f42d4e7f293df79e0d66c014331a696ba')
export const FIXTURE_SEED = 'M10_E_CONTRACT_FIXTURE_SEED_V1'
export const FIXTURE_SOURCE_AUTHORITY = 'CONTRACT_FIXTURE'

const AUTHORITY_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
const STAGE_TASK_IDS: Readonly<Record<string, 'CHAPTER_PROSE' | 'CHAPTER_STRUCTURED_OUTPUT' | 'RUNTIME_RECOVERY'>> = {
  PROSE_PRIMARY: 'CHAPTER_PROSE',
  PROSE_RETRY: 'CHAPTER_PROSE',
  PROVIDER_FALLBACK: 'CHAPTER_PROSE',
  CHECKPOINT_RECOVERY: 'RUNTIME_RECOVERY',
  STRUCTURED_OUTPUT: 'CHAPTER_STRUCTURED_OUTPUT',
  STRUCTURED_RETRY: 'CHAPTER_STRUCTURED_OUTPUT',
  OWNERSHIP: 'RUNTIME_RECOVERY',
  OWNERSHIP_RECOVERY: 'RUNTIME_RECOVERY',
  PUBLICATION: 'RUNTIME_RECOVERY',
  PUBLICATION_RECOVERY: 'RUNTIME_RECOVERY',
  POST_PUBLISH: 'RUNTIME_RECOVERY',
}
const CALL_COSTS: Readonly<Record<string, string>> = {
  PROSE_PRIMARY: '0.50000000',
  PROSE_RETRY: '0.40000000',
  PROVIDER_FALLBACK: '0.60000000',
  STRUCTURED_OUTPUT: '0.25000000',
  STRUCTURED_RETRY: '0.30000000',
}
const JUDGE_COST = '0.10000000'

interface FixtureStep {
  readonly stageId: 'PROSE_PRIMARY' | 'PROSE_RETRY' | 'PROVIDER_FALLBACK' | 'CHECKPOINT_RECOVERY' | 'STRUCTURED_OUTPUT' | 'STRUCTURED_RETRY' | 'OWNERSHIP' | 'OWNERSHIP_RECOVERY' | 'PUBLICATION' | 'PUBLICATION_RECOVERY' | 'POST_PUBLISH'
  readonly outcome: 'SUCCESS' | 'FAILURE'
  readonly providerCall: boolean
  readonly recovery?: Readonly<{
    kind: 'RETRY' | 'CHECKPOINT_RESUME' | 'OWNERSHIP_LOSS'
    checkpointObserved: boolean
    choiceRetry: boolean
    elapsedPresent: boolean
  }>
}

const UNIFORM_STEPS: readonly FixtureStep[] = [
  { stageId: 'PROSE_PRIMARY', outcome: 'FAILURE', providerCall: true },
  { stageId: 'PROSE_RETRY', outcome: 'FAILURE', providerCall: true, recovery: { kind: 'RETRY', checkpointObserved: true, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'PROVIDER_FALLBACK', outcome: 'FAILURE', providerCall: true },
  { stageId: 'CHECKPOINT_RECOVERY', outcome: 'SUCCESS', providerCall: false, recovery: { kind: 'CHECKPOINT_RESUME', checkpointObserved: true, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'STRUCTURED_OUTPUT', outcome: 'FAILURE', providerCall: true },
  { stageId: 'STRUCTURED_RETRY', outcome: 'SUCCESS', providerCall: true, recovery: { kind: 'RETRY', checkpointObserved: false, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'OWNERSHIP', outcome: 'SUCCESS', providerCall: false },
  { stageId: 'PUBLICATION', outcome: 'SUCCESS', providerCall: false },
  { stageId: 'POST_PUBLISH', outcome: 'SUCCESS', providerCall: false },
]

const CHAPTER_ONE_STEPS: readonly FixtureStep[] = [
  { stageId: 'PROSE_PRIMARY', outcome: 'FAILURE', providerCall: true },
  { stageId: 'PROSE_RETRY', outcome: 'FAILURE', providerCall: true, recovery: { kind: 'RETRY', checkpointObserved: true, choiceRetry: true, elapsedPresent: false } },
  { stageId: 'PROVIDER_FALLBACK', outcome: 'FAILURE', providerCall: true },
  { stageId: 'CHECKPOINT_RECOVERY', outcome: 'SUCCESS', providerCall: false, recovery: { kind: 'CHECKPOINT_RESUME', checkpointObserved: true, choiceRetry: false, elapsedPresent: true } },
  { stageId: 'STRUCTURED_OUTPUT', outcome: 'FAILURE', providerCall: true },
  { stageId: 'STRUCTURED_RETRY', outcome: 'SUCCESS', providerCall: true, recovery: { kind: 'RETRY', checkpointObserved: false, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'OWNERSHIP', outcome: 'FAILURE', providerCall: false },
  { stageId: 'OWNERSHIP_RECOVERY', outcome: 'SUCCESS', providerCall: false, recovery: { kind: 'OWNERSHIP_LOSS', checkpointObserved: false, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'PUBLICATION', outcome: 'FAILURE', providerCall: false },
  { stageId: 'PUBLICATION_RECOVERY', outcome: 'SUCCESS', providerCall: false, recovery: { kind: 'RETRY', checkpointObserved: false, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'POST_PUBLISH', outcome: 'SUCCESS', providerCall: false },
]

export function fixtureStratum(): CompatibleStratumIdentity {
  return {
    retryFallbackPolicyId: 'retry_v1',
    retryFallbackPolicyHash: 'a'.repeat(64),
    topologyVersion: M10_E_TOPOLOGY_V1.authorityVersion,
    topologyHash: M10_E_TOPOLOGY_V1.canonicalHash,
    stageCatalogVersion: M10_E_STAGE_CATALOG_V1.authorityVersion,
    stageCatalogHash: M10_E_STAGE_CATALOG_V1.canonicalHash,
    taskMappingVersion: M10_E_TASK_MAPPING_V1.authorityVersion,
    taskMappingHash: M10_E_TASK_MAPPING_V1.canonicalHash,
    providerModelPolicyId: 'provider_v1',
    pricingPolicyVersion: 'pricing_v1',
    pricingSnapshotHash: 'a'.repeat(64),
  }
}

function timestamp(micros: number): string {
  const totalSeconds = Math.floor(micros / 1000000)
  const fraction = String(micros % 1000000).padStart(6, '0')
  const hour = 12 + Math.floor(totalSeconds / 3600)
  const minute = Math.floor((totalSeconds % 3600) / 60)
  const second = totalSeconds % 60
  return `2026-08-15T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${fraction}Z`
}

function moneySum(values: readonly string[]): Money {
  let coefficient = BigInt(0)
  for (const value of values) coefficient += BigInt(value.replace('.', ''))
  if (coefficient === BigInt(0)) return '0.00000000' as Money
  return `${(coefficient / BigInt(100000000)).toString()}.${(coefficient % BigInt(100000000)).toString().padStart(8, '0')}` as Money
}

function cellKey(cell: { chapterNumber: number; stageId: string }): string {
  return `${String(cell.chapterNumber).padStart(2, '0')}.${cell.stageId}`
}

function sortedCells<T extends { chapterNumber: number; stageId: string }>(cells: readonly Readonly<T>[]): Readonly<T>[] {
  const seen = new Set<string>()
  const unique: Readonly<T>[] = []
  for (const cell of cells) {
    const key = cellKey(cell)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(cell)
  }
  return unique.sort((left, right) => Buffer.compare(Buffer.from(cellKey(left)), Buffer.from(cellKey(right))))
}

export function buildReliabilityObservationFixture(): ReliabilityObservationSet {
  const stratum = fixtureStratum()
  const judgePlan = createJudgePlanAuthority(stratum.providerModelPolicyId, FIXTURE_CURRENCY)
  let micros = 0
  const pair = (elapsedPresent: boolean): readonly [string, string] => {
    const start = micros + 1000000
    const end = elapsedPresent ? start + 500000 : start + 1000000
    micros = end
    return [timestamp(start), timestamp(end)]
  }
  const providerCalls: ProviderCallObservation[] = []
  const stageOutcomes: StageOutcomeObservation[] = []
  const logicalUnits: LogicalGenerationUnitObservation[] = []
  const recoveryActions: RecoveryActionObservation[] = []
  const publicationAttempts: PublicationAttemptObservation[] = []
  const invariantChecks: CanonicalInvariantCheckObservation[] = []
  const chapterExecutions: ChapterExecutionObservation[] = []
  const cells: Readonly<{ chapterNumber: number; stageId: 'PROSE_PRIMARY' | 'PROSE_RETRY' | 'PROVIDER_FALLBACK' | 'CHECKPOINT_RECOVERY' | 'STRUCTURED_OUTPUT' | 'STRUCTURED_RETRY' | 'OWNERSHIP' | 'OWNERSHIP_RECOVERY' | 'PUBLICATION' | 'PUBLICATION_RECOVERY' | 'POST_PUBLISH' }>[] = []
  let observationCounter = 0
  let callCounter = 0
  let judgeCounter = 0
  const obsId = (): string => { observationCounter += 1; return `obs_${String(observationCounter).padStart(5, '0')}` }

  for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) {
    const aliasBase = `a_${String(chapterNumber).padStart(2, '0')}`
    const chapterAlias = `ch_${aliasBase}`
    const steps = chapterNumber === 1 ? CHAPTER_ONE_STEPS : UNIFORM_STEPS
    const unitCosts: string[] = []
    let proseAttempts = 0
    let structuredAttempts = 0
    let proseTerminal: 'SUCCESS' | 'FAILURE' = 'SUCCESS'
    let structuredTerminal: 'SUCCESS' | 'FAILURE' = 'SUCCESS'
    let proseFallbackInvoked = false
    for (const step of steps) {
      const stageAlias = `st_${aliasBase}_${step.stageId.toLowerCase()}`
      cells.push({ chapterNumber, stageId: step.stageId })
      const [reached, finalized] = pair(false)
      if (step.stageId === 'PROVIDER_FALLBACK') proseFallbackInvoked = true
      let callAlias: string | null = null
      if (step.providerCall) {
        callCounter += 1
        callAlias = `call_${String(callCounter).padStart(4, '0')}`
        const prose = step.stageId === 'PROSE_PRIMARY' || step.stageId === 'PROSE_RETRY' || step.stageId === 'PROVIDER_FALLBACK'
        if (prose) {
          proseAttempts += 1
          proseTerminal = step.outcome
        } else {
          structuredAttempts += 1
          structuredTerminal = step.outcome
        }
        const attemptNumber = step.stageId === 'PROSE_PRIMARY' || step.stageId === 'STRUCTURED_OUTPUT' ? 1
          : step.stageId === 'PROSE_RETRY' || step.stageId === 'STRUCTURED_RETRY' ? 2 : 3
        providerCalls.push({
          observationId: obsId(),
          sourceRef: 'fixture.telemetry',
          storyAlias: 'fixture_story',
          novelExecutionAlias: 'fixture_novel_a',
          chapterExecutionAlias: chapterAlias,
          chapterNumber,
          callAlias,
          stageExecutionAlias: stageAlias,
          logicalUnitAlias: `unit_${aliasBase}_${prose ? 'prose' : 'structured'}`,
          generationKind: 'CHAPTER',
          taskId: STAGE_TASK_IDS[step.stageId]!,
          stageId: step.stageId,
          attemptNumber,
          fallbackIndex: step.stageId === 'PROVIDER_FALLBACK' ? 1 : 0,
          providerModelPolicyId: stratum.providerModelPolicyId,
          outcome: step.outcome,
          safeErrorCode: step.outcome === 'FAILURE' ? 'provider_transient_error' : null,
          inputTokens: { state: 'PRESENT', value: 100 },
          outputTokens: { state: 'PRESENT', value: 250 },
          totalTokens: { state: 'PRESENT', value: 350 },
          actualCost: { state: 'PRESENT', value: CALL_COSTS[step.stageId]! as Money },
          estimatedCost: { state: 'PRESENT', value: CALL_COSTS[step.stageId]! as Money },
          currency: FIXTURE_CURRENCY,
          actualCostSource: 'PROVIDER_REPORTED',
          pricingSnapshotHash: stratum.pricingSnapshotHash,
          startedAt: reached,
          endedAt: finalized,
          elapsedMilliseconds: { state: 'MISSING', reasonCode: 'TELEMETRY_UNAVAILABLE', detail: 'Elapsed excluded from fixture call coverage' },
        })
      }
      stageOutcomes.push({
        observationId: obsId(),
        sourceRef: 'fixture.telemetry',
        storyAlias: 'fixture_story',
        novelExecutionAlias: 'fixture_novel_a',
        chapterExecutionAlias: chapterAlias,
        chapterNumber,
        stageExecutionAlias: stageAlias,
        stageId: step.stageId,
        taskId: STAGE_TASK_IDS[step.stageId]!,
        outcome: step.outcome,
        providerCallAlias: callAlias,
        reachedAt: reached,
        finalizedAt: finalized,
      })
      if (step.recovery) {
        const [startedAt, endedAt] = pair(step.recovery.elapsedPresent)
        recoveryActions.push({
          observationId: obsId(),
          sourceRef: 'fixture.telemetry',
          storyAlias: 'fixture_story',
          novelExecutionAlias: 'fixture_novel_a',
          chapterExecutionAlias: chapterAlias,
          chapterNumber,
          recoveryAlias: `rec_${aliasBase}_${step.stageId.toLowerCase()}`,
          stageExecutionAlias: stageAlias,
          stageId: step.stageId,
          taskId: STAGE_TASK_IDS[step.stageId]!,
          recoveryKind: step.recovery.kind,
          terminalOutcome: step.outcome,
          checkpointDecisionObserved: step.recovery.checkpointObserved,
          reusedExactValidCheckpoint: false,
          choiceRetryAfterValidProseCheckpoint: step.recovery.choiceRetry,
          regeneratedProse: false,
          manualDatabaseMutation: false,
          startedAt,
          endedAt,
          elapsedMilliseconds: step.recovery.elapsedPresent
            ? { state: 'PRESENT', value: '500.000' as CanonicalDecimal<'LATENCY_MILLISECONDS'> }
            : { state: 'MISSING', reasonCode: 'TELEMETRY_UNAVAILABLE', detail: 'Elapsed excluded from fixture recovery coverage' },
        })
      }
      if (step.providerCall) unitCosts.push(CALL_COSTS[step.stageId]!)
    }
    const [proseStart, proseEnd] = pair(chapterNumber === 1)
    logicalUnits.push({
      observationId: obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      logicalUnitAlias: `unit_${aliasBase}_prose`,
      generationKind: 'CHAPTER',
      taskId: 'CHAPTER_PROSE',
      attemptCount: proseAttempts,
      terminalOutcome: proseTerminal,
      fallbackEligible: true,
      fallbackInvoked: proseFallbackInvoked,
      startedAt: proseStart,
      endedAt: proseEnd,
      elapsedMilliseconds: chapterNumber === 1
        ? { state: 'PRESENT', value: '500.000' as CanonicalDecimal<'LATENCY_MILLISECONDS'> }
        : { state: 'MISSING', reasonCode: 'TELEMETRY_UNAVAILABLE', detail: 'Elapsed excluded from fixture unit coverage' },
    })
    const [structuredStart, structuredEnd] = pair(false)
    logicalUnits.push({
      observationId: obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      logicalUnitAlias: `unit_${aliasBase}_structured`,
      generationKind: 'CHAPTER',
      taskId: 'CHAPTER_STRUCTURED_OUTPUT',
      attemptCount: structuredAttempts,
      terminalOutcome: structuredTerminal,
      fallbackEligible: false,
      fallbackInvoked: false,
      startedAt: structuredStart,
      endedAt: structuredEnd,
      elapsedMilliseconds: { state: 'MISSING', reasonCode: 'TELEMETRY_UNAVAILABLE', detail: 'Elapsed excluded from fixture unit coverage' },
    })
    publicationAttempts.push({
      observationId: obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      publicationAttemptAlias: `pub_${aliasBase}`,
      outcome: 'SUCCESS',
      producedDuplicateCanonicalPublication: false,
      attemptedAt: timestamp(micros + 1000000),
    })
    micros += 1000000
    invariantChecks.push({
      observationId: obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      invariantCheckAlias: `inv_${aliasBase}`,
      outcome: 'VALID',
      checkedAt: timestamp(micros + 1000000),
    })
    micros += 1000000
    const [chapterStart, chapterEnd] = pair(false)
    chapterExecutions.push({
      observationId: obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      terminalOutcome: 'SUCCESS',
      generationCost: { state: 'PRESENT', value: moneySum(unitCosts) },
      currency: FIXTURE_CURRENCY,
      startedAt: chapterStart,
      endedAt: chapterEnd,
    })
  }

  const [novelStart, novelEnd] = pair(false)
  const novelExecutions: NovelExecutionObservation[] = [{
    observationId: obsId(),
    sourceRef: 'fixture.telemetry',
    storyAlias: 'fixture_story',
    novelExecutionAlias: 'fixture_novel_a',
    terminalOutcome: 'SUCCESS',
    completedChapterNumbers: Array.from({ length: 50 }, (_, index) => index + 1),
    generationCost: { state: 'PRESENT', value: moneySum(providerCalls.flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])) },
    currency: FIXTURE_CURRENCY,
    startedAt: novelStart,
    endedAt: novelEnd,
  }]

  const judgeEvaluations: JudgeEvaluationObservation[] = []
  for (const evaluation of judgePlan.evaluations) {
    judgeCounter += 1
    const [startedAt, endedAt] = pair(false)
    judgeEvaluations.push({
      observationId: obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      judgeEvaluationAlias: `judge_${String(judgeCounter).padStart(3, '0')}`,
      judgeTaskId: evaluation.judgeTaskId,
      evaluationIndex: evaluation.evaluationIndex,
      providerModelPolicyId: evaluation.providerModelPolicyId,
      outcome: 'SUCCESS',
      cost: { state: 'PRESENT', value: JUDGE_COST as Money },
      currency: FIXTURE_CURRENCY,
      startedAt,
      endedAt,
    })
  }

  const applicableCells = sortedCells(cells)
  const set = {
    executionProfile: 'CONTRACT_FIXTURE' as const,
    compatibleStratum: stratum,
    exchangeabilityAuthorities: createChapterStageExchangeabilityAuthorities('CONTRACT_FIXTURE', stratum),
    observationSourceAuthority: createObservationSourceAuthority('CONTRACT_FIXTURE'),
    timingSourceAuthority: createTimingSourceAuthority(),
    fixtureTopologyAuthority: createFixtureTopologyAuthority(applicableCells),
    judgePlanAuthority: judgePlan,
    declaredApplicableCells: applicableCells,
    providerCalls,
    stageOutcomes,
    logicalGenerationUnits: logicalUnits,
    recoveryActions,
    publicationAttempts,
    canonicalInvariantChecks: invariantChecks,
    chapterExecutions,
    novelExecutions,
    judgeEvaluations,
  }
  return validateReliabilityObservationSet(set)
}

export function buildModelInputRecordFixture(observations: ReliabilityObservationSet): ReliabilityModelInputRecord {
  const aggregate = aggregateReliabilityObservations(observations)
  const record: ReliabilityModelInputRecord = {
    executionProfile: observations.executionProfile,
    compatibleStratum: observations.compatibleStratum,
    centralStageProbabilities: aggregate.centralStageFailureProbabilities.map((item) => ({
      stageId: item.stageId,
      observed: item.failureProbability,
    })),
    exchangeabilityAuthorities: observations.exchangeabilityAuthorities,
    costDistributions: {
      currency: FIXTURE_CURRENCY,
      distributions: [
        ...generationDistributionRecords(observations),
        ...judgeDistributionRecords(observations),
      ],
    },
    judgePlan: observations.judgePlanAuthority,
    seed: FIXTURE_SEED,
    iterations: 100000,
  }
  return record
}

function generationDistributionRecords(observations: ReliabilityObservationSet): ReliabilityModelInputRecord['costDistributions']['distributions'] {
  const records: Array<ReliabilityModelInputRecord['costDistributions']['distributions'][number]> = []
  const stageTaskAttempt: Readonly<Record<string, Readonly<{ taskId: 'CHAPTER_PROSE' | 'CHAPTER_STRUCTURED_OUTPUT'; attemptClass: 'PRIMARY' | 'RETRY' | 'FALLBACK' }>>> = {
    PROSE_PRIMARY: { taskId: 'CHAPTER_PROSE', attemptClass: 'PRIMARY' },
    PROSE_RETRY: { taskId: 'CHAPTER_PROSE', attemptClass: 'RETRY' },
    PROVIDER_FALLBACK: { taskId: 'CHAPTER_PROSE', attemptClass: 'FALLBACK' },
    STRUCTURED_OUTPUT: { taskId: 'CHAPTER_STRUCTURED_OUTPUT', attemptClass: 'PRIMARY' },
    STRUCTURED_RETRY: { taskId: 'CHAPTER_STRUCTURED_OUTPUT', attemptClass: 'RETRY' },
  }
  for (const stageId of ['PROSE_PRIMARY', 'PROSE_RETRY', 'PROVIDER_FALLBACK', 'STRUCTURED_OUTPUT', 'STRUCTURED_RETRY']) {
    const semantics = stageTaskAttempt[stageId]!
    for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) {
      const key = generationCostKey({
        chapterNumber,
        stageId: stageId as 'PROSE_PRIMARY',
        taskId: semantics.taskId,
        attemptClass: semantics.attemptClass,
        providerModelPolicyId: observations.compatibleStratum.providerModelPolicyId,
      })
      const entries = observations.providerCalls
        .filter((call) => call.chapterNumber === chapterNumber && call.stageId === stageId)
        .flatMap((call) => call.actualCost.state === 'PRESENT' ? [observedCostEntry(call.actualCost.value, call.observationId)] : [])
      const sorted = sortCostDistributionEntries(entries)
      records.push({
        key,
        provenance: 'OBSERVED',
        currency: FIXTURE_CURRENCY,
        entries: sorted,
        canonicalHash: computeCostDistributionHash(key, 'OBSERVED', FIXTURE_CURRENCY, sorted),
      })
    }
  }
  return records
}

function judgeDistributionRecords(observations: ReliabilityObservationSet): ReliabilityModelInputRecord['costDistributions']['distributions'] {
  const records: Array<ReliabilityModelInputRecord['costDistributions']['distributions'][number]> = []
  for (const evaluation of observations.judgePlanAuthority.evaluations) {
    const key = judgeCostKey(evaluation)
    const entries = observations.judgeEvaluations.filter(
      (judge) => judge.judgeTaskId === evaluation.judgeTaskId && judge.evaluationIndex === evaluation.evaluationIndex,
    ).flatMap((judge) => judge.cost.state === 'PRESENT' ? [observedCostEntry(judge.cost.value, judge.observationId)] : [])
    const sorted = sortCostDistributionEntries(entries)
    records.push({
      key,
      provenance: 'OBSERVED',
      currency: FIXTURE_CURRENCY,
      entries: sorted,
      canonicalHash: computeCostDistributionHash(key, 'OBSERVED', FIXTURE_CURRENCY, sorted),
    })
  }
  return records
}

function fixtureModeledRetryOverhead(): Percentage {
  return percentageOf(BigInt('6500000000'), BigInt('3750000000'))
}

export function buildSemanticPayloadFixture(): ReliabilitySemanticPayload {
  const observations = buildReliabilityObservationFixture()
  const aggregate = aggregateReliabilityObservations(observations)
  const classification = classifyReliabilityObservations(observations)
  const modelRecord = buildModelInputRecordFixture(observations)
  const modelOutput = runCumulativeModel(toCumulativeModelInput(modelRecord))
  const observedChapters = deriveObservedChapterCostMeans(observations)
  const modeledComparators: ModeledBudgetComparators = {
    maxExpectedCostPerChapter: modelOutput.result.maxExpectedCostPerChapter,
    maxExpectedCostPerNovel: modelOutput.result.successfulRunGenerationMean,
    maxJudgeEvaluationCostPerNovel: modelOutput.result.modeledJudgeTotal,
    maxRetryOverheadPercentage: presentMeasurement<Percentage>(fixtureModeledRetryOverhead()),
    combinedTotalNovelCostP95: modelOutput.result.combinedTotalNovelCostP95,
  }
  const observedComparators: ObservedBudgetComparators = aggregate.observedCostComparators
  const budgetInput: BudgetGateInput = {
    e0Authority: null,
    currency: FIXTURE_CURRENCY,
    compatibleStratum: observations.compatibleStratum,
    modeledComparators,
    observedComparators,
  }
  const budgetResult = evaluateBudgetGate(budgetInput)
  const engineeringInput: EngineeringGateInput = {
    executionProfile: observations.executionProfile,
    evidence: { engineeringGate: classification.engineeringGate, reasonCodes: classification.reasonCodes },
    modeledOutputPresent: true,
    modeledComparatorsComplete: true,
    modelRunDefect: null,
    budget: budgetResult,
    artifactPairValid: true,
    determinismVerified: true,
    e1E2ClosureRegression: false,
    requiredHumanAuthorityPresent: true,
  }
  const gateResult = evaluateEngineeringGate(engineeringInput)
  const independentDrawPayload = {
    authorityVersion: 'M10_E_INDEPENDENT_DRAW_ASSUMPTION_V1',
    decisionRef: AUTHORITY_DECISION_REF,
    rationale: 'Generation-node outcomes, chapters, generation costs, and judge cost samples use independent PRNG draws in model version 1.',
  }
  const independentDrawCorrelation = {
    ...independentDrawPayload,
    canonicalHash: canonicalAuthorityHash(independentDrawPayload),
  }
  const exchangeability = observations.exchangeabilityAuthorities as readonly ChapterStageExchangeabilityAuthority[]
  return finalizeReliabilitySemanticPayload({
    schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1',
    executionProfile: observations.executionProfile,
    compatibleStratum: observations.compatibleStratum,
    sourceAuthority: FIXTURE_SOURCE_AUTHORITY,
    baseGitSha: FIXTURE_BASE_GIT_SHA,
    gitDirty: FIXTURE_DIRTY,
    e2ClosureReference: FIXTURE_E2_CLOSURE_REFERENCE,
    authorities: {
      stageCatalog: M10_E_STAGE_CATALOG_V1,
      taskMapping: M10_E_TASK_MAPPING_V1,
      topology: M10_E_TOPOLOGY_V1,
      monteCarlo: M10_E_MONTE_CARLO_V1,
      cumulativeModel: M10_E_CUMULATIVE_MODEL_V1,
      judgePlan: observations.judgePlanAuthority,
      exchangeability,
      independentDrawCorrelation,
      pricingSnapshotHash: observations.compatibleStratum.pricingSnapshotHash,
    },
    completeness: {
      engineeringGate: classification.engineeringGate,
      reasonCodes: classification.reasonCodes.filter((code) => code !== 'MALFORMED_EVIDENCE'),
      profileCompleteness: aggregate.profileCompleteness,
    },
    observations,
    observationHash: computeSha256(stableStringify(observations)),
    aggregate,
    aggregateHash: computeSha256(stableStringify(aggregate)),
    model: { input: modelRecord, output: modelOutput },
    observedChapterCostMeans: observedChapters.means,
    observedChapterMeanDenominators: observedChapters.denominators,
    comparators: {
      modeled: modeledComparators,
      observed: observedComparators,
      observedDiagnostics: aggregate.observedCostDiagnostics,
    },
    budget: { input: budgetInput, result: budgetResult },
    engineeringGate: { input: engineeringInput, result: gateResult },
    reasonCodes: gateResult.reasonCodes,
  })
}

export function buildValidatedArtifactPairFixture(): Readonly<{
  artifact: ReturnType<typeof validateReliabilitySemanticArtifact>
  reportBytes: string
  pair: ValidatedReliabilityArtifactPair
  raw: unknown
  normalized: unknown
}> {
  const payload = buildSemanticPayloadFixture()
  const artifact = validateReliabilitySemanticArtifact(payload)
  const reportBytes = renderReliabilityReport(artifact)
  const reportHash = computeReportHash(reportBytes)
  const raw = {
    schemaVersion: 'M10_E_RELIABILITY_RAW_ENVELOPE_V1',
    semantic: payload,
    reportHash,
    execution: {
      executionInstanceId: 'run-0001',
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:01:00.000Z',
      elapsedMilliseconds: 60000,
      artifactDirectoryPath: '/tmp/m10-e-e3a-e4/run-0001',
    },
  }
  const normalized = {
    schemaVersion: 'M10_E_RELIABILITY_NORMALIZED_ENVELOPE_V1',
    semantic: payload,
    reportHash,
    execution: { executionInstanceId: 'execution-0001' },
    normalization: {
      schemaVersion: 'M10_E_NORMALIZATION_V1',
      removedOperationalFields: ['startedAt', 'finishedAt', 'elapsedMilliseconds', 'artifactDirectoryPath'],
      aliasMap: { executionInstanceId: 'execution-0001' },
    },
  }
  const pair = validateReliabilityArtifactPair({ raw, normalized, reportBytes })
  return { artifact, reportBytes, pair, raw, normalized }
}

export function rawEnvelopeForMutation(pair: Readonly<{ raw: unknown }>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(pair.raw)) as Record<string, unknown>
}