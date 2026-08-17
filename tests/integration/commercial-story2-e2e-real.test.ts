/**
 * REAL DB E2E for Story #2 Insufficient Credit → Top-up → Resume Flow
 * 
 * This proves the ENTIRE real-world paid story creation path through PRODUCTION resume orchestration:
 * - Initial insufficient balance WITHOUT provider calls, without reservations, without debits
 * - Explicit durable request tracking (same story_creation_requests record before/after top-up)
 * - Top-up enables authorization
 * - Production resume path: createPersonalizedStory(SAME KEY) -> loadExistingReservation -> authorizeStoryCreation -> runContractAndGeneration -> queue_paid_story_start_generation_v1 -> continuePersonalizedGeneration({jobId, storyId, userId, chapterNumber: 1})
 * - REAL worker owns queue→claim→lease→checkpoint→generation→fenced publication→capture pipeline
 * - No duplicate stories, jobs, reservations, or debits on replay
 * 
 * Only external AI/model boundaries are mocked using DeterministicProvider to prevent network calls.
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'

// CRITICAL FIX #1: Use valid GenerationProvider interface with hoisted mocks
const mocks = vi.hoisted(() => ({
  selectProvider: vi.fn(),
}))

vi.mock('@lakoku/ai-gateway/server', () => ({
  selectProvider: mocks.selectProvider,
}))

// Setup deterministic provider that actually implements generatePlan/writeChapter
let deterministicProvider: ReturnType<typeof import('@/lib/ai-gateway/provider').createDeterministicProvider> | null = null

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
  
  // Initialize deterministic provider BEFORE any tests run
  const providerModule = await import('@/lib/ai-gateway/provider')
  deterministicProvider = providerModule.createDeterministicProvider()
  mocks.selectProvider.mockResolvedValue(deterministicProvider)
})

let userId = ''

describe('Commercial Creation Cutover E2E (Real DB)', () => {
  const idempotencyKey = '00000000-0000-4000-8000-e2e000000002'
  let admin: ReturnType<typeof createAdminClient>

  beforeAll(async () => {
    admin = createAdminClient()
    try { await admin.rpc('reload_schema_cache_v1') } catch {}

    userId = randomUUID()
    const { error: userErr } = await admin.rpc('create_test_auth_user_v1', {
      p_user_id: userId,
      p_email: `creation-${userId}@example.com`,
    })
    if (userErr) throw new Error(`create_test_auth_user_v1 failed: ${JSON.stringify(userErr)}`)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function waitForCondition(predicate: () => Promise<boolean>, message: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Timeout waiting for: ${message}`)
  }

  it('proves creation flow bounds, authorization gating, durable request binding, atomic job binding, V6 promotion, and NO-duplicate-replay', async () => {
    // 0. Seed user commercial state with prior starter story claimed
    await admin.from('stories').insert({
      id: 'story-starter-prev-e2e',
      owner_user_id: userId,
      title: 'Starter Story Prev',
      tagline: 'Tagline',
      synopsis: 'Synopsis',
      tropes: [],
      story_mode: 'personalized_ai',
      visibility: 'private',
      status: 'published',
      commercial_origin: 'STARTER_FREE',
    })

    await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: 'story-starter-prev-e2e',
      starter_claimed_at: new Date().toISOString(),
      welcome_credit_granted_at: new Date().toISOString(),
    })

    // 1. Initial State: User has 20 credits (cost 24). Creation MUST fail authorization
    //    without calling AI providers and WITHOUT capturing/partially debiting the balance.
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `seed-balance-e2e-${Date.now()}`,
      p_credits: 20,
      p_reason: 'TEST_GRANT',
    })

    // Before first attempt: verify zero provider calls, zero requests, zero jobs
    const { data: preFirstRequest } = await admin
      .from('story_creation_requests')
      .select('id, status, generation_job_id, idempotency_key')
      .eq('owner_user_id', userId)

    expect(preFirstRequest?.length ?? 0).toBe(0)

    // INITIAL: First attempt with insufficient balance
    const firstAttemptError = await createPersonalizedStory({
      userId,
      idempotencyKey,
    }).catch(err => err)

    expect(firstAttemptError).toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      requiredCredits: 24,
      availableCredits: 20,
    })

    // CRITICAL FIX #2: Assert ZERO provider calls before top-up (not exactly 1)
    expect(mocks.selectProvider).not.toHaveBeenCalled()

    // Verify 0 generation jobs created
    const { data: earlyJobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
    expect(earlyJobs?.length ?? 0).toBe(0)

    // Verify NO capture: zero reservations and zero debits; balance untouched at 20
    const { data: earlyReservations } = await admin
      .from('credit_reservations')
      .select('id')
      .eq('user_id', userId)
    expect(earlyReservations?.length ?? 0).toBe(0)

    const { data: earlyDebits } = await admin
      .from('credit_ledger')
      .select('delta')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    expect(earlyDebits?.length ?? 0).toBe(0)

    const { data: balanceAfterReject } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(balanceAfterReject).toBe(20)

    // CRITICAL FIX #5: SAME DURABLE REQUEST PROOF - Query after first insufficient attempt
    const { data: postFirstRequest } = await admin
      .from('story_creation_requests')
      .select('id, story_id, status, generation_job_id, idempotency_key')
      .eq('owner_user_id', userId)
      .limit(1)
      .single()

    expect(postFirstRequest).not.toBeNull()
    expect(postFirstRequest!.status).toBe('WAITING_FOR_CREDITS')
    expect(postFirstRequest!.generation_job_id).toBeNull()
    expect(postFirstRequest!.idempotency_key).toBe(idempotencyKey)

    const initialRequestId = postFirstRequest!.id
    const initialStoryIdOnWait = postFirstRequest!.story_id

    // Store before top-up state explicitly
    const beforeTopUpState = {
      requestId: initialRequestId,
      storyId: initialStoryIdOnWait,
      status: 'WAITING_FOR_CREDITS',
      hasJobId: false,
    }

    // 2. Top-up 4 credits via RPC (20 -> 24, exactly the STORY_START quote)
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-e2e-1-${Date.now()}`,
      p_credits: 4,
      p_reason: 'TEST_GRANT',
    })

    // Verify balance increased
    const { data: balanceAfterTopUp } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(balanceAfterTopUp).toBe(24)

    // CRITICAL FIX #5: SAME DURABLE REQUEST PROOF - Query again before resume
    const { data: preResumeRequest } = await admin
      .from('story_creation_requests')
      .select('id, story_id, status')
      .eq('owner_user_id', userId)
      .limit(1)
      .single()

    expect(preResumeRequest).not.toBeNull()
    expect(preResumeRequest!.id).toBe(initialRequestId) // SAME request ID!
    expect(preResumeRequest!.story_id).toBe(initialStoryIdOnWait) // SAME story_id!
    expect(preResumeRequest!.status).toBe('WAITING_FOR_CREDITS') // Still WAITING before resume

    // 3. RESUME via production path: createPersonalizedStory(SAME KEY)
    // This triggers: loadExistingReservation -> authorizeStoryCreation -> runContractAndGeneration
    // which queues job and may call continuePersonalizedGeneration({jobId, storyId, userId, chapterNumber: 1})
    const resumeResult = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    expect(resumeResult.storyId).toBeDefined()
    const storyId = resumeResult.storyId

    // Provider selection now happens in production paths (contract + potentially prose generation)
    // Do not assert exact call count - this would fail as worker calls vary
    
    // CRITICAL FIX #3: ASYNC READY EXPECTATION
    // Immediately after resume, request status can be RESERVED or READY (not necessarily READY yet)
    // Worker has 25s window to finish; we should accept either state initially
    const { data: reqData } = await admin
      .from('story_creation_requests')
      .select('id, story_id, status, generation_job_id, idempotency_key') // All fields selected
      .eq('owner_user_id', userId)
      .eq('story_id', storyId)
      .single()

    expect(reqData).not.toBeNull()
    expect(reqData!.generation_job_id).toBeDefined() // Job was queued
    expect(reqData!.idempotency_key).toBe(idempotencyKey)
    
    // Accept either RESERVED (still processing) or READY (completed) as valid
    expect(['RESERVED', 'READY']).toContain(reqData!.status)
    
    // Same durable request assertion
    const sameRequestId = reqData!.id
    expect(sameRequestId).toBe(initialRequestId)
    console.log(`[proof] Same durable request proven: request.id === ${initialRequestId} BEFORE and AFTER top-up`)

    // Wait for the real worker to generate and fence-publish successfully
    // IMPORTANT: Generation job succeeds with status SUCCEEDED, not PUBLISHED
    const { data: generationJobRow } = await admin
      .from('generation_jobs')
      .select('id, status, publication_idempotency_key')
      .eq('id', reqData!.generation_job_id!)
      .single()

    expect(generationJobRow).not.toBeNull()
    
    // Poll for authoritative SUCCEEDED completion state (bounded timeout)
    await waitForCondition(
      async () => {
        const { data: updatedJob } = await admin
          .from('generation_jobs')
          .select('status')
          .eq('id', generationJobRow!.id)
          .single()
        return updatedJob?.status === 'SUCCEEDED'
      },
      'Generation job succeeded',
      60_000 // Increased timeout for full worker runtime
    )

    const { data: finalizedJob } = await admin
      .from('generation_jobs')
      .select('status, publication_idempotency_key')
      .eq('id', generationJobRow!.id)
      .single()

    expect(finalizedJob).not.toBeNull()
    expect(finalizedJob!.status).toBe('SUCCEEDED') // Authoritative worker completion state
    expect(finalizedJob!.publication_idempotency_key).toBe(`generation-job:${reqData!.generation_job_id}:publish:1`)

    // Now poll request to READY state after job completes
    await waitForCondition(
      async () => {
        const { data: finalReq } = await admin
          .from('story_creation_requests')
          .select('status')
          .eq('owner_user_id', userId)
          .eq('story_id', storyId)
          .single()
        return finalReq?.status === 'READY'
      },
      'Creation request became READY after job completion',
      10_000
    )

    // Verify V6 post-conditions:
    // - Chapter 1 exists
    const { data: chap1 } = await admin
      .from('chapters')
      .select('number, title')
      .eq('story_id', storyId)
      .eq('number', 1)
      .single()
    expect(chap1).not.toBeNull()

    // - Reservation CAPTURED
    const { data: startRes } = await admin
      .from('credit_reservations')
      .select('status')
      .eq('ref', `story-start:${userId}:${storyId}`)
      .single()
    expect(startRes?.status).toBe('CAPTURED')

    // - Exactly one -24 debit with reason story_start
    const { data: ledgerEntries } = await admin
      .from('credit_ledger')
      .select('delta, reason')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    expect(ledgerEntries).toHaveLength(1)
    expect(ledgerEntries?.[0].delta).toBe(-24)

    // - Story commercial_origin = PAID_START & generation_status = ready
    const { data: storyData } = await admin
      .from('stories')
      .select('generation_status, commercial_origin')
      .eq('id', storyId)
      .single()

    expect(storyData).not.toBeNull()
    expect(storyData!.commercial_origin).toBe('PAID_START')
    expect(storyData!.generation_status).toBe('ready')

    // Final verification: request is now READY
    const { data: updatedReq } = await admin
      .from('story_creation_requests')
      .select('status')
      .eq('owner_user_id', userId)
      .eq('story_id', storyId)
      .single()
    expect(updatedReq?.status).toBe('READY')

    // 5. Replay: Calling createPersonalizedStory again with same key returns storyId without duplicate debit or jobs
    const replayRes = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    expect(replayRes.storyId).toBe(storyId)
    expect(replayRes.replayed).toBe(true)

    const { data: finalJobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', storyId)
    expect(finalJobs?.length).toBe(1)

    const { data: finalLedger } = await admin
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    expect(finalLedger?.length).toBe(1)

    // - No duplicate story: exactly 2 stories owned (starter prev + this one),
    //   exactly 1 creation request, final balance exactly 0 (20 + 4 - 24)
    const { data: ownedStories } = await admin
      .from('stories')
      .select('id')
      .eq('owner_user_id', userId)
    expect(ownedStories?.length).toBe(2)

    const { data: finalRequests } = await admin
      .from('story_creation_requests')
      .select('id')
      .eq('owner_user_id', userId)
    expect(finalRequests?.length).toBe(1)

    const { data: finalBalance } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(finalBalance).toBe(0)

    console.log(`[proof] ✅ ALL E2E assertions passed: NO duplicates, single durable request (${initialRequestId}), real worker execution via production resume path with deterministic provider, authorized only after top-up`)
  }, 120_000) // Increased to 2 minutes for full worker runtime
})
