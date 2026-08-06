import { describe, expect, it } from 'vitest'
import { buildWriterPrompt } from '../../lib/prose/prompt-engine/build-writer-prompt'
import type { ContinuationContext } from '@lakoku/narrative-core'

describe('buildWriterPrompt - Prompt Hierarchy & Continuation Context', () => {
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

  it('menyusun 5 lapis hierarki sesuai urutan kontrak', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      characterNames: ['Nadia', 'Raka'],
      goal: 'Hadapi dampak konfrontasi',
      continuation: mockContinuation,
    })

    const user = prompt.user

    const posL1 = user.indexOf('=== [1] INVARIAN CANON')
    const posL2 = user.indexOf('=== [2] RIWAYAT PEMBACA')
    const posL3 = user.indexOf('=== [3] KEADAAN CERITA')
    const posL4 = user.indexOf('=== [4] SASARAN BAB')
    const posL5 = user.indexOf('=== [5] KERANGKA, RITME & FORMAT OUTPUT')

    expect(posL1).toBeGreaterThan(-1)
    expect(posL2).toBeGreaterThan(posL1)
    expect(posL3).toBeGreaterThan(posL2)
    expect(posL4).toBeGreaterThan(posL3)
    expect(posL5).toBeGreaterThan(posL4)

    expect(user).toContain('RAHASIA DILARANG UNTUK DIKONTAMINASI/DIUNGKAP: Secret X')
    expect(user).toContain('Paragraf 2 Nadia menatap Raka.')
    expect(user).toContain('Pilihan Pembaca di Bab 1 [choice-1]: "Konfrontasi Raka"')
  })

  it('tidak memangkas excerpt atau choice saat memangkas budget cerita', () => {
    const hugeTimeline = Array.from({ length: 100 }, (_, i) => ({
      chapterNumber: 1,
      ordinal: i + 1,
      description: `Timeline event sangat panjang ke-${i} `.repeat(10),
    }))
    const hugeContinuation: ContinuationContext = {
      ...mockContinuation,
      recentTimeline: hugeTimeline,
    }

    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      characterNames: ['Nadia', 'Raka'],
      continuation: hugeContinuation,
    })

    expect(prompt.user).toContain('Paragraf 2 Nadia menatap Raka.')
    expect(prompt.user).toContain('Pilihan Pembaca di Bab 1 [choice-1]: "Konfrontasi Raka"')
  })

  it('menuliskan isi fakta & kronologi, bukan objek yang ter-stringify', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      characterNames: ['Nadia', 'Raka'],
      continuation: mockContinuation,
    })

    expect(prompt.user).not.toContain('[object Object]')
    expect(prompt.user).toContain('Fakta 1: Lukisan hilang')
    expect(prompt.user).toContain('Nadia masuk galeri')
  })

  it('menyatakan konsekuensi pilihan sebagai mengikat, bukan saran', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      characterNames: ['Nadia', 'Raka'],
      continuation: mockContinuation,
    })

    expect(prompt.user).toContain('KONSEKUENSI DI ATAS SUDAH TERJADI DAN MENGIKAT')
    expect(prompt.user).toContain('DILARANG membatalkan, menunda, atau membalik pilihan itu')
  })
})
