import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import {
  ATTEMPT_NUMBER_SCHEMA,
  CHAPTER_NUMBER_SCHEMA,
  COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  COUNT_SCHEMA,
  EXECUTION_PROFILE_SCHEMA,
  FALLBACK_INDEX_SCHEMA,
  SAFE_ALIAS_SCHEMA,
  SHA256_SCHEMA,
  STAGE_ID_SCHEMA,
  TASK_ID_SCHEMA,
  measurementStateSchema,
  type CompatibleStratumIdentity,
} from './contracts'
import {
  validateChapterStageExchangeabilityAuthorities,
  validateJudgePlanAuthority,
  type ChapterStageExchangeabilityAuthority,
  type JudgePlanAuthority,
} from './authorities'
import { canonicalizeDecimal, type CanonicalDecimal } from './decimal'
import { getStageSemantics } from './topology'

const OBSERVATION_ID = z.string().min(1).max(256)
const TIMESTAMP = z.string().datetime({ offset: true })
const CURRENCY = z.string().regex(/^[A-Z]{3}$/)
const presentOrMissingSchema = <T>(valueSchema: z.ZodType<T>) => z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('PRESENT'), value: valueSchema }),
  z.strictObject({ state: z.literal('MISSING'), reasonCode: z.enum(['TELEMETRY_UNAVAILABLE', 'OBSERVATION_COVERAGE_INCOMPLETE', 'COST_UNAVAILABLE', 'CURRENCY_CONVERSION_UNAVAILABLE', 'PROFILE_THRESHOLD_NOT_MET', 'AUTHORITY_UNAVAILABLE']), detail: z.string().min(1) }),
])
const TOKEN_STATE = presentOrMissingSchema(COUNT_SCHEMA)
const MONEY_STATE = presentOrMissingSchema(z.string().transform((value) => canonicalizeDecimal(value, 'MONEY')))
const LATENCY_STATE = measurementStateSchema(z.string().transform((value) => canonicalizeDecimal(value, 'LATENCY_MILLISECONDS')))
const BASE = { observationId: OBSERVATION_ID, storyAlias: SAFE_ALIAS_SCHEMA, novelExecutionAlias: SAFE_ALIAS_SCHEMA }
const CHAPTER_BASE = { ...BASE, chapterExecutionAlias: SAFE_ALIAS_SCHEMA, chapterNumber: CHAPTER_NUMBER_SCHEMA }

export const PROVIDER_CALL_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, callAlias: SAFE_ALIAS_SCHEMA, stageExecutionAlias: SAFE_ALIAS_SCHEMA, logicalUnitAlias: SAFE_ALIAS_SCHEMA,
  generationKind: z.enum(['CHAPTER', 'CHOICE']), taskId: TASK_ID_SCHEMA, stageId: STAGE_ID_SCHEMA,
  attemptNumber: ATTEMPT_NUMBER_SCHEMA, fallbackIndex: FALLBACK_INDEX_SCHEMA, providerModelPolicyId: SAFE_ALIAS_SCHEMA,
  outcome: z.enum(['SUCCESS', 'FAILURE']), safeErrorCode: z.string().min(1).max(128).nullable(),
  inputTokens: TOKEN_STATE, outputTokens: TOKEN_STATE, totalTokens: TOKEN_STATE,
  actualCost: MONEY_STATE, estimatedCost: MONEY_STATE, currency: CURRENCY,
  actualCostSource: z.enum(['PROVIDER_REPORTED', 'INVOICE_RECONCILED']), pricingSnapshotHash: SHA256_SCHEMA,
  startedAt: TIMESTAMP, endedAt: TIMESTAMP, elapsedMilliseconds: LATENCY_STATE,
})
export type ProviderCallObservation = z.infer<typeof PROVIDER_CALL_OBSERVATION_SCHEMA>

export const STAGE_OUTCOME_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, stageExecutionAlias: SAFE_ALIAS_SCHEMA, stageId: STAGE_ID_SCHEMA, taskId: TASK_ID_SCHEMA,
  outcome: z.enum(['SUCCESS', 'FAILURE']), providerCallAlias: SAFE_ALIAS_SCHEMA.nullable(), reachedAt: TIMESTAMP, finalizedAt: TIMESTAMP,
})
export type StageOutcomeObservation = z.infer<typeof STAGE_OUTCOME_OBSERVATION_SCHEMA>

