import { M10_G_G1_ROUTE_AUTHORITY } from '../../../fixtures/m10-g/g1-route-authority'
import {
  createM10GG1TokenEnvelopeAuthority,
  type M10GG1CandidateTokenEnvelope,
  type M10GG1TokenEnvelopeAuthority,
  type M10GG1TokenEnvelopeCallClass,
} from '../contracts/m10-g-g1-token-envelope.contract'
const sourceEvidence = (
  evidenceKind: 'FROZEN_ROUTE' | 'EFFECTIVE_EXECUTOR_SOURCE',
  sourceRef: string,
  sourceContentSha256: string,
  assertion: string,
) => ({ evidenceKind, sourceRef, sourceContentSha256, assertion }) as const

const writerEvidence = sourceEvidence(
  'FROZEN_ROUTE',
  'docs/WRITER_PROMPT_ARCHITECTURE_V2_SPEC.md#M10F_WRITER_V2_CONTROL_SCOPE_AMENDMENT_V1',
  '381e9c9ab887a88101bf6537d2a24639eda6ad19f689c7f2c08479e49638537f',
  'Frozen writer route openai/gpt-5.6-sol uses reasoning none, maxOutputTokens 4096, maxRetries 0, and no fallback.',
)
const continuityEvidence = sourceEvidence(
  'EFFECTIVE_EXECUTOR_SOURCE',
  'lib/ai-gateway/gateway-provider.ts#generateSemanticJudgeJson',
  '1162fb6e1ab224a9ad4f5db7a71cb5d4cfc3b4ca354ba14d2bb08a8ef83e1033',
  'Effective continuity request sets maxOutputTokens 512 and maxRetries 0.',
)
const choiceRoute = M10_G_G1_ROUTE_AUTHORITY.routes.choice
const choiceEvidence = sourceEvidence(
  'FROZEN_ROUTE',
  'fixtures/m10-g/g1-route-authority.ts#routes.choice',
  M10_G_G1_ROUTE_AUTHORITY.authorityHash,
  'Ratified G-1 choice route freezes ordered candidates openai/gpt-4.1-mini then deepseek/deepseek-v3.2, maxOutputTokens 1024, omitted reasoning, and maxRetries 0.',
)

/** Choice candidates derived from the ratified route bundle; never re-frozen here. */
const ROUTE_BOUND_CHOICE_CANDIDATES = Object.freeze(
  choiceRoute.providerModelCandidateOrder.map((item) => Object.freeze({
    providerId: item.provider,
    modelId: item.modelId,
    fallbackIndex: item.fallbackIndex,
    routeAuthorityHash: M10_G_G1_ROUTE_AUTHORITY.authorityHash,
    maximumOutputTokens: choiceRoute.maxOutput.presence === 'VALUE'
      ? Number(choiceRoute.maxOutput.value)
      : null,
    reasoningPolicyPresenceState: choiceRoute.reasoning.presence,
    reasoningPolicy: choiceRoute.reasoning.presence === 'VALUE'
      ? String(choiceRoute.reasoning.value)
      : null,
  })),
)

const longHorizonEvidence = sourceEvidence(
  'FROZEN_ROUTE',
  'lib/narrative-qa/contracts/m10-g-semantic-contract.ts#M10GExactExecutionIdentitySchema',
  '340fdc657e2961d8e8e84e8a8a19b161e7f78ebf867faa0d899cc0e460045221',
  'Frozen long-horizon execution identity omits maxOutputTokens and reasoning policy.',
)

function blockedInputAuthority() {
  return {
    state: 'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY' as const,
    maximumInputTokens: null,
    tokenizerId: null,
    tokenizerVersion: null,
    providerBilledFramingAlgorithm: null,
    providerBilledFramingVersion: null,
    proofEvidence: [],
  }
}

function candidate(input: Omit<M10GG1CandidateTokenEnvelope, 'candidateKey'>): M10GG1CandidateTokenEnvelope {
  return {
    ...input,
    candidateKey: `${input.callClass}:${input.modelId}:${input.fallbackIndex}`,
  }
}

/**
 * Frozen subgate-B authority. No tokenizer/framing proof exists in repository,
 * so no UTF-8 byte count is promoted to input-token authority.
 */
