import { z } from 'zod'
import { computeSha256, stableStringify } from '../scoring/canonical-serializer'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const NullablePositiveIntegerSchema = z.number().int().positive().nullable()

export const M10GG1TokenEnvelopeCallClassSchema = z.enum([
  'CHAPTER_PROSE',
  'CONTINUITY_JUDGE',
  'CHOICE_GENERATION',
  'LONG_HORIZON_SEMANTIC_JUDGE',
])

export const M10GG1TokenEnvelopePresenceSchema = z.enum(['OMITTED', 'NULL', 'VALUE'])

export const M10GG1TokenEnvelopeEvidenceSchema = z.object({
  evidenceKind: z.enum([
    'FROZEN_ROUTE',
    'EFFECTIVE_EXECUTOR_SOURCE',
    'TOKENIZER_AND_PROVIDER_FRAMING_PROOF',
  ]),
  sourceRef: z.string().min(1).max(500),
  sourceContentSha256: Sha256Schema,
  assertion: z.string().min(1).max(1_000),
}).strict()

export const M10GG1TokenEnvelopeInputAuthoritySchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('AUTHORITATIVE'),
    maximumInputTokens: z.number().int().positive(),
    tokenizerId: z.string().min(1).max(200),
    tokenizerVersion: z.string().min(1).max(200),
    providerBilledFramingAlgorithm: z.string().min(1).max(300),
    providerBilledFramingVersion: z.string().min(1).max(200),
    proofEvidence: z.array(M10GG1TokenEnvelopeEvidenceSchema).min(1),
  }).strict().superRefine((authority, context) => {
    if (!authority.proofEvidence.some((item) => (
      item.evidenceKind === 'TOKENIZER_AND_PROVIDER_FRAMING_PROOF'
    ))) {
      context.addIssue({
        code: 'custom',
        message: 'authoritative input requires tokenizer and provider billed-framing proof',
      })
    }
  }),
  z.object({
    state: z.literal('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY'),
    maximumInputTokens: z.null(),
    tokenizerId: z.null(),
    tokenizerVersion: z.null(),
    providerBilledFramingAlgorithm: z.null(),
    providerBilledFramingVersion: z.null(),
    proofEvidence: z.array(M10GG1TokenEnvelopeEvidenceSchema).max(20),
  }).strict(),
])

export const M10GG1TokenEnvelopeOutputAuthoritySchema = z.object({
  presenceState: M10GG1TokenEnvelopePresenceSchema,
  maximumOutputTokens: NullablePositiveIntegerSchema,
  evidence: z.array(M10GG1TokenEnvelopeEvidenceSchema).max(20),
}).strict().superRefine((output, context) => {
  if (output.presenceState === 'VALUE' && output.maximumOutputTokens === null) {
    context.addIssue({ code: 'custom', message: 'VALUE output authority requires maximumOutputTokens' })
  }
  if (output.presenceState !== 'VALUE' && output.maximumOutputTokens !== null) {
    context.addIssue({ code: 'custom', message: 'OMITTED/NULL output authority cannot carry maximumOutputTokens' })
  }
})

export const M10GG1ReasoningPolicySchema = z.object({
  presenceState: M10GG1TokenEnvelopePresenceSchema,
  value: z.string().min(1).max(200).nullable(),
  evidence: z.array(M10GG1TokenEnvelopeEvidenceSchema).max(20),
}).strict().superRefine((policy, context) => {
  if (policy.presenceState === 'VALUE' && policy.value === null) {
    context.addIssue({ code: 'custom', message: 'VALUE reasoning policy requires value' })
  }
  if (policy.presenceState !== 'VALUE' && policy.value !== null) {
    context.addIssue({ code: 'custom', message: 'OMITTED/NULL reasoning policy cannot carry value' })
  }
})

export const M10GG1ChoiceRouteBindingSchema = z.object({
  routeAuthorityState: z.enum(['BOUND', 'UNBOUND']),
  routeAuthorityHash: Sha256Schema.nullable(),
  routeMaximumOutputTokensPresenceState: M10GG1TokenEnvelopePresenceSchema,
  routeMaximumOutputTokens: NullablePositiveIntegerSchema,
}).strict().superRefine((binding, context) => {
  if ((binding.routeAuthorityState === 'BOUND') !== (binding.routeAuthorityHash !== null)) {
    context.addIssue({ code: 'custom', message: 'choice route authority state/hash mismatch' })
  }
  if (binding.routeMaximumOutputTokensPresenceState === 'VALUE'
    && binding.routeMaximumOutputTokens === null) {
    context.addIssue({ code: 'custom', message: 'choice route VALUE cap requires value' })
  }
  if (binding.routeMaximumOutputTokensPresenceState !== 'VALUE'
    && binding.routeMaximumOutputTokens !== null) {
    context.addIssue({ code: 'custom', message: 'choice route omitted/null cap cannot carry value' })
  }
})

