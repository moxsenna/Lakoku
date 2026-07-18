import 'server-only'
import type { streamText } from 'ai'
import type {
  ModelCandidateIdentity,
  ProviderCallCompletion,
  ProviderCallContext,
  ProviderCallOutcome,
} from '@/lib/observability/generation-provider-call.contract'
import {
  recordGenerationProviderCall,
  type ProviderCallStart,
} from '@/lib/observability/generation-provider-call.server'

export class InvalidModelResponseError extends Error {
  constructor(message = 'Model response failed validation.') {
    super(message)
    this.name = 'InvalidModelResponseError'
  }
}

export class ContentRejectedError extends Error {
  constructor(message = 'Model content was rejected.') {
    super(message)
    this.name = 'ContentRejectedError'
  }
}

export interface ObservedModelCallInput<T> {
  context: ProviderCallContext
  candidate: ModelCandidateIdentity
  useCase: string
  workflowPhase: string
  call: () => ReturnType<typeof streamText>
  consume: (text: string) => T | Promise<T>
}

export interface ObservedModelCallDeps {
  createId: () => string
  now: () => Date
  monotonicNow: () => number
  record: (
    start: ProviderCallStart,
    completion: ProviderCallCompletion,
  ) => Promise<void>
}

type ObservedUsage = {
  inputTokens?: unknown
  outputTokens?: unknown
  totalTokens?: unknown
}

type ObservedFinalStep = {
  response?: {
    modelId?: unknown
  }
  providerMetadata?: unknown
}

type ResolvedObservation = {
  usage: ObservedUsage
  finalStep: ObservedFinalStep
}

type FailureClassification = {
  outcome: Exclude<ProviderCallOutcome, 'SUCCEEDED'>
  errorCode: string
}

const ISO_CURRENCY = /^[A-Z]{3}$/
const COST_AMOUNT = /^\d{1,12}(?:\.\d{1,8})?$/

const defaultObservedModelCallDeps: ObservedModelCallDeps = {
  createId: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
  monotonicNow: () => performance.now(),
  record: recordGenerationProviderCall,
}

function scalarTokenCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null
}

function normalizedUsage(usage: ObservedUsage | undefined): Pick<
  ProviderCallCompletion,
  'inputTokenCount' | 'outputTokenCount' | 'totalTokenCount'
> {
  const inputTokenCount = scalarTokenCount(usage?.inputTokens)
  const outputTokenCount = scalarTokenCount(usage?.outputTokens)
  let totalTokenCount = scalarTokenCount(usage?.totalTokens)

  if (
    inputTokenCount !== null
    && outputTokenCount !== null
    && totalTokenCount !== null
    && inputTokenCount + outputTokenCount !== totalTokenCount
  ) {
    totalTokenCount = null
  }

  return { inputTokenCount, outputTokenCount, totalTokenCount }
}

function decimalCost(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null

  const fixed = value.toFixed(8).replace(/(?:\.0+|(\.\d*?)0+)$/, '$1')
  if (Number(fixed) !== value || !COST_AMOUNT.test(fixed)) return null
  return fixed
}

function providerCost(
  providerMetadata: unknown,
  providerId: string,
): Pick<
  ProviderCallCompletion,
  'providerActualCostAmount' | 'providerActualCostCurrency'
> {
  if (!providerMetadata || typeof providerMetadata !== 'object' || Array.isArray(providerMetadata)) {
    return {
      providerActualCostAmount: null,
      providerActualCostCurrency: null,
    }
  }

  const providerEntry = (providerMetadata as Record<string, unknown>)[providerId]
  if (!providerEntry || typeof providerEntry !== 'object' || Array.isArray(providerEntry)) {
    return {
      providerActualCostAmount: null,
      providerActualCostCurrency: null,
    }
  }

  const known = providerEntry as Record<string, unknown>
  const amount = decimalCost(known.cost)
  const currency = typeof known.currency === 'string' && ISO_CURRENCY.test(known.currency)
    ? known.currency
    : null

  if (amount === null || currency === null) {
    return {
      providerActualCostAmount: null,
      providerActualCostCurrency: null,
    }
  }

  return {
    providerActualCostAmount: amount,
    providerActualCostCurrency: currency,
  }
}

