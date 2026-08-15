import { describe, expect, it } from 'vitest'
import {
  CHAPTER_SEQUENCE,
  M10_E_CUMULATIVE_MODEL_V1,
  M10_E_MONTE_CARLO_V1,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TASK_MAPPING_V1,
  canonicalAuthorityHash,
  createChapterStageExchangeabilityAuthorities,
  createJudgePlanAuthority,
  validateChapterStageExchangeabilityAuthorities,
  validateCumulativeModelAuthority,
  validateJudgePlanAuthority,
  validateMonteCarloAuthority,
  validateStageCatalogAuthority,
  validateTaskMappingAuthority,
  type CompatibleStratumIdentity,
} from '../../lib/narrative-qa/reliability'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const stratum: CompatibleStratumIdentity = {
  retryFallbackPolicyId: 'retry_policy_v1',
  retryFallbackPolicyHash: HASH_A,
  topologyVersion: 'M10_E_TOPOLOGY_V1',
  topologyHash: HASH_B,
  stageCatalogVersion: 'M10_E_STAGE_CATALOG_V1',
  stageCatalogHash: M10_E_STAGE_CATALOG_V1.canonicalHash,
  taskMappingVersion: 'M10_E_TASK_MAPPING_V1',
  taskMappingHash: M10_E_TASK_MAPPING_V1.canonicalHash,
  providerModelPolicyId: 'provider_policy_v1',
  pricingPolicyVersion: 'pricing_v1',
  pricingSnapshotHash: HASH_A,
}

function rehash<T extends Record<string, unknown>>(value: T): T {
  return { ...value, canonicalHash: canonicalAuthorityHash(value) }
}

