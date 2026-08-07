/**
 * M10-C recovery — commercial worker-preflight fault SETUP for the worker clone.
 *
 * Current main added step 3.5 to `executeClaimedJob`
 * (lib/runtime/generation-worker.ts): every personalized worker job must pass
 * `resolveCommercialWorkerPreflight` BEFORE any generator dispatch. The harness
 * cannot call `executeClaimedJob` wholesale — it runs
 * `runChapterGenerationAttempt` without `stateProposal` injection, and the
 * deterministic 1→50 parity harness must inject `harnessProposalFor`. So
 * `runWorkerChapter` reproduces the executor order (claim → lease → preflight →
 * generate) and this module supplies the financial preconditions the preflight
 * reads, for a HARNESS-OWNED user and HARNESS-OWNED stories on the ISOLATED
 * local DB only.
 *
 * Seam choice (maximize production path, minimize direct rows):
 *   - Intent lifecycle runs through the PRODUCTION RPCs only:
 *     `apply_personalized_choice_v2` (accepted-choice seam) creates the intent
 *     as WAITING_FOR_CREDITS; this module transitions it
 *     WAITING_FOR_CREDITS → AUTHORIZED → QUEUED via
 *     `transition_commercial_generation_intent_v1`, binding the exact job id.
 *   - The chapter reservation runs through the PRODUCTION
 *     `reserve_chapter_unlock_v1` RPC (owner/mode/visibility/origin matrix,
 *     DB price lookup, canonical ref, TTL, balance check — all enforced by it).
 *   - The ONLY direct row is a one-time idempotent `credit_ledger` grant for
 *     the harness user: `reserve_chapter_unlock_v1` requires
 *     `available_credit_balance_v1(user) >= cost`, and the isolated DB has no
 *     payment provider to top up with. Granting balance to a harness-owned
 *     account is legitimate isolated fault setup; nothing here ever touches a
 *     real user, a real story, or a non-loopback database (assertIsolatedTarget
 *     gates every caller upstream).
 */

import { createAdminClient } from '../../supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export class HarnessCommercialError extends Error {
  constructor(
    message: string,
    readonly chapterNumber: number,
  ) {
    super(`HarnessCommercialError: ${message}`)
    this.name = 'HarnessCommercialError'
  }
}

/** Generous one-time grant; 47 paid chapters x 8 credits = 376 per full run. */
const HARNESS_CREDIT_GRANT = 5000
const HARNESS_GRANT_REASON = 'm10c-harness-grant'
const harnessGrantRef = (userId: string) => `m10c:harness-grant:${userId}`

/**
 * Idempotent top-up for the harness user. Direct `credit_ledger` row (fault
 * setup — see module header); ref-uniqueness makes replays a no-op.
 */
export async function ensureHarnessCreditGrant(admin: Admin, userId: string): Promise<void> {
  const ref = harnessGrantRef(userId)
  const { data: existing, error: readError } = await admin
    .from('credit_ledger')
    .select('id')
    .eq('ref', ref)
    .maybeSingle()
  if (readError) throw new HarnessCommercialError(`credit_ledger read failed: ${readError.message}`, 0)
  if (existing) return

  const { error } = await admin.from('credit_ledger').insert({
    user_id: userId,
    delta: HARNESS_CREDIT_GRANT,
    reason: HARNESS_GRANT_REASON,
    ref,
  })
  if (error) throw new HarnessCommercialError(`credit grant insert failed: ${error.message}`, 0)
}

export interface PrepareCommercialPreflightInput {
  userId: string
  storyId: string
  chapterNumber: number
  /** The claimed generation_jobs row the intent must be bound to. */
  jobId: string
}

export interface CommercialPreflightSetup {
  chapterNumber: number
  reservationStatus: string
  intentStatus: string
  quotedCredits: number
}

/**
 * Brings the commercial state for one worker chapter to exactly what
 * `resolveCommercialWorkerPreflight` requires for AUTHORIZED:
 *   Bab 1-3  — nothing (LEGACY_GRANDFATHERED is auto-AUTHORIZED; the preflight
 *              still validates exact job provenance, which is the point).
 *   Bab 4+   — an ACTIVE CHAPTER_UNLOCK reservation at the quoted amount
 *              (production reserve RPC) and the choice-seam-created intent
 *              transitioned to QUEUED bound to this job (production transition
 *              RPCs), mirroring the paid-reader production order
 *              top-up → reserve → authorize → queue.
 */
