import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type PreflightStatus =
  | 'AUTHORIZED'
  | 'WAITING_FOR_CREDITS'
  | 'DENIED'

export interface CommercialWorkerPreflightResult {
  status: PreflightStatus
  origin?: string | null
  reason?: string
}

export async function resolveCommercialWorkerPreflight(input: {
  jobId: string
  userId: string
  storyId: string
  chapterNumber: number
  triggerChoiceId?: string | null
}): Promise<CommercialWorkerPreflightResult> {
  const db = createAdminClient()

  // 1. Load pricing config from DB
  const { data: pricingRows, error: pricingErr } = await db
    .from('feature_credit_costs')
    .select('feature_key, credits_required, is_active')
    .in('feature_key', ['story_start', 'chapter_unlock'])

  if (pricingErr || !pricingRows) {
    return { status: 'DENIED', reason: 'INTERNAL_CONFIG_ERROR' }
  }

  const storyStartPrice = pricingRows.find((r) => r.feature_key === 'story_start' && r.is_active)?.credits_required
  const chapterUnlockPrice = pricingRows.find((r) => r.feature_key === 'chapter_unlock' && r.is_active)?.credits_required

  if (storyStartPrice == null || chapterUnlockPrice == null || storyStartPrice <= 0 || chapterUnlockPrice <= 0) {
    return { status: 'DENIED', reason: 'INTERNAL_CONFIG_ERROR' }
  }

  // 2. Load story
  const { data: story, error: storyErr } = await db
    .from('stories')
    .select('id, owner_user_id, story_mode, commercial_origin, visibility')
    .eq('id', input.storyId)
    .maybeSingle()

  if (storyErr || !story) {
    return { status: 'DENIED', reason: storyErr ? 'INTERNAL_CONFIG_ERROR' : 'STORY_NOT_FOUND' }
  }

  // Non-commercial stories or non-owned stories stay outside commercial preflight
  if (story.story_mode !== 'personalized_ai' && story.story_mode !== 'premium_instance' || story.owner_user_id !== input.userId) {
    return { status: 'AUTHORIZED', origin: story.commercial_origin }
  }

  if (story.visibility !== 'private' && story.visibility !== 'unlisted') {
    return { status: 'DENIED', reason: 'NOT_ELIGIBLE_STORY' }
  }

  const origin = story.commercial_origin

  // 3. Included paths (Bab 1-3)
  if (origin === 'STARTER_FREE' && input.chapterNumber <= 3) {
    const { data: accountState } = await db
      .from('account_commercial_states')
      .select('starter_story_id, starter_claimed_at')
      .eq('user_id', input.userId)
      .maybeSingle()

    if (!accountState || accountState.starter_story_id !== input.storyId || !accountState.starter_claimed_at) {
      return { status: 'DENIED', reason: 'STARTER_IDENTITY_MISMATCH' }
    }
    return { status: 'AUTHORIZED', origin }
  }

  if ((origin === 'PAID_START' || origin === 'LEGACY_GRANDFATHERED') && input.chapterNumber <= 3) {
    const { data: req } = await db
      .from('story_creation_requests')
      .select('id, generation_job_id')
      .eq('owner_user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('generation_job_id', input.jobId)
      .maybeSingle()

    if (input.chapterNumber !== 1 || !req) {
      return { status: 'AUTHORIZED', origin }
    }
  }

  // 4. Bab 1 Paid Creation Preflight
  if (input.chapterNumber === 1 && origin === 'PENDING_PAID_START') {
    const expectedKind = story.story_mode === 'premium_instance' ? 'premium_clone' : 'personalized'

    const { data: req, error: reqErr } = await db
      .from('story_creation_requests')
      .select('id, status, generation_job_id')
      .eq('owner_user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('request_kind', expectedKind)
      .maybeSingle()

    if (reqErr || !req || req.generation_job_id !== input.jobId) {
      return { status: 'DENIED', reason: 'CREATION_REQUEST_NOT_BOUND' }
    }

    const resRef = `story-start:${input.userId}:${input.storyId}`
    const { data: resRow } = await db
      .from('credit_reservations')
      .select('id, status, expires_at')
      .eq('ref', resRef)
      .eq('user_id', input.userId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (!resRow) {
      // Transition creation request to WAITING_FOR_CREDITS
      await db
        .from('story_creation_requests')
        .update({ status: 'WAITING_FOR_CREDITS', updated_at: new Date().toISOString() })
        .eq('id', req.id)

      return { status: 'WAITING_FOR_CREDITS' }
    }

    if (req.status !== 'RESERVED') {
      return { status: 'DENIED', reason: 'CREATION_REQUEST_NOT_RESERVED' }
    }

    return { status: 'AUTHORIZED', origin }
  }

  // 5. Bab 4+ Commercial Unlock Preflight
  if (input.chapterNumber >= 4) {
    if (origin !== 'PAID_START' && origin !== 'LEGACY_GRANDFATHERED') {
      return { status: 'DENIED', reason: 'STORY_START_PENDING' }
    }

    const { data: intent, error: intentErr } = await db
      .from('commercial_generation_intents')
      .select('id, status, generation_job_id, trigger_choice_id, quoted_credits')
      .eq('user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('chapter_number', input.chapterNumber)
      .eq('generation_job_id', input.jobId)
      .maybeSingle()

    if (intentErr || !intent || intent.trigger_choice_id !== (input.triggerChoiceId ?? null)) {
      return { status: 'DENIED', reason: 'COMMERCIAL_INTENT_NOT_BOUND' }
    }

    const resRef = `chapter-reservation:${input.userId}:${input.storyId}:${input.chapterNumber}`
    const { data: resRow } = await db
      .from('credit_reservations')
      .select('id, status, amount, expires_at')
      .eq('ref', resRef)
      .eq('user_id', input.userId)
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (!resRow || resRow.amount !== intent.quoted_credits) {
      // Transition intent to WAITING_FOR_CREDITS using state-machine RPC
      await db.rpc('transition_commercial_generation_intent_v1', {
        p_intent_id: intent.id,
        p_user_id: input.userId,
        p_from_status: intent.status,
        p_to_status: 'WAITING_FOR_CREDITS',
      })

      return { status: 'WAITING_FOR_CREDITS' }
    }

    if (intent.status !== 'QUEUED' && intent.status !== 'RUNNING' && intent.status !== 'AUTHORIZED') {
      return { status: 'DENIED', reason: 'COMMERCIAL_INTENT_INVALID_STATE' }
    }

    return { status: 'AUTHORIZED', origin }
  }

  return { status: 'AUTHORIZED', origin }
}
