import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  assertM10GG1LiveAuthorityOpen,
  issueM10GG1ExecutionCapability,
} from '@/lib/runtime/m10-g-g1-execution-capability.server'
import { evaluateM10GG1RemainingAuthority } from '@/lib/narrative-qa/judges/m10-g-g1-remaining-authority'

/**
 * Invariant: while any of the A/B/C authority subgates is BLOCKED there must be
 * no network-capable executor construction, no GlobalInferenceBudget issued with
 * a hard limit, and no chapter invocation.
 *
 * This suite uses the REAL repository authority — no mocks — so it fails the
 * moment someone opens the gate without ratifying the underlying authority.
 */
describe('M10-G G-1 live authority fail-closed (unmocked)', () => {
  it('reports the real authority as blocked with a null hard limit', () => {
    const authority = evaluateM10GG1RemainingAuthority()

    expect(authority.status).toBe('BLOCKED')
    expect(authority.liveExecutionReady).toBe(false)
    expect(authority.economicsMayOpen).toBe(false)
    expect(authority.hardInferenceLimit).toBeNull()
    expect(authority.blockerCodes).toEqual([
      'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE',
      'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND',
      'BLOCKED_PRICING_AUTHORITY_MISSING',
      'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY',
    ])
  })

  it('refuses to issue a live execution capability', () => {
    expect(() => assertM10GG1LiveAuthorityOpen())
      .toThrow(/^M10G_G1_LIVE_AUTHORITY_BLOCKED:/)
    expect(() => issueM10GG1ExecutionCapability())
      .toThrow(/^M10G_G1_LIVE_AUTHORITY_BLOCKED:/)
  })

  it('names every blocking subgate in the thrown error', () => {
    let message = ''
    try {
      issueM10GG1ExecutionCapability()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE')
    expect(message).toContain('BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND')
    expect(message).toContain('BLOCKED_PRICING_AUTHORITY_MISSING')
    expect(message).toContain('BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY')
  })

  it('blocks the live runner before any capability or budget is consulted', async () => {
    const { runM10GG1ProofOrchestrationLive } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-runner.server'
    )

    // Deliberately passes an invalid capability: the authority gate must reject
    // first, proving the block is not merely capability forgery detection.
    await expect(runM10GG1ProofOrchestrationLive({
      manifest: {} as never,
      manifestHash: 'unused',
      authority: {} as never,
      capability: { executorId: 'forged' } as never,
      deps: {} as never,
    })).rejects.toThrow(/^M10G_G1_LIVE_AUTHORITY_BLOCKED:/)
  })

  it('never constructs a frozen provider, because policy authority is unbound', async () => {
    const { resolveM10GG1FrozenGenerationPolicy } = await import(
      '@/lib/narrative-qa/harness/m10-g-g1-frozen-provider.server'
    )

    expect(() => resolveM10GG1FrozenGenerationPolicy())
      .toThrow('M10G_G1_GENERATION_POLICY_AUTHORITY_UNBOUND')
  })
})
