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
 */
import { z } from 'zod'
import {
  TasteProfileV2Schema,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'
import {
  GENRE_LABEL,
  DRAMA_INTENSITY_LABEL,
  PACING_LABEL,
  LANGUAGE_STYLE_LABEL,
  ENDING_BIAS_LABEL,
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

// ─── Block builders ────────────────────────────────────────────────

/** Build a human-readable label for drama intensity */
function intensityLabel(value: string): string {
  const map: Record<string, string> = {
    warm: 'Ringan',
    balanced: 'Sedang',
    intense: 'Tinggi',
  }
  return map[value] ?? value
}

function pacingLabel(value: string): string {
  const map: Record<string, string> = {
    slow_deep: 'Slow burn',
    balanced: 'Seimbang',
    fast_eventful: 'Cepat & penuh peristiwa',
  }
  return map[value] ?? value
}

function languageStyleLabel(value: string): string {
  const map: Record<string, string> = {
    clear_concise: 'Jelas & ringkas',
    poetic_emotional: 'Puitis & emosional',
    cinematic_visual: 'Sinematik & visual',
  }
  return map[value] ?? value
}

function endingBiasLabel(value: string): string {
  const map: Record<string, string> = {
    peaceful: 'Kedamaian',
    justice: 'Keadilan',
    victory: 'Kemenangan',
    bittersweet: 'Tragis-manis',
  }
  return map[value] ?? value
}

function buildTasteProfileBlock(profile: TasteProfileV2): string {
  const lines: string[] = ['Preferensi selera pembaca (soft bias — ikuti hanya jika cocok dengan ide cerita saat ini):']

  // Genres
  if (profile.primaryGenreId && GENRE_LABEL[profile.primaryGenreId]) {
    lines.push(`- Genre utama: ${GENRE_LABEL[profile.primaryGenreId]}.`)
  }
  if (profile.secondaryGenreId && GENRE_LABEL[profile.secondaryGenreId]) {
    lines.push(`- Genre kedua: ${GENRE_LABEL[profile.secondaryGenreId]}.`)
  }

  // Conflicts
  if (profile.likedConflictIds.length > 0) {
    lines.push(`- Konflik yang disukai: ${profile.likedConflictIds.join(', ')}.`)
  }

  // Style preferences (only if set — null means no preference)
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

  // Soft avoidance — "Kurangi atau hindari bila tidak diperlukan"
  if (profile.softAvoidanceIds.length > 0) {
    lines.push('')
    lines.push('Kurangi atau hindari bila tidak diperlukan (soft preferences):')
    lines.push(`- ${profile.softAvoidanceIds.join(', ')}.`)
  }

  // Content boundaries — hard constraints
  if (profile.contentBoundaryIds.length > 0) {
    lines.push('')
    lines.push('BATAS KONTEN WAJIB — tidak boleh dilanggar:')
    lines.push(`- ${profile.contentBoundaryIds.join(', ')}.`)
  }

  return lines.join('\n')
}

function buildQuickAnswersBlock(answers: Record<string, string>): string {
  const entries = Object.entries(answers).filter(([, v]) => v)
  if (entries.length === 0) return ''

  const lines = entries.map(([key, value]) => `- ${key}: ${value}`)
  return ['Pilihan cerita yang diinginkan pembaca:', ...lines].join('\n')
}

// ─── Composer utama ────────────────────────────────────────────────

export function buildStorySetupIdea(input: {
  setup: StorySetupInput
  tasteProfile?: TasteProfileV2 | null
}): string {
  const blocks: string[] = []

  // Layer 1: taste profile preferences (soft bias + boundaries)
  if (input.tasteProfile) {
    const block = buildTasteProfileBlock(input.tasteProfile)
    if (block) blocks.push(block)
  }

  // Layer 2: creative direction dari user
  const hasHardBoundaries = input.tasteProfile && input.tasteProfile.contentBoundaryIds.length > 0
  blocks.push(
    'Instruksi prioritas: pilihan cerita saat ini adalah yang utama. ' +
      'Jika ada pertentangan antara preferensi umum pembaca dengan ide cerita saat ini, ' +
      'ikuti ide cerita saat ini' +
      (hasHardBoundaries ? ' — kecuali untuk BATAS KONTEN WAJIB di atas.' : '.'),
  )

  if (input.setup.mode === 'custom') {
    blocks.push(`Ide bebas pengguna — ini adalah arahan kreatif utama:\n${input.setup.customIdea}`)
  } else {
    const answersBlock = buildQuickAnswersBlock(input.setup.answers)
    if (answersBlock) blocks.push(answersBlock)
  }

  // Layer 3: engine directive
  blocks.push(
    'Buat 3 premis cerita interaktif yang berbeda dan emosional. ' +
      'Setiap premis harus memiliki judul menggugah, peran tokoh utama yang jelas, ' +
      'dan sinopsis yang cocok untuk format 50 bab pilihan pembaca.',
  )

  return blocks.filter(Boolean).join('\n\n')
}
