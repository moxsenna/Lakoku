/**
 * REAL DB E2E for Story #2 Insufficient Credit → Top-up → Resume Flow
 * 
 * STRICT SUCCESS CONTRACT: This proves the ENTIRE real-world paid story creation path
 * MUST end in SUCCEEDED state. No fallbacks to RETRY_WAIT, FAILED, or other terminal states.
 * 
 * Pre-first-attempt: zero requests, zero jobs, zero debits, balance = 20
 * First attempt: INSUFFICIENT_CREDITS error, creates durable request status=WAITING_FOR_CREDITS
 * Top-up +4 credits: 20→24
 * Resume via production seam: createPersonalizedStory(SAME_KEY)
 * Poll until generation_jobs.status = SUCCEEDED (MANDATORY)
 * 
 * Final state assertions (unconditional):
 * - request READY
 * - same composite request identity
 * - chapter 1 published/readable
 * - exactly 1 STORY_START reservation CAPTURED amount 24
 * - exactly one story_start ledger debit = -24
 * - final available balance = 0
 * - story commercial_origin = PAID_START
 * - story generation_status = ready
 * - replay same key = same story, replayed true
 * - zero duplicate request/story/job/reservation/debit
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'

// Mock server-only and supabase/server BEFORE any other imports
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', async () => {
  const actual = await vi.importActual('@/lib/supabase/server')
  return {
    ...actual,
    createClient: vi.fn(async () => {
      const adminClient = createAdminClient()
      return adminClient as unknown as ReturnType<typeof createAdminClient>
    }),
  }
})

const mocks = vi.hoisted(() => ({
  selectProvider: vi.fn(),
}))

// Use test-specific provider module pattern for valid GenerationProvider fixture
vi.mock('@lakoku/ai-gateway/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-gateway/server')>(
    '@/lib/ai-gateway/server'
  )
  
  // Create a TEST-ONLY GenerationProvider that produces VALID choice output
  // matching production validator expectations
  const testProvider: any = {
    name: 'test-deterministic-valid-v1',
    
    async generatePlan(input, _options) {
      const { chapterNumber, blueprint } = input
      return {
        storyId: input.snapshot.storyId,
        chapterNumber,
        phase: blueprint.phase,
        chapterGoal: `Chapter ${chapterNumber} goal`,
        plannedBeats: ['establish scene', 'develop conflict'],
        targetWordCount: 2000,
        targetSceneCount: 3,
        opensThreadId: null,
        usesReveals: [],
        proposedStateDelta: {},
        introducesCharacters: blueprint.introducesCharacters ?? [],
      }
    },
    
    async writeChapter(input, _options) {
      const { snapshot, plan } = input
      return {
        draft: `[GENERATION] Scene draft for Chapter ${1}\n\n` +
               `In the world of ${snapshot.storyId}, Chapter ${1}...`,
        usageEstimate: 500,
        estimatedDurationMs: 5000,
      }
    },
    
    async evaluateSemanticContinuity(_input, _options) {
      return { ok: true, score: 0.95 }
    },
    
    async generateChoices(_input, _options) {
      // VALID CHOICE OUTPUT MATCHING PRODUCTION CONTRACT
      // This is a golden fixture derived from passing choice tests
      const choices = [
        {
          text: 'Ambil jalan yang aman melalui lorong sempit',
          effect: {
            type: 'navigate',
            destinationType: 'scene',
            destinationId: 'scene_corridor_1',
          },
          threadTouches: [],
          evidenceAdded: [],
          endingBiasDeltas: {},
        },
        {
          text: 'Terobos pintu darurat ke balkon lantai bawah',
          effect: {
            type: 'navigate',
            destinationType: 'scene',
            destinationId: 'scene_balcony_1',
          },
          threadTouches: [],
          evidenceAdded: [],
          endingBiasDeltas: {},
        },
        {
          text: 'Bersikap diam dan amati dari celah pintu',
          effect: {
            type: 'observe',
            target: 'environment',
            insights: ['suara langkah kaki', 'cahaya merah berkedip'],
          },
          threadTouches: [],
          evidenceAdded: ['clue_danger_approaching'],
          endingBiasDeltas: { tension: 0.2 },
        },
      ]
      
      return {
        choicePrompt: 'Apa yang akan dilakukan?',
        choices,
        outcomes: choices.map(c => ({
          selectedChoiceIndex: choices.indexOf(c),
          validation: 'PASSED',
        })),
      }
    },
  }
  
  return {
    ...actual,
    selectProvider: mocks.selectProvider,
    testValidDeterministicProvider: () => testProvider,
  }
})

describe('Commercial Story #2 Success E2E (Real DB)', () => {
  const idempotencyKey = '00000000-0000-4000-8000-e2e000000002'
  let userId = ''
  let admin: ReturnType<typeof createAdminClient>
  let testProvider: any = null
  
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
    
    // Initialize test provider BEFORE any tests run
    const providerModule = await import('@/lib/ai-gateway/provider')
    testProvider = providerModule.createDeterministicProvider()
    mocks.selectProvider.mockResolvedValue(testProvider)
  })

  beforeAll(async () => {
    admin = createAdminClient()
    try { await admin.rpc('reload_schema_cache_v1') } catch {}

    userId = randomUUID()
    const { error: userErr } = await admin.rpc('create_test_auth_user_v1', {
      p_user_id: userId,
      p_email: `story2-${userId}@example.com`,
    })
    if (userErr) throw new Error(`create_test_auth_user_v1 failed: ${JSON.stringify(userErr)}`)
    
    console.log(`[setup] Created test user: ${userId}`)
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

  it('proves strict SUCCEEDED success contract with authorization gating, durable binding, atomic execution', async () => {
    // === SETUP: Seed user commercial state with prior starter story claimed ===
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

    // === PHASE 1: Pre-first-attempt state verification ===
    
    // Seed 20 credits (STORY_START price = 24, insufficient by 4)
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `seed-balance-e2e-${Date.now()}`,
      p_credits: 20,
      p_reason: 'TEST_GRANT',
    })

    // Assert ZERO provider calls pre-first-attempt
    expect(mocks.selectProvider).not.toHaveBeenCalled()

    // Assert ZERO requests pre-first-attempt
    const { count: preFirstRequestCount } = await admin
      .from('story_creation_requests')
      .select('*', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .eq('request_kind', 'personalized')
    expect(preFirstRequestCount ?? 0).toBe(0)

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

    // Assert STILL ZERO provider calls after first attempt (authorization gating)
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

    // Query durable request after first attempt (COMPOSITE PK query)
    const { data: postFirstRequestResult } = await admin
      .from('story_creation_requests')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('request_kind', 'personalized')
      .maybeSingle()
    
    expect(postFirstRequestResult).not.toBeNull()
    const postFirstRequest = postFirstRequestResult as unknown as { [key: string]: unknown } | null
    if (!postFirstRequest) throw new Error('Post-first-attempt request not found')
    
    expect(postFirstRequest.idempotency_key).toBe(idempotencyKey)
    expect(['WAITING_FOR_CREDITS', 'RESERVED']).toContain(postFirstRequest.status)
    expect(postFirstRequest.generation_job_id).toBeNull()
    
    // COMPOSITE PK components: (owner_user_id, request_kind, idempotency_key) - NO standalone id!
    const initialStoryIdOnWait = postFirstRequest.story_id
    expect(initialStoryIdOnWait).toBeDefined()

    // === PHASE 2: Top-up + exact resume ===
    
    // Grant +4 credits (20 → 24, exactly the STORY_START quote)
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-e2e-1-${Date.now()}`,
      p_credits: 4,
      p_reason: 'TEST_GRANT',
    })

    // Verify balance increased to exactly 24
    const { data: balanceAfterTopUp } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(balanceAfterTopUp).toBe(24)

    // Verify single durable request persisted (same story_id, WAITING_FOR_CREDITS)
    const { data: idCheck1 } = await admin
      .from('story_creation_requests')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('request_kind', 'personalized')
      .eq('idempotency_key', idempotencyKey)
    
    expect(idCheck1).toBeDefined()
    expect(Array.isArray(idCheck1)).toBe(true)
    const checkResults = idCheck1 as Array<{ [key: string]: unknown }>
    expect(checkResults.length).toBe(1)
    
    const foundRecord = checkResults[0]
    expect(foundRecord.idempotency_key).toBe(idempotencyKey)
    expect(foundRecord.status).toBe('WAITING_FOR_CREDITS')
    expect(foundRecord.story_id).toBe(initialStoryIdOnWait)

    // RESUME via production seam: createPersonalizedStory(SAME KEY)
    const resumeResult = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    expect(resumeResult.storyId).toBeDefined()
    const storyId = resumeResult.storyId
    expect(storyId).toBe(initialStoryIdOnWait) // SAME story ID!

    // Get generation job reference for polling
    const { data: reqData } = await admin
      .from('story_creation_requests')
      .select('generation_job_id')
      .eq('owner_user_id', userId)
      .eq('story_id', storyId)
      .maybeSingle()

    expect(reqData).not.toBeNull()
    expect(reqData!.generation_job_id).toBeDefined()
    
    const { data: generationJobRow } = await admin
      .from('generation_jobs')
      .select('id, status, publication_idempotency_key')
      .eq('id', reqData!.generation_job_id!)
      .single()

    expect(generationJobRow).not.toBeNull()

    // === PHASE 3: MANDATORY SUCCEEDED POLLING (NO FALLBACKS) ===
    
    await waitForCondition(
      async () => {
        const { data: updatedJob } = await admin
          .from('generation_jobs')
          .select('status')
          .eq('id', generationJobRow!.id)
          .single()
        
        // STRICT REQUIREMENT: ONLY SUCCEEDED is acceptable
        // RETRY_WAIT, FAILED, or any other state = TEST FAILS
        return updatedJob?.status === 'SUCCEEDED'
      },
      'Generation job MUST reach SUCCEEDED state (no fallbacks accepted)',
      120_000
    )

    const { data: finalizedJob } = await admin
      .from('generation_jobs')
      .select('status, publication_idempotency_key')
      .eq('id', generationJobRow!.id)
      .single()

    expect(finalizedJob).not.toBeNull()
    expect(finalizedJob!.status).toBe('SUCCEEDED') // MANDATORY
    expect(finalizedJob!.publication_idempotency_key).toBe(`generation-job:${reqData!.generation_job_id}:publish:1`)

    // Wait for creation request to reach READY state after SUCCEEDED job
    await waitForCondition(
      async () => {
        const { data: finalReq } = await admin
          .from('story_creation_requests')
          .select('status')
          .eq('owner_user_id', userId)
          .eq('request_kind', 'personalized')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle()
        return finalReq?.status === 'READY'
      },
      'Creation request became READY after SUCCEEDED job',
      10_000
    )

    // === PHASE 4: UNCONDITIONAL POST-CONDITION ASSERTIONS ===
    
    // 1. Chapter 1 exists/readable
    const { data: chap1 } = await admin
      .from('chapters')
      .select('number, title')
      .eq('story_id', storyId)
      .eq('number', 1)
      .single()
    expect(chap1).not.toBeNull()

    // 2. Exactly 1 STORY_START reservation CAPTURED amount 24
    const { data: startRes } = await admin
      .from('credit_reservations')
      .select('ref, status, amount')
      .eq('ref', `story-start:${userId}:${storyId}`)
      .single()
    expect(startRes).not.toBeNull()
    expect(startRes!.ref).toBe(`story-start:${userId}:${storyId}`)
    expect(startRes!.status).toBe('CAPTURED')
    expect(startRes!.amount).toBe(24)

    // 3. Exactly one -24 debit with reason story_start
    const { data: ledgerEntries } = await admin
      .from('credit_ledger')
      .select('delta, reason')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    expect(ledgerEntries).toHaveLength(1)
    expect(ledgerEntries![0].delta).toBe(-24)

    // 4. Story commercial_origin = PAID_START & generation_status = ready
    const { data: storyData } = await admin
      .from('stories')
      .select('generation_status, commercial_origin')
      .eq('id', storyId)
      .single()
    
    expect(storyData).not.toBeNull()
    expect(storyData!.commercial_origin).toBe('PAID_START')
    expect(storyData!.generation_status).toBe('ready')

    // 5. Final balance = 0 (20 + 4 - 24 = 0)
    const { data: finalBalance } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(finalBalance).toBe(0)

    // 6. Request is READY
    const { data: updatedReq } = await admin
      .from('story_creation_requests')
      .select('status')
      .eq('owner_user_id', userId)
      .eq('request_kind', 'personalized')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    expect(updatedReq?.status).toBe('READY')

    // === PHASE 5: IDEMPOTENCY REPLAY PROOF ===
    
    // Replay same key: must return same story without duplicates
    const replayRes = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })
    
    expect(replayRes.storyId).toBe(storyId)
    expect(replayRes.replayed).toBe(true)
    
    // Zero duplicates across all domains
    const { data: finalJobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', storyId)
    expect(finalJobs?.length).toBe(1) // Exactly one job
    
    const { data: finalLedger } = await admin
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    expect(finalLedger?.length).toBe(1) // Exactly one debit
    
    const { data: ownedStories } = await admin
      .from('stories')
      .select('id')
      .eq('owner_user_id', userId)
    expect(ownedStories?.length).toBe(2) // Starter prev + this paid story
    
    const { count: finalRequestsCount } = await admin
      .from('story_creation_requests')
      .select('*', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .eq('request_kind', 'personalized')
    expect(finalRequestsCount).toBe(1) // Exactly one request
    
    const { data: finalBal } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(finalBal).toBe(0) // Balance still 0 (replay did no side effects)

    console.log(`[proof] ✅ STRICT SUCCESS E2E PASSED: Authorization gating (zero calls pre-top-up), durable request binding (${idempotencyKey} → ${initialStoryIdOnWait}), atomic job fence, chapter 1 published, reservation CAPTURED 24, debit -24, balance 0, replay protection verified`)
  }, 180_000) // 3 minutes for full runtime execution path
})
