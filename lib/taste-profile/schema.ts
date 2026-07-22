/**
 * Skema Taste Profile — V2 (stable IDs) + V1 (legacy, for migration).
 *
 * Public API:
 *   - TasteProfileV2 / TasteProfileV2Schema — canonical
 *   - TasteProfileV1 / TasteProfileV1Schema — legacy parse source
 *   - TasteProfile = TasteProfileV2
 *   - createEmptyTasteProfile / createDefaultTasteProfile — empty V2
 *   - normalizeTasteProfile(raw) — migrate-on-read → V2
 *   - migrateTasteProfileToV2(raw) — pure, idempotent, never throws
 *   - asV1Compat(p) — bridge for engines still on V1 field names
 */
import { z } from 'zod'
import {
  resolveGenreId,
  V1_DRAMA_INTENSITY_MAP,
  V1_PACING_MAP,
  V1_LANGUAGE_STYLE_MAP,
  V1_ENDING_BIAS_MAP,
  V1_AVOIDED_TO_SOFT,
  V1_AVOIDED_TO_HARD,
  V1_LIKED_TROPE_TO_CONFLICT,
  V2_DRAMA_INTENSITY_TO_V1,
  V2_PACING_TO_V1,
  V2_LANGUAGE_STYLE_TO_V1,
  V2_ENDING_BIAS_TO_V1,
  GENRE_LABEL,
  CONFLICT_LABEL,
  CONFLICT_BY_LABEL,
  SOFT_AVOIDANCE_LABEL,
  CONTENT_BOUNDARY_LABEL,
  BOUNDARY_NONE,
  isSoftAvoidanceId,
  isContentBoundaryId,
  labelForId,
} from './catalog'

// ═══════════════════════════════════════════════════════════════════════
// V2 Stable IDs
// ═══════════════════════════════════════════════════════════════════════

export const GenreIdSchema = z.enum([
  'family_drama',
  'romance',
  'mystery',
  'fantasy_kingdom',
  'slice_of_life',
  'survival_thriller',
])
export type GenreId = z.infer<typeof GenreIdSchema>

export const DramaIntensitySchema = z.enum(['warm', 'balanced', 'intense'])
export type DramaIntensity = z.infer<typeof DramaIntensitySchema>

export const PacingSchema = z.enum(['slow_deep', 'balanced', 'fast_eventful'])
export type Pacing = z.infer<typeof PacingSchema>

export const LanguageStyleSchema = z.enum([
  'clear_concise',
  'poetic_emotional',
  'cinematic_visual',
])
export type LanguageStyle = z.infer<typeof LanguageStyleSchema>

export const EndingBiasSchema = z.enum([
  'peaceful',
  'justice',
  'victory',
  'bittersweet',
])
export type EndingBias = z.infer<typeof EndingBiasSchema>

// ═══════════════════════════════════════════════════════════════════════
// V2 Taste Profile
// ═══════════════════════════════════════════════════════════════════════

export const TasteProfileV2Schema = z.object({
  version: z.literal(2),
  primaryGenreId: GenreIdSchema.nullable().default(null),
  secondaryGenreId: GenreIdSchema.nullable().default(null),
  likedConflictIds: z.array(z.string()).max(3).default([]),
  customLikedConflict: z.string().max(160).nullable().default(null),
  softAvoidanceIds: z.array(z.string()).max(4).default([]),
  contentBoundaryIds: z.array(z.string()).max(12).default([]),
  dramaIntensity: DramaIntensitySchema.nullable().default(null),
  pacing: PacingSchema.nullable().default(null),
  languageStyle: LanguageStyleSchema.nullable().default(null),
  endingBias: EndingBiasSchema.nullable().default(null),
  completedAt: z.string().nullable().default(null),
  skippedAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
})
export type TasteProfileV2 = z.infer<typeof TasteProfileV2Schema>

// ═══════════════════════════════════════════════════════════════════════
// V1 (legacy)
// ═══════════════════════════════════════════════════════════════════════

