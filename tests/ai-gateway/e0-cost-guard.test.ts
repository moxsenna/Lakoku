import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  E0CostGuard,
  E0CostGuardError,
  getE0CostGuard,
  isE0CostGuardError,
  recordProviderReportedCost,
  resetE0CostGuardForTests,
} from '@/lib/ai-gateway/e0-cost-guard'
import { E0_R1_CEILINGS } from '../../fixtures/m10-e/e0-budget-authority'

const PROVENANCE = { providerId: 'openrouter', modelId: 'test/model', workflowPhase: 'PROSE' } as const

describe('E0CostGuard ceilings bind the ratified R1 authority', () => {
  it('loads chapter and process ceilings from the frozen fixture without redefining them', () => {
    const guard = new E0CostGuard({
      maxCostPerChapterUsd: E0_R1_CEILINGS.maxExpectedCostPerChapter,
      maxProcessCostUsd: E0_R1_CEILINGS.p95CostGuardrail,
    })
    expect(E0_R1_CEILINGS.maxExpectedCostPerChapter).toBe('2.10000000')
    expect(E0_R1_CEILINGS.p95CostGuardrail).toBe('200.00000000')
    expect(guard.consumedProcessCostUsd).toBe('0.00000000')
  })
})

describe('E0CostGuard measured-cost accounting', () => {
  let guard: E0CostGuard
  beforeEach(() => {
    guard = new E0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '200.00000000' })
  })

  it('accumulates chapter and process totals from provider-reported costs', () => {
    expect(guard.tryBeginChapterScope('job-1#1')).toBe(true)
    guard.recordMeasuredCost('1.50000000', PROVENANCE)
    guard.recordMeasuredCost('0.5', PROVENANCE)
    expect(guard.consumedProcessCostUsd).toBe('2.00000000')
    guard.endChapterScope('job-1#1')
  })

  it('trips terminally when a chapter exceeds its ceiling and still counts the spend', () => {
    guard.tryBeginChapterScope('job-1#1')
    guard.recordMeasuredCost('2.05999999', PROVENANCE)
    expect(() => guard.recordMeasuredCost('0.05', PROVENANCE)).toThrowError(E0CostGuardError)
    try {
      guard.recordMeasuredCost('0.05', PROVENANCE)
      expect.unreachable('must throw')
    } catch (error) {
      expect(isE0CostGuardError(error)).toBe(true)
      expect((error as E0CostGuardError).code).toBe('E0_CHAPTER_COST_CEILING_EXCEEDED')
    }
    // The offending transport was already billed; the process total includes it.
    expect(guard.consumedProcessCostUsd).toBe('2.15999999')
  })

  it('trips at the process guardrail regardless of chapter scope', () => {
    const small = new E0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '1.00000000' })
    small.tryBeginChapterScope('job-1#1')
    expect(() => small.recordMeasuredCost('1.40', PROVENANCE)).toThrowError(E0CostGuardError)
    try {
      small.recordMeasuredCost('1.40', PROVENANCE)
      expect.unreachable('must throw')
    } catch (error) {
      expect((error as E0CostGuardError).code).toBe('E0_PROCESS_COST_CEILING_EXCEEDED')
    }
  })

  it('rejects malformed or non-numeric costs instead of guessing', () => {
    guard.tryBeginChapterScope('job-1#1')
    expect(() => guard.recordMeasuredCost('-1.00', PROVENANCE)).toThrowError(E0CostGuardError)
    expect(() => guard.recordMeasuredCost('abc', PROVENANCE)).toThrowError(E0CostGuardError)
    expect(() => guard.recordMeasuredCost('1e3', PROVENANCE)).toThrowError(E0CostGuardError)
  })

  it('requires provider/model provenance for every measured cost', () => {
    guard.tryBeginChapterScope('job-1#1')
    expect(() => guard.recordMeasuredCost('0.10', { providerId: '', modelId: 'm', workflowPhase: 'PROSE' })).toThrowError(E0CostGuardError)
    expect(() => guard.recordMeasuredCost('0.10', { providerId: 'p', modelId: '', workflowPhase: 'PROSE' })).toThrowError(E0CostGuardError)
  })

  it('rounds over-precise provider costs UP before comparing with the ceiling', () => {
    const tight = new E0CostGuard({ maxCostPerChapterUsd: '1.00000000', maxProcessCostUsd: '200.00000000' })
    tight.tryBeginChapterScope('job-1#1')
    // 0.999999995 rounds up to exactly the ceiling; one more micro-cent trips.
    tight.recordMeasuredCost('0.999999995', PROVENANCE)
    expect(() => tight.recordMeasuredCost('0.000000001', PROVENANCE)).toThrowError(E0CostGuardError)
  })

  it('zero-cost transports are free and never trip', () => {
    guard.tryBeginChapterScope('job-1#1')
    expect(() => guard.recordMeasuredCost('0', PROVENANCE)).not.toThrow()
    expect(guard.consumedProcessCostUsd).toBe('0.00000000')
  })

  it('counts unmeasured transports and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    guard.tryBeginChapterScope('job-1#1')
    guard.recordUnmeasuredTransport(PROVENANCE)
    guard.recordUnmeasuredTransport(PROVENANCE)
    expect(guard.unmeasuredCount).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe('E0_COST_UNMEASURED')
    warn.mockRestore()
  })

  it('refuses to close or double-open scopes mismatched with the attempt', () => {
    expect(guard.tryBeginChapterScope('job-1#1')).toBe(true)
    expect(guard.tryBeginChapterScope('job-2#1')).toBe(false)
    expect(() => guard.endChapterScope('other')).toThrowError(E0CostGuardError)
    guard.endChapterScope('job-1#1')
    expect(guard.hasOpenChapterScope()).toBe(false)
  })
})

describe('process singleton wiring', () => {
  afterEach(() => {
    resetE0CostGuardForTests()
    vi.restoreAllMocks()
  })

  it('binds from the commercial authority module with exact R1 ceilings', async () => {
    const { bindE0ProductionCostGuard } = await import('@/lib/commercial/e0-budget-authority.server')
    const bound = bindE0ProductionCostGuard()
    expect(getE0CostGuard()).toBe(bound)
    bound.tryBeginChapterScope('job-x#1')
    // Ceiling comes from E0_R1_CEILINGS.maxExpectedCostPerChapter = 2.10000000.
    expect(() => bound.recordMeasuredCost('2.10000001', PROVENANCE)).toThrowError(E0CostGuardError)
  })

  it('records nothing but warns once when never configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getE0CostGuard()).toBeNull()
    expect(() => recordProviderReportedCost('0.50', PROVENANCE)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe('E0_COST_GUARD_DISABLED')
  })
})
