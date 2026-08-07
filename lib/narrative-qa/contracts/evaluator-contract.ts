/**
 * M10-B deterministic evaluator contracts.
 *
 * Temporal safety is enforced **by construction**, not by reflection:
 * every evaluator input type MUST ship an explicit `TemporalExtractor` that
 * enumerates each chapter-bearing field it carries. `validateEvaluatorEnvelope`
 * refuses to run without one. A violation is an *invalid evaluator invocation*
 * (test failure), never a story finding.
 */

export type LongHorizonSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type RemediationClass =
  | 'runtime'
  | 'dataflow'
  | 'policy'
  | 'prompt'
  | 'fixture'
  | 'observability'

export type EvaluatorTemporalMode = 'CHAPTER_LOCAL' | 'HORIZON' | 'FINAL_HORIZON'

export const MAX_STORY_CHAPTER = 50

export const SeverityRank: Record<LongHorizonSeverity, number> = {
  BLOCKER: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
  INFO: 5,
}

export interface FindingEvidenceV1 {
  kind: 'canon' | 'commit' | 'checkpoint' | 'chapter' | 'choice' | 'context' | 'contract'
  ref: string
  detail: Record<string, unknown>
}

export interface LongHorizonFindingV1 {
  schemaVersion: 1
  code: string
  severity: LongHorizonSeverity
  domain: string
  storyId: string
  chapterNumber?: number
  horizon?: { fromChapter: number; toChapter: number }
  evidence: FindingEvidenceV1[]
  message: string
  remediationClass: RemediationClass
}

export interface EvaluatorEnvelopeV1<TInput = unknown> {
  schemaVersion: 1
  evaluatorId: string
  evaluatorVersion: string
  storyId: string
  mode: EvaluatorTemporalMode
  evaluatedChapter?: number
  horizon?: { fromChapter: number; toChapter: number }
  input: TInput
}

export class InvalidEvaluatorInvocationError extends Error {
  constructor(message: string) {
    super(`InvalidEvaluatorInvocationError: ${message}`)
    this.name = 'InvalidEvaluatorInvocationError'
  }
}

/**
 * `OBSERVED` — a chapter that has already happened relative to the evaluation
 * point. Must never exceed the evaluated chapter / horizon.
 *
 * `DECLARED_DEADLINE` — a forward-looking contractual deadline that is legal to
 * carry (e.g. `plot_debt.must_close_by_chapter = 48` while evaluating Bab 10).
 * It is bounded to 1..50 but exempt from the past-only rule. It must never be
 * read as evidence that the future already happened.
 */
export type ChapterRefKind = 'OBSERVED' | 'DECLARED_DEADLINE'

export interface ChapterRef {
  /** Dotted path of the field inside the input, for actionable error messages. */
  path: string
  chapter: number
  kind: ChapterRefKind
}

/**
 * Explicit, per-input enumeration of every chapter-bearing field.
 * Each evaluator owns exactly one. Adding a chapter-bearing field without
 * extending the extractor is caught by `tests/narrative-qa/*` coverage guard.
 */
export type TemporalExtractor<TInput> = (input: TInput) => ChapterRef[]

export function observed(path: string, chapter: number | undefined | null): ChapterRef[] {
  return typeof chapter === 'number' ? [{ path, chapter, kind: 'OBSERVED' }] : []
}

export function deadline(path: string, chapter: number | undefined | null): ChapterRef[] {
  return typeof chapter === 'number' ? [{ path, chapter, kind: 'DECLARED_DEADLINE' }] : []
}

function assertChapterBounds(ref: ChapterRef): void {
  if (!Number.isInteger(ref.chapter) || ref.chapter < 1 || ref.chapter > MAX_STORY_CHAPTER) {
    throw new InvalidEvaluatorInvocationError(
      `chapter out of bounds at "${ref.path}": ${ref.chapter} (allowed 1..${MAX_STORY_CHAPTER})`,
    )
  }
}

