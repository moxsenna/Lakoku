import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'
import type { CanonSnapshot } from '@/lib/narrative/types'
import {
  ChapterBriefSchema,
  ChoiceHistoryEntrySchema,
  buildChapterBrief,
} from '@/lib/story-engine/chapter-brief'

function snapshot(): CanonSnapshot {
  return {
    storyId: misteriDramaContract.storyId,
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [
      { id: 'secret-late', description: 'Rahasia terakhir.', revealGateChapter: 45, revealed: false },
    ],
    timeline: [],
    threads: [
      {
        id: 'thread-payoff',
        title: 'Utang keluarga',
        status: 'PAYOFF_DUE',
        openedChapter: 4,
        lastTouchedChapter: 39,
        payoffWindow: 46,
        isMainMystery: false,
      },
    ],
    actRollups: [],
    blueprints: Array.from({ length: 50 }, (_, index) => ({
      chapterNumber: index + 1,
      version: 1,
      phase: `Blueprint phase ${index + 1}`,
      chapterGoal: `Blueprint goal ${index + 1}`,
      mandatoryBeats: [`Blueprint beat ${index + 1}`],
      forbiddenReveals: index + 1 < 45 ? ['secret-late'] : [],
      allowedStateDelta: {},
      introducesCharacters: [],
      reconciledFromVersion: null,
      reconciliationReason: null,
    })),
  }
}

function brief(chapterNumber: number, overrides: Partial<Parameters<typeof buildChapterBrief>[0]> = {}) {
  return buildChapterBrief({
    storyContract: misteriDramaContract,
    snapshot: snapshot(),
    readerState: {
      routeState: { truth: 4, trust: { Raka: 2 } },
      choiceHistory: [],
      lockedEndingKey: null,
    },
    chapterNumber,
    previousChoice: null,
    ...overrides,
  })
}

describe('ChoiceHistoryEntrySchema', () => {
  it('is strict and bounded', () => {
    expect(ChoiceHistoryEntrySchema.parse({
      chapterNumber: 3,
      choiceId: 'inspect-letter',
      label: 'Periksa surat lama',
    })).toEqual({
      chapterNumber: 3,
      choiceId: 'inspect-letter',
      label: 'Periksa surat lama',
    })
    expect(ChoiceHistoryEntrySchema.safeParse({
      chapterNumber: 3,
      choiceId: 'inspect-letter',
      label: 'Periksa surat lama',
      provider: 'hidden',
    }).success).toBe(false)
    expect(ChoiceHistoryEntrySchema.safeParse({
      chapterNumber: 50,
      choiceId: 'late',
      label: 'Pilihan terlambat',
    }).success).toBe(false)
  })
})

describe('buildChapterBrief runway', () => {
  it.each([
    [20, true, true, 'expansion', true, false],
    [21, true, true, 'closure-emphasis', true, false],
    [35, true, true, 'closure-emphasis', true, false],
    [36, true, false, 'convergence', true, false],
    [40, true, false, 'convergence', true, false],
    [41, false, false, 'convergence', true, false],
    [45, false, false, 'ending-lock', true, false],
    [48, false, false, 'payoff', true, false],
    [49, false, false, 'emotional-resolution', true, false],
    [50, false, false, 'final', false, true],
  ] as const)(
    'applies exact runway at chapter %i',
    (chapterNumber, allowedNewThread, allowedMajorNewConflict, endingRunway, allowsChoices, finalChapter) => {
      const result = brief(chapterNumber)

      expect(result).toMatchObject({
        chapterNumber,
        totalChapters: 50,
        remainingChapters: 50 - chapterNumber,
        allowedNewThread,
        allowedMajorNewConflict,
        endingRunway,
        allowsChoices,
        finalChapter,
      })
      expect(ChapterBriefSchema.safeParse(result).success).toBe(true)
    },
  )

  it('locks highest-biased ending at chapter 45 and preserves an existing lock later', () => {
    const [first, second] = misteriDramaContract.endingCandidates
    expect(brief(44).lockedEndingKey).toBeNull()
    expect(brief(45, {
      readerState: {
        routeState: { endingBias: { [first.key]: 1, [second.key]: 9 } },
        choiceHistory: [],
        lockedEndingKey: null,
      },
    }).lockedEndingKey).toBe(second.key)
    expect(brief(48, {
      readerState: {
        routeState: { endingBias: { [second.key]: 100 } },
        choiceHistory: [],
        lockedEndingKey: first.key,
      },
    }).lockedEndingKey).toBe(first.key)
  })
})

