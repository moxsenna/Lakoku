/**
 * Story Setup composer — menyusun input pengguna menjadi prompt string untuk AI premis.
 *
 * File ini TIDAK memanggil AI, TIDAK memanggil DB, TIDAK mengubah canon.
 * Tanggung jawab satu-satunya: mengubah StorySetupInput + TasteProfile menjadi
 * string idea yang dikirim ke proposePremises().
 *
 * Prioritas prompt:
 * 1. Content boundaries / avoidedTropes — hard constraints
 * 2. Custom idea / quick answers — creative direction utama
 * 3. Taste profile — soft bias
 * 4. Default engine — fallback
 */
import { z } from 'zod'
import { TasteProfileSchema, type TasteProfile } from '@/lib/taste-profile/schema'

export const StorySetupInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('quick'),
    answers: z.record(z.string(), z.string()),
    guestTasteProfile: TasteProfileSchema.nullish(),
  }),
  z.object({
    mode: z.literal('custom'),
    customIdea: z.string().trim().min(1).max(2000),
    guestTasteProfile: TasteProfileSchema.nullish(),
  }),
])

export type StorySetupInput = z.infer<typeof StorySetupInputSchema>

// ─── Block builders ────────────────────────────────────────────────

function buildTasteProfileBlock(profile: TasteProfile): string {
  const lines: string[] = ['Preferensi selera pembaca (soft bias — ikuti hanya jika cocok dengan ide cerita saat ini):']

  if (profile.preferredGenres.length > 0) {
    lines.push(`- Genre yang disukai: ${profile.preferredGenres.join(', ')}.`)
  }
  if (profile.likedTropes.length > 0) {
    lines.push(`- Trope yang disukai: ${profile.likedTropes.join(', ')}.`)
  }
  if (profile.dramaIntensity !== 'sedang') {
    lines.push(`- Intensitas drama disukai: ${profile.dramaIntensity}.`)
  }
  if (profile.romanceLevel !== 'subtle') {
    lines.push(`- Level romance disukai: ${profile.romanceLevel}.`)
  }
  if (profile.pacing !== 'seimbang') {
    lines.push(`- Ritme cerita disukai: ${profile.pacing}.`)
  }
  if (profile.languageStyle !== 'sinematik') {
    lines.push(`- Gaya bahasa disukai: ${profile.languageStyle}.`)
  }
  if (profile.endingBias !== 'keadilan') {
    lines.push(`- Tipe akhir cerita disukai: ${profile.endingBias}.`)
  }

  // Hard constraints masuk sebagai batas eksplisit
  if (profile.avoidedTropes.length > 0 || profile.contentBoundaries.length > 0) {
    lines.push('')
    lines.push('BATAS — hindari sepenuhnya (hard constraints):')
    if (profile.avoidedTropes.length > 0) {
      lines.push(`- JANGAN pakai trope: ${profile.avoidedTropes.join(', ')}.`)
    }
    if (profile.contentBoundaries.length > 0) {
      lines.push(`- Batas konten: ${profile.contentBoundaries.join(', ')}.`)
    }
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
  tasteProfile?: TasteProfile | null
}): string {
  const blocks: string[] = []

  // Layer 1: hard constraints dari taste profile
  // (contentBoundaries & avoidedTropes masuk ke block taste profile
  // sebagai batas eksplisit, bukan sebagai preferensi lembut)
  if (input.tasteProfile) {
    const hardConstraints = buildTasteProfileBlock(input.tasteProfile)
    if (hardConstraints) blocks.push(hardConstraints)
  }

  // Layer 2: creative direction dari user
  blocks.push(
    'Instruksi prioritas: pilihan cerita saat ini adalah yang utama. ' +
      'Jika ada pertentangan antara preferensi umum pembaca dengan ide cerita saat ini, ' +
      'ikuti ide cerita saat ini — kecuali untuk batas konten dan trope yang dihindari (BATAS di atas).',
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
