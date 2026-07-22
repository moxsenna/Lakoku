/**
 * Pure helpers for Taste Profile V2 onboarding UI selection rules.
 * No React, no I/O — unit-testable.
 */
import {
  BOUNDARY_NONE,
  CONFLICT_CATALOG_BY_GENRE,
  CONFLICT_LABEL,
  CONTENT_BOUNDARY_CATALOG,
  DRAMA_INTENSITY_LABEL,
  ENDING_BIAS_LABEL,
  GENRE_CATALOG,
  GENRE_LABEL,
  LANGUAGE_STYLE_LABEL,
  PACING_LABEL,
  SOFT_AVOIDANCE_CATALOG,
  type GenreCatalogId,
} from './catalog'
import { buildBalancedOptionsFromGenres } from './options'
import type {
  DramaIntensity,
  EndingBias,
  GenreId,
  LanguageStyle,
  Pacing,
  TasteProfileV2,
} from './schema'
import { createEmptyTasteProfile } from './schema'

export type TasteOnboardingPhase =
  | 'intro'
  | 'genre'
  | 'conflicts'
  | 'boundaries'
  | 'tone'
  | 'ending_style'
  | 'saving'
  | 'save_error'
  | 'done'

export type TasteOnboardingAnswers = {
  primaryGenreId: GenreId | null
  secondaryGenreId: GenreId | null
  likedConflictIds: string[]
  customLikedConflict: string | null
  softAvoidanceIds: string[]
  contentBoundaryIds: string[]
  dramaIntensity: DramaIntensity | null
  pacing: Pacing | null
  languageStyle: LanguageStyle | null
  endingBias: EndingBias | null
}

export function emptyAnswers(): TasteOnboardingAnswers {
  return {
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
  }
}

export const PHASE_ORDER: TasteOnboardingPhase[] = [
  'intro',
  'genre',
  'conflicts',
  'boundaries',
  'tone',
  'ending_style',
]

export function phaseIndex(phase: TasteOnboardingPhase): number {
  return PHASE_ORDER.indexOf(phase)
}

/** Ordered genre selection: primary first, secondary second. */
export function selectedGenreIds(a: TasteOnboardingAnswers): GenreId[] {
  const ids: GenreId[] = []
  if (a.primaryGenreId) ids.push(a.primaryGenreId)
  if (a.secondaryGenreId) ids.push(a.secondaryGenreId)
  return ids
}

/**
 * Toggle genre with max 2. Returns next answers + optional max message.
 * Removing primary promotes secondary.
 */
export function toggleGenre(
  answers: TasteOnboardingAnswers,
  genreId: GenreId,
): { answers: TasteOnboardingAnswers; maxReached: boolean } {
  const selected = selectedGenreIds(answers)

  if (selected.includes(genreId)) {
    // deselect
    if (answers.primaryGenreId === genreId) {
      return {
        answers: {
          ...answers,
          primaryGenreId: answers.secondaryGenreId,
          secondaryGenreId: null,
        },
        maxReached: false,
      }
    }
    return {
      answers: { ...answers, secondaryGenreId: null },
      maxReached: false,
    }
  }

  if (selected.length >= 2) {
    return { answers, maxReached: true }
  }

  if (!answers.primaryGenreId) {
    return {
      answers: { ...answers, primaryGenreId: genreId },
      maxReached: false,
    }
  }

  return {
    answers: { ...answers, secondaryGenreId: genreId },
    maxReached: false,
  }
}

export function buildConflictOptionEntries(
  primary: GenreId | null,
  secondary: GenreId | null,
): { id: string; label: string }[] {
  if (!primary) return []

  const genreMap: Record<string, string[]> = {}
  for (const [genreId, entries] of Object.entries(CONFLICT_CATALOG_BY_GENRE)) {
    genreMap[genreId] = entries.map((e) => e.id)
  }

  const selected: string[] = [primary]
  if (secondary) selected.push(secondary)

  const fallback = Object.values(CONFLICT_CATALOG_BY_GENRE)
    .flat()
    .map((e) => e.id)

  const ids = buildBalancedOptionsFromGenres(selected, genreMap, fallback)
  return ids.map((id) => ({
    id,
    label: CONFLICT_LABEL[id] ?? id,
  }))
}

