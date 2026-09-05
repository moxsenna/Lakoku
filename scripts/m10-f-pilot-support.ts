const PILOT_STORY_ID_PATTERN = /^m10c-m10f-[a-z0-9-]+$/
const FORBIDDEN_FIXED_STORY_IDS = new Set(['m10c-m10f-real-pilot'])

export function requireExplicitPilotStoryId(value: string | undefined): string {
  const storyId = value?.trim() ?? ''
  if (!storyId) throw new Error('M10F_PILOT_STORY_ID wajib diset eksplisit')
  if (!PILOT_STORY_ID_PATTERN.test(storyId)) {
    throw new Error('M10F_PILOT_STORY_ID harus namespace m10c-m10f-*')
  }
  if (FORBIDDEN_FIXED_STORY_IDS.has(storyId)) {
    throw new Error('M10F_PILOT_STORY_ID tidak boleh memakai ID fallback tetap')
  }
  return storyId
}

export class LiveChapterCaptureError extends Error {
  constructor(chapter: number, cause: unknown) {
    super(
      `LIVE_CHAPTER_CAPTURE_FAILED:Bab ${chapter}:${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = 'LiveChapterCaptureError'
  }
}

export class PilotGenerationFailure extends Error {
  constructor(
    public readonly reason: string,
    public readonly detail?: unknown,
  ) {
    super(`GENERATE_FAILED:${reason}`)
    this.name = 'PilotGenerationFailure'
  }
}

export class PublishedChapterPostPublishError extends Error {
  constructor(chapter: number, cause: unknown) {
    super(
      `PUBLISHED_CHAPTER_POST_PUBLISH_FAILED:Bab ${chapter}:${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = 'PublishedChapterPostPublishError'
  }
}

const RETRYABLE_PILOT_REASONS = new Set([
  'TRANSIENT',
  'CAPACITY_BUSY',
  'CAPACITY_TIMEOUT',
  'CHOICE_WORKFLOW_TIMEOUT',
  'GENERATION_JOB_DEADLINE_EXCEEDED',
])

export type PilotChapterFailure =
  | { disposition: 'ABORT_EVIDENCE_CAPTURE'; error: LiveChapterCaptureError }
  | { disposition: 'ABORT_PUBLISHED_CHAPTER'; error: PublishedChapterPostPublishError }
  | { disposition: 'STOP_REVIEW_REQUIRED'; error: PilotGenerationFailure }
  | { disposition: 'RETRYABLE_CHAPTER_FAILURE'; error: PilotGenerationFailure }
  | { disposition: 'STOP_NON_RETRYABLE'; error: unknown }

/** Retry only explicit transient/provider results; never retry or skip terminal/review failures. */
export function classifyPilotChapterFailure(error: unknown): PilotChapterFailure {
  if (error instanceof LiveChapterCaptureError) {
    return { disposition: 'ABORT_EVIDENCE_CAPTURE', error }
  }
  if (error instanceof PublishedChapterPostPublishError) {
    return { disposition: 'ABORT_PUBLISHED_CHAPTER', error }
  }
  if (error instanceof PilotGenerationFailure) {
    if (error.reason === 'FAILED_REVIEW_REQUIRED') {
      return { disposition: 'STOP_REVIEW_REQUIRED', error }
    }
    if (RETRYABLE_PILOT_REASONS.has(error.reason)) {
      return { disposition: 'RETRYABLE_CHAPTER_FAILURE', error }
    }
  }
  return { disposition: 'STOP_NON_RETRYABLE', error }
}

export type PilotChapterCapturesArtifact = {
  path: string
  description: 'complete deterministic chapter-local evidence' | 'invocation segment-only diagnostic'
  captureMode: 'LIVE_CHAPTER_LOCAL'
  captureRange: {
    startChapter: number
    endChapter: number | null
  }
  captureCount: number
  completeHorizon: boolean
}

export type PilotCaptureArtifacts = {
  chapterCaptures: PilotChapterCapturesArtifact
  deterministicCaptureMode?: 'LIVE_CHAPTER_LOCAL'
}

/** Describe only captures written by this invocation; resumed runs never merge prior files. */
export function describePilotCaptureArtifacts(input: {
  path: string
  startChapter: number
  totalChapters: number
  captureCount: number
}): PilotCaptureArtifacts {
  const completeHorizon = input.startChapter === 1 && input.captureCount === input.totalChapters
  const chapterCaptures: PilotChapterCapturesArtifact = {
    path: input.path,
    description: completeHorizon
      ? 'complete deterministic chapter-local evidence'
      : 'invocation segment-only diagnostic',
    captureMode: 'LIVE_CHAPTER_LOCAL',
    captureRange: {
      startChapter: input.startChapter,
      endChapter: input.captureCount > 0
        ? input.startChapter + input.captureCount - 1
        : null,
    },
    captureCount: input.captureCount,
    completeHorizon,
  }

  return completeHorizon
    ? { chapterCaptures, deterministicCaptureMode: 'LIVE_CHAPTER_LOCAL' }
    : { chapterCaptures }
}

export function computePilotInvocationSummary(input: {
  startChapter: number
  totalChapters: number
  preexistingPublished: number
  publishedThisInvocation: number
  failedAttemptsThisInvocation: number
  totalWordsThisInvocation: number
  finalPublishedTotal: number
}) {
  const requestedThisInvocation = input.totalChapters - input.startChapter + 1
  return {
    preexistingPublished: input.preexistingPublished,
    requestedThisInvocation,
    publishedThisInvocation: input.publishedThisInvocation,
    failedAttemptsThisInvocation: input.failedAttemptsThisInvocation,
    finalPublishedTotal: input.finalPublishedTotal,
    avgWordsPerChapter: input.publishedThisInvocation > 0
      ? Math.round(input.totalWordsThisInvocation / input.publishedThisInvocation)
      : 0,
    diagnosticOnly: input.startChapter > 1,
  }
}
