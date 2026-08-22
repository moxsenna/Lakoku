import { describe, expect, it } from 'vitest'
import {
  computeReliabilitySemanticHash,
  computeReportHash,
  recomputeModelInputHash,
  toCumulativeModelInput,
  validateReliabilityArtifactPair,
  validateReliabilitySemanticArtifact,
} from '../../lib/narrative-qa/reliability'
import {
  buildValidatedArtifactPairFixture,
  rawEnvelopeForMutation,
} from './m10-e-reliability-artifact-fixture'

const FIXTURE = buildValidatedArtifactPairFixture()

function cloneArtifact(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(FIXTURE.artifact)) as Record<string, unknown>
}

function mutatedArtifact(mutate: (value: Record<string, unknown>) => void): Record<string, unknown> {
  const clone = cloneArtifact()
  mutate(clone)
  return clone
}

const assertRejected = (mutate: (value: Record<string, unknown>) => void): void => {
  expect(() => validateReliabilitySemanticArtifact(mutatedArtifact(mutate))).toThrow()
}

describe('validateReliabilitySemanticArtifact — positive fixture', () => {
  it('validates the frozen fixture payload deterministically', () => {
    const first = validateReliabilitySemanticArtifact(FIXTURE.artifact)
    const second = validateReliabilitySemanticArtifact(FIXTURE.artifact)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('freezes the validated artifact tree', () => {
    const validated = validateReliabilitySemanticArtifact(FIXTURE.artifact)
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated.aggregate)).toBe(true)
    expect(Object.isFrozen(validated.observations)).toBe(true)
    expect(Object.isFrozen(validated.model.output)).toBe(true)
  })

  it('carries the expected gate and budget verdicts', () => {
    const verdict = FIXTURE.artifact.engineeringGate.result
    expect(verdict.engineeringGate).toBe('PASS')
    expect(verdict.releaseReadiness).toBe('HOLD')
    expect(verdict.budgetGate).toBe('BLOCKED_E0_COST_CEILING_NOT_APPROVED')
    expect(verdict.e0BudgetStatus).toBe('NOT_APPROVED_BLOCKED')
    expect(verdict.reasonCodes).toEqual([])
    expect(verdict.closure).toEqual({ G2_BUDGET: 'OPEN', M10_E: 'OPEN' })
    expect(FIXTURE.artifact.reasonCodes).toEqual([])
  })

  it('recomputes the artifact semantic hash over itself minus its own hash', () => {
    const { artifactSemanticHash: _own, ...payload } = cloneArtifact()
    expect(computeReliabilitySemanticHash(payload)).toBe(FIXTURE.artifact.artifactSemanticHash)
  })

  it('keeps the artifact semantic hash off the observation and aggregate hashes', () => {
    expect(FIXTURE.artifact.artifactSemanticHash).toMatch(/^[0-9a-f]{64}$/)
    expect(FIXTURE.artifact.observationHash).toMatch(/^[0-9a-f]{64}$/)
    expect(FIXTURE.artifact.aggregateHash).toMatch(/^[0-9a-f]{64}$/)
    expect(FIXTURE.artifact.artifactSemanticHash).not.toBe(FIXTURE.artifact.observationHash)
    expect(FIXTURE.artifact.artifactSemanticHash).not.toBe(FIXTURE.artifact.aggregateHash)
  })

  it('reproduces the stored model input hash from the model input record', () => {
    const input = toCumulativeModelInput(FIXTURE.artifact.model.input)
    expect(recomputeModelInputHash(input)).toBe(FIXTURE.artifact.model.output.inputHash)
    expect(recomputeModelInputHash(input)).toBe(recomputeModelInputHash(input))
  })
})

describe('validateReliabilitySemanticArtifact — schema and identity', () => {
  it('rejects an unknown schema version', () => {
    assertRejected((value) => { value.schemaVersion = 'M10_E_RELIABILITY_SEMANTIC_PAYLOAD_V2' })
  })

  it('rejects a source authority not bound to the execution profile', () => {
    assertRejected((value) => { value.sourceAuthority = 'GOVERNED_DISPOSABLE_LOCAL' })
  })

  it('rejects a base git sha that is not 64 hex', () => {
    assertRejected((value) => { value.baseGitSha = 'not-a-git-sha' })
  })

  it('rejects a malformed e2 closure reference', () => {
    assertRejected((value) => { value.e2ClosureReference = 'd'.repeat(63) })
  })

  it('rejects an observation hash that does not recompute', () => {
    assertRejected((value) => { value.observationHash = '0'.repeat(64) })
  })

  it('rejects an aggregate hash that does not recompute', () => {
    assertRejected((value) => { value.aggregateHash = '0'.repeat(64) })
  })
})

