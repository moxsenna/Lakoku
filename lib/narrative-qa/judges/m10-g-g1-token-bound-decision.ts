import { M10_G_G1_ROUTE_AUTHORITY } from '../../../fixtures/m10-g/g1-route-authority'
import { createM10GG1FrozenTokenEnvelopeAuthority } from './m10-g-g1-token-envelope-authority'
import {
  evaluateM10GG1TokenEnvelopeAuthority,
  type M10GG1TokenEnvelopeBlocker,
} from './m10-g-g1-token-envelope-evaluator'

/**
 * Subgate B decision: G1_TOKEN_BOUND_AUTHORITY_DECISION_V1.
 *
 * Answers one question only: does existing evidence prove that billed input
 * tokens cannot exceed a deterministic pre-network bound for every reachable
 * model and call class? No tokenizer is implemented, no chars/4 or historical
 * usage heuristic is accepted, and no output cap is invented to fit economics.
 */

export const M10G_G1_TOKEN_BOUND_DECISION_ID =
  'G1_TOKEN_BOUND_AUTHORITY_DECISION_V1' as const

export type M10GG1TokenBoundStatus =
  | 'TOKEN_BOUND_AUTHORITY_RATIFIABLE'
  | 'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY'

export type M10GG1TokenBoundDecision = Readonly<{
  decisionId: typeof M10G_G1_TOKEN_BOUND_DECISION_ID
  status: M10GG1TokenBoundStatus
  outputAuthorityStatus: 'OUTPUT_TOKEN_AUTHORITY_BOUND' | 'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND'
  inferencePerformed: false
  tokenizerImplemented: false
  envelopeAuthorityHash: string
  routeAuthorityHash: string
  blockerCodes: readonly M10GG1TokenEnvelopeBlocker[]
  choiceRouteBindingResolved: boolean
  candidatesWithoutInputAuthority: readonly string[]
  candidatesWithoutOutputCap: readonly string[]
  rejectedHeuristics: readonly string[]
  requiredAdditionalAuthority: readonly string[]
  reason: string
}>

const REJECTED_HEURISTICS: readonly string[] = Object.freeze([
  'characters divided by four',
  'historical or average observed usage',
  'post-call usage reporting',
  'unproven UTF-8 byte ceiling without tokenizer and provider billed-framing proof',
])

const REQUIRED_ADDITIONAL_AUTHORITY: readonly string[] = Object.freeze([
  'Official tokenizer identity and version for openai/gpt-5.6-sol, openai/gpt-4.1-mini, deepseek/deepseek-v3.2, and deepseek/deepseek-v3.1-terminus, with a rule proving billed input tokens cannot exceed the counted serialized request.',
  'Provider billed-framing algorithm and version covering SDK/adaptor serialization, structured-output JSON schema framing, and any provider-added wrapper tokens.',
  'A deterministic completion maximum for the long-horizon semantic call class, which currently omits maxOutputTokens; the omission must be resolved by authority, never by adding a cap to make economics fit.',
])

export function evaluateM10GG1TokenBoundDecision(): M10GG1TokenBoundDecision {
  const authority = createM10GG1FrozenTokenEnvelopeAuthority()
  const verdict = evaluateM10GG1TokenEnvelopeAuthority(authority)

  const candidatesWithoutInputAuthority = Object.freeze(authority.candidates
    .filter((item) => item.inputAuthority.state !== 'AUTHORITATIVE')
    .map((item) => item.candidateKey)
    .sort())
  const candidatesWithoutOutputCap = Object.freeze(authority.candidates
    .filter((item) => item.outputAuthority.presenceState !== 'VALUE')
    .map((item) => item.candidateKey)
    .sort())
  const choiceRouteBindingResolved = authority.candidates
    .filter((item) => item.callClass === 'CHOICE_GENERATION')
    .every((item) => (
      item.choiceRouteBinding?.routeAuthorityState === 'BOUND'
      && item.choiceRouteBinding.routeAuthorityHash === M10_G_G1_ROUTE_AUTHORITY.authorityHash
    ))

  const status: M10GG1TokenBoundStatus = candidatesWithoutInputAuthority.length === 0
    ? 'TOKEN_BOUND_AUTHORITY_RATIFIABLE'
    : 'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY'

  return Object.freeze({
    decisionId: M10G_G1_TOKEN_BOUND_DECISION_ID,
    status,
    outputAuthorityStatus: candidatesWithoutOutputCap.length === 0
      ? 'OUTPUT_TOKEN_AUTHORITY_BOUND'
      : 'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND',
    inferencePerformed: false as const,
    tokenizerImplemented: false as const,
    envelopeAuthorityHash: authority.authorityHash,
    routeAuthorityHash: M10_G_G1_ROUTE_AUTHORITY.authorityHash,
    blockerCodes: verdict.blockerCodes,
    choiceRouteBindingResolved,
    candidatesWithoutInputAuthority,
    candidatesWithoutOutputCap,
    rejectedHeuristics: REJECTED_HEURISTICS,
    requiredAdditionalAuthority: REQUIRED_ADDITIONAL_AUTHORITY,
    reason: 'No tokenizer identity or provider billed-framing authority exists for any reachable model, so no deterministic pre-network input bound can be ratified. The long-horizon semantic call class additionally omits any output cap. Choice route binding is resolved from the ratified route authority and is no longer a blocker.',
  })
}
