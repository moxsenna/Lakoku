/**
 * Story Setup composer — menyusun input pengguna menjadi prompt string untuk AI premis.
 *
 * File ini TIDAK memanggil AI, TIDAK memanggil DB, TIDAK mengubah canon.
 * Tanggung jawab satu-satunya: mengubah StorySetupInput + TasteProfile menjadi
 * string idea yang dikirim ke proposePremises().
 *
 * Prioritas prompt:
 * 1. Content boundaries — hard constraints (BATAS KONTEN WAJIB)
 * 2. Custom idea / quick answers — creative direction utama
 * 3. Taste profile — soft bias
 * 4. Default engine — fallback
 *
 * Soft vs Hard split (V2):
 *   - softAvoidanceIds: "Kurangi atau hindari bila tidak diperlukan" — soft
 *   - contentBoundaryIds: "BATAS KONTEN WAJIB" — hard, tidak boleh dilanggar
 *
 * NEVER put softAvoidance under "JANGAN pakai trope" hard language.
 */
import { z } from 'zod'
import {
  TasteProfileV2Schema,
  normalizeTasteProfile,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'
import {
  GENRE_LABEL,
  DRAMA_INTENSITY_LABEL,
  PACING_LABEL,
  LANGUAGE_STYLE_LABEL,
  ENDING_BIAS_LABEL,
  CONFLICT_LABEL,
  SOFT_AVOIDANCE_LABEL,
  CONTENT_BOUNDARY_LABEL,
  BOUNDARY_NONE,
  labelForId,
} from '@/lib/taste-profile/catalog'

export const StorySetupInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('quick'),
    answers: z.record(z.string(), z.string()),
    guestTasteProfile: TasteProfileV2Schema.nullish(),
  }),
  z.object({
    mode: z.literal('custom'),
    customIdea: z.string().trim().min(1).max(2000),
    guestTasteProfile: TasteProfileV2Schema.nullish(),
  }),
])

export type StorySetupInput = z.infer<typeof StorySetupInputSchema>

// ─── Label helpers ─────────────────────────────────────────────────

function resolveLabel(id: string, fallbackMap?: Record<string, string>): string {
  return labelForId(id) ?? fallbackMap?.[id] ?? id
}

function conflictLabels(ids: string[]): string[] {
  return ids.map((id) => resolveLabel(id, CONFLICT_LABEL))
}

function softAvoidanceLabels(ids: string[]): string[] {
  return ids.map((id) => resolveLabel(id, SOFT_AVOIDANCE_LABEL))
}

function boundaryLabels(ids: string[]): string[] {
  return ids
    .filter((id) => id !== BOUNDARY_NONE)
    .map((id) => resolveLabel(id, CONTENT_BOUNDARY_LABEL))
}

function intensityLabel(value: string): string {
  return DRAMA_INTENSITY_LABEL[value] ?? value
}

function pacingLabel(value: string): string {
  return PACING_LABEL[value] ?? value
}

function languageStyleLabel(value: string): string {
  return LANGUAGE_STYLE_LABEL[value] ?? value
}

function endingBiasLabel(value: string): string {
  return ENDING_BIAS_LABEL[value] ?? value
}

/** Coerce unknown taste (V1 or V2) → V2. Never throws. */
function coerceTasteProfile(raw: unknown): TasteProfileV2 | null {
  if (raw == null) return null
  if (typeof raw !== 'object') return null
  try {
    return normalizeTasteProfile(raw)
  } catch {
    return null
  }
}

// ─── Block builders ────────────────────────────────────────────────

function buildHardBoundaryBlock(profile: TasteProfileV2): string {
  const labels = boundaryLabels(profile.contentBoundaryIds)
  if (labels.length === 0) return ''

  const lines = [
    'BATAS KONTEN WAJIB:',
    '- Jangan masukkan, menyiratkan sebagai kejadian utama, atau menjadikan payoff salah satu kategori berikut:',
    ...labels.map((l) => `  - ${l}`),
    '- Bila ide awal bertentangan dengan batas ini, ubah premis agar tetap koheren.',
  ]
  return lines.join('\n')
}

function buildSoftAvoidanceBlock(profile: TasteProfileV2): string {
  const labels = softAvoidanceLabels(profile.softAvoidanceIds)
  if (labels.length === 0) return ''

  return [
    'Kurangi atau hindari bila tidak diperlukan (soft preferences):',
    ...labels.map((l) => `- ${l}`),
  ].join('\n')
}

