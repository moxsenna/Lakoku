import 'server-only'
import { getDb, rpcOne, single } from '@lakoku/db'

export interface CommercialIntentRow {
  id: string
  userId: string
  storyId: string
  chapterNumber: number
  triggerChoiceId: string
  generationJobId: string | null
  status: 'WAITING_FOR_CREDITS' | 'AUTHORIZED' | 'QUEUED' | 'FULFILLED' | 'FAILED'
  quotedCredits: number
  pricingVersion: string
}

export async function getCommercialIntent(input: {
  userId: string
  storyId: string
  chapterNumber: number
}): Promise<CommercialIntentRow | null> {
  const db = getDb()
  // RLS_AUDIT: commercial_generation_intents difilter per user_id, story_id, dan chapter_number
  const { data, error } = await single(
    db
      .selectFrom('commercial_generation_intents')
      .selectAll()
      .where('user_id', '=', input.userId)
      .where('story_id', '=', input.storyId)
      .where('chapter_number', '=', input.chapterNumber)
      .execute(),
  )

  if (error || !data) return null
  return {
    id: data.id,
    userId: data.user_id,
    storyId: data.story_id,
    chapterNumber: data.chapter_number,
    triggerChoiceId: data.trigger_choice_id,
    generationJobId: data.generation_job_id,
    status: data.status as CommercialIntentRow['status'],
    quotedCredits: data.quoted_credits,
    pricingVersion: data.pricing_version,
  }
}

export async function repairCommercialIntentFromHistory(input: {
  userId: string
  storyId: string
  targetChapterNumber: number
}): Promise<CommercialIntentRow | null> {
  const previousChapterNumber = input.targetChapterNumber - 1
  if (previousChapterNumber < 1) return null

  const db = getDb()
  // RLS_AUDIT: reader_states difilter per user_id dan story_id
  const { data: reader } = await single(
    db
      .selectFrom('reader_states')
      .select('choice_history')
      .where('user_id', '=', input.userId)
      .where('story_id', '=', input.storyId)
      .execute(),
  )

  if (!reader || !Array.isArray(reader.choice_history)) return null

  // Locate exact choice_history entry for chapter N-1
  const matchingEntry = (reader.choice_history as Array<Record<string, unknown>>).find((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    return Number(entry.chapterNumber) === previousChapterNumber
  })

  if (!matchingEntry || typeof matchingEntry.choiceId !== 'string') {
    return null
  }

  const triggerChoiceId = matchingEntry.choiceId

  // Verify choice_outcomes(story_id, chapter_number=N-1, choice_id).next_chapter_number = N
  // RLS_AUDIT: choice_outcomes membaca next_chapter_number berdasarkan story_id, chapter_number, choice_id
  const { data: outcome } = await single(
    db
      .selectFrom('choice_outcomes')
      .select('next_chapter_number')
      .where('story_id', '=', input.storyId)
      .where('chapter_number', '=', previousChapterNumber)
      .where('choice_id', '=', triggerChoiceId)
      .execute(),
  )

  if (!outcome || outcome.next_chapter_number !== input.targetChapterNumber) {
    return null
  }

  // Call DB-authoritative RPC to ensure intent with active DB pricing
  // RLS_AUDIT: ensure_commercial_generation_intent_v1 RPC idempotensial intent komersial
  const { error } = await single(
    rpcOne(db, 'ensure_commercial_generation_intent_v1', {
      p_user_id: input.userId,
      p_story_id: input.storyId,
      p_chapter_number: input.targetChapterNumber,
      p_trigger_choice_id: triggerChoiceId,
    }).execute(),
  )

  if (error) {
    return null
  }

  return getCommercialIntent({ userId: input.userId, storyId: input.storyId, chapterNumber: input.targetChapterNumber })
}
