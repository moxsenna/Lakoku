import { describe, expect, it } from 'vitest'
import { assertCatalogChapterConsumerSafe } from '../../lib/catalog/reader-safe-guard'

function cleanChapter() {
  return {
    title: 'Rumah Kosong di Ujung Gang',
    paragraphs: [
      'Hujan turun sejak sore. Langkahku terhenti di depan pintu yang setengah terbuka.',
      'Aku menarik napas, meraba saklar gelap, dan melangkah masuk.',
    ],
    choicePrompt: 'Apa yang akan kamu lakukan?',
    choiceLabels: ['Masuk lewat pintu depan', 'Menyusur gang ke belakang'],
    consequences: [
      'Lantai kayu berderit di bawah kakimu.',
      'Udara belakang terbau tanah basah.',
    ],
  }
}

describe('assertCatalogChapterConsumerSafe (audit M-A2)', () => {
  it('lolos untuk bab bersih tanpa istilah internal', () => {
    expect(() => assertCatalogChapterConsumerSafe(cleanChapter())).not.toThrow()
  })

  it('menolak prosa yang membocorkan istilah internal (fail-closed)', () => {
    const leaked = {
      ...cleanChapter(),
      paragraphs: ['Ia membuka laptop dan mengetik system prompt yang panjang.'],
    }
    expect(() => assertCatalogChapterConsumerSafe(leaked)).toThrowError(/bocor/)
  })

  it('menolak judul yang membocorkan nama internal', () => {
    const leaked = { ...cleanChapter(), title: 'Pertemuan dengan Narraza' }
    expect(() => assertCatalogChapterConsumerSafe(leaked)).toThrowError(/bocor/)
  })

  it('menolak label pilihan yang membocorkan istilah model', () => {
    const leaked = { ...cleanChapter(), choiceLabels: ['Tanya ke Claude tentang jalan keluar'] }
    expect(() => assertCatalogChapterConsumerSafe(leaked)).toThrowError(/bocor/)
  })

  it('menolak konsekuensi yang membocorkan istilah prompt', () => {
    const leaked = { ...cleanChapter(), consequences: ['Ia membisikkan system prompt ke telingamu.'] }
    expect(() => assertCatalogChapterConsumerSafe(leaked)).toThrowError(/bocor/)
  })

  it('menolak choicePrompt yang bocor meski prosa bersih', () => {
    const leaked = { ...cleanChapter(), choicePrompt: 'Pilih token yang kamu percaya.' }
    expect(() => assertCatalogChapterConsumerSafe(leaked)).toThrowError(/bocor/)
  })
})