describe('validateReliabilitySemanticArtifact — observation mutations', () => {
  it('rejects mixed currencies in observations', () => {
    assertRejected((value) => {
      const observations = value.observations as { providerCalls: { currency: string }[] }
      observations.providerCalls[0]!.currency = 'USD'
    })
  })

  it('rejects a chapter generation cost that no longer equals linked call costs', () => {
    assertRejected((value) => {
      const observations = value.observations as { chapterExecutions: { generationCost: { state: string; value: string } }[] }
      observations.chapterExecutions[0]!.generationCost = { state: 'PRESENT', value: '1.00000000' }
    })
  })

  it('rejects a provider call cost that breaks the exact call-cost sum binding', () => {
    assertRejected((value) => {
      const observations = value.observations as { providerCalls: { actualCost: { state: string; value: string } }[] }
      observations.providerCalls[0]!.actualCost = { state: 'PRESENT', value: '0.51000000' }
    })
  })

  it('rejects a recovery kind mutation that changes the observed evidence', () => {
    assertRejected((value) => {
      const observations = value.observations as { recoveryActions: { recoveryKind: string }[] }
      observations.recoveryActions[0]!.recoveryKind = 'STALE_LEASE_RECLAIM'
    })
  })

  it('rejects a dropped mandatory observation field', () => {
    assertRejected((value) => {
      const observations = value.observations as { publicationAttempts: Record<string, unknown>[] }
      delete observations.publicationAttempts[0]!.producedDuplicateCanonicalPublication
    })
  })
})

describe('validateReliabilitySemanticArtifact — comparators and diagnostics', () => {
  it('rejects an observed budget comparator mutation', () => {
    assertRejected((value) => {
      const comparators = value.comparators as { observed: { maxObservedMeanGenerationCostPerChapter: { value: { state: string; value: string } } } }
      comparators.observed.maxObservedMeanGenerationCostPerChapter.value = { state: 'PRESENT', value: '9.00000000' }
    })
  })

  it('rejects an observed cost diagnostics mutation', () => {
    assertRejected((value) => {
      const comparators = value.comparators as { observedDiagnostics: { observedBaselineCost: { value: { state: string; value: string } } } }
      comparators.observedDiagnostics.observedBaselineCost.value = { state: 'PRESENT', value: '9.00000000' }
    })
  })

  it('rejects a modeled chapter comparator mutation', () => {
    assertRejected((value) => {
      const comparators = value.comparators as { modeled: { maxExpectedCostPerChapter: { state: string; value: string } } }
      comparators.modeled.maxExpectedCostPerChapter = { state: 'PRESENT', value: '9.00000000' }
    })
  })

  it('rejects a retry-overhead comparator outside canonical percentage scale', () => {
    assertRejected((value) => {
      const comparators = value.comparators as { modeled: { maxRetryOverheadPercentage: { state: string; value: string } } }
      comparators.modeled.maxRetryOverheadPercentage = { state: 'PRESENT', value: '173.3333333' }
    })
  })
})