describe('buildChapterBrief content', () => {
  it('uses exact contract target and matching canon blueprint', () => {
    const result = brief(12)
    const target = misteriDramaContract.chapterTargets[11]

    expect(result.phase).toBe(target.phase)
    expect(result.chapterGoal).toBe(target.goal)
    expect(result.mustInclude).toEqual(expect.arrayContaining([
      ...target.mustInclude,
      ...target.expectedThreadMovement,
      'Blueprint beat 12',
    ]))
    expect(result.mustNotReveal).toEqual(expect.arrayContaining([
      ...target.mustNotReveal,
      'secret-late',
    ]))
    expect(result.routeStateSummary).toContain('truth=4')
    expect(result.routeStateSummary).toContain('Raka=2')
  })

  it('selects debt progress and closure deadlines deterministically in contract order', () => {
    const contract = structuredClone(misteriDramaContract)
    contract.plotDebts = [
      {
        id: 'debt-b',
        question: 'Utang B?',
        introducedAt: 1,
        mustProgressBy: [20, 30],
        mustCloseBy: 30,
        status: 'progressing',
      },
      {
        id: 'main_mystery',
        question: 'Misteri utama?',
        introducedAt: 1,
        mustProgressBy: [20, 45],
        mustCloseBy: 48,
        status: 'open',
      },
      {
        id: 'closed-debt',
        question: 'Sudah selesai?',
        introducedAt: 1,
        mustProgressBy: [20],
        mustCloseBy: 20,
        status: 'closed',
      },
    ]

    expect(brief(20, { storyContract: contract })).toMatchObject({
      plotDebtsToProgress: ['debt-b', 'main_mystery'],
      plotDebtsToClose: [],
    })
    expect(brief(30, { storyContract: contract })).toMatchObject({
      plotDebtsToProgress: [],
      plotDebtsToClose: ['debt-b'],
    })
  })

  it('summarizes persisted and previous choices in stable history order', () => {
    const result = brief(8, {
      readerState: {
        routeState: {},
        choiceHistory: [
          { chapterNumber: 2, choiceId: 'wait', label: 'Tunggu Raka' },
          { chapterNumber: 5, choiceId: 'follow', label: 'Ikuti mobil hitam' },
        ],
        lockedEndingKey: null,
      },
      previousChoice: {
        chapterNumber: 7,
        choiceId: 'open',
        label: 'Buka pintu gudang',
      },
    })

    expect(result.choiceHistorySummary).toBe(
      'Bab 2 [wait]: Tunggu Raka\nBab 5 [follow]: Ikuti mobil hitam\nBab 7 [open]: Buka pintu gudang',
    )
  })

  it('requires exact matching target and blueprint', () => {
    const badSnapshot = snapshot()
    badSnapshot.blueprints = badSnapshot.blueprints.filter((item) => item.chapterNumber !== 9)

    expect(() => brief(9, { snapshot: badSnapshot })).toThrow('Missing canon blueprint for chapter 9.')
    expect(() => brief(0)).toThrow(z.ZodError)
  })

  it('does not mutate contract, snapshot, reader state, or previous choice', () => {
    const storyContract = structuredClone(misteriDramaContract)
    const canon = snapshot()
    const readerState = {
      routeState: { evidence: ['surat'] },
      choiceHistory: [{ chapterNumber: 2, choiceId: 'read', label: 'Baca surat' }],
      lockedEndingKey: null,
    }
    const previousChoice = { chapterNumber: 4, choiceId: 'ask', label: 'Tanya Raka' }
    const before = structuredClone({ storyContract, canon, readerState, previousChoice })

    buildChapterBrief({ storyContract, snapshot: canon, readerState, chapterNumber: 5, previousChoice })

    expect({ storyContract, canon, readerState, previousChoice }).toEqual(before)
  })
})
