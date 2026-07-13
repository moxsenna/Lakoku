import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ENDING_BIAS_BOUND,
  MAX_EVIDENCE_ITEMS,
  RouteChoiceEffectSchema,
  RouteStateSchema,
  mergeChoiceEffect,
  normalizeRouteState,
  summarizeRouteStateForPrompt,
} from '@/lib/story-engine/route-state'

describe('RouteStateSchema', () => {
  it('applies safe defaults', () => {
    expect(RouteStateSchema.parse({})).toEqual({
      truth: 0,
      risk: 0,
      secrecy: 0,
      empathy: 0,
      trust: {},
      evidence: [],
      flags: {},
      endingBias: {},
    })
  })

  it('is strict and rejects invalid flag values', () => {
    expect(RouteStateSchema.safeParse({ providerTrace: true }).success).toBe(false)
    expect(RouteStateSchema.safeParse({ flags: { opened: 'yes' } }).success).toBe(false)
  })
})

describe('normalizeRouteState', () => {
  it('clamps scores, trust, and ending bias to documented bounds', () => {
    expect(normalizeRouteState({
      truth: 99,
      risk: -9,
      secrecy: 8,
      empathy: 20,
      trust: { Raka: 99, Sari: -99 },
      endingBias: { terang: 999, gelap: -999 },
    })).toMatchObject({
      truth: 20,
      risk: 0,
      secrecy: 8,
      empathy: 20,
      trust: { Raka: 10, Sari: -10 },
      endingBias: { terang: ENDING_BIAS_BOUND, gelap: -ENDING_BIAS_BOUND },
    })
  })

  it('trims, drops empty, deduplicates, preserves first evidence order, and caps count', () => {
    const evidence = [
      '  surat lama  ',
      '',
      'surat lama',
      '   ',
      ...Array.from({ length: MAX_EVIDENCE_ITEMS + 5 }, (_, index) => `bukti-${index}`),
    ]

    const normalized = normalizeRouteState({ evidence })

    expect(normalized.evidence).toHaveLength(MAX_EVIDENCE_ITEMS)
    expect(normalized.evidence.slice(0, 3)).toEqual(['surat lama', 'bukti-0', 'bukti-1'])
    expect(new Set(normalized.evidence).size).toBe(normalized.evidence.length)
  })

  it('drops invalid field values instead of coercing them', () => {
    expect(normalizeRouteState({
      truth: '12',
      risk: 1.5,
      trust: { valid: 4, invalid: '8' },
      flags: { kept: false, rejected: 'false', rejectedNumber: 1 },
      endingBias: { valid: 3, invalid: null },
      evidence: ['valid', 7, null],
    })).toEqual({
      truth: 0,
      risk: 0,
      secrecy: 0,
      empathy: 0,
      trust: { valid: 4 },
      evidence: ['valid'],
      flags: { kept: false },
      endingBias: { valid: 3 },
    })
  })

  it('keeps first value when record keys collide after trimming', () => {
    expect(normalizeRouteState({
      trust: { ' Raka ': 3, Raka: 8 },
      flags: { ' clue ': true, clue: false },
      endingBias: { ' truth ': 4, truth: 9 },
    })).toMatchObject({
      trust: { Raka: 3 },
      flags: { clue: true },
      endingBias: { truth: 4 },
    })
  })

  it.each([null, [], 'bad', 42, { trust: [] }])('falls back safely for malformed state %#', (input) => {
    expect(normalizeRouteState(input)).toEqual(RouteStateSchema.parse({}))
  })
})

