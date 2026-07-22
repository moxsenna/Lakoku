/**
 * StoryCreativeDirection — story-level snapshot of taste + story setup.
 * Plan §9. Server-owned contract.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  DramaIntensitySchema,
  EndingBiasSchema,
  GenreIdSchema,
  LanguageStyleSchema,
  PacingSchema,
  type TasteProfileV2,
} from '@/lib/taste-profile/schema'
import {
  CONFLICT_LABEL,
  GENRE_LABEL,
  DRAMA_INTENSITY_LABEL,
  LANGUAGE_STYLE_LABEL,
  ENDING_BIAS_LABEL,
} from '@/lib/taste-profile/catalog'
import type { ResolvedStoryAnswers } from './auto-resolve'
import {
  AGENCY_LABEL,
  RELATIONSHIP_LABEL,
  ROLE_LABEL,
} from './role-catalog'

export const PROMPT_CONTRACT_VERSION = 'story-creative-direction-v1'

export const StoryCreativeDirectionSchema = z.object({
  version: z.literal(1),
  sourceTasteProfileVersion: z.number().int(),
  genre: z.object({
    primary: GenreIdSchema.nullable(),
    secondary: GenreIdSchema.nullable(),
  }),
  preferences: z.object({
    likedConflictIds: z.array(z.string()),
    softAvoidanceIds: z.array(z.string()),
    dramaIntensity: DramaIntensitySchema.nullable(),
    pacing: PacingSchema.nullable(),
    languageStyle: LanguageStyleSchema.nullable(),
    endingBias: EndingBiasSchema.nullable(),
  }),
  hardBoundaries: z.array(z.string()),
  storySetup: z.object({
    coreConflict: z.object({
      id: z.string().nullable(),
      customText: z.string().nullable(),
      resolvedFromAuto: z.boolean(),
    }),
    protagonistRole: z.object({
      id: z.string().nullable(),
      customText: z.string().nullable(),
      resolvedFromAuto: z.boolean(),
    }),
    relationshipFocus: z.string(),
    agencyStyle: z.string(),
  }),
  source: z.enum(['taste_quick', 'taste_custom_idea', 'no_taste_quick', 'brainstorm']),
  promptContractVersion: z.string(),
  createdAt: z.string(),
})

export type StoryCreativeDirection = z.infer<typeof StoryCreativeDirectionSchema>

export function buildStoryCreativeDirection(args: {
  profile: TasteProfileV2
  resolved: ResolvedStoryAnswers
  source: StoryCreativeDirection['source']
  now?: string
}): StoryCreativeDirection {
  const { profile, resolved, source } = args
  const primary =
    (resolved.genre?.id as StoryCreativeDirection['genre']['primary']) ??
    profile.primaryGenreId
  const ending =
    (resolved.endingDirection?.id as StoryCreativeDirection['preferences']['endingBias']) ??
    profile.endingBias

  return StoryCreativeDirectionSchema.parse({
    version: 1,
    sourceTasteProfileVersion: 2,
    genre: {
      primary,
      secondary: profile.secondaryGenreId,
    },
    preferences: {
      likedConflictIds: profile.likedConflictIds,
      softAvoidanceIds: profile.softAvoidanceIds,
      dramaIntensity: profile.dramaIntensity,
      pacing: profile.pacing,
      languageStyle: profile.languageStyle,
      endingBias: ending,
    },
    hardBoundaries: profile.contentBoundaryIds.filter((id) => id !== 'boundary_none'),
    storySetup: {
      coreConflict: {
        id: resolved.coreConflict.id,
        customText: resolved.coreConflict.customText,
        resolvedFromAuto: resolved.coreConflict.resolvedFromAuto,
      },
      protagonistRole: {
        id: resolved.protagonistRole.id,
        customText: resolved.protagonistRole.customText,
        resolvedFromAuto: resolved.protagonistRole.resolvedFromAuto,
      },
      relationshipFocus:
        resolved.relationshipFocus.id ??
        resolved.relationshipFocus.customText ??
        'relationship_self_growth',
      agencyStyle:
        resolved.agencyStyle.id ??
        resolved.agencyStyle.customText ??
        'agency_observe',
    },
    source,
    promptContractVersion: PROMPT_CONTRACT_VERSION,
    createdAt: args.now ?? new Date().toISOString(),
  })
}

/** Stable fingerprint — hash of normalized JSON without createdAt. */
export function creativeDirectionFingerprint(direction: StoryCreativeDirection): string {
  const { createdAt: _c, ...rest } = direction
  const normalized = stableStringify(rest)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** Reader-safe chip summary — no profile/prompt/model language. */
export function publicDirectionSummary(direction: StoryCreativeDirection): string {
  const parts: string[] = []
  if (direction.genre.primary) {
    const p = shortGenre(direction.genre.primary)
    if (direction.genre.secondary) {
      parts.push(`${p} + ${shortGenre(direction.genre.secondary)}`)
    } else {
      parts.push(p)
    }
  }

  const conflictLabel =
    (direction.storySetup.coreConflict.id &&
      CONFLICT_LABEL[direction.storySetup.coreConflict.id]) ||
    direction.storySetup.coreConflict.customText
  if (conflictLabel) parts.push(conflictLabel)

  const roleLabel =
    (direction.storySetup.protagonistRole.id &&
      ROLE_LABEL[direction.storySetup.protagonistRole.id]) ||
    direction.storySetup.protagonistRole.customText
  if (roleLabel) parts.push(`Tokoh: ${roleLabel}`)

  const rel =
    RELATIONSHIP_LABEL[direction.storySetup.relationshipFocus] ??
    direction.storySetup.relationshipFocus
  if (rel) parts.push(`Hubungan: ${rel}`)

  if (direction.preferences.dramaIntensity) {
    parts.push(DRAMA_INTENSITY_LABEL[direction.preferences.dramaIntensity] ?? '')
  }
  if (direction.preferences.languageStyle) {
    parts.push(LANGUAGE_STYLE_LABEL[direction.preferences.languageStyle] ?? '')
  }

  return parts.filter(Boolean).join(' · ')
}

function shortGenre(id: string): string {
  if (id === 'mystery') return 'Misteri'
  if (id === 'fantasy_kingdom') return 'Fantasi'
  if (id === 'family_drama') return 'Drama keluarga'
  if (id === 'survival_thriller') return 'Thriller'
  return GENRE_LABEL[id] ?? id
}

/**
 * Build idea string for proposePremises from creative direction.
 */
export function buildIdeaFromCreativeDirection(direction: StoryCreativeDirection): string {
  const lines: string[] = []

  // Hard boundaries first
  if (direction.hardBoundaries.length > 0) {
    lines.push('BATAS KONTEN WAJIB:')
    lines.push(
      '- Jangan masukkan, menyiratkan sebagai kejadian utama, atau menjadikan payoff salah satu kategori berikut:',
    )
    for (const id of direction.hardBoundaries) {
      lines.push(`  - ${id}`)
    }
    lines.push('- Bila ide awal bertentangan dengan batas ini, ubah premis agar tetap koheren.')
    lines.push('')
  }

  lines.push('ARAAN KHUSUS CERITA SAAT INI (arah kreatif utama):')
  if (direction.genre.primary) {
    const g = GENRE_LABEL[direction.genre.primary] ?? direction.genre.primary
    const s = direction.genre.secondary
      ? GENRE_LABEL[direction.genre.secondary] ?? direction.genre.secondary
      : null
    lines.push(`- Genre: ${s ? `${g} + ${s}` : g}`)
  }

  const conflict =
    direction.storySetup.coreConflict.customText ||
    (direction.storySetup.coreConflict.id
      ? CONFLICT_LABEL[direction.storySetup.coreConflict.id]
      : null) ||
    direction.storySetup.coreConflict.id
  if (conflict) lines.push(`- Konflik utama cerita ini: ${conflict}`)

  const role =
    direction.storySetup.protagonistRole.customText ||
    (direction.storySetup.protagonistRole.id
      ? ROLE_LABEL[direction.storySetup.protagonistRole.id]
      : null) ||
    direction.storySetup.protagonistRole.id
  if (role) lines.push(`- Peran protagonis: ${role}`)

  const rel =
    RELATIONSHIP_LABEL[direction.storySetup.relationshipFocus] ??
    direction.storySetup.relationshipFocus
  lines.push(`- Hubungan emosional utama: ${rel}`)

  const agency =
    AGENCY_LABEL[direction.storySetup.agencyStyle] ?? direction.storySetup.agencyStyle
  lines.push(`- Kecenderungan mengambil keputusan: ${agency}`)

  if (direction.preferences.dramaIntensity) {
    lines.push(
      `- Intensitas: ${DRAMA_INTENSITY_LABEL[direction.preferences.dramaIntensity] ?? direction.preferences.dramaIntensity}`,
    )
  }
  if (direction.preferences.pacing) {
    lines.push(`- Ritme: ${direction.preferences.pacing}`)
  }
  if (direction.preferences.languageStyle) {
    lines.push(
      `- Gaya penulisan: ${LANGUAGE_STYLE_LABEL[direction.preferences.languageStyle] ?? direction.preferences.languageStyle}`,
    )
  }
  if (direction.preferences.endingBias) {
    lines.push(
      `- Arah ending: ${ENDING_BIAS_LABEL[direction.preferences.endingBias] ?? direction.preferences.endingBias}`,
    )
  }

  if (direction.preferences.softAvoidanceIds.length > 0) {
    lines.push('')
    lines.push(
      `Kurangi atau hindari bila tidak diperlukan: ${direction.preferences.softAvoidanceIds.join(', ')}.`,
    )
  }

  lines.push('')
  lines.push(
    'Instruksi prioritas: arahan khusus cerita saat ini adalah arah kreatif utama. ' +
      'Preferensi global hanya bias. Batas konten tegas wajib dipatuhi.',
  )
  lines.push('')
  lines.push(
    'Buat 3 premis cerita interaktif yang berbeda dan emosional. ' +
      'Setiap premis harus memiliki judul menggugah, peran tokoh utama yang jelas, ' +
      'dan sinopsis yang cocok untuk format 50 bab pilihan pembaca. ' +
      'Tiga premis harus berbeda pada situasi pembuka, taruhan utama, sumber konflik, bentuk relasi, dan arah misteri.',
  )

  return lines.join('\n')
}
