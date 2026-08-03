import { describe, expect, it } from 'vitest'
import { buildPreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'
import type { CanonSnapshot, ChapterBlueprint } from '@lakoku/narrative-core'
import type { ContinuationContext } from '@lakoku/narrative-core'
import type { ChapterBrief } from '@/lib/story-engine/chapter-brief'
import type { ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'

function makeBlueprint(overrides?: Partial<ChapterBlueprint>): ChapterBlueprint {
  return {
    chapterNumber: 2,
    version: 1,
    phase: 'Pijakan',
    chapterGoal: 'Kerangka generik fase.',
    mandatoryBeats: ['Kembangkan fase "Pijakan".'],
    forbiddenReveals: ['Jangan bocorkan X'],
    allowedStateDelta: {},
    introducesCharacters: [],
    reconciledFromVersion: null,
    reconciliationReason: null,
    ...overrides,
  }
}

function makeSnapshot(): CanonSnapshot {
  return {
    storyId: 'story',
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [],
    knowledge: [],
    secrets: [],
    timeline: [],
    threads: [],
    actRollups: [],
    blueprints: [makeBlueprint()],
  }
}

function makeChoice(overrides?: Partial<ChoiceHistoryEntry>): ChoiceHistoryEntry {
  return {
    chapterNumber: 1,
    choiceId: 'c-A',
    label: 'Menepis tangan Raka',
    consequence: ['Nadia mempertahankan harga dirinya'],
    effectSummary: { flagsSet: [] },
    createdAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  }
}

function makeContinuation(overrides?: Partial<ContinuationContext>): ContinuationContext {
  return {
    storyId: 'story',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Bayangan di Balik Kaca',
      endingParagraphs: ['p1', 'p2', 'p3'],
    },
    previousChoice: makeChoice(),
    routeStateSummary: '{truth:1}',
    openThreads: [],
    anchorFacts: [],
    recentTimeline: [],
    mustNotReveal: ['Rahasia S1'],
    ...overrides,
  }
}

function makeChapterBrief(overrides?: Partial<ChapterBrief>): ChapterBrief {
  const base: ChapterBrief = {
    storyId: 'story',
    chapterNumber: 2,
    totalChapters: 50,
    phase: 'Pijakan',
    remainingChapters: 48,
    chapterGoal: 'Tujuan khusus dari kontrak.',
    mustInclude: [],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: '{}',
    choiceHistorySummary: '',
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    allowedNewThread: true,
    allowedMajorNewConflict: true,
    endingRunway: 'expansion',
    lockedEndingKey: null,
    allowsChoices: true,
    finalChapter: false,
    goals: ['Tujuan khusus dari kontrak.'],
    routeSummary: '{}',
    debtsToProgress: [],
    debtsToClose: [],
    allowMajorNewConflict: true,
    allowNewThread: true,
    lockEnding: false,
    endingKey: null,
    previousChoiceSummary: '',
  }
  return { ...base, ...overrides }
}

describe('buildPreProseChapterBrief', () => {
  it('RESULTAT: tanpa continuation + tanpa brief → fallback blueprint (Bab 1)', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 1,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint({ chapterNumber: 1 }),
      continuation: null,
      chapterBrief: null,
    })
    expect(brief.chapterGoal).toBe('Kerangka generik fase.')
    expect(brief.previousChoiceApplied).toBe(false)
  })

  it('HIERARCHY 1: continuation.previousChoice MENGATASI brief & blueprint', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 2,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint(),
      continuation: makeContinuation(),
      chapterBrief: makeChapterBrief(),
    })
    expect(brief.previousChoiceApplied).toBe(true)
    expect(brief.chapterGoal).toContain('Menepis tangan Raka')
    expect(brief.chapterGoal).toContain('Nadia mempertahankan harga dirinya')
    expect(brief.chapterGoal).toContain('Kerangka fase')
  })

  it('HIERARCHY 2: tanpa continuation → brief.chapterGoal menang atas blueprint', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 2,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint(),
      continuation: null,
      chapterBrief: makeChapterBrief(),
    })
    expect(brief.previousChoiceApplied).toBe(false)
    expect(brief.chapterGoal).toBe('Tujuan khusus dari kontrak.')
  })

  it('mustNotReveal digabung dari continuation + blueprint', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 2,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint(),
      continuation: makeContinuation({ mustNotReveal: ['Rahasia S1', 'Rahasia S2'] }),
      chapterBrief: null,
    })
    expect(brief.mustNotReveal).toContain('Rahasia S1')
    expect(brief.mustNotReveal).toContain('Rahasia S2')
    expect(brief.mustNotReveal).toContain('Jangan bocorkan X')
  })

  it('mustInclude di-push dengan linjep Bab N-1 bila ada continuation', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 2,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint(),
      continuation: makeContinuation(),
      chapterBrief: null,
    })
    expect(brief.mustInclude.some((b) => b.includes('Bayangan di Balik Kaca'))).toBe(true)
  })

  it('previousChoiceSummary ada bila previousChoice tersedia', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 2,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint(),
      continuation: makeContinuation(),
      chapterBrief: null,
    })
    expect(brief.previousChoiceSummary).toContain('Menepis tangan Raka')
    expect(brief.previousChoiceSummary).toContain('Nadia mempertahankan harga dirinya')
  })

  it('tanpa continuation + tanpa brief, tetap valid schema', () => {
    const brief = buildPreProseChapterBrief({
      storyId: 'story',
      chapterNumber: 1,
      snapshot: makeSnapshot(),
      blueprint: makeBlueprint({ chapterNumber: 1 }),
      continuation: null,
      chapterBrief: null,
    })
    expect(brief.storyId).toBe('story')
    expect(brief.phase).toBe('Pijakan')
    expect(brief.previousChoiceSummary).toBe('')
  })
})
