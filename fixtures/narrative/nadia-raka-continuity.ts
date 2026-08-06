/**
 * Fixture kegagalan kontinuitas Nadia/Raka.
 *
 * Ini fixture NYATA yang dipakai bersama oleh:
 *   - tests/narrative/nadia-raka-continuity-regression.test.ts (offline, deterministik)
 *   - scripts/continuity-ab-smoke.ts (real-model A/B)
 *
 * Bab 1 berakhir pada konfrontasi di galeri. Bab 2 yang buruk (BAD_CHAPTER_2)
 * adalah bentuk kegagalan yang ditemukan di produksi: cerita "reset" ke tokoh
 * dan lokasi lain tanpa jembatan apa pun. Fixture ini sengaja tidak
 * disederhanakan menjadi ending satu baris agar A/B real-model diuji pada
 * konteks yang sama beratnya dengan produksi.
 */

import type { CanonSnapshot, ChapterBlueprint } from '@/lib/narrative/types'
import type {
  ContinuationActRollup,
  ContinuationContext,
} from '@/lib/narrative/continuation-context'
import type { PreProseChapterBrief } from '@/lib/story-engine/pre-prose-brief'

export const NADIA_RAKA_STORY_ID = 'story-nadia-raka'

/**
 * Ending Bab 1 verbatim — jangkar yang wajib disambung Bab 2.
 *
 * POV orang pertama "aku" (Nadia), sama dengan konvensi output writer
 * produksi. Excerpt orang ketiga membuat model memperlakukan Nadia sebagai
 * tokoh lain di samping narator, jadi fixture sengaja mengikuti bentuk nyata.
 */
export const NADIA_RAKA_CHAPTER_1_ENDING: string[] = [
  'Aku berdiri kaku di tengah ruang galeri seni. Lampu sorot yang seharusnya menerangi lukisan kini hanya menyisakan bingkai kosong dan serpihan kaca di lantai kayu.',
  'Raka terpojok di dinding sebelah barat, punggungnya menempel pada pelat nama pameran. Ia tidak membantah, tidak juga mengaku. Hanya napasnya yang terdengar terlalu cepat untuk seseorang yang mengaku tidak bersalah.',
  '"Aku tahu kau yang terakhir keluar malam itu," kataku. Suaraku rendah, tapi ruang galeri yang kosong membuat kalimat itu memantul dua kali.',
  'Ponselku bergetar di saku. Satu pesan dari pengacara galeri: berkas laporan sudah siap diajukan besok pagi, tinggal menunggu keputusanku. Di layar yang sama, notifikasi lain masuk — alamat gudang lama di pinggir kota, dikirim tanpa nama pengirim.',
  'Dua jalan terbuka di depanku, dan galeri itu tidak akan menunggu sampai pagi. Keputusan harus diambil sekarang juga.',
]

