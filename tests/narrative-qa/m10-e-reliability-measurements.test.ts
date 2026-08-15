import { describe, expect, it } from 'vitest'
import {
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  createChapterStageExchangeabilityAuthorities,
  sortProviderCallObservationsUtf8,
  validateReliabilityObservationSet,
  type CompatibleStratumIdentity,
  type ExecutionProfile,
  type MeasurementState,
} from '../../lib/narrative-qa/reliability'

const HASH = 'a'.repeat(64)
const stratum: CompatibleStratumIdentity = {
  retryFallbackPolicyId: 'retry_v1', retryFallbackPolicyHash: HASH,
  topologyVersion: M10_E_TOPOLOGY_V1.authorityVersion, topologyHash: M10_E_TOPOLOGY_V1.canonicalHash,
  stageCatalogVersion: M10_E_STAGE_CATALOG_V1.authorityVersion, stageCatalogHash: M10_E_STAGE_CATALOG_V1.canonicalHash,
  taskMappingVersion: M10_E_TASK_MAPPING_V1.authorityVersion, taskMappingHash: M10_E_TASK_MAPPING_V1.canonicalHash,
  providerModelPolicyId: 'provider_v1', pricingPolicyVersion: 'pricing_v1', pricingSnapshotHash: HASH,
}
const present = <T>(value: T) => ({ state: 'PRESENT' as const, value })
const missing = { state: 'MISSING' as const, reasonCode: 'TELEMETRY_UNAVAILABLE' as const, detail: 'fixture missing' }