export const LOGICAL_GENERATION_UNIT_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, logicalUnitAlias: SAFE_ALIAS_SCHEMA, generationKind: z.enum(['CHAPTER', 'CHOICE']), taskId: z.enum(['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT']),
  attemptCount: ATTEMPT_NUMBER_SCHEMA, terminalOutcome: z.enum(['SUCCESS', 'FAILURE']), fallbackEligible: z.boolean(), fallbackInvoked: z.boolean(),
  startedAt: TIMESTAMP, endedAt: TIMESTAMP, elapsedMilliseconds: LATENCY_STATE,
})
export type LogicalGenerationUnitObservation = z.infer<typeof LOGICAL_GENERATION_UNIT_OBSERVATION_SCHEMA>

export const RECOVERY_ACTION_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, recoveryAlias: SAFE_ALIAS_SCHEMA, stageExecutionAlias: SAFE_ALIAS_SCHEMA, stageId: STAGE_ID_SCHEMA, taskId: TASK_ID_SCHEMA,
  recoveryKind: z.enum(['RETRY', 'CHECKPOINT_RESUME', 'STALE_LEASE_RECLAIM', 'OWNERSHIP_LOSS']),
  terminalOutcome: z.enum(['SUCCESS', 'FAILURE']), checkpointDecisionObserved: z.boolean(), reusedExactValidCheckpoint: z.boolean(),
  choiceRetryAfterValidProseCheckpoint: z.boolean(), regeneratedProse: z.boolean(), manualDatabaseMutation: z.boolean(),
  startedAt: TIMESTAMP, endedAt: TIMESTAMP, elapsedMilliseconds: LATENCY_STATE,
})
export type RecoveryActionObservation = z.infer<typeof RECOVERY_ACTION_OBSERVATION_SCHEMA>

export const PUBLICATION_ATTEMPT_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, publicationAttemptAlias: SAFE_ALIAS_SCHEMA, outcome: z.enum(['SUCCESS', 'FAILURE']), producedDuplicateCanonicalPublication: z.boolean(), attemptedAt: TIMESTAMP,
})
export type PublicationAttemptObservation = z.infer<typeof PUBLICATION_ATTEMPT_OBSERVATION_SCHEMA>

export const CANONICAL_INVARIANT_CHECK_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, invariantCheckAlias: SAFE_ALIAS_SCHEMA, outcome: z.enum(['VALID', 'CORRUPT']), checkedAt: TIMESTAMP,
})
export type CanonicalInvariantCheckObservation = z.infer<typeof CANONICAL_INVARIANT_CHECK_OBSERVATION_SCHEMA>

export const CHAPTER_EXECUTION_OBSERVATION_SCHEMA = z.strictObject({
  ...CHAPTER_BASE, terminalOutcome: z.enum(['SUCCESS', 'FAILURE']), generationCost: MONEY_STATE, currency: CURRENCY, startedAt: TIMESTAMP, endedAt: TIMESTAMP,
})
export type ChapterExecutionObservation = z.infer<typeof CHAPTER_EXECUTION_OBSERVATION_SCHEMA>

export const NOVEL_EXECUTION_OBSERVATION_SCHEMA = z.strictObject({
  ...BASE, terminalOutcome: z.enum(['SUCCESS', 'PARTIAL_FAILURE']), completedChapterNumbers: z.array(CHAPTER_NUMBER_SCHEMA).max(50),
  generationCost: MONEY_STATE, currency: CURRENCY, startedAt: TIMESTAMP, endedAt: TIMESTAMP,
})
export type NovelExecutionObservation = z.infer<typeof NOVEL_EXECUTION_OBSERVATION_SCHEMA>

