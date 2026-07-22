/**
 * Pure helper: rakit step answers jadi profile.
 *
 * Diekstrak dari TasteProfileFlow.buildProfile agar bisa diuji tanpa React.
 *
 * Kontrak:
 *   - skip_intro → empty + skippedAt
 *   - skip_with_partial → jaga partial answers + skippedAt
 *   - complete → answers + completedAt
 *
 * Fase 1a: UI masih mengirim field V1 (preferredGenres, likedTropes, …).
 * Return type keeps transitional V1 step fields alongside V2 base.
 */
import {
  createDefaultTasteProfile,
  type TasteProfileV2,
} from './schema'

/** Jawaban multi-step UI (campuran field V1 label / V2 id selama migrasi). */
export type TasteStepAnswers = {
  preferredGenres?: string[]
  likedTropes?: string[]
  avoidedTropes?: string[]
  contentBoundaries?: string[]
  dramaIntensity?: string | null
  romanceLevel?: string | null
  pacing?: string | null
  languageStyle?: string | null
  endingBias?: string | null
  primaryGenreId?: string | null
  secondaryGenreId?: string | null
  likedConflictIds?: string[]
  softAvoidanceIds?: string[]
  contentBoundaryIds?: string[]
  customLikedConflict?: string | null
  completedAt?: string | null
  skippedAt?: string | null
  updatedAt?: string | null
  version?: 1 | 2
}

export type BuiltTasteProfile = TasteProfileV2 & TasteStepAnswers

export type BuildTasteProfileMode =
  | 'complete'
  | 'skip_intro'
  | 'skip_with_partial'

export function buildTasteProfileFromSteps(args: {
  answers: TasteStepAnswers
  mode: BuildTasteProfileMode
  /** Inject timestamp for deterministic tests. */
  now?: string
}): BuiltTasteProfile {
  const base = createDefaultTasteProfile()
  const now = args.now ?? new Date().toISOString()

  if (args.mode === 'skip_intro') {
    return { ...base, skippedAt: now, updatedAt: now }
  }

  if (args.mode === 'skip_with_partial') {
    return {
      ...base,
      ...args.answers,
      skippedAt: now,
      updatedAt: now,
    } as BuiltTasteProfile
  }

  return {
    ...base,
    ...args.answers,
    completedAt: now,
    updatedAt: now,
  } as BuiltTasteProfile
}

/**
 * Compat shim matching TasteProfileFlow submitProfile(isSkip).
 * isSkip=true maps to skip_with_partial (keeps partial answers).
 */
export function buildSkipOrSaveProfile(
  stepAnswers: TasteStepAnswers,
  isSkip: boolean,
  now?: string,
): BuiltTasteProfile {
  return buildTasteProfileFromSteps({
    answers: stepAnswers,
    mode: isSkip ? 'skip_with_partial' : 'complete',
    now,
  })
}
