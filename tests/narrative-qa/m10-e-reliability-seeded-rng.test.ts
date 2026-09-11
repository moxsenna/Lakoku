import { describe, expect, it } from 'vitest'
import { computeSha256 } from '../../lib/narrative-qa/scoring/canonical-serializer'
import {
  ALL_ZERO_STATE_REPLACEMENT,
  SEED_TO_STATE_VERSION,
  createXoshiro128StarStar,
  seedXoshiro128StarStar,
} from '../../lib/narrative-qa/reliability/seeded-rng'

describe('seeded xoshiro128** v1', () => {
  it('derives the golden state from the SHA-256 digest of the seed', () => {
    const state = seedXoshiro128StarStar('m10-e-golden')
    expect(state.algorithmId).toBe('xoshiro128**')
    expect(state.algorithmVersion).toBe(1)
    expect(state.seed).toBe('m10-e-golden')
    expect(state.state0).toBe(782107391)
    expect(state.state1).toBe(2910369884)
    expect(state.state2).toBe(3054451443)
    expect(state.state3).toBe(3436594004)
  })

  it('assembles the four state words big-endian from digest bytes 0..15', () => {
    const digest = computeSha256('m10-e-golden')
    const state = seedXoshiro128StarStar('m10-e-golden')
    expect(state.state0).toBe(parseInt(digest.slice(0, 8), 16))
    expect(state.state1).toBe(parseInt(digest.slice(8, 16), 16))
    expect(state.state2).toBe(parseInt(digest.slice(16, 24), 16))
    expect(state.state3).toBe(parseInt(digest.slice(24, 32), 16))
  })

  it('emits the golden first five words and evolves to the golden post-draw state', () => {
    const run = createXoshiro128StarStar(seedXoshiro128StarStar('m10-e-golden'))
    const words = [run.nextWord(), run.nextWord(), run.nextWord(), run.nextWord(), run.nextWord()]
    expect(words).toEqual([473175993, 96929846, 2180090160, 3864984501, 1876390615])
    const after = run.replicateState()
    expect([after.state0, after.state1, after.state2, after.state3]).toEqual([936312419, 1351289337, 1936652610, 3234530020])
  })

  it('emits a second frozen golden vector for an Indonesian seed', () => {
    const state = seedXoshiro128StarStar('kalimat-satu')
    expect([state.state0, state.state1, state.state2, state.state3]).toEqual([32015871, 885808603, 1934193591, 3797086248])
    const run = createXoshiro128StarStar(state)
    const words = [run.nextWord(), run.nextWord(), run.nextWord(), run.nextWord(), run.nextWord()]
    expect(words).toEqual([4131372955, 2744413488, 2813749067, 1740124135, 4119510239])
    const after = run.replicateState()
    expect([after.state0, after.state1, after.state2, after.state3]).toEqual([560327631, -737155023, 390594690, 790246536])
  })

  it('rejects an empty seed', () => {
    expect(() => seedXoshiro128StarStar('')).toThrow()
  })

  it('is deterministic across independent runs', () => {
    const left = createXoshiro128StarStar(seedXoshiro128StarStar('dua-kalimat'))
    const right = createXoshiro128StarStar(seedXoshiro128StarStar('dua-kalimat'))
    for (let index = 0; index < 8; index += 1) {
      expect(left.nextWord()).toBe(right.nextWord())
      const leftState = left.replicateState()
      const rightState = right.replicateState()
      expect([leftState.state0, leftState.state1, leftState.state2, leftState.state3])
        .toEqual([rightState.state0, rightState.state1, rightState.state2, rightState.state3])
    }
  })

  it('diverges when the seed changes', () => {
    const left = createXoshiro128StarStar(seedXoshiro128StarStar('m10-e-golden'))
    const right = createXoshiro128StarStar(seedXoshiro128StarStar('m10-e-golden-x'))
    expect(left.nextWord()).not.toBe(right.nextWord())
  })

  it('resumes a replicated mid-stream state byte-identically', () => {
    const original = createXoshiro128StarStar(seedXoshiro128StarStar('tiga-kalimat'))
    original.nextWord()
    original.nextWord()
    original.nextWord()
    const replicated = createXoshiro128StarStar(original.replicateState())
    for (let index = 0; index < 6; index += 1) {
      expect(replicated.nextWord()).toBe(original.nextWord())
    }
  })

  it('keeps every emitted word inside the uint32 range', () => {
    const run = createXoshiro128StarStar(seedXoshiro128StarStar('empat-kalimat'))
    for (let index = 0; index < 64; index += 1) {
      const word = run.nextWord()
      expect(word).toBeGreaterThanOrEqual(0)
      expect(word).toBeLessThan(4294967296)
    }
  })

  it('never seeds an all-zero state and pins the replacement constant', () => {
    expect(ALL_ZERO_STATE_REPLACEMENT).toEqual([0x6d2b79f5, 0, 0, 0])
    for (const seed of ['a', 'm10-e-golden', 'kalimat-satu', 'seed-nol', 'x'.repeat(200)]) {
      const state = seedXoshiro128StarStar(seed)
      expect([state.state0, state.state1, state.state2, state.state3]).not.toEqual([0, 0, 0, 0])
    }
  })

  it('exposes the frozen seed-to-state version identifier', () => {
    expect(SEED_TO_STATE_VERSION).toBe('SHA256_BYTES_0_15_FOUR_UINT32_BIG_ENDIAN_V1')
  })
})