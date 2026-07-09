/**
 * Demo story beats for demo:selasa-akhir — one row per chapter.
 * Choices/outcomes must come from here (no 4-bucket labels).
 */
import type { ChapterMode } from '@/lib/prose/mobile-drama-style'

export const DEMO_TOTAL_CHAPTERS = 50
export const DEMO_ENDING_MAJU = 'Rekonsiliasi Bersyarat'
export const DEMO_ENDING_TAHAN = 'Kemenangan Pahit'

export type DemoChoice = {
  id: 'maju' | 'tahan'
  label: string
  consequence: string[]
}

export type DemoChapterBeat = {
  number: number
  title: string
  summary: string
  chapterMode: ChapterMode
  choicePrompt: string
  choices: [DemoChoice, DemoChoice]
}

type ActTemplate = {
  from: number
  to: number
  mode: ChapterMode
  titleBase: string
  summary: string
  choicePrompt: string
  maju: { label: string; consequence: string }
  tahan: { label: string; consequence: string }
}

/** Act-level templates; per-chapter title/label get chapter-specific polish. */
const ACTS: ActTemplate[] = [
  {
    from: 1,
    to: 6,
    mode: 'confrontation',
    titleBase: 'Kepulangan',
    summary:
      'Rani pulang ke rumah kaca. Ibu Ratna dingin. Dimas hati-hati. Ada larangan menyentuh barang Ayah.',
    choicePrompt: 'Apa yang kaulakukan sekarang?',
    maju: {
      label: 'Desak masuk ke urusan Ayah meski dilarang',
      consequence: 'Kau mendesak; ketegangan di rumah naik, celah menuju ruang kerja terbuka.',
    },
    tahan: {
      label: 'Diam dulu, amati siapa yang paling gelisah',
      consequence: 'Kau menahan diri; kau melihat celah di wajah mereka tanpa ribut.',
    },
  },
  {
    from: 7,
    to: 12,
    mode: 'investigation',
    titleBase: 'Jejak Brankas',
    summary:
      'Ruang kerja Ayah, kunci di laci, brankas debu terhapus. Dimas menghalangi. Ada yang sudah masuk duluan.',
    choicePrompt: 'Brankas di depanmu. Apa keputusanmu?',
    maju: {
      label: 'Buka brankas / pakai kunci sekarang',
      consequence: 'Kau membuka yang disembunyikan; isi di dalamnya mengubah peta curiga.',
    },
    tahan: {
      label: 'Simpan kunci, cari saksi dulu',
      consequence: 'Kau menunda buka; kau punya waktu mengamankan saksi sebelum mereka menutup jejak.',
    },
  },
  {
    from: 13,
    to: 19,
    mode: 'confrontation',
    titleBase: 'Meja Retak',
    summary:
      'Meja makan pecah suasana. Notaris ditolak. Tuduhan terselubung. Keluarga saling jaga rahasia.',
    choicePrompt: 'Mereka menekanmu diam. Apa yang kaulakukan?',
    maju: {
      label: 'Desak janji ketemu notaris Hendra',
      consequence: 'Kau memaksa jadwal; Hendra terpojok dan mulai goyah.',
    },
    tahan: {
      label: 'Gali lewat Dimas tanpa ribut di meja',
      consequence: 'Kau pilih jalur sunyi; Dimas jadi celah informasi tanpa ledakan publik.',
    },
  },
  {
    from: 20,
    to: 25,
    mode: 'reveal',
    titleBase: 'Bayang Ayah',
    summary:
      'Pita suara / jejak bahwa Ayah mungkin tidak benar-benar “pergi” seperti yang diceritakan.',
    choicePrompt: 'Bayangan itu mengusik. Bagaimana kau melangkah?',
    maju: {
      label: 'Kejar bukti bahwa cerita kematian Ayah palsu',
      consequence: 'Kau menggali lebih dalam; risiko naik, tapi celah kebenaran melebar.',
    },
    tahan: {
      label: 'Simpan pita/jejak, uji dulu keabsahannya',
      consequence: 'Kau menahan diri; kau verifikasi sebelum menuduh keras.',
    },
  },
  {
    from: 26,
    to: 32,
    mode: 'confrontation',
    titleBase: 'Nama Dimas',
    summary:
      'Amplop cokelat, akta, rahasia darah Dimas. Kepercayaan diuji di bawah pohon jambu.',
    choicePrompt: 'Dimas membuka sebagian dirinya. Bagaimana sikapmu?',
    maju: {
      label: 'Percaya Dimas dan tuntut sisa kebenaran',
      consequence: 'Kau memilih percaya bersyarat; aliansi rapuh terbentuk.',
    },
    tahan: {
      label: 'Jaga jarak, minta bukti lain dulu',
      consequence: 'Kau menahan kepercayaan; Dimas terluka, tapi kau lebih waspada.',
    },
  },
  {
    from: 33,
    to: 39,
    mode: 'reveal',
    titleBase: 'Saksi Sari',
    summary:
      'Sari kembali dengan foto dipotong. Ibu Ratna panik. Masa lalu 1998 menganga.',
    choicePrompt: 'Saksi berdiri di beranda. Apa yang kaulakukan?',
    maju: {
      label: 'Undang Sari masuk dan dengarkan di depan Ibu',
      consequence: 'Kau bawa saksi ke dalam; konfrontasi tak terelakkan.',
    },
    tahan: {
      label: 'Ajak Sari bicara diam-diam di luar rumah',
      consequence: 'Kau amankan kesaksian tanpa ledakan di depan keluarga dulu.',
    },
  },
  {
    from: 40,
    to: 45,
    mode: 'investigation',
    titleBase: 'Kaca dari Dalam',
    summary:
      'Laporan kematian Kakek tidak nyambung. Serpih kaca dari dalam. Ada yang membersihkan jejak.',
    choicePrompt: 'Bukti di meja kaca. Langkahmu?',
    maju: {
      label: 'Tuduh langsung dan desak pengakuan',
      consequence: 'Kau menekan; seseorang retak—tapi perang terbuka dimulai.',
    },
    tahan: {
      label: 'Amankan salinan bukti sebelum menuduh',
      consequence: 'Kau mengamankan arsip; tuduhan ditunda, posisimu lebih kuat.',
    },
  },
  {
    from: 46,
    to: 50,
    mode: 'aftermath',
    titleBase: 'Selasa Terakhir',
    summary:
      'Semua berkumpul di rumah kaca. Bukti di meja. Damai pahit atau ledakan—pilihan penutup.',
    choicePrompt: 'Bagaimana kau menutup Selasa ini?',
    maju: {
      label: 'Mengungkap kebenaran di depan keluarga',
      consequence: DEMO_ENDING_MAJU,
    },
    tahan: {
      label: 'Menahan diri demi damai yang rapuh',
      consequence: DEMO_ENDING_TAHAN,
    },
  },
]

