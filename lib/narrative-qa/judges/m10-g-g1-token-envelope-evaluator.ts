import type { M10GG1TokenEnvelopeAuthority } from '../contracts/m10-g-g1-token-envelope.contract'
import { validateM10GG1TokenEnvelopeAuthority } from '../contracts/m10-g-g1-token-envelope.contract'
import { M10G_G1_TOKEN_ENVELOPE_REQUIRED_CLASSES } from './m10-g-g1-token-envelope-authority'

export type M10GG1TokenEnvelopeBlocker =
  | 'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY'
  | 'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND'
  | 'BLOCKED_CHOICE_ROUTE_AUTHORITY_UNBOUND'
  | 'BLOCKED_CANDIDATE_AUTHORITY_COVERAGE'
  | 'BLOCKED_TOKEN_ENVELOPE_EVIDENCE_MISSING'

export type M10GG1TokenEnvelopeVerdict = Readonly<{
  subgate: 'M10G_G1_TOKEN_ENVELOPE_AUTHORITY_V1'
  status: 'PASS' | 'BLOCKED'
  blockerCodes: readonly M10GG1TokenEnvelopeBlocker[]
  candidateCount: number
  coveredClasses: readonly string[]
}>

export function evaluateM10GG1TokenEnvelopeAuthority(
  input: M10GG1TokenEnvelopeAuthority,
): M10GG1TokenEnvelopeVerdict {
  const authority = validateM10GG1TokenEnvelopeAuthority(input)
  const blockers = new Set<M10GG1TokenEnvelopeBlocker>()
  const coveredClasses = new Set(authority.candidates.map((candidate) => candidate.callClass))

  for (const requiredClass of M10G_G1_TOKEN_ENVELOPE_REQUIRED_CLASSES) {
    if (!coveredClasses.has(requiredClass)) blockers.add('BLOCKED_CANDIDATE_AUTHORITY_COVERAGE')
  }

  for (const candidate of authority.candidates) {
    if (candidate.inputAuthority.state !== 'AUTHORITATIVE') {
      blockers.add('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')
    } else if (candidate.inputAuthority.proofEvidence.length === 0) {
      blockers.add('BLOCKED_TOKEN_ENVELOPE_EVIDENCE_MISSING')
    }
    if (candidate.outputAuthority.presenceState !== 'VALUE') {
      blockers.add('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
    } else if (candidate.outputAuthority.evidence.length === 0) {
      blockers.add('BLOCKED_TOKEN_ENVELOPE_EVIDENCE_MISSING')
    }
    if (candidate.reasoningPolicy.presenceState === 'VALUE'
      && candidate.reasoningPolicy.evidence.length === 0) {
      blockers.add('BLOCKED_TOKEN_ENVELOPE_EVIDENCE_MISSING')
    }
    if (candidate.callClass === 'CHOICE_GENERATION'
      && candidate.choiceRouteBinding?.routeAuthorityState !== 'BOUND') {
      blockers.add('BLOCKED_CHOICE_ROUTE_AUTHORITY_UNBOUND')
    }
  }

  const blockerCodes = [...blockers].sort()
  return Object.freeze({
    subgate: 'M10G_G1_TOKEN_ENVELOPE_AUTHORITY_V1',
    status: blockerCodes.length === 0 ? 'PASS' : 'BLOCKED',
    blockerCodes: Object.freeze(blockerCodes),
    candidateCount: authority.candidates.length,
    coveredClasses: Object.freeze([...coveredClasses].sort()),
  })
}
