import 'server-only'
import { after } from 'next/server'
import {
  generateNextPersonalizedChapter,
  type PersonalizedGenerateInput,
} from '@/lib/runtime/personalized-generation'
import type { RealGenerateResult } from '@/lib/runtime/story-generation'

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

function startOrReuseJob(input: PersonalizedGenerateInput): ContinuationJob {
  const key = continuationJobKey(input.storyId, input.chapterNumber)
  const existing = jobs.get(key)
  if (existing) return existing

  const promise = generateNextPersonalizedChapter(input).finally(() => {
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

export async function continuePersonalizedGeneration(input: {
  storyId: string
  userId: string
  chapterNumber: number
  triggerChoiceId?: string
}): Promise<{ nextChapterReady: boolean }> {
  const generationInput: PersonalizedGenerateInput = {
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: input.chapterNumber,
    triggerChoiceId: input.triggerChoiceId,
  }

  const promise = startOrReuseJob(generationInput)
  // Same in-flight promise continues after response via OpenNext/Cloudflare waitUntil.
  after(() => promise)

  const raced = await Promise.race([
    promise.then((result) => ({ kind: 'result' as const, result })),
    waitMs(CONTINUATION_WAIT_MS).then(() => ({ kind: 'timeout' as const })),
  ])

  if (raced.kind === 'timeout') {
    return { nextChapterReady: false }
  }

  return { nextChapterReady: isReady(raced.result) }
}
