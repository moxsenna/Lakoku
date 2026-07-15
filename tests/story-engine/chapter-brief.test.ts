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

function choiceHistoryEntry(overrides: Partial<z.input<typeof ChoiceHistoryEntrySchema>> = {}) {
  return {
    chapterNumber: 2,
    choiceId: 'wait',
    label: 'Tunggu Raka',
    consequence: ['Raka tiba setelah hujan reda.'],
    effectSummary: { truth: 1, flagsSet: ['waited_for_raka'] },
    createdAt: '2026-07-14T10:30:00.000Z',
    ...overrides,
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
  const completeEntry = {
    chapterNumber: 3,
    choiceId: 'inspect-letter',
    label: 'Periksa surat lama',
    consequence: ['Nara menemukan cap pengiriman.'],
    effectSummary: {
      truth: 2,
      risk: -1,
      flagsSet: ['letter_inspected'],
    },
    createdAt: '2026-07-14T10:30:00.000Z',
  }

  it('requires the complete strict choice history contract', () => {
    expect(ChoiceHistoryEntrySchema.parse(completeEntry)).toEqual(completeEntry)
    expect(ChoiceHistoryEntrySchema.safeParse({
      ...completeEntry,
      provider: 'hidden',
    }).success).toBe(false)
    expect(ChoiceHistoryEntrySchema.safeParse({
      ...completeEntry,
      effectSummary: { ...completeEntry.effectSummary, provider: 1 },
    }).success).toBe(false)

    for (const field of ['consequence', 'effectSummary', 'createdAt'] as const) {
      const incomplete = { ...completeEntry }
      delete incomplete[field]
      expect(ChoiceHistoryEntrySchema.safeParse(incomplete).success).toBe(false)
    }
  })

  it.each([
    ['chapter 50', { ...completeEntry, chapterNumber: 50 }],
    ['oversized consequence list', { ...completeEntry, consequence: ['a', 'b', 'c'] }],
    ['oversized consequence', { ...completeEntry, consequence: ['x'.repeat(161)] }],
    ['effect outside bounds', { ...completeEntry, effectSummary: { truth: 21, flagsSet: [] } }],
    ['oversized flags list', { ...completeEntry, effectSummary: { flagsSet: Array.from({ length: 33 }, (_, index) => `flag-${index}`) } }],
    ['oversized flag', { ...completeEntry, effectSummary: { flagsSet: ['x'.repeat(81)] } }],
    ['non-ISO timestamp', { ...completeEntry, createdAt: '14 July 2026' }],
  ])('rejects %s', (_name, input) => {
    expect(ChoiceHistoryEntrySchema.safeParse(input).success).toBe(false)
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
    expect(result.previousChoiceSummary).toBe(result.choiceHistorySummary)
  })

  it('retains canonical fields and exposes equal plan aliases', () => {
    const result = brief(45, {
      previousChoice: choiceHistoryEntry({ chapterNumber: 44 }),
    })

    expect(result.goals).toEqual([result.chapterGoal])
    expect(result.routeSummary).toBe(result.routeStateSummary)
    expect(result.debtsToProgress).toEqual(result.plotDebtsToProgress)
    expect(result.debtsToClose).toEqual(result.plotDebtsToClose)
    expect(result.allowMajorNewConflict).toBe(result.allowedMajorNewConflict)
    expect(result.allowNewThread).toBe(result.allowedNewThread)
    expect(result.lockEnding).toBe(result.lockedEndingKey !== null)
    expect(result.endingKey).toBe(result.lockedEndingKey)
    expect(result.previousChoiceSummary).toBe(result.choiceHistorySummary)
    expect(ChapterBriefSchema.safeParse(result).success).toBe(true)
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
      plotDebtsToProgress: ['main_mystery'],
      plotDebtsToClose: ['debt-b'],
    })
  })

  it('carries overdue open and progressing debts at chapter 31 without duplicates', () => {
    const contract = structuredClone(misteriDramaContract)
    contract.plotDebts = [
      {
        id: 'progress-overdue',
        question: 'Utang progres lama?',
        introducedAt: 1,
        mustProgressBy: [10, 20, 30],
        mustCloseBy: 40,
        status: 'progressing',
      },
      {
        id: 'main_mystery',
        question: 'Misteri utama?',
        introducedAt: 1,
        mustProgressBy: [12, 32],
        mustCloseBy: 48,
        status: 'open',
      },
      {
        id: 'close-overdue',
        question: 'Utang penutupan lama?',
        introducedAt: 1,
        mustProgressBy: [15, 25],
        mustCloseBy: 30,
        status: 'open',
      },
      {
        id: 'closed-overdue',
        question: 'Sudah ditutup?',
        introducedAt: 1,
        mustProgressBy: [10],
        mustCloseBy: 20,
        status: 'closed',
      },
    ]

    const result = brief(31, { storyContract: contract })

    expect(result.plotDebtsToProgress).toEqual(['progress-overdue', 'main_mystery'])
    expect(result.plotDebtsToClose).toEqual(['close-overdue'])
    expect(result.debtsToProgress).toEqual(result.plotDebtsToProgress)
    expect(result.debtsToClose).toEqual(result.plotDebtsToClose)
    expect(new Set(result.plotDebtsToProgress).size).toBe(result.plotDebtsToProgress.length)
    expect(new Set(result.plotDebtsToClose).size).toBe(result.plotDebtsToClose.length)
  })

  it('summarizes persisted and previous choices with bounded details in stable history order', () => {
    const result = brief(8, {
      readerState: {
        routeState: {},
        choiceHistory: [
          choiceHistoryEntry(),
          choiceHistoryEntry({
            chapterNumber: 5,
            choiceId: 'follow',
            label: 'Ikuti mobil hitam',
            consequence: ['Nara melihat mobil berhenti di gudang.', 'Raka kehilangan jejak Nara.'],
            effectSummary: { risk: 2, secrecy: 1, flagsSet: ['found_warehouse', 'left_raka'] },
            createdAt: '2026-07-14T11:00:00.000Z',
          }),
        ],
        lockedEndingKey: null,
      },
      previousChoice: choiceHistoryEntry({
        chapterNumber: 7,
        choiceId: 'open',
        label: 'Buka pintu gudang',
        consequence: ['Alarm gudang menyala.'],
        effectSummary: { truth: 2, empathy: -1, flagsSet: [] },
        createdAt: '2026-07-14T12:00:00.000Z',
      }),
    })

    expect(result.choiceHistorySummary).toBe([
      'Bab 2 [wait]: Tunggu Raka | Konsekuensi: Raka tiba setelah hujan reda. | Efek: truth=1; flagsSet=waited_for_raka',
      'Bab 5 [follow]: Ikuti mobil hitam | Konsekuensi: Nara melihat mobil berhenti di gudang. / Raka kehilangan jejak Nara. | Efek: risk=2; secrecy=1; flagsSet=found_warehouse,left_raka',
      'Bab 7 [open]: Buka pintu gudang | Konsekuensi: Alarm gudang menyala. | Efek: truth=2; empathy=-1; flagsSet=-',
    ].join('\n'))
    expect(result.previousChoiceSummary).toBe(result.choiceHistorySummary)
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
      choiceHistory: [choiceHistoryEntry({ choiceId: 'read', label: 'Baca surat' })],
      lockedEndingKey: null,
    }
    const previousChoice = choiceHistoryEntry({
      chapterNumber: 4,
      choiceId: 'ask',
      label: 'Tanya Raka',
    })
    const before = structuredClone({ storyContract, canon, readerState, previousChoice })

    buildChapterBrief({ storyContract, snapshot: canon, readerState, chapterNumber: 5, previousChoice })

    expect({ storyContract, canon, readerState, previousChoice }).toEqual(before)
  })
})
