import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import { nadiaRakaContract } from '@/fixtures/contracts/nadia-raka'
import { resolveEnding, resolveEndingFromCandidates } from '@/lib/story-engine/ending-resolver'
import type { StoryContract } from '@/lib/story-engine/story-contract'

const [firstEnding, secondEnding] = misteriDramaContract.endingCandidates

function resolve(
  overrides: Partial<Parameters<typeof resolveEnding>[0]> = {},
) {
  return resolveEnding({
    routeState: {},
    storyContract: misteriDramaContract,
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
      storyContract: {
        ...structuredClone(misteriDramaContract),
        endingCandidates: [],
      } as unknown as StoryContract,
    })).toThrow(z.ZodError)
  })

  it('returns cloned closure arrays and does not mutate inputs', () => {
    const routeState = { endingBias: { [firstEnding.key]: 9 } }
    const storyContract = structuredClone(misteriDramaContract)
    const routeBefore = structuredClone(routeState)
    const contractBefore = structuredClone(storyContract)

    const resolved = resolve({ routeState, storyContract })
    resolved.requiredClosure.push('Mutation outside resolver.')

    expect(routeState).toEqual(routeBefore)
    expect(storyContract).toEqual(contractBefore)
    expect(storyContract.endingCandidates[0].requiredClosure).toEqual(
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

describe('resolveEndingFromCandidates & resolveEnding contract regression', () => {
  it('resolveEnding output is unchanged on existing nadiaRakaContract fixture', () => {
    const res = resolveEnding({
      routeState: { endingBias: { 'court-justice': 5, 'own-proof': 2 } },
      storyContract: nadiaRakaContract,
      chapterNumber: 45,
    })
    expect(res).toEqual({
      key: 'court-justice',
      name: 'Keadilan Formal',
      requiredClosure: [
        'Pencuri lukisan terungkap di persidangan.',
        'Nama galeri dipulihkan.',
        'Nadia menerima akibat pilihannya.',
      ],
    })
  })

  it('resolveEndingFromCandidates resolves directly from ending candidates without full StoryContract', () => {
    const candidates = [
      {
        key: 'c1',
        name: 'Candidate 1',
        kind: 'main' as const,
        condition: 'Syarat 1',
        requiredClosure: ['Closure 1'],
        blockingConditions: [],
      },
      {
        key: 'c2',
        name: 'Candidate 2',
        kind: 'main' as const,
        condition: 'Syarat 2',
        requiredClosure: ['Closure 2'],
        blockingConditions: [],
      },
    ]

    const res = resolveEndingFromCandidates({
      routeState: { endingBias: { c2: 10 } },
      endingLockChapter: 45,
      endingCandidates: candidates,
      chapterNumber: 45,
    })
    expect(res.key).toBe('c2')
    expect(res.name).toBe('Candidate 2')
    expect(res.requiredClosure).toEqual(['Closure 2'])
  })
})

