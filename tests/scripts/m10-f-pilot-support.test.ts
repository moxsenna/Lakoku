import { describe, expect, it } from 'vitest'
import {
  classifyPilotChapterFailure,
  computePilotInvocationSummary,
  describePilotCaptureArtifacts,
  LiveChapterCaptureError,
  PilotGenerationFailure,
  PublishedChapterPostPublishError,
  requireExplicitPilotStoryId,
} from '../../scripts/m10-f-pilot-support'

describe('M10-F pilot story identity', () => {
  it('requires unique explicit M10F_PILOT_STORY_ID without fixed fallback', () => {
    expect(() => requireExplicitPilotStoryId(undefined)).toThrow(
      'M10F_PILOT_STORY_ID wajib diset eksplisit',
    )
    expect(() => requireExplicitPilotStoryId('m10c-m10f-real-pilot')).toThrow(
      'M10F_PILOT_STORY_ID tidak boleh memakai ID fallback tetap',
    )
    expect(requireExplicitPilotStoryId('m10c-m10f-run-20260827-a1b2c3')).toBe(
      'm10c-m10f-run-20260827-a1b2c3',
    )
  })
})

describe('M10-F pilot chapter failure classification', () => {
  it('aborts immediately for evidence capture failure after publication', () => {
    const cause = new Error('capture query failed')
    const error = new LiveChapterCaptureError(12, cause)

    expect(classifyPilotChapterFailure(error)).toEqual({
      disposition: 'ABORT_EVIDENCE_CAPTURE',
      error,
    })
    expect(error.message).toBe('LIVE_CHAPTER_CAPTURE_FAILED:Bab 12:capture query failed')
    expect(error.cause).toBe(cause)
  })

  it.each([
    'TRANSIENT',
    'CAPACITY_TIMEOUT',
    'CHOICE_WORKFLOW_TIMEOUT',
  ])('retries only explicit retryable failure %s on same chapter', (reason) => {
    const error = new PilotGenerationFailure(reason)
    expect(classifyPilotChapterFailure(error)).toEqual({
      disposition: 'RETRYABLE_CHAPTER_FAILURE',
      error,
    })
  })

  it('stops immediately on FAILED_REVIEW_REQUIRED', () => {
    const error = new PilotGenerationFailure('FAILED_REVIEW_REQUIRED')
    expect(classifyPilotChapterFailure(error)).toEqual({
      disposition: 'STOP_REVIEW_REQUIRED',
      error,
    })
  })

  it.each([
    new PilotGenerationFailure('CANON_MISSING'),
    new PilotGenerationFailure('CHOICE_GENERATION_FAILED'),
    new Error('provider timeout text without typed reason'),
    'unknown failure',
  ])('stops instead of skipping unclassified failure: %s', (error) => {
    expect(classifyPilotChapterFailure(error)).toEqual({
      disposition: 'STOP_NON_RETRYABLE',
      error,
    })
  })

  it('aborts post-publish failure instead of retrying published chapter', () => {
    const error = new PublishedChapterPostPublishError(8, new Error('choice submit failed'))
    expect(classifyPilotChapterFailure(error)).toEqual({
      disposition: 'ABORT_PUBLISHED_CHAPTER',
      error,
    })
  })
})

describe('M10-F pilot capture artifact scope', () => {
  it('advertises complete deterministic LIVE_CHAPTER_LOCAL evidence for fresh chapter 1 horizon', () => {
    expect(describePilotCaptureArtifacts({
      path: '.zcode/artifacts/fresh/chapter-captures.jsonl',
      startChapter: 1,
      totalChapters: 50,
      captureCount: 50,
    })).toEqual({
      chapterCaptures: {
        path: '.zcode/artifacts/fresh/chapter-captures.jsonl',
        description: 'complete deterministic chapter-local evidence',
        captureMode: 'LIVE_CHAPTER_LOCAL',
        captureRange: { startChapter: 1, endChapter: 50 },
        captureCount: 50,
        completeHorizon: true,
      },
      deterministicCaptureMode: 'LIVE_CHAPTER_LOCAL',
    })
  })

  it('does not advertise complete evidence for an incomplete fresh invocation', () => {
    expect(describePilotCaptureArtifacts({
      path: '.zcode/artifacts/fresh-partial/chapter-captures.jsonl',
      startChapter: 1,
      totalChapters: 50,
      captureCount: 12,
    })).toEqual({
      chapterCaptures: {
        path: '.zcode/artifacts/fresh-partial/chapter-captures.jsonl',
        description: 'invocation segment-only diagnostic',
        captureMode: 'LIVE_CHAPTER_LOCAL',
        captureRange: { startChapter: 1, endChapter: 12 },
        captureCount: 12,
        completeHorizon: false,
      },
    })
  })

  it('labels resumed captures as invocation segment-only diagnostic without complete evidence claim', () => {
    expect(describePilotCaptureArtifacts({
      path: '.zcode/artifacts/resume/chapter-captures.jsonl',
      startChapter: 21,
      totalChapters: 50,
      captureCount: 30,
    })).toEqual({
      chapterCaptures: {
        path: '.zcode/artifacts/resume/chapter-captures.jsonl',
        description: 'invocation segment-only diagnostic',
        captureMode: 'LIVE_CHAPTER_LOCAL',
        captureRange: { startChapter: 21, endChapter: 50 },
        captureCount: 30,
        completeHorizon: false,
      },
    })
  })
})

describe('M10-F pilot invocation summary', () => {
  it('separates resume baseline from current invocation and averages current segment only', () => {
    expect(computePilotInvocationSummary({
      startChapter: 21,
      totalChapters: 30,
      preexistingPublished: 20,
      publishedThisInvocation: 10,
      failedAttemptsThisInvocation: 2,
      totalWordsThisInvocation: 9_005,
      finalPublishedTotal: 30,
    })).toEqual({
      preexistingPublished: 20,
      requestedThisInvocation: 10,
      publishedThisInvocation: 10,
      failedAttemptsThisInvocation: 2,
      finalPublishedTotal: 30,
      avgWordsPerChapter: 901,
      diagnosticOnly: true,
    })
  })
})
