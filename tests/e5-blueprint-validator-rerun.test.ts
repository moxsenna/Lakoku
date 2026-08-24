import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadCanonSnapshot: vi.fn(),
  checkSpineIntegrity: vi.fn(),
  checkEndingReachability: vi.fn(),
  isEndingReachable: vi.fn(),
  parseStoryContractWithNormalization: vi.fn(),
  deriveEndingDef: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@lakoku/db', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/narrative/loader', () => ({ loadCanonSnapshot: mocks.loadCanonSnapshot }))
vi.mock('@/lib/narrative/reconciliation', () => ({
  checkSpineIntegrity: mocks.checkSpineIntegrity,
  checkEndingReachability: mocks.checkEndingReachability,
  isEndingReachable: mocks.isEndingReachable,
}))
vi.mock('@/lib/story-engine/story-contract', () => ({
  parseStoryContractWithNormalization: mocks.parseStoryContractWithNormalization,
  deriveEndingDef: mocks.deriveEndingDef,
}))

import { runValidatorRerun } from '@/lib/utils/validator-rerun.helper'

function contractClient() {
  const maybeSingle = vi.fn(async () => ({
    data: {
      story_id: 'story-123',
      story_contract_json: {},
      plot_debts_json: [],
      ending_candidates_json: [{ id: 'main-ending-1' }, { id: 'main-ending-2' }],
    },
    error: null,
  }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  mocks.createAdminClient.mockReturnValue({ from })
  return { from, select, eq, maybeSingle }
}

function canonicalSnapshot() {
  return {
    storyId: 'story-123',
    blueprints: [
      { storyId: 'story-123', chapterNumber: 9, version: 2 },
      { storyId: 'story-123', chapterNumber: 2, version: 1 },
      { storyId: 'story-123', chapterNumber: 9, version: 7 },
      { storyId: 'story-123', chapterNumber: 2, version: 4 },
    ],
    secrets: [],
    facts: [],
    knowledge: [],
    threads: [],
  }
}

describe('E5 canonical validator rerun', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    contractClient()
    mocks.loadCanonSnapshot.mockResolvedValue(canonicalSnapshot())
    mocks.parseStoryContractWithNormalization.mockReturnValue({
      endingCandidates: [{ id: 'main-ending-1' }, { id: 'main-ending-2' }],
    })
    mocks.deriveEndingDef.mockImplementation((ending: { id: string }) => ({
      id: ending.id,
      isMain: true,
      isSecret: false,
    }))
    mocks.checkSpineIntegrity.mockReturnValue([])
    mocks.checkEndingReachability.mockReturnValue([])
    mocks.isEndingReachable.mockReturnValue(true)
  })

  it('normalizes chapter order and records exact latest canonical versions', async () => {
    const result = await runValidatorRerun('story-123', [9, 2])

    expect(result).toEqual({
      passed: true,
      failures: [],
      validatedChapterVersions: [
        { chapter: 2, expected_version: 4 },
        { chapter: 9, expected_version: 7 },
      ],
      spineRevealFindings: [],
      endingResults: {
        mainEndingReachable: true,
        secretEndingsReachable: [],
      },
    })
    expect(mocks.loadCanonSnapshot).toHaveBeenCalledWith('story-123', 9)
    expect(mocks.checkSpineIntegrity).toHaveBeenCalledTimes(2)
  })

  it.each([
    { chapters: [], chapter: 0, message: 'Chapter numbers cannot be empty' },
    { chapters: [0], chapter: 0, message: 'Chapter number must be an integer from 1 to 50' },
    { chapters: [2, 2], chapter: 2, message: 'Duplicate chapter numbers are not allowed' },
  ])('fails closed before authority loading for invalid chapter set $chapters', async ({ chapters, chapter, message }) => {
    const result = await runValidatorRerun('story-123', chapters)

    expect(result).toEqual({
      passed: false,
      failures: [{ chapterNumber: chapter, failureType: 'INVALID_CHAPTER_NUMBERS', message }],
      validatedChapterVersions: [],
    })
    expect(mocks.loadCanonSnapshot).not.toHaveBeenCalled()
  })

  it('fails closed with exact validated versions when canonical validator reports findings', async () => {
    mocks.checkSpineIntegrity.mockImplementation((blueprint: { chapterNumber: number }) => (
      blueprint.chapterNumber === 9
        ? [{ code: 'FORBIDDEN_REVEAL', severity: 'error', message: 'Reveal terlalu dini' }]
        : []
    ))

    const result = await runValidatorRerun('story-123', [2, 9])

    expect(result.passed).toBe(false)
    expect(result.validatedChapterVersions).toEqual([
      { chapter: 2, expected_version: 4 },
      { chapter: 9, expected_version: 7 },
    ])
    expect(result.failures).toContainEqual({
      chapterNumber: 9,
      failureType: 'FORBIDDEN_REVEAL',
      message: 'error: Reveal terlalu dini',
    })
  })

  it('fails closed when canonical authority throws and exposes no invented proof', async () => {
    mocks.loadCanonSnapshot.mockRejectedValue(new Error('snapshot unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(runValidatorRerun('story-123', [2])).resolves.toEqual({
      passed: false,
      failures: [{
        chapterNumber: 2,
        failureType: 'CANONICAL_AUTHORITY_UNAVAILABLE',
        message: 'snapshot unavailable',
      }],
      validatedChapterVersions: [],
    })
  })
})
