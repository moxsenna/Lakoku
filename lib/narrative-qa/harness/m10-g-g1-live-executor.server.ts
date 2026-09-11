import 'server-only'
import {
  executeM10GG1PersonalizedChapter,
  type M10GG1ExecutionCapability,
} from '@lakoku/runtime'
import {
  resolveM10GG1FrozenGenerationPolicy,
  resolveM10GG1FrozenLeaseTtlSeconds,
  resolveM10GG1FrozenRoutes,
} from './m10-g-g1-frozen-provider.server'
import type {
  M10GG1ChapterExecutionInput,
  M10GG1ChapterExecutionResult,
} from './m10-g-g1-runner.server'

/** Live binding: fixed personalized runtime + checkpoint/publication semantics. */
export async function executeM10GG1LiveChapter(input: {
  capability: M10GG1ExecutionCapability
  execution: M10GG1ChapterExecutionInput
}): Promise<M10GG1ChapterExecutionResult> {
  if (input.execution.writerLengthRepairV1Enabled !== false) {
    throw new Error('M10G_G1_WRITER_LENGTH_REPAIR_MUST_BE_DISABLED')
  }
  const result = await executeM10GG1PersonalizedChapter({
    capability: input.capability,
    chapter: {
      storyId: input.execution.storyId,
      userId: input.execution.userId,
      chapterNumber: input.execution.chapterNumber,
      correlationId: input.execution.correlationId,
      attemptNumber: input.execution.attemptNumber,
      attemptId: input.execution.correlationId,
      triggerChoiceId: input.execution.triggerChoiceId,
    },
    globalInferenceBudget: input.execution.globalInferenceBudget,
    frozenRoutes: resolveM10GG1FrozenRoutes(),
    frozenGenerationPolicy: resolveM10GG1FrozenGenerationPolicy(),
    frozenLeaseTtlSeconds: resolveM10GG1FrozenLeaseTtlSeconds(),
  })
  return result.ok
    ? { status: 'SUCCESS', parserOutcome: 'ACCEPTED' }
    : { status: 'FAILURE', reason: result.reason, error: result.detail }
}
