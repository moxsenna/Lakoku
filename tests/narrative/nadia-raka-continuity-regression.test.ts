import { describe, expect, it } from 'vitest'
import { runContinuityChecks } from '../../lib/narrative/continuity-checks'
import type { ContinuationContext } from '@lakoku/narrative-core'

describe('Nadia/Raka Continuity Discontinuity Regression', () => {
  const mockSnapshot = {
    storyId: 'story-nadia-raka',
    characters: [
      { id: 'nadia', name: 'Nadia' },
      { id: 'raka', name: 'Raka' },
    ],
  } as any

  const nadiaRakaContinuation: ContinuationContext = {
    storyId: 'story-nadia-raka',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Galeri Seni Malam Hari',
      endingParagraphs: [
        'Nadia berdiri kaku di tengah ruang galeri seni.',
        'Ia menatap lukisan yang rusak dan Raka yang terpojok di dinding.',
        'Keputusan harus diambil sekarang juga.',
      ],
    },
    previousChoice: {
      chapterNumber: 1,
      choiceId: 'choice-hadapi-raka',
      label: 'Konfrontasi Raka tentang lukisan galeri',
      consequence: ['Nadia menuduh Raka mencuri lukisan', 'Raka terdesak'],
      effectSummary: { flagsSet: ['tension_high'] },
      createdAt: new Date().toISOString(),
    },
    routeStateSummary: 'Rute konflik galeri',
    openThreads: [],
    anchorFacts: [{ id: 'f1', statement: 'Lukisan galeri rusak', establishedChapter: 1, loadBearing: true }],
    recentTimeline: [{ chapterNumber: 1, ordinal: 1, description: 'Nadia menemui Raka di galeri' }],
    mustNotReveal: [],
  }

  it('mendeteksi Bab 2 buram (reset ke Sari di kedai kopi) sebagai MAJOR jangkar hilang', () => {
    const badChapter2Draft = {
      chapterNumber: 2,
      paragraphs: [
        'Pagi harinya di Kedai Kopi Kenangan, Sari duduk sendirian sambil menyeruput lattenya.',
        'Suasana kedai kopi sangat hangat dan ramai oleh para pengunjung.',
        'Sari memikirkan rencana liburan akhir pekan ke pantai.',
      ],
    }

    const findings = runContinuityChecks(mockSnapshot, badChapter2Draft, nadiaRakaContinuation)
    const majorFinding = findings.find((f) => f.code === 'CONT_MISSING_CONTINUITY_ANCHOR')

    expect(majorFinding).toBeDefined()
    expect(majorFinding?.severity).toBe('MAJOR')
  })

  it('menerima Bab 2 koheren yang melanjutkan konfrontasi Nadia/Raka di galeri', () => {
    const goodChapter2Draft = {
      chapterNumber: 2,
      paragraphs: [
        'Raka melangkah mundur saat konfrontasi dengan Nadia di galeri semakin memanas.',
        'Tuduhan tentang lukisan galeri seni yang hilang terpancar jelas dari mata Nadia.',
        'Malam itu di galeri seni, tidak ada tempat bagi Raka untuk melarikan diri.',
      ],
    }

    const findings = runContinuityChecks(mockSnapshot, goodChapter2Draft, nadiaRakaContinuation)
    const majorFinding = findings.find((f) => f.code === 'CONT_MISSING_CONTINUITY_ANCHOR')

    expect(majorFinding).toBeUndefined()
  })
})
