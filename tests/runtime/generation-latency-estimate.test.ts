import { describe, expect, it } from 'vitest'
import {
  computeP50Ms,
  estimateActiveWaitSeconds,
  estimateQueuedWaitSeconds,
  formatEstimatedWait,
  pushLatencySampleMs,
} from '@/lib/runtime/generation-latency-estimate'

describe('generation-latency-estimate', () => {
  it('computes nearest-rank p50', () => {
    expect(computeP50Ms([10_000, 20_000, 90_000])).toBe(20_000)
    expect(computeP50Ms([10_000])).toBeNull()
  })

  it('keeps rolling window of samples', () => {
    const samples: number[] = []
    for (let i = 0; i < 45; i++) pushLatencySampleMs(samples, 30_000 + i * 1000, 40)
    expect(samples.length).toBe(40)
    expect(samples[0]).toBe(35_000)
  })

  it('ignores absurd samples', () => {
    const samples: number[] = []
    pushLatencySampleMs(samples, 500)
    pushLatencySampleMs(samples, 40 * 60_000)
    expect(samples).toEqual([])
  })

  it('queued estimate uses remaining active work + waves', () => {
    // position 1, all 10 busy → ~avg remaining
    const a = estimateQueuedWaitSeconds({
      queuePosition1Based: 1,
      maxConcurrent: 10,
      activeCount: 10,
      activeRemainingSeconds: Array(10).fill(60),
      p50Seconds: 90,
    })
    expect(a).toBeGreaterThanOrEqual(20)
    expect(a).toBeLessThanOrEqual(90)

    // position 11 with 10 busy → roughly remaining + one full p50 wave
    const b = estimateQueuedWaitSeconds({
      queuePosition1Based: 11,
      maxConcurrent: 10,
      activeCount: 10,
      activeRemainingSeconds: Array(10).fill(60),
      p50Seconds: 90,
    })
    expect(b).toBeGreaterThan(a)
  })

  it('active estimate shrinks as elapsed grows', () => {
    const early = estimateActiveWaitSeconds({
      startedAtMs: 0,
      nowMs: 10_000,
      p50Seconds: 90,
    })
    const late = estimateActiveWaitSeconds({
      startedAtMs: 0,
      nowMs: 80_000,
      p50Seconds: 90,
    })
    expect(early).toBeGreaterThan(late)
  })

  it('formats soft Indonesian ranges', () => {
    expect(formatEstimatedWait(30)).toMatch(/kurang dari 1 menit/i)
    expect(formatEstimatedWait(70)).toMatch(/1 menit/i)
    expect(formatEstimatedWait(150)).toMatch(/menit/i)
  })
})
