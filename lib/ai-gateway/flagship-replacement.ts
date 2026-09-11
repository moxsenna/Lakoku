import type { LanguageModel } from 'ai'
import type { GenerationProvider } from './provider'
import type { FlagshipIdentityOutcome } from './flagship-identity-evidence'

const adapters = new WeakSet<object>()
const providers = new WeakMap<GenerationProvider, Readonly<{
  gatewayTransport: 'OpenRouter'
  requestedModel: 'openai/gpt-5.6-sol'
  rawResponseModelCapture: true
  observerAuthorityDisabled: true
}>>()

/** Called only where gateway constructs actual fixed-endpoint OpenRouter adapter. */
export function registerReplacementOpenRouterAdapter(model: LanguageModel): LanguageModel {
  if (typeof model !== 'string') adapters.add(model)
  return model
}

export function bindReplacementProvider(provider: GenerationProvider, model: LanguageModel | undefined, modelId: string | undefined): void {
  if (model && typeof model !== 'string' && adapters.has(model) && modelId === 'openai/gpt-5.6-sol') {
    providers.set(provider, Object.freeze({ gatewayTransport: 'OpenRouter', requestedModel: modelId, rawResponseModelCapture: true, observerAuthorityDisabled: true }))
  }
}

export function getReplacementAdapterEvidence(provider: GenerationProvider) {
  return providers.get(provider) ?? null
}

/** Physical upstream provider deliberately absent: transport is not physical provider. */
export function evaluateReplacementIdentity(responseModel: string | null, adapterProven: boolean): FlagshipIdentityOutcome {
  if (responseModel === null) return 'UNAVAILABLE'
  if (responseModel !== 'openai/gpt-5.6-sol' && responseModel !== 'openai/gpt-5.6-sol-20260709') return 'MISMATCH'
  return adapterProven && responseModel === 'openai/gpt-5.6-sol-20260709' ? 'PROVEN' : 'UNPROVEN'
}
