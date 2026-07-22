/**
 * Taste Profile V2 — Resolver helpers.
 *
 * Pure functions to answer questions about a TasteProfileV2:
 * - hasUsable: is there enough data to personalize?
 * - summary: human-readable summary string
 * - toV1Compat: adapt V2 to V1 shape for gradual caller migration
 */
import type { TasteProfileV2 } from './schema'
import { GENRE_LABEL, CONFLICT_CATALOG, CONFLICT_CATALOG_BY_GENRE } from './catalog'
import type { ConflictEntry } from './catalog'

/**
 * Check if a profile has enough user data to be usable for personalization.
 * Empty/skipped profiles with no explicit preferences return false.
 */
export function hasUsableTasteProfile(profile?: TasteProfileV2 | null): boolean {
  if (!profile) return false
  // Skipped but never completed — no usable data
  if (profile.skippedAt && !profile.completedAt) return false

  return Boolean(
    profile.completedAt ||
      profile.primaryGenreId ||
      profile.secondaryGenreId ||
      profile.likedConflictIds.length > 0 ||
      profile.softAvoidanceIds.length > 0 ||
      profile.contentBoundaryIds.length > 0,
  )
}

/**
 * Build a short human-readable summary for display in profile page.
 */
export function summarizeTasteProfile(profile: TasteProfileV2): string {
  const parts: string[] = []

  if (profile.primaryGenreId && GENRE_LABEL[profile.primaryGenreId]) {
    parts.push(GENRE_LABEL[profile.primaryGenreId])
  }
  if (profile.secondaryGenreId && GENRE_LABEL[profile.secondaryGenreId]) {
    parts.push(GENRE_LABEL[profile.secondaryGenreId])
  }

  if (profile.dramaIntensity) {
    const map: Record<string, string> = {
      warm: 'Ringan',
      balanced: 'Sedang',
      intense: 'Tinggi',
    }
    if (map[profile.dramaIntensity]) parts.push(map[profile.dramaIntensity])
  }

  if (profile.endingBias) {
    const map: Record<string, string> = {
      peaceful: 'Kedamaian',
      justice: 'Keadilan',
      victory: 'Kemenangan',
      bittersweet: 'Tragis manis',
    }
    if (map[profile.endingBias]) parts.push(map[profile.endingBias])
  }

  return parts.length > 0 ? parts.join(', ') : 'Belum diatur'
}

/**
 * Check whether a profile is truly empty (no user data at all).
 */
export function isEmptyTasteProfile(profile: TasteProfileV2): boolean {
  return (
    !profile.primaryGenreId &&
    !profile.secondaryGenreId &&
    profile.likedConflictIds.length === 0 &&
    !profile.customLikedConflict &&
    profile.softAvoidanceIds.length === 0 &&
    profile.contentBoundaryIds.length === 0 &&
    !profile.dramaIntensity &&
    !profile.pacing &&
    !profile.languageStyle &&
    !profile.endingBias
  )
}

/**
 * Get genre label for display; "Belum dipilih" if null.
 */
export function genreLabel(genreId: string | null): string {
  if (!genreId) return 'Belum dipilih'
  return GENRE_LABEL[genreId] ?? genreId
}

/**
 * Resolve the primary genre label for use in story setup / prompts.
 */
export function primaryGenreLabel(profile: TasteProfileV2): string {
  return genreLabel(profile.primaryGenreId)
}

/**
 * Get conflict labels for a given genre ID (balanced option building).
 * Returns empty array if genre unknown.
 */
export function conflictOptionsForGenre(genreId: string | null): readonly string[] {
  if (!genreId) return []
  return CONFLICT_CATALOG[genreId] ?? []
}

/** Get conflict id+label entries for a genre. */
export function conflictEntriesForGenre(genreId: string | null): readonly ConflictEntry[] {
  if (!genreId) return []
  return CONFLICT_CATALOG_BY_GENRE[genreId] ?? []
}

// Re-export asV1Compat for discoverability
export { asV1Compat } from './schema'