export function createM10GG1FrozenTokenEnvelopeAuthority(input?: Readonly<{
  choiceCandidates?: readonly Readonly<{
    providerId: string
    modelId: string
    fallbackIndex: number
    routeAuthorityHash: string
    maximumOutputTokens: number | null
    reasoningPolicyPresenceState: 'OMITTED' | 'NULL' | 'VALUE'
    reasoningPolicy: string | null
  }>[]
}>): M10GG1TokenEnvelopeAuthority {
  const candidates: M10GG1CandidateTokenEnvelope[] = [
    candidate({
      callClass: 'CHAPTER_PROSE', providerId: 'openrouter', modelId: 'openai/gpt-5.6-sol', fallbackIndex: 0,
      envelopeAlgorithm: 'EXACT_PROVIDER_TOKEN_AUTHORITY', envelopeAlgorithmVersion: '1',
      inputAuthority: blockedInputAuthority(),
      outputAuthority: { presenceState: 'VALUE', maximumOutputTokens: 4096, evidence: [writerEvidence] },
      reasoningPolicy: { presenceState: 'VALUE', value: 'none', evidence: [writerEvidence] },
      maximumProviderRequestsPerBoundaryInvocation: 1,
      maximumProviderCallsPerBoundaryInvocation: 1,
      choiceRouteBinding: null,
    }),
    ...['deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.1-terminus'].map((modelId, fallbackIndex) => candidate({
      callClass: 'CONTINUITY_JUDGE' as const, providerId: 'openrouter', modelId, fallbackIndex,
      envelopeAlgorithm: 'EXACT_PROVIDER_TOKEN_AUTHORITY' as const, envelopeAlgorithmVersion: '1' as const,
      inputAuthority: blockedInputAuthority(),
      outputAuthority: { presenceState: 'VALUE' as const, maximumOutputTokens: 512, evidence: [continuityEvidence] },
      reasoningPolicy: { presenceState: 'NULL' as const, value: null, evidence: [] },
      maximumProviderRequestsPerBoundaryInvocation: 1,
      maximumProviderCallsPerBoundaryInvocation: 1,
      choiceRouteBinding: null,
    })),
    candidate({
      callClass: 'LONG_HORIZON_SEMANTIC_JUDGE', providerId: 'openrouter',
      modelId: 'deepseek/deepseek-v3.2', fallbackIndex: 0,
      envelopeAlgorithm: 'EXACT_PROVIDER_TOKEN_AUTHORITY', envelopeAlgorithmVersion: '1',
      inputAuthority: blockedInputAuthority(),
      outputAuthority: { presenceState: 'OMITTED', maximumOutputTokens: null, evidence: [longHorizonEvidence] },
      reasoningPolicy: { presenceState: 'OMITTED', value: null, evidence: [longHorizonEvidence] },
      maximumProviderRequestsPerBoundaryInvocation: 1,
      maximumProviderCallsPerBoundaryInvocation: 1,
      choiceRouteBinding: null,
    }),
    ...(input?.choiceCandidates ?? ROUTE_BOUND_CHOICE_CANDIDATES).map((choice) => {
      const cap = choice.maximumOutputTokens
      const capPresence = cap === null ? 'NULL' as const : 'VALUE' as const
      const evidence = choice.routeAuthorityHash === M10_G_G1_ROUTE_AUTHORITY.authorityHash
        ? [choiceEvidence]
        : []
      return candidate({
        callClass: 'CHOICE_GENERATION' as const,
        providerId: choice.providerId,
        modelId: choice.modelId,
        fallbackIndex: choice.fallbackIndex,
        envelopeAlgorithm: 'EXACT_PROVIDER_TOKEN_AUTHORITY' as const,
        envelopeAlgorithmVersion: '1' as const,
        inputAuthority: blockedInputAuthority(),
        outputAuthority: { presenceState: capPresence, maximumOutputTokens: cap, evidence },
        reasoningPolicy: {
          presenceState: choice.reasoningPolicyPresenceState,
          value: choice.reasoningPolicy,
          evidence: choice.reasoningPolicyPresenceState === 'VALUE' ? evidence : [],
        },
        maximumProviderRequestsPerBoundaryInvocation: 1,
        maximumProviderCallsPerBoundaryInvocation: 1,
        choiceRouteBinding: {
          routeAuthorityState: 'BOUND' as const,
          routeAuthorityHash: choice.routeAuthorityHash,
          routeMaximumOutputTokensPresenceState: capPresence,
          routeMaximumOutputTokens: cap,
        },
      })
    }),
  ]
  return createM10GG1TokenEnvelopeAuthority(candidates)
}

export const M10G_G1_TOKEN_ENVELOPE_REQUIRED_CLASSES = Object.freeze([
  'CHAPTER_PROSE',
  'CONTINUITY_JUDGE',
  'CHOICE_GENERATION',
  'LONG_HORIZON_SEMANTIC_JUDGE',
] satisfies readonly M10GG1TokenEnvelopeCallClass[])