/**
 * Temporal gate. `extract` is REQUIRED — there is no reflective fallback, so an
 * input field cannot dodge the check by being named something unexpected.
 */
export function validateEvaluatorEnvelope<TInput>(
  envelope: EvaluatorEnvelopeV1<TInput>,
  extract: TemporalExtractor<TInput>,
): void {
  if (typeof extract !== 'function') {
    throw new InvalidEvaluatorInvocationError(
      `evaluator "${envelope.evaluatorId}" invoked without an explicit TemporalExtractor`,
    )
  }

  const { mode, evaluatedChapter, horizon } = envelope
  const refs = extract(envelope.input)
  for (const ref of refs) assertChapterBounds(ref)
  const observedRefs = refs.filter((ref) => ref.kind === 'OBSERVED')

  if (mode === 'CHAPTER_LOCAL') {
    if (evaluatedChapter === undefined || !Number.isInteger(evaluatedChapter) || evaluatedChapter < 1) {
      throw new InvalidEvaluatorInvocationError('CHAPTER_LOCAL mode requires evaluatedChapter >= 1')
    }
    if (evaluatedChapter > MAX_STORY_CHAPTER) {
      throw new InvalidEvaluatorInvocationError(
        `CHAPTER_LOCAL evaluatedChapter ${evaluatedChapter} exceeds ${MAX_STORY_CHAPTER}`,
      )
    }
    for (const ref of observedRefs) {
      if (ref.chapter > evaluatedChapter) {
        throw new InvalidEvaluatorInvocationError(
          `CHAPTER_LOCAL temporal violation (evaluatedChapter=${evaluatedChapter}) at "${ref.path}": chapter ${ref.chapter}`,
        )
      }
    }
    return
  }

  if (mode === 'HORIZON' || mode === 'FINAL_HORIZON') {
    if (
      !horizon ||
      !Number.isInteger(horizon.fromChapter) ||
      !Number.isInteger(horizon.toChapter) ||
      horizon.fromChapter < 1 ||
      horizon.toChapter > MAX_STORY_CHAPTER ||
      horizon.fromChapter > horizon.toChapter
    ) {
      throw new InvalidEvaluatorInvocationError(
        `${mode} mode requires valid horizon { fromChapter, toChapter } within 1..${MAX_STORY_CHAPTER}`,
      )
    }
    if (mode === 'FINAL_HORIZON' && horizon.toChapter !== MAX_STORY_CHAPTER) {
      throw new InvalidEvaluatorInvocationError(
        `FINAL_HORIZON requires horizon.toChapter = ${MAX_STORY_CHAPTER}, got ${horizon.toChapter}`,
      )
    }
    for (const ref of observedRefs) {
      if (ref.chapter < horizon.fromChapter || ref.chapter > horizon.toChapter) {
        throw new InvalidEvaluatorInvocationError(
          `${mode} temporal violation (${horizon.fromChapter}..${horizon.toChapter}) at "${ref.path}": chapter ${ref.chapter}`,
        )
      }
    }
    return
  }

  throw new InvalidEvaluatorInvocationError(`Unknown EvaluatorTemporalMode: ${String(mode)}`)
}

export interface M10ArtifactManifestV1 {
  schemaVersion: 1
  stage: 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  /** SHA the stage actually executed from. NOT the M10-A closure anchor. */
  baselineSha: string
  m10aClosureAnchor: string
  runId: string
  startedAt: string
  finishedAt: string
  environment: 'local' | 'isolated-qa' | 'staging'
  storyIds: string[]
  routeProfiles: string[]
  runtimePolicyVersions: Record<string, string | number>
  evaluatorVersions: Record<string, string | number>
  judgePolicyVersions?: Record<string, string | number>
  artifactHashes: {
    findingsHash: string
    summaryHash: string
  }
  result: 'PASS' | 'FAIL' | 'BLOCKED'
}
