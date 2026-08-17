/**
 * M10-E E3A/E4 governed contract fixture.
 *
 * Deterministic, synthetic, sanitized: one compatible policy/provider-model/
 * pricing/topology stratum with all 11 stage pools reached, every declared
 * (chapter, stage) cell applicable, complete reliability metric surfaces,
 * separate actual and pricing-derived cost coverage, all 250 generation
 * distribution keys, the complete ordered judge plan, 11 exchangeability
 * authorities, independent-draw and deterministic-judge assumptions, a
 * successful 50-chapter novel, and a terminally failed started-attempt
 * sample (for R1 conditioning). No user ID, production ID, prose/title,
 * prompt/response, URL, credential, or real provider claim.
 *
 * The E0 budget authority is explicitly absent; budget evaluation stays
 * BLOCKED_E0_COST_CEILING_NOT_APPROVED.
 */
import { computeSha256, stableStringify } from '../../lib/narrative-qa/scoring/canonical-serializer'
import {
  M10_E_CUMULATIVE_MODEL_V1,
  M10_E_MONTE_CARLO_V1,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  aggregateReliabilityObservations,
  assumedValue,
  canonicalAuthorityHash,
  classifyReliabilityObservations,
  computeCostDistributionHash,
  computeReportHash,
  createChapterStageExchangeabilityAuthorities,
  createFixtureTopologyAuthority,
  createJudgePlanAuthority,
  createObservationSourceAuthority,
  createPricingSnapshot,
  createTimingSourceAuthority,
  evaluateBudgetGate,
  evaluateEngineeringGate,
  finalizeReliabilitySemanticPayload,
  generationCostKey,
  judgeCostKey,
  multiplyDecimals,
  observedCostEntry,
  renderReliabilityReport,
  runCumulativeModel,
  sortCostDistributionEntries,
  STAGE_IDS,
  subtractDecimals,
  toCumulativeModelInput,
  validateReliabilityArtifactPair,
  validateReliabilityObservationSet,
  validateReliabilitySemanticArtifact,
  type AssumedValue,
  type AssumptionAuthority,
  type BudgetGateInput,
  type CanonicalDecimal,
  type ChapterStageExchangeabilityAuthority,
  type CompatibleStratumIdentity,
  type EngineeringGateInput,
  type EngineeringGateVerdict,
  type ModeledBudgetComparators,
  type ObservedBudgetComparators,
  type PricingSnapshot,
  type ReliabilityObservationSet,
  type ReliabilitySemanticPayload,
  type SensitivityProbabilityInput,
  type ValidatedReliabilityArtifactPair,
} from '../../lib/narrative-qa/reliability'
import { convertDecimal } from '../../lib/narrative-qa/reliability/decimal'
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
type Probability = CanonicalDecimal<'PROBABILITY'>

export const FIXTURE_CURRENCY = 'IDR'
export const FIXTURE_BASE_GIT_SHA = 'b'.repeat(40)
export const FIXTURE_DIRTY = false
export const FIXTURE_SPEC_SHA = 'af28b45dcd62544f12415476aa62bd3a09fd8f7e'
export const FIXTURE_E2_CLOSURE_SHA = '914cf30f42d4e7f293df79e0d66c014331a696ba'
export const FIXTURE_E2_CLOSURE_REFERENCE = FIXTURE_E2_CLOSURE_SHA
export const FIXTURE_SEED = 'M10_E_CONTRACT_FIXTURE_SEED_V1'
export const FIXTURE_SOURCE_AUTHORITY = 'CONTRACT_FIXTURE'
export const FIXTURE_E0_AUTHORITY = null
export const FIXTURE_GENERATION_DISTRIBUTION_KEY_COUNT = 250
export const FIXTURE_STAGE_POOL_COUNT = 11
/** Independent expected applicable-cell count for the counted evidence block; equality with the derived value is asserted by the fixture test. */
export const FIXTURE_DECLARED_APPLICABLE_CELL_COUNT = 452

