import { describe, it, expect } from 'vitest'
import { splitParagraphsForMobile } from '@/lib/prose/mobile-paragraph-splitter'
import { countParagraphWords } from '@/lib/prose/clamp-chapter-prose'

describe('mobile-paragraph-splitter', () => {
  it('splits long narrative paragraphs exceeding 2 sentences', () => {
    const input = [
      'Kalimat pertama berjalan di sini. Kalimat kedua menyusul dengan cepat. Kalimat ketiga mulai membuat paragraf terlalu padat. Kalimat keempat harusnya berada di blok baru. Kalimat kelima menutup adegan.',
    ]
    const output = splitParagraphsForMobile(input)
    expect(output.length).toBeGreaterThan(1)
    // Every block should have at most 2 sentences
    for (const block of output) {
      const sentences = block.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g) || []
      expect(sentences.length).toBeLessThanOrEqual(2)
    }
  })

  it('keeps short paragraphs (<= 2 sentences) intact', () => {
    const input = [
      'Hujan turun deras di luar jendela. Udara dingin merayap masuk.',
      '"Kamu yakin mau pergi sekarang?" tanya Bapak.',
    ]
    const output = splitParagraphsForMobile(input)
    expect(output).toEqual(input)
  })

  it('isolates dialogue lines stuck in narrative', () => {
    const input = [
      'Aku menatap pintu yang terbuka perlahan. "Siapa di sana?" tanyaku gemetar. Langkah kaki terdengar mendekat.',
    ]
    const output = splitParagraphsForMobile(input)
    expect(output.length).toBe(3)
    expect(output[0]).toBe('Aku menatap pintu yang terbuka perlahan.')
    expect(output[1]).toBe('"Siapa di sana?" tanyaku gemetar.')
    expect(output[2]).toBe('Langkah kaki terdengar mendekat.')
  })

  it('preserves exact word count with zero word loss', () => {
    const input = [
      'Paragraf ini cukup panjang dan memuat banyak sekali informasi penting. Kalimat kedua menambahkan rincian yang tak kalah berbobot. Kalimat ketiga mengunci perhatian pembaca pada detail meja kerja. Kalimat keempat menutup pengamatan dengan helaan napas panjang.',
      '"Bapak sudah menunggu sejak tadi," ucap Nadia lirih. Tatapannya tertuju pada amplop cokelat di sudut ruangan. "Sebaiknya kamu buka sekarang."',
    ]
    const output = splitParagraphsForMobile(input)
    expect(countParagraphWords(output)).toBe(countParagraphWords(input))
  })

  it('handles empty input and whitespace-only paragraphs', () => {
    expect(splitParagraphsForMobile([])).toEqual([])
    expect(splitParagraphsForMobile(['   ', ''])).toEqual([])
  })

  it('handles consecutive dialogue sentences separately', () => {
    const input = ['"Siapa di sana?" bisikku. "Ini aku," jawabnya tenang.']
    const output = splitParagraphsForMobile(input)
    expect(output).toEqual(['"Siapa di sana?" bisikku.', '"Ini aku," jawabnya tenang.'])
    expect(countParagraphWords(output)).toBe(countParagraphWords(input))
  })
})
