import { wrapLanguageModel, type LanguageModel } from 'ai'
import type { ModelCallExecutionOptions } from './provider'

export type FlagshipIdentityEvidence = Readonly<{
  requestedModel: string
  configuredModel: string
  responseModel: string | null
  providerRequested: string
  providerObserved: string | null
  canonicalResolution: 'EXACT_FROZEN_MATCH' | null
}>
export type FlagshipIdentityOutcome = 'PROVEN' | 'MISMATCH' | 'UNAVAILABLE' | 'UNPROVEN'
const MODEL = 'openai/gpt-5.6-sol'
const CANONICAL = 'openai/gpt-5.6-sol-20260709'

export function evaluateFlagshipIdentity(evidence: FlagshipIdentityEvidence): FlagshipIdentityOutcome {
  if (evidence.requestedModel !== MODEL || evidence.configuredModel !== MODEL
    || evidence.providerRequested !== 'openrouter'
    || (evidence.providerObserved !== null && evidence.providerObserved !== 'openrouter')) return 'MISMATCH'
  if (evidence.responseModel === null) return 'UNAVAILABLE'
  if (evidence.responseModel !== MODEL && evidence.responseModel !== CANONICAL) return 'MISMATCH'
  if (evidence.responseModel !== CANONICAL || evidence.canonicalResolution !== 'EXACT_FROZEN_MATCH'
    || evidence.providerObserved === null) return 'UNPROVEN'
  return 'PROVEN'
}

/** Internal operation result storage, never a callback or telemetry destination. */
export interface FlagshipCompletionCapture {
  transportOutcome: 'COMPLETED' | 'FAILED'
  identity: FlagshipIdentityEvidence
  finishReason: string | null
  parserOutcome: 'ACCEPTED' | 'REJECTED' | 'NOT_REACHED'
  evaluation?: Parameters<NonNullable<ModelCallExecutionOptions['observeWriterEvaluation']>>[0]
  deterministic?: Parameters<NonNullable<ModelCallExecutionOptions['observeWriterDeterministicEvaluation']>>[0]
}

export type FlagshipWriterResult = Readonly<FlagshipCompletionCapture & {
  identityOutcome: FlagshipIdentityOutcome
  writerOutcome: 'ACCEPTED' | 'REJECTED'
}>

export const flagshipCompletionCaptures = new WeakMap<ModelCallExecutionOptions, FlagshipCompletionCapture>()
const adapterModels = new WeakMap<FlagshipCompletionCapture, { model: string | null }>()

/** SDK synthesizes finalStep.response.modelId when adapter omits it. Preserve
 * adapter metadata before normalization, without retaining stream text. */
export function flagshipCompletionModel(model: LanguageModel, target: FlagshipCompletionCapture): LanguageModel {
  if (typeof model === 'string') throw new Error('WRITER_V2_FLAGSHIP_CONTROL_ADAPTER_REQUIRED')
  const raw = { model: null as string | null }
  adapterModels.set(target, raw)
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v4',
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(part, controller) {
          if (part.type === 'response-metadata' && typeof part.modelId === 'string' && part.modelId.trim()) {
            raw.model = part.modelId
          }
          controller.enqueue(part)
        },
      })) }
    },
  } })
}

export function createFlagshipCompletionCapture(): FlagshipCompletionCapture {
  return {
    transportOutcome: 'FAILED',
    identity: { requestedModel: MODEL, configuredModel: MODEL, responseModel: null,
      providerRequested: 'openrouter', providerObserved: null, canonicalResolution: null },
    finishReason: null,
    parserOutcome: 'NOT_REACHED',
  }
}

/** Capture SDK completion directly before consumer/parser or any observer runs.
 * Provider is never inferred from route or SDK model.provider (both are configured).
 */
export function captureFlagshipCompletion(
  target: FlagshipCompletionCapture,
  configuredModel: string,
  providerRequested: string,
  finalStep: { response?: { modelId?: unknown }; providerMetadata?: unknown; finishReason?: unknown } | undefined,
): void {
  const raw = adapterModels.get(target)
  const model = raw ? raw.model : finalStep?.response?.modelId
  const responseModel = typeof model === 'string' && model.trim() ? model : null
  // Explicit response metadata only. Absence remains unknown, including SDKs
  // which discard upstream provider identity while parsing compatible streams.
  const metadata = finalStep?.providerMetadata
  const provider = metadata && typeof metadata === 'object' && 'providerObserved' in metadata
    ? metadata.providerObserved : null
  target.transportOutcome = 'COMPLETED'
  target.identity = Object.freeze({
    requestedModel: MODEL, configuredModel, responseModel, providerRequested,
    providerObserved: typeof provider === 'string' && provider.trim() ? provider : null,
    canonicalResolution: responseModel === CANONICAL ? 'EXACT_FROZEN_MATCH' : null,
  })
  target.finishReason = typeof finalStep?.finishReason === 'string' ? finalStep.finishReason : null
}
