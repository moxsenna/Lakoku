import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Subgate B reachability proof.
 *
 * The hardening rule is that an authority only counts as PASS when it actually
 * binds a reachable execution path. `executeM10GG1TokenGuardedCandidate` enforces
 * the correct order (attestation, serialization, token validation, reserve,
 * transport), but enforcing it in a module nobody calls binds nothing.
 *
 * These tests pin the current wiring so the gap cannot be silently closed by
 * assertion, and so that wiring it up later fails loudly here.
 */

const repoRoot = resolve(__dirname, '../..')

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

const PRODUCTION_TRANSPORT_SOURCES = [
  'lib/ai-gateway/gateway-provider.ts',
  'lib/ai-gateway/provider.ts',
  'lib/ai-gateway/generate.ts',
  'lib/runtime/personalized-generation.ts',
  'lib/narrative-qa/harness/m10-g-g1-live-executor.server.ts',
] as const

describe('Subgate B: token boundary is not on the live transport path', () => {
  it('is imported by no production module', () => {
    const importers = PRODUCTION_TRANSPORT_SOURCES.filter((path) => (
      read(path).includes('executeM10GG1TokenGuardedCandidate')
    ))

    // Recording the gap, not endorsing it: subgate B stays BLOCKED precisely
    // because the guarded boundary never runs on the reachable path.
    expect(importers).toEqual([])
  })

  it('reserves budget in the real candidate path with no pre-network token validation', () => {
    const source = read('lib/ai-gateway/gateway-provider.ts')

    expect(source).toContain('budget?.reserve(kind, {')
    expect(source).not.toContain('validateExactTokens')
    expect(source).not.toContain('maximumInputTokens')
  })

  it('requires a budget under m10gMode, which bounds call count but not tokens', async () => {
    const { createGlobalInferenceBudget } = await import(
      '@/lib/ai-gateway/global-inference-budget.contract'
    )
    const budget = createGlobalInferenceBudget({ runId: 'subgate-b-probe', hardLimit: 1 })

    budget.reserve('prose', { workflowPhase: 'SUBGATE_B_PROBE' })

    // A reservation is a count, not a token bound: an arbitrarily large request
    // consumes exactly one unit. Call-count budgets cannot substitute for the
    // token authority subgate B requires.
    expect(() => budget.reserve('prose', { workflowPhase: 'SUBGATE_B_PROBE' })).toThrow()
  })
})

describe('Subgate B: the guarded boundary itself refuses unbound authority', () => {
  it('blocks before reserving budget when input authority is unbound', async () => {
    const { executeM10GG1TokenGuardedCandidate } = await import(
      '@/lib/ai-gateway/m10-g-token-envelope-boundary'
    )
    const { createM10GG1FrozenTokenEnvelopeAuthority } = await import(
      '@/lib/narrative-qa/judges/m10-g-g1-token-envelope-authority'
    )

    const authority = createM10GG1FrozenTokenEnvelopeAuthority()
    const candidate = authority.candidates.find((item) => item.callClass === 'CHAPTER_PROSE')
    expect(candidate).toBeDefined()
    if (!candidate) return

    expect(candidate.inputAuthority.state).toBe('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')

    let reserved = 0
    let transported = 0

    await expect(executeM10GG1TokenGuardedCandidate({
      candidate,
      budget: {
        reserve: () => { reserved += 1 },
      } as never,
      workflowPhase: 'SUBGATE_B_PROBE',
      attestRoute: () => ({
        callClass: candidate.callClass,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        fallbackIndex: candidate.fallbackIndex,
        outputPresenceState: candidate.outputAuthority.presenceState,
        maximumOutputTokens: candidate.outputAuthority.maximumOutputTokens,
      }),
      serializeFullRequest: () => ({ bytes: new Uint8Array([1]), sha256: 'unused' }),
      validateExactTokens: () => 0,
      transport: () => { transported += 1 },
    })).rejects.toThrow('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')

    expect(reserved).toBe(0)
    expect(transported).toBe(0)
  })

  it('keeps the omitted long-horizon output cap blocked rather than defaulted', async () => {
    const { createM10GG1FrozenTokenEnvelopeAuthority } = await import(
      '@/lib/narrative-qa/judges/m10-g-g1-token-envelope-authority'
    )

    const authority = createM10GG1FrozenTokenEnvelopeAuthority()
    const longHorizon = authority.candidates.find((item) => (
      item.callClass === 'LONG_HORIZON_SEMANTIC_JUDGE'
    ))

    expect(longHorizon?.outputAuthority.presenceState).toBe('OMITTED')
    expect(longHorizon?.outputAuthority.maximumOutputTokens).toBeNull()
  })
})

describe('Subgate B: no tokenizer authority exists in the repository', () => {
  it('declares the tokenizer unimplemented and rejects every heuristic', async () => {
    const { evaluateM10GG1TokenBoundDecision } = await import(
      '@/lib/narrative-qa/judges/m10-g-g1-token-bound-decision'
    )

    const decision = evaluateM10GG1TokenBoundDecision()

    expect(decision.tokenizerImplemented).toBe(false)
    expect(decision.status).toBe('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')
    expect(decision.candidatesWithoutInputAuthority).toHaveLength(6)
  })
})
