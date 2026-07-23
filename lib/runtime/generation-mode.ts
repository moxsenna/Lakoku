/**
 * Resolve standard vs personalized generation mode from durable contract source.
 * Never silently fall back personalized → standard when contract is invalid.
 */
import 'server-only'
import { createAdminClient } from '@lakoku/db'

export type StoryGenerationMode = 'standard' | 'personalized_ai'

export type ResolveModeResult =
  | { ok: true; mode: StoryGenerationMode }
  | { ok: false; error: 'GENERATION_CONTRACT_INVALID'; detail?: string }

/**
 * Contract mode is the source of truth.
 * - no contract row → standard
 * - mode personalized_ai → personalized
 * - mode standard / other known → standard
 * - contract present but mode unreadable → invalid (not silent standard)
 */
export async function resolveStoryGenerationMode(
  storyId: string,
): Promise<ResolveModeResult> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('story_generation_contracts')
    .select('mode, contract_source')
    .eq('story_id', storyId)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      error: 'GENERATION_CONTRACT_INVALID',
      detail: 'CONTRACT_READ_FAILED',
    }
  }

  if (!data) {
    return { ok: true, mode: 'standard' }
  }

  const mode = typeof data.mode === 'string' ? data.mode.trim() : ''
  if (mode === 'personalized_ai') {
    return { ok: true, mode: 'personalized_ai' }
  }
  if (
    mode === 'standard' ||
    mode === 'authoring_snapshot' ||
    mode === '' ||
    mode === 'template'
  ) {
    // authoring_snapshot / empty treated as standard generation path
    return { ok: true, mode: 'standard' }
  }

  // Unknown mode on an existing contract: fail closed for personalized-ish modes
  if (mode.includes('personalized') || mode.includes('personal')) {
    return {
      ok: false,
      error: 'GENERATION_CONTRACT_INVALID',
      detail: `UNKNOWN_MODE:${mode}`,
    }
  }

  // Other unknown modes: still fail rather than guess if contract exists with garbage
  if (mode.length > 0 && mode !== 'standard') {
    return {
      ok: false,
      error: 'GENERATION_CONTRACT_INVALID',
      detail: `UNKNOWN_MODE:${mode}`,
    }
  }

  return { ok: true, mode: 'standard' }
}

export type ChapterGenerationDispatchInput = {
  storyId: string
  userId: string
  chapterNumber: number
  correlationId: string
  attemptId?: string | null
}

/**
 * Central dispatcher: all entry points should call this instead of picking
 * a generator directly.
 */
export async function runChapterGenerationAttempt(
  input: ChapterGenerationDispatchInput,
): Promise<
  | { ok: true; result: unknown; mode: StoryGenerationMode }
  | { ok: false; reason: string; mode?: StoryGenerationMode }
> {
  const resolved = await resolveStoryGenerationMode(input.storyId)
  if (!resolved.ok) {
    return { ok: false, reason: resolved.error }
  }

  if (resolved.mode === 'personalized_ai') {
    const { generateNextPersonalizedChapter } = await import(
      '@/lib/runtime/personalized-generation'
    )
    const result = await generateNextPersonalizedChapter({
      storyId: input.storyId,
      userId: input.userId,
      chapterNumber: input.chapterNumber,
      correlationId: input.correlationId,
    })
    return { ok: true, result, mode: 'personalized_ai' }
  }

  const { generateNextChapterReal } = await import('@/lib/runtime/story-generation')
  const result = await generateNextChapterReal({
    storyId: input.storyId,
    userId: input.userId,
    chapterNumber: input.chapterNumber,
    correlationId: input.correlationId,
    attemptId: input.attemptId ?? input.correlationId,
  })
  return { ok: true, result, mode: 'standard' }
}
