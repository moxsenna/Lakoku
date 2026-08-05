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

  // Find exact history entry for previous chapter that resulted in targetChapterNumber
  const matchingEntry = (reader.choice_history as Array<Record<string, unknown>>).find((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const ch = Number(entry.chapterNumber)
    const outcome = entry.outcome
    const nextCh = outcome && typeof outcome === 'object' && 'nextChapterNumber' in outcome ? Number((outcome as Record<string, unknown>).nextChapterNumber) : null
    return ch === previousChapterNumber && nextCh === input.targetChapterNumber
  })

  if (!matchingEntry || typeof matchingEntry.choiceId !== 'string') {
    return null
  }

  const triggerChoiceId = matchingEntry.choiceId

  // Load quote from DB
  const { data: costRow } = await db
    .from('feature_credit_costs')
    .select('credits_required, pricing_version')
    .eq('feature_key', 'chapter_unlock')
    .maybeSingle()

  const quotedCredits = costRow?.credits_required ?? 8
  const pricingVersion = costRow?.pricing_version ?? 'v1.1-202608'

  const { data: inserted, error } = await db
    .from('commercial_generation_intents')
    .insert({
      user_id: input.userId,
      story_id: input.storyId,
      chapter_number: input.targetChapterNumber,
      trigger_choice_id: triggerChoiceId,
      status: 'WAITING_FOR_CREDITS',
      quoted_credits: quotedCredits,
      pricing_version: pricingVersion,
    })
    .select('*')
    .single()

  if (error || !inserted) {
    return getCommercialIntent({ userId: input.userId, storyId: input.storyId, chapterNumber: input.targetChapterNumber })
  }

  return {
    id: inserted.id,
    userId: inserted.user_id,
    storyId: inserted.story_id,
    chapterNumber: inserted.chapter_number,
    triggerChoiceId: inserted.trigger_choice_id,
    generationJobId: inserted.generation_job_id,
    status: inserted.status,
    quotedCredits: inserted.quoted_credits,
    pricingVersion: inserted.pricing_version,
  }
}
