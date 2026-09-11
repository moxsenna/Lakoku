import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createGlobalInferenceBudget } from '@/lib/ai-gateway/global-inference-budget.contract'
import { executeM10GG1TokenGuardedCandidate } from '@/lib/ai-gateway/m10-g-token-envelope-boundary'
import {
  M10GG1CandidateTokenEnvelopeSchema,
  computeM10GG1TokenEnvelopeAuthorityHash,
  validateM10GG1TokenEnvelopeAuthority,
} from '@/lib/narrative-qa/contracts/m10-g-g1-token-envelope.contract'
import { createM10GG1FrozenTokenEnvelopeAuthority } from '@/lib/narrative-qa/judges/m10-g-g1-token-envelope-authority'
import { evaluateM10GG1TokenEnvelopeAuthority } from '@/lib/narrative-qa/judges/m10-g-g1-token-envelope-evaluator'
import { computeSha256 } from '@/lib/narrative-qa/scoring/canonical-serializer'

const proofEvidence = {
  evidenceKind: 'TOKENIZER_AND_PROVIDER_FRAMING_PROOF' as const,
  sourceRef: 'tests/fixtures/exact-provider-framing-proof-v1',
  sourceContentSha256: computeSha256('exact-provider-framing-proof-v1'),
  assertion: 'Test tokenizer counts exact injected serialized request bytes including billed framing.',
}

function authoritativeCandidate(maximumInputTokens: number) {
  return M10GG1CandidateTokenEnvelopeSchema.parse({
    candidateKey: 'CHAPTER_PROSE:offline/exact-byte-tokenizer:0',
    callClass: 'CHAPTER_PROSE',
    providerId: 'offline',
    modelId: 'offline/exact-byte-tokenizer',
    fallbackIndex: 0,
    envelopeAlgorithm: 'EXACT_PROVIDER_TOKEN_AUTHORITY',
    envelopeAlgorithmVersion: '1',
    inputAuthority: {
      state: 'AUTHORITATIVE',
      maximumInputTokens,
      tokenizerId: 'offline/exact-byte-tokenizer',
      tokenizerVersion: '1',
      providerBilledFramingAlgorithm: 'identity-byte-tokenizer',
      providerBilledFramingVersion: '1',
      proofEvidence: [proofEvidence],
    },
    outputAuthority: {
      presenceState: 'VALUE',
      maximumOutputTokens: 4096,
      evidence: [proofEvidence],
    },
    reasoningPolicy: { presenceState: 'VALUE', value: 'none', evidence: [proofEvidence] },
    maximumProviderRequestsPerBoundaryInvocation: 1,
    maximumProviderCallsPerBoundaryInvocation: 1,
    choiceRouteBinding: null,
  })
}

