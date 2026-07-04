/**
 * Lakoku — Kontrak Domain (API-first)
 *
 * File ini adalah SATU-SATUNYA sumber kebenaran untuk bentuk data yang
 * dipertukarkan antara client (web reader hari ini, Kotlin/Compose nanti)
 * dan backend.
 *
 * Aturan penting:
 * - Komponen UI HANYA boleh bergantung pada tipe di file ini.
 * - Jangan menaruh logika naratif (validator, memori, branching) di client.
 *   Semua itu tetap di backend; client hanya menampilkan hasilnya.
 * - Saat backend nyata (Hono/Workers + Supabase) siap, tipe-tipe ini dipakai
 *   untuk menurunkan skema/OpenAPI yang di-reuse oleh client Kotlin.
 */

export type TropeTag =
  | 'Pengkhianatan'
  | 'Rahasia Keluarga'
  | 'Second Chance'
  | 'Warisan'
  | 'Kebangkitan Diri'
  | 'Romance'
  | 'Pernikahan Kontrak'
  | 'Cinta Lama'

export type StoryStatus = 'BERJALAN' | 'SELESAI' | 'BARU'

/** Satu opsi keputusan yang bisa dipilih pembaca pada akhir sebuah bab. */
export interface ChoiceOption {
  id: string
  label: string
  hint?: string
}

/** Satu bab dari cerita (target 500–800 kata sesuai PRD). */
export interface Chapter {
  storyId: string
  number: number
  title: string
  paragraphs: string[]
  /** Ada bila bab ini diakhiri sebuah persimpangan keputusan. */
  choicePrompt?: string
  choices?: ChoiceOption[]
}

/** Jejak keputusan yang membentuk perjalanan pembaca. */
export interface JejakItem {
  chapter: number
  decision: string
  consequence: string
}

/**
 * Ringkasan cerita untuk daftar/katalog (beranda, koleksiku, kartu).
 * Ini yang paling sering ditransfer, jadi sengaja ringan.
 */
export interface StorySummary {
  id: string
  title: string
  cover: string
  tagline: string
  role: string
  tropes: TropeTag[]
  totalChapters: number
  currentChapter: number
  status: StoryStatus
  endingName?: string
}

/** Detail lengkap sebuah cerita, termasuk sinopsis & jejak pilihan. */
export interface StoryDetail extends StorySummary {
  synopsis: string
  jejak: JejakItem[]
}

/**
 * Hasil setelah pembaca mengirim sebuah pilihan.
 * Backend nanti yang menentukan konsekuensi & bab berikutnya
 * (bounded branching + validator konsistensi ada di sisi server).
 */
export interface ChoiceOutcome {
  storyId: string
  chapterNumber: number
  choiceId: string
  /** Paragraf konsekuensi yang ditampilkan setelah pilihan. */
  consequence: string[]
  /** Nomor bab berikutnya, atau null bila cerita berakhir di sini. */
  nextChapterNumber: number | null
  /** true bila pilihan ini menutup cerita (mengarah ke ending). */
  isEnding: boolean
}