/**
 * Conflicts that would be invalid after genre change.
 */
export function invalidConflictsAfterGenreChange(
  likedConflictIds: string[],
  primary: GenreId | null,
  secondary: GenreId | null,
): string[] {
  const allowed = new Set(
    buildConflictOptionEntries(primary, secondary).map((e) => e.id),
  )
  return likedConflictIds.filter((id) => !allowed.has(id))
}

export function toggleMulti(
  current: string[],
  id: string,
  max: number,
): { next: string[]; maxReached: boolean } {
  if (current.includes(id)) {
    return { next: current.filter((x) => x !== id), maxReached: false }
  }
  if (current.length >= max) {
    return { next: current, maxReached: true }
  }
  return { next: [...current, id], maxReached: false }
}

/**
 * Hard boundary exclusive with boundary_none.
 */
export function toggleHardBoundary(
  current: string[],
  id: string,
): string[] {
  if (id === BOUNDARY_NONE) {
    // Selecting none clears all real boundaries
    if (current.includes(BOUNDARY_NONE) && current.length === 1) {
      return []
    }
    return [BOUNDARY_NONE]
  }

  // Selecting a real boundary removes none
  const withoutNone = current.filter((x) => x !== BOUNDARY_NONE)
  if (withoutNone.includes(id)) {
    return withoutNone.filter((x) => x !== id)
  }
  return [...withoutNone, id]
}

export function canAdvanceFromPhase(
  phase: TasteOnboardingPhase,
  a: TasteOnboardingAnswers,
): boolean {
  switch (phase) {
    case 'intro':
      return true
    case 'genre':
      return a.primaryGenreId !== null
    case 'conflicts':
      return a.likedConflictIds.length >= 1 || Boolean(a.customLikedConflict?.trim())
    case 'boundaries':
      return true // soft/hard optional
    case 'tone':
      return a.dramaIntensity !== null && a.pacing !== null
    case 'ending_style':
      return a.endingBias !== null && a.languageStyle !== null
    default:
      return false
  }
}

export function buildProfileFromAnswers(
  a: TasteOnboardingAnswers,
  opts: { mode: 'complete' | 'skip_intro'; now?: string },
): TasteProfileV2 {
  const now = opts.now ?? new Date().toISOString()
  const base = createEmptyTasteProfile()

  if (opts.mode === 'skip_intro') {
    return { ...base, skippedAt: now, updatedAt: now }
  }

  // Strip boundary_none from stored hard list (means "no special boundaries")
  const hard = a.contentBoundaryIds.filter((id) => id !== BOUNDARY_NONE)

  return {
    ...base,
    primaryGenreId: a.primaryGenreId,
    secondaryGenreId: a.secondaryGenreId,
    likedConflictIds: a.likedConflictIds.slice(0, 3),
    customLikedConflict: a.customLikedConflict?.trim()
      ? a.customLikedConflict.trim().slice(0, 160)
      : null,
    softAvoidanceIds: a.softAvoidanceIds.slice(0, 4),
    contentBoundaryIds: hard.slice(0, 12),
    dramaIntensity: a.dramaIntensity,
    pacing: a.pacing,
    languageStyle: a.languageStyle,
    endingBias: a.endingBias,
    completedAt: now,
    updatedAt: now,
  }
}

