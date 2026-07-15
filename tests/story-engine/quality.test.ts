import { describe, expect, it } from 'vitest'
import {
  validateChapterQuality,
  validateChoiceQuality,
} from '@/lib/story-engine/quality'

function words(count: number, word = 'langkah'): string {
  return Array.from({ length: count }, () => word).join(' ')
}

function chapterWithWordCount(count: number) {
  const opening = 'Raka merebut surat itu dari tangan Sari sebelum polisi masuk ke gudang.'
  const dialogue = [
    '"Kembalikan surat itu," kata Sari.',
    '"Tidak sebelum kamu menjawab," balas Raka.',
    '"Polisi sudah di depan pintu," bisik Sari.',
  ]
  const hook = 'Kemudian pintu gudang terbuka, dan dalang yang mereka cari berdiri di sana.'
  const fixed = [opening, ...dialogue, hook]
  const fixedCount = fixed.join(' ').split(/\s+/u).length
  return {
    title: 'Surat di Gudang',
    genre: 'Drama Misteri',
    paragraphs: [opening, ...dialogue, words(count - fixedCount), hook],
  }
}

function codes(findings: Array<{ code: string }>): string[] {
  return findings.map((finding) => finding.code)
}

describe('validateChapterQuality', () => {
  it.each([
    [799, true],
    [800, false],
    [1000, false],
    [1001, true],
  ])('enforces inclusive 800..1000 word boundary at %i', (count, rejected) => {
    const result = validateChapterQuality(chapterWithWordCount(count))
    expect(codes(result).includes('WORD_COUNT_OUT_OF_RANGE')).toBe(rejected)
  })

  it('finds normalized duplicate long paragraphs', () => {
    const duplicate = `Raka membuka lemari besi dan menemukan surat yang disembunyikan keluarganya. ${words(45, 'bukti')}`
    const result = validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [duplicate, '  RAKA   membuka lemari besi dan menemukan surat yang disembunyikan keluarganya. ' + words(45, 'bukti')],
    })

    expect(codes(result)).toContain('DUPLICATE_LONG_PARAGRAPH')
  })

  it('allows one abstract paragraph but rejects consecutive abstract paragraphs', () => {
    const abstractOne = 'Harapan, makna, perasaan, keyakinan, kesadaran, dan kehidupan memenuhi pikirannya tanpa bentuk.'
    const abstractTwo = 'Takdir, kebebasan, kebenaran, keraguan, kenangan, dan kemungkinan berputar dalam batinnya.'

    expect(codes(validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        'Raka menendang pintu ketika pencuri membawa surat itu pergi.',
        abstractOne,
        'Raka mengejar pencuri melewati pasar dan menjatuhkan keranjang buah.',
        'Sosok bertopeng menunggu Raka di ujung gang.',
      ],
    }))).not.toContain('CONSECUTIVE_ABSTRACT_PARAGRAPHS')

    expect(codes(validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        'Raka menendang pintu ketika pencuri membawa surat itu pergi.',
        abstractOne,
        abstractTwo,
        'Sosok bertopeng menunggu Raka di ujung gang.',
      ],
    }))).toContain('CONSECUTIVE_ABSTRACT_PARAGRAPHS')
  })

  it('requires three dialogue lines for drama and mystery without depending on dash punctuation', () => {
    const noDialogue = validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        'Raka mengejar pencuri yang merebut surat ibunya.',
        words(780),
        'Sosok bertopeng menunggu Raka di ujung gang.',
      ],
    })
    const dialogue = validateChapterQuality(chapterWithWordCount(800))

    expect(codes(noDialogue)).toContain('INSUFFICIENT_DIALOGUE')
    expect(codes(dialogue)).not.toContain('INSUFFICIENT_DIALOGUE')
  })

  it('requires concrete conflict in first 150 words', () => {
    const result = validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        `${words(155, 'kenangan')} terasa lembut dalam pikirannya.`,
        'Raka lalu merebut surat dari pencuri di gudang.',
        words(620),
        'Suara tembakan memutus langkah Raka.',
      ],
    })

    expect(codes(result)).toContain('MISSING_OPENING_CONFLICT')
  })

  it('flags oversized mobile paragraphs and backstory info dumps', () => {
    const result = validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        'Raka merebut surat itu sebelum pencuri melarikan diri.',
        `Dulu, ketika kecil, Raka selalu mengingat masa lalu keluarganya. ${words(190, 'sejarah')}`,
        'Sosok bertopeng menunggu di luar rumah.',
      ],
    })

    expect(codes(result)).toEqual(expect.arrayContaining([
      'PARAGRAPH_TOO_LONG',
      'INFO_DUMP_BACKSTORY',
    ]))
  })

  it('requires a chapter hook and accepts concrete suspense without special punctuation', () => {
    const flat = validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        'Raka merebut surat itu sebelum pencuri melarikan diri.',
        words(780),
        'Raka pulang dan tidur dengan tenang.',
      ],
    })
    const hooked = validateChapterQuality(chapterWithWordCount(800))

    expect(codes(flat)).toContain('MISSING_CHAPTER_HOOK')
    expect(codes(hooked)).not.toContain('MISSING_CHAPTER_HOOK')
  })

  it.each([
    'PROMPT rahasia muncul di dinding.',
    'Token sistem tertulis di surat.',
    'MODEL memilih akhir cerita.',
    'Nama provider terlihat oleh Raka.',
    'LLM mengatur nasib mereka.',
    'Route truth meningkat.',
  ])('blocks internal language leak: %s', (leak) => {
    const result = validateChapterQuality({
      ...chapterWithWordCount(800),
      paragraphs: [
        'Raka merebut surat itu dari pencuri.',
        words(780),
        `${leak} Sosok asing menunggu di pintu.`,
      ],
    })

    expect(codes(result)).toContain('INTERNAL_LANGUAGE_LEAK')
  })

  it('returns findings instead of throwing for empty content', () => {
    expect(() => validateChapterQuality({ title: '', paragraphs: [], genre: '' })).not.toThrow()
    expect(codes(validateChapterQuality({ title: '', paragraphs: [], genre: '' }))).toEqual(
      expect.arrayContaining(['WORD_COUNT_OUT_OF_RANGE', 'MISSING_OPENING_CONFLICT', 'MISSING_CHAPTER_HOOK']),
    )
  })
})