export async function prepareCommercialChapterPreflight(
  admin: Admin,
  input: PrepareCommercialPreflightInput,
): Promise<CommercialPreflightSetup> {
  const { userId, storyId, chapterNumber, jobId } = input

  if (chapterNumber < 4) {
    return { chapterNumber, reservationStatus: 'FREE_INCLUDED', intentStatus: 'NONE', quotedCredits: 0 }
  }

  // 1) Production reserve RPC — fail closed on anything but RESERVED.
  const { data: reserve, error: reserveError } = await admin.rpc('reserve_chapter_unlock_v1', {
    p_user_id: userId,
    p_story_id: storyId,
    p_chapter_number: chapterNumber,
  })
  if (reserveError) {
    throw new HarnessCommercialError(
      `reserve_chapter_unlock_v1 failed at Bab ${chapterNumber}: ${reserveError.message}`,
      chapterNumber,
    )
  }
  if (reserve?.ok !== true || reserve.status !== 'RESERVED') {
    throw new HarnessCommercialError(
      `reservation not RESERVED at Bab ${chapterNumber}: ${JSON.stringify(reserve)}`,
      chapterNumber,
    )
  }

  // 2) The accepted-choice seam created this intent (WAITING_FOR_CREDITS) when
  //    the previous chapter's choice was submitted. Read it; never invent one.
  const { data: intentRow, error: intentError } = await admin
    .from('commercial_generation_intents')
    .select('status,generation_job_id,quoted_credits')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .maybeSingle()
  if (intentError) {
    throw new HarnessCommercialError(`intent read failed at Bab ${chapterNumber}: ${intentError.message}`, chapterNumber)
  }
  if (!intentRow) {
    throw new HarnessCommercialError(
      `no commercial intent for Bab ${chapterNumber} — the accepted-choice seam should have created it`,
      chapterNumber,
    )
  }
  const quotedCredits = Number(intentRow.quoted_credits)

  // 3) Production state machine: WAITING_FOR_CREDITS → AUTHORIZED → QUEUED(job).
  const transition = async (targetStatus: string, bindJobId: string | null) => {
    const { data, error } = await admin.rpc('transition_commercial_generation_intent_v1', {
      p_user_id: userId,
      p_story_id: storyId,
      p_chapter_number: chapterNumber,
      p_target_status: targetStatus,
      ...(bindJobId ? { p_generation_job_id: bindJobId } : {}),
    })
    if (error) {
      throw new HarnessCommercialError(
        `intent transition to ${targetStatus} failed at Bab ${chapterNumber}: ${error.message}`,
        chapterNumber,
      )
    }
    if (data?.ok !== true) {
      throw new HarnessCommercialError(
        `intent transition to ${targetStatus} rejected at Bab ${chapterNumber}: ${JSON.stringify(data)}`,
        chapterNumber,
      )
    }
  }

  const startStatus = String(intentRow.status)
  if (startStatus === 'WAITING_FOR_CREDITS') await transition('AUTHORIZED', null)
  if (startStatus !== 'QUEUED' || String(intentRow.generation_job_id ?? '') !== jobId) {
    await transition('QUEUED', jobId)
  }

  // 4) Authoritative re-read — the preflight trusts only DB state, so does this.
  const { data: boundRow, error: boundError } = await admin
    .from('commercial_generation_intents')
    .select('status,generation_job_id')
    .eq('user_id', userId)
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .maybeSingle()
  if (boundError) {
    throw new HarnessCommercialError(`intent re-read failed at Bab ${chapterNumber}: ${boundError.message}`, chapterNumber)
  }
  if (boundRow?.status !== 'QUEUED' || String(boundRow?.generation_job_id ?? '') !== jobId) {
    throw new HarnessCommercialError(
      `intent not QUEUED+bound at Bab ${chapterNumber}: ${JSON.stringify(boundRow)}`,
      chapterNumber,
    )
  }

  return {
    chapterNumber,
    reservationStatus: String(reserve.status),
    intentStatus: String(boundRow.status),
    quotedCredits,
  }
}
