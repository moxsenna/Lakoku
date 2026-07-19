import 'server-only'
import { after } from 'next/server'
import {
  generateNextPersonalizedChapter,
  type PersonalizedGenerateInput,
} from '@/lib/runtime/personalized-generation'
import {
  generateNextChapterReal,
  type RealGenerateResult,
} from '@/lib/runtime/story-generation'

export const CONTINUATION_WAIT_MS = 25_000

type ContinuationJob = Promise<RealGenerateResult>

const jobs = new Map<string, ContinuationJob>()

export function continuationJobKey(storyId: string, chapterNumber: number): string {
  return `${storyId}:${chapterNumber}`
}

function isReady(result: RealGenerateResult): boolean {
  if (result.ok) return true
  return result.reason === 'CHAPTER_EXISTS'
}

function startOrReuseJob(
  key: string,
  launch: () => ContinuationJob,
): ContinuationJob {
  const existing = jobs.get(key)
  if (existing) return existing

  const promise = launch().finally(() => {
    // Keep settled jobs briefly reusable only while still referenced by after/wait.
    // Drop from map once settled so later requests can relaunch if needed.
    if (jobs.get(key) === promise) jobs.delete(key)
  })
  jobs.set(key, promise)
  return promise
}

function waitMs(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms)
  })
}

async function raceContinuation(promise: ContinuationJob): Promise<{ nextChapterReady: boolean }> {
  // Same in-flight promise continues after response via after()/waitUntil.
  after(() => promise)

  // Keep after() registered on the raw promise so timeout/reject still continues.
  // Map reject to non-ready so choice response never 500 after apply succeeded.
  const raced = await Promise.race([
    promise.then(
      (result) => ({ kind: 'result' as const, result }),
      () => ({ kind: 'failed' as const }),
    ),
    waitMs(CONTINUATION_WAIT_MS).then(() => ({ kind: 'timeout' as const })),
  ])

  if (raced.kind === 'timeout' || raced.kind === 'failed') {
    return { nextChapterReady: false }
  }

  return { nextChapterReady: isReady(raced.result) }
}

export async function continuePersonalizedGeneration(input: {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
  triggerChoiceId?: string
}): Promise<{ nextChapterReady: boolean }> {
  const generationInput: PersonalizedGenerateInput = {
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: input.chapterNumber,
    correlationId: input.correlationId,
    triggerChoiceId: input.triggerChoiceId,
  }

  const key = continuationJobKey(input.storyId, input.chapterNumber)
  const promise = startOrReuseJob(key, () => generateNextPersonalizedChapter(generationInput))
  return raceContinuation(promise)
}

/**
 * Standard/onboarding stories: kick off next chapter via generateNextChapterReal.
 * Same 25s race + after() semantics as personalized path.
 */
export async function continueStandardGeneration(input: {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
}): Promise<{ nextChapterReady: boolean }> {
  const key = continuationJobKey(input.storyId, input.chapterNumber)
  const promise = startOrReuseJob(key, () => generateNextChapterReal(input))
  return raceContinuation(promise)
}
