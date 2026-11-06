import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  E0CostGuard,
  E0CostGuardError,
  getE0CostGuard,
  isE0CostGuardError,
  recordProviderReportedCost,
  resetE0CostGuardForTests,
  runWithinE0ChapterScope,
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

  it('accumulates chapter and process totals from provider-reported costs', async () => {
    await guard.runWithinChapterScope('c:story:1', async () => {
      guard.recordMeasuredCost('1.50000000', PROVENANCE)
      guard.recordMeasuredCost('0.5', PROVENANCE)
      expect(guard.consumedProcessCostUsd).toBe('2.00000000')
      expect(guard.getChapterConsumedUsd('c:story:1')).toBe('2.00000000')
    })
  })

  it('trips terminally when a chapter exceeds its ceiling and still counts the spend', async () => {
    await guard.runWithinChapterScope('c:story:1', async () => {
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
  })

  it('keeps chapter accumulation across retry attempts of the same chapter (audit M-A14)', async () => {
    // Attempt 1 membakar 1.80 lalu gagal; attempt 2 TIDAK boleh mulai dari nol.
    await guard.runWithinChapterScope('c:story:7', async () => {
      guard.recordMeasuredCost('1.80000000', PROVENANCE)
    })
    await expect(guard.runWithinChapterScope('c:story:7', async () => {
      guard.recordMeasuredCost('0.40000000', PROVENANCE)
    })).rejects.toMatchObject({ code: 'E0_CHAPTER_COST_CEILING_EXCEEDED' })
    expect(guard.getChapterConsumedUsd('c:story:7')).toBe('2.20000000')
    expect(guard.consumedProcessCostUsd).toBe('2.20000000')
  })

  it('isolates parallel chapters — one job never charges another (audit M-A1)', async () => {
    await Promise.all([
      guard.runWithinChapterScope('c:story:1', async () => {
        guard.recordMeasuredCost('1.00000000', PROVENANCE)
        // Beri kesempatan job paralel mencatat biayanya di tengah scope ini.
        await new Promise((resolve) => setTimeout(resolve, 10))
        // Kalau ada kontaminasi, total bab ini sudah 1.9 dan 0.5 di bawah melempar.
        guard.recordMeasuredCost('1.00000000', PROVENANCE)
      }),
      guard.runWithinChapterScope('c:story:2', async () => {
        guard.recordMeasuredCost('0.90000000', PROVENANCE)
        expect(guard.getChapterConsumedUsd('c:story:2')).toBe('0.90000000')
      }),
    ])
    expect(guard.getChapterConsumedUsd('c:story:1')).toBe('2.00000000')
    expect(guard.getChapterConsumedUsd('c:story:2')).toBe('0.90000000')
    expect(guard.consumedProcessCostUsd).toBe('2.90000000')
  })

  it('records process-only when no chapter scope is active', () => {
    guard.recordMeasuredCost('0.25000000', PROVENANCE)
    expect(guard.consumedProcessCostUsd).toBe('0.25000000')
    expect(guard.getChapterConsumedUsd('c:story:1')).toBe('0.00000000')
  })

  it('trips at the process guardrail regardless of chapter scope', async () => {
    const small = new E0CostGuard({ maxCostPerChapterUsd: '2.10000000', maxProcessCostUsd: '1.00000000' })
    await expect(small.runWithinChapterScope('c:story:1', async () => {
      small.recordMeasuredCost('1.40', PROVENANCE)
    })).rejects.toMatchObject({ code: 'E0_PROCESS_COST_CEILING_EXCEEDED' })
  })

  it('rejects malformed or non-numeric costs instead of guessing', async () => {
    await guard.runWithinChapterScope('c:story:1', async () => {
      expect(() => guard.recordMeasuredCost('-1.00', PROVENANCE)).toThrowError(E0CostGuardError)
      expect(() => guard.recordMeasuredCost('abc', PROVENANCE)).toThrowError(E0CostGuardError)
      expect(() => guard.recordMeasuredCost('1e3', PROVENANCE)).toThrowError(E0CostGuardError)
    })
  })

  it('requires provider/model provenance for every measured cost', async () => {
    await guard.runWithinChapterScope('c:story:1', async () => {
      expect(() => guard.recordMeasuredCost('0.10', { providerId: '', modelId: 'm', workflowPhase: 'PROSE' })).toThrowError(E0CostGuardError)
      expect(() => guard.recordMeasuredCost('0.10', { providerId: 'p', modelId: '', workflowPhase: 'PROSE' })).toThrowError(E0CostGuardError)
    })
  })

  it('rounds over-precise provider costs UP before comparing with the ceiling', async () => {
    const tight = new E0CostGuard({ maxCostPerChapterUsd: '1.00000000', maxProcessCostUsd: '200.00000000' })
    await tight.runWithinChapterScope('c:story:1', async () => {
      // 0.999999995 rounds up to exactly the ceiling; one more micro-cent trips.
      tight.recordMeasuredCost('0.999999995', PROVENANCE)
      expect(() => tight.recordMeasuredCost('0.000000001', PROVENANCE)).toThrowError(E0CostGuardError)
    })
  })

  it('zero-cost transports are free and never trip', async () => {
    await guard.runWithinChapterScope('c:story:1', async () => {
      expect(() => guard.recordMeasuredCost('0', PROVENANCE)).not.toThrow()
      expect(guard.consumedProcessCostUsd).toBe('0.00000000')
    })
  })

  it('counts unmeasured transports and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await guard.runWithinChapterScope('c:story:1', async () => {
      guard.recordUnmeasuredTransport(PROVENANCE)
      guard.recordUnmeasuredTransport(PROVENANCE)
    })
    expect(guard.unmeasuredCount).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe('E0_COST_UNMEASURED')
    warn.mockRestore()
  })

  it('prunes oldest chapter buckets beyond the tracking budget', async () => {
    for (let i = 0; i < 300; i += 1) {
      await guard.runWithinChapterScope(`c:story:${i}`, async () => {
        guard.recordMeasuredCost('0.01', PROVENANCE)
      })
    }
    // Bucket terlama (c:story:0..43) sudah di-evict; bucket terbaru masih ada.
    expect(guard.getChapterConsumedUsd('c:story:0')).toBe('0.00000000')
    expect(guard.getChapterConsumedUsd('c:story:299')).toBe('0.01000000')
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
    // Ceiling comes from E0_R1_CEILINGS.maxExpectedCostPerChapter = 2.10000000.
    await expect(bound.runWithinChapterScope('c:story:x:1', async () => {
      bound.recordMeasuredCost('2.10000001', PROVENANCE)
    })).rejects.toMatchObject({ code: 'E0_CHAPTER_COST_CEILING_EXCEEDED' })
  })

  it('runWithinE0ChapterScope is a passthrough when the guard is disabled', async () => {
    expect(getE0CostGuard()).toBeNull()
    await expect(runWithinE0ChapterScope('c:story:1', async () => 'ok')).resolves.toBe('ok')
  })

  it('records nothing but warns once when never configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getE0CostGuard()).toBeNull()
    expect(() => recordProviderReportedCost('0.50', PROVENANCE)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toBe('E0_COST_GUARD_DISABLED')
  })
})