function actualModel(
  finalStep: ObservedFinalStep | undefined,
  configuredModelId: string,
): { actualModelId: string; actualModelResolved: boolean } {
  const modelId = finalStep?.response?.modelId
  if (typeof modelId === 'string' && modelId.trim().length > 0) {
    return { actualModelId: modelId, actualModelResolved: true }
  }
  return { actualModelId: configuredModelId, actualModelResolved: false }
}

function elapsedMs(monotonicStart: number, monotonicEnd: number): number {
  const elapsed = monotonicEnd - monotonicStart
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0
}

function classifyFailure(error: unknown): FailureClassification {
  if (error instanceof ContentRejectedError) {
    return {
      outcome: 'CONTENT_REJECTED',
      errorCode: 'PROVIDER_CONTENT_REJECTED',
    }
  }
  if (
    error instanceof InvalidModelResponseError
    || errorName(error) === 'AI_InvalidResponseDataError'
  ) {
    return {
      outcome: 'INVALID_RESPONSE',
      errorCode: 'PROVIDER_INVALID_RESPONSE',
    }
  }
  if (errorName(error) === 'TimeoutError') {
    return { outcome: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' }
  }
  if (errorName(error) === 'AbortError') {
    return { outcome: 'ABORTED', errorCode: 'PROVIDER_ABORTED' }
  }
  return {
    outcome: 'PROVIDER_ERROR',
    errorCode: 'PROVIDER_REQUEST_FAILED',
  }
}

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

async function recordBestEffort(
  start: ProviderCallStart,
  completion: ProviderCallCompletion,
  deps: ObservedModelCallDeps,
): Promise<void> {
  try {
    await deps.record(start, completion)
  } catch {
    // Observability must never change generation success or original failure.
  }
}

function completionBase(
  input: ObservedModelCallInput<unknown>,
  observation: Partial<ResolvedObservation>,
  endedAt: Date,
  elapsed: number,
): Omit<ProviderCallCompletion, 'outcome' | 'errorCode'> {
  return {
    actualProviderId: input.candidate.providerId,
    ...actualModel(observation.finalStep, input.candidate.configuredModelId),
    endedAt: endedAt.toISOString(),
    elapsedMs: elapsed,
    ...normalizedUsage(observation.usage),
    ...providerCost(
      observation.finalStep?.providerMetadata,
      input.candidate.providerId,
    ),
  }
}

export async function executeObservedModelCall<T>(
  input: ObservedModelCallInput<T>,
  deps: ObservedModelCallDeps = defaultObservedModelCallDeps,
): Promise<T> {
  const providerCallId = deps.createId()
  const startedAt = deps.now()
  const monotonicStart = deps.monotonicNow()
  const start: ProviderCallStart = {
    providerCallId,
    context: input.context,
    candidate: input.candidate,
    useCase: input.useCase,
    workflowPhase: input.workflowPhase,
    startedAt: startedAt.toISOString(),
  }
  let observation: Partial<ResolvedObservation> = {}

  try {
    const result = input.call()
    const [text, usage, finalStep] = await Promise.all([
      result.text,
      result.usage,
      result.finalStep,
    ])
    observation = {
      usage: usage as ObservedUsage,
      finalStep: finalStep as ObservedFinalStep,
    }
    const value = await input.consume(text)
    const completion: ProviderCallCompletion = {
      ...completionBase(
        input as ObservedModelCallInput<unknown>,
        observation,
        deps.now(),
        elapsedMs(monotonicStart, deps.monotonicNow()),
      ),
      outcome: 'SUCCEEDED',
      errorCode: null,
    }
    await recordBestEffort(start, completion, deps)
    return value
  } catch (error) {
    const classification = classifyFailure(error)
    const completion: ProviderCallCompletion = {
      ...completionBase(
        input as ObservedModelCallInput<unknown>,
        observation,
        deps.now(),
        elapsedMs(monotonicStart, deps.monotonicNow()),
      ),
      ...classification,
    }
    await recordBestEffort(start, completion, deps)
    throw error
  }
}
