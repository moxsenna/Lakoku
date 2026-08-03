import { describe, expect, it } from 'vitest'
import {
  buildContinuationContext,
  buildEndingParagraphs,
} from '@lakoku/narrative-core'
import type {
  CanonSnapshot,
  ChapterContextPacket,
  Fact,
  StoryThread,
  TimelineEvent,
} from '@lakoku/narrative-core'
import type { ChoiceHistoryEntry } from '@/lib/story-engine/chapter-brief'

function makeFact(id: string, establishedChapter: number, loadBearing = false): Fact {
  return {
    id,
    storyId: 'story',
    statement: `Fakta ${id}`,
    subjectCharacterId: null,
    establishedChapter,
    salience: 0.5,
    loadBearing,
    paidOff: false,
  }
}

function makeThread(id: string, status: StoryThread['status']): StoryThread {
  return {
    id,
    title: `Thread ${id}`,
    status,
    openedChapter: 1,
    lastTouchedChapter: 1,
    payoffWindow: null,
    isMainMystery: false,
  }
}

function makeTimeline(chapterNumber: number, ordinal: number, desc: string): TimelineEvent {
  return { chapterNumber, ordinal, description: desc, isFlashback: false, occursAt: null }
}

function makePacket(overrides?: Partial<ChapterContextPacket>): ChapterContextPacket {
  return {
    contextVersion: 1,
    storyId: 'story',
    targetChapterNo: 2,
    phase: 'Pijakan',
    storyContractSummary: {},
    chapterGoal: 'G',
    mandatoryBeats: [],
    forbiddenReveals: [],
    currentState: { activeThreads: [makeThread('T1', 'PAYOFF_DUE'), makeThread('T2', 'OPEN')] },
    loadBearingFacts: [makeFact('F1', 1, true), makeFact('F9', 9, true)],
    relevantFacts: [makeFact('F2', 1), makeFact('F10', 10)],
    actRollups: [],
    voiceSheets: [],
    contextBudgetReport: { totalBudget: 4000, used: 0, perSection: {} },
    styleContractRef: 's',
    includedIds: [],
    excludedIds: [],
    ...overrides,
  }
}

function makeSnapshot(overrides?: Partial<CanonSnapshot>): CanonSnapshot {
  return {
    storyId: 'story',
    characters: [],
    aliases: [],
    voiceSheets: [],
    facts: [makeFact('F1', 1, true)],
    knowledge: [],
    secrets: [
      { id: 'S1', description: 'Rahasia A', revealGateChapter: 5, revealed: false },
      { id: 'S2', description: 'Rahasia B', revealGateChapter: 2, revealed: false },
      { id: 'S3', description: 'Rahasia C', revealGateChapter: 1, revealed: false },
    ],
    timeline: [
      makeTimeline(1, 1, 'Bab 1 kejadian'),
      makeTimeline(1, 2, 'Kejadian akhir Bab 1'),
      makeTimeline(2, 1, 'Bab target'),
      { chapterNumber: 1, ordinal: 3, description: 'FB', isFlashback: true, occursAt: null },
    ],
    threads: [],
    actRollups: [],
    blueprints: [],
    ...overrides,
  }
}

function makeChoice(id: string, label: string): ChoiceHistoryEntry {
  return {
    chapterNumber: 1,
    choiceId: id,
    label,
    consequence: ['Konsekuensi A'],
    effectSummary: { flagsSet: [] },
    createdAt: '2026-07-14T00:00:00.000Z',
  }
}

describe('buildEndingParagraphs (moved to narrative-core)', () => {
  it('mengambil 3..5 paragraf terakhir verbatim', () => {
    const paras = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    const out = buildEndingParagraphs(paras, 'J')
    expect(out).toEqual(['p2', 'p3', 'p4', 'p5', 'p6'])
  })

  it('padding dari title bila kurang dari 3', () => {
    const out = buildEndingParagraphs(['p1'], 'Judul')
    expect(out.length).toBe(3)
    expect(out[2]).toBe('p1')
    expect(out[0]).toBe('p1')
  })
})

