import { computeSha256 } from '../scoring/canonical-serializer'

export const SEED_TO_STATE_VERSION = 'SHA256_BYTES_0_15_FOUR_UINT32_BIG_ENDIAN_V1' as const
export const ALL_ZERO_STATE_REPLACEMENT = [0x6d2b79f5, 0, 0, 0] as const

const UINT32_MODULUS = 4294967296

export interface Xoshiro128StarStarState {
  readonly algorithmId: 'xoshiro128**'
  readonly algorithmVersion: 1
  readonly seed: string
  readonly state0: number
  readonly state1: number
  readonly state2: number
  readonly state3: number
}

export function seedXoshiro128StarStar(seed: string): Xoshiro128StarStarState {
  if (seed.length === 0) throw new Error('Seed must be a non-empty exact UTF-8 string')
  const digest = computeSha256(seed)
  const words = [] as number[]
  for (let offset = 0; offset < 32; offset += 8) {
    words.push(parseInt(digest.slice(offset, offset + 8), 16))
  }
  const [state0, state1, state2, state3] = words
  if (state0 === 0 && state1 === 0 && state2 === 0 && state3 === 0) {
    return deepFreeze({
      algorithmId: 'xoshiro128**',
      algorithmVersion: 1,
      seed,
      state0: ALL_ZERO_STATE_REPLACEMENT[0],
      state1: ALL_ZERO_STATE_REPLACEMENT[1],
      state2: ALL_ZERO_STATE_REPLACEMENT[2],
      state3: ALL_ZERO_STATE_REPLACEMENT[3],
    })
  }
  return deepFreeze({ algorithmId: 'xoshiro128**', algorithmVersion: 1, seed, state0, state1, state2, state3 })
}

export type Xoshiro128StarStarRun = {
  readonly nextWord: () => number
  readonly replicateState: () => Xoshiro128StarStarState
}

export function createXoshiro128StarStar(state: Xoshiro128StarStarState): Xoshiro128StarStarRun {
  let s0 = state.state0
  let s1 = state.state1
  let s2 = state.state2
  let s3 = state.state3
  return {
    nextWord(): number {
      // Version-1 next-word: u = rotl((s1 * 5) mod 2^32, 7) * 9 mod 2^32
      const u = (rotl32(Math.imul(s1, 5), 7) * 9) % UINT32_MODULUS
      const t = (s1 << 9) >>> 0
      s2 ^= s0
      s3 ^= s1
      s1 ^= s2
      s0 ^= s3
      s2 ^= t
      s3 = rotl32(s3, 11)
      return u
    },
    replicateState(): Xoshiro128StarStarState {
      return deepFreeze({ algorithmId: state.algorithmId, algorithmVersion: state.algorithmVersion, seed: state.seed, state0: s0, state1: s1, state2: s2, state3: s3 })
    },
  }
}

function rotl32(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}