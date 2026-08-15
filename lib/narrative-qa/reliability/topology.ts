import { z } from 'zod'
import { stableStringify } from '../scoring/canonical-serializer'
import {
  NOT_APPLICABLE_AUTHORITY_SCHEMA,
  STAGE_ID_SCHEMA,
  canonicalAuthorityHash,
  type AttemptClass,
  type NotApplicableAuthority,
  type StageId,
  type TaskId,
} from './contracts'
import { M10_E_TASK_MAPPING_V1 } from './authorities'

const AUTHORITY_DECISION_REF = 'docs/superpowers/specs/2026-08-13-m10-e-e3a-e4-reliability-economics-design.md'
export type StageOutcome = 'SUCCESS' | 'FAILURE'
export type RetryCounterEffect = 'NONE' | 'INCREMENT'
export type TerminalEffect = 'NONE' | 'FAILURE_TERMINAL' | 'NONTERMINAL_COMPLETION'
export type JudgeEligibility = 'NOT_ELIGIBLE' | 'AFTER_CHAPTER_50_COMPLETION'

const TOPOLOGY_NODE_SCHEMA = z.strictObject({
  stageId: STAGE_ID_SCHEMA,
  onSuccess: z.array(STAGE_ID_SCHEMA).max(1),
  onFailure: z.array(STAGE_ID_SCHEMA).max(1),
  taskId: z.enum(['CHAPTER_PROSE', 'CHAPTER_STRUCTURED_OUTPUT', 'RUNTIME_RECOVERY']),
  providerCallState: z.enum(['APPLICABLE', 'NOT_APPLICABLE']),
  attemptClass: z.enum(['PRIMARY', 'RETRY', 'FALLBACK']).nullable(),
  retryCounterEffect: z.enum(['NONE', 'INCREMENT']),
  terminalEffect: z.enum(['NONE', 'FAILURE_TERMINAL', 'NONTERMINAL_COMPLETION']),
  judgeEligibility: z.enum(['NOT_ELIGIBLE', 'AFTER_CHAPTER_50_COMPLETION']),
})
const TOPOLOGY_SCHEMA = z.strictObject({
  authorityVersion: z.literal('M10_E_TOPOLOGY_V1'),
  decisionRef: z.string().min(1),
  entryStageId: z.literal('PROSE_PRIMARY'),
  nodes: z.array(TOPOLOGY_NODE_SCHEMA).length(11),
  canonicalHash: z.string().regex(/^[0-9a-f]{64}$/),
})

const TOPOLOGY_PAYLOAD = {
  authorityVersion: 'M10_E_TOPOLOGY_V1' as const,
  decisionRef: AUTHORITY_DECISION_REF,
  entryStageId: 'PROSE_PRIMARY' as const,
  nodes: [
    node('PROSE_PRIMARY', ['STRUCTURED_OUTPUT'], ['PROSE_RETRY'], 'NONE', 'NONE'),
    node('PROSE_RETRY', ['STRUCTURED_OUTPUT'], ['PROVIDER_FALLBACK'], 'INCREMENT', 'NONE'),
    node('PROVIDER_FALLBACK', ['STRUCTURED_OUTPUT'], ['CHECKPOINT_RECOVERY'], 'NONE', 'NONE'),
    node('CHECKPOINT_RECOVERY', ['STRUCTURED_OUTPUT'], [], 'INCREMENT', 'FAILURE_TERMINAL'),
    node('STRUCTURED_OUTPUT', ['OWNERSHIP'], ['STRUCTURED_RETRY'], 'NONE', 'NONE'),
    node('STRUCTURED_RETRY', ['OWNERSHIP'], [], 'INCREMENT', 'FAILURE_TERMINAL'),
    node('OWNERSHIP', ['PUBLICATION'], ['OWNERSHIP_RECOVERY'], 'NONE', 'NONE'),
    node('OWNERSHIP_RECOVERY', ['PUBLICATION'], [], 'INCREMENT', 'FAILURE_TERMINAL'),
    node('PUBLICATION', ['POST_PUBLISH'], ['PUBLICATION_RECOVERY'], 'NONE', 'NONE'),
    node('PUBLICATION_RECOVERY', ['POST_PUBLISH'], [], 'INCREMENT', 'FAILURE_TERMINAL'),
    node('POST_PUBLISH', [], [], 'NONE', 'NONTERMINAL_COMPLETION', 'AFTER_CHAPTER_50_COMPLETION'),
  ],
}

export const M10_E_TOPOLOGY_V1 = deepFreeze({
  ...TOPOLOGY_PAYLOAD,
  canonicalHash: canonicalAuthorityHash(TOPOLOGY_PAYLOAD),
})

function node(
  stageId: StageId,
  onSuccess: StageId[],
  onFailure: StageId[],
  retryCounterEffect: RetryCounterEffect,
  terminalEffect: TerminalEffect,
  judgeEligibility: JudgeEligibility = 'NOT_ELIGIBLE',
) {
  const mapping = M10_E_TASK_MAPPING_V1.mapping.find((row) => row.stageId === stageId)
  if (!mapping) throw new Error(`Missing task mapping for ${stageId}`)
  return {
    stageId,
    onSuccess,
    onFailure,
    taskId: mapping.taskId,
    providerCallState: mapping.providerCallState,
    attemptClass: mapping.attemptClass,
    retryCounterEffect,
    terminalEffect,
    judgeEligibility,
  }
}

export interface StageSemantics {
  readonly stageId: StageId
  readonly taskId: TaskId
  readonly attemptClass: AttemptClass | null
  readonly providerCall:
    | Readonly<{ state: 'APPLICABLE' }>
    | Readonly<{ state: 'NOT_APPLICABLE'; authority: NotApplicableAuthority }>
  readonly retryCounterEffect: RetryCounterEffect
  readonly terminalEffect: TerminalEffect
  readonly judgeEligibility: JudgeEligibility
}

export function nextReachedStages(stageId: StageId, outcome: StageOutcome): readonly StageId[] {
  const topologyNode = findNode(stageId)
  return outcome === 'SUCCESS' ? topologyNode.onSuccess : topologyNode.onFailure
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
    terminalEffect: topologyNode.terminalEffect,
    judgeEligibility: topologyNode.judgeEligibility,
  })
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
