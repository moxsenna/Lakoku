import 'server-only'
import type { streamText } from 'ai'
import {
  ChoiceValidationStageValues,
} from '@/lib/observability/choice-validation-diagnostics.pure'
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
import {
  ContentRejectedError,
  InvalidModelResponseError,
  sanitizeChoiceValidationCodes,
} from './model-call-errors'
import type { ObservedReasoningBudget } from './reasoning-budget.contract'

export { ContentRejectedError, InvalidModelResponseError } from './model-call-errors'

export type ObservedModelCallMetadata = Readonly<{
  finishReason: string | undefined
}>

export type { ObservedReasoningBudget } from './reasoning-budget.contract'

export interface ObservedModelCallInput<T> {
  context: ProviderCallContext
  candidate: ModelCandidateIdentity
  useCase: string
  workflowPhase: string
  call: () => ReturnType<typeof streamText>
  consume: (text: string, metadata: ObservedModelCallMetadata) => T | Promise<T>
  classifyFailure?: (error: unknown) => FailureClassification | null
  /** Additive metadata-only seam; never receives model text. */
  observeCompletion?: (
    completion: ProviderCallCompletion,
    metadata: ObservedModelCallMetadata,
  ) => void
  /** Additive metadata-only seam; counts only, never reasoning text or prose. */
  observeReasoningBudget?: (budget: ObservedReasoningBudget) => void
  /** Offline synthetic diagnostics can prove DB isolation by disabling recorder calls. */
  persistObservation?: boolean
}

export interface ObservedModelCallDeps {
  createId: () => string
  now: () => Date
  monotonicNow: () => number
  record: (
    start: ProviderCallStart,
    completion: ProviderCallCompletion,
  ) => Promise<void>
  recorderTimeoutMs: number
}

type ObservedUsage = {
  inputTokens?: unknown
  outputTokens?: unknown
  totalTokens?: unknown
  outputTokenDetails?: {
    reasoningTokens?: unknown
  }
}

type ObservedFinalStep = {
  response?: {
    modelId?: unknown
  }
  providerMetadata?: unknown
  finishReason?: unknown
  reasoning?: unknown
  reasoningText?: unknown
}

type ResolvedObservation = {
  usage: ObservedUsage
  finalStep: ObservedFinalStep
}

export type FailureClassification = {
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
  recorderTimeoutMs: 1_500,
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

/**
 * Metadata-only. Membaca panjang teks dan hitungan token saja; isi reasoning
 * maupun prosa tidak pernah disalin ke hasil.
 */
function reasoningBudget(
  text: string,
  observation: Partial<ResolvedObservation>,
  finishReason: string | undefined,
): ObservedReasoningBudget {
  const finalStep = observation.finalStep
  const reasoningParts = finalStep?.reasoning
  const reasoningText = finalStep?.reasoningText

  return {
    reasoningTokenCount: scalarTokenCount(observation.usage?.outputTokenDetails?.reasoningTokens),
    reasoningFieldPresent: (typeof reasoningText === 'string' && reasoningText.length > 0)
      || (Array.isArray(reasoningParts) && reasoningParts.length > 0),
    reasoningDetailsPresent: Array.isArray(reasoningParts) && reasoningParts.length > 0,
    visibleContentChars: text.trim().length,
    completionTokenCount: scalarTokenCount(observation.usage?.outputTokens),
    finishReason,
  }
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
    return { outcome: 'CONTENT_REJECTED', errorCode: 'PROVIDER_CONTENT_REJECTED' }
  }
  if (error instanceof InvalidModelResponseError || errorName(error) === 'AI_InvalidResponseDataError') {
    return { outcome: 'INVALID_RESPONSE', errorCode: 'PROVIDER_INVALID_RESPONSE' }
  }
  if (errorName(error) === 'TimeoutError') {
    return { outcome: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' }
  }
  if (errorName(error) === 'AbortError') {
    return { outcome: 'ABORTED', errorCode: 'PROVIDER_ABORTED' }
  }
  return { outcome: 'PROVIDER_ERROR', errorCode: 'PROVIDER_REQUEST_FAILED' }
}

function validationDiagnostics(
  classification: FailureClassification,
  error: unknown,
): Pick<ProviderCallCompletion, 'validationStage' | 'validationCodes'> {
  if (
    classification.outcome !== 'INVALID_RESPONSE'
    || classification.errorCode !== 'PROVIDER_INVALID_RESPONSE'
    || !(error instanceof InvalidModelResponseError)
    || error.validationStage === undefined
    || !ChoiceValidationStageValues.includes(error.validationStage)
  ) {
    return { validationStage: null, validationCodes: null }
  }
  return {
    validationStage: error.validationStage,
    validationCodes: sanitizeChoiceValidationCodes(error.validationCodes),
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
  const recorder = Promise.resolve()
    .then(() => deps.record(start, completion))
    .catch(() => undefined)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, deps.recorderTimeoutMs)
  })

  try {
    await Promise.race([recorder, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
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
    validationStage: null,
    validationCodes: null,
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
  let observedFinishReason: string | undefined

  try {
    // Await the call itself first: streamText returns a result object whose
    // fields are promises, but generateText returns a Promise. Reading `.text`
    // off the raw call result is `undefined` for async calls.
    const result = await input.call()
    // Attach rejection handlers immediately. Usage/final-step promises may reject
    // before slower model text settles, but remain best-effort telemetry only.
    const usagePromise = Promise.resolve()
      .then(() => result.usage)
      .catch(() => undefined)
    const finalStepPromise = Promise.resolve()
      .then(() => result.finalStep)
      .catch(() => undefined)
    const text = await result.text
    const [usage, finalStep] = await Promise.all([
      usagePromise,
      finalStepPromise,
    ])
    observation = {
      usage: usage as ObservedUsage | undefined,
      finalStep: finalStep as ObservedFinalStep | undefined,
    }
    observedFinishReason = typeof observation.finalStep?.finishReason === 'string'
      ? observation.finalStep.finishReason
      : undefined
    // Dilaporkan sebelum consume agar cap-exhaustion tetap terbaca ketika parser
    // menolak teks kosong dan completeness tidak pernah berjalan.
    input.observeReasoningBudget?.(
      reasoningBudget(text, observation, observedFinishReason),
    )
    const value = await input.consume(text, { finishReason: observedFinishReason })
    const completion: ProviderCallCompletion = {
      ...completionBase(
        input as ObservedModelCallInput<unknown>,
        observation,
        deps.now(),
        elapsedMs(monotonicStart, deps.monotonicNow()),
      ),
      outcome: 'SUCCEEDED',
      errorCode: null,
      validationStage: null,
      validationCodes: null,
    }
    input.observeCompletion?.(completion, { finishReason: observedFinishReason })
    if (input.persistObservation !== false) await recordBestEffort(start, completion, deps)
    return value
  } catch (error) {
    const classification = input.classifyFailure?.(error) ?? classifyFailure(error)
    const completion: ProviderCallCompletion = {
      ...completionBase(
        input as ObservedModelCallInput<unknown>,
        observation,
        deps.now(),
        elapsedMs(monotonicStart, deps.monotonicNow()),
      ),
      ...classification,
      ...validationDiagnostics(classification, error),
    }
    input.observeCompletion?.(completion, { finishReason: observedFinishReason })
    if (input.persistObservation !== false) await recordBestEffort(start, completion, deps)
    throw error
  }
}
