import { describe, expect, it } from 'vitest'
import { parseChoiceBranch } from '@/lib/ai-gateway/schemas'
import { normalizeChoiceReaderText } from '@/lib/ai-gateway/gateway'
import {
  ACCEPTED_ACTION_VERB_EXAMPLES,
  INDO_ROOT_IMPERATIVES,
  isActionableLabelStart,
} from '@/lib/story-engine/choice-quality'

/**
 * Regression produksi 2026-08-01 (akar CHOICE_REPAIR_EXHAUSTED bab 1/2):
 * ACTION_PREFIX_PATTERN di schema tertinggal dari INDO_ROOT_IMPERATIVES
 * domain — label imperatif wajar ("Tarik Arga bersembunyi...") ditolak
 * CHOICE_NOT_ACTIONABLE → CHOICE_INVALID → PROVIDER_INVALID_RESPONSE untuk
 * semua kandidat → seluruh cabang pilihan gagal schema.
 *
 * Fixture sintetik minimal; tidak memuat payload produksi. Menjalankan
 * pipeline produksi penuh: normalizeChoiceReaderText → parseChoiceBranch.
 */
const CHOICE_PROMPT =
  'Para penagih utang yang ganas tiba-tiba mengepung saung. Apa yang harus dilakukan untuk menghadapi ancaman ini?'

function branchWithLabels(labels: [string, string]): unknown {
  return {
    choicePrompt: CHOICE_PROMPT,
    choices: [
      { id: 'chapter-1-choice-1', label: labels[0] },
      { id: 'chapter-1-choice-2', label: labels[1] },
    ],
    outcomes: [
      {
        choiceId: 'chapter-1-choice-1',
        consequence: ['Keselamatan Arga terjaga sementara rahasia kotak kayu tetap tersembunyi.'],
        nextChapterNumber: 2,
        isEnding: false,
        effect: { routeDeltas: { risk: 2 }, trustDeltas: {}, flagsSet: {}, evidenceAdded: [], endingBiasDeltas: {}, threadTouches: [] },
      },
      {
        choiceId: 'chapter-1-choice-2',
        consequence: ['Perhatian para penagih utang teralihkan pada dirimu sendiri.'],
        nextChapterNumber: 2,
        isEnding: false,
        effect: { routeDeltas: { truth: 1 }, trustDeltas: {}, flagsSet: {}, evidenceAdded: [], endingBiasDeltas: {}, threadTouches: [] },
      },
    ],
  }
}

function parse(label: string, secondLabel = 'Maju menemui para pria itu dan bernegosiasi') {
  return parseChoiceBranch(normalizeChoiceReaderText(branchWithLabels([label, secondLabel])))
}

