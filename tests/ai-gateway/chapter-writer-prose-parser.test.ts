import { describe, it, expect } from 'vitest'
import { parseChapterWriterProse } from '@/lib/ai-gateway/chapter-writer-contract'
import { countParagraphWords } from '@/lib/prose/clamp-chapter-prose'

describe('parseChapterWriterProse with mobile paragraph splitter', () => {
  it('splits bulky narrative paragraphs into chunks of at most 2 sentences', () => {
    const raw = `JUDUL: Langkah di Lorong Gelap

Malam itu lorong rumah sakit terasa begitu sunyi dan dingin. Lampu neon di langit-langit berkedip pelan menimbulkan bayangan aneh di lantai keramik. Langkah kaki seorang perawat terdengar samar dari ujung koridor lain. Bau karbol menyengat hidung setiap kali angin berhembus lewat ventilasi kecil. Jam dinding menunjukkan pukul dua dini hari tanpa ada tanda-tanda pasien baru datang.

Suara gesekan roda brankar memecah keheningan sesaat. Seorang dokter jaga berjalan tergesa menuju ruang gawat darurat.`

    const result = parseChapterWriterProse(raw)

    expect(result.title).toBe('Langkah di Lorong Gelap')
    expect(result.hasExplicitTitle).toBe(true)

    // Bulky paragraph had 5 sentences, must be split into multiple chunks
    expect(result.paragraphs.length).toBeGreaterThan(2)

    // Each paragraph chunk must have at most 2 sentences
    for (const paragraph of result.paragraphs) {
      const sentences = paragraph.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g) || []
      expect(sentences.length).toBeLessThanOrEqual(2)
    }
  })

  it('isolates embedded dialogue lines into standalone paragraphs', () => {
    const raw = `JUDUL: Pertemuan Rahasia

Rian mendekati meja kasir dengan ragu-ragu. "Apakah kamu melihat amplop hitam itu?" tanyanya berbisik. Kasir tersebut menggeleng cepat tanpa menatap matanya.`

    const result = parseChapterWriterProse(raw)

    expect(result.paragraphs).toEqual([
      'Rian mendekati meja kasir dengan ragu-ragu.',
      '"Apakah kamu melihat amplop hitam itu?" tanyanya berbisik.',
      'Kasir tersebut menggeleng cepat tanpa menatap matanya.',
    ])
  })

  it('preserves exact word count with zero word loss', () => {
    const raw = `JUDUL: Rahasia Kota Tua

Kabut tebal menyelimuti pelabuhan sejak senja meredup. Burung camar berputar lambat di atas mercusuar yang mulai berkarat. Angin asin menusuk kulit para nelayan yang sedang membetulkan jaring sobek.

"Kita tidak boleh melaut malam ini," kata Pak Joko tegas. Ombak di dermaga semakin tinggi membentur dinding batu karang. "Badai besar sedang mendekat dari arah selatan."

Semua orang terdiam dan saling bertukar pandang penuh kecemasan.`

    const result = parseChapterWriterProse(raw)

    const rawContentWords = countParagraphWords([
      'Kabut tebal menyelimuti pelabuhan sejak senja meredup. Burung camar berputar lambat di atas mercusuar yang mulai berkarat. Angin asin menusuk kulit para nelayan yang sedang membetulkan jaring sobek.',
      '"Kita tidak boleh melaut malam ini," kata Pak Joko tegas. Ombak di dermaga semakin tinggi membentur dinding batu karang. "Badai besar sedang mendekat dari arah selatan."',
      'Semua orang terdiam dan saling bertukar pandang penuh kecemasan.',
    ])

    expect(countParagraphWords(result.paragraphs)).toBe(rawContentWords)
  })

  it('preserves implicit title format and preserves short paragraphs intact', () => {
    const raw = `Bayangan Senja

Dua burung terbang melintasi langit senja. Mentari perlahan tenggelam di balik bukit.

"Waktunya pulang," bisik Ardi pelan.`

    const result = parseChapterWriterProse(raw)

    expect(result.title).toBe('Bayangan Senja')
    expect(result.hasExplicitTitle).toBe(false)
    expect(result.paragraphs).toEqual([
      'Dua burung terbang melintasi langit senja. Mentari perlahan tenggelam di balik bukit.',
      '"Waktunya pulang," bisik Ardi pelan.',
    ])
  })

  it('throws when text is empty', () => {
    expect(() => parseChapterWriterProse('')).toThrow('gateway-provider: LLM mengembalikan teks kosong.')
    expect(() => parseChapterWriterProse('   \n\n  ')).toThrow('gateway-provider: LLM mengembalikan teks kosong.')
  })
})