export const CONTRACT_PRICING_SNAPSHOT_PARAMS = {
  pricingPolicyVersion: 'pricing_v1',
  providerId: 'provider_v1',
  exactModelId: 'fixture_model_v1',
  currency: FIXTURE_CURRENCY,
  inputPricePerUnit: '0.00000100',
  outputPricePerUnit: '0.00000200',
  unitSize: 1000 as const,
  effectiveFrom: '2026-08-15T00:00:00.000Z',
  effectiveTo: null,
} as const

export function contractPricingSnapshot(): PricingSnapshot {
  return createPricingSnapshot(CONTRACT_PRICING_SNAPSHOT_PARAMS)
}

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

// Terminally failed started-attempt sample: PROSE_PRIMARY FAILURE leads to
// PROSE_RETRY FAILURE then PROVIDER_FALLBACK FAILURE then CHECKPOINT_RECOVERY
// FAILURE, whose frozen transition terminates the chapter with TERMINAL_FAILURE.
const FAILED_NOVEL_STEPS: readonly FixtureStep[] = [
  { stageId: 'PROSE_PRIMARY', outcome: 'FAILURE', providerCall: true },
  { stageId: 'PROSE_RETRY', outcome: 'FAILURE', providerCall: true, recovery: { kind: 'RETRY', checkpointObserved: true, choiceRetry: false, elapsedPresent: false } },
  { stageId: 'PROVIDER_FALLBACK', outcome: 'FAILURE', providerCall: true },
  { stageId: 'CHECKPOINT_RECOVERY', outcome: 'FAILURE', providerCall: false, recovery: { kind: 'CHECKPOINT_RESUME', checkpointObserved: true, choiceRetry: false, elapsedPresent: false } },
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
    pricingSnapshotHash: contractPricingSnapshot().canonicalHash,
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

export function fixtureApplicableCellCount(observations: ReliabilityObservationSet): number {
  return observations.declaredApplicableCells.length
}

export function expectedJudgeDistributionKeyCount(observations: ReliabilityObservationSet): number {
  return observations.judgePlanAuthority.evaluations.length
}

function buildChapterObservationBundle(
  chapterNumber: number,
  chapterAlias: string,
  aliasBase: string,
  novelAlias: 'fixture_novel_a' | 'fixture_novel_b',
  steps: readonly FixtureStep[],
  stratum: CompatibleStratumIdentity,
  cells: Readonly<{ chapterNumber: number; stageId: 'PROSE_PRIMARY' | 'PROSE_RETRY' | 'PROVIDER_FALLBACK' | 'CHECKPOINT_RECOVERY' | 'STRUCTURED_OUTPUT' | 'STRUCTURED_RETRY' | 'OWNERSHIP' | 'OWNERSHIP_RECOVERY' | 'PUBLICATION' | 'PUBLICATION_RECOVERY' | 'POST_PUBLISH' }>[],
  providerCalls: ProviderCallObservation[],
  stageOutcomes: StageOutcomeObservation[],
  logicalUnits: LogicalGenerationUnitObservation[],
  recoveryActions: RecoveryActionObservation[],
  publicationAttempts: PublicationAttemptObservation[],
  invariantChecks: CanonicalInvariantCheckObservation[],
  chapterExecutions: ChapterExecutionObservation[],
  state: Readonly<{ pair: (elapsedPresent: boolean) => readonly [string, string]; after: (offset: number) => string; obsId: () => string; callCounter: () => string }>,
): void {
  const unitCosts: string[] = []
  let proseAttempts = 0
  let structuredAttempts = 0
  let proseTerminal: 'SUCCESS' | 'FAILURE' = 'SUCCESS'
  let structuredTerminal: 'SUCCESS' | 'FAILURE' = 'SUCCESS'
  let proseFallbackInvoked = false
  for (const step of steps) {
    const stageAlias = `st_${aliasBase}_${step.stageId.toLowerCase()}`
    if (novelAlias === 'fixture_novel_a') cells.push({ chapterNumber, stageId: step.stageId })
    const [reached, finalized] = pairFor(state, false)
    if (step.stageId === 'PROVIDER_FALLBACK') proseFallbackInvoked = true
    let callAlias: string | null = null
    if (step.providerCall) {
      callAlias = state.callCounter()
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
        observationId: state.obsId(),
        sourceRef: 'fixture.telemetry',
        storyAlias: 'fixture_story',
        novelExecutionAlias: novelAlias,
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
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: novelAlias,
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
      const [startedAt, endedAt] = pairFor(state, step.recovery.elapsedPresent)
      recoveryActions.push({
        observationId: state.obsId(),
        sourceRef: 'fixture.telemetry',
        storyAlias: 'fixture_story',
        novelExecutionAlias: novelAlias,
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
  const [proseStart, proseEnd] = pairFor(state, chapterNumber === 1)
  logicalUnits.push({
    observationId: state.obsId(),
    sourceRef: 'fixture.telemetry',
    storyAlias: 'fixture_story',
    novelExecutionAlias: novelAlias,
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
  if (structuredAttempts > 0) {
    const [structuredStart, structuredEnd] = pairFor(state, false)
    logicalUnits.push({
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: novelAlias,
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
  }
if (novelAlias === 'fixture_novel_a') {
    publicationAttempts.push({
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: novelAlias,
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      publicationAttemptAlias: `pub_${aliasBase}`,
      outcome: 'SUCCESS',
      producedDuplicateCanonicalPublication: false,
      attemptedAt: timestampAfter(state),
    })
    invariantChecks.push({
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: novelAlias,
      chapterExecutionAlias: chapterAlias,
      chapterNumber,
      invariantCheckAlias: `inv_${aliasBase}`,
      outcome: 'VALID',
      checkedAt: timestampAfter(state),
    })
  }
  const [chapterStart, chapterEnd] = pairFor(state, false)
  chapterExecutions.push({
    observationId: state.obsId(),
    sourceRef: 'fixture.telemetry',
    storyAlias: 'fixture_story',
    novelExecutionAlias: novelAlias,
    chapterExecutionAlias: chapterAlias,
    chapterNumber,
    terminalOutcome: novelAlias === 'fixture_novel_a' ? 'SUCCESS' : 'FAILURE',
    generationCost: { state: 'PRESENT', value: moneySum(unitCosts) },
    currency: FIXTURE_CURRENCY,
    startedAt: chapterStart,
    endedAt: chapterEnd,
  })
}

function buildBundleState(): Readonly<{
  pair: (elapsedPresent: boolean) => readonly [string, string]
  after: (offset: number) => string
  obsId: () => string
  callCounter: () => string
  judgeCounter: () => string
}> {
  let micros = 0
  let observationCounter = 0
  let callCounter = 0
  let judgeCounter = 0
  const pair = (elapsedPresent: boolean): readonly [string, string] => {
    const start = micros + 1000000
    const end = elapsedPresent ? start + 500000 : start + 1000000
    micros = end
    return [timestamp(start), timestamp(end)]
  }
  return {
    pair,
    after: (offset: number) => {
      micros += offset
      return timestamp(micros)
    },
    obsId: () => { observationCounter += 1; return `obs_${String(observationCounter).padStart(5, '0')}` },
    callCounter: () => { callCounter += 1; return `call_${String(callCounter).padStart(4, '0')}` },
    judgeCounter: () => { judgeCounter += 1; return `judge_${String(judgeCounter).padStart(3, '0')}` },
  }
}

function pairFor(state: Readonly<{ pair: (elapsedPresent: boolean) => readonly [string, string] }>, elapsedPresent: boolean): readonly [string, string] {
  return state.pair(elapsedPresent)
}

function timestampAfter(state: Readonly<{ after: (offset: number) => string }>, offset = 1000000): string {
  return state.after(offset)
}

export function buildReliabilityObservationFixture(): ReliabilityObservationSet {
  const stratum = fixtureStratum()
  const judgePlan = createJudgePlanAuthority(stratum.providerModelPolicyId, FIXTURE_CURRENCY)
  const state = buildBundleState()
  const providerCalls: ProviderCallObservation[] = []
  const stageOutcomes: StageOutcomeObservation[] = []
  const logicalUnits: LogicalGenerationUnitObservation[] = []
  const recoveryActions: RecoveryActionObservation[] = []
  const publicationAttempts: PublicationAttemptObservation[] = []
  const invariantChecks: CanonicalInvariantCheckObservation[] = []
  const chapterExecutions: ChapterExecutionObservation[] = []
  const cells: Readonly<{ chapterNumber: number; stageId: 'PROSE_PRIMARY' | 'PROSE_RETRY' | 'PROVIDER_FALLBACK' | 'CHECKPOINT_RECOVERY' | 'STRUCTURED_OUTPUT' | 'STRUCTURED_RETRY' | 'OWNERSHIP' | 'OWNERSHIP_RECOVERY' | 'PUBLICATION' | 'PUBLICATION_RECOVERY' | 'POST_PUBLISH' }>[] = []

  for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) {
    const aliasBase = `a_${String(chapterNumber).padStart(2, '0')}`
    buildChapterObservationBundle(
      chapterNumber,
      `ch_${aliasBase}`,
      aliasBase,
      'fixture_novel_a',
      chapterNumber === 1 ? CHAPTER_ONE_STEPS : UNIFORM_STEPS,
      stratum,
      cells,
      providerCalls,
      stageOutcomes,
      logicalUnits,
      recoveryActions,
      publicationAttempts,
      invariantChecks,
      chapterExecutions,
      state,
    )
  }
  // Terminally failed started-attempt sample (novel B, chapter 1 only).
  buildChapterObservationBundle(
    1,
    'ch_b01',
    'b01',
    'fixture_novel_b',
    FAILED_NOVEL_STEPS,
    stratum,
    cells,
    providerCalls,
    stageOutcomes,
    logicalUnits,
    recoveryActions,
    publicationAttempts,
    invariantChecks,
    chapterExecutions,
    state,
  )
  const [novelStart, novelEnd] = pairFor(state, false)
  const novelExecutions: NovelExecutionObservation[] = [
    {
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      terminalOutcome: 'SUCCESS',
      completedChapterNumbers: Array.from({ length: 50 }, (_, index) => index + 1),
      generationCost: { state: 'PRESENT', value: moneySum(providerCalls.filter((call) => call.novelExecutionAlias === 'fixture_novel_a').flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])) },
      currency: FIXTURE_CURRENCY,
      startedAt: novelStart,
      endedAt: novelEnd,
    },
    {
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_b',
      terminalOutcome: 'PARTIAL_FAILURE',
      completedChapterNumbers: [1],
      generationCost: { state: 'PRESENT', value: moneySum(providerCalls.filter((call) => call.novelExecutionAlias === 'fixture_novel_b').flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])) },
      currency: FIXTURE_CURRENCY,
      startedAt: novelStart,
      endedAt: novelEnd,
    },
  ]

  const judgeEvaluations: JudgeEvaluationObservation[] = []
  for (const evaluation of judgePlan.evaluations) {
    const [startedAt, endedAt] = pairFor(state, false)
    judgeEvaluations.push({
      observationId: state.obsId(),
      sourceRef: 'fixture.telemetry',
      storyAlias: 'fixture_story',
      novelExecutionAlias: 'fixture_novel_a',
      judgeEvaluationAlias: state.judgeCounter(),
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
    sensitivity: buildSensitivityInputFixture(observations),
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

const SENSITIVITY_BAND_AUTHORITY_VERSION = 'M10_E_SENSITIVITY_BAND_AUTHORITY_V1'
const SENSITIVITY_BAND_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md §11 line 627 sensitivity bands'

/**
 * Deterministic lower/upper band inputs derived from the exact OBSERVED central
 * probabilities: lower = half of central; upper = mirror reflection
 * 1 - 0.5*(1 - central). The multiplicative construction keeps every band inside
 * [0,1] for any central including 1.0. Both bands are explicit ASSUMPTION with a
 * frozen authority each; the central band uses only the OBSERVED probabilities.
 */
export function buildSensitivityInputFixture(observations: ReliabilityObservationSet): readonly SensitivityProbabilityInput[] {
  const aggregate = aggregateReliabilityObservations(observations)
  const centralByStage = new Map(aggregate.centralStageFailureProbabilities.map((item) => [item.stageId, item.failureProbability]))
  return STAGE_IDS.map((stageId) => {
    // failureProbability is ObservedValue<MeasurementState<Probability>>; probObs.value is MeasurementState<Probability>
    const probObs = centralByStage.get(stageId)!
    const probState = probObs.value
    if (probState.state !== 'PRESENT') {
      throw new Error('Expected all stage probabilities to be PRESENT in contract fixture')
    }
    // probState.value is already CanonicalDecimal<'PROBABILITY'> from ratioOf() in aggregation, no conversion needed
    const central = probState.value as Probability
    const halfProbability = convertDecimal('0.5', 'PROBABILITY')
    const oneProbability = convertDecimal('1', 'PROBABILITY')
    const lower = multiplyDecimals(central, halfProbability, 'PROBABILITY')
    const upper = subtractDecimals(oneProbability, multiplyDecimals(subtractDecimals(oneProbability, central, 'PROBABILITY'), halfProbability, 'PROBABILITY'), 'PROBABILITY')
    return {
      stageId,
      lower: assumedValue(lower, sensitivityBandAuthority(stageId, 'lower', lower, central)),
      upper: assumedValue(upper, sensitivityBandAuthority(stageId, 'upper', upper, central)),
    }
  })
}

function sensitivityBandAuthority(stageId: string, band: 'lower' | 'upper', value: Probability, central: Probability): AssumptionAuthority {
  const payload = {
    authorityVersion: SENSITIVITY_BAND_AUTHORITY_VERSION,
    decisionRef: SENSITIVITY_BAND_DECISION_REF,
    rationale: `Sensitivity ${band} band probability for stage ${stageId}: ${value} (asumsi setengah-lipat dari pusat OBSERVED ${central}); bukan observasi.`,
  }
  return { ...payload, canonicalHash: canonicalAuthorityHash(payload) }
}

export function buildSemanticPayloadFixture(options: Readonly<{
  baseGitSha?: string
  gitDirty?: boolean
  e2ClosureReference?: string
  engineeringGate?: Readonly<{ input: EngineeringGateInput; result: EngineeringGateVerdict }>
} | undefined> = undefined): ReliabilitySemanticPayload {
  const observations = buildReliabilityObservationFixture()
  const aggregate = aggregateReliabilityObservations(observations)
  const classification = classifyReliabilityObservations(observations)
  const modelRecord = buildModelInputRecordFixture(observations)
  const modelInput = toCumulativeModelInput(modelRecord)
  const modelOutput = runCumulativeModel(modelInput)
  const determinismOutput = runCumulativeModel(modelInput)
  if (determinismOutput.inputHash !== modelOutput.inputHash || determinismOutput.outputHash !== modelOutput.outputHash) {
    throw new Error('M10E_E3A_E4_NON_DETERMINISTIC_MODEL_OUTPUT: identical direct model runs produced different output hashes')
  }
  const observedChapters = deriveObservedChapterCostMeans(observations)
  const modeledComparators: ModeledBudgetComparators = {
    maxExpectedCostPerChapter: modelOutput.result.maxExpectedCostPerChapter,
    maxExpectedCostPerNovel: modelOutput.result.successfulRunGenerationMean,
    maxJudgeEvaluationCostPerNovel: modelOutput.result.modeledJudgeTotal,
    maxRetryOverheadPercentage: modelOutput.result.modeledRetryOverheadPercentage,
    combinedTotalNovelCostP95: modelOutput.result.combinedTotalNovelCostP95,
  }
  const observedComparators: ObservedBudgetComparators = aggregate.observedCostComparators
  const budgetInput: BudgetGateInput = {
    e0Authority: FIXTURE_E0_AUTHORITY,
    currency: FIXTURE_CURRENCY,
    compatibleStratum: observations.compatibleStratum,
    modeledComparators,
    observedComparators,
  }
  const budgetResult = evaluateBudgetGate(budgetInput)
  const engineeringInputBase: Omit<EngineeringGateInput, 'artifactPairValid' | 'determinismVerified'> = {
    executionProfile: observations.executionProfile,
    evidence: { engineeringGate: classification.engineeringGate, reasonCodes: classification.reasonCodes },
    modeledOutputPresent: true,
    modeledComparatorsComplete: Object.values(modeledComparators).every((value) => value.state === 'PRESENT'),
    sensitivityBandsComplete: modelOutput.result.sensitivityBands !== null,
    modelRunDefect: null,
    budget: budgetResult,
    e1E2ClosureRegression: false,
    requiredHumanAuthorityPresent: true,
  }
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
  const makePayloadFields = (engineeringGate: Readonly<{ input: EngineeringGateInput; result: EngineeringGateVerdict }>): Omit<ReliabilitySemanticPayload, 'artifactSemanticHash'> => ({
    schemaVersion: 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V1' as const,
    executionProfile: observations.executionProfile,
    compatibleStratum: observations.compatibleStratum,
    sourceAuthority: FIXTURE_SOURCE_AUTHORITY,
    baseGitSha: options?.baseGitSha ?? FIXTURE_BASE_GIT_SHA,
    gitDirty: options?.gitDirty ?? FIXTURE_DIRTY,
    e2ClosureReference: options?.e2ClosureReference ?? FIXTURE_E2_CLOSURE_REFERENCE,
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
    engineeringGate,
    reasonCodes: engineeringGate.result.reasonCodes,
  })
  if (options?.engineeringGate !== undefined) {
    return finalizeReliabilitySemanticPayload(makePayloadFields(options.engineeringGate))
  }
  // Two-pass derivation: the provisional payload must HOLD until an actual
  // artifact-pair validation succeeds; only then may the final gate PASS.
  const provisionalInput: EngineeringGateInput = { ...engineeringInputBase, artifactPairValid: null, determinismVerified: true }
  const provisionalResult = evaluateEngineeringGate(provisionalInput)
  if (provisionalResult.engineeringGate !== 'HOLD') {
    throw new Error('M10E_E3A_E4_PROVISIONAL_GATE_MUST_HOLD: provisional fixture payload without artifact-pair proof must HOLD')
  }
  const provisionalPayload = finalizeReliabilitySemanticPayload(makePayloadFields({ input: provisionalInput, result: provisionalResult }))
  buildFixtureEnvelopes(provisionalPayload)
  const finalInput: EngineeringGateInput = { ...engineeringInputBase, artifactPairValid: true, determinismVerified: true }
  const finalResult = evaluateEngineeringGate(finalInput)
  if (finalResult.engineeringGate !== 'PASS') {
    throw new Error('M10E_E3A_E4_FINAL_GATE_MUST_PASS: fixture final engineering gate did not PASS after artifact-pair proof')
  }
  return finalizeReliabilitySemanticPayload(makePayloadFields({ input: finalInput, result: finalResult }))
}

export function buildFixtureEnvelopes(payload: ReliabilitySemanticPayload): Readonly<{
  artifact: ReturnType<typeof validateReliabilitySemanticArtifact>
  reportBytes: string
  pair: ValidatedReliabilityArtifactPair
  raw: unknown
  normalized: unknown
}> {
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

export function buildValidatedArtifactPairFixture(options: Readonly<{
  baseGitSha?: string
  gitDirty?: boolean
  e2ClosureReference?: string
  engineeringGate?: Readonly<{ input: EngineeringGateInput; result: EngineeringGateVerdict }>
} | undefined> = undefined): Readonly<{
  artifact: ReturnType<typeof validateReliabilitySemanticArtifact>
  reportBytes: string
  pair: ValidatedReliabilityArtifactPair
  raw: unknown
  normalized: unknown
}> {
  return buildFixtureEnvelopes(buildSemanticPayloadFixture(options))
}

export function rawEnvelopeForMutation(pair: Readonly<{ raw: unknown }>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(pair.raw)) as Record<string, unknown>
}