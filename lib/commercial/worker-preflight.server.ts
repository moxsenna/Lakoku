import { createClient } from '@supabase/supabase-js'

export type PreflightResultStatus = 'AUTHORIZED' | 'WAITING_FOR_CREDITS' | 'DENIED'

export interface PreflightResult {
  status: PreflightResultStatus
  origin?: 'STARTER_FREE' | 'PAID_START' | 'LEGACY_GRANDFATHERED' | 'ADMIN_GRANTED' | 'PENDING_PAID_START'
  reason?: string
}

export interface WorkerPreflightInput {
  userId: string
  storyId: string
  chapterNumber: number
  jobId: string
  jobStatus: string
  claimedByWorkerId: string | null
  claimToken: string | null
  triggerChoiceId: string | null
  expectedClaimToken: string
}

export async function evaluateCommercialWorkerPreflight(
  input: WorkerPreflightInput,
): Promise<PreflightResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const db = createClient(url, key)

  // 1. Validate exact claimed job state before financial preflight (Requirement 4)
  if (
    input.jobStatus !== 'RUNNING' ||
    !input.claimedByWorkerId ||
    !input.claimToken ||
    input.claimToken !== input.expectedClaimToken
  ) {
    return { status: 'DENIED', reason: 'JOB_NOT_CLAIMED_BY_WORKER' }
  }

  // Authoritative second-read of generation_jobs row (Requirement 4)
  const { data: jobRow, error: jobErr } = await db
    .from('generation_jobs')
    .select('id, user_id, story_id, chapter_number, status, worker_id, claim_token, generation_kind, trigger_choice_id')
    .eq('id', input.jobId)
    .maybeSingle()

  if (
    jobErr ||
    !jobRow ||
    jobRow.status !== 'RUNNING' ||
    jobRow.worker_id !== input.claimedByWorkerId ||
    jobRow.claim_token !== input.claimToken ||
    jobRow.user_id !== input.userId ||
    jobRow.story_id !== input.storyId ||
    jobRow.chapter_number !== input.chapterNumber ||
    jobRow.generation_kind !== 'personalized' ||
    (jobRow.trigger_choice_id ?? null) !== (input.triggerChoiceId ?? null)
  ) {
    return { status: 'DENIED', reason: 'JOB_STATE_MISMATCH' }
  }

  // 2. Load fail-closed active pricing config
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

  // 3. Load story with owner and mode validation
  const { data: story, error: storyErr } = await db
    .from('stories')
    .select('id, owner_user_id, story_mode, commercial_origin, visibility')
    .eq('id', input.storyId)
    .maybeSingle()

  if (storyErr || !story) {
    return { status: 'DENIED', reason: 'STORY_NOT_FOUND' }
  }

  // Commercial owner mismatch or non-commercial story mode on personalized job -> DENY (fail closed)
  if (story.owner_user_id !== input.userId || (story.story_mode !== 'personalized_ai' && story.story_mode !== 'premium_instance')) {
    return { status: 'DENIED', reason: 'COMMERCIAL_OWNER_MISMATCH' }
  }

  if (story.visibility !== 'private' && story.visibility !== 'unlisted') {
    return { status: 'DENIED', reason: 'NOT_ELIGIBLE_STORY' }
  }

  const origin = story.commercial_origin

  // 4. Exhaustive Commercial Origin Matrix
  // ---------------------------------------------------------------------------
  // STARTER_FREE Bab 1-3
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

  // LEGACY_GRANDFATHERED Bab 1-3 -> included
  if (origin === 'LEGACY_GRANDFATHERED' && input.chapterNumber <= 3) {
    return { status: 'AUTHORIZED', origin }
  }

  // PAID_START Bab 2-3 -> included
  if (origin === 'PAID_START' && input.chapterNumber >= 2 && input.chapterNumber <= 3) {
    return { status: 'AUTHORIZED', origin }
  }

  // PAID_START Bab 1 with fresh RUNNING job -> DENY (Requirement 6)
  // Legitimate Story Start generation enters worker while origin is PENDING_PAID_START.
  // After successful capture, origin is PAID_START and replay belongs to V6 publication proof.
  if (origin === 'PAID_START' && input.chapterNumber === 1) {
    return { status: 'DENIED', reason: 'PAID_START_BAB1_REPLAY_FORBIDDEN' }
  }

  // PENDING_PAID_START Bab 2+ -> DENY
  if (origin === 'PENDING_PAID_START' && input.chapterNumber >= 2) {
    return { status: 'DENIED', reason: 'STORY_START_PENDING' }
  }

  // ---------------------------------------------------------------------------
  // 5. Bab 1 Paid Creation Preflight (PENDING_PAID_START)
  // ---------------------------------------------------------------------------
  if (input.chapterNumber === 1 && origin === 'PENDING_PAID_START') {
    const expectedKind = story.story_mode === 'premium_instance' ? 'premium_clone' : 'personalized'

    const { data: req, error: reqErr } = await db
      .from('story_creation_requests')
      .select('status, generation_job_id')
      .eq('owner_user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('request_kind', expectedKind)
      .maybeSingle()

    if (reqErr || !req || req.generation_job_id !== input.jobId) {
      return { status: 'DENIED', reason: 'CREATION_REQUEST_NOT_BOUND' }
    }

    const resRef = `story-start:${input.userId}:${input.storyId}`

    // Pass 1: Check active reservation
    let { data: resRow } = await db
      .from('credit_reservations')
      .select('id, status, amount, expires_at')
      .eq('ref', resRef)
      .eq('user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('chapter_number', 1)
      .eq('reservation_kind', 'STORY_START')
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (resRow && resRow.amount !== storyStartPrice) {
      return { status: 'DENIED', reason: 'STORY_START_AMOUNT_MISMATCH' }
    }

    let reserveInsufficient = false

    // Pass 2 Reactivation: Attempt reserve_story_start_v1 using Phase 1 signature (current catalog price)
    if (!resRow) {
      const { data: reserveRpcRes, error: reserveRpcErr } = await db.rpc('reserve_story_start_v1', {
        p_user_id: input.userId,
        p_story_id: input.storyId,
      })

      if (!reserveRpcErr && reserveRpcRes?.ok === true && reserveRpcRes?.status === 'RESERVED') {
        // Authoritative SECOND READ
        const { data: secondRes } = await db
          .from('credit_reservations')
          .select('id, status, amount, expires_at')
          .eq('ref', resRef)
          .eq('user_id', input.userId)
          .eq('story_id', input.storyId)
          .eq('chapter_number', 1)
          .eq('reservation_kind', 'STORY_START')
          .eq('status', 'ACTIVE')
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (secondRes && secondRes.amount === storyStartPrice) {
          resRow = secondRes
        } else if (secondRes) {
          return { status: 'DENIED', reason: 'STORY_START_AMOUNT_MISMATCH' }
        }
      } else if (!reserveRpcErr && reserveRpcRes?.ok === false && reserveRpcRes?.reason === 'INSUFFICIENT_CREDITS') {
        reserveInsufficient = true
      } else {
        // RPC error, DB failure, or unexpected reason -> DENY (fail closed, never map to WAITING)
        return { status: 'DENIED', reason: reserveRpcRes?.reason ?? 'COMMERCIAL_RESERVATION_FAILED' }
      }
    }

    if (!resRow || resRow.amount !== storyStartPrice) {
      if (!reserveInsufficient) {
        return { status: 'DENIED', reason: 'COMMERCIAL_RESERVATION_FAILED' }
      }

      // Transition creation request to WAITING_FOR_CREDITS using DB-authoritative RPC
      const { data: transRes, error: transErr } = await db.rpc('transition_story_creation_request_waiting_v1', {
        p_owner_user_id: input.userId,
        p_story_id: input.storyId,
        p_request_kind: expectedKind,
        p_generation_job_id: input.jobId,
      })

      // Authoritative re-read proof
      const { data: reReadReq } = await db
        .from('story_creation_requests')
        .select('status, generation_job_id')
        .eq('owner_user_id', input.userId)
        .eq('story_id', input.storyId)
        .eq('request_kind', expectedKind)
        .maybeSingle()

      if (!transErr && transRes && transRes.ok && reReadReq?.status === 'WAITING_FOR_CREDITS' && reReadReq?.generation_job_id === input.jobId) {
        return { status: 'WAITING_FOR_CREDITS', origin, reason: 'INSUFFICIENT_CREDITS' }
      }

      return { status: 'DENIED', reason: 'COMMERCIAL_STATE_ERROR' }
    }

    if (req.status !== 'RESERVED') {
      return { status: 'DENIED', reason: 'CREATION_REQUEST_NOT_RESERVED' }
    }

    return { status: 'AUTHORIZED', origin }
  }

  // ---------------------------------------------------------------------------
  // 6. Bab 4+ Commercial Chapter Unlock Preflight (STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED)
  // ---------------------------------------------------------------------------
  if (input.chapterNumber >= 4) {
    if (origin !== 'STARTER_FREE' && origin !== 'PAID_START' && origin !== 'LEGACY_GRANDFATHERED') {
      return { status: 'DENIED', reason: 'STORY_START_PENDING' }
    }

    // Revalidate Starter identity for STARTER_FREE Bab4+
    if (origin === 'STARTER_FREE') {
      const { data: accountState } = await db
        .from('account_commercial_states')
        .select('starter_story_id, starter_claimed_at')
        .eq('user_id', input.userId)
        .maybeSingle()

      if (!accountState || accountState.starter_story_id !== input.storyId || !accountState.starter_claimed_at) {
        return { status: 'DENIED', reason: 'STARTER_IDENTITY_MISMATCH' }
      }
    }

    const { data: intent, error: intentErr } = await db
      .from('commercial_generation_intents')
      .select('id, status, generation_job_id, trigger_choice_id, quoted_credits')
      .eq('user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('chapter_number', input.chapterNumber)
      .eq('generation_job_id', input.jobId)
      .maybeSingle()

    if (
      intentErr ||
      !intent ||
      (intent.trigger_choice_id ?? null) !== (jobRow.trigger_choice_id ?? null) ||
      (intent.trigger_choice_id ?? null) !== (input.triggerChoiceId ?? null)
    ) {
      return { status: 'DENIED', reason: 'COMMERCIAL_INTENT_NOT_BOUND' }
    }

    // REQUIREMENT 5: Worker intent status MUST be exact 'QUEUED' before provider generation
    if (intent.status !== 'QUEUED') {
      return { status: 'DENIED', reason: 'COMMERCIAL_INTENT_NOT_QUEUED' }
    }

    const resRef = `chapter-reservation:${input.userId}:${input.storyId}:${input.chapterNumber}`

    // Pass 1: Check active reservation
    let { data: resRow } = await db
      .from('credit_reservations')
      .select('id, status, amount, expires_at')
      .eq('ref', resRef)
      .eq('user_id', input.userId)
      .eq('story_id', input.storyId)
      .eq('chapter_number', input.chapterNumber)
      .eq('reservation_kind', 'CHAPTER_UNLOCK')
      .eq('status', 'ACTIVE')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    let reserveInsufficient = false

    // Pass 2 Reactivation: Attempt quote-preserving DB RPC reactivate_commercial_chapter_reservation_v1
    if (!resRow || resRow.amount !== intent.quoted_credits) {
      const { data: reserveRpcRes, error: reserveRpcErr } = await db.rpc('reactivate_commercial_chapter_reservation_v1', {
        p_user_id: input.userId,
        p_story_id: input.storyId,
        p_chapter_number: input.chapterNumber,
        p_generation_job_id: input.jobId,
      })

      if (!reserveRpcErr && reserveRpcRes?.ok === true && (reserveRpcRes?.status === 'ACTIVE' || reserveRpcRes?.status === 'RESERVED')) {
        // Authoritative SECOND READ
        const { data: secondRes } = await db
          .from('credit_reservations')
          .select('id, status, amount, expires_at')
          .eq('ref', resRef)
          .eq('user_id', input.userId)
          .eq('story_id', input.storyId)
          .eq('chapter_number', input.chapterNumber)
          .eq('reservation_kind', 'CHAPTER_UNLOCK')
          .eq('status', 'ACTIVE')
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (secondRes && secondRes.amount === intent.quoted_credits) {
          resRow = secondRes
        }
      } else if (!reserveRpcErr && reserveRpcRes?.ok === false && reserveRpcRes?.reason === 'INSUFFICIENT_CREDITS') {
        reserveInsufficient = true
      } else {
        // RPC error, DB failure, missing reservation, or unexpected reason -> DENY (fail closed)
        return { status: 'DENIED', reason: reserveRpcRes?.reason ?? 'COMMERCIAL_RESERVATION_FAILED' }
      }
    }

    if (!resRow || resRow.amount !== intent.quoted_credits) {
      if (!reserveInsufficient) {
        return { status: 'DENIED', reason: 'COMMERCIAL_RESERVATION_FAILED' }
      }

      // Transition intent to WAITING_FOR_CREDITS using correct 5 RPC params
      const { data: transRes, error: transErr } = await db.rpc('transition_commercial_generation_intent_v1', {
        p_user_id: input.userId,
        p_story_id: input.storyId,
        p_chapter_number: input.chapterNumber,
        p_target_status: 'WAITING_FOR_CREDITS',
        p_generation_job_id: input.jobId,
      })

      // Authoritative re-read proof
      const { data: reReadIntent } = await db
        .from('commercial_generation_intents')
        .select('status, generation_job_id')
        .eq('user_id', input.userId)
        .eq('story_id', input.storyId)
        .eq('chapter_number', input.chapterNumber)
        .maybeSingle()

      if (!transErr && transRes && transRes.ok && reReadIntent?.status === 'WAITING_FOR_CREDITS' && reReadIntent?.generation_job_id === input.jobId) {
        return { status: 'WAITING_FOR_CREDITS', origin, reason: 'INSUFFICIENT_CREDITS' }
      }

      return { status: 'DENIED', reason: 'COMMERCIAL_STATE_ERROR' }
    }

    return { status: 'AUTHORIZED', origin }
  }

  return { status: 'DENIED', reason: 'INVALID_PREFLIGHT_CHAPTER' }
}

export const resolveCommercialWorkerPreflight = evaluateCommercialWorkerPreflight