describe('RouteChoiceEffectSchema', () => {
  it('defaults every effect field', () => {
    expect(RouteChoiceEffectSchema.parse({})).toEqual({
      routeDeltas: {},
      trustDeltas: {},
      flagsSet: {},
      evidenceAdded: [],
      endingBiasDeltas: {},
      threadTouches: [],
    })
  })

  it('rejects unknown route keys, invalid deltas, and duplicate normalized record keys', () => {
    expect(RouteChoiceEffectSchema.safeParse({ routeDeltas: { courage: 1 } }).success).toBe(false)
    expect(RouteChoiceEffectSchema.safeParse({ routeDeltas: { truth: 1.5 } }).success).toBe(false)
    expect(RouteChoiceEffectSchema.safeParse({ trustDeltas: { ' Raka ': 1, Raka: 2 } }).success).toBe(false)
    expect(RouteChoiceEffectSchema.safeParse({ flagsSet: { opened: 'yes' } }).success).toBe(false)
  })
})

describe('mergeChoiceEffect', () => {
  it('merges approved fields, clamps arithmetic, and does not persist thread touches', () => {
    const merged = mergeChoiceEffect(
      {
        truth: 18,
        risk: 1,
        trust: { Raka: 9 },
        evidence: ['surat'],
        flags: { metRaka: false },
        endingBias: { terang: 95 },
      },
      {
        routeDeltas: { truth: 5, risk: -5 },
        trustDeltas: { Raka: 5, Sari: -2 },
        flagsSet: { metRaka: true },
        evidenceAdded: [' surat ', 'kunci'],
        endingBiasDeltas: { terang: 20, rahasia: -4 },
        threadTouches: ['utang:kunci'],
      },
    )

    expect(merged).toEqual({
      truth: 20,
      risk: 0,
      secrecy: 0,
      empathy: 0,
      trust: { Raka: 10, Sari: -2 },
      evidence: ['surat', 'kunci'],
      flags: { metRaka: true },
      endingBias: { terang: ENDING_BIAS_BOUND, rahasia: -4 },
    })
    expect(merged).not.toHaveProperty('threadTouches')
  })

  it('does not mutate state or effect', () => {
    const state = {
      truth: 4,
      trust: { Raka: 1 },
      evidence: ['surat'],
      flags: { opened: false },
      endingBias: { terang: 2 },
    }
    const effect = {
      routeDeltas: { truth: 2 },
      trustDeltas: { Raka: 3 },
      flagsSet: { opened: true },
      evidenceAdded: ['kunci'],
      endingBiasDeltas: { terang: 4 },
      threadTouches: [],
    }
    const stateBefore = structuredClone(state)
    const effectBefore = structuredClone(effect)

    mergeChoiceEffect(state, effect)

    expect(state).toEqual(stateBefore)
    expect(effect).toEqual(effectBefore)
  })

  it('throws a Zod error for invalid effects', () => {
    expect(() => mergeChoiceEffect({}, { routeDeltas: { courage: 1 } })).toThrow(z.ZodError)
    expect(() => mergeChoiceEffect({}, { flagsSet: { opened: 'yes' } })).toThrow(z.ZodError)
  })
})

describe('summarizeRouteStateForPrompt', () => {
  it('is stable across record insertion order and bounds output', () => {
    const first = {
      truth: 4,
      trust: { Sari: -2, Raka: 3 },
      evidence: ['surat', 'kunci'],
      flags: { zeta: false, alpha: true },
      endingBias: { gelap: -3, terang: 5 },
    }
    const second = {
      truth: 4,
      trust: { Raka: 3, Sari: -2 },
      evidence: ['surat', 'kunci'],
      flags: { alpha: true, zeta: false },
      endingBias: { terang: 5, gelap: -3 },
    }

    const summary = summarizeRouteStateForPrompt(first)

    expect(summary).toBe(summarizeRouteStateForPrompt(second))
    expect(summary).toContain('truth=4')
    expect(summary.indexOf('Raka=3')).toBeLessThan(summary.indexOf('Sari=-2'))
    expect(summary.indexOf('alpha=true')).toBeLessThan(summary.indexOf('zeta=false'))
    expect(summary.indexOf('gelap=-3')).toBeLessThan(summary.indexOf('terang=5'))
    expect(summary.indexOf('surat')).toBeLessThan(summary.indexOf('kunci'))
    expect(summary.length).toBeLessThanOrEqual(4096)
  })
})
