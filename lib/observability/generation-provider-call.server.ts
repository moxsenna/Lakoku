import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ModelCandidateIdentitySchema,
  ProviderCallCompletionSchema,
  ProviderCallContextSchema,
  type ModelCandidateIdentity,
  type ProviderCallCompletion,
  type ProviderCallContext,
} from './generation-provider-call.contract'

const TELEMETRY_WRITE_FAILED = 'GENERATION_PROVIDER_TELEMETRY_WRITE_FAILED' as const

const ProviderCallStartSchema = z.object({
  providerCallId: z.string().trim().min(1).max(200),
  context: ProviderCallContextSchema,
  candidate: ModelCandidateIdentitySchema,
  useCase: z.string().trim().min(1).max(100),
  workflowPhase: z.string().trim().min(1).max(100),
  startedAt: z.iso.datetime({ offset: true }),
}).strict()

export interface ProviderCallStart {
  providerCallId: string
  context: ProviderCallContext
  candidate: ModelCandidateIdentity
  useCase: string
  workflowPhase: string
  startedAt: string
}

type RpcResult = {
  data: unknown
  error: unknown
}

type ProviderCallRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<RpcResult>

export interface ProviderCallRecorderDeps {
  rpc?: ProviderCallRpc
  logCode?: (code: typeof TELEMETRY_WRITE_FAILED) => void
}

function emitWriteFailure(logCode?: ProviderCallRecorderDeps['logCode']): void {
  try {
    if (logCode) {
      logCode(TELEMETRY_WRITE_FAILED)
    } else {
      console.error(TELEMETRY_WRITE_FAILED)
    }
  } catch {
    // Telemetry reporting must not affect generation.
  }
}

export async function recordGenerationProviderCall(
  start: ProviderCallStart,
  completion: ProviderCallCompletion,
  deps: ProviderCallRecorderDeps = {},
): Promise<void> {
  const parsedStart = ProviderCallStartSchema.parse(start)
  const parsedCompletion = ProviderCallCompletionSchema.parse(completion)

  try {
    const rpc: ProviderCallRpc = deps.rpc ?? ((name, args) => (
      createAdminClient().rpc(name, args) as unknown as Promise<RpcResult>
    ))
    const { error } = await rpc('record_generation_provider_call_v1', {
      p_provider_call_id: parsedStart.providerCallId,
      p_user_id: parsedStart.context.userId,
      p_story_id: parsedStart.context.storyId,
      p_chapter_number: parsedStart.context.chapterNumber,
      p_generation_kind: parsedStart.context.generationKind,
      p_job_id: parsedStart.context.jobId,
      p_correlation_id: parsedStart.context.correlationId,
      p_attempt_number: parsedStart.context.attemptNumber,
      p_use_case: parsedStart.useCase,
      p_workflow_phase: parsedStart.workflowPhase,
      p_provider_id: parsedCompletion.actualProviderId,
      p_model_id: parsedCompletion.actualModelId,
      p_route_version: parsedStart.candidate.routeVersion,
      p_fallback_index: parsedStart.candidate.fallbackIndex,
      p_actual_model_resolved: parsedCompletion.actualModelResolved,
      p_started_at: parsedStart.startedAt,
      p_ended_at: parsedCompletion.endedAt,
      p_elapsed_ms: parsedCompletion.elapsedMs,
      p_outcome: parsedCompletion.outcome,
      p_error_code: parsedCompletion.errorCode,
      p_input_token_count: parsedCompletion.inputTokenCount,
      p_output_token_count: parsedCompletion.outputTokenCount,
      p_total_token_count: parsedCompletion.totalTokenCount,
      p_provider_cost_amount: parsedCompletion.providerActualCostAmount,
      p_provider_cost_currency: parsedCompletion.providerActualCostCurrency,
    })

    if (error) {
      emitWriteFailure(deps.logCode)
    }
  } catch {
    emitWriteFailure(deps.logCode)
  }
}
