import { z } from 'zod'

/**
 * 5 Preset Gaya Visual untuk Cover Generation.
 */
export const COVER_PRESET_KEYS = [
  'sinematik',
  'webtoon',
  'cat_air',
  'gelap',
  'fantasi',
] as const

export const CoverPresetKeySchema = z.enum(COVER_PRESET_KEYS)
export type CoverPresetKey = z.infer<typeof CoverPresetKeySchema>

export interface CoverPresetDefinition {
  key: CoverPresetKey
  label: string
  description: string
}

export const COVER_PRESETS: Record<CoverPresetKey, CoverPresetDefinition> = {
  sinematik: {
    key: 'sinematik',
    label: 'Sinematik',
    description: 'Pencahayaan film dramatis, realistis, hangat, komposisi sentral.',
  },
  webtoon: {
    key: 'webtoon',
    label: 'Webtoon / Anime',
    description: 'Gaya manhwa modern, garis bersih, warna cerah memikat.',
  },
  cat_air: {
    key: 'cat_air',
    label: 'Lukisan Cat Air',
    description: 'Sentuhan artistik bertekstur, warna puitis dan lembut.',
  },
  gelap: {
    key: 'gelap',
    label: 'Gelap & Menegangkan',
    description: 'Kontras tajam, bayangan pekat, atmosfer misterius.',
  },
  fantasi: {
    key: 'fantasi',
    label: 'Fantasi Megah',
    description: 'Aura magis berkilau, megah, nuansa mistis memukau.',
  },
}

/**
 * Payload request untuk generate sampul dengan konfigurasi opsional.
 */
export const GenerateStoryCoverRequestSchema = z
  .object({
    preset: CoverPresetKeySchema.optional().default('sinematik'),
    customNotes: z.string().max(80).optional(),
    includeTitle: z.boolean().optional().default(false),
  })
  .strict()

export type GenerateStoryCoverRequest = z.infer<typeof GenerateStoryCoverRequestSchema>