describe('M10-E reliability authorities', () => {
  it('freezes exact 11-stage order and task mapping identities', () => {
    expect(M10_E_STAGE_CATALOG_V1.stages).toEqual([
      'PROSE_PRIMARY', 'PROSE_RETRY', 'PROVIDER_FALLBACK', 'CHECKPOINT_RECOVERY',
      'STRUCTURED_OUTPUT', 'STRUCTURED_RETRY', 'OWNERSHIP', 'OWNERSHIP_RECOVERY',
      'PUBLICATION', 'PUBLICATION_RECOVERY', 'POST_PUBLISH',
    ])
    expect(M10_E_STAGE_CATALOG_V1.canonicalHash).toBe('42b18988a77d3b210d283d30a97622c41309a120cd0d92c546984883c57204bd')
    expect(M10_E_TASK_MAPPING_V1.canonicalHash).toBe('48f44fbeaa537258908cf701d1398d09bf678f7c7368fbd65cc8e28d1618ead8')
    expect(() => validateStageCatalogAuthority(M10_E_STAGE_CATALOG_V1)).not.toThrow()
    expect(() => validateTaskMappingAuthority(M10_E_TASK_MAPPING_V1)).not.toThrow()
  })

  it.each([
    ['reordered', ['PROSE_RETRY', 'PROSE_PRIMARY', ...M10_E_STAGE_CATALOG_V1.stages.slice(2)]],
    ['duplicate', [...M10_E_STAGE_CATALOG_V1.stages.slice(0, 10), 'PUBLICATION_RECOVERY']],
    ['removed', M10_E_STAGE_CATALOG_V1.stages.slice(0, 10)],
    ['added', [...M10_E_STAGE_CATALOG_V1.stages, 'UNKNOWN_STAGE']],
  ])('rejects %s stage catalog even when attacker recomputes hash', (_name, stages) => {
    const mutation = rehash({ ...M10_E_STAGE_CATALOG_V1, stages })
    expect(() => validateStageCatalogAuthority(mutation)).toThrow()
  })

  it('rejects changed task and attempt class under unchanged version with recomputed hash', () => {
    const taskMutation = structuredClone(M10_E_TASK_MAPPING_V1)
    taskMutation.mapping[0]!.taskId = 'RUNTIME_RECOVERY'
    expect(() => validateTaskMappingAuthority(rehash(taskMutation))).toThrow()

    const attemptMutation = structuredClone(M10_E_TASK_MAPPING_V1)
    attemptMutation.mapping[2]!.attemptClass = 'RETRY'
    expect(() => validateTaskMappingAuthority(rehash(attemptMutation))).toThrow()
  })

  it('freezes cumulative, Monte Carlo, PRNG, draw, and numeric identities', () => {
    expect(M10_E_CUMULATIVE_MODEL_V1.modelVersion).toBe('M10_E_CUMULATIVE_MODEL_V1')
    expect(M10_E_MONTE_CARLO_V1).toMatchObject({
      methodVersion: 'M10_E_MONTE_CARLO_V1',
      iterations: 100000,
      probabilitySemantic: 'FAILURE_PROBABILITY',
      prng: { algorithmId: 'xoshiro128**', algorithmVersion: 1 },
      numeric: {
        probabilityScale: 12,
        moneyScale: 8,
        intermediateScale: 20,
        roundingMode: 'HALF_UP_TIES_AWAY_FROM_ZERO',
        coefficientLimit: '99999999999999999999999999999999999999',
      },
    })
    expect(M10_E_MONTE_CARLO_V1.canonicalHash).toBe('0aab4a2b31d09a359595a577a6fb5a9094d907ff7049da8de130659c0739a088')
    expect(() => validateMonteCarloAuthority(M10_E_MONTE_CARLO_V1)).not.toThrow()
    expect(M10_E_CUMULATIVE_MODEL_V1.canonicalHash).toBe('7e6d8a570f1b5fbcc5388a588a750339dfc2cb82a2d71017b06cefdf6840a54e')
    expect(() => validateCumulativeModelAuthority(M10_E_CUMULATIVE_MODEL_V1)).not.toThrow()

    const mutation = structuredClone(M10_E_CUMULATIVE_MODEL_V1)
    mutation.monteCarlo.iterations = 99999
    expect(() => validateCumulativeModelAuthority(rehash(mutation))).toThrow()
  })

  it('freezes exact ordered judge triplets and rejects sequence or policy mutations', () => {
    const plan = createJudgePlanAuthority('provider_policy_v1', 'IDR')
    expect(plan.evaluations).toHaveLength(24)
    expect(plan.evaluations.slice(0, 4)).toEqual([
      { judgeTaskId: 'D-R1', evaluationIndex: 0, providerModelPolicyId: 'provider_policy_v1' },
      { judgeTaskId: 'D-R1', evaluationIndex: 1, providerModelPolicyId: 'provider_policy_v1' },
      { judgeTaskId: 'D-R1', evaluationIndex: 2, providerModelPolicyId: 'provider_policy_v1' },
      { judgeTaskId: 'D-R2', evaluationIndex: 0, providerModelPolicyId: 'provider_policy_v1' },
    ])
    expect(() => validateJudgePlanAuthority(plan, 'provider_policy_v1')).not.toThrow()

    for (const mutate of [
      (copy: typeof plan) => { copy.evaluations.reverse() },
      (copy: typeof plan) => { copy.evaluations[1] = copy.evaluations[0]! },
      (copy: typeof plan) => { delete (copy.evaluations[0] as Partial<(typeof copy.evaluations)[number]>).providerModelPolicyId },
      (copy: typeof plan) => { copy.evaluations[0]!.providerModelPolicyId = 'other_policy' },
    ]) {
      const copy = structuredClone(plan)
      mutate(copy)
      expect(() => validateJudgePlanAuthority(rehash(copy), 'provider_policy_v1')).toThrow()
    }
  })

  it('creates one exact exchangeability assumption per stage without probability authority', () => {
    const assumptions = createChapterStageExchangeabilityAuthorities('CONTRACT_FIXTURE', stratum)
    expect(assumptions).toHaveLength(11)
    expect(assumptions.map((item) => item.stageId)).toEqual(M10_E_STAGE_CATALOG_V1.stages)
    expect(assumptions.every((item) => item.provenance === 'ASSUMPTION')).toBe(true)
    expect(assumptions.every((item) => item.chapters.join(',') === CHAPTER_SEQUENCE.join(','))).toBe(true)
    expect(assumptions.every((item) => !('centralProbability' in item))).toBe(true)
    expect(() => validateChapterStageExchangeabilityAuthorities(assumptions, 'CONTRACT_FIXTURE', stratum)).not.toThrow()
  })

  it('rejects exchangeability authority spanning wrong scope or missing authority fields', () => {
    const valid = createChapterStageExchangeabilityAuthorities('CONTRACT_FIXTURE', stratum)
    const mutations: unknown[] = []

    const multiStage = structuredClone(valid)
    Object.assign(multiStage[0]!, { stageIds: ['PROSE_PRIMARY', 'PROSE_RETRY'] })
    mutations.push(multiStage)

    const profile = structuredClone(valid)
    profile[0]!.executionProfile = 'RELEASE_EVIDENCE'
    mutations.push(profile)

    const changedStratum = structuredClone(valid)
    changedStratum[0]!.compatibleStratum.providerModelPolicyId = 'other_policy'
    mutations.push(changedStratum)

    const chapters = structuredClone(valid)
    chapters[0]!.chapters = chapters[0]!.chapters.slice(1)
    mutations.push(chapters)

    const probability = structuredClone(valid)
    Object.assign(probability[0]!, { centralProbability: '0.100000000000' })
    mutations.push(probability)

    for (const field of ['rationale', 'decisionRef', 'canonicalHash'] as const) {
      const missing = structuredClone(valid)
      delete (missing[0] as Partial<(typeof missing)[number]>)[field]
      mutations.push(missing)
    }

    for (const mutation of mutations) {
      expect(() => validateChapterStageExchangeabilityAuthorities(mutation, 'CONTRACT_FIXTURE', stratum)).toThrow()
    }
  })
})
