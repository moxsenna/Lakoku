import { describe, expect, it } from 'vitest'
import { aggregateReliabilityObservations, classifyReliabilityObservations, createChapterStageExchangeabilityAuthorities, createFixtureTopologyAuthority } from '../../lib/narrative-qa/reliability'
import { addSuccessfulCompleteNovel, validSet } from './m10-e-reliability-measurements.test'

function appendCopies<T extends Record<string, unknown>>(target: T[], source: T[], index: number): void {
  target.push(...structuredClone(source).map((item) => Object.fromEntries(Object.entries(item).map(([field, value]) => [field,
    typeof value === 'string' && (field === 'observationId' || field === 'storyAlias' || field.endsWith('Alias')) ? `${value}_${index}` : value])) as T))
}

function repeatedStageSet(profile: 'CONTRACT_FIXTURE' | 'RELEASE_EVIDENCE', count: number) {
  const template = validSet()
  const set = validSet()
  set.providerCalls = []; set.stageOutcomes = []; set.logicalGenerationUnits = []; set.recoveryActions = []; set.publicationAttempts = []
  set.canonicalInvariantChecks = []; set.chapterExecutions = []; set.novelExecutions = []; set.judgeEvaluations = []
  for (let index = 0; index < count; index += 1) {
    appendCopies(set.providerCalls, template.providerCalls, index); appendCopies(set.stageOutcomes, template.stageOutcomes, index)
    appendCopies(set.logicalGenerationUnits, template.logicalGenerationUnits, index); appendCopies(set.recoveryActions, template.recoveryActions, index)
    appendCopies(set.publicationAttempts, template.publicationAttempts, index); appendCopies(set.canonicalInvariantChecks, template.canonicalInvariantChecks, index)
    appendCopies(set.chapterExecutions, template.chapterExecutions, index); appendCopies(set.novelExecutions, template.novelExecutions, index)
    appendCopies(set.judgeEvaluations, template.judgeEvaluations, index)
  }
  set.executionProfile = profile
  set.exchangeabilityAuthorities = createChapterStageExchangeabilityAuthorities(profile, set.compatibleStratum)
  if (profile === 'RELEASE_EVIDENCE') set.declaredApplicableCells = Array.from({ length: 50 }, (_, chapter) => set.exchangeabilityAuthorities.map(({ stageId }) => ({ chapterNumber: chapter + 1, stageId }))).flat()
  return set
}

