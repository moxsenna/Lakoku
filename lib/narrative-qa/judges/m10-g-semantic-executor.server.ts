import 'server-only'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, streamText } from 'ai'
import { z } from 'zod'
import type { ModelCallExecutionOptions } from '@/lib/ai-gateway/provider'
import type { M10GSemanticCaptureWriter } from './m10-g-semantic-capture.server'
import { GlobalInferenceBudgetError } from '@/lib/ai-gateway/global-inference-budget.contract'
import type {
  M10GAssembledSemanticCase,
  M10GObservedExecutionIdentity,
  M10GSemanticAttempt,
  M10GSemanticAuthority,
  M10GTransportCapture,
} from '../contracts/m10-g-semantic-contract'
import { M10GSemanticAttemptSchema, M10GTransportCaptureSchema } from '../contracts/m10-g-semantic-contract'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'
import { buildM10GSemanticPrompt } from './m10-g-semantic-prompts'
import {
  validateM10GSemanticResponse,
  type M10GRawJudgeResponse,
} from './m10-g-semantic-policy'

const authoritativeAttemptBrand: unique symbol = Symbol('M10GAuthoritativeSemanticAttempt')
const issuedAttempts = new WeakSet<object>()

export type M10GAuthoritativeSemanticAttempt = M10GSemanticAttempt & {
  readonly [authoritativeAttemptBrand]: true
}

export interface M10GSemanticTransportInput {
  system: string
  prompt: string
  providerId: 'openrouter'
  configuredModelId: 'deepseek/deepseek-v3.2'
  routeVersion: '2026-08-m10g-live'
  fallbackIndex: 0
  temperature: 0
  maxRetries: 0
  candidateId: string
  sampleIndex: number
  executionOptions: ModelCallExecutionOptions
}

export interface M10GSemanticTransportResult {
  rawResponse: string
  capture: M10GTransportCapture
}

export type M10GSemanticTransport = (
  input: M10GSemanticTransportInput,
) => M10GSemanticTransportResult

export type M10GTrustedSemanticTransport = (
  input: M10GSemanticTransportInput,
) => M10GSemanticTransportResult | Promise<M10GSemanticTransportResult>

const StrictJudgeResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  modelVerdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  confidence: z.number().int().min(0).max(100),
  evidenceMode: z.enum(['SPAN', 'FULL_HORIZON_ABSENCE']),
  findingCodes: z.array(z.string()).min(1).max(8),
  evidence: z.array(z.object({
    segmentId: z.string().min(1).max(160),
    quote: z.string().min(1).max(4_000),
  }).strict()).max(20),
  absenceCode: z.literal('EMOTIONAL_RESOLUTION_ABSENT').optional(),
  rationaleSummary: z.string().min(1).max(1_000),
}).strict()

export async function openRouterM10GSemanticTransport(
  input: M10GSemanticTransportInput,
): Promise<M10GSemanticTransportResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for M10-G semantic execution')
  if (input.maxRetries !== 0 || input.fallbackIndex !== 0) {
    throw new Error('M10G_SEMANTIC_EXECUTION_POLICY_UNSUPPORTED')
  }
  const openrouter = createOpenAICompatible({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    supportsStructuredOutputs: true,
    includeUsage: true,
  })
  let capture: M10GTransportCapture = {
    runId: input.executionOptions.globalInferenceBudget?.runId ?? '',
    correlationId: input.executionOptions.telemetryContext.correlationId ?? '',
    candidateId: input.candidateId,
    sampleIndex: input.sampleIndex,
    providerId: input.providerId,
    configuredModelId: input.configuredModelId,
    routeVersion: input.routeVersion,
    fallbackIndex: input.fallbackIndex,
    actualModelId: null,
    actualModelResolved: false,
    finishReason: null,
    outcome: 'PROVIDER_ERROR',
    errorCode: 'PROVIDER_REQUEST_FAILED',
  }
  const result = await streamText({
    model: openrouter(input.configuredModelId),
    system: input.system,
    prompt: input.prompt,
    output: Output.object({ schema: StrictJudgeResponseSchema }),
    temperature: input.temperature,
    maxRetries: input.maxRetries,
    onFinish: ({ response, finishReason }) => {
      const actualModelId = response.modelId?.trim() || null
      capture = {
        ...capture,
        actualModelId,
        actualModelResolved: actualModelId !== null,
        finishReason,
        outcome: 'SUCCEEDED',
        errorCode: null,
      }
    },
  })
  return { rawResponse: await result.text, capture: M10GTransportCaptureSchema.parse(capture) }
}

function observedIdentity(capture: M10GTransportCapture): M10GObservedExecutionIdentity {
  return {
    providerId: capture.providerId,
    actualModelId: capture.actualModelId,
    actualModelResolved: capture.actualModelResolved,
    fallbackIndex: capture.fallbackIndex,
    routeVersion: capture.routeVersion,
  }
}