describe('buildContinuationContext', () => {
  it('bab 1 tanpa previousChapter — legal, previousChapter null', () => {
    const cc = buildContinuationContext({
      storyId: 'story',
      targetChapterNumber: 1,
      snapshot: makeSnapshot(),
      packet: makePacket({ targetChapterNo: 1 }),
      previousChapterRow: null,
      previousChoice: null,
      routeStateSummary: 'r',
      lockedEndingKey: null,
    })
    expect(cc.targetChapterNumber).toBe(1)
    expect(cc.previousChapter).toBeNull()
    expect(cc.previousChoice).toBeNull()
  })

  it('previousChapterRow Bab N-1 di-embed verbatim (ending 3..5)', () => {
    const cc = buildContinuationContext({
      storyId: 'story',
      targetChapterNumber: 2,
      snapshot: makeSnapshot(),
      packet: makePacket(),
      previousChapterRow: {
        number: 1,
        title: 'Bayangan di Balik Kaca',
        paragraphs: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      },
      previousChoice: makeChoice('c1', 'Menepis Raka'),
      routeStateSummary: 'r',
      lockedEndingKey: null,
    })
    expect(cc.previousChapter?.number).toBe(1)
    expect(cc.previousChapter?.title).toBe('Bayangan di Balik Kaca')
    expect(cc.previousChapter?.endingParagraphs).toEqual(['c', 'd', 'e', 'f', 'g'])
  })

  it('anchorFacts hanya established <= N-1 (bukan N atau lebih)', () => {
    const cc = buildContinuationContext({
      storyId: 'story',
      targetChapterNumber: 2,
      snapshot: makeSnapshot(),
      packet: makePacket(),
      previousChapterRow: { number: 1, title: 'T1', paragraphs: ['x', 'y', 'z'] },
      previousChoice: null,
      routeStateSummary: 'r',
      lockedEndingKey: null,
    })
    const ids = cc.anchorFacts.map((f) => f.id)
    expect(ids).toContain('F1')
    expect(ids).toContain('F2')
    expect(ids).not.toContain('F9')
    expect(ids).not.toContain('F10')
  })

  it('recentTimeline hanya <= N-1, di-reverse terbaru dulu, tanpa flashback', () => {
    const cc = buildContinuationContext({
      storyId: 'story',
      targetChapterNumber: 2,
      snapshot: makeSnapshot(),
      packet: makePacket(),
      previousChapterRow: { number: 1, title: 'T', paragraphs: ['a', 'b', 'c'] },
      previousChoice: null,
      routeStateSummary: 'r',
      lockedEndingKey: null,
    })
    // Bab 2 (target) dan flashback dikeluarkan.
    expect(cc.recentTimeline.map((t) => t.description)).toEqual([
      'Kejadian akhir Bab 1',
      'Bab 1 kejadian',
    ])
  })

  it('mustNotReveal hanya gate > N (tidak pernah sebagai anchorFacts)', () => {
    const cc = buildContinuationContext({
      storyId: 'story',
      targetChapterNumber: 2,
      snapshot: makeSnapshot(),
      packet: makePacket(),
      previousChapterRow: { number: 1, title: 'T', paragraphs: ['a', 'b', 'c'] },
      previousChoice: null,
      routeStateSummary: 'r',
      lockedEndingKey: null,
    })
    // gate 5 > 2 → masuk larangan; gate 2 > 2 false → S2 boleh terungkap di Bab 2;
    // gate 1 < 2 → sudah mapan; tidak masuk larangan.
    expect(cc.mustNotReveal).toEqual(['Rahasia A'])
    expect(cc.mustNotReveal).not.toContain('Rahasia B')
    expect(cc.mustNotReveal).not.toContain('Rahasia C')
    const ids = new Set(cc.anchorFacts.map((f) => f.id))
    expect(ids.has('S1')).toBe(false)
    expect(ids.has('S2')).toBe(false)
  })

  it('previousChoice terseleksi via triggerChoiceId dibawa apa adanya', () => {
    const choice = makeChoice('c-A', 'Menepis tangan Raka')
    const cc = buildContinuationContext({
      storyId: 'story',
      targetChapterNumber: 2,
      snapshot: makeSnapshot(),
      packet: makePacket(),
      previousChapterRow: { number: 1, title: 'T', paragraphs: ['a', 'b', 'c'] },
      previousChoice: choice,
      routeStateSummary: 'rute',
      lockedEndingKey: null,
    })
    expect(cc.previousChoice).toEqual(choice)
    expect(cc.routeStateSummary).toBe('rute')
  })

  it('deterministik: dua call dengan input sama → output deep-equal', () => {
    const input = {
      storyId: 'story',
      targetChapterNumber: 2,
      snapshot: makeSnapshot(),
      packet: makePacket(),
      previousChapterRow: { number: 1, title: 'T', paragraphs: ['a', 'b', 'c'] },
      previousChoice: makeChoice('c1', 'x'),
      routeStateSummary: 'r',
      lockedEndingKey: null,
    }
    const a = buildContinuationContext(input)
    const b = buildContinuationContext(input)
    expect(a).toEqual(b)
  })
})
