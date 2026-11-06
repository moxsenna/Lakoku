import { describe, expect, it } from 'vitest'
import {
  calculatePullOffset,
  isPullThresholdMet,
  calculateRotationDegrees,
  PULL_THRESHOLD_PX,
  MAX_PULL_OFFSET_PX,
  REFRESH_TIMEOUT_MS,
} from '@/lib/ui/pull-to-refresh-state'

describe('Pull-to-Refresh State Helpers', () => {
  it('has expected constants', () => {
    expect(PULL_THRESHOLD_PX).toBe(60)
    expect(MAX_PULL_OFFSET_PX).toBe(80)
    expect(REFRESH_TIMEOUT_MS).toBe(2500)
  })

  it('calculates pull offset with 0.4 damping and clamps to MAX_PULL_OFFSET_PX', () => {
    expect(calculatePullOffset(-20)).toBe(0)
    expect(calculatePullOffset(0)).toBe(0)
    expect(calculatePullOffset(50)).toBe(20) // 50 * 0.4
    expect(calculatePullOffset(150)).toBe(60) // 150 * 0.4
    expect(calculatePullOffset(300)).toBe(MAX_PULL_OFFSET_PX) // Clamped at 80
  })

  it('detects when threshold is met', () => {
    expect(isPullThresholdMet(0)).toBe(false)
    expect(isPullThresholdMet(59)).toBe(false)
    expect(isPullThresholdMet(60)).toBe(true)
    expect(isPullThresholdMet(80)).toBe(true)
  })

  it('calculates rotation degrees proportionally', () => {
    expect(calculateRotationDegrees(0)).toBe(0)
    expect(calculateRotationDegrees(30)).toBe(90) // (30 / 60) * 180
    expect(calculateRotationDegrees(60)).toBe(180)
    expect(calculateRotationDegrees(80)).toBe(240) // Clamped or proportional
  })
})