function buildTasteSoftPrefsBlock(profile: TasteProfileV2): string {
  const lines: string[] = [
    'Preferensi selera pembaca (soft bias — ikuti hanya jika cocok dengan ide cerita saat ini):',
  ]

  if (profile.primaryGenreId && GENRE_LABEL[profile.primaryGenreId]) {
    lines.push(`- Genre utama: ${GENRE_LABEL[profile.primaryGenreId]}.`)
  }
  if (profile.secondaryGenreId && GENRE_LABEL[profile.secondaryGenreId]) {
    lines.push(`- Genre kedua: ${GENRE_LABEL[profile.secondaryGenreId]}.`)
  }

  if (profile.likedConflictIds.length > 0) {
    lines.push(`- Konflik yang disukai: ${conflictLabels(profile.likedConflictIds).join(', ')}.`)
  }
  if (profile.customLikedConflict) {
    lines.push(`- Konflik kustom: ${profile.customLikedConflict}.`)
  }

  if (profile.dramaIntensity) {
    lines.push(`- Intensitas drama disukai: ${intensityLabel(profile.dramaIntensity)}.`)
  }
  if (profile.pacing) {
    lines.push(`- Ritme cerita disukai: ${pacingLabel(profile.pacing)}.`)
  }
  if (profile.languageStyle) {
    lines.push(`- Gaya bahasa disukai: ${languageStyleLabel(profile.languageStyle)}.`)
  }
  if (profile.endingBias) {
    lines.push(`- Tipe akhir cerita disukai: ${endingBiasLabel(profile.endingBias)}.`)
  }

  // Soft avoidance as separate soft wording (not hard "JANGAN")
  const softBlock = buildSoftAvoidanceBlock(profile)
  if (softBlock) {
    lines.push('')
    lines.push(softBlock)
  }

  // Only soft prefs section — hard boundaries are a separate top-level block
  const hasAnySoft =
    Boolean(profile.primaryGenreId) ||
    Boolean(profile.secondaryGenreId) ||
    profile.likedConflictIds.length > 0 ||
    Boolean(profile.customLikedConflict) ||
    Boolean(profile.dramaIntensity) ||
    Boolean(profile.pacing) ||
    Boolean(profile.languageStyle) ||
    Boolean(profile.endingBias) ||
    profile.softAvoidanceIds.length > 0

  if (!hasAnySoft) return ''
  return lines.join('\n')
}

function buildQuickAnswersBlock(answers: Record<string, string>): string {
  const entries = Object.entries(answers).filter(([, v]) => v)
  if (entries.length === 0) return ''

  const KEY_LABEL: Record<string, string> = {
    trope: 'Konflik utama cerita ini',
    sikap: 'Kecenderungan mengambil keputusan',
    hubungan: 'Hubungan emosional utama',
    akhir: 'Arah akhir yang dikejar',
  }

  const lines = entries.map(([key, value]) => {
    const label = KEY_LABEL[key] ?? key
    return `- ${label}: ${value}`
  })
  return ['Pilihan cerita yang diinginkan pembaca:', ...lines].join('\n')
}

// ─── Composer utama ────────────────────────────────────────────────

export function buildStorySetupIdea(input: {
  setup: StorySetupInput
  /** V2 preferred; V1-shaped raw auto-migrated. */
  tasteProfile?: TasteProfileV2 | null | unknown
}): string {
  const blocks: string[] = []
  const profile = coerceTasteProfile(input.tasteProfile ?? null)

  // Layer 0: HARD content boundaries first — never yield
  if (profile) {
    const hard = buildHardBoundaryBlock(profile)
    if (hard) blocks.push(hard)
  }

  // Layer 1: soft taste prefs (genre, conflicts, style, soft avoid)
  if (profile) {
    const soft = buildTasteSoftPrefsBlock(profile)
    if (soft) blocks.push(soft)
  }

  // Layer 2: priority instruction
  const hasHardBoundaries =
    profile != null && boundaryLabels(profile.contentBoundaryIds).length > 0
  blocks.push(
    'Instruksi prioritas: pilihan cerita saat ini adalah yang utama. ' +
      'Jika ada pertentangan antara preferensi umum pembaca dengan ide cerita saat ini, ' +
      'ikuti ide cerita saat ini' +
      (hasHardBoundaries
        ? ' — kecuali untuk BATAS KONTEN WAJIB di atas yang tidak boleh dilanggar.'
        : '.'),
  )

  // Layer 3: creative direction
  if (input.setup.mode === 'custom') {
    blocks.push(
      `Ide bebas pengguna — ini adalah arahan kreatif utama:\n${input.setup.customIdea}`,
    )
  } else {
    const answersBlock = buildQuickAnswersBlock(input.setup.answers)
    if (answersBlock) blocks.push(answersBlock)
  }

  // Layer 4: engine directive
  blocks.push(
    'Buat 3 premis cerita interaktif yang berbeda dan emosional. ' +
      'Setiap premis harus memiliki judul menggugah, peran tokoh utama yang jelas, ' +
      'dan sinopsis yang cocok untuk format 50 bab pilihan pembaca.',
  )

  return blocks.filter(Boolean).join('\n\n')
}
