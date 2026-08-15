import { describe, expect, it } from 'vitest'
import {
  M10_E_STAGE_CATALOG_V1,
  M10_E_TOPOLOGY_V1,
  canonicalAuthorityHash,
  getStageSemantics,
  nextReachedStages,
  validateTopologyAuthority,
  type StageId,
} from '../../lib/narrative-qa/reliability'

function rehash<T extends Record<string, unknown>>(value: T): T {
  return { ...value, canonicalHash: canonicalAuthorityHash(value) }
}

describe('M10-E frozen topology', () => {
  it('freezes topology identity, exact edges, and reachability', () => {
    expect(M10_E_TOPOLOGY_V1.canonicalHash).toBe('30a06a2f79cda4812addb23cccc65edcbb96ddd8969a21617b362c23e0108937')
    expect(() => validateTopologyAuthority(M10_E_TOPOLOGY_V1)).not.toThrow()
    expect(nextReachedStages('PROSE_PRIMARY', 'FAILURE')).toEqual(['PROSE_RETRY'])
    expect(nextReachedStages('PROSE_RETRY', 'FAILURE')).toEqual(['PROVIDER_FALLBACK'])
    expect(nextReachedStages('PROVIDER_FALLBACK', 'FAILURE')).toEqual(['CHECKPOINT_RECOVERY'])
    expect(nextReachedStages('CHECKPOINT_RECOVERY', 'SUCCESS')).toEqual(['STRUCTURED_OUTPUT'])
    expect(nextReachedStages('STRUCTURED_OUTPUT', 'FAILURE')).toEqual(['STRUCTURED_RETRY'])
    expect(nextReachedStages('STRUCTURED_RETRY', 'SUCCESS')).toEqual(['OWNERSHIP'])
    expect(nextReachedStages('OWNERSHIP', 'FAILURE')).toEqual(['OWNERSHIP_RECOVERY'])
    expect(nextReachedStages('OWNERSHIP_RECOVERY', 'SUCCESS')).toEqual(['PUBLICATION'])
    expect(nextReachedStages('PUBLICATION', 'FAILURE')).toEqual(['PUBLICATION_RECOVERY'])
    expect(nextReachedStages('PUBLICATION_RECOVERY', 'SUCCESS')).toEqual(['POST_PUBLISH'])
    expect(nextReachedStages('POST_PUBLISH', 'FAILURE')).toEqual([])
  })

  it('covers every prose, structured, ownership, publication, and post-publish path', () => {
    expect(nextReachedStages('PROSE_PRIMARY', 'SUCCESS')).toEqual(['STRUCTURED_OUTPUT'])
    expect(nextReachedStages('PROSE_RETRY', 'SUCCESS')).toEqual(['STRUCTURED_OUTPUT'])
    expect(nextReachedStages('PROVIDER_FALLBACK', 'SUCCESS')).toEqual(['STRUCTURED_OUTPUT'])
    expect(nextReachedStages('CHECKPOINT_RECOVERY', 'FAILURE')).toEqual([])
    expect(nextReachedStages('STRUCTURED_RETRY', 'FAILURE')).toEqual([])
    expect(nextReachedStages('OWNERSHIP_RECOVERY', 'FAILURE')).toEqual([])
    expect(nextReachedStages('PUBLICATION_RECOVERY', 'FAILURE')).toEqual([])
    expect(nextReachedStages('POST_PUBLISH', 'SUCCESS')).toEqual([])
  })

  it('returns provider applicability and retry-counter truth table for all stages', () => {
    const expected = {
      PROSE_PRIMARY: ['CHAPTER_PROSE', 'PRIMARY', 'APPLICABLE', false, 'NONE'],
      PROSE_RETRY: ['CHAPTER_PROSE', 'RETRY', 'APPLICABLE', true, 'NONE'],
      PROVIDER_FALLBACK: ['CHAPTER_PROSE', 'FALLBACK', 'APPLICABLE', false, 'NONE'],
      CHECKPOINT_RECOVERY: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', true, 'FAILURE_TERMINAL'],
      STRUCTURED_OUTPUT: ['CHAPTER_STRUCTURED_OUTPUT', 'PRIMARY', 'APPLICABLE', false, 'NONE'],
      STRUCTURED_RETRY: ['CHAPTER_STRUCTURED_OUTPUT', 'RETRY', 'APPLICABLE', true, 'FAILURE_TERMINAL'],
      OWNERSHIP: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', false, 'NONE'],
      OWNERSHIP_RECOVERY: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', true, 'FAILURE_TERMINAL'],
      PUBLICATION: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', false, 'NONE'],
      PUBLICATION_RECOVERY: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', true, 'FAILURE_TERMINAL'],
      POST_PUBLISH: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', false, 'NONTERMINAL_COMPLETION'],
    } as const

    for (const stageId of M10_E_STAGE_CATALOG_V1.stages) {
      const semantics = getStageSemantics(stageId)
      expect([
        semantics.taskId,
        semantics.attemptClass,
        semantics.providerCall.state,
        semantics.retryCounterEffect === 'INCREMENT',
        semantics.terminalEffect,
      ]).toEqual(expected[stageId])
      if (semantics.providerCall.state === 'NOT_APPLICABLE') {
        expect(semantics.providerCall.authority.stageId).toBe(stageId)
      }
    }
  })

  it('marks judge eligible only after successful post-publish completion', () => {
    expect(getStageSemantics('POST_PUBLISH').judgeEligibility).toBe('AFTER_CHAPTER_50_COMPLETION')
    for (const stageId of M10_E_STAGE_CATALOG_V1.stages.filter((id) => id !== 'POST_PUBLISH')) {
      expect(getStageSemantics(stageId).judgeEligibility).toBe('NOT_ELIGIBLE')
    }
  })

  it('rejects edge, terminal, retry, provider, task, attempt, and version-preserving mutations', () => {
    const mutateCases: Array<(copy: typeof M10_E_TOPOLOGY_V1) => void> = [
      (copy) => { copy.nodes.reverse() },
      (copy) => { copy.nodes[1] = copy.nodes[0]! },
      (copy) => { copy.nodes.pop() },
      (copy) => { copy.nodes.push(copy.nodes[0]!) },
      (copy) => { copy.nodes[0]!.onFailure = [] },
      (copy) => { copy.nodes[10]!.terminalEffect = 'FAILURE_TERMINAL' },
      (copy) => { copy.nodes[2]!.retryCounterEffect = 'INCREMENT' },
      (copy) => { copy.nodes[6]!.providerCallState = 'APPLICABLE' },
      (copy) => { copy.nodes[0]!.taskId = 'RUNTIME_RECOVERY' },
      (copy) => { copy.nodes[2]!.attemptClass = 'RETRY' },
    ]
    for (const mutate of mutateCases) {
      const copy = structuredClone(M10_E_TOPOLOGY_V1)
      mutate(copy)
      expect(() => validateTopologyAuthority(rehash(copy))).toThrow()
    }
  })

  it('fails unknown stages', () => {
    expect(() => getStageSemantics('UNKNOWN' as StageId)).toThrow()
  })
})
