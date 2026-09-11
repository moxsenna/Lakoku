import { describe, expect, it } from 'vitest'
import {
  CHAPTER_SEQUENCE,
  M10_E_STAGE_CATALOG_V1,
  M10_E_TOPOLOGY_V1,
  canonicalAuthorityHash,
  getStageSemantics,
  getStageTransition,
  isJudgePlanEligible,
  nextReachedStages,
  validateTopologyAuthority,
  type StageId,
} from '../../lib/narrative-qa/reliability'

function rehash<T extends Record<string, unknown>>(value: T): T {
  return { ...value, canonicalHash: canonicalAuthorityHash(value) }
}

describe('M10-E frozen topology', () => {
  it('freezes topology identity, exact edges, and reachability', () => {
    expect(M10_E_TOPOLOGY_V1.canonicalHash).toBe('cd4703496d575571534dedf13307f4f25efdcb581ad1ed29fb1799f28207113f')
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

  it('makes recovery and retry terminal effects outcome-aware', () => {
    for (const stageId of ['CHECKPOINT_RECOVERY', 'STRUCTURED_RETRY', 'OWNERSHIP_RECOVERY', 'PUBLICATION_RECOVERY'] as const) {
      expect(getStageTransition(stageId, 'SUCCESS')).toMatchObject({ chapterEffect: 'CONTINUE' })
      expect(getStageTransition(stageId, 'FAILURE')).toEqual({ nextStageIds: [], chapterEffect: 'TERMINAL_FAILURE' })
    }
    expect(getStageTransition('POST_PUBLISH', 'SUCCESS')).toEqual({ nextStageIds: [], chapterEffect: 'CHAPTER_COMPLETE' })
    expect(getStageTransition('POST_PUBLISH', 'FAILURE')).toEqual({ nextStageIds: [], chapterEffect: 'CHAPTER_COMPLETE' })
  })

  it('returns provider applicability and retry-counter truth table for all stages', () => {
    const expected = {
      PROSE_PRIMARY: ['CHAPTER_PROSE', 'PRIMARY', 'APPLICABLE', false],
      PROSE_RETRY: ['CHAPTER_PROSE', 'RETRY', 'APPLICABLE', true],
      PROVIDER_FALLBACK: ['CHAPTER_PROSE', 'FALLBACK', 'APPLICABLE', false],
      CHECKPOINT_RECOVERY: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', true],
      STRUCTURED_OUTPUT: ['CHAPTER_STRUCTURED_OUTPUT', 'PRIMARY', 'APPLICABLE', false],
      STRUCTURED_RETRY: ['CHAPTER_STRUCTURED_OUTPUT', 'RETRY', 'APPLICABLE', true],
      OWNERSHIP: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', false],
      OWNERSHIP_RECOVERY: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', true],
      PUBLICATION: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', false],
      PUBLICATION_RECOVERY: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', true],
      POST_PUBLISH: ['RUNTIME_RECOVERY', null, 'NOT_APPLICABLE', false],
    } as const

    for (const stageId of M10_E_STAGE_CATALOG_V1.stages) {
      const semantics = getStageSemantics(stageId)
      expect([
        semantics.taskId,
        semantics.attemptClass,
        semantics.providerCall.state,
        semantics.retryCounterEffect === 'INCREMENT',
      ]).toEqual(expected[stageId])
      if (semantics.providerCall.state === 'NOT_APPLICABLE') {
        expect(semantics.providerCall.authority.stageId).toBe(stageId)
      }
    }
  })

  it('requires complete chapters 1..50 before judge eligibility', () => {
    const chapterComplete = getStageTransition('POST_PUBLISH', 'FAILURE')
    for (let chapterNumber = 1; chapterNumber <= 49; chapterNumber += 1) {
      expect(isJudgePlanEligible(chapterComplete, chapterNumber, CHAPTER_SEQUENCE.slice(0, chapterNumber))).toBe(false)
    }
    expect(isJudgePlanEligible(chapterComplete, 50, CHAPTER_SEQUENCE)).toBe(true)
    expect(isJudgePlanEligible(chapterComplete, 50, CHAPTER_SEQUENCE.slice(1))).toBe(false)

    const terminalFailure = getStageTransition('PUBLICATION_RECOVERY', 'FAILURE')
    expect(isJudgePlanEligible(terminalFailure, 50, CHAPTER_SEQUENCE)).toBe(false)
    expect(terminalFailure.nextStageIds).toEqual([])
  })

  it('rejects edge, outcome effect, retry, provider, task, attempt, and version-preserving mutations', () => {
    const mutateCases: Array<(copy: typeof M10_E_TOPOLOGY_V1) => void> = [
      (copy) => { copy.nodes.reverse() },
      (copy) => { copy.nodes[1] = copy.nodes[0]! },
      (copy) => { copy.nodes.pop() },
      (copy) => { copy.nodes.push(copy.nodes[0]!) },
      (copy) => { copy.nodes[0]!.transitions.FAILURE.nextStageIds = [] },
      (copy) => { copy.nodes[10]!.transitions.FAILURE.chapterEffect = 'TERMINAL_FAILURE' },
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