const TITLE_FLAVOR: Record<number, string> = {
  1: 'Hujan di Atap Kaca',
  2: 'Teh yang Dingin',
  3: 'Larangan di Ambang',
  4: 'Senyum Tipis Ibu',
  5: 'Koridor yang Hati-hati',
  6: 'Bingkai yang Miring',
  7: 'Kunci di Laci',
  8: 'Debu yang Terhapus',
  9: 'Dimas di Ambang',
  10: 'Brankas Berbunyi',
  11: 'Jejak Jari di Tutup',
  12: 'Isi yang Disembunyikan',
  13: 'Sendok yang Jatuh',
  14: 'Notaris Sibuk',
  15: 'Tawa Palsu di Dapur',
  16: 'Telepon yang Putus',
  17: 'Jadwal yang Ditolak',
  18: 'Mata yang Menghindar',
  19: 'Ancaman yang Sopan',
  20: 'Pita Suara',
  21: 'Desis di Ujung',
  22: 'Siapa yang Dikubur',
  23: 'Jejak di Koridor',
  24: 'Kaca yang Basah',
  25: 'Tuduhan yang Tertahan',
  26: 'Amplop Cokelat',
  27: 'Nama di Akta',
  28: 'Darah yang Disembunyikan',
  29: 'Percaya Bersyarat',
  30: 'Jarak yang Aman',
  31: 'Aliansi Rapuh',
  32: 'Di Bawah Jambu',
  33: 'Bel Tiga Kali',
  34: 'Foto yang Dipotong',
  35: 'Tahun Sembilan Belas',
  36: 'Saksi di Beranda',
  37: 'Ibu yang Memucat',
  38: 'Masuk atau Diam',
  39: 'Kesaksian yang Tertunda',
  40: 'Laporan Lama',
  41: 'Serpih dari Dalam',
  42: 'Sapuan Sebelum Polisi',
  43: 'Siapa Diuntungkan',
  44: 'Pengakuan yang Retak',
  45: 'Hitungan Mundur Hujan',
  46: 'Sore di Atap Kaca',
  47: 'Semua Berkumpul',
  48: 'Kertas di Meja Tengah',
  49: 'Kalimat yang Harus Keluar',
  50: 'Selasa yang Berakhir',
}

