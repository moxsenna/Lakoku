import { z } from 'zod'

export type LongHorizonSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
export type RemediationClass = 'runtime' | 'dataflow' | 'policy' | 'prompt' | 'fixture' | 'observability'
export type EvaluatorTemporalMode = 'CHAPTER_LOCAL' | 'HORIZON' | 'FINAL_HORIZON'

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

export interface ChapterBearingRecord {
  chapterNumber?: number
  chapter?: number
}

function extractChapterNumber(record: unknown): number | undefined {
  if (!record || typeof record !== 'object') return undefined
  const obj = record as Record<string, unknown>
  if (typeof obj.chapterNumber === 'number') return obj.chapterNumber
  if (typeof obj.chapter === 'number') return obj.chapter
  return undefined
}

function walkAndAssertChapters(obj: unknown, predicate: (ch: number) => boolean, errorMessagePrefix: string): void {
  if (!obj || typeof obj !== 'object') return
  if (Array.isArray(obj)) {
    for (const item of obj) {
      walkAndAssertChapters(item, predicate, errorMessagePrefix)
    }
    return
  }
  const ch = extractChapterNumber(obj)
  if (ch !== undefined) {
    if (!predicate(ch)) {
      throw new InvalidEvaluatorInvocationError(`${errorMessagePrefix}: record has chapter ${ch}`)
    }
  }
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key]
    if (val && typeof val === 'object') {
      walkAndAssertChapters(val, predicate, errorMessagePrefix)
    }
  }
}

export function validateEvaluatorEnvelope<TInput>(envelope: EvaluatorEnvelopeV1<TInput>): void {
  const { mode, evaluatedChapter, horizon, input } = envelope

  if (mode === 'CHAPTER_LOCAL') {
    if (evaluatedChapter === undefined || evaluatedChapter < 1) {
      throw new InvalidEvaluatorInvocationError('CHAPTER_LOCAL mode requires evaluatedChapter >= 1')
    }
    walkAndAssertChapters(
      input,
      (ch) => ch <= evaluatedChapter,
      `CHAPTER_LOCAL temporal violation (evaluatedChapter=${evaluatedChapter})`
    )
  } else if (mode === 'HORIZON') {
    if (!horizon || horizon.fromChapter > horizon.toChapter || horizon.fromChapter < 1) {
      throw new InvalidEvaluatorInvocationError('HORIZON mode requires valid horizon { fromChapter, toChapter }')
    }
    walkAndAssertChapters(
      input,
      (ch) => ch >= horizon.fromChapter && ch <= horizon.toChapter,
      `HORIZON temporal violation (${horizon.fromChapter}..${horizon.toChapter})`
    )
  } else if (mode === 'FINAL_HORIZON') {
    if (!horizon || horizon.fromChapter > horizon.toChapter || horizon.fromChapter < 1) {
      throw new InvalidEvaluatorInvocationError('FINAL_HORIZON mode requires valid horizon { fromChapter, toChapter }')
    }
    walkAndAssertChapters(
      input,
      (ch) => ch >= horizon.fromChapter && ch <= horizon.toChapter,
      `FINAL_HORIZON temporal violation (${horizon.fromChapter}..${horizon.toChapter})`
    )
  } else {
    throw new InvalidEvaluatorInvocationError(`Unknown EvaluatorTemporalMode: ${String(mode)}`)
  }
}

export interface M10ArtifactManifestV1 {
  schemaVersion: 1
  stage: 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
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
