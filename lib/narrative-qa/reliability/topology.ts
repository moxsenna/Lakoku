import { z } from 'zod'
import { stableStringify } from '../scoring/canonical-serializer'
import {
  CHAPTER_NUMBER_SCHEMA,
  NOT_APPLICABLE_AUTHORITY_SCHEMA,
  STAGE_ID_SCHEMA,
  canonicalAuthorityHash,
  type AttemptClass,
  type NotApplicableAuthority,
  type StageId,
  type TaskId,
} from './contracts'
import { M10_E_TOPOLOGY_V1 } from './authorities'

const AUTHORITY_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
export type StageOutcome = 'SUCCESS' | 'FAILURE'
export type RetryCounterEffect = 'NONE' | 'INCREMENT'
export type ChapterEffect = 'CONTINUE' | 'TERMINAL_FAILURE' | 'CHAPTER_COMPLETE'

const TRANSITION_SCHEMA = z.strictObject({
  nextStageIds: z.array(STAGE_ID_SCHEMA).max(1),
  chapterEffect: z.enum(['CONTINUE', 'TERMINAL_FAILURE', 'CHAPTER_COMPLETE']),
})
const TOPOLOGY_NODE_SCHEMA = z.strictObject({
  stageId: STAGE_ID_SCHEMA,
  taskId: z.enum(['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT', 'RUNTIME_RECOVERY']),
  providerCallState: z.enum(['APPLICABLE', 'NOT_APPLICABLE']),
  attemptClass: z.enum(['PRIMARY', 'RETRY', 'FALLBACK']).nullable(),
  retryCounterEffect: z.enum(['NONE', 'INCREMENT']),
  transitions: z.strictObject({ SUCCESS: TRANSITION_SCHEMA, FAILURE: TRANSITION_SCHEMA }),
})
const TOPOLOGY_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_TOPOLOGY_V1'),
  decisionRef: z.string().min(1),
  entryStageId: z.literal('PROSE_PRIMARY'),
  nodes: z.array(TOPOLOGY_NODE_SCHEMA).length(11),
  canonicalHash: z.string().regex(/^[0-9a-f]{64}$/),
})

export interface StageSemantics {
  readonly stageId: StageId
  readonly taskId: TaskId
  readonly attemptClass: AttemptClass | null
  readonly providerCall:
    | Readonly<{ state: 'APPLICABLE' }>
    | Readonly<{ state: 'NOT_APPLICABLE'; authority: NotApplicableAuthority }>
  readonly retryCounterEffect: RetryCounterEffect
}

export interface StageTransition {
  readonly nextStageIds: readonly StageId[]
  readonly chapterEffect: ChapterEffect
}

export function getStageTransition(stageId: StageId, outcome: StageOutcome): StageTransition {
  const transition = findNode(stageId).transitions[outcome]
  return deepFreeze({ nextStageIds: [...transition.nextStageIds], chapterEffect: transition.chapterEffect })
}

export function nextReachedStages(stageId: StageId, outcome: StageOutcome): readonly StageId[] {
  return getStageTransition(stageId, outcome).nextStageIds
}

export function getStageSemantics(stageId: StageId): StageSemantics {
  const topologyNode = findNode(stageId)
  const providerCall = topologyNode.providerCallState === 'APPLICABLE'
    ? deepFreeze({ state: 'APPLICABLE' as const })
    : deepFreeze({ state: 'NOT_APPLICABLE' as const, authority: createNotApplicableAuthority(topologyNode.stageId) })
  return deepFreeze({
    stageId: topologyNode.stageId,
    taskId: topologyNode.taskId as TaskId,
    attemptClass: topologyNode.attemptClass as AttemptClass | null,
    providerCall,
    retryCounterEffect: topologyNode.retryCounterEffect,
  })
}

export function isJudgePlanEligible(
  transition: StageTransition,
  chapterNumber: number,
  completedChapterNumbers: readonly number[],
): boolean {
  const chapter = CHAPTER_NUMBER_SCHEMA.parse(chapterNumber)
  if (transition.chapterEffect !== 'CHAPTER_COMPLETE' || chapter !== 50) return false
  return completedChapterNumbers.length === 50 && completedChapterNumbers.every((value, index) => value === index + 1)
}

export function validateTopologyAuthority(value: unknown): typeof M10_E_TOPOLOGY_V1 {
  const parsed = TOPOLOGY_SCHEMA.parse(value)
  if (canonicalAuthorityHash(parsed) !== parsed.canonicalHash) throw new Error('Canonical authority hash mismatch')
  if (stableStringify(parsed) !== stableStringify(M10_E_TOPOLOGY_V1)) {
    throw new Error('Topology does not match frozen version identity')
  }
  return deepFreeze(parsed) as typeof M10_E_TOPOLOGY_V1
}

function findNode(stageId: StageId) {
  const parsedStageId = STAGE_ID_SCHEMA.parse(stageId)
  const topologyNode = M10_E_TOPOLOGY_V1.nodes.find((candidate) => candidate.stageId === parsedStageId)
  if (!topologyNode) throw new Error(`Unknown stage: ${stageId}`)
  return topologyNode
}

function createNotApplicableAuthority(stageId: StageId): NotApplicableAuthority {
  const payload = {
    authorityVersion: 'M10_E_TOPOLOGY_V1' as const,
    stageId,
    taskId: 'RUNTIME_RECOVERY' as const,
    applicability: 'PROVIDER_CALL_NOT_APPLICABLE' as const,
    decisionRef: AUTHORITY_DECISION_REF,
  }
  return deepFreeze(NOT_APPLICABLE_AUTHORITY_SCHEMA.parse({
    ...payload,
    canonicalHash: canonicalAuthorityHash(payload),
  }))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
