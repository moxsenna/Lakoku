import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

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
  const db = createAdminClient()
  const { data, error } = await db
    .from('commercial_generation_intents')
    .select('*')
    .eq('user_id', input.userId)
    .eq('story_id', input.storyId)
    .eq('chapter_number', input.chapterNumber)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id,
    userId: data.user_id,
    storyId: data.story_id,
    chapterNumber: data.chapter_number,
    triggerChoiceId: data.trigger_choice_id,
    generationJobId: data.generation_job_id,
    status: data.status,
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

  const db = createAdminClient()
  const { data: reader } = await db
    .from('reader_states')
    .select('choice_history')
    .eq('user_id', input.userId)
    .eq('story_id', input.storyId)
    .maybeSingle()

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
  const { data: outcome } = await db
    .from('choice_outcomes')
    .select('next_chapter_number')
    .eq('story_id', input.storyId)
    .eq('chapter_number', previousChapterNumber)
    .eq('choice_id', triggerChoiceId)
    .maybeSingle()

  if (!outcome || outcome.next_chapter_number !== input.targetChapterNumber) {
    return null
  }

  // Call DB-authoritative RPC to ensure intent with active DB pricing
  const { error } = await db.rpc('ensure_commercial_generation_intent_v1', {
    p_user_id: input.userId,
    p_story_id: input.storyId,
    p_chapter_number: input.targetChapterNumber,
    p_trigger_choice_id: triggerChoiceId,
  })

  if (error) {
    return null
  }

  return getCommercialIntent({ userId: input.userId, storyId: input.storyId, chapterNumber: input.targetChapterNumber })
}