function fullFixtureSet() {
  const set = validSet()
  const chapter = set.chapterExecutions[0]!
  const path = [
    ['PROSE_PRIMARY', 'FAILURE', 'CHAPTER_PROSE'], ['PROSE_RETRY', 'FAILURE', 'CHAPTER_PROSE'], ['PROVIDER_FALLBACK', 'FAILURE', 'CHAPTER_PROSE'], ['CHECKPOINT_RECOVERY', 'SUCCESS', 'RUNTIME_RECOVERY'],
    ['STRUCTURED_OUTPUT', 'FAILURE', 'CHAPTER_STRUCTURED_OUTPUT'], ['STRUCTURED_RETRY', 'SUCCESS', 'CHAPTER_STRUCTURED_OUTPUT'], ['OWNERSHIP', 'FAILURE', 'RUNTIME_RECOVERY'], ['OWNERSHIP_RECOVERY', 'SUCCESS', 'RUNTIME_RECOVERY'],
    ['PUBLICATION', 'FAILURE', 'RUNTIME_RECOVERY'], ['PUBLICATION_RECOVERY', 'SUCCESS', 'RUNTIME_RECOVERY'], ['POST_PUBLISH', 'SUCCESS', 'RUNTIME_RECOVERY'],
  ] as const
  set.providerCalls = []; set.stageOutcomes = []; set.logicalGenerationUnits = []; set.recoveryActions = []
  let proseAttempt = 0; let structuredAttempt = 0
  path.forEach(([stageId, outcome, taskId], index) => {
    const stageExecutionAlias = `full_stage_${index}`
    const provider = taskId !== 'RUNTIME_RECOVERY'
    const callAlias = provider ? `full_call_${index}` : null
    set.stageOutcomes.push({ sourceRef: 'fixture.telemetry', observationId: `full_stage_obs_${index}`, stageExecutionAlias, storyAlias: chapter.storyAlias, novelExecutionAlias: chapter.novelExecutionAlias, chapterExecutionAlias: chapter.chapterExecutionAlias, chapterNumber: 1, stageId, taskId, outcome, providerCallAlias: callAlias as string | null, reachedAt: `2026-08-15T00:00:${String(index * 2).padStart(2, '0')}.000Z`, finalizedAt: `2026-08-15T00:00:${String(index * 2 + 1).padStart(2, '0')}.000Z` })
    if (provider) { const prose = taskId === 'CHAPTER_PROSE'; const attemptNumber = prose ? ++proseAttempt : ++structuredAttempt; set.providerCalls.push({ ...structuredClone(validSet().providerCalls[0]!), observationId: `full_call_obs_${index}`, callAlias: callAlias!, stageExecutionAlias, logicalUnitAlias: prose ? 'full_prose' : 'full_structured', stageId, taskId, attemptNumber, fallbackIndex: stageId === 'PROVIDER_FALLBACK' ? 1 : 0, outcome, safeErrorCode: null, startedAt: `2026-08-15T00:00:${String(index * 2).padStart(2, '0')}.000Z`, endedAt: `2026-08-15T00:00:${String(index * 2 + 1).padStart(2, '0')}.000Z` }) }
    if (['PROSE_RETRY', 'CHECKPOINT_RECOVERY', 'STRUCTURED_RETRY', 'OWNERSHIP_RECOVERY', 'PUBLICATION_RECOVERY'].includes(stageId)) set.recoveryActions.push({ sourceRef: 'fixture.telemetry', observationId: `recovery_obs_${index}`, recoveryAlias: `recovery_${index}`, storyAlias: chapter.storyAlias, novelExecutionAlias: chapter.novelExecutionAlias, chapterExecutionAlias: chapter.chapterExecutionAlias, chapterNumber: 1, stageExecutionAlias, stageId, taskId, recoveryKind: stageId === 'OWNERSHIP_RECOVERY' ? 'OWNERSHIP_LOSS' : stageId === 'CHECKPOINT_RECOVERY' ? 'CHECKPOINT_RESUME' : 'RETRY', terminalOutcome: outcome, checkpointDecisionObserved: true, reusedExactValidCheckpoint: true, choiceRetryAfterValidProseCheckpoint: stageId === 'PROSE_RETRY', regeneratedProse: stageId === 'PROSE_RETRY', manualDatabaseMutation: false, startedAt: `2026-08-15T00:00:${String(index * 2).padStart(2, '0')}.000Z`, endedAt: `2026-08-15T00:00:${String(index * 2 + 1).padStart(2, '0')}.000Z`, elapsedMilliseconds: { state: 'PRESENT', value: '1000.000' } })
  })
  set.logicalGenerationUnits.push({ ...structuredClone(validSet().logicalGenerationUnits[0]!), observationId: 'full_prose_obs', logicalUnitAlias: 'full_prose', attemptCount: 3, terminalOutcome: 'FAILURE', fallbackInvoked: true, endedAt: '2026-08-15T00:00:05.000Z', elapsedMilliseconds: { state: 'PRESENT', value: '5000.000' } }, { ...structuredClone(validSet().logicalGenerationUnits[1]!), observationId: 'full_structured_obs', logicalUnitAlias: 'full_structured', attemptCount: 2, terminalOutcome: 'SUCCESS', fallbackEligible: false, endedAt: '2026-08-15T00:00:11.000Z', elapsedMilliseconds: { state: 'PRESENT', value: '9000.000' } })
  set.publicationAttempts = [{ sourceRef: 'fixture.telemetry', observationId: 'publication_obs', publicationAttemptAlias: 'publication_a', storyAlias: chapter.storyAlias, novelExecutionAlias: chapter.novelExecutionAlias, chapterExecutionAlias: chapter.chapterExecutionAlias, chapterNumber: 1, outcome: 'SUCCESS', producedDuplicateCanonicalPublication: false, attemptedAt: '2026-08-15T00:00:18.000Z' }]
  set.canonicalInvariantChecks = [{ sourceRef: 'fixture.telemetry', observationId: 'invariant_obs', invariantCheckAlias: 'invariant_a', storyAlias: chapter.storyAlias, novelExecutionAlias: chapter.novelExecutionAlias, chapterExecutionAlias: chapter.chapterExecutionAlias, chapterNumber: 1, outcome: 'VALID', checkedAt: '2026-08-15T00:00:22.000Z' }]
  chapter.generationCost = { state: 'PRESENT', value: '5.00000000' }; chapter.endedAt = '2026-08-15T00:00:22.000Z'
  set.novelExecutions[0]!.generationCost = { state: 'PRESENT', value: '5.00000000' }; set.novelExecutions[0]!.endedAt = chapter.endedAt
  set.declaredApplicableCells = path.map(([stageId]) => ({ chapterNumber: 1, stageId })); set.fixtureTopologyAuthority = createFixtureTopologyAuthority(set.declaredApplicableCells)
  return set
}

