import type { GlobalInferenceBudget } from './global-inference-budget.contract'
import type {
  M10GG1CandidateTokenEnvelope,
  M10GG1TokenEnvelopeCallClass,
} from '../narrative-qa/contracts/m10-g-g1-token-envelope.contract'

export type M10GG1RouteAttestation = Readonly<{
  callClass: M10GG1TokenEnvelopeCallClass
  providerId: string
  modelId: string
  fallbackIndex: number
  outputPresenceState: 'OMITTED' | 'NULL' | 'VALUE'
  maximumOutputTokens: number | null
}>

export class M10GG1TokenBoundaryError extends Error {
  constructor(readonly code:
    | 'M10G_G1_ROUTE_ATTESTATION_MISMATCH'
    | 'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY'
    | 'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND'
    | 'M10G_G1_SERIALIZED_REQUEST_HASH_MISMATCH'
    | 'M10G_G1_SERIALIZED_REQUEST_TOKEN_LIMIT_EXCEEDED') {
    super(code)
    this.name = 'M10GG1TokenBoundaryError'
  }
}

export type M10GG1SerializedRequest = Readonly<{
  /** Exact bytes sent by injected transport, including provider-added billed framing. */
  bytes: Uint8Array
  /** Digest binds bytes validated here to bytes accepted by injected transport. */
  sha256: string
}>

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function assertRoute(
  candidate: M10GG1CandidateTokenEnvelope,
  attested: M10GG1RouteAttestation,
): void {
  if (candidate.callClass !== attested.callClass
    || candidate.providerId !== attested.providerId
    || candidate.modelId !== attested.modelId
    || candidate.fallbackIndex !== attested.fallbackIndex
    || candidate.outputAuthority.presenceState !== attested.outputPresenceState
    || candidate.outputAuthority.maximumOutputTokens !== attested.maximumOutputTokens) {
    throw new M10GG1TokenBoundaryError('M10G_G1_ROUTE_ATTESTATION_MISMATCH')
  }
}

/**
 * Guarded candidate boundary. Callback nesting makes order structural:
 * attestation, complete serialization, token validation, global reserve, transport.
 * No truncation path exists. Each invocation represents one retry/fallback candidate.
 */
export async function executeM10GG1TokenGuardedCandidate<T>(input: Readonly<{
  candidate: M10GG1CandidateTokenEnvelope
  budget: GlobalInferenceBudget
  workflowPhase: string
  attestRoute: () => M10GG1RouteAttestation | Promise<M10GG1RouteAttestation>
  serializeFullRequest: (attestation: M10GG1RouteAttestation) =>
    M10GG1SerializedRequest | Promise<M10GG1SerializedRequest>
  validateExactTokens: (input: Readonly<{
    candidate: M10GG1CandidateTokenEnvelope
    serializedRequest: M10GG1SerializedRequest
  }>) => number | Promise<number>
  transport: (serializedRequest: M10GG1SerializedRequest) => T | Promise<T>
}>): Promise<T> {
  const attestation = await input.attestRoute()
  assertRoute(input.candidate, attestation)
  const serializedRequest = await input.serializeFullRequest(attestation)

  if (input.candidate.inputAuthority.state !== 'AUTHORITATIVE') {
    throw new M10GG1TokenBoundaryError('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')
  }
  if (input.candidate.outputAuthority.presenceState !== 'VALUE') {
    throw new M10GG1TokenBoundaryError('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
  }
  if (await sha256(serializedRequest.bytes) !== serializedRequest.sha256) {
    throw new M10GG1TokenBoundaryError('M10G_G1_SERIALIZED_REQUEST_HASH_MISMATCH')
  }

  const exactInputTokens = await input.validateExactTokens({
    candidate: input.candidate,
    serializedRequest,
  })
  if (!Number.isSafeInteger(exactInputTokens) || exactInputTokens < 0
    || exactInputTokens > input.candidate.inputAuthority.maximumInputTokens) {
    throw new M10GG1TokenBoundaryError('M10G_G1_SERIALIZED_REQUEST_TOKEN_LIMIT_EXCEEDED')
  }

  input.budget.reserve(
    input.candidate.callClass === 'CHAPTER_PROSE'
      ? 'prose'
      : input.candidate.callClass === 'CHOICE_GENERATION' ? 'choice' : 'semantic',
    {
      workflowPhase: input.workflowPhase,
      providerId: input.candidate.providerId,
      modelId: input.candidate.modelId,
      fallbackIndex: input.candidate.fallbackIndex,
    },
  )
  return input.transport(serializedRequest)
}