export function validSet() {
  return {
    executionProfile: 'CONTRACT_FIXTURE' as ExecutionProfile,
    compatibleStratum: stratum,
    exchangeabilityAuthorities: createChapterStageExchangeabilityAuthorities('CONTRACT_FIXTURE', stratum),
    declaredApplicableCells: [{ chapterNumber: 1, stageId: 'PROSE_PRIMARY' as const }],
    providerCalls: [{
      observationId: 'call_obs', callAlias: 'call_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a',
      chapterExecutionAlias: 'chapter_a', stageExecutionAlias: 'stage_a', logicalUnitAlias: 'unit_a', chapterNumber: 1,
      generationKind: 'CHAPTER', taskId: 'CHAPTER_PROSE', stageId: 'PROSE_PRIMARY', attemptNumber: 1, fallbackIndex: 0,
      providerModelPolicyId: 'provider_v1', outcome: 'SUCCESS', safeErrorCode: null,
      inputTokens: present(10), outputTokens: present(5), totalTokens: present(15),
      actualCost: present('1.00000000') as MeasurementState<string>, estimatedCost: present('1.10000000') as MeasurementState<string>, currency: 'IDR',
      actualCostSource: 'PROVIDER_REPORTED', pricingSnapshotHash: HASH,
      startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z', elapsedMilliseconds: present('1000.000'),
    }],
    stageOutcomes: [{ observationId: 'stage_obs', stageExecutionAlias: 'stage_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a', chapterExecutionAlias: 'chapter_a', chapterNumber: 1, stageId: 'PROSE_PRIMARY', taskId: 'CHAPTER_PROSE', outcome: 'SUCCESS', providerCallAlias: 'call_a', reachedAt: '2026-08-15T00:00:00.000Z', finalizedAt: '2026-08-15T00:00:01.000Z' }],
    logicalGenerationUnits: [{ observationId: 'unit_obs', logicalUnitAlias: 'unit_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a', chapterExecutionAlias: 'chapter_a', chapterNumber: 1, generationKind: 'CHAPTER', taskId: 'CHAPTER_PROSE', attemptCount: 1, terminalOutcome: 'SUCCESS', fallbackEligible: true, fallbackInvoked: false, startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z', elapsedMilliseconds: present('1000.000') }],
    recoveryActions: [], publicationAttempts: [], canonicalInvariantChecks: [],
    chapterExecutions: [{ observationId: 'chapter_obs', chapterExecutionAlias: 'chapter_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a', chapterNumber: 1, terminalOutcome: 'SUCCESS', generationCost: present('1.00000000'), currency: 'IDR', startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z' }],
    novelExecutions: [{ observationId: 'novel_obs', novelExecutionAlias: 'novel_a', storyAlias: 'story_a', terminalOutcome: 'PARTIAL_FAILURE', completedChapterNumbers: [1], generationCost: present('1.00000000'), currency: 'IDR', startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z' }],
    judgeEvaluations: [],
  }
}

describe('M10-E strict reliability measurements', () => {
  it('validates strict safe records and relational identities', () => {
    expect(validateReliabilityObservationSet(validSet()).providerCalls[0]?.totalTokens).toEqual(present(15))
    expect(() => validateReliabilityObservationSet({ ...validSet(), secret: 'forbidden' })).toThrow()
  })

  it.each([
    ['token total', (set: ReturnType<typeof validSet>) => { set.providerCalls[0]!.totalTokens = present(14) }],
    ['task mapping', (set: ReturnType<typeof validSet>) => { set.stageOutcomes[0]!.taskId = 'RUNTIME_RECOVERY' as 'CHAPTER_PROSE' }],
    ['missing call', (set: ReturnType<typeof validSet>) => { set.providerCalls = [] }],
    ['timing', (set: ReturnType<typeof validSet>) => { set.providerCalls[0]!.endedAt = '2026-08-14T00:00:00.000Z' }],
    ['policy', (set: ReturnType<typeof validSet>) => { set.providerCalls[0]!.providerModelPolicyId = 'other' }],
    ['pricing hash', (set: ReturnType<typeof validSet>) => { set.providerCalls[0]!.pricingSnapshotHash = 'b'.repeat(64) }],
    ['currency', (set: ReturnType<typeof validSet>) => { set.chapterExecutions[0]!.currency = 'USD' }],
  ])('rejects invalid %s', (_name, mutate) => {
    const set = structuredClone(validSet())
    mutate(set)
    expect(() => validateReliabilityObservationSet(set)).toThrow()
  })

  it('rejects duplicate and gapped attempts', () => {
    for (const attemptNumbers of [[1, 1], [1, 3]]) {
      const set = structuredClone(validSet())
      const second = structuredClone(set.providerCalls[0]!)
      second.observationId = `call_${attemptNumbers[1]}`
      second.callAlias = `call_${attemptNumbers[1]}`
      second.stageExecutionAlias = `stage_${attemptNumbers[1]}`
      second.attemptNumber = attemptNumbers[1]!
      set.providerCalls[0]!.attemptNumber = attemptNumbers[0]!
      set.providerCalls.push(second)
      set.logicalGenerationUnits[0]!.attemptCount = 2
      expect(() => validateReliabilityObservationSet(set)).toThrow()
    }
  })

  it('sorts semantic aliases by UTF-8 bytes, not locale', () => {
    const calls = validateReliabilityObservationSet(validSet()).providerCalls
    const sortable = [calls[0]!, { ...calls[0]!, observationId: 'z', callAlias: 'z_call' }, { ...calls[0]!, observationId: 'underscore', callAlias: '_call' }]
    expect(sortProviderCallObservationsUtf8(sortable).map((call) => call.callAlias)).toEqual(['_call', 'call_a', 'z_call'])
  })

  it('keeps missing token and cost telemetry distinct from zero', () => {
    const set = validSet()
    set.providerCalls[0]!.actualCost = missing
    set.providerCalls[0]!.inputTokens = present(0)
    set.providerCalls[0]!.outputTokens = present(0)
    set.providerCalls[0]!.totalTokens = present(0)
    expect(validateReliabilityObservationSet(set).providerCalls[0]!.actualCost.state).toBe('MISSING')
  })
})
