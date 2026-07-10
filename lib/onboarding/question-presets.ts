/**
 * Question preset untuk quick onboarding /mulai.
 *
 * Default questions diekstrak dari onboarding-flow.tsx agar bisa dipersonalisasi
 * dari Taste Profile (Phase 4). Untuk saat ini, fungsi getStorySetupQuestions
 * mengembalikan default tanpa modifikasi.
 */
import type { TasteProfile } from '@/lib/taste-profile/schema'

export interface SetupQuestion {
  key: string
  prompt: string
  helper?: string
  /** Prefiks yang membingkai jawaban saat dirakit jadi ide untuk AI. */
  frame: (answer: string) => string
  defaultAnswer: string
  options: string[]
}

export const defaultStorySetupQuestions: SetupQuestion[] = [
  {
    key: 'trope',
    prompt: 'Drama seperti apa yang ingin kamu jalani?',
    helper: 'Pilih konflik utama untuk peranmu.',
    frame: (a) => `Konflik utama cerita: ${a.toLowerCase()}.`,
    defaultAnswer: 'Pasangan yang berkhianat',
    options: [
      'Pasangan yang berkhianat',
      'Pernikahan kontrak yang berubah arah',
      'Rahasia keluarga dan warisan',
      'Cinta lama yang kembali',
      'Bangkit setelah dipermalukan',
    ],
  },
  {
    key: 'sikap',
    prompt: 'Bagaimana tokohmu biasanya menghadapi konflik?',
    helper: 'Ini menentukan pilihan yang akan sering muncul.',
    frame: (a) => `Tokoh utama cenderung ${a.toLowerCase()}.`,
    defaultAnswer: 'Tenang dan menyusun rencana',
    options: [
      'Tenang dan menyusun rencana',
      'Langsung menghadapi, apa pun risikonya',
      'Menyimpan semuanya sampai waktunya tiba',
    ],
  },
  {
    key: 'hubungan',
    prompt: 'Hubungan seperti apa yang ingin kamu bentuk?',
    helper: 'Satu love interest utama akan hadir dalam ceritamu.',
    frame: (a) => `Hubungan yang diinginkan: ${a.toLowerCase()}.`,
    defaultAnswer: 'Cinta yang harus diperjuangkan lagi',
    options: [
      'Cinta yang harus diperjuangkan lagi',
      'Sekutu yang perlahan menjadi lebih',
      'Fokus pada diriku sendiri dulu',
    ],
  },
  {
    key: 'akhir',
    prompt: 'Akhir seperti apa yang paling ingin kamu kejar?',
    helper: 'Cerita tetap bisa berubah karena pilihanmu.',
    frame: (a) => `Akhir yang dikejar: ${a.toLowerCase()}.`,
    defaultAnswer: 'Keadilan - semua rahasia terbuka',
    options: [
      'Keadilan — semua rahasia terbuka',
      'Kedamaian — melepaskan dan melangkah',
      'Kemenangan — merebut kembali posisiku',
    ],
  },
]

/**
 * Ambil pertanyaan onboarding yang sudah dipersonalisasi berdasarkan Taste Profile.
 *
 * Saat ini (Phase 1) hanya mengembalikan default. Personalisasi statis
 * (reorder/inject 1-2 opsi) akan diimplementasikan di Phase 4.
 */
export function getStorySetupQuestions(_profile?: TasteProfile | null): SetupQuestion[] {
  // Phase 4: reorder/inject options dari profile di sini.
  // Aturan: jangan hapus opsi default seluruhnya, maksimal 5-6 opsi per step,
  // tetap ada "Pilihkan untukku" dan "Tulis sendiri" (dirender UI sebagai action khusus).
  return structuredClone(defaultStorySetupQuestions)
}