describe('choice actionability regression (schema vs domain imperative set)', () => {
  it('accepts the exact production label that previously failed with CHOICE_NOT_ACTIONABLE', () => {
    const result = parse('Tarik Arga bersembunyi dan amankan kotak kayu rahasia')
    expect(result.ok).toBe(true)
  })

  it.each([
    'Tarik Arga masuk ke dalam saung',
    'Bawa Arga menjauh dari para penagih utang',
    'Dorong meja untuk menghalangi pintu saung',
    'Pegang tangan Arga dan tenangkan dia',
    'Amankan kotak kayu rahasia sebelum mereka datang',
    'Konfrontasi Raka langsung tentang keterlibatannya dalam misteri ini',
    'Minta Raka tetap menemani meski kamu ingin menghadapi sendiri',
    'Masukkan tangan ke dalam lubang untuk meraba apa yang tersembunyi',
    'Simpan surat dan pikirkan langkah selanjutnya dengan hati-hati',
    'Abaikan pesan dan diskusikan peringatan Raka lebih dulu',
    'Tunggu sampai pagi dan diskusikan dengan Raka sebelum membuka surat',
  ])('accepts root imperative "%s" without lowering actionability', (label) => {
    const result = parse(label)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('still rejects non-actionable labels with CHOICE_NOT_ACTIONABLE', () => {
    const result = parse('Pikirkan pilihan terbaik')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('still rejects generic fallback labels with CHOICE_GENERIC_OR_INTERNAL', () => {
    const result = parse('Lanjutkan')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('CHOICE_GENERIC_OR_INTERNAL')
    }
  })
})

/**
 * Regresi produksi 2026-08-29 (run final-a1 Bab 10, STOP_NON_RETRYABLE):
 * tiga panggilan provider beruntun menulis label imperatif valid yang ditolak
 * leksikon — "lindungi" bahkan dicontohkan choice-draft-v2.ts sendiri. Kelas
 * cacat sama dengan regresi 2026-08-01: leksikon/prefix tertinggal dari
 * imperatif Indonesia yang wajar (peN-/per- + root umum). Diperbaiki di
 * INDO_ROOT_IMPERATIVES + prefix peN-/per- di KEDUA validator.
 */
describe('choice actionability regression (Bab 10 final-a1 prompt-lexicon mismatch)', () => {
  it.each([
    'Lindungi dokumen rahasia itu di balik lantai papan berderit',
    'Pertahankan posisi di gerbang sampai Raka selesai menyalakan lampu',
    'Perhatikan bekas darah di lantai gudang sebelum melangkah lebih jauh',
    'Amati gerakan para penjaga dari celah menara jam yang rusak',
    'Bantu Sari membawa kotak kayu menuju lorong belakang gudang',
    'Batalkan penyelundupan malam ini dengan mematikan generator pelabuhan',
    'Peluk Adik untuk menenangkan tangisnya di ruang tunggu stasiun',
    'Datangi gudang tua dan temui kontak yang menyebut nama ayahmu',
  ])('accepts valid imperative previously rejected by the lexicon: "%s"', (label) => {
    const result = parse(label)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('still rejects mechanism and no-verb labels at schema level', () => {
    // Penolakan abstract feeling kini satu sumber dengan domain lewat
    // isActionableLabelStart — schema dan domain menolak kelas yang sama.
    const mechanism = parse('Set flag kebenaran untuk ending A malam ini')
    expect(mechanism.ok).toBe(false)
    if (!mechanism.ok) {
      expect(mechanism.errors.join('\n')).toContain('CHOICE_NOT_ACTIONABLE')
    }
    const noVerb = parse('Kesempatan terakhir untuk pulang sebelum gerbang ditutup')
    expect(noVerb.ok).toBe(false)
    if (!noVerb.ok) {
      expect(noVerb.errors.join('\n')).toContain('CHOICE_NOT_ACTIONABLE')
    }
    const abstractKan = parse('Bayangkan akhir yang bahagia bersama Raka kelak')
    expect(abstractKan.ok).toBe(false)
    if (!abstractKan.ok) {
      expect(abstractKan.errors.join('\n')).toContain('CHOICE_NOT_ACTIONABLE')
    }
    const nounI = parse('Kopi panas menunggu di meja dapur rumah tua')
    expect(nounI.ok).toBe(false)
    if (!nounI.ok) {
      expect(nounI.errors.join('\n')).toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  /**
   * Regresi produksi 2026-08-29 run final-a2 Bab 13: bentuk berakhiran
   * (-kan/-i) dan root telanjang di luar daftar ditolak beruntun oleh schema
   * hingga rantai repair habis. Pengenalan morfologis (-kan/-lah/-i +
   * blocklist nomina) menutup kelas ini tanpa melonggarkan bar kualitas.
   */
  it.each([
    'Kembalikan buku arsip itu ke rak besi yang berkarat',
    'Pindahkan kotak bukti ke gudang belakang sebelum maghrib',
    'Sampaikan pesan Raka kepada ibu kepala desa malam ini',
    'Ganti pakaian basah sebelum berangkat menyusuri terowongan',
    'Ubah rencana pelarian lewat pintu dapur yang terlupakan',
    'Cek keamanan gudang sebelum para penjaga berganti shift',
    'Bawalah surat ini kepada kepala desa sekarang juga',
  ])('accepts suffixed/bare-root imperatives previously rejected: "%s"', (label) => {
    const result = parse(label)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
    }
  })
})

/**
 * Kejadian ketiga kelas cacat yang sama (run custom-t4 Bab 1, model berbeda):
 * "Sorot senter ke jejak debu di lantai untuk cari arah aman" ditolak karena
 * root telanjang di luar leksikon. Root telanjang tidak punya tanda afiks
 * sehingga pengenal WAJIB memakai leksikon — dan leksikon selalu tertinggal
 * dari kelas terbuka. Penutup kelas karenanya dipindah ke sisi generator:
 * prompt draft dan catatan repair mengutip ACCEPTED_ACTION_VERB_EXAMPLES.
 *
 * Kontrak yang dikunci di sini: setiap verba yang DIMINTA dari model harus
 * lolos validator yang MENILAI model. Tanpa ini, prompt bisa kembali menyuruh
 * model memakai kata yang divonis tidak actionable — persis akar tiga regresi.
 */
describe('prompt/validator closure (ACCEPTED_ACTION_VERB_EXAMPLES)', () => {
  it.each([...ACCEPTED_ACTION_VERB_EXAMPLES])(
    'accepts prompted verb "%s" at schema level',
    (verb) => {
      const result = parse(`${verb} pintu gudang tua itu sebelum hujan reda`)
      expect(result.ok).toBe(true)
      if (!result.ok) {
        expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
      }
    },
  )

  it.each([...ACCEPTED_ACTION_VERB_EXAMPLES])(
    'accepts prompted verb "%s" at domain level',
    (verb) => {
      expect(isActionableLabelStart(`${verb} pintu gudang tua itu`)).toBe(true)
    },
  )

  it('accepts the bare-root label that failed run custom-t4', () => {
    const result = parse('Sorot senter ke jejak debu di lantai untuk cari arah aman')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('accepts the bare-root label that failed run custom-t7 (Bab 6)', () => {
    const result = parse('Rebut ponsel Raka dan periksa siapa yang menghubunginya')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
    }
  })

  it('accepts the bare-root labels that failed run custom-t8 (Bab 3)', () => {
    for (const label of [
      'Desak sosok itu untuk menuntaskan kalimatnya sekarang',
      'Desak sosok itu ceritakan isi brankas sebenarnya sekarang',
    ]) {
      const result = parse(label)
      expect(result.ok).toBe(true)
      if (!result.ok) {
        expect(result.errors.join('\n')).not.toContain('CHOICE_NOT_ACTIONABLE')
      }
    }
  })

  /**
   * Batch 2026-08-29 (run custom-t8): persediaan root imperatif transitif
   * frekuensi-tinggi ditambahkan sekaligus karena empat kejadian beruntun
   * membuktikan penambahan reaktif kata-per-kata tak akan selesai. Kontrak:
   * SEMUA kata batch diterima; pengurangan satu saja adalah regresi.
   */
  describe('high-frequency bare-root imperative batch (custom-t8)', () => {
    const BATCH = [
      'desak', 'paksa', 'hantam', 'tendang', 'gedor', 'gebuk', 'hajar', 'sikat',
      'cengkeram', 'copot', 'bongkar', 'geledah', 'ransak', 'lacak', 'buru',
      'curi', 'colong', 'rampok', 'sadap', 'salin', 'sebut', 'ajak', 'undang',
      'pujuk', 'bujuk', 'ancam', 'ugut', 'tegur', 'sambut', 'antar', 'jemput',
      'dukung', 'titip', 'kasih', 'jawab', 'kabur', 'sembunyi', 'susup', 'halau',
      'jerat', 'suntik', 'balut', 'lap', 'bilas', 'gosok', 'kupas', 'elus',
      'cubit', 'gigit', 'hisap', 'tiup', 'goncang', 'hentak', 'injak', 'pijak',
      'jongkok', 'rebah', 'hembus', 'panjat', 'tahan', 'tanggung', 'pikul',
      'lewat', 'tengok', 'lirik', 'pikir', 'kira', 'ukur', 'gores', 'ukir',
      'tempel', 'kait', 'tuntun', 'bimbing', 'ajar', 'latih', 'uji', 'tawan',
      'kurung',
    ]

    it.each(BATCH)('recognizes bare-root imperative "%s"', (verb) => {
      expect(INDO_ROOT_IMPERATIVES.has(verb)).toBe(true)
      expect(isActionableLabelStart(`${verb} gembok karat di pintu belakang gudang`)).toBe(true)
    })
  })

  it('keeps rejecting non-action labels after the prompt-side fix', () => {
    expect(isActionableLabelStart('Bayangkan akhir bahagia bersama Raka')).toBe(false)
    expect(isActionableLabelStart('Set flag kebenaran untuk ending A')).toBe(false)
    expect(isActionableLabelStart('Kesempatan terakhir sebelum gerbang ditutup')).toBe(false)
    expect(isActionableLabelStart('Kopi panas menunggu di meja dapur')).toBe(false)
    // Nomina deklaratif dengan verba di posisi kedua/ketiga — tetap ditolak
    // meski batch di atas menambah verba frekuensi-tinggi.
    expect(isActionableLabelStart('Hujan deras mengguyur atap seng gudang')).toBe(false)
    expect(isActionableLabelStart('Ketakutan itu menyelimuti seluruh ruangan')).toBe(false)
    expect(isActionableLabelStart('Rahasia lama tersimpan di balik lemari')).toBe(false)
    expect(isActionableLabelStart('Tahanan itu digiring keluar dari sel')).toBe(false)
  })
})