export const TasteProfileV1Schema = z.object({
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
export type TasteProfileV1 = z.infer<typeof TasteProfileV1Schema>

// ═══════════════════════════════════════════════════════════════════════
// Migration helpers
// ═══════════════════════════════════════════════════════════════════════

function normalizeToken(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function pushUnique(list: string[], id: string, max: number): void {
  if (list.length >= max) return
  if (list.includes(id)) return
  list.push(id)
}

function resolveLikedConflict(raw: string): string {
  const token = normalizeToken(raw)
  if (!token) return raw.trim()
  if (V1_LIKED_TROPE_TO_CONFLICT[token]) return V1_LIKED_TROPE_TO_CONFLICT[token]
  if (CONFLICT_BY_LABEL[token]) return CONFLICT_BY_LABEL[token]
  // already a known conflict id
  if (CONFLICT_LABEL[raw.trim()]) return raw.trim()
  return raw.trim()
}

/**
 * Split a V1 avoided string into soft and/or hard IDs.
 * Hard takes priority when both maps could match.
 */
function resolveAvoided(
  raw: string,
): { soft?: string; hard?: string; raw?: string } {
  const token = normalizeToken(raw)
  if (!token) return {}

  if (V1_AVOIDED_TO_HARD[token]) {
    return { hard: V1_AVOIDED_TO_HARD[token] }
  }
  if (V1_AVOIDED_TO_SOFT[token]) {
    return { soft: V1_AVOIDED_TO_SOFT[token] }
  }
  // Already stable IDs
  if (isSoftAvoidanceId(raw.trim())) return { soft: raw.trim() }
  if (isContentBoundaryId(raw.trim())) return { hard: raw.trim() }

  // Unknown — keep as soft raw label (quality preference fallback)
  return { soft: raw.trim() }
}

function resolveBoundary(raw: string): string {
  const token = normalizeToken(raw)
  if (V1_AVOIDED_TO_HARD[token]) return V1_AVOIDED_TO_HARD[token]
  if (isContentBoundaryId(raw.trim())) return raw.trim()
  if (CONTENT_BOUNDARY_LABEL[raw.trim()]) return raw.trim()
  return raw.trim()
}

/**
 * Migrate V1 → V2. Pure, idempotent, never throws.
 *
 * Rules (plan §5.5):
 * 1. first genre → primaryGenreId; second → secondary; rest ignored
 * 2. mapped conflict/avoidance via registry
 * 3. unknown legacy items do not break parse
 * 4. avoidedTropes quality → soft; sensitive → hard
 * 5. timestamps preserved
 * 6. idempotent for V2 input
 */
export function migrateTasteProfileToV2(raw: unknown): TasteProfileV2 {
  try {
    // Already V2 — idempotent
    if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).version === 2) {
      const parsed = TasteProfileV2Schema.safeParse(raw)
      if (parsed.success) return parsed.data
      return createEmptyTasteProfile()
    }

    // Loose V1-ish object: accept partial even if zod defaults apply
    const v1Result = TasteProfileV1Schema.safeParse(
      raw && typeof raw === 'object' ? raw : {},
    )

    // If raw is completely unusable (null/undefined/non-object without V1 shape)
    if (raw == null || typeof raw !== 'object') {
      return createEmptyTasteProfile()
    }

    // Empty {} parses as V1 defaults via schema — still migrate enums to V2 nulls?
    // Plan: empty profile has nulls. V1Schema injects sedang/sinematik defaults.
    // For bare {} / version-less empty, treat as empty V2 (no fake preference).
    const obj = raw as Record<string, unknown>
    const looksEmpty =
      !('preferredGenres' in obj) &&
      !('likedTropes' in obj) &&
      !('avoidedTropes' in obj) &&
      !('dramaIntensity' in obj) &&
      !('pacing' in obj) &&
      !('languageStyle' in obj) &&
      !('endingBias' in obj) &&
      !('romanceLevel' in obj) &&
      !('contentBoundaries' in obj) &&
      !('completedAt' in obj) &&
      !('skippedAt' in obj) &&
      obj.version !== 1

    if (looksEmpty && !v1Result.success) {
      return createEmptyTasteProfile()
    }
    if (looksEmpty && Object.keys(obj).length === 0) {
      return createEmptyTasteProfile()
    }

    if (!v1Result.success) {
      return createEmptyTasteProfile()
    }

    const v1 = v1Result.data

    // Genres
    let primaryGenreId: GenreId | null = null
    let secondaryGenreId: GenreId | null = null
    if (v1.preferredGenres.length > 0) {
      const resolved = resolveGenreId(v1.preferredGenres[0])
      if (resolved && GenreIdSchema.safeParse(resolved).success) {
        primaryGenreId = resolved as GenreId
      }
    }
    if (v1.preferredGenres.length > 1) {
      const resolved = resolveGenreId(v1.preferredGenres[1])
      if (resolved && GenreIdSchema.safeParse(resolved).success) {
        secondaryGenreId = resolved as GenreId
      }
    }

    // Liked tropes → conflict ids
    const likedConflictIds: string[] = []
    for (const t of v1.likedTropes) {
      if (likedConflictIds.length >= 3) break
      pushUnique(likedConflictIds, resolveLikedConflict(t), 3)
    }

    // avoidedTropes → soft / hard split
    const softAvoidanceIds: string[] = []
    const contentBoundaryIds: string[] = []
    for (const t of v1.avoidedTropes) {
      const { soft, hard } = resolveAvoided(t)
      if (hard) pushUnique(contentBoundaryIds, hard, 12)
      if (soft) pushUnique(softAvoidanceIds, soft, 4)
    }

    // explicit contentBoundaries field
    for (const b of v1.contentBoundaries) {
      pushUnique(contentBoundaryIds, resolveBoundary(b), 12)
    }

    // Enums — only map when field was present on raw OR version===1 explicit profile
    const hadDrama = 'dramaIntensity' in obj
    const hadPacing = 'pacing' in obj
    const hadLang = 'languageStyle' in obj
    const hadEnding = 'endingBias' in obj
    const isExplicitV1 = obj.version === 1 || hadDrama || hadPacing || hadLang || hadEnding

    const dramaIntensity: DramaIntensity | null = isExplicitV1
      ? ((V1_DRAMA_INTENSITY_MAP[v1.dramaIntensity] as DramaIntensity | undefined) ?? null)
      : null
    const pacing: Pacing | null = isExplicitV1
      ? ((V1_PACING_MAP[v1.pacing] as Pacing | undefined) ?? null)
      : null
    const languageStyle: LanguageStyle | null = isExplicitV1
      ? ((V1_LANGUAGE_STYLE_MAP[v1.languageStyle] as LanguageStyle | undefined) ?? null)
      : null
    const endingBias: EndingBias | null = isExplicitV1
      ? ((V1_ENDING_BIAS_MAP[v1.endingBias] as EndingBias | undefined) ?? null)
      : null

    return {
      version: 2,
      primaryGenreId,
      secondaryGenreId,
      likedConflictIds,
      customLikedConflict: null,
      softAvoidanceIds,
      contentBoundaryIds,
      dramaIntensity,
      pacing,
      languageStyle,
      endingBias,
      completedAt: v1.completedAt ?? null,
      skippedAt: v1.skippedAt ?? null,
      updatedAt: v1.updatedAt ?? null,
    }
  } catch {
    return createEmptyTasteProfile()
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Factories
// ═══════════════════════════════════════════════════════════════════════

/** Truly empty V2 — all prefs null, arrays empty. No fake defaults. */
export function createEmptyTasteProfile(): TasteProfileV2 {
  return {
    version: 2,
    primaryGenreId: null,
    secondaryGenreId: null,
    likedConflictIds: [],
    customLikedConflict: null,
    softAvoidanceIds: [],
    contentBoundaryIds: [],
    dramaIntensity: null,
    pacing: null,
    languageStyle: null,
    endingBias: null,
    completedAt: null,
    skippedAt: null,
    updatedAt: null,
  }
}

/** Alias: empty V2 (no fake defaults). */
export function createDefaultTasteProfile(): TasteProfileV2 {
  return createEmptyTasteProfile()
}

/**
 * Normalize raw (localStorage / DB / API) → TasteProfileV2.
 * Auto-migrates V1. Invalid → empty V2.
 */
export function normalizeTasteProfile(raw: unknown): TasteProfileV2 {
  if (!raw || typeof raw !== 'object') return createEmptyTasteProfile()
  const obj = raw as Record<string, unknown>

  if (obj.version === 2) {
    const result = TasteProfileV2Schema.safeParse(raw)
    return result.success ? result.data : createEmptyTasteProfile()
  }

  return migrateTasteProfileToV2(raw)
}

// ═══════════════════════════════════════════════════════════════════════
// Public aliases
// ═══════════════════════════════════════════════════════════════════════

export type TasteProfile = TasteProfileV2

/** @deprecated Prefer TasteProfileV2Schema */
export const TasteProfileSchema = TasteProfileV2Schema

/**
 * Merge guest (localStorage) into server (DB). Server wins if completed/skipped.
 */
export function mergeTasteProfiles(args: {
  server: TasteProfileV2 | null
  guest: TasteProfileV2 | null
}): { profile: TasteProfileV2; usedGuest: boolean } {
  if (args.server && (args.server.completedAt || args.server.skippedAt)) {
    return { profile: args.server, usedGuest: false }
  }
  if (args.guest && (args.guest.completedAt || args.guest.skippedAt)) {
    return { profile: args.guest, usedGuest: true }
  }
  return { profile: createEmptyTasteProfile(), usedGuest: false }
}

/**
 * Bridge V2 → V1 shape for gradual caller migration.
 * Maps IDs back to labels / old enum strings.
 * Null V2 prefs use mild V1 defaults only on the compat object (not stored).
 */
export function asV1Compat(p: TasteProfileV2): TasteProfileV1 {
  const preferredGenres: string[] = []
  if (p.primaryGenreId && GENRE_LABEL[p.primaryGenreId]) {
    preferredGenres.push(GENRE_LABEL[p.primaryGenreId])
  }
  if (p.secondaryGenreId && GENRE_LABEL[p.secondaryGenreId]) {
    preferredGenres.push(GENRE_LABEL[p.secondaryGenreId])
  }

  const likedTropes = p.likedConflictIds.map(
    (id) => labelForId(id) ?? CONFLICT_LABEL[id] ?? id,
  )

  const avoidedTropes = p.softAvoidanceIds.map(
    (id) => labelForId(id) ?? SOFT_AVOIDANCE_LABEL[id] ?? id,
  )

  const contentBoundaries = p.contentBoundaryIds
    .filter((id) => id !== BOUNDARY_NONE)
    .map((id) => labelForId(id) ?? CONTENT_BOUNDARY_LABEL[id] ?? id)

  return {
    version: 1,
    preferredGenres,
    likedTropes,
    avoidedTropes,
    dramaIntensity: p.dramaIntensity
      ? (V2_DRAMA_INTENSITY_TO_V1[p.dramaIntensity] ?? 'sedang')
      : 'sedang',
    romanceLevel: 'subtle',
    pacing: p.pacing ? (V2_PACING_TO_V1[p.pacing] ?? 'seimbang') : 'seimbang',
    languageStyle: p.languageStyle
      ? (V2_LANGUAGE_STYLE_TO_V1[p.languageStyle] ?? 'sinematik')
      : 'sinematik',
    endingBias: p.endingBias
      ? (V2_ENDING_BIAS_TO_V1[p.endingBias] ?? 'keadilan')
      : 'keadilan',
    contentBoundaries,
    completedAt: p.completedAt ?? undefined,
    skippedAt: p.skippedAt ?? undefined,
    updatedAt: p.updatedAt ?? undefined,
  }
}
