import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Capability *mechanics* are independent of authority state. This suite forces
// the authority gate open so forgery/registry behaviour stays observable; the
// real gate is exercised unmocked in m10-g-g1-live-authority-failclosed.test.ts.
//
// The stub must be created via vi.hoisted: vi.mock factories are hoisted above
// module scope, so referencing a plain top-level variable throws
// "There was an error when mocking a module".
const authority = vi.hoisted(() => ({
  current: {
    liveExecutionReady: true,
    economicsMayOpen: true,
    hardInferenceLimit: 1 as number | null,
    blockerCodes: [] as readonly string[],
  },
}))

vi.mock('@/lib/narrative-qa/judges/m10-g-g1-remaining-authority', () => ({
  evaluateM10GG1RemainingAuthority: () => authority.current,
}))

import {
  assertM10GG1ExecutionCapability,
  assertM10GG1LiveAuthorityOpen,
  issueM10GG1ExecutionCapability,
} from '@/lib/runtime/m10-g-g1-execution-capability.server'

const EXECUTOR_ID = 'generateNextPersonalizedChapter:m10g-g1:v1'

const OPEN_AUTHORITY = Object.freeze({
  liveExecutionReady: true,
  economicsMayOpen: true,
  hardInferenceLimit: 1 as number | null,
  blockerCodes: [] as readonly string[],
})

beforeEach(() => {
  authority.current = { ...OPEN_AUTHORITY }
})

describe('M10-G G-1 live authority gate', () => {
  it('refuses to issue a capability while any A/B/C subgate is blocked', () => {
    authority.current = {
      liveExecutionReady: false,
      economicsMayOpen: false,
      hardInferenceLimit: null,
      blockerCodes: [
        'BLOCKED_GENERATION_POLICY_AUTHORITY_SOURCE',
        'BLOCKED_OUTPUT_TOKEN_AUTHORITY_UNBOUND',
        'BLOCKED_PRICING_AUTHORITY_MISSING',
        'BLOCKED_TOKENIZER_OR_TOKEN_BOUND_AUTHORITY',
      ],
    }

    expect(() => assertM10GG1LiveAuthorityOpen())
      .toThrow(/^M10G_G1_LIVE_AUTHORITY_BLOCKED:/)
    expect(() => issueM10GG1ExecutionCapability())
      .toThrow('BLOCKED_PRICING_AUTHORITY_MISSING')
  })

  it.each([
    ['liveExecutionReady false', { liveExecutionReady: false }],
    ['economicsMayOpen false', { economicsMayOpen: false }],
    ['hardInferenceLimit null', { hardInferenceLimit: null }],
    ['any blocker code present', { blockerCodes: ['BLOCKED_PRICING_AUTHORITY_MISSING'] }],
  ])('fails closed on %s even when every other field is open', (_label, override) => {
    authority.current = { ...OPEN_AUTHORITY, ...override }
    expect(() => issueM10GG1ExecutionCapability())
      .toThrow(/^M10G_G1_LIVE_AUTHORITY_BLOCKED:/)
  })

  it('permits issuance only when every field is open', () => {
    expect(() => issueM10GG1ExecutionCapability()).not.toThrow()
  })
})

describe('M10-G G-1 execution capability', () => {
  it('accepts only runtime-issued capabilities', () => {
    const capability = issueM10GG1ExecutionCapability()

    expect(capability.executorId).toBe(EXECUTOR_ID)
    expect(() => assertM10GG1ExecutionCapability(capability)).not.toThrow()
    expect(Object.isFrozen(capability)).toBe(true)
    expect(JSON.parse(JSON.stringify(capability))).toEqual({ executorId: EXECUTOR_ID })
  })

  it('rejects missing, non-object, and shape-forged capabilities', () => {
    expect(() => assertM10GG1ExecutionCapability(undefined))
      .toThrow('M10G_G1_EXECUTION_CAPABILITY_REQUIRED')
    expect(() => assertM10GG1ExecutionCapability(null))
      .toThrow('M10G_G1_EXECUTION_CAPABILITY_REQUIRED')
    expect(() => assertM10GG1ExecutionCapability(EXECUTOR_ID))
      .toThrow('M10G_G1_EXECUTION_CAPABILITY_REQUIRED')

    // Structural clone carries the public field but no registry record.
    expect(() => assertM10GG1ExecutionCapability({ executorId: EXECUTOR_ID }))
      .toThrow('M10G_G1_EXECUTION_CAPABILITY_INVALID')
    expect(() => assertM10GG1ExecutionCapability({ ...issueM10GG1ExecutionCapability() }))
      .toThrow('M10G_G1_EXECUTION_CAPABILITY_INVALID')
  })

  it('rejects a forged brand symbol copied from a real capability', () => {
    const brandKey = Symbol.for('lakoku.runtime.m10g-g1-execution-capability.brand.v1')
    const real = issueM10GG1ExecutionCapability()
    const stolenNonce = (real as unknown as Record<PropertyKey, unknown>)[brandKey]

    const forged = Object.freeze(Object.defineProperty({ executorId: EXECUTOR_ID }, brandKey, {
      value: stolenNonce,
      enumerable: false,
    }))

    expect(() => assertM10GG1ExecutionCapability(forged))
      .toThrow('M10G_G1_EXECUTION_CAPABILITY_INVALID')
  })

  it('survives duplicate module loading via slash/backslash specifier drift', async () => {
    vi.resetModules()
    const slash = await import('@/lib/runtime/m10-g-g1-execution-capability.server')
    vi.resetModules()
    const backslash = await import(
      '../../lib/runtime/m10-g-g1-execution-capability.server'
    )

    // Cross-module authority must hold: a capability issued by one module
    // instance verifies in the other, because the registry is global-symbol
    // owned rather than module-local.
    const issuedBySlash = slash.issueM10GG1ExecutionCapability()
    expect(() => backslash.assertM10GG1ExecutionCapability(issuedBySlash)).not.toThrow()

    const issuedByBackslash = backslash.issueM10GG1ExecutionCapability()
    expect(() => slash.assertM10GG1ExecutionCapability(issuedByBackslash)).not.toThrow()
  })
})
