/**
 * Pure helper: rakit step answers jadi TasteProfile.
 *
 * Diekstrak dari TasteProfileFlow.buildProfile agar bisa diuji tanpa React.
 * Perilaku SAAT INI (Bug 3): mode skip apa pun MEMBUANG stepAnswers.
 *
 * Kontrak diinginkan (belum diimplementasi):
 *   - skip_intro / empty skip → empty + skippedAt (OK)
 *   - skip_with_partial → JAGA partial answers + skippedAt (jangan wipe)
 */
import {
  createDefaultTasteProfile,
  type TasteProfile,
} from './schema'

/** Jawaban multi-step UI (bisa campuran field V1 label / V2 id selama migrasi). */
export type TasteStepAnswers = Partial<TasteProfile> & {
  preferredGenres?: string[]
  likedTropes?: string[]
  avoidedTropes?: string[]
}

export type BuildTasteProfileMode =
  | 'complete'
  | 'skip_intro'
  | 'skip_with_partial'

export function buildTasteProfileFromSteps(args: {
  answers: TasteStepAnswers
  mode: BuildTasteProfileMode
  /** Inject timestamp for deterministic tests. */
  now?: string
}): TasteProfile {
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
  }
}

/**
 * Compat shim matching TasteProfileFlow submitProfile(isSkip).
 * isSkip=true maps to skip_with_partial (same wipe today).
 */
export function buildSkipOrSaveProfile(
  stepAnswers: TasteStepAnswers,
  isSkip: boolean,
  now?: string,
): TasteProfile {
  return buildTasteProfileFromSteps({
    answers: stepAnswers,
    mode: isSkip ? 'skip_with_partial' : 'complete',
    now,
  })
}
