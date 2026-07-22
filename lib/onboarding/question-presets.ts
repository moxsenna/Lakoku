/**
 * Question preset untuk quick onboarding /mulai — V2 compatible.
 *
 * getStorySetupQuestions(profile) mempersonalisasi opsi berdasarkan Taste Profile V2:
 * - primaryGenreId / secondaryGenreId → promote/inject opsi yang cocok
 * - likedConflictIds → promote opsi terkait
 * - softAvoidanceIds → demote opsi yang mirip (tidak dihapus, hanya turun)
 * - dramaIntensity, endingBias → promote opsi terkait (hanya jika completedAt)
 *
 * Jangan hapus opsi default. Jangan generate opsi pakai LLM. Jangan >6 opsi per step.
 */
import { type TasteProfileV2 } from '@/lib/taste-profile/schema'
import { hasUsableTasteProfile } from '@/lib/taste-profile/resolver'

export { hasUsableTasteProfile }

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

/** Fuzzy match: substring whole, atau minimal satu kata >=3 huruf cocok. */
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

/** Genre (V2 stable ID) → injectable drama options untuk question `trope`. */
const GENRE_DRAMA_OPTIONS: Record<string, string[]> = {
  family_drama: ['Konflik warisan yang memecah keluarga'],
  romance: ['Pernikahan kontrak yang berubah arah', 'Hubungan pura-pura yang jadi nyata'],
  mystery: ['Rahasia yang tersimpan puluhan tahun', 'Misteri yang terungkap perlahan'],
  fantasy_kingdom: ['Tahta yang diperebutkan', 'Takdir kerajaan yang tersembunyi'],
  slice_of_life: ['Hidup baru di tempat tak terduga'],
  survival_thriller: ['Terjebak tanpa jalan keluar'],
}

/** Genre → promote tokens for fuzzy matching on question options. */
const GENRE_PROMOTE_TOKENS: Record<string, string[]> = {
  family_drama: ['keluarga', 'warisan', 'pengorbanan'],
  romance: ['cinta', 'pasangan', 'pernikahan', 'hubungan'],
  mystery: ['rahasia', 'misteri', 'tersembunyi', 'dikubur', 'terungkap', 'warisan'],
  fantasy_kingdom: ['tahta', 'kerajaan', 'sihir', 'takdir', 'ramalan'],
  slice_of_life: ['hidup', 'sederhana', 'kampung'],
  survival_thriller: ['terjebak', 'bahaya', 'dendam', 'berlari'],
}

/** dramaIntensity V2 → promote candidate untuk question `sikap`. */
const INTENSITY_SIKAP_PROMOTE: Record<string, string[]> = {
  warm: ['Tenang dan menyusun rencana'],
  balanced: ['Menyimpan semuanya sampai waktunya tiba'],
  intense: ['Langsung menghadapi, apa pun risikonya'],
}

/** endingBias V2 → promote candidate untuk question `akhir`. */
const ENDING_BIAS_PROMOTE: Record<string, string> = {
  justice: 'Keadilan — semua rahasia terbuka',
  peaceful: 'Kedamaian — melepaskan dan melangkah',
  victory: 'Kemenangan — merebut kembali posisiku',
  bittersweet: 'Kedamaian — melepaskan dan melangkah',
}

// ── Personalizer utama ─────────────────────────────────────────────

function personalizeQuestion(q: SetupQuestion, profile: TasteProfileV2): SetupQuestion {
  const result = cloneQuestion(q)

  // 1. softAvoidanceIds: demote di semua pertanyaan (selalu).
  result.options = demoteOptions(result.options, profile.softAvoidanceIds)

  // 2. likedConflictIds: promote di semua pertanyaan (selalu).
  result.options = promoteOptions(result.options, profile.likedConflictIds)

  switch (result.key) {
    case 'trope': {
      // primaryGenreId / secondaryGenreId: inject genre-specific options + promote
      const genreInjects: string[] = []
      const promoteTokens: string[] = []
      const genreIds = [profile.primaryGenreId, profile.secondaryGenreId].filter(Boolean)
      for (const genreId of genreIds) {
        if (!genreId) continue
        const mapped = GENRE_DRAMA_OPTIONS[genreId]
        if (mapped) genreInjects.push(...mapped)
        const tokens = GENRE_PROMOTE_TOKENS[genreId]
        if (tokens) promoteTokens.push(...tokens)
      }
      result.options = injectOptions(result.options, genreInjects)
      // Promote using genre-specific tokens for better matching
      result.options = promoteOptions(result.options, promoteTokens)
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
      // V2 doesn't have romanceLevel — skip relationship personalization
      // For now, keep defaults. Romance level may return in a future V3.
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
 * Ambil pertanyaan onboarding yang sudah dipersonalisasi berdasarkan Taste Profile.
 * Return default jika profile tidak punya data yang bisa dipakai.
 * hasUsableTasteProfile di-centralize di lib/taste-profile/resolver.ts.
 */
export function getStorySetupQuestions(profile?: TasteProfileV2 | null): SetupQuestion[] {
  if (!hasUsableTasteProfile(profile)) {
    return defaultStorySetupQuestions.map(cloneQuestion)
  }

  // non-null setelah hasUsableTasteProfile.
  const personalized = defaultStorySetupQuestions.map((q) => personalizeQuestion(q, profile!))

  // Smart defaults: set defaultAnswer to the first promoted option when taste is present
  for (const q of personalized) {
    if (q.options.length > 0) {
      q.defaultAnswer = q.options[0]
    }
  }

  return personalized
}

// ── Contextual adaptation berdasarkan jawaban user ─────────────────

/**
 * Answer-based contextual options: ubah future questions berdasarkan jawaban user
 * di sesi onboarding /mulai. Ini terpisah dari Taste Profile personalization.
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