export const JUDGE_EVALUATION_OBSERVATION_SCHEMA = z.strictObject({
  ...BASE, judgeEvaluationAlias: SAFE_ALIAS_SCHEMA, judgeTaskId: z.string().min(1), evaluationIndex: z.number().int().nonnegative(),
  providerModelPolicyId: SAFE_ALIAS_SCHEMA, outcome: z.enum(['SUCCESS', 'FAILURE']), cost: MONEY_STATE, currency: CURRENCY,
  startedAt: TIMESTAMP, endedAt: TIMESTAMP,
})
export type JudgeEvaluationObservation = z.infer<typeof JUDGE_EVALUATION_OBSERVATION_SCHEMA>

const SOURCE_AUTHORITY_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_OBSERVATION_SOURCE_V1'), sourceKind: z.literal('AUTHORIZED_TELEMETRY_OBSERVATIONS'),
  excludedSources: z.tuple([z.literal('E1_FAULT_INJECTION_FREQUENCY'), z.literal('E2_FAULT_INJECTION_FREQUENCY')]),
  decisionRef: z.string().min(1), canonicalHash: SHA256_SCHEMA,
})
const TIMING_AUTHORITY_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_EXACT_ELAPSED_TIME_V1'), sourceKind: z.literal('START_END_TIMESTAMPS'),
  arithmetic: z.literal('EXACT_GREGORIAN_BIGINT_MICROSECONDS'), decisionRef: z.string().min(1), canonicalHash: SHA256_SCHEMA,
})
export type ObservationSourceAuthority = z.infer<typeof SOURCE_AUTHORITY_SCHEMA>
export type TimingSourceAuthority = z.infer<typeof TIMING_AUTHORITY_SCHEMA>
const AUTHORITY_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
function createHashedAuthority<T extends Record<string, unknown>>(payload: T): T & { canonicalHash: string } {
  return deepFreeze({ ...payload, canonicalHash: computeSha256(stableStringify(payload)) })
}
export function createObservationSourceAuthority(): ObservationSourceAuthority {
  return createHashedAuthority({ authorityVersion: 'M10_E_OBSERVATION_SOURCE_V1' as const, sourceKind: 'AUTHORIZED_TELEMETRY_OBSERVATIONS' as const,
    excludedSources: ['E1_FAULT_INJECTION_FREQUENCY', 'E2_FAULT_INJECTION_FREQUENCY'] as const, decisionRef: AUTHORITY_REF })
}
export function createTimingSourceAuthority(): TimingSourceAuthority {
  return createHashedAuthority({ authorityVersion: 'M10_E_EXACT_ELAPSED_TIME_V1' as const, sourceKind: 'START_END_TIMESTAMPS' as const,
    arithmetic: 'EXACT_GREGORIAN_BIGINT_MICROSECONDS' as const, decisionRef: AUTHORITY_REF })
}
const CELL_SCHEMA = z.strictObject({ chapterNumber: CHAPTER_NUMBER_SCHEMA, stageId: STAGE_ID_SCHEMA })
const FIXTURE_TOPOLOGY_AUTHORITY_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_FIXTURE_TOPOLOGY_V1'), decisionRef: z.string().min(1), cells: z.array(CELL_SCHEMA).min(1), canonicalHash: SHA256_SCHEMA,
})
export type FixtureTopologyAuthority = z.infer<typeof FIXTURE_TOPOLOGY_AUTHORITY_SCHEMA>
export function createFixtureTopologyAuthority(cells: readonly z.infer<typeof CELL_SCHEMA>[]): FixtureTopologyAuthority {
  const parsedCells = z.array(CELL_SCHEMA).min(1).parse(cells)
  assertUnique(parsedCells.map(cellKey), 'fixture topology cell')
  const payload = { authorityVersion: 'M10_E_FIXTURE_TOPOLOGY_V1' as const, decisionRef: 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md', cells: utf8SortCells(parsedCells) }
  return deepFreeze({ ...payload, canonicalHash: computeSha256(stableStringify(payload)) })
}
const SET_SCHEMA = z.strictObject({
  executionProfile: EXECUTION_PROFILE_SCHEMA,
  compatibleStratum: COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  exchangeabilityAuthorities: z.array(z.unknown()),
  observationSourceAuthority: SOURCE_AUTHORITY_SCHEMA,
  timingSourceAuthority: TIMING_AUTHORITY_SCHEMA,
  fixtureTopologyAuthority: FIXTURE_TOPOLOGY_AUTHORITY_SCHEMA,
  judgePlanAuthority: z.unknown(),
  declaredApplicableCells: z.array(CELL_SCHEMA),
  providerCalls: z.array(PROVIDER_CALL_OBSERVATION_SCHEMA), stageOutcomes: z.array(STAGE_OUTCOME_OBSERVATION_SCHEMA),
  logicalGenerationUnits: z.array(LOGICAL_GENERATION_UNIT_OBSERVATION_SCHEMA), recoveryActions: z.array(RECOVERY_ACTION_OBSERVATION_SCHEMA),
  publicationAttempts: z.array(PUBLICATION_ATTEMPT_OBSERVATION_SCHEMA), canonicalInvariantChecks: z.array(CANONICAL_INVARIANT_CHECK_OBSERVATION_SCHEMA),
  chapterExecutions: z.array(CHAPTER_EXECUTION_OBSERVATION_SCHEMA), novelExecutions: z.array(NOVEL_EXECUTION_OBSERVATION_SCHEMA),
  judgeEvaluations: z.array(JUDGE_EVALUATION_OBSERVATION_SCHEMA),
})

export interface ReliabilityObservationSet extends Omit<z.infer<typeof SET_SCHEMA>, 'exchangeabilityAuthorities' | 'judgePlanAuthority'> {
  readonly exchangeabilityAuthorities: readonly ChapterStageExchangeabilityAuthority[]
  readonly judgePlanAuthority: JudgePlanAuthority
  readonly compatibleStratum: CompatibleStratumIdentity
}

export function validateReliabilityObservationSet(value: unknown): ReliabilityObservationSet {
  const parsed = SET_SCHEMA.parse(value)
  const authorities = validateChapterStageExchangeabilityAuthorities(parsed.exchangeabilityAuthorities, parsed.executionProfile, parsed.compatibleStratum)
  const judgePlan = validateJudgePlanAuthority(parsed.judgePlanAuthority, parsed.compatibleStratum.providerModelPolicyId)
  validateExactAuthority(parsed.observationSourceAuthority, createObservationSourceAuthority(), 'Observation source')
  validateExactAuthority(parsed.timingSourceAuthority, createTimingSourceAuthority(), 'Timing source')
  validateFixtureTopology(parsed)
  assertUnique([
    ...parsed.providerCalls, ...parsed.stageOutcomes, ...parsed.logicalGenerationUnits, ...parsed.recoveryActions,
    ...parsed.publicationAttempts, ...parsed.canonicalInvariantChecks, ...parsed.chapterExecutions, ...parsed.novelExecutions,
    ...parsed.judgeEvaluations,
  ].map((item) => item.observationId), 'global observation ID')
  assertUnique(parsed.providerCalls.map((item) => item.callAlias), 'provider-call alias')
  assertUnique(parsed.stageOutcomes.map((item) => item.stageExecutionAlias), 'stage-execution alias')
  assertUnique(parsed.logicalGenerationUnits.map((item) => item.logicalUnitAlias), 'logical-unit alias')
  assertUnique(parsed.recoveryActions.map((item) => item.recoveryAlias), 'recovery alias')
  assertUnique(parsed.publicationAttempts.map((item) => item.publicationAttemptAlias), 'publication-attempt alias')
  assertUnique(parsed.canonicalInvariantChecks.map((item) => item.invariantCheckAlias), 'invariant-check alias')
  assertUnique(parsed.judgeEvaluations.map((item) => item.judgeEvaluationAlias), 'judge-evaluation alias')

  const currency = firstCurrency(parsed)
  if (new Set(parsed.providerCalls.map((call) => call.actualCostSource)).size > 1) throw new Error('Mixed actual cost sources cannot be aggregated in one exact stratum')
  for (const item of [...parsed.providerCalls, ...parsed.chapterExecutions, ...parsed.novelExecutions, ...parsed.judgeEvaluations]) {
    if (currency !== null && item.currency !== currency) throw new Error('Mixed currencies cannot be aggregated')
  }
  for (const call of parsed.providerCalls) {
    const semantics = getStageSemantics(call.stageId)
    if (semantics.providerCall.state !== 'APPLICABLE' || semantics.taskId !== call.taskId) throw new Error('Provider call conflicts with frozen topology/task mapping')
    if (call.providerModelPolicyId !== parsed.compatibleStratum.providerModelPolicyId) throw new Error('Provider/model policy conflicts with compatible stratum')
    if (call.pricingSnapshotHash !== parsed.compatibleStratum.pricingSnapshotHash) throw new Error('Pricing snapshot conflicts with compatible stratum')
    assertTime(call.startedAt, call.endedAt)
    assertElapsed(call.startedAt, call.endedAt, call.elapsedMilliseconds)
    if (semantics.attemptClass === 'FALLBACK' ? call.fallbackIndex < 1 : call.fallbackIndex !== 0) throw new Error('Fallback index conflicts with frozen stage semantics')
    if (call.inputTokens.state === 'PRESENT' && call.outputTokens.state === 'PRESENT' && call.totalTokens.state === 'PRESENT'
      && call.inputTokens.value + call.outputTokens.value !== call.totalTokens.value) throw new Error('Provider token total mismatch')
  }
  for (const stage of parsed.stageOutcomes) {
    const semantics = getStageSemantics(stage.stageId)
    if (semantics.taskId !== stage.taskId) throw new Error('Stage task conflicts with frozen mapping')
    assertTime(stage.reachedAt, stage.finalizedAt)
    const calls = parsed.providerCalls.filter((call) => call.stageExecutionAlias === stage.stageExecutionAlias)
    if (semantics.providerCall.state === 'APPLICABLE') {
      if (calls.length !== 1 || stage.providerCallAlias !== calls[0]?.callAlias) throw new Error('Applicable reached stage requires exactly one matching provider call')
    } else if (calls.length !== 0 || stage.providerCallAlias !== null) throw new Error('Runtime stage cannot contain provider call')
    if (calls[0] && !sameChapterIdentity(stage, calls[0])) throw new Error('Stage/provider-call identity mismatch')
  }
  for (const call of parsed.providerCalls) {
    if (!parsed.stageOutcomes.some((stage) => stage.stageExecutionAlias === call.stageExecutionAlias)) throw new Error('Extra provider call without reached stage')
  }
  for (const unit of parsed.logicalGenerationUnits) {
    assertTime(unit.startedAt, unit.endedAt)
    assertElapsed(unit.startedAt, unit.endedAt, unit.elapsedMilliseconds)
    const attempts = parsed.providerCalls.filter((call) => call.logicalUnitAlias === unit.logicalUnitAlias)
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
    if (attempts.length !== unit.attemptCount || attempts.some((call, index) => call.attemptNumber !== index + 1)) throw new Error('Provider attempts must be contiguous and unique from 1')
    if (attempts.some((call) => call.taskId !== unit.taskId || !sameChapterIdentity(unit, call))) throw new Error('Logical-unit/provider-call identity mismatch')
    if (unit.fallbackInvoked !== attempts.some((call) => call.fallbackIndex > 0 || call.stageId === 'PROVIDER_FALLBACK')) throw new Error('Fallback identity mismatch')
  }
  for (const recovery of parsed.recoveryActions) {
    const semantics = getStageSemantics(recovery.stageId)
    const stage = parsed.stageOutcomes.find((item) => item.stageExecutionAlias === recovery.stageExecutionAlias)
    if (!stage || !sameChapterIdentity(recovery, stage) || stage.stageId !== recovery.stageId || recovery.taskId !== semantics.taskId || semantics.retryCounterEffect !== 'INCREMENT') throw new Error('Recovery action must bind exact reached retry-counter stage')
    assertTime(recovery.startedAt, recovery.endedAt)
    assertElapsed(recovery.startedAt, recovery.endedAt, recovery.elapsedMilliseconds)
    if (recovery.reusedExactValidCheckpoint && !recovery.checkpointDecisionObserved) throw new Error('Checkpoint reuse requires observed checkpoint decision')
    if (recovery.regeneratedProse && !recovery.choiceRetryAfterValidProseCheckpoint) throw new Error('Prose regeneration flag requires eligible choice retry')
  }
  for (const item of [...parsed.chapterExecutions, ...parsed.novelExecutions, ...parsed.judgeEvaluations]) assertTime(item.startedAt, item.endedAt)
  validateExecutionIdentitiesAndCosts(parsed, judgePlan)
  return deepFreeze({ ...parsed, exchangeabilityAuthorities: authorities, judgePlanAuthority: judgePlan }) as ReliabilityObservationSet
}

export function sortProviderCallObservationsUtf8(calls: readonly ProviderCallObservation[]): ProviderCallObservation[] {
  return [...calls].sort((left, right) => compareTuple([
    left.storyAlias, left.chapterNumber, left.generationKind, left.taskId, left.attemptNumber, left.fallbackIndex, left.callAlias,
  ], [right.storyAlias, right.chapterNumber, right.generationKind, right.taskId, right.attemptNumber, right.fallbackIndex, right.callAlias]))
}

function compareTuple(left: readonly (string | number)[], right: readonly (string | number)[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!
    const b = right[index]!
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : Buffer.compare(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'))
    if (compared !== 0) return compared
  }
  return 0
}

function validateFixtureTopology(set: z.infer<typeof SET_SCHEMA>): void {
  const authority = set.fixtureTopologyAuthority
  const { canonicalHash: _hash, ...payload } = authority
  if (computeSha256(stableStringify(payload)) !== authority.canonicalHash) throw new Error('Fixture topology authority hash mismatch')
  assertUnique(set.declaredApplicableCells.map(cellKey), 'declared applicable cell')
  if (set.executionProfile === 'CONTRACT_FIXTURE') {
    const expected = createFixtureTopologyAuthority(authority.cells)
    if (stableStringify(authority) !== stableStringify(expected) || stableStringify(utf8SortCells(set.declaredApplicableCells)) !== stableStringify(expected.cells)) throw new Error('Fixture applicable cells must match exact fixture topology authority')
  } else {
    const expected = Array.from({ length: 50 }, (_, chapter) => STAGE_VALUES.map((stageId) => ({ chapterNumber: chapter + 1, stageId }))).flat()
    if (stableStringify(utf8SortCells(set.declaredApplicableCells)) !== stableStringify(utf8SortCells(expected))) throw new Error('Release applicable cells must be exact 50 by frozen stage catalog')
  }
}

const STAGE_VALUES = ['PROSE_PRIMARY', 'PROSE_RETRY', 'PROVIDER_FALLBACK', 'CHECKPOINT_RECOVERY', 'STRUCTURED_OUTPUT', 'STRUCTURED_RETRY', 'OWNERSHIP', 'OWNERSHIP_RECOVERY', 'PUBLICATION', 'PUBLICATION_RECOVERY', 'POST_PUBLISH'] as const
function validateExecutionIdentitiesAndCosts(set: z.infer<typeof SET_SCHEMA>, judgePlan: JudgePlanAuthority): void {
  const novels = new Map(set.novelExecutions.map((item) => [item.novelExecutionAlias, item]))
  const chapters = new Map(set.chapterExecutions.map((item) => [item.chapterExecutionAlias, item]))
  assertUnique(set.novelExecutions.map((item) => item.novelExecutionAlias), 'novel execution alias')
  assertUnique(set.chapterExecutions.map((item) => item.chapterExecutionAlias), 'chapter execution alias')
  for (const item of [...set.providerCalls, ...set.stageOutcomes, ...set.logicalGenerationUnits, ...set.recoveryActions, ...set.publicationAttempts, ...set.canonicalInvariantChecks]) requireChapterParent(item, chapters)
  for (const chapter of set.chapterExecutions) {
    const novel = novels.get(chapter.novelExecutionAlias)
    if (!novel || novel.storyAlias !== chapter.storyAlias) throw new Error('Chapter parent novel identity mismatch')
    const stages = set.stageOutcomes.filter((item) => item.chapterExecutionAlias === chapter.chapterExecutionAlias)
    const calls = set.providerCalls.filter((item) => item.chapterExecutionAlias === chapter.chapterExecutionAlias)
    if ([...stages, ...calls].some((item) => !sameChapterIdentity(chapter, item))) throw new Error('Chapter child identity mismatch')
    const terminalFailure = stages.some((stage) => stage.outcome === 'FAILURE' && ['CHECKPOINT_RECOVERY', 'STRUCTURED_RETRY', 'OWNERSHIP_RECOVERY', 'PUBLICATION_RECOVERY'].includes(stage.stageId))
    if ((chapter.terminalOutcome === 'FAILURE') !== terminalFailure) throw new Error('Chapter outcome conflicts with linked terminal stage outcomes')
    assertCostMatchesCalls(chapter.generationCost, calls, 'Chapter generation cost')
  }
  for (const novel of set.novelExecutions) {
    if (novel.completedChapterNumbers.some((chapter, index) => chapter !== index + 1)) throw new Error('Completed chapters must be contiguous from chapter 1')
    if (novel.terminalOutcome === 'SUCCESS' && novel.completedChapterNumbers.length !== 50) throw new Error('Successful novel must complete chapters 1..50')
    const linked = set.chapterExecutions.filter((item) => item.novelExecutionAlias === novel.novelExecutionAlias)
    if (linked.some((item) => item.storyAlias !== novel.storyAlias)) throw new Error('Novel child story identity mismatch')
    const linkedNumbers = [...linked].sort((left, right) => left.chapterNumber - right.chapterNumber).map((item) => item.chapterNumber)
    if (new Set(linkedNumbers).size !== linkedNumbers.length || stableStringify(linkedNumbers) !== stableStringify(novel.completedChapterNumbers)) throw new Error('Novel completed chapters must equal exact unique linked chapter sequence')
    if (novel.terminalOutcome === 'PARTIAL_FAILURE' && linked.every((item) => item.terminalOutcome === 'SUCCESS') && linked.length === 50) throw new Error('Partial novel must contain terminal chapter failure or stop before chapter 50')
    assertCostMatchesCalls(novel.generationCost, set.providerCalls.filter((item) => item.novelExecutionAlias === novel.novelExecutionAlias), 'Novel generation cost')
  }
  for (const recovery of set.recoveryActions) requireChapterParent(recovery, chapters)
  for (const publication of set.publicationAttempts) requireChapterParent(publication, chapters)
  for (const check of set.canonicalInvariantChecks) requireChapterParent(check, chapters)
  const eligibleNovels = set.novelExecutions.filter((novel) => novel.terminalOutcome === 'SUCCESS' && novel.completedChapterNumbers.length === 50)
  for (const novel of eligibleNovels) {
    const judges = set.judgeEvaluations.filter((judge) => judge.novelExecutionAlias === novel.novelExecutionAlias)
    const actualPlan = judges.map(({ judgeTaskId, evaluationIndex, providerModelPolicyId }) => ({ judgeTaskId, evaluationIndex, providerModelPolicyId }))
    if (stableStringify(actualPlan) !== stableStringify(judgePlan.evaluations)) throw new Error('Successful complete novel requires exact complete ordered judge plan')
  }
  for (const judge of set.judgeEvaluations) {
    const novel = novels.get(judge.novelExecutionAlias)
    if (!novel || novel.storyAlias !== judge.storyAlias || novel.terminalOutcome !== 'SUCCESS' || novel.completedChapterNumbers.length !== 50) throw new Error('Judge requires matching successful complete novel')
    if (judge.providerModelPolicyId !== set.compatibleStratum.providerModelPolicyId) throw new Error('Judge evaluation not in exact judge plan')
  }
}
function requireChapterParent(item: { chapterExecutionAlias: string; storyAlias: string; novelExecutionAlias: string; chapterNumber: number }, chapters: Map<string, z.infer<typeof CHAPTER_EXECUTION_OBSERVATION_SCHEMA>>): void {
  const parent = chapters.get(item.chapterExecutionAlias)
  if (!parent || !sameChapterIdentity(item, parent)) throw new Error('Observation chapter parent identity mismatch')
}
function assertCostMatchesCalls(state: z.infer<typeof MONEY_STATE>, calls: readonly ProviderCallObservation[], label: string): void {
  const costs = calls.flatMap((call) => call.actualCost.state === 'PRESENT' ? [call.actualCost.value] : [])
  if (costs.length !== calls.length) { if (state.state !== 'MISSING') throw new Error(`${label} must be missing when linked call cost coverage is incomplete`); return }
  const expected = costs.reduce((sum, value) => (BigInt(sum.replace('.', '')) + BigInt(value.replace('.', ''))).toString().padStart(9, '0').replace(/(\d{8})$/, '.$1'), '0.00000000')
  if (state.state !== 'PRESENT' || state.value !== expected) throw new Error(`${label} does not equal linked provider-call actual costs`)
}
function cellKey(cell: { chapterNumber: number; stageId: string }): string { return `${String(cell.chapterNumber).padStart(2, '0')}.${cell.stageId}` }
function utf8SortCells<T extends { chapterNumber: number; stageId: string }>(cells: readonly T[]): T[] { return [...cells].sort((left, right) => Buffer.compare(Buffer.from(cellKey(left)), Buffer.from(cellKey(right)))) }

function sameChapterIdentity(left: { storyAlias: string; novelExecutionAlias: string; chapterExecutionAlias: string; chapterNumber: number }, right: { storyAlias: string; novelExecutionAlias: string; chapterExecutionAlias: string; chapterNumber: number }): boolean {
  return left.storyAlias === right.storyAlias && left.novelExecutionAlias === right.novelExecutionAlias && left.chapterExecutionAlias === right.chapterExecutionAlias && left.chapterNumber === right.chapterNumber
}
function validateExactAuthority<T>(actual: T, expected: T, label: string): void {
  if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`${label} authority mismatch`)
}
function assertTime(start: string, end: string): void { if (timestampMicroseconds(end) < timestampMicroseconds(start)) throw new Error('Observation end time precedes start time') }
function assertElapsed(start: string, end: string, elapsed: z.infer<typeof LATENCY_STATE>): void {
  if (elapsed.state !== 'PRESENT') return
  const micros = timestampMicroseconds(end) - timestampMicroseconds(start)
  const expected = `${micros / BigInt("1000")}.${(micros % BigInt("1000")).toString().padStart(3, '0')}`
  if (elapsed.value !== expected) throw new Error('Elapsed milliseconds mismatch exact timestamp authority')
}
function timestampMicroseconds(value: string): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error('Invalid exact timestamp')
  const year = BigInt(match[1]!), month = BigInt(match[2]!), day = BigInt(match[3]!)
  const hour = BigInt(match[4]!), minute = BigInt(match[5]!), second = BigInt(match[6]!)
  const fraction = (match[7] ?? '').padEnd(9, '0')
  const micros = (BigInt(fraction) + BigInt("500")) / BigInt("1000")
  const offset = match[8] === 'Z' ? BigInt("0") : (match[8]![0] === '-' ? -BigInt("1") : BigInt("1")) * (BigInt(match[8]!.slice(1, 3)) * BigInt("60") + BigInt(match[8]!.slice(4, 6)))
  return (((daysFromCivil(year, month, day) * BigInt("24") + hour) * BigInt("60") + minute - offset) * BigInt("60") + second) * BigInt("1000000") + micros
}
function daysFromCivil(yearValue: bigint, monthValue: bigint, day: bigint): bigint {
  const year = yearValue - (monthValue <= BigInt("2") ? BigInt("1") : BigInt("0"))
  const era = year >= BigInt("0") ? year / BigInt("400") : (year - BigInt("399")) / BigInt("400")
  const yearOfEra = year - era * BigInt("400")
  const month = monthValue + (monthValue > BigInt("2") ? -BigInt("3") : BigInt("9"))
  const dayOfYear = (BigInt("153") * month + BigInt("2")) / BigInt("5") + day - BigInt("1")
  return era * BigInt("146097") + (yearOfEra * BigInt("365") + yearOfEra / BigInt("4") - yearOfEra / BigInt("100") + dayOfYear) - BigInt("719468")
}
function assertUnique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`) }
function firstCurrency(set: z.infer<typeof SET_SCHEMA>): string | null { return set.providerCalls[0]?.currency ?? set.chapterExecutions[0]?.currency ?? set.novelExecutions[0]?.currency ?? set.judgeEvaluations[0]?.currency ?? null }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }; return value }

export type Money = CanonicalDecimal<'MONEY'>
