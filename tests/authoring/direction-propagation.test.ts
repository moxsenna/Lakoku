/**
 * Bug 4 — creative direction stops after premise.
 *
 * proposeCast / proposeMystery / proposeWorld do not take direction today.
 * These tests lock the desired contract via creative-direction helpers.
 */
import { describe, expect, it } from 'vitest'
import {
  authoringStageAcceptsDirection,
  buildCreativeDirectionPromptBlock,
  type CreativeDirectionInput,
} from '@/lib/authoring/creative-direction'

const sampleDirection: CreativeDirectionInput = {
  hardBoundaries: ['Tanpa kekerasan eksplisit'],
  softAvoidances: ['Cinta segitiga'],
  storySetup: { trope: 'Rahasia keluarga' },
}

describe('Authoring direction propagation (Bug 4)', () => {
  it('DESIRED: cast stage accepts creative direction', () => {
    // CURRENT stub returns false → fails until stages wired.
    expect(authoringStageAcceptsDirection('cast')).toBe(true)
  })

  it('DESIRED: mystery stage accepts creative direction', () => {
    expect(authoringStageAcceptsDirection('mystery')).toBe(true)
  })

  it('DESIRED: world stage accepts creative direction', () => {
    expect(authoringStageAcceptsDirection('world')).toBe(true)
  })

  it('DESIRED: buildCreativeDirectionPromptBlock returns non-empty prompt text', () => {
    // CURRENT throws not implemented → fails until implemented.
    const block = buildCreativeDirectionPromptBlock(sampleDirection)
    expect(typeof block).toBe('string')
    expect(block.length).toBeGreaterThan(0)
    expect(block).toContain('Tanpa kekerasan eksplisit')
    expect(block).toContain('Rahasia keluarga')
  })

  it('DOCUMENTS CURRENT: stages report no direction support', () => {
    // Baseline of today's reality (inverse of DESIRED tests).
    // Remove once authoringStageAcceptsDirection returns true.
    expect(authoringStageAcceptsDirection('cast')).toBe(false)
    expect(authoringStageAcceptsDirection('mystery')).toBe(false)
    expect(authoringStageAcceptsDirection('world')).toBe(false)
  })
})
