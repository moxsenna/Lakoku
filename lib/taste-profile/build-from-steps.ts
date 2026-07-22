/**
 * Pure helper: rakit step answers jadi profile.
 *
 * Diekstrak dari TasteProfileFlow.buildProfile agar bisa diuji tanpa React.
 * Perilaku SAAT INI (Bug 3): mode skip apa pun MEMBUANG stepAnswers.
 *
 * Kontrak diinginkan (belum diimplementasi):
 *   - skip_intro / empty skip → empty + skippedAt (OK)
 *   - skip_with_partial → JAGA partial answers + skippedAt (jangan wipe)
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

  // CURRENT behavior (Bug 3): any skip wipes partial answers.
  // Desired: skip_with_partial should keep answers — see failing test.
  if (args.mode === 'skip_intro' || args.mode === 'skip_with_partial') {
    return { ...base, skippedAt: now, updatedAt: now }
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
 * isSkip=true maps to skip_with_partial (same wipe today).
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
