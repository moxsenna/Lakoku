/**
 * Skema Taste Profile — preferensi selera pembaca.
 *
 * Menyimpan preferensi naratif pembaca (genre, trope, intensitas, gaya) sebagai
 * soft bias untuk personalisasi cerita. Tidak menjadi bagian canon story bible.
 *
 * Field timestamp (completedAt, skippedAt, updatedAt) dibuat toleran karena
 * route pengisian resmi (/onboarding/selera) belum tersedia di Phase 1.
 */
import { z } from 'zod'

export const TasteProfileSchema = z.object({
  version: z.literal(1).default(1),
  preferredGenres: z.array(z.string()).default([]),
  likedTropes: z.array(z.string()).default([]),
  avoidedTropes: z.array(z.string()).default([]),
  dramaIntensity: z.enum(['ringan', 'sedang', 'tinggi']).default('sedang'),
  romanceLevel: z.enum(['none', 'subtle', 'utama']).default('subtle'),
  pacing: z.enum(['slow-burn', 'seimbang', 'cepat']).default('seimbang'),
  languageStyle: z.enum(['ringkas', 'puitis', 'sinematik']).default('sinematik'),
  endingBias: z
    .enum(['keadilan', 'kedamaian', 'kemenangan', 'tragis-manis'])
    .default('keadilan'),
  contentBoundaries: z.array(z.string()).default([]),
  completedAt: z.string().optional(),
  skippedAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export type TasteProfile = z.infer<typeof TasteProfileSchema>

/** Buat profile minimal dengan default penuh, siap untuk localStorage. */
export function createDefaultTasteProfile(): TasteProfile {
  return TasteProfileSchema.parse({})
}

/**
 * Normalisasi object mentah dari localStorage/supabase menjadi TasteProfile valid.
 * Jika object invalid/tidak sesuai, kembalikan default kosong.
 */
export function normalizeTasteProfile(raw: unknown): TasteProfile {
  const result = TasteProfileSchema.safeParse(raw)
  return result.success ? result.data : createDefaultTasteProfile()
}

/**
 * Gabung guest profile (localStorage) ke server profile (DB).
 * Aturan: server profile menang jika ada; guest hanya dipakai saat server kosong.
 * Kembalikan true jika guest profile dipakai.
 */
export function mergeTasteProfiles(args: {
  server: TasteProfile | null
  guest: TasteProfile | null
}): { profile: TasteProfile; usedGuest: boolean } {
  if (args.server) {
    return { profile: args.server, usedGuest: false }
  }
  if (args.guest) {
    return { profile: args.guest, usedGuest: true }
  }
  return { profile: createDefaultTasteProfile(), usedGuest: false }
}