describe('M10-E profile completeness thresholds', () => {
  it.each([[0, false], [1, true]] as const)('fixture stage pool %i completeness is %s', (count, expected) => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', count))
    expect(aggregate.profileCompleteness.stagePools.find((pool) => pool.stageId === 'PROSE_PRIMARY')?.complete).toBe(expected)
  })

  it.each([[29, false], [30, true], [31, true]] as const)('release stage pool %i completeness is %s', (count, expected) => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('RELEASE_EVIDENCE', count))
    expect(aggregate.profileCompleteness.stagePools.find((pool) => pool.stageId === 'PROSE_PRIMARY')?.complete).toBe(expected)
  })

  it.each([[0, false], [1, true]] as const)('applicable cell %i completeness is %s', (count, expected) => {
    const set = repeatedStageSet('CONTRACT_FIXTURE', count)
    const aggregate = aggregateReliabilityObservations(set)
    expect(aggregate.profileCompleteness.applicableCells[0]?.complete).toBe(expected)
  })

  it.each([[9, false], [10, true], [11, true]] as const)('release complete novel count %i completeness is %s', (count, expected) => {
    const set = repeatedStageSet('RELEASE_EVIDENCE', 30)
    for (let index = 0; index < count; index += 1) addSuccessfulCompleteNovel(set, `release_${index}`)
    expect(aggregateReliabilityObservations(set).profileCompleteness.completeNovels).toMatchObject({ minimum: 10, observed: count, complete: expected })
  })

  it('rejects duplicate, extra, missing, and impossible fixture cells against exact fixture topology authority', () => {
    for (const mutate of [
      (set: ReturnType<typeof validSet>) => { set.declaredApplicableCells.push(set.declaredApplicableCells[0]!) },
      (set: ReturnType<typeof validSet>) => { set.declaredApplicableCells.push({ chapterNumber: 1, stageId: 'PROSE_RETRY' }) },
      (set: ReturnType<typeof validSet>) => { set.declaredApplicableCells = [] },
      (set: ReturnType<typeof validSet>) => { set.fixtureTopologyAuthority = createFixtureTopologyAuthority([{ chapterNumber: 1, stageId: 'PROSE_RETRY' }]) },
    ]) {
      const set = structuredClone(validSet())
      mutate(set)
      expect(() => aggregateReliabilityObservations(set)).toThrow()
    }
  })

  it('requires release declaration to contain exact 50 by applicable stage cells', () => {
    const set = repeatedStageSet('RELEASE_EVIDENCE', 30)
    set.declaredApplicableCells = set.declaredApplicableCells.slice(1)
    expect(() => aggregateReliabilityObservations(set)).toThrow(/release applicable cells/i)
  })

  it('does not repair empty observed pool with exchangeability authority or forge observation refs', () => {
    const aggregate = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', 0))
    const probability = aggregate.centralStageFailureProbabilities.find((metric) => metric.stageId === 'PROSE_PRIMARY')!
    expect(probability.failureProbability.provenance).toBe('OBSERVED')
    expect(probability.failureProbability.value.state).toBe('MISSING')
    expect(probability.denominator).toBe(0)
    expect(probability.observationRefs).toEqual([])
    expect(probability.failureProbability.observationRefs).toEqual([])
    expect(probability.counts).toEqual({ includedCount: 0, excludedCount: 0, unavailableCount: 0, eligibleCount: 0 })
  })

  it('classifies coverage deficiency HOLD with deterministic reason codes', () => {
    const incomplete = aggregateReliabilityObservations(repeatedStageSet('CONTRACT_FIXTURE', 0)).profileCompleteness
    expect(incomplete.engineeringGate).toBe('HOLD')
    expect(incomplete.reasonCodes).toEqual(['STAGE_POOL_THRESHOLD_NOT_MET', 'APPLICABLE_CELL_COVERAGE_INCOMPLETE'])
  })

  it('classifies complete P4 contract fixture PASS and orders HOLD/FAIL reasons exactly', () => {
    const complete = fullFixtureSet()
    const completeResult = classifyReliabilityObservations(complete)
    if ('error' in completeResult) throw new Error(completeResult.error)
    expect(completeResult).toMatchObject({ engineeringGate: 'PASS', reasonCodes: [] })

    const hold = fullFixtureSet()
    hold.recoveryActions = []
    expect(classifyReliabilityObservations(hold)).toMatchObject({ engineeringGate: 'HOLD', reasonCodes: [
      'RETRY_RECOVERY_FALLBACK_COVERAGE_INCOMPLETE', 'LATENCY_COVERAGE_INCOMPLETE',
    ] })

    const fail = fullFixtureSet()
    fail.publicationAttempts[0]!.producedDuplicateCanonicalPublication = true
    fail.canonicalInvariantChecks[0]!.outcome = 'CORRUPT'
    expect(classifyReliabilityObservations(fail)).toMatchObject({ engineeringGate: 'FAIL', reasonCodes: [
      'DUPLICATE_PUBLICATION_DETECTED', 'CANONICAL_CORRUPTION_DETECTED',
    ] })
  })

  it('classifies malformed authority FAIL without converting coverage HOLD', () => {
    const malformed = repeatedStageSet('CONTRACT_FIXTURE', 1)
    malformed.exchangeabilityAuthorities = malformed.exchangeabilityAuthorities.slice(1)
    expect(classifyReliabilityObservations(malformed)).toMatchObject({ engineeringGate: 'FAIL', reasonCodes: ['MALFORMED_EVIDENCE'] })
  })

  it('rejects missing, malformed, or incompatible exchangeability rather than holding', () => {
    const missing = repeatedStageSet('CONTRACT_FIXTURE', 1)
    missing.exchangeabilityAuthorities = missing.exchangeabilityAuthorities.slice(1)
    expect(() => aggregateReliabilityObservations(missing)).toThrow()

    const incompatible = repeatedStageSet('CONTRACT_FIXTURE', 1)
    incompatible.exchangeabilityAuthorities = structuredClone(incompatible.exchangeabilityAuthorities)
    incompatible.exchangeabilityAuthorities[0]!.compatibleStratum.providerModelPolicyId = 'other'
    expect(() => aggregateReliabilityObservations(incompatible)).toThrow()
  })
})
