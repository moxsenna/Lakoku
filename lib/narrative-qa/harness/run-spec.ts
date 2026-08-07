/**
 * M10-C — run contract for the reusable isolated 50-chapter harness.
 *
 * The spec is data-only: it never touches a DB and never decides policy. It
 * exists so a harness run is fully described by a serializable value that can
 * be hashed into the artifact manifest and replayed byte-identically.
 *
 * Non-negotiable (plan C.2): the harness drives PRODUCTION runtime functions.
 * Nothing in this file may be interpreted as permission to bypass them.
 */

export const M10_HARNESS_SPEC_SCHEMA_VERSION = 1 as const

export type HarnessPublicationMode = 'sync' | 'worker'
export type HarnessResumeMode = 'same-attempt' | 'new-attempt'

export interface HarnessResumeStep {
  chapter: number
  mode: HarnessResumeMode
}

export interface HarnessForkStep {
  chapter: number
  choiceIds: string[]
}

export interface M10HarnessRunSpecV1 {
  schemaVersion: typeof M10_HARNESS_SPEC_SCHEMA_VERSION
  storyFixtureId: string
  routeProfile: 'high-trust' | 'low-trust' | 'mixed' | string
  publicationMode: HarnessPublicationMode
  /** Deterministic only. Real-model runs belong to M10-F, never to C. */
  generationMode: 'deterministic'
  chapters: 50
  choicePolicyVersion: string
  checkpointResumePlan: HarnessResumeStep[]
  forkPlan?: HarnessForkStep[]
}

export const HARNESS_CHOICE_POLICY_VERSION = 'm10c-first-choice-v1'

/**
 * The default C run plan: one mid-story resume (<= Bab 20), one mid-story
 * NEW-ATTEMPT re-entry (B3 fencing: a fresh attempt identity must not replay
 * another attempt's commit), and one late-story resume (>= Bab 45), as
 * required by plan C.4.3.
 */
export const DEFAULT_RESUME_PLAN: HarnessResumeStep[] = [
  { chapter: 20, mode: 'same-attempt' },
  { chapter: 33, mode: 'new-attempt' },
  { chapter: 46, mode: 'same-attempt' },
]

export interface BuildRunSpecInput {
  storyFixtureId: string
  publicationMode: HarnessPublicationMode
  routeProfile?: string
  checkpointResumePlan?: HarnessResumeStep[]
  forkPlan?: HarnessForkStep[]
}

export class HarnessSpecError extends Error {
  constructor(message: string) {
    super(`HarnessSpecError: ${message}`)
    this.name = 'HarnessSpecError'
  }
}

export function buildRunSpec(input: BuildRunSpecInput): M10HarnessRunSpecV1 {
  const resumePlan = input.checkpointResumePlan ?? DEFAULT_RESUME_PLAN
  for (const step of resumePlan) {
    if (!Number.isInteger(step.chapter) || step.chapter < 1 || step.chapter > 50) {
      throw new HarnessSpecError(`resume chapter out of range: ${step.chapter}`)
    }
  }
  for (const step of input.forkPlan ?? []) {
    if (!Number.isInteger(step.chapter) || step.chapter < 1 || step.chapter > 49) {
      throw new HarnessSpecError(`fork chapter out of range (1..49): ${step.chapter}`)
    }
    if (step.choiceIds.length < 2) {
      throw new HarnessSpecError(`fork at chapter ${step.chapter} needs >= 2 choiceIds`)
    }
  }

  return {
    schemaVersion: M10_HARNESS_SPEC_SCHEMA_VERSION,
    storyFixtureId: input.storyFixtureId,
    routeProfile: input.routeProfile ?? 'mixed',
    publicationMode: input.publicationMode,
    generationMode: 'deterministic',
    chapters: 50,
    choicePolicyVersion: HARNESS_CHOICE_POLICY_VERSION,
    checkpointResumePlan: resumePlan,
    ...(input.forkPlan ? { forkPlan: input.forkPlan } : {}),
  }
}