describe('validateReliabilitySemanticArtifact — budget and gate', () => {
  it('rejects a budget result that does not recompute', () => {
    assertRejected((value) => {
      const budget = value.budget as { result: { budgetGate: string } }
      budget.result.budgetGate = 'PASS'
    })
  })

  it('rejects a budget currency foreign to the observation currency', () => {
    assertRejected((value) => {
      const budget = value.budget as { input: { currency: string } }
      budget.input.currency = 'USD'
    })
  })

  it('rejects an e0 authority that changes the budget evaluation', () => {
    assertRejected((value) => {
      const budget = value.budget as { input: { e0Authority: unknown } }
      budget.input.e0Authority = { authorityVersion: 'M10_E_BUDGET_AUTHORITY_V1' }
    })
  })

  it('rejects a stored engineering gate verdict that does not recompute', () => {
    assertRejected((value) => {
      const gate = value.engineeringGate as { result: { engineeringGate: string } }
      gate.result.engineeringGate = 'HOLD'
    })
  })

  it('rejects a gate evidence classification that diverges from completeness', () => {
    assertRejected((value) => {
      const gate = value.engineeringGate as { input: { evidence: { engineeringGate: string } } }
      gate.input.evidence.engineeringGate = 'HOLD'
    })
  })

  it('rejects a completeness classification that diverges from gate evidence', () => {
    assertRejected((value) => {
      const completeness = value.completeness as { engineeringGate: string }
      completeness.engineeringGate = 'HOLD'
    })
  })

  it('rejects stored gate reason codes that do not recompute', () => {
    assertRejected((value) => { value.reasonCodes = ['MISSING_MEASUREMENT'] })
  })

  it('rejects an artifact pair validity flip', () => {
    assertRejected((value) => {
      const gate = value.engineeringGate as { input: { artifactPairValid: boolean | null } }
      gate.input.artifactPairValid = false
    })
  })
})

describe('validateReliabilitySemanticArtifact — authorities section', () => {
  it('rejects a pricing snapshot hash that unbinds from the stratum', () => {
    assertRejected((value) => {
      const authorities = value.authorities as { pricingSnapshotHash: string }
      authorities.pricingSnapshotHash = '0'.repeat(64)
    })
  })

  it('rejects a judge plan authority whose hash does not recompute', () => {
    assertRejected((value) => {
      const authorities = value.authorities as { judgePlan: { canonicalHash: string } }
      authorities.judgePlan.canonicalHash = '0'.repeat(64)
    })
  })

  it('rejects an independent-draw correlation authority whose hash does not recompute', () => {
    assertRejected((value) => {
      const authorities = value.authorities as { independentDrawCorrelation: { canonicalHash: string } }
      authorities.independentDrawCorrelation.canonicalHash = '0'.repeat(64)
    })
  })

  it('rejects an exchangeability authority with mutated chapter scope', () => {
    assertRejected((value) => {
      const authorities = value.authorities as { exchangeability: { chapters: number[] }[] }
      authorities.exchangeability[0]!.chapters[0] = 99
    })
  })

  it('rejects a stage catalog authority version flip', () => {
    assertRejected((value) => {
      const authorities = value.authorities as { stageCatalog: { authorityVersion: string } }
      authorities.stageCatalog.authorityVersion = 'M10_E_STAGE_CATALOG_V2'
    })
  })
})

describe('validateReliabilitySemanticArtifact — model section', () => {
  it('rejects a model input iterations deviation', () => {
    assertRejected((value) => {
      const model = value.model as { input: { iterations: number } }
      model.input.iterations = 99999
    })
  })

  it('rejects an unknown central stage probability key', () => {
    assertRejected((value) => {
      const model = value.model as { input: { centralStageProbabilities: { stageId: string }[] } }
      model.input.centralStageProbabilities[0]!.stageId = 'BOGUS_STAGE'
    })
  })

  it('rejects a model output hash mutation', () => {
    assertRejected((value) => {
      const model = value.model as { output: { outputHash: string } }
      model.output.outputHash = '0'.repeat(64)
    })
  })

  it('rejects a model result mutation on a cache hit', () => {
    assertRejected((value) => {
      const model = value.model as { output: { result: { maxExpectedCostPerChapter: { state: string; value: string } } } }
      model.output.result.maxExpectedCostPerChapter = { state: 'PRESENT', value: '9.00000000' }
    })
  })

  it('rejects an observed chapter cost mean mutation', () => {
    assertRejected((value) => {
      const means = value.observedChapterCostMeans as { state: string; value: string }[]
      means[0]!.value = '0.00000001'
    })
  })

  it('rejects an observed chapter mean denominator mutation', () => {
    assertRejected((value) => {
      const denominators = value.observedChapterMeanDenominators as number[]
      denominators[0] = 5
    })
  })

  it('rejects an aggregate metric mutation', () => {
    assertRejected((value) => {
      const metrics = value.aggregate as { requiredMetrics: { metricId: string; value: { state: string; value: number } }[] }
      metrics.requiredMetrics[0]!.value = { state: 'PRESENT', value: 999999 }
    })
  })

  it('rejects an artifact semantic hash mutation', () => {
    assertRejected((value) => { value.artifactSemanticHash = '0'.repeat(64) })
  })

  it('rejects a model cost-distribution canonical hash mutation after a full model rerun', () => {
    const clone = cloneArtifact()
    const model = clone.model as { input: { costDistributions: { distributions: { canonicalHash: string }[] } } }
    model.input.costDistributions.distributions[0]!.canonicalHash = 'f'.repeat(64)
    expect(() => validateReliabilitySemanticArtifact(clone)).toThrow()
  }, 120000)
})