function exactIdentityValid(
  authority: M10GSemanticAuthority,
  capture: M10GTransportCapture,
): boolean {
  const expected = authority.executionIdentity
  return capture.providerId === expected.providerId
    && capture.configuredModelId === expected.configuredModelId
    && capture.actualModelId === expected.expectedActualModelId
    && capture.actualModelResolved
    && capture.fallbackIndex === expected.primaryIndex
    && capture.routeVersion === expected.routeVersion
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function issueAttempt(payload: Omit<M10GSemanticAttempt, 'attemptId'>): M10GAuthoritativeSemanticAttempt {
  const parsed = M10GSemanticAttemptSchema.parse({
    ...payload,
    attemptId: computeSha256(stableStringify(payload)),
  }) as M10GAuthoritativeSemanticAttempt
  Object.defineProperty(parsed, authoritativeAttemptBrand, { value: true })
  issuedAttempts.add(parsed)
  return freezeDeep(parsed)
}

export function assertM10GAuthoritativeSemanticAttempt(
  attempt: M10GAuthoritativeSemanticAttempt,
): void {
  if (!issuedAttempts.has(attempt)) {
    throw new Error('M10-G semantic artifact requires executor-issued authoritative attempts')
  }
}

export async function executeM10GSemanticJudgeWithTrustedCapture(input: {
  assembled: M10GAssembledSemanticCase
  authority: M10GSemanticAuthority
  sampleIndex: number
  executionOptions: ModelCallExecutionOptions
  transport?: M10GTrustedSemanticTransport
  captureWriter: M10GSemanticCaptureWriter
}): Promise<M10GAuthoritativeSemanticAttempt> {
  const execution = input.authority.executionIdentity
  if (execution.maxRetries !== 0 || execution.fallbackAllowed || execution.primaryIndex !== 0) {
    throw new Error('M10G_SEMANTIC_EXECUTION_POLICY_UNSUPPORTED')
  }
  const budget = input.executionOptions.globalInferenceBudget
  if (!budget) throw new GlobalInferenceBudgetError('M10G_GLOBAL_INFERENCE_BUDGET_REQUIRED')
  if (budget.runId !== input.assembled.identity.runId) {
    throw new Error('M10G_SEMANTIC_GLOBAL_BUDGET_RUN_MISMATCH')
  }
  const prompt = buildM10GSemanticPrompt(input.assembled.caseAuthority.rubricId, input.assembled.judgeInput)
  if (prompt.templateHash !== input.assembled.promptHash) throw new Error('PROMPT_HASH_MISMATCH')
  const candidateId = `${input.assembled.caseAuthority.caseId}:sample-${input.sampleIndex}`
  const transportInput: M10GSemanticTransportInput = {
    system: prompt.system,
    prompt: prompt.user,
    providerId: execution.providerId,
    configuredModelId: execution.configuredModelId,
    routeVersion: execution.routeVersion,
    fallbackIndex: execution.primaryIndex,
    temperature: execution.temperature,
    maxRetries: execution.maxRetries,
    candidateId,
    sampleIndex: input.sampleIndex,
    executionOptions: input.executionOptions,
  }
  budget.reserve('semantic', {
    workflowPhase: input.executionOptions.workflowPhase,
    providerId: execution.providerId,
    modelId: execution.configuredModelId,
    fallbackIndex: execution.primaryIndex,
  })
  const transport = input.transport ?? openRouterM10GSemanticTransport
  const invoke = () => transport(transportInput)
  const completion = input.executionOptions.providerRuntime?.candidateTransport
    ? await input.executionOptions.providerRuntime.candidateTransport({
      kind: 'semantic',
      providerId: execution.providerId,
      modelId: execution.configuredModelId,
      fallbackIndex: execution.primaryIndex,
      execute: invoke,
    }) as M10GSemanticTransportResult
    : await invoke()
  const attempt = executeM10GSemanticJudge({
    assembled: input.assembled,
    authority: input.authority,
    sampleIndex: input.sampleIndex,
    executionOptions: {
      ...input.executionOptions,
      m10gMode: false,
      globalInferenceBudget: undefined,
      providerRuntime: undefined,
    },
    transport: () => completion,
  })
  input.captureWriter.write(attempt)
  return attempt
}

/**
 * Executes exactly one M10-G judge candidate. No production transport exists:
 * caller must inject transport that returns complete frozen capture provenance.
 */
export function executeM10GSemanticJudge(input: {
  assembled: M10GAssembledSemanticCase
  authority: M10GSemanticAuthority
  sampleIndex: number
  executionOptions: ModelCallExecutionOptions
  transport: M10GSemanticTransport
}): M10GAuthoritativeSemanticAttempt {
  const { assembled, authority, sampleIndex, executionOptions } = input
  const execution = authority.executionIdentity
  if (execution.maxRetries !== 0 || execution.fallbackAllowed || execution.primaryIndex !== 0) {
    throw new Error('M10G_SEMANTIC_EXECUTION_POLICY_UNSUPPORTED')
  }
  const prompt = buildM10GSemanticPrompt(assembled.caseAuthority.rubricId, assembled.judgeInput)
  if (prompt.templateHash !== assembled.promptHash) throw new Error('PROMPT_HASH_MISMATCH')
  if (executionOptions.m10gMode && !executionOptions.globalInferenceBudget) {
    throw new GlobalInferenceBudgetError('M10G_GLOBAL_INFERENCE_BUDGET_REQUIRED')
  }
  const candidateId = `${assembled.caseAuthority.caseId}:sample-${sampleIndex}`
  executionOptions.globalInferenceBudget?.reserve('semantic', {
    workflowPhase: executionOptions.workflowPhase,
    providerId: execution.providerId,
    modelId: execution.configuredModelId,
    fallbackIndex: execution.primaryIndex,
  })
  const execute = () => input.transport({
    system: prompt.system,
    prompt: prompt.user,
    providerId: execution.providerId,
    configuredModelId: execution.configuredModelId,
    routeVersion: execution.routeVersion,
    fallbackIndex: execution.primaryIndex,
    temperature: execution.temperature,
    maxRetries: execution.maxRetries,
    candidateId,
    sampleIndex,
    executionOptions,
  })
  const result = executionOptions.providerRuntime?.candidateTransport
    ? executionOptions.providerRuntime.candidateTransport({
      kind: 'semantic', providerId: execution.providerId, modelId: execution.configuredModelId,
      fallbackIndex: execution.primaryIndex, execute,
    }) as M10GSemanticTransportResult
    : execute()
  const capture = M10GTransportCaptureSchema.parse(result.capture)
  if (capture.runId !== assembled.identity.runId
    || capture.correlationId !== assembled.identity.correlationId
    || capture.candidateId !== candidateId
    || capture.sampleIndex !== sampleIndex) {
    throw new Error('M10G_SEMANTIC_CAPTURE_PROVENANCE_MISMATCH')
  }
  const identity = observedIdentity(capture)
  const binding = {
    schemaVersion: 1 as const,
    identity: assembled.identity,
    authorityHash: authority.authorityHash,
    sourceSurfaceAuthorityHash: assembled.sourceSurfaceAuthorityHash,
    sourceManifestContentSha256: assembled.sourceManifestContentSha256,
    sourceCaptureContentSha256: assembled.sourceCaptureContentSha256,
    storySurfaceHash: assembled.storySurfaceHash,
    caseId: assembled.caseAuthority.caseId,
    rubricId: assembled.caseAuthority.rubricId,
    sampleIndex,
    judgeInputHash: assembled.judgeInputHash,
    promptHash: assembled.promptHash,
    configuredExecutionIdentity: execution,
    observedIdentity: identity,
    transportCapture: capture,
    rawResponse: result.rawResponse,
    rawResponseSha256: computeSha256(result.rawResponse),
    assembledJudgeInputSha256: computeSha256(stableStringify(assembled.judgeInput)),
  }
  const failure = (status: Exclude<M10GSemanticAttempt['status'], 'VALID'>, failureCodes: string[]) => issueAttempt({
    ...binding, status, score: null, modelVerdict: null, confidence: null, findingCodes: [],
    evidenceMode: null, evidenceRefs: [], rationaleSummaryHash: null,
    failureCodes: [...new Set(failureCodes)].sort(),
  })
  if (capture.outcome !== 'SUCCEEDED' || capture.errorCode !== null || capture.finishReason === null) {
    return failure('TRANSPORT_FAILURE', ['SEMANTIC_TRANSPORT_FAILURE'])
  }
  if (!exactIdentityValid(authority, capture)) {
    return failure('MODEL_IDENTITY_FAILURE', ['MODEL_IDENTITY_MISMATCH'])
  }
  let response: M10GRawJudgeResponse
  try {
    response = JSON.parse(result.rawResponse) as M10GRawJudgeResponse
  } catch {
    return failure('MALFORMED_RESPONSE', ['MALFORMED_RESPONSE'])
  }
  const facts = validateM10GSemanticResponse({ assembled, response })
  if (!facts.valid) {
    return failure(facts.status === 'MALFORMED_RESPONSE' ? 'MALFORMED_RESPONSE' : 'EVIDENCE_FAILURE', [...facts.failureCodes])
  }
  return issueAttempt({
    ...binding,
    status: 'VALID',
    score: facts.score,
    modelVerdict: facts.modelVerdict,
    confidence: facts.confidence,
    findingCodes: [...facts.findingCodes],
    evidenceMode: facts.evidenceMode,
    evidenceRefs: facts.evidence.map((evidence) => ({
      ...evidence, quoteHash: computeSha256(evidence.quote),
    })),
    rationaleSummaryHash: computeSha256(facts.rationaleSummary!),
    failureCodes: [],
  })
}
