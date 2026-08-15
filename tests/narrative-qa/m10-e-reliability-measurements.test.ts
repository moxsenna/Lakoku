import { describe, expect, it } from 'vitest'
import {
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  M10_E_TOPOLOGY_V1,
  createChapterStageExchangeabilityAuthorities,
  createFixtureTopologyAuthority,
  createJudgePlanAuthority,
  createObservationSourceAuthority,
  createTimingSourceAuthority,
  getStageSemantics,
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
function getRuntimeAuthority() {
  const applicability = getStageSemantics('OWNERSHIP').providerCall
  if (applicability.state !== 'NOT_APPLICABLE') throw new Error('Expected runtime authority')
  return applicability.authority
}

export function addSuccessfulCompleteNovel(set: ReturnType<typeof validSet>, suffix: string, generationCost = '100.00000000') {
  const novelExecutionAlias = `novel_${suffix}`
  const storyAlias = `story_${suffix}`
  set.novelExecutions.push({ ...structuredClone(set.novelExecutions[0]!), observationId: `novel_obs_${suffix}`, novelExecutionAlias, storyAlias, terminalOutcome: 'SUCCESS', completedChapterNumbers: Array.from({ length: 50 }, (_, index) => index + 1), generationCost: present(generationCost) })
  for (let chapterNumber = 1; chapterNumber <= 50; chapterNumber += 1) {
    const chapterExecutionAlias = `chapter_${suffix}_${chapterNumber}`
    set.chapterExecutions.push({ ...structuredClone(set.chapterExecutions[0]!), observationId: `chapter_obs_${suffix}_${chapterNumber}`, novelExecutionAlias, storyAlias, chapterExecutionAlias, chapterNumber, generationCost: present('2.00000000') })
    set.stageOutcomes.push(...set.stageOutcomes.slice(0, 5).map((stage, index) => ({ ...structuredClone(stage), observationId: `stage_obs_${suffix}_${chapterNumber}_${index}`, stageExecutionAlias: `stage_${suffix}_${chapterNumber}_${index}`, storyAlias, novelExecutionAlias, chapterExecutionAlias, chapterNumber, providerCallAlias: stage.providerCallAlias === null ? null : `call_${suffix}_${chapterNumber}_${index}` })))
    set.providerCalls.push(...set.providerCalls.slice(0, 2).map((call, index) => ({ ...structuredClone(call), observationId: `call_obs_${suffix}_${chapterNumber}_${index}`, callAlias: `call_${suffix}_${chapterNumber}_${index}`, stageExecutionAlias: `stage_${suffix}_${chapterNumber}_${index}`, logicalUnitAlias: `unit_${suffix}_${chapterNumber}_${index}`, storyAlias, novelExecutionAlias, chapterExecutionAlias, chapterNumber })))
    set.logicalGenerationUnits.push(...set.logicalGenerationUnits.slice(0, 2).map((unit, index) => ({ ...structuredClone(unit), observationId: `unit_obs_${suffix}_${chapterNumber}_${index}`, logicalUnitAlias: `unit_${suffix}_${chapterNumber}_${index}`, storyAlias, novelExecutionAlias, chapterExecutionAlias, chapterNumber })))
  }
  set.judgeEvaluations.push(...set.judgePlanAuthority.evaluations.map((entry, index) => ({ sourceRef: 'fixture.telemetry', observationId: `judge_obs_${suffix}_${index}`, judgeEvaluationAlias: `judge_${suffix}_${index}`, storyAlias, novelExecutionAlias, ...entry, outcome: 'SUCCESS', cost: present('0.00000000'), currency: 'IDR', startedAt: '2026-08-15T00:00:01.000Z', endedAt: '2026-08-15T00:00:02.000Z' })))
}

export function validSet() {
  const set = {
    executionProfile: 'CONTRACT_FIXTURE' as ExecutionProfile,
    compatibleStratum: stratum,
    exchangeabilityAuthorities: createChapterStageExchangeabilityAuthorities('CONTRACT_FIXTURE', stratum),
    observationSourceAuthority: createObservationSourceAuthority(),
    timingSourceAuthority: createTimingSourceAuthority(),
    fixtureTopologyAuthority: createFixtureTopologyAuthority([{ chapterNumber: 1, stageId: 'PROSE_PRIMARY' }]),
    judgePlanAuthority: createJudgePlanAuthority('provider_v1', 'IDR'),
    declaredApplicableCells: [{ chapterNumber: 1, stageId: 'PROSE_PRIMARY' as (typeof M10_E_STAGE_CATALOG_V1.stages)[number] }],
    providerCalls: [{
      sourceRef: 'fixture.telemetry', observationId: 'call_obs', callAlias: 'call_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a',
      chapterExecutionAlias: 'chapter_a', stageExecutionAlias: 'stage_a', logicalUnitAlias: 'unit_a', chapterNumber: 1,
      generationKind: 'CHAPTER', taskId: 'CHAPTER_PROSE', stageId: 'PROSE_PRIMARY', attemptNumber: 1, fallbackIndex: 0,
      providerModelPolicyId: 'provider_v1', outcome: 'SUCCESS', safeErrorCode: null,
      inputTokens: present(10), outputTokens: present(5), totalTokens: present(15),
      actualCost: present('1.00000000') as MeasurementState<string>, estimatedCost: present('1.10000000') as MeasurementState<string>, currency: 'IDR',
      actualCostSource: 'PROVIDER_REPORTED', pricingSnapshotHash: HASH,
      startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z', elapsedMilliseconds: present('1000.000'),
    }],
    stageOutcomes: [{ sourceRef: 'fixture.telemetry', observationId: 'stage_obs', stageExecutionAlias: 'stage_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a', chapterExecutionAlias: 'chapter_a', chapterNumber: 1, stageId: 'PROSE_PRIMARY' as (typeof M10_E_STAGE_CATALOG_V1.stages)[number], taskId: 'CHAPTER_PROSE', outcome: 'SUCCESS', providerCallAlias: 'call_a' as string | null, reachedAt: '2026-08-15T00:00:00.000Z', finalizedAt: '2026-08-15T00:00:01.000Z' }],
    logicalGenerationUnits: [{ sourceRef: 'fixture.telemetry', observationId: 'unit_obs', logicalUnitAlias: 'unit_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a', chapterExecutionAlias: 'chapter_a', chapterNumber: 1, generationKind: 'CHAPTER', taskId: 'CHAPTER_PROSE', attemptCount: 1, terminalOutcome: 'SUCCESS', fallbackEligible: true, fallbackInvoked: false, startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z', elapsedMilliseconds: present('1000.000') }],
    recoveryActions: [] as Array<Record<string, unknown>>, publicationAttempts: [] as Array<Record<string, unknown>>, canonicalInvariantChecks: [] as Array<Record<string, unknown>>,
    chapterExecutions: [{ sourceRef: 'fixture.telemetry', observationId: 'chapter_obs', chapterExecutionAlias: 'chapter_a', storyAlias: 'story_a', novelExecutionAlias: 'novel_a', chapterNumber: 1, terminalOutcome: 'SUCCESS', generationCost: present('1.00000000'), currency: 'IDR', startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z' }],
    novelExecutions: [{ sourceRef: 'fixture.telemetry', observationId: 'novel_obs', novelExecutionAlias: 'novel_a', storyAlias: 'story_a', terminalOutcome: 'PARTIAL_FAILURE', completedChapterNumbers: [1], generationCost: present('1.00000000'), currency: 'IDR', startedAt: '2026-08-15T00:00:00.000Z', endedAt: '2026-08-15T00:00:01.000Z' }],
    judgeEvaluations: [] as Array<Record<string, unknown>>,
  }
  const path = [
    ['STRUCTURED_OUTPUT', 'CHAPTER_STRUCTURED_OUTPUT'], ['OWNERSHIP', 'RUNTIME_RECOVERY'], ['PUBLICATION', 'RUNTIME_RECOVERY'], ['POST_PUBLISH', 'RUNTIME_RECOVERY'],
  ] as const
  path.forEach(([stageId, taskId], index) => {
    const stageExecutionAlias = `stage_path_${index}`
    const providerCallAlias = stageId === 'STRUCTURED_OUTPUT' ? 'call_structured' : null
    set.stageOutcomes.push({ ...structuredClone(set.stageOutcomes[0]!), observationId: `stage_path_obs_${index}`, stageExecutionAlias, stageId, taskId, providerCallAlias, reachedAt: `2026-08-15T00:00:0${index + 2}.000Z`, finalizedAt: `2026-08-15T00:00:0${index + 2}.500Z` })
    if (providerCallAlias) {
      set.providerCalls.push({ ...structuredClone(set.providerCalls[0]!), observationId: 'call_structured_obs', callAlias: providerCallAlias, stageExecutionAlias, logicalUnitAlias: 'unit_structured', taskId, stageId, startedAt: '2026-08-15T00:00:02.000Z', endedAt: '2026-08-15T00:00:02.500Z', elapsedMilliseconds: present('500.000') })
      set.logicalGenerationUnits.push({ ...structuredClone(set.logicalGenerationUnits[0]!), observationId: 'unit_structured_obs', logicalUnitAlias: 'unit_structured', taskId, startedAt: '2026-08-15T00:00:02.000Z', endedAt: '2026-08-15T00:00:02.500Z', elapsedMilliseconds: present('500.000') })
    }
  })
  set.chapterExecutions[0]!.generationCost = present('2.00000000')
  set.chapterExecutions[0]!.endedAt = '2026-08-15T00:00:06.000Z'
  set.novelExecutions[0]!.generationCost = present('2.00000000')
  set.novelExecutions[0]!.endedAt = '2026-08-15T00:00:06.000Z'
  set.declaredApplicableCells = set.stageOutcomes.map((stage) => ({ chapterNumber: stage.chapterNumber, stageId: stage.stageId }))
  set.fixtureTopologyAuthority = createFixtureTopologyAuthority(set.declaredApplicableCells)
  return set
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

  it('rejects globally duplicate observation IDs and cross-parent identities on every surface', () => {
    const duplicate = structuredClone(validSet())
    duplicate.stageOutcomes[0]!.observationId = duplicate.providerCalls[0]!.observationId
    expect(() => validateReliabilityObservationSet(duplicate)).toThrow(/observation ID/i)

    const mutations: Array<(set: ReturnType<typeof validSet>) => void> = [
      (set) => { set.providerCalls[0]!.novelExecutionAlias = 'wrong_novel' },
      (set) => { set.stageOutcomes[0]!.chapterExecutionAlias = 'wrong_chapter' },
      (set) => { set.logicalGenerationUnits[0]!.storyAlias = 'wrong_story' },
      (set) => { set.chapterExecutions[0]!.novelExecutionAlias = 'wrong_novel' },
      (set) => { set.novelExecutions[0]!.storyAlias = 'wrong_story' },
    ]
    for (const mutate of mutations) {
      const set = structuredClone(validSet())
      mutate(set)
      expect(() => validateReliabilityObservationSet(set)).toThrow()
    }
  })

  it('binds chapter/novel outcomes and generation costs to linked reached calls', () => {
    for (const mutate of [
      (set: ReturnType<typeof validSet>) => { set.chapterExecutions[0]!.terminalOutcome = 'FAILURE' },
      (set: ReturnType<typeof validSet>) => { set.chapterExecutions[0]!.generationCost = present('3.00000000') },
      (set: ReturnType<typeof validSet>) => { set.novelExecutions[0]!.generationCost = present('3.00000000') },
    ]) {
      const set = structuredClone(validSet())
      mutate(set)
      expect(() => validateReliabilityObservationSet(set)).toThrow()
    }
  })

  it('allows judges only on successful complete novel with exact complete ordered judge plan', () => {
    const set = validSet()
    set.novelExecutions[0]!.terminalOutcome = 'SUCCESS'
    set.novelExecutions[0]!.completedChapterNumbers = Array.from({ length: 50 }, (_, index) => index + 1)
    for (let chapterNumber = 2; chapterNumber <= 50; chapterNumber += 1) {
      const chapterExecutionAlias = `chapter_${chapterNumber}`
      set.chapterExecutions.push({ ...structuredClone(set.chapterExecutions[0]!), observationId: `chapter_obs_${chapterNumber}`, chapterExecutionAlias, chapterNumber, generationCost: present('0.00000000') })
      set.stageOutcomes.push(...set.stageOutcomes.slice(0, 5).map((stage, index) => ({ ...structuredClone(stage), observationId: `stage_obs_${chapterNumber}_${index}`, stageExecutionAlias: `stage_${chapterNumber}_${index}`, chapterExecutionAlias, chapterNumber, providerCallAlias: stage.providerCallAlias === null ? null : `call_${chapterNumber}_${index}` })))
      set.providerCalls.push(...set.providerCalls.slice(0, 2).map((call, index) => ({ ...structuredClone(call), observationId: `call_obs_${chapterNumber}_${index}`, callAlias: `call_${chapterNumber}_${index}`, stageExecutionAlias: `stage_${chapterNumber}_${index}`, logicalUnitAlias: `unit_${chapterNumber}_${index}`, chapterExecutionAlias, chapterNumber, actualCost: present('0.00000000') })))
      set.logicalGenerationUnits.push(...set.logicalGenerationUnits.slice(0, 2).map((unit, index) => ({ ...structuredClone(unit), observationId: `unit_obs_${chapterNumber}_${index}`, logicalUnitAlias: `unit_${chapterNumber}_${index}`, chapterExecutionAlias, chapterNumber })))
    }
    set.judgeEvaluations = set.judgePlanAuthority.evaluations.map((entry, index) => ({
      sourceRef: 'fixture.telemetry', observationId: `judge_obs_${index}`, judgeEvaluationAlias: `judge_${index}`, storyAlias: 'story_a', novelExecutionAlias: 'novel_a',
      ...entry, outcome: 'SUCCESS', cost: present('1.00000000'), currency: 'IDR',
      startedAt: '2026-08-15T00:00:01.000Z', endedAt: '2026-08-15T00:00:02.000Z',
    }))
    expect(() => validateReliabilityObservationSet(set)).not.toThrow()
    for (const mutate of [
      (copy: typeof set) => { copy.novelExecutions[0]!.terminalOutcome = 'PARTIAL_FAILURE' },
      (copy: typeof set) => { copy.judgeEvaluations[0]!.evaluationIndex = 9 },
      (copy: typeof set) => { copy.judgeEvaluations[0]!.providerModelPolicyId = 'other' },
      (copy: typeof set) => { copy.judgeEvaluations.pop() },
      (copy: typeof set) => { copy.judgeEvaluations.reverse() },
    ]) {
      const copy = structuredClone(set)
      mutate(copy)
      expect(() => validateReliabilityObservationSet(copy)).toThrow()
    }
  })

  it('binds authorized observation source and exact microsecond elapsed time without endpoint rounding', () => {
    const set = validSet()
    set.providerCalls[0]!.startedAt = '2026-08-15T00:00:00.000123Z'
    set.providerCalls[0]!.endedAt = '2026-08-15T00:00:01.234690Z'
    set.providerCalls[0]!.elapsedMilliseconds = present('1234.567')
    expect(() => validateReliabilityObservationSet(set)).not.toThrow()

    const elapsedMismatch = structuredClone(set)
    elapsedMismatch.providerCalls[0]!.elapsedMilliseconds = present('1234.568')
    expect(() => validateReliabilityObservationSet(elapsedMismatch)).toThrow(/elapsed/i)

    for (const [start, end] of [['2026-08-15T00:00:00.0004999Z', '2026-08-15T00:00:01.0005000Z'], ['2026-08-15T00:00:00.9999999Z', '2026-08-15T00:00:01.0000000Z']]) {
      const nanosecond = structuredClone(validSet())
      nanosecond.providerCalls[0]!.startedAt = start
      nanosecond.providerCalls[0]!.endedAt = end
      expect(() => validateReliabilityObservationSet(nanosecond)).toThrow(/precision/i)
    }
  })

  it('binds every observation sourceRef to exact normalized authority and rejects copied fault rows', () => {
    const unbound = structuredClone(validSet())
    unbound.providerCalls[0]!.sourceRef = 'other.telemetry'
    expect(() => validateReliabilityObservationSet(unbound)).toThrow(/sourceRef/i)

    for (const sourceRef of ['e1.fault.frequency', 'e2_fault_schedule']) {
      const copied = structuredClone(validSet())
      copied.providerCalls[0]!.sourceRef = sourceRef
      expect(() => validateReliabilityObservationSet(copied)).toThrow(/fault schedule\/frequency/i)
    }
  })

  it('rejects skipped, extra, call-stage, logical-terminal, and novel outcome topology mutations', () => {
    const mutations: Array<(set: ReturnType<typeof validSet>) => void> = [
      (set) => { set.stageOutcomes.splice(1, 1) },
      (set) => { set.stageOutcomes.push({ ...structuredClone(set.stageOutcomes.at(-1)!), observationId: 'extra_stage', stageExecutionAlias: 'extra_stage' }) },
      (set) => { set.providerCalls[0]!.outcome = 'FAILURE' },
      (set) => { set.providerCalls[0]!.outcome = 'FAILURE'; set.stageOutcomes[0]!.outcome = 'FAILURE' },
      (set) => { set.logicalGenerationUnits[0]!.terminalOutcome = 'FAILURE' },
    ]
    for (const mutate of mutations) { const set = structuredClone(validSet()); mutate(set); expect(() => validateReliabilityObservationSet(set)).toThrow() }

    const successful = validSet()
    addSuccessfulCompleteNovel(successful, 'bad_success')
    successful.chapterExecutions.find((chapter) => chapter.novelExecutionAlias === 'novel_bad_success')!.terminalOutcome = 'FAILURE'
    expect(() => validateReliabilityObservationSet(successful)).toThrow(/successful novel|traversal/i)
  })

  it('rejects NOT_APPLICABLE provider measurements', () => {
    const set = validSet()
    set.providerCalls[0]!.actualCost = { state: 'NOT_APPLICABLE', authority: getRuntimeAuthority() }
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
    const sortable = [calls[0]!, { ...calls[0]!, sourceRef: 'fixture.telemetry', observationId: 'z', callAlias: 'z_call' }, { ...calls[0]!, sourceRef: 'fixture.telemetry', observationId: 'underscore', callAlias: '_call' }]
    expect(sortProviderCallObservationsUtf8(sortable).map((call) => call.callAlias)).toEqual(['_call', 'call_a', 'z_call'])
  })

  it('keeps missing token and cost telemetry distinct from zero', () => {
    const set = validSet()
    set.providerCalls[0]!.actualCost = missing
    Object.assign(set.chapterExecutions[0]!, { generationCost: missing })
    Object.assign(set.novelExecutions[0]!, { generationCost: missing })
    set.providerCalls[0]!.inputTokens = present(0)
    set.providerCalls[0]!.outputTokens = present(0)
    set.providerCalls[0]!.totalTokens = present(0)
    expect(validateReliabilityObservationSet(set).providerCalls[0]!.actualCost.state).toBe('MISSING')
  })
})