export function answersFromDraft(
  draft: Partial<TasteProfileV2> | null | undefined,
): TasteOnboardingAnswers {
  const empty = emptyAnswers()
  if (!draft) return empty
  return {
    primaryGenreId: (draft.primaryGenreId as GenreId) ?? null,
    secondaryGenreId: (draft.secondaryGenreId as GenreId) ?? null,
    likedConflictIds: draft.likedConflictIds ?? [],
    customLikedConflict: draft.customLikedConflict ?? null,
    softAvoidanceIds: draft.softAvoidanceIds ?? [],
    contentBoundaryIds: draft.contentBoundaryIds ?? [],
    dramaIntensity: (draft.dramaIntensity as DramaIntensity) ?? null,
    pacing: (draft.pacing as Pacing) ?? null,
    languageStyle: (draft.languageStyle as LanguageStyle) ?? null,
    endingBias: (draft.endingBias as EndingBias) ?? null,
  }
}

export function draftFromAnswers(a: TasteOnboardingAnswers): Partial<TasteProfileV2> {
  return {
    version: 2,
    primaryGenreId: a.primaryGenreId,
    secondaryGenreId: a.secondaryGenreId,
    likedConflictIds: a.likedConflictIds,
    customLikedConflict: a.customLikedConflict,
    softAvoidanceIds: a.softAvoidanceIds,
    contentBoundaryIds: a.contentBoundaryIds,
    dramaIntensity: a.dramaIntensity,
    pacing: a.pacing,
    languageStyle: a.languageStyle,
    endingBias: a.endingBias,
  }
}

/** Multi-line summary for step 5. */
export function buildTasteSummaryLines(a: TasteOnboardingAnswers): string[] {
  const lines: string[] = []

  const genres: string[] = []
  if (a.primaryGenreId) genres.push(shortGenreLabel(a.primaryGenreId))
  if (a.secondaryGenreId) genres.push(shortGenreLabel(a.secondaryGenreId))
  if (genres.length) lines.push(genres.join(' + '))

  const toneBits: string[] = []
  if (a.dramaIntensity) {
    toneBits.push(DRAMA_INTENSITY_LABEL[a.dramaIntensity] ?? a.dramaIntensity)
  }
  if (a.pacing) {
    const p =
      a.pacing === 'slow_deep'
        ? 'Ritme mendalam'
        : a.pacing === 'fast_eventful'
          ? 'Ritme cepat'
          : 'Ritme seimbang'
    toneBits.push(p)
  }
  if (toneBits.length) lines.push(toneBits.join(' · '))

  if (a.languageStyle) {
    const style =
      a.languageStyle === 'cinematic_visual'
        ? 'Gaya sinematik'
        : a.languageStyle === 'poetic_emotional'
          ? 'Gaya puitis'
          : 'Gaya jernih'
    lines.push(style)
  }

  if (a.endingBias) {
    const end =
      a.endingBias === 'peaceful'
        ? 'Akhir damai'
        : a.endingBias === 'justice'
          ? 'Akhir keadilan'
          : a.endingBias === 'victory'
            ? 'Akhir kemenangan'
            : 'Akhir pahit bermakna'
    lines.push(end)
  }

  const hard = a.contentBoundaryIds.filter((id) => id !== BOUNDARY_NONE)
  if (hard.length > 0) {
    lines.push(`${hard.length} batas cerita`)
  } else if (a.contentBoundaryIds.includes(BOUNDARY_NONE)) {
    lines.push('Tanpa batas khusus')
  }

  return lines
}

function shortGenreLabel(id: string): string {
  const full = GENRE_LABEL[id] ?? id
  // Shorten common labels for summary chips
  if (id === 'mystery') return 'Misteri'
  if (id === 'fantasy_kingdom') return 'Fantasi'
  if (id === 'family_drama') return 'Drama keluarga'
  if (id === 'survival_thriller') return 'Thriller'
  return full
}

export function isGenreCatalogId(id: string): id is GenreCatalogId {
  return GENRE_CATALOG.some((g) => g.id === id)
}

export {
  GENRE_CATALOG,
  SOFT_AVOIDANCE_CATALOG,
  CONTENT_BOUNDARY_CATALOG,
  DRAMA_INTENSITY_LABEL,
  PACING_LABEL,
  LANGUAGE_STYLE_LABEL,
  ENDING_BIAS_LABEL,
  BOUNDARY_NONE,
}
