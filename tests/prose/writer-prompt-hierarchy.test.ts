import type { ContinuationContext } from '@lakoku/narrative-core'
import { describe, expect, it } from 'vitest'
import { buildWriterPrompt } from '../../lib/prose/prompt-engine/build-writer-prompt'
import type { PreProseChapterBrief } from '../../lib/story-engine/pre-prose-brief'

describe('buildWriterPrompt - CHAPTER_BRIEF_V2 hierarchy', () => {
  const mockContinuation: ContinuationContext = {
    storyId: 'story-1',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Galeri Seni',
      endingParagraphs: [
        'Paragraf 1 galeri malam hari.',
        'Paragraf 2 Nadia menatap Raka.',
        'Paragraf 3 Keputusan diambil.',
      ],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'choice-1',
      label: 'Konfrontasi Raka',
      consequence: ['Nadia menuduh Raka'],
      effectSummary: { flagsSet: ['tension_high'] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: 'Rute tegang',
    openThreads: [{ id: 'thread-1', title: 'Thread 1', status: 'OPEN', openedChapter: 1, lastTouchedChapter: 1 }],
    anchorFacts: [{ id: 'f1', statement: 'Fakta 1: Lukisan hilang', establishedChapter: 1, loadBearing: true }],
    recentTimeline: [{ chapterNumber: 1, ordinal: 1, description: 'Nadia masuk galeri' }],
    mustNotReveal: ['Secret X'],
    storyAnchors: null,
    actRollups: [],
    lockedEndingKey: null,
  }

  const brief: PreProseChapterBrief = {
    storyId: 'story-1',
    chapterNumber: 2,
    phase: 'rising',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Hadapi dampak konfrontasi',
    mustInclude: ['Nadia menghadapi Raka'],
    mustNotInclude: [],
    mustNotReveal: ['Secret X'],
    forbiddenRevealIds: [],
    resolvedPlotDebtIds: [],
    scheduledReveals: [],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    routeStateSummary: 'Rute tegang',
    previousChoiceSummary: 'Konfrontasi Raka',
    previousChoiceApplied: true,
  }

  it('menyusun P0-P5 sesuai urutan authority aktif', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      characterNames: ['Nadia', 'Raka'],
      plannedBeats: ['Nadia menghadapi Raka'],
      continuation: mockContinuation,
      brief,
    })

    const positions = ['[P0]', '[P1]', '[P2]', '[P3]', '[P4]', '[P5]']
      .map((label) => prompt.user.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(prompt.user).toContain('RAHASIA DILARANG UNTUK DIUNGKAP/DIBOCORKAN')
    expect(prompt.user).toContain('Paragraf 2 Nadia menatap Raka.')
    expect(prompt.user).toContain('Pilihan: "Konfrontasi Raka"')
    expect(prompt.user).toContain('KONSEKUENSI DI ATAS TELAH TERJADI DAN MENGIKAT')
  })

  it('memakai brief sebagai authority tujuan dan keadaan rute', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      goal: 'Tujuan caller yang tidak berwenang',
      continuation: mockContinuation,
      brief,
    })

    expect(prompt.user).toContain(`Tujuan Bab: ${brief.chapterGoal}`)
    expect(prompt.user).not.toContain('Tujuan caller yang tidak berwenang')
    expect(prompt.user).toContain(`Keadaan rute: ${brief.routeStateSummary}`)
    expect(prompt.user).not.toContain('[object Object]')
  })

  it('gagal tertutup bila brief runtime hilang', () => {
    expect(() => buildWriterPrompt({
      chapterNumber: 2,
      brief: undefined as never,
    })).toThrow('CHAPTER_BRIEF_V2_BRIEF_REQUIRED')
  })
})
