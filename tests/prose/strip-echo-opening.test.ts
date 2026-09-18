import type { ContinuationContext } from '@lakoku/narrative-core'
import { describe, expect, it } from 'vitest'
import { evaluateWriterCompleteness } from '../../lib/ai-gateway/writer-completeness'
import { buildWriterPrompt } from '../../lib/prose/prompt-engine/build-writer-prompt'
import {
  normalizeForEchoComparison,
  stripEchoOpening,
} from '../../lib/prose/strip-echo-opening'
import type { PreProseChapterBrief } from '../../lib/story-engine/pre-prose-brief'

const previousEnding = [
  'Malam, Nara, ucap suara parau yang sangat aku kenal di luar jendela kamar.',
  'Aku memilih untuk tidak menjawab dan memeluk bantal lembut itu lebih erat.',
]

function makeParagraphs(count: number, seed: string): string[] {
  return Array.from({ length: count }, (_, index) => `${seed} kalimat nomor ${index} yang cukup panjang untuk dihitung sebagai kata penuh.`)
}

describe('stripEchoOpening', () => {
  it('memotong paragraf pembuka yang menyalin verbatim penutup bab sebelumnya', () => {
    const paragraphs = [
      previousEnding[0],
      'Adegan baru dimulai di dapur yang sama.',
    ]
    const result = stripEchoOpening(paragraphs, previousEnding)
    expect(result.strippedCount).toBe(1)
    expect(result.paragraphs).toEqual([paragraphs[1]])
  })

  it('memotong beberapa paragraf echo beruntun', () => {
    const paragraphs = [
      previousEnding[0],
      previousEnding[1],
      'Adegan baru dimulai.',
    ]
    const result = stripEchoOpening(paragraphs, previousEnding)
    expect(result.strippedCount).toBe(2)
    expect(result.paragraphs).toEqual(['Adegan baru dimulai.'])
  })

  it('kebal terhadap perbedaan tanda baca, kapitalisasi, dan spasi', () => {
    const paragraphs = [
      'MALAM, NARA, ucap suara parau yang sangat aku kenal di luar jendela kamar!',
      'Adegan baru dimulai.',
    ]
    const result = stripEchoOpening(paragraphs, previousEnding)
    expect(result.strippedCount).toBe(1)
  })

  it('tidak memotong paragraf pembuka yang hanya mirip tema (kata berbeda)', () => {
    const paragraphs = [
      'Suara parau itu kembali terngiang di telingaku saat fajar datang.',
      'Adegan baru dimulai.',
    ]
    const result = stripEchoOpening(paragraphs, previousEnding)
    expect(result.strippedCount).toBe(0)
    expect(result.paragraphs).toEqual(paragraphs)
  })

  it('tidak memotong apa pun bila tidak ada penutup bab sebelumnya (bab 1)', () => {
    const paragraphs = ['Pembuka cerita.', 'Paragraf kedua.']
    const result = stripEchoOpening(paragraphs, [])
    expect(result.strippedCount).toBe(0)
    expect(result.paragraphs).toEqual(paragraphs)
  })

  it('tidak pernah memotong seluruh prosa (minimal 1 paragraf tersisa)', () => {
    const result = stripEchoOpening([previousEnding[0]], previousEnding)
    expect(result.paragraphs).toEqual([previousEnding[0]])
    expect(result.strippedCount).toBe(0)
  })

  it('normalizeForEchoComparison stabil terhadap tanda baca dan spasi', () => {
    expect(normalizeForEchoComparison('Halo,  Dunia!')).toBe('halo dunia')
  })
})

describe('integrasi strip echo dengan evaluasi completeness', () => {

  it('prosa yang menggelembung oleh echo melewati batas; setelah strip lolos', () => {
    // Penutup bab sebelumnya: 2 paragraf panjang (~142 kata). Penulis menyalin
    // keduanya verbatim di pembuka + 58 paragraf filler (58 x 16 = 928 kata)
    // = ~1070 kata (di atas hardMax 1000). Setelah strip: 928 (dalam 800-1000).
    const longEchoEnding = [
      `${'kata '.repeat(70)}selesai.`,
      `${'lanjutan '.repeat(70)}tuntas.`,
    ]
    const filler = makeParagraphs(58, 'Isi adegan bab baru ini.')
    const raw = [...longEchoEnding, ...filler]
    const rawWords = raw.join(' ').split(/\s+/).length
    expect(rawWords).toBeGreaterThan(1000)

    const stripped = stripEchoOpening(raw, longEchoEnding)
    const findings = evaluateWriterCompleteness({
      finishReason: 'stop',
      hasExplicitTitle: true,
      title: 'Judul Baru',
      paragraphs: stripped.paragraphs,
    })
    expect(stripped.strippedCount).toBe(2)
    expect(findings).toEqual([])
  })
})

describe('larangan echo di prompt writer', () => {
  const brief: PreProseChapterBrief = {
    storyId: 'story-1',
    chapterNumber: 2,
    phase: 'rising',
    lockedEndingKey: null,
    lockedEndingClosure: [],
    chapterGoal: 'Hadapi dampak konfrontasi',
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

  const continuation: ContinuationContext = {
    storyId: 'story-1',
    targetChapterNumber: 2,
    previousChapter: {
      number: 1,
      title: 'Bab Satu',
      endingParagraphs: previousEnding,
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
  }

  it('prompt memuat larangan echo eksplisit terhadap penutup bab sebelumnya', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 2,
      continuation,
      brief,
    })
    expect(prompt.user).toContain('DILARANG mengulangnya (verbatim maupun nyaris verbatim)')
  })

  it('bab 1 tanpa penutup bab sebelumnya tetap membangun prompt tanpa crash', () => {
    const prompt = buildWriterPrompt({
      chapterNumber: 1,
      continuation: { ...continuation, previousChapter: null },
      brief: { ...brief, chapterNumber: 1 },
    })
    expect(prompt.user).not.toContain('PENUTUP BAB SEBELUMNYA')
  })
})