export function nadiaRakaSnapshot(storyId: string = NADIA_RAKA_STORY_ID): CanonSnapshot {
  return {
    storyId,
    characters: [
      { id: 'nadia', storyId, canonicalName: 'Nadia', role: 'Protagonis', motivation: 'Mencari kebenaran', introducedChapter: 1, status: 'ALIVE' },
      { id: 'raka', storyId, canonicalName: 'Raka', role: 'Antagonis', motivation: 'Menyembunyikan rahasia', introducedChapter: 1, status: 'ALIVE' },
    ],
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
}

export const NADIA_RAKA_BLUEPRINT: ChapterBlueprint = {
  chapterNumber: 2,
  phase: 'Fase 2',
  chapterGoal: 'Konfrontasi atau Pelarian',
  mandatoryBeats: ['Lanjutkan konflik yang belum selesai di galeri seni'],
  introducesCharacters: [],
  forbiddenReveals: [],
  allowedStateDelta: {},
  version: 1,
  reconciledFromVersion: null,
  reconciliationReason: null,
}

const SHARED_CONTINUATION = {
  storyId: NADIA_RAKA_STORY_ID,
  targetChapterNumber: 2,
  previousChapter: {
    number: 1,
    title: 'Galeri Seni Malam Hari',
    endingParagraphs: NADIA_RAKA_CHAPTER_1_ENDING,
  },
  openThreads: [],
  anchorFacts: [
    { id: 'f1', statement: 'Lukisan utama galeri hilang dan bingkainya rusak', establishedChapter: 1, loadBearing: true },
    { id: 'f2', statement: 'Raka adalah orang terakhir yang meninggalkan galeri malam itu', establishedChapter: 1, loadBearing: true },
  ],
  recentTimeline: [
    { chapterNumber: 1, ordinal: 1, description: 'Nadia mengonfrontasi Raka di galeri soal lukisan yang hilang' },
  ],
  mustNotReveal: [],
  storyAnchors: null,
  actRollups: [] as ContinuationActRollup[],
  lockedEndingKey: null,
} as const

/**
 * Konteks dasar regression test: pilihan "konfrontasi Raka" yang menghasilkan
 * Bab 2 buruk di produksi.
 */
export const NADIA_RAKA_CONTINUATION: ContinuationContext = {
  ...SHARED_CONTINUATION,
  previousChapter: { ...SHARED_CONTINUATION.previousChapter, endingParagraphs: [...NADIA_RAKA_CHAPTER_1_ENDING] },
  previousChoice: {
    chapterNumber: 1,
    choiceId: 'choice-hadapi-raka',
    label: 'Konfrontasi Raka tentang lukisan galeri',
    consequence: ['Nadia menuduh Raka mencuri lukisan', 'Raka terdesak'],
    effectSummary: { flagsSet: ['tension_high'] },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  routeStateSummary: 'Rute konflik galeri',
  openThreads: [],
  anchorFacts: [...SHARED_CONTINUATION.anchorFacts],
  recentTimeline: [...SHARED_CONTINUATION.recentTimeline],
  mustNotReveal: [],
}

/** Cabang A — pilihan menempuh jalur hukum. */
export const NADIA_RAKA_CONTINUATION_A: ContinuationContext = {
  ...NADIA_RAKA_CONTINUATION,
  previousChoice: {
    chapterNumber: 1,
    choiceId: 'choice-a-pengadilan',
    label: 'Tahan Raka di galeri dan ajukan laporan ke pengadilan besok pagi',
    consequence: [
      'Nadia menolak menyelesaikan urusan ini secara pribadi',
      'Laporan resmi diajukan dan Raka terikat proses hukum',
    ],
    effectSummary: { flagsSet: ['court_path'] },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  routeStateSummary: 'Rute pengadilan: konflik berpindah ke ranah hukum, Raka tidak bisa menghilang',
}

/** Cabang B — pilihan meninggalkan Raka dan mengejar alamat gudang. */
export const NADIA_RAKA_CONTINUATION_B: ContinuationContext = {
  ...NADIA_RAKA_CONTINUATION,
  previousChoice: {
    chapterNumber: 1,
    choiceId: 'choice-b-gudang',
    label: 'Tinggalkan Raka di galeri dan susul alamat gudang malam itu juga',
    consequence: [
      'Nadia meninggalkan galeri tanpa menuntaskan konfrontasi',
      'Raka dibiarkan bebas dan Nadia mengejar bukti sendirian di gudang lama',
    ],
    effectSummary: { flagsSet: ['secret_proof_path'] },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  routeStateSummary: 'Rute bukti: konfrontasi ditunda, Nadia bergerak sendiri ke gudang',
}

function briefFor(continuation: ContinuationContext, chapterGoal: string): PreProseChapterBrief {
  return {
    storyId: continuation.storyId,
    chapterNumber: 2,
    phase: 'Fase 2',
    lockedEndingKey: null,
    chapterGoal,
    mustInclude: [...NADIA_RAKA_BLUEPRINT.mandatoryBeats],
    mustNotInclude: [],
    mustNotReveal: [],
    routeStateSummary: continuation.routeStateSummary,
    previousChoiceSummary: `Pilihan Bab 1: ${continuation.previousChoice?.label ?? '-'}`,
    previousChoiceApplied: true,
  }
}

export const NADIA_RAKA_BRIEF_A = briefFor(
  NADIA_RAKA_CONTINUATION_A,
  'Tunjukkan akibat langsung dari laporan hukum yang diajukan Nadia',
)

export const NADIA_RAKA_BRIEF_B = briefFor(
  NADIA_RAKA_CONTINUATION_B,
  'Tunjukkan akibat langsung dari keputusan Nadia menyusul alamat gudang',
)

/**
 * Bentuk kegagalan produksi: Bab 2 "reset" ke tokoh & lokasi lain.
 * Dipakai sebagai kontrol negatif — checker WAJIB menandai ini.
 */
export const NADIA_RAKA_BAD_CHAPTER_2 = {
  chapterNumber: 2,
  paragraphs: [
    'Pagi harinya di Kedai Kopi Kenangan, Sari duduk sendirian sambil menyeruput lattenya.',
    'Suasana kedai kopi sangat hangat dan ramai oleh para pengunjung.',
    'Sari memikirkan rencana liburan akhir pekan ke pantai.',
  ],
}

/** Kontrol positif: Bab 2 yang benar-benar menyambung. */
export const NADIA_RAKA_GOOD_CHAPTER_2 = {
  chapterNumber: 2,
  paragraphs: [
    'Raka melangkah mundur saat konfrontasi dengan Nadia di galeri semakin memanas.',
    'Tuduhan tentang lukisan galeri seni yang hilang terpancar jelas dari mata Nadia.',
    'Malam itu di galeri seni, tidak ada tempat bagi Raka untuk melarikan diri.',
  ],
}