describe('validateChoiceQuality', () => {
  const lastParagraphs = [
    'Raka menemukan pintu gudang terkunci.',
    'Dari balik pintu, Sari memanggil namanya dan meminta pertolongan.',
    'Penjaga berlari mendekat sambil mengangkat tongkat.',
  ]

  it.each([
    'Lanjutkan',
    'Pilihan A',
    'Apa yang harus dilakukan?',
    'Naikkan route truth',
    'Pakai token rahasia',
  ])('rejects generic or internal label: %s', (label) => {
    const result = validateChoiceQuality({ labels: [label], lastParagraphs })
    expect(codes(result)).toContain('CHOICE_GENERIC_OR_INTERNAL')
  })

  it('accepts concrete action labels related to last three paragraphs', () => {
    const result = validateChoiceQuality({
      labels: ['Buka pintu gudang', 'Hadang penjaga bertongkat'],
      lastParagraphs,
    })

    expect(result).toEqual([])
  })

  it('rejects non-action and unrelated concrete labels', () => {
    expect(codes(validateChoiceQuality({
      labels: ['Pintu yang sunyi'],
      lastParagraphs,
    }))).toContain('CHOICE_NOT_ACTIONABLE')

    expect(codes(validateChoiceQuality({
      labels: ['Beli bunga di pasar'],
      lastParagraphs,
    }))).toContain('CHOICE_UNRELATED')
  })

  it('uses only last three paragraphs for relevance', () => {
    const result = validateChoiceQuality({
      labels: ['Ambil surat lama'],
      lastParagraphs: [
        'Raka melihat surat lama di meja.',
        'Ia meninggalkan rumah.',
        'Ia tiba di gudang.',
        'Sari terjebak di balik pintu.',
      ],
    })

    expect(codes(result)).toContain('CHOICE_UNRELATED')
  })

  it('returns findings instead of throwing for empty labels', () => {
    expect(() => validateChoiceQuality({ labels: [], lastParagraphs: [] })).not.toThrow()
    expect(codes(validateChoiceQuality({ labels: [], lastParagraphs: [] }))).toContain('CHOICE_COUNT_INVALID')
  })
})
