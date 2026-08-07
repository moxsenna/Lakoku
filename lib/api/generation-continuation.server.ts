import 'server-only'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { claimAndRunGenerationJobById } from '@/lib/runtime/generation-worker'
import {
  generateNextChapterReal,
  type RealGenerateResult,
} from '@/lib/runtime/story-generation'

export const CONTINUATION_WAIT_MS = 25_000

type ContinuationJob = Promise<RealGenerateResult>
const standardJobs = new Map<string, ContinuationJob>()

export function continuationJobKey(storyId: string, chapterNumber: number): string {
  return `${storyId}:${chapterNumber}`
}

function isReady(result: RealGenerateResult): boolean {
  if (result.ok) return true
  return result.reason === 'CHAPTER_EXISTS'
}

function startOrReuseJob(
  map: Map<string, ContinuationJob>,
  key: string,
  launch: () => ContinuationJob,
): ContinuationJob {
  const existing = map.get(key)
  if (existing) return existing

  const promise = launch().finally(() => {
    if (map.get(key) === promise) map.delete(key)
  })
  map.set(key, promise)
  return promise
}

function waitMs(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms)
  })
}

async function raceContinuation(promise: ContinuationJob): Promise<{ nextChapterReady: boolean }> {
  after(() => promise)

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

export async function checkChapterReadiness(storyId: string, chapterNumber: number): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('chapters')
    .select('number')
    .eq('story_id', storyId)
    .eq('number', chapterNumber)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Cutover continuation for personalized AI generation.
 * Executes worker via claimAndRunGenerationJobById in after(), and races/polls chapter readiness.
 * No direct generateNextPersonalizedChapter call.
 */
export async function continuePersonalizedGeneration(input: {
  jobId: string
  storyId: string
  userId: string
  chapterNumber: number
  correlationId?: string
  triggerChoiceId?: string | null
}): Promise<{ nextChapterReady: boolean }> {
  // 1) Kick worker asynchronously in after() (or direct fire-and-forget if outside request scope)
  try {
    after(async () => {
      try {
        await claimAndRunGenerationJobById({ jobId: input.jobId, workerId: `continuation-${Date.now()}` })
      } catch (err) {
        console.error('continuation worker kick failed:', err)
      }
    })
  } catch (_scopeErr) {
    void claimAndRunGenerationJobById({ jobId: input.jobId, workerId: `continuation-${Date.now()}` }).catch((err) => {
      console.error('continuation worker kick fallback failed:', err)
    })
  }

  // 2) Poll/race chapter readiness up to 25s limit
  const startTime = Date.now()

  while (Date.now() - startTime < CONTINUATION_WAIT_MS) {
    const ready = await checkChapterReadiness(input.storyId, input.chapterNumber)
    if (ready) return { nextChapterReady: true }
    await waitMs(500)
  }

  const finalReady = await checkChapterReadiness(input.storyId, input.chapterNumber)
  return { nextChapterReady: finalReady }
}

/**
 * Standard/onboarding stories: kick off next chapter via generateNextChapterReal.
 * Preserves existing 25s race + after() semantics.
 */
export async function continueStandardGeneration(input: {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
  triggerChoiceId?: string | null
}): Promise<{ nextChapterReady: boolean }> {
  const generationInput = {
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: input.chapterNumber,
    correlationId: input.correlationId,
    ...('triggerChoiceId' in input ? { triggerChoiceId: input.triggerChoiceId } : {}),
  }
  const key = continuationJobKey(input.storyId, input.chapterNumber)
  const promise = startOrReuseJob(standardJobs, key, () => generateNextChapterReal(generationInput))
  return raceContinuation(promise)
}
