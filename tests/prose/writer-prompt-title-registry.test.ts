import type { ContinuationContext } from '@lakoku/narrative-core'
import { describe, expect, it } from 'vitest'
import { buildWriterPrompt, dominantTitleKeywords } from '../../lib/prose/prompt-engine/build-writer-prompt'
import type { PreProseChapterBrief } from '../../lib/story-engine/pre-prose-brief'

describe('dominantTitleKeywords', () => {
  it('melarang kata yang muncul di >= 3 judul berbeda', () => {
    const titles = [
      'Bayang-Bayang di Ujung Lorong',
      'Bayang-Bayang di Balik Daun Pintu',
      'Bayang Dokumen di Bawah Lampu',
      'Ritual Terakhir di Dapur',
    ]
    expect(dominantTitleKeywords(titles)).toContain('bayang')
    expect(dominantTitleKeywords(titles)).not.toContain('lorong')
    expect(dominantTitleKeywords(titles)).not.toContain('dapur')
  })

  it('kata di 2 judul saja tidak dilang', () => {
    const titles = ['Jejak di Pantai', 'Jejak di Bukit', 'Ritual Terakhir']
    expect(dominantTitleKeywords(titles)).not.toContain('jejak')
  })

  it('kata hubung (stopword) tidak pernah dilang meski sering', () => {
    const titles = ['Yang Tersisa', 'Yang Hilang', 'Yang Kembali']
    expect(dominantTitleKeywords(titles)).toEqual([])
  })

  it('kata berulang dalam satu judul hanya dihitung sekali per judul', () => {
    const titles = ['Bayang-Bayang', 'Bayang Lama', 'Bayang Baru']
    expect(dominantTitleKeywords(titles)).toEqual(['bayang'])
  })

  it('kata pendek (<4 huruf) diabaikan', () => {
    const titles = ['Dia dan Aku', 'Dia di Sana', 'Dia Kembali']
    expect(dominantTitleKeywords(titles)).toEqual([])
  })
})

describe('registry judul di prompt writer', () => {
  const brief: PreProseChapterBrief = {
    storyId: 'story-1',
    chapterNumber: 15,
    phase: 'rising',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Sidikit demi sedikit buka rahasia',
    mustInclude: [],
    mustNotInclude: [],
    mustNotReveal: [],
    forbiddenRevealIds: [],
    resolvedPlotDebtIds: [],
    scheduledReveals: [],
    plotDebtsToProgress: [],
    plotDebtsToClose: [],
    routeStateSummary: 'Rute tegang',
    previousChoiceSummary: '',
    previousChoiceApplied: false,
  }

  const usedTitles = [
    'Bayang-Bayang di Ujung Lorong',
    'Bayang-Bayang di Balik Daun Pintu',
    'Bayang Dokumen di Bawah Lampu',
    'Jejak Hitam di Bawah Meja',
  ]

  const continuation: ContinuationContext = {
    storyId: 'story-1',
    targetChapterNumber: 15,
    previousChapter: {
      number: 14,
      title: usedTitles[3],
      endingParagraphs: ['Penutup bab empat belas.'],
    },
    previousChoice: null,
    routeStateSummary: 'Rute tegang',
    openThreads: [],
    anchorFacts: [],
    recentTimeline: [],
    mustNotReveal: [],
    storyAnchors: null,
    actRollups: [],
    lockedEndingKey: null,
    previousTitles: usedTitles,
  }

  it('melarang eksplisit semua judul yang sudah dipakai', () => {
    const prompt = buildWriterPrompt({ chapterNumber: 15, continuation, brief })
    expect(prompt.user).toContain('REGISTRY JUDUL SUDAH DIPAKAI')
    for (const title of usedTitles) {
      expect(prompt.user).toContain(`"${title}"`)
    }
  })

  it('melarang kata kunci yang sudah dominan di judul-judul lama', () => {
    const prompt = buildWriterPrompt({ chapterNumber: 15, continuation, brief })
    expect(prompt.user).toContain('DILARANG menjadi kata utama judul baru')
    expect(prompt.user).toContain('bayang')
    expect(prompt.user).toContain('bawah')
  })

  it('mewajibkan judul unik dengan kosakata segar', () => {
    const prompt = buildWriterPrompt({ chapterNumber: 15, continuation, brief })
    expect(prompt.user).toContain('WAJIB unik')
  })

  it('tanpa previousTitles prompt tetap valid tanpa baris registry', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 1,
      continuation: { ...continuation, targetChapterNumber: 1, previousChapter: null, previousTitles: undefined },
      brief: { ...brief, chapterNumber: 1 },
    })
    expect(prompt.user).not.toContain('REGISTRY JUDUL SUDAH DIPAKAI')
    expect(prompt.user).not.toContain('DILARANG menjadi kata utama judul baru')
  })

  it('previousTitles dibatasi ke 24 terakhir oleh builder konteks', async () => {
    const { buildContinuationContext } = await import('@lakoku/narrative-core')
    type CanonSnapshot = Parameters<typeof buildContinuationContext>[0]['snapshot']
    type ChapterContextPacket = Parameters<typeof buildContinuationContext>[0]['packet']
    const snapshot: CanonSnapshot = {
      storyId: 'story-1',
      characters: [],
      aliases: [],
      voiceSheets: [],
      facts: [],
      knowledge: [],
      secrets: [],
      timeline: [],
      threads: [],
      actRollups: [],
      blueprints: [],
    }
    const packet: ChapterContextPacket = {
      contextVersion: 1,
      storyId: 'story-1',
      targetChapterNo: 41,
      phase: 'Pijakan',
      storyContractSummary: {},
      chapterGoal: 'G',
      mandatoryBeats: [],
      forbiddenReveals: [],
      currentState: { activeThreads: [] },
      loadBearingFacts: [],
      relevantFacts: [],
      actRollups: [],
      voiceSheets: [],
      contextBudgetReport: { totalBudget: 4000, used: 0, perSection: {} },
      styleContractRef: 's',
      includedIds: [],
      excludedIds: [],
    }
    const manyTitles = Array.from({ length: 40 }, (_, index) => `Judul Bab ${index + 1}`)
    const context = buildContinuationContext({
      storyId: 'story-1',
      targetChapterNumber: 41,
      snapshot,
      packet,
      previousChapterRow: null,
      previousChoice: null,
      routeStateSummary: '',
      lockedEndingKey: null,
      previousTitles: manyTitles,
    })
    expect(context.previousTitles).toHaveLength(24)
    expect(context.previousTitles?.[0]).toBe('Judul Bab 17')
    expect(context.previousTitles?.at(-1)).toBe('Judul Bab 40')
  })
})