function actFor(n: number): ActTemplate {
  const a = ACTS.find((x) => n >= x.from && n <= x.to)
  if (!a) throw new Error(`no act for chapter ${n}`)
  return a
}

/** Per-chapter label polish so choices aren't identical inside an act. */
function majuLabel(n: number, base: string): string {
  if (n === 1) return 'Besok pagi cek ruang kerja Ayah meski dilarang'
  if (n === 2) return 'Buka laci meja Ayah sekarang'
  if (n === 3) return 'Desak Ibu jelaskan larangan itu di depan Dimas'
  if (n === 12) return 'Putar kunci brankas sampai terbuka'
  if (n === 32) return 'Percaya Dimas dan minta sisa akta'
  if (n === 50) return 'Mengungkap kebenaran di depan keluarga'
  return base
}

function tahanLabel(n: number, base: string): string {
  if (n === 1) return 'Diam dulu, amati siapa yang paling gelisah'
  if (n === 2) return 'Tutup laci, catat siapa yang lewat koridor'
  if (n === 3) return 'Angguk saja, gali lewat Dimas nanti'
  if (n === 12) return 'Simpan kunci, cari saksi sebelum buka'
  if (n === 32) return 'Jaga jarak dari Dimas sampai ada bukti lain'
  if (n === 50) return 'Menahan diri demi damai yang rapuh'
  return base
}

export function buildDemoChapterBeats(): DemoChapterBeat[] {
  const beats: DemoChapterBeat[] = []
  for (let n = 1; n <= DEMO_TOTAL_CHAPTERS; n++) {
    const act = actFor(n)
    const isEnding = n === DEMO_TOTAL_CHAPTERS
    const majuCons = isEnding
      ? [DEMO_ENDING_MAJU, 'Kau bicara jujur; keluarga mulai berdamai dengan kebenaran.']
      : [act.maju.consequence]
    const tahanCons = isEnding
      ? [DEMO_ENDING_TAHAN, 'Kau menahan diri; kebenaran tetap menang dengan harga berat.']
      : [act.tahan.consequence]

    beats.push({
      number: n,
      title: TITLE_FLAVOR[n] ?? `${act.titleBase} ${n}`,
      summary: `${act.summary} (Bab ${n}.)`,
      chapterMode: act.mode,
      choicePrompt: act.choicePrompt,
      choices: [
        {
          id: 'maju',
          label: majuLabel(n, act.maju.label),
          consequence: majuCons,
        },
        {
          id: 'tahan',
          label: tahanLabel(n, act.tahan.label),
          consequence: tahanCons,
        },
      ],
    })
  }
  return beats
}

export function getDemoBeat(chapterNumber: number): DemoChapterBeat {
  const beats = buildDemoChapterBeats()
  const b = beats.find((x) => x.number === chapterNumber)
  if (!b) throw new Error(`missing beat ${chapterNumber}`)
  return b
}

export function demoChoicesForSeed(chapterNumber: number): Array<{ id: string; label: string }> {
  const b = getDemoBeat(chapterNumber)
  return b.choices.map((c) => ({ id: c.id, label: c.label }))
}

export function demoOutcomesForSeed(
  storyId: string,
  chapterNumber: number,
): Array<{
  story_id: string
  chapter_number: number
  choice_id: string
  consequence: string[]
  next_chapter_number: number | null
  is_ending: boolean
}> {
  const b = getDemoBeat(chapterNumber)
  const isEnding = chapterNumber >= DEMO_TOTAL_CHAPTERS
  const next = isEnding ? null : chapterNumber + 1
  return b.choices.map((c) => ({
    story_id: storyId,
    chapter_number: chapterNumber,
    choice_id: c.id,
    consequence: c.consequence,
    next_chapter_number: next,
    is_ending: isEnding,
  }))
}