describe('validateReliabilityArtifactPair — positive and mismatch', () => {
  it('returns the validated pair with recomputed hashes', () => {
    expect(FIXTURE.pair.artifactSemanticHash).toBe(FIXTURE.artifact.artifactSemanticHash)
    expect(FIXTURE.pair.reportHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(FIXTURE.pair.raw.semantic)).toBe(JSON.stringify(FIXTURE.pair.normalized.semantic))
    expect(JSON.stringify(FIXTURE.pair.semantic)).toBe(JSON.stringify(FIXTURE.artifact))
  })

  it('binds the report hash to the exact rendered report bytes', () => {
    expect(computeReportHash(FIXTURE.reportBytes)).toBe(FIXTURE.pair.reportHash)
  })

  it('rejects a raw report hash mutation', () => {
    const raw = rawEnvelopeForMutation(FIXTURE)
    raw.reportHash = '0'.repeat(64)
    expect(() => validateReliabilityArtifactPair({ raw, normalized: FIXTURE.normalized, reportBytes: FIXTURE.reportBytes })).toThrow()
  })

  it('rejects a raw semantic mutation', () => {
    const raw = rawEnvelopeForMutation(FIXTURE)
    const semantic = raw.semantic as { observationHash: string }
    semantic.observationHash = '0'.repeat(64)
    expect(() => validateReliabilityArtifactPair({ raw, normalized: FIXTURE.normalized, reportBytes: FIXTURE.reportBytes })).toThrow()
  })

  it('rejects a normalized execution alias that diverges from the raw alias map', () => {
    const normalized = JSON.parse(JSON.stringify(FIXTURE.normalized)) as Record<string, unknown>
    const execution = normalized.execution as { executionInstanceId: string }
    execution.executionInstanceId = 'execution-0022'
    expect(() => validateReliabilityArtifactPair({ raw: FIXTURE.raw, normalized, reportBytes: FIXTURE.reportBytes })).toThrow()
  })

  it('rejects a normalized semantic mutation', () => {
    const normalized = JSON.parse(JSON.stringify(FIXTURE.normalized)) as Record<string, unknown>
    const semantic = normalized.semantic as { aggregateHash: string }
    semantic.aggregateHash = '0'.repeat(64)
    expect(() => validateReliabilityArtifactPair({ raw: FIXTURE.raw, normalized, reportBytes: FIXTURE.reportBytes })).toThrow()
  })

  it('rejects report bytes whose hash does not bind both envelopes', () => {
    expect(() => validateReliabilityArtifactPair({ raw: FIXTURE.raw, normalized: FIXTURE.normalized, reportBytes: 'x' })).toThrow()
  })

  it('rejects a raw envelope missing a mandatory execution field', () => {
    const raw = rawEnvelopeForMutation(FIXTURE)
    const execution = raw.execution as Record<string, unknown>
    delete execution.elapsedMilliseconds
    expect(() => validateReliabilityArtifactPair({ raw, normalized: FIXTURE.normalized, reportBytes: FIXTURE.reportBytes })).toThrow()
  })

  it('rejects a raw envelope with negative elapsed milliseconds', () => {
    const raw = rawEnvelopeForMutation(FIXTURE)
    const execution = raw.execution as { elapsedMilliseconds: number }
    execution.elapsedMilliseconds = -1
    expect(() => validateReliabilityArtifactPair({ raw, normalized: FIXTURE.normalized, reportBytes: FIXTURE.reportBytes })).toThrow()
  })
})