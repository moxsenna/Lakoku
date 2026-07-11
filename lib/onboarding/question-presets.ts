/**
 * Question preset untuk quick onboarding /mulai.
 *
 * getStorySetupQuestions(profile) mempersonalisasi opsi berdasarkan Taste Profile:
 * - preferredGenres & likedTropes → promote/inject opsi yang cocok
 * - avoidedTropes → demote opsi yang mirip (tidak dihapus, hanya turun)
 * - dramaIntensity, romanceLevel, endingBias → promote opsi terkait (hanya jika completedAt)
 *
 * Jangan hapus opsi default. Jangan generate opsi pakai LLM. Jangan >6 opsi per step.
 */
import type { TasteProfile } from '@/lib/taste-profile/schema'

export interface SetupQuestion {
  key: string
  prompt: string
  helper?: string
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

// ── Helpers ────────────────────────────────────────────────────────

/** Token untuk fuzzy matching — lowercased & trimmed. */
function normalizeToken(token: string): string {
  return token.toLowerCase().trim()
}

/** Deep clone options array (cukup shallow copy untuk string array). */
function cloneOptions(options: string[]): string[] {
  return [...options]
}

/** Clone satu SetupQuestion — options di-copy, sisanya shared reference. */
function cloneQuestion(q: SetupQuestion): SetupQuestion {
  return { ...q, options: cloneOptions(q.options) }
}

/**
 * Promote: opsi yang match preferred naik ke atas.
 * Matching: substring check + word-level fallback (min 3 chars per word).
 */
function promoteOptions(options: string[], preferred: string[]): string[] {
  if (!preferred.length) return options

  return [...options].sort((a, b) => {
    const aMatch = preferred.some((p) => tokenMatches(normalizeToken(a), normalizeToken(p)))
    const bMatch = preferred.some((p) => tokenMatches(normalizeToken(b), normalizeToken(p)))
    return (bMatch ? 1 : 0) - (aMatch ? 1 : 0)
  })
}

/**
 * Demote: opsi yang match avoided turun ke bawah.
 */
function demoteOptions(options: string[], avoided: string[]): string[] {
  if (!avoided.length) return options

  return [...options].sort((a, b) => {
    const aAvoided = avoided.some((av) => tokenMatches(normalizeToken(a), normalizeToken(av)))
    const bAvoided = avoided.some((av) => tokenMatches(normalizeToken(b), normalizeToken(av)))
    return (aAvoided ? 1 : 0) - (bAvoided ? 1 : 0)
  })
}

/** Fuzzy match: substring whole, atau minimal satu kata ≥3 huruf cocok. */
function tokenMatches(normalizedOption: string, normalizedQuery: string): boolean {
  if (normalizedOption.includes(normalizedQuery)) return true
  const words = normalizedQuery.split(/\s+/).filter((w) => w.length >= 3)
  return words.some((w) => normalizedOption.includes(w))
}

/**
 * Inject opsi baru ke options, hanya jika slot tersedia.
 * Tidak pernah menghapus opsi yang sudah ada. Maksimal `max` opsi.
 */
function injectOptions(options: string[], injected: string[], max = 6): string[] {
  if (options.length >= max) return options
  if (!injected.length) return options

  const existing = new Set(options.map(normalizeToken))
  const result = [...options]

  for (const opt of injected) {
    if (result.length >= max) break
    if (existing.has(normalizeToken(opt))) continue
    result.push(opt)
    existing.add(normalizeToken(opt))
  }

  return result
}

// ── Personalization per question ───────────────────────────────────

/** Genre → injectable drama options untuk question `trope`. */
const GENRE_DRAMA_OPTIONS: Record<string, string[]> = {
  'drama keluarga': ['Konflik warisan yang memecah keluarga'],
  'romansa': ['Pernikahan kontrak yang berubah arah'],
  'misteri & rahasia': ['Rahasia yang tersimpan puluhan tahun', 'Misteri yang terungkap perlahan'],
  'fantasi & kerajaan': ['Tahta yang diperebutkan', 'Takdir kerajaan yang tersembunyi'],
  'slice of life': ['Hidup baru di tempat tak terduga'],
  'thriller & bertahan hidup': ['Terjebak tanpa jalan keluar'],
}

/** dramaIntensity → promote candidate untuk question `sikap`. */
const INTENSITY_SIKAP_PROMOTE: Record<string, string[]> = {
  'ringan': ['Tenang dan menyusun rencana'],
  'sedang': ['Menyimpan semuanya sampai waktunya tiba'],
  'tinggi': ['Langsung menghadapi, apa pun risikonya'],
}

/** romanceLevel → promote candidate untuk question `hubungan`. */
const ROMANCE_HUBUNGAN_PROMOTE: Record<string, string[]> = {
  'utama': ['Cinta yang harus diperjuangkan lagi'],
  'subtle': ['Sekutu yang perlahan menjadi lebih'],
  'none': ['Fokus pada diriku sendiri dulu'],
}

/** endingBias → promote candidate untuk question `akhir`. */
const ENDING_BIAS_PROMOTE: Record<string, string> = {
  'keadilan': 'Keadilan — semua rahasia terbuka',
  'kedamaian': 'Kedamaian — melepaskan dan melangkah',
  'kemenangan': 'Kemenangan — merebut kembali posisiku',
  'tragis-manis': 'Kedamaian — melepaskan dan melangkah',
}

// ── Personalizer utama ─────────────────────────────────────────────

function personalizeQuestion(q: SetupQuestion, profile: TasteProfile): SetupQuestion {
  const result = cloneQuestion(q)

  // 1. avoidedTropes: demote di semua pertanyaan (selalu).
  result.options = demoteOptions(result.options, profile.avoidedTropes)

  // 2. likedTropes: promote di semua pertanyaan (selalu).
  result.options = promoteOptions(result.options, profile.likedTropes)

  switch (result.key) {
    case 'trope': {
      // preferredGenres: inject genre-specific options + promote
      const genreInjects: string[] = []
      for (const genre of profile.preferredGenres) {
        const mapped = GENRE_DRAMA_OPTIONS[normalizeToken(genre)]
        if (mapped) genreInjects.push(...mapped)
      }
      result.options = injectOptions(result.options, genreInjects)
      result.options = promoteOptions(result.options, profile.preferredGenres)
      break
    }

    case 'sikap': {
      if (profile.completedAt && profile.dramaIntensity) {
        const promoteCandidates = INTENSITY_SIKAP_PROMOTE[profile.dramaIntensity]
        if (promoteCandidates) {
          result.options = promoteOptions(result.options, promoteCandidates)
        }
      }
      break
    }

    case 'hubungan': {
      if (profile.completedAt && profile.romanceLevel) {
        const promoteCandidates = ROMANCE_HUBUNGAN_PROMOTE[profile.romanceLevel]
        if (promoteCandidates) {
          result.options = promoteOptions(result.options, promoteCandidates)
        }
      }
      break
    }

    case 'akhir': {
      if (profile.completedAt && profile.endingBias) {
        const promoteCandidate = ENDING_BIAS_PROMOTE[profile.endingBias]
        if (promoteCandidate) {
          result.options = promoteOptions(result.options, [promoteCandidate])
        }
      }
      break
    }
  }

  return result
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Cek apakah profile punya data yang cukup untuk personalisasi.
 * Profile kosong/skipped (tanpa completedAt + tanpa pilihan eksplisit) tidak dipakai.
 */
export function hasUsableTasteProfile(profile?: TasteProfile | null): boolean {
  if (!profile) return false
  // Skipped tapi belum pernah complete → jangan personalisasi.
  if (profile.skippedAt && !profile.completedAt) return false

  return Boolean(
    profile.completedAt ||
      profile.preferredGenres.length > 0 ||
      profile.likedTropes.length > 0 ||
      profile.avoidedTropes.length > 0 ||
      profile.contentBoundaries.length > 0,
  )
}

/**
 * Ambil pertanyaan onboarding yang sudah dipersonalisasi berdasarkan Taste Profile.
 * Return default jika profile tidak punya data yang bisa dipakai.
 */
export function getStorySetupQuestions(profile?: TasteProfile | null): SetupQuestion[] {
  if (!hasUsableTasteProfile(profile)) {
    return defaultStorySetupQuestions.map(cloneQuestion)
  }

  // non-null setelah hasUsableTasteProfile.
  return defaultStorySetupQuestions.map((q) => personalizeQuestion(q, profile!))
}

// ── Contextual adaptation berdasarkan jawaban user ─────────────────

/**
 * Answer-based contextual options: ubah future questions berdasarkan jawaban user
 * di sesi onboarding /mulai. Ini terpisah dari Taste Profile personalization.
 *
 * Contoh: jika jawaban trope mengandung kata "misteri"/"rahasia"/"warisan",
 * pertanyaan sikap/hubungan/akhir disesuaikan ke konteks misteri.
 */

const MYSTERY_KEYWORDS = ['misteri', 'rahasia', 'warisan', 'tersembunyi', 'dikubur', 'terungkap', 'surat lama', 'kematian']
const ROMANCE_KEYWORDS = ['cinta', 'pernikahan', 'pasangan', 'romansa', 'hubungan', 'sekutu jadi cinta']
const THRILLER_KEYWORDS = ['balas dendam', 'bertahan', 'terjebak', 'dikhianati', 'berlari', 'berbahaya']

const CONTEXTUAL_OPTIONS: Record<string, Record<string, string[]>> = {
  misteri: {
    sikap: [
      'Mengamati detail kecil sebelum bertindak',
      'Menyimpan bukti sampai waktunya tepat',
      'Menghadapi orang yang menyembunyikan sesuatu',
    ],
    hubungan: [
      'Sekutu yang tahu sebagian rahasia',
      'Orang lama yang memegang kunci jawaban',
      'Fokus menyelidiki sendiri dulu',
    ],
    akhir: [
      'Kebenaran terbuka di depan semua orang',
      'Rahasia keluarga dibongkar sepenuhnya',
      'Kedamaian setelah masa lalu diterima',
    ],
  },
  romansa: {
    sikap: [
      'Mengikuti perasaan meski berisiko',
      'Tenang dan menyusun rencana',
      'Menyimpan perasaan sampai waktunya tiba',
    ],
    hubungan: [
      'Cinta yang harus diperjuangkan lagi',
      'Sekutu yang perlahan menjadi lebih',
      'Hubungan baru yang mengobati luka lama',
    ],
    akhir: [
      'Kebersamaan — akhirnya bersatu',
      'Kedamaian — melepaskan dan melangkah',
      'Pengorbanan manis untuk orang yang dicintai',
    ],
  },
  thriller: {
    sikap: [
      'Langsung menghadapi, apa pun risikonya',
      'Menyusun strategi dalam kegelapan',
      'Bertahan hidup dengan apa yang ada',
    ],
    hubungan: [
      'Aliansi sementara dengan musuh',
      'Orang yang tidak bisa dipercaya sepenuhnya',
      'Fokus pada diriku sendiri dulu',
    ],
    akhir: [
      'Kemenangan — merebut kembali posisiku',
      'Keadilan — semua rahasia terbuka',
      'Selamat, tapi dengan luka yang dalam',
    ],
  },
}

function detectTropeContext(tropeAnswer: string): string | null {
  const lower = tropeAnswer.toLowerCase()
  if (MYSTERY_KEYWORDS.some((kw) => lower.includes(kw))) return 'misteri'
  if (THRILLER_KEYWORDS.some((kw) => lower.includes(kw))) return 'thriller'
  if (ROMANCE_KEYWORDS.some((kw) => lower.includes(kw))) return 'romansa'
  return null
}

/**
 * Adaptasi pertanyaan berdasarkan jawaban user di sesi onboarding.
 * Hanya mengubah opsi, tidak menghapus pertanyaan. Freeze async Taste Profile tetap aman.
 */
export function adaptStorySetupQuestionsForAnswers(
  questions: SetupQuestion[],
  answers: Record<string, string>,
): SetupQuestion[] {
  const tropeAnswer = answers.trope
  if (!tropeAnswer) return questions

  const context = detectTropeContext(tropeAnswer)
  if (!context) return questions

  const contextOptions = CONTEXTUAL_OPTIONS[context]
  if (!contextOptions) return questions

  return questions.map((q) => {
    const newOptions = contextOptions[q.key]
    if (!newOptions) return q

    const cloned = cloneQuestion(q)
    cloned.options = newOptions
    if (!cloned.options.includes(cloned.defaultAnswer)) {
      cloned.defaultAnswer = cloned.options[0]
    }
    return cloned
  })
}