export const M10GG1CandidateTokenEnvelopeSchema = z.object({
  candidateKey: z.string().regex(/^[A-Z0-9_]+:[a-z0-9./-]+:[0-9]+$/),
  callClass: M10GG1TokenEnvelopeCallClassSchema,
  providerId: z.string().min(1).max(80),
  modelId: z.string().min(1).max(300),
  fallbackIndex: z.number().int().min(0).max(32),
  envelopeAlgorithm: z.literal('EXACT_PROVIDER_TOKEN_AUTHORITY'),
  envelopeAlgorithmVersion: z.literal('1'),
  inputAuthority: M10GG1TokenEnvelopeInputAuthoritySchema,
  outputAuthority: M10GG1TokenEnvelopeOutputAuthoritySchema,
  reasoningPolicy: M10GG1ReasoningPolicySchema,
  maximumProviderRequestsPerBoundaryInvocation: z.number().int().positive(),
  maximumProviderCallsPerBoundaryInvocation: z.number().int().positive(),
  choiceRouteBinding: M10GG1ChoiceRouteBindingSchema.nullable(),
}).strict().superRefine((candidate, context) => {
  const expectedKey = `${candidate.callClass}:${candidate.modelId}:${candidate.fallbackIndex}`
  if (candidate.candidateKey !== expectedKey) {
    context.addIssue({ code: 'custom', message: 'candidate key does not bind class/model/index' })
  }
  if ((candidate.callClass === 'CHOICE_GENERATION') !== (candidate.choiceRouteBinding !== null)) {
    context.addIssue({ code: 'custom', message: 'choice route binding must exist only for choice candidates' })
  }
})

export const M10GG1TokenEnvelopeAuthorityPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  authorityKind: z.literal('M10G_G1_TOKEN_ENVELOPE_AUTHORITY_V1'),
  canonicalHashAlgorithm: z.literal('SHA-256'),
  canonicalSerializationVersion: z.literal('stable-stringify-v1'),
  provenancePolicy: z.literal('EXACT_MODEL_AND_CALL_CLASS'),
  candidates: z.array(M10GG1CandidateTokenEnvelopeSchema).min(1).max(100),
}).strict()

export const M10GG1TokenEnvelopeAuthoritySchema = M10GG1TokenEnvelopeAuthorityPayloadSchema.extend({
  authorityHash: Sha256Schema,
}).strict()

export type M10GG1TokenEnvelopeCallClass = z.infer<typeof M10GG1TokenEnvelopeCallClassSchema>
export type M10GG1CandidateTokenEnvelope = z.infer<typeof M10GG1CandidateTokenEnvelopeSchema>
export type M10GG1TokenEnvelopeAuthorityPayload = z.infer<typeof M10GG1TokenEnvelopeAuthorityPayloadSchema>
export type M10GG1TokenEnvelopeAuthority = z.infer<typeof M10GG1TokenEnvelopeAuthoritySchema>

export function computeM10GG1TokenEnvelopeAuthorityHash(
  payload: M10GG1TokenEnvelopeAuthorityPayload,
): string {
  return computeSha256(stableStringify(payload))
}

export function createM10GG1TokenEnvelopeAuthority(
  candidates: readonly M10GG1CandidateTokenEnvelope[],
): M10GG1TokenEnvelopeAuthority {
  const payload = M10GG1TokenEnvelopeAuthorityPayloadSchema.parse({
    schemaVersion: 1,
    authorityKind: 'M10G_G1_TOKEN_ENVELOPE_AUTHORITY_V1',
    canonicalHashAlgorithm: 'SHA-256',
    canonicalSerializationVersion: 'stable-stringify-v1',
    provenancePolicy: 'EXACT_MODEL_AND_CALL_CLASS',
    candidates,
  })
  return Object.freeze({
    ...payload,
    authorityHash: computeM10GG1TokenEnvelopeAuthorityHash(payload),
  })
}

export function validateM10GG1TokenEnvelopeAuthority(
  input: unknown,
): M10GG1TokenEnvelopeAuthority {
  const authority = M10GG1TokenEnvelopeAuthoritySchema.parse(input)
  const { authorityHash, ...payload } = authority
  if (computeM10GG1TokenEnvelopeAuthorityHash(payload) !== authorityHash) {
    throw new Error('M10G_G1_TOKEN_ENVELOPE_AUTHORITY_HASH_MISMATCH')
  }
  return Object.freeze(authority)
}
