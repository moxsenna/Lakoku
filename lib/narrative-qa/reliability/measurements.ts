import { z } from 'zod'
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
import { validateChapterStageExchangeabilityAuthorities, type ChapterStageExchangeabilityAuthority } from './authorities'
import { canonicalizeDecimal, type CanonicalDecimal } from './decimal'
import { getStageSemantics } from './topology'

const OBSERVATION_ID = z.string().min(1).max(256)
const TIMESTAMP = z.string().datetime({ offset: true })
const CURRENCY = z.string().regex(/^[A-Z]{3}$/)
const TOKEN_STATE = measurementStateSchema(COUNT_SCHEMA)
const MONEY_STATE = measurementStateSchema(z.string().transform((value) => canonicalizeDecimal(value, 'MONEY')))
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
  ...CHAPTER_BASE, recoveryAlias: SAFE_ALIAS_SCHEMA, recoveryKind: z.enum(['RETRY', 'CHECKPOINT_RESUME', 'STALE_LEASE_RECLAIM', 'OWNERSHIP_LOSS']),
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

const CELL_SCHEMA = z.strictObject({ chapterNumber: CHAPTER_NUMBER_SCHEMA, stageId: STAGE_ID_SCHEMA })
const SET_SCHEMA = z.strictObject({
  executionProfile: EXECUTION_PROFILE_SCHEMA,
  compatibleStratum: COMPATIBLE_STRATUM_IDENTITY_SCHEMA,
  exchangeabilityAuthorities: z.array(z.unknown()),
  declaredApplicableCells: z.array(CELL_SCHEMA),
  providerCalls: z.array(PROVIDER_CALL_OBSERVATION_SCHEMA), stageOutcomes: z.array(STAGE_OUTCOME_OBSERVATION_SCHEMA),
  logicalGenerationUnits: z.array(LOGICAL_GENERATION_UNIT_OBSERVATION_SCHEMA), recoveryActions: z.array(RECOVERY_ACTION_OBSERVATION_SCHEMA),
  publicationAttempts: z.array(PUBLICATION_ATTEMPT_OBSERVATION_SCHEMA), canonicalInvariantChecks: z.array(CANONICAL_INVARIANT_CHECK_OBSERVATION_SCHEMA),
  chapterExecutions: z.array(CHAPTER_EXECUTION_OBSERVATION_SCHEMA), novelExecutions: z.array(NOVEL_EXECUTION_OBSERVATION_SCHEMA),
  judgeEvaluations: z.array(JUDGE_EVALUATION_OBSERVATION_SCHEMA),
})

export interface ReliabilityObservationSet extends Omit<z.infer<typeof SET_SCHEMA>, 'exchangeabilityAuthorities'> {
  readonly exchangeabilityAuthorities: readonly ChapterStageExchangeabilityAuthority[]
  readonly compatibleStratum: CompatibleStratumIdentity
}

export function validateReliabilityObservationSet(value: unknown): ReliabilityObservationSet {
  const parsed = SET_SCHEMA.parse(value)
  const authorities = validateChapterStageExchangeabilityAuthorities(parsed.exchangeabilityAuthorities, parsed.executionProfile, parsed.compatibleStratum)
  assertUnique(parsed.providerCalls.map((item) => item.observationId), 'provider-call observation ID')
  assertUnique(parsed.providerCalls.map((item) => item.callAlias), 'provider-call alias')
  assertUnique(parsed.stageOutcomes.map((item) => item.stageExecutionAlias), 'stage-execution alias')
  assertUnique(parsed.logicalGenerationUnits.map((item) => item.logicalUnitAlias), 'logical-unit alias')

  const currency = firstCurrency(parsed)
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
    const attempts = parsed.providerCalls.filter((call) => call.logicalUnitAlias === unit.logicalUnitAlias)
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
    if (attempts.length !== unit.attemptCount || attempts.some((call, index) => call.attemptNumber !== index + 1)) throw new Error('Provider attempts must be contiguous and unique from 1')
    if (attempts.some((call) => call.taskId !== unit.taskId || !sameChapterIdentity(unit, call))) throw new Error('Logical-unit/provider-call identity mismatch')
    if (unit.fallbackInvoked !== attempts.some((call) => call.fallbackIndex > 0 || call.stageId === 'PROVIDER_FALLBACK')) throw new Error('Fallback identity mismatch')
  }
  for (const recovery of parsed.recoveryActions) {
    assertTime(recovery.startedAt, recovery.endedAt)
    assertElapsed(recovery.startedAt, recovery.endedAt, recovery.elapsedMilliseconds)
    if (recovery.reusedExactValidCheckpoint && !recovery.checkpointDecisionObserved) throw new Error('Checkpoint reuse requires observed checkpoint decision')
    if (recovery.regeneratedProse && !recovery.choiceRetryAfterValidProseCheckpoint) throw new Error('Prose regeneration flag requires eligible choice retry')
  }
  for (const item of [...parsed.chapterExecutions, ...parsed.novelExecutions, ...parsed.judgeEvaluations]) assertTime(item.startedAt, item.endedAt)
  for (const novel of parsed.novelExecutions) {
    if (novel.completedChapterNumbers.some((chapter, index) => chapter !== index + 1)) throw new Error('Completed chapters must be contiguous from chapter 1')
    if (novel.terminalOutcome === 'SUCCESS' && novel.completedChapterNumbers.length !== 50) throw new Error('Successful novel must complete chapters 1..50')
  }
  return deepFreeze({ ...parsed, exchangeabilityAuthorities: authorities }) as ReliabilityObservationSet
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

function sameChapterIdentity(left: { storyAlias: string; novelExecutionAlias: string; chapterExecutionAlias: string; chapterNumber: number }, right: { storyAlias: string; novelExecutionAlias: string; chapterExecutionAlias: string; chapterNumber: number }): boolean {
  return left.storyAlias === right.storyAlias && left.novelExecutionAlias === right.novelExecutionAlias && left.chapterExecutionAlias === right.chapterExecutionAlias && left.chapterNumber === right.chapterNumber
}
function assertTime(start: string, end: string): void { if (Date.parse(end) < Date.parse(start)) throw new Error('Observation end time precedes start time') }
function assertElapsed(start: string, end: string, elapsed: z.infer<typeof LATENCY_STATE>): void {
  if (elapsed.state === 'PRESENT') {
    const actual = canonicalizeDecimal(String(Date.parse(end) - Date.parse(start)), 'LATENCY_MILLISECONDS')
    if (elapsed.value !== actual) throw new Error('Elapsed milliseconds do not match observation timestamps')
  }
}
function assertUnique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`) }
function firstCurrency(set: z.infer<typeof SET_SCHEMA>): string | null { return set.providerCalls[0]?.currency ?? set.chapterExecutions[0]?.currency ?? set.novelExecutions[0]?.currency ?? set.judgeEvaluations[0]?.currency ?? null }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { for (const nested of Object.values(value)) deepFreeze(nested); Object.freeze(value) }; return value }

export type Money = CanonicalDecimal<'MONEY'>