function serialized(bytes: Uint8Array) {
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function routeAttestation(maximumOutputTokens = 4096) {
  return {
    callClass: 'CHAPTER_PROSE' as const,
    providerId: 'offline',
    modelId: 'offline/exact-byte-tokenizer',
    fallbackIndex: 0,
    outputPresenceState: 'VALUE' as const,
    maximumOutputTokens,
  }
}

describe('M10G_G1_TOKEN_ENVELOPE_AUTHORITY_V1', () => {
  it('binds strict authority hash and rejects tamper even when schema remains valid', () => {
    const authority = createM10GG1FrozenTokenEnvelopeAuthority()
    expect(validateM10GG1TokenEnvelopeAuthority(authority)).toEqual(authority)

    const tampered = structuredClone(authority)
    tampered.candidates[0]!.outputAuthority.maximumOutputTokens = 4095
    expect(() => validateM10GG1TokenEnvelopeAuthority(tampered))
      .toThrow('M10G_G1_TOKEN_ENVELOPE_AUTHORITY_HASH_MISMATCH')

    const { authorityHash: _authorityHash, ...payload } = tampered
    expect(computeM10GG1TokenEnvelopeAuthorityHash(payload)).not.toBe(authority.authorityHash)
  })

  it('preserves effective output behavior and never manufactures tokenizer proof', () => {
    const authority = createM10GG1FrozenTokenEnvelopeAuthority()
    const writer = authority.candidates.find((item) => item.callClass === 'CHAPTER_PROSE')!
    const continuity = authority.candidates.filter((item) => item.callClass === 'CONTINUITY_JUDGE')
    const choices = authority.candidates.filter((item) => item.callClass === 'CHOICE_GENERATION')
    const longHorizon = authority.candidates.find((item) => item.callClass === 'LONG_HORIZON_SEMANTIC_JUDGE')!

    expect(writer.outputAuthority).toMatchObject({ presenceState: 'VALUE', maximumOutputTokens: 4096 })
    expect(continuity).toHaveLength(2)
    expect(continuity.every((item) => item.outputAuthority.maximumOutputTokens === 512)).toBe(true)
    expect(choices.every((item) => (
      item.outputAuthority.presenceState === 'VALUE'
      && item.outputAuthority.maximumOutputTokens === 1024
      && item.reasoningPolicy.presenceState === 'OMITTED'
      && item.choiceRouteBinding?.routeAuthorityState === 'BOUND'
      && item.choiceRouteBinding.routeAuthorityHash
        === 'd1f96109596105f93b0c21accc8cbc52673f4a1e2eadc13a7c945700bd9e5a23'
    ))).toBe(true)
    expect(longHorizon.outputAuthority).toMatchObject({ presenceState: 'OMITTED', maximumOutputTokens: null })
    expect(authority.candidates.every((item) => (
      item.inputAuthority.state === 'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY'
      && item.inputAuthority.maximumInputTokens === null
      && item.inputAuthority.proofEvidence.length === 0
    ))).toBe(true)
  })

  it('reports every class/candidate and exact missing-authority blockers without false PASS', () => {
    const authority = createM10GG1FrozenTokenEnvelopeAuthority()
    expect(authority.candidates.map((candidate) => candidate.candidateKey).sort()).toEqual([
      'CHAPTER_PROSE:openai/gpt-5.6-sol:0',
      'CHOICE_GENERATION:deepseek/deepseek-v3.2:1',
      'CHOICE_GENERATION:openai/gpt-4.1-mini:0',
      'CONTINUITY_JUDGE:deepseek/deepseek-v3.1-terminus:1',
      'CONTINUITY_JUDGE:deepseek/deepseek-v3.2:0',
      'LONG_HORIZON_SEMANTIC_JUDGE:deepseek/deepseek-v3.2:0',
    ])
    expect(evaluateM10GG1TokenEnvelopeAuthority(authority)).toEqual({
      subgate: 'M10G_G1_TOKEN_ENVELOPE_AUTHORITY_V1',
      status: 'BLOCKED',
      blockerCodes: [
        'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND',
        'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY',
      ],
      candidateCount: 6,
      coveredClasses: [
        'CHAPTER_PROSE',
        'CHOICE_GENERATION',
        'CONTINUITY_JUDGE',
        'LONG_HORIZON_SEMANTIC_JUDGE',
      ],
    })
  })

  it('still blocks when a choice candidate carries a foreign or unbound route hash', () => {
    const foreign = createM10GG1FrozenTokenEnvelopeAuthority({
      choiceCandidates: [{
        providerId: 'openrouter', modelId: 'openai/gpt-4.1-mini', fallbackIndex: 0,
        routeAuthorityHash: 'a'.repeat(64), maximumOutputTokens: null,
        reasoningPolicyPresenceState: 'NULL', reasoningPolicy: null,
      }],
    })
    const choice = foreign.candidates.find((item) => item.callClass === 'CHOICE_GENERATION')!
    expect(choice.outputAuthority.presenceState).toBe('NULL')
    expect(choice.outputAuthority.evidence).toHaveLength(0)
    expect(evaluateM10GG1TokenEnvelopeAuthority(foreign).blockerCodes)
      .toContain('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
  })

  it('blocks an otherwise authoritative candidate when required evidence is missing', () => {
    const candidate = authoritativeCandidate(3)
    const authority = createM10GG1FrozenTokenEnvelopeAuthority({
      choiceCandidates: [{
        providerId: 'openrouter', modelId: 'openai/gpt-4.1-mini', fallbackIndex: 0,
        routeAuthorityHash: 'a'.repeat(64), maximumOutputTokens: 1024,
        reasoningPolicyPresenceState: 'NULL', reasoningPolicy: null,
      }],
    })
    const candidates = authority.candidates.map((item) => (
      item.callClass === 'CHAPTER_PROSE'
        ? { ...candidate, outputAuthority: { ...candidate.outputAuthority, evidence: [] } }
        : item
    ))
    const { authorityHash: _authorityHash, ...payload } = authority
    const rehashed = {
      ...payload,
      candidates,
      authorityHash: computeM10GG1TokenEnvelopeAuthorityHash({ ...payload, candidates }),
    }
    expect(evaluateM10GG1TokenEnvelopeAuthority(rehashed).blockerCodes)
      .toContain('BLOCKED_TOKEN_ENVELOPE_EVIDENCE_MISSING')
  })

  it('keeps omitted long-horizon output blocked instead of adding a cap', () => {
    const authority = createM10GG1FrozenTokenEnvelopeAuthority()
    const longHorizon = authority.candidates.find((item) => item.callClass === 'LONG_HORIZON_SEMANTIC_JUDGE')!
    expect(longHorizon.outputAuthority.presenceState).toBe('OMITTED')
    expect(longHorizon.outputAuthority.maximumOutputTokens).toBeNull()
    expect(evaluateM10GG1TokenEnvelopeAuthority(authority).blockerCodes)
      .toContain('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
  })

  it('executes exact boundary and preserves serialized bytes without truncation', async () => {
    const bytes = new TextEncoder().encode('abcde')
    const candidate = authoritativeCandidate(bytes.byteLength)
    const budget = createGlobalInferenceBudget({ runId: 'exact-pass', hardLimit: 1 })
    const transport = vi.fn((request: { bytes: Uint8Array }) => request.bytes)

    const result = await executeM10GG1TokenGuardedCandidate({
      candidate,
      budget,
      workflowPhase: 'TEST_EXACT_PASS',
      attestRoute: () => routeAttestation(),
      serializeFullRequest: () => serialized(bytes),
      validateExactTokens: ({ serializedRequest }) => serializedRequest.bytes.byteLength,
      transport,
    })

    expect(result).toBe(bytes)
    expect(transport).toHaveBeenCalledWith(serialized(bytes))
    expect(budget.consumed).toBe(1)
  })

  it('blocks boundary +1 before budget reserve and transport with no truncation', async () => {
    const bytes = new TextEncoder().encode('abcdef')
    const candidate = authoritativeCandidate(bytes.byteLength - 1)
    const budget = createGlobalInferenceBudget({ runId: 'exact-plus-one', hardLimit: 1 })
    const transport = vi.fn()

    await expect(executeM10GG1TokenGuardedCandidate({
      candidate,
      budget,
      workflowPhase: 'TEST_EXACT_PLUS_ONE',
      attestRoute: () => routeAttestation(),
      serializeFullRequest: () => serialized(bytes),
      validateExactTokens: ({ serializedRequest }) => serializedRequest.bytes.byteLength,
      transport,
    })).rejects.toThrow('M10G_G1_SERIALIZED_REQUEST_TOKEN_LIMIT_EXCEEDED')

    expect(bytes.byteLength).toBe(6)
    expect(budget.consumed).toBe(0)
    expect(transport).not.toHaveBeenCalled()
  })

  it('enforces attestation, serialization, validation, reserve, transport order', async () => {
    const order: string[] = []
    const candidate = authoritativeCandidate(3)
    const underlying = createGlobalInferenceBudget({ runId: 'ordered', hardLimit: 1 })
    const budget = {
      ...underlying,
      reserve: (...args: Parameters<typeof underlying.reserve>) => {
        order.push('reserve')
        underlying.reserve(...args)
      },
    }

    await executeM10GG1TokenGuardedCandidate({
      candidate,
      budget,
      workflowPhase: 'TEST_ORDER',
      attestRoute: () => { order.push('attest'); return routeAttestation() },
      serializeFullRequest: () => { order.push('serialize'); return serialized(new Uint8Array(3)) },
      validateExactTokens: () => { order.push('validate'); return 3 },
      transport: () => { order.push('transport'); return 'ok' },
    })
    expect(order).toEqual(['attest', 'serialize', 'validate', 'reserve', 'transport'])
  })

  it('route mismatch consumes zero budget and invokes no serializer, validator, or transport', async () => {
    const candidate = authoritativeCandidate(3)
    const budget = createGlobalInferenceBudget({ runId: 'route-mismatch', hardLimit: 1 })
    const serializeFullRequest = vi.fn()
    const validateExactTokens = vi.fn()
    const transport = vi.fn()

    await expect(executeM10GG1TokenGuardedCandidate({
      candidate,
      budget,
      workflowPhase: 'TEST_ROUTE_MISMATCH',
      attestRoute: () => routeAttestation(4095),
      serializeFullRequest,
      validateExactTokens,
      transport,
    })).rejects.toThrow('M10G_G1_ROUTE_ATTESTATION_MISMATCH')

    expect(budget.consumed).toBe(0)
    expect(serializeFullRequest).not.toHaveBeenCalled()
    expect(validateExactTokens).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('reserves once per validated retry or fallback boundary invocation', async () => {
    const primary = authoritativeCandidate(3)
    const fallback = M10GG1CandidateTokenEnvelopeSchema.parse({
      ...primary,
      candidateKey: 'CHAPTER_PROSE:offline/exact-byte-tokenizer-fallback:1',
      modelId: 'offline/exact-byte-tokenizer-fallback',
      fallbackIndex: 1,
    })
    const budget = createGlobalInferenceBudget({ runId: 'retry-fallback', hardLimit: 2 })
    const execute = (candidate: typeof primary) => executeM10GG1TokenGuardedCandidate({
      candidate,
      budget,
      workflowPhase: 'TEST_RETRY_FALLBACK',
      attestRoute: () => ({
        ...routeAttestation(), modelId: candidate.modelId, fallbackIndex: candidate.fallbackIndex,
      }),
      serializeFullRequest: () => serialized(new Uint8Array(3)),
      validateExactTokens: () => 3,
      transport: () => candidate.modelId,
    })

    await expect(execute(primary)).resolves.toBe(primary.modelId)
    await expect(execute(fallback)).resolves.toBe(fallback.modelId)
    expect(budget.consumed).toBe(2)
  })
})
