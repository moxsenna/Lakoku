import 'server-only'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, streamText } from 'ai'
import { z } from 'zod'
import type { ProviderCallContext } from '@/lib/observability/generation-provider-call.contract'
import { executeObservedModelCall } from '@/lib/ai-gateway/observed-model-call.server'
import type {
  M10FAssembledSemanticCase,
  M10FSemanticAttempt,
  M10FSemanticAuthority,
} from '../contracts/m10-f-semantic-contract'
import { SemanticFindingCodeSchema } from '../contracts/semantic-judge-contract'
import { buildM10FSemanticPrompt } from './m10-f-semantic-prompts'
import {
  makeM10FSemanticFailureAttempt,
  validateM10FSemanticResponse,
  type M10FObservedIdentity,
  type M10FRawJudgeResponse,
} from './m10-f-semantic-policy'

const StrictJudgeResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  modelVerdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  confidence: z.number().int().min(0).max(100),
  evidenceMode: z.enum(['SPAN', 'FULL_HORIZON_ABSENCE']),
  findingCodes: z.array(SemanticFindingCodeSchema).min(1).max(8),
  evidence: z.array(z.object({
    segmentId: z.string().min(1).max(160),
    quote: z.string().min(1).max(4_000),
  }).strict()).max(20),
  absenceCode: z.literal('EMOTIONAL_RESOLUTION_ABSENT').optional(),
  rationaleSummary: z.string().min(1).max(1_000),
}).strict()

export interface M10FSemanticTransportResult {
  rawResponse: string
  observedIdentity: M10FObservedIdentity
}

export interface M10FSemanticTransportInput {
  system: string
  prompt: string
  providerId: 'openrouter'
  configuredModelId: 'deepseek/deepseek-v3.2'
  routeVersion: '2026-08-m10f-live'
  fallbackIndex: 0
  temperature: 0
  maxRetries: 0
  telemetryContext: ProviderCallContext
}

export type M10FSemanticTransport = (
  input: M10FSemanticTransportInput,
) => Promise<M10FSemanticTransportResult>

async function openRouterSemanticTransport(
  input: M10FSemanticTransportInput,
): Promise<M10FSemanticTransportResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for M10-F semantic execution')
  const openrouter = createOpenAICompatible({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    supportsStructuredOutputs: true,
    includeUsage: true,
  })
  let observedIdentity: M10FObservedIdentity = {
    providerId: null,
    actualModelId: null,
    actualModelResolved: false,
    fallbackIndex: input.fallbackIndex,
    routeVersion: input.routeVersion,
  }
  const rawResponse = await executeObservedModelCall({
    context: input.telemetryContext,
    candidate: {
      providerId: input.providerId,
      configuredModelId: input.configuredModelId,
      routeVersion: input.routeVersion,
      fallbackIndex: input.fallbackIndex,
    },
    useCase: 'm10_f_semantic_judge',
    workflowPhase: 'M10_F_SEMANTIC_JUDGE',
    call: () => streamText({
      model: openrouter(input.configuredModelId),
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: StrictJudgeResponseSchema }),
      temperature: input.temperature,
      maxRetries: input.maxRetries,
    }),
    consume: (text) => text,
    observeCompletion: (completion) => {
      observedIdentity = {
        providerId: completion.actualProviderId,
        actualModelId: completion.actualModelId,
        actualModelResolved: completion.actualModelResolved,
        fallbackIndex: input.fallbackIndex,
        routeVersion: input.routeVersion,
      }
    },
  })
  return { rawResponse, observedIdentity }
}

export function parseM10FSemanticRawResponse(rawResponse: string): M10FRawJudgeResponse {
  return StrictJudgeResponseSchema.parse(JSON.parse(rawResponse) as unknown)
}

export async function executeM10FSemanticJudge(input: {
  assembled: M10FAssembledSemanticCase
  authority: M10FSemanticAuthority
  sampleIndex: number
  telemetryContext: ProviderCallContext
  transport?: M10FSemanticTransport
}): Promise<M10FSemanticAttempt> {
  const prompt = buildM10FSemanticPrompt(input.assembled.caseAuthority.rubricId, input.assembled.judgeInput)
  if (prompt.templateHash !== input.assembled.promptHash) {
    return makeM10FSemanticFailureAttempt({
      assembled: input.assembled,
      authority: input.authority,
      sampleIndex: input.sampleIndex,
      status: 'MALFORMED_RESPONSE',
      failureCodes: ['PROMPT_HASH_MISMATCH'],
    })
  }
  const execution = input.authority.executionIdentity
  const transport = input.transport ?? openRouterSemanticTransport
  try {
    const result = await transport({
      system: prompt.system,
      prompt: prompt.user,
      providerId: execution.providerId,
      configuredModelId: execution.configuredModelId,
      routeVersion: execution.routeVersion,
      fallbackIndex: execution.primaryIndex,
      temperature: execution.temperature,
      maxRetries: execution.maxRetries,
      telemetryContext: input.telemetryContext,
    })
    let response: M10FRawJudgeResponse
    try {
      response = parseM10FSemanticRawResponse(result.rawResponse)
    } catch {
      return makeM10FSemanticFailureAttempt({
        assembled: input.assembled,
        authority: input.authority,
        sampleIndex: input.sampleIndex,
        observedIdentity: result.observedIdentity,
        status: 'MALFORMED_RESPONSE',
        failureCodes: ['MALFORMED_RESPONSE'],
      })
    }
    return validateM10FSemanticResponse({
      assembled: input.assembled,
      authority: input.authority,
      sampleIndex: input.sampleIndex,
      observedIdentity: result.observedIdentity,
      response,
    })
  } catch {
    return makeM10FSemanticFailureAttempt({
      assembled: input.assembled,
      authority: input.authority,
      sampleIndex: input.sampleIndex,
      status: 'TRANSPORT_FAILURE',
      failureCodes: ['SEMANTIC_TRANSPORT_FAILURE'],
    })
  }
}
