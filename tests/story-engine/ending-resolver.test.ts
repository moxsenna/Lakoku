import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { resolveEnding } from '@/lib/story-engine/ending-resolver'
import type { StoryContract } from '@/lib/story-engine/story-contract'

const [firstEnding, secondEnding] = misteriDramaContract.endingCandidates

function resolve(
  overrides: Partial<Parameters<typeof resolveEnding>[0]> = {},
) {
  return resolveEnding({
    routeState: {},
    contract: misteriDramaContract,
    chapterNumber: 45,
    ...overrides,
  })
}

describe('resolveEnding', () => {
  it('rejects null lock resolution before chapter 45', () => {
    expect(() => resolve({ chapterNumber: 44, lockedEndingKey: null })).toThrow(
      'Ending cannot lock before chapter 45.',
    )
  })

  it('treats null as no existing lock at chapter 45', () => {
    expect(resolve({ lockedEndingKey: null }).key).toBe(firstEnding.key)
  })

  it('selects highest ending bias without parsing natural-language conditions', () => {
    expect(resolve({
      routeState: {
        truth: 20,
        risk: 20,
        secrecy: 20,
        empathy: 20,
        endingBias: {
          [firstEnding.key]: -2,
          [secondEnding.key]: 7,
        },
      },
    })).toEqual({
      key: secondEnding.key,
      name: secondEnding.name,
      requiredClosure: secondEnding.requiredClosure,
    })
  })

  it('breaks score ties by candidate array order', () => {
    expect(resolve({ routeState: {} }).key).toBe(firstEnding.key)
    expect(resolve({
      routeState: {
        endingBias: {
          [firstEnding.key]: 4,
          [secondEnding.key]: 4,
        },
      },
    }).key).toBe(firstEnding.key)
  })

  it('keeps valid locked ending regardless of later route state', () => {
    expect(resolve({
      chapterNumber: 50,
      lockedEndingKey: firstEnding.key,
      routeState: { endingBias: { [secondEnding.key]: 100 } },
    }).key).toBe(firstEnding.key)
  })

  it('rejects unknown locked key', () => {
    expect(() => resolve({ lockedEndingKey: 'unknown-ending' })).toThrow(
      'Unknown locked ending key: unknown-ending',
    )
  })

  it('rejects invalid route state, chapter, contract, and raw no-candidate input', () => {
    expect(() => resolve({ routeState: { endingBias: { [firstEnding.key]: 1.5 } } })).toThrow(z.ZodError)
    expect(() => resolve({ chapterNumber: 51 })).toThrow(z.ZodError)
    expect(() => resolve({
      contract: {
        ...structuredClone(misteriDramaContract),
        endingCandidates: [],
      } as unknown as StoryContract,
    })).toThrow(z.ZodError)
  })

  it('returns cloned closure arrays and does not mutate inputs', () => {
    const routeState = { endingBias: { [firstEnding.key]: 9 } }
    const contract = structuredClone(misteriDramaContract)
    const routeBefore = structuredClone(routeState)
    const contractBefore = structuredClone(contract)

    const resolved = resolve({ routeState, contract })
    resolved.requiredClosure.push('Mutation outside resolver.')

    expect(routeState).toEqual(routeBefore)
    expect(contract).toEqual(contractBefore)
    expect(contract.endingCandidates[0].requiredClosure).toEqual(
      firstEnding.requiredClosure,
    )
  })

  it('returns only public ending lock fields', () => {
    expect(Object.keys(resolve()).sort()).toEqual([
      'key',
      'name',
      'requiredClosure',
    ])
  })
})
