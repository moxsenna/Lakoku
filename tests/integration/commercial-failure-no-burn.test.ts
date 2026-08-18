/**
 * Failure / No-Burn Test for Commercial System
 * 
 * Deliberately triggers generation failure to prove financial isolation:
 * - RETRY_WAIT state: reservation ACTIVE allowed, story_start debit = 0
 * - Terminal failure: reservation RELEASED, balance restored, zero debits
 * - NO credit burn on any failure path
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'
import type { GenerationProvider, PlanInput, WriteInput } from '@/lib/ai-gateway/provider'
import type { SemanticJudgeInput, SemanticJudgeResult, SemanticJudgeCode } from '@/lib/ai-gateway/semantic-continuation-judge'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', async () => {
  const actual = await vi.importActual('@/lib/supabase/server')
  return {
    ...actual,
    createClient: vi.fn(async () => createAdminClient()),
  }
})

const mocks = vi.hoisted(() => ({
  selectProvider: vi.fn(),
}))

vi.mock('@lakoku/ai-gateway/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai-gateway/server')>()
  
  return {
    ...actual,
    selectProvider: mocks.selectProvider,
  }
})

// FAULTY PROVIDER: Produces INVALID choice structure causing validation failure
const faultyProvider: GenerationProvider = {
  name: 'faulty-deterministic-v1',
  
  async generatePlan(input) {
    const { chapterNumber, blueprint } = input as PlanInput
    return {
      storyId: input.snapshot.storyId,
      chapterNumber,
      phase: blueprint.phase,
      chapterGoal: `Chapter ${chapterNumber} goal`,
      plannedBeats: ['establish scene'],
      targetWordCount: 2000,
      targetSceneCount: 2,
      opensThreadId: null,
      usesReveals: [],
      proposedStateDelta: {},
      introducesCharacters: blueprint.introducesCharacters ?? [],
    }
  },
  
  async writeChapter(input) {
    const { snapshot } = input as WriteInput
    return {
      draft: `[FAILOVER MODE] Draft for Chapter 1\n\n` +
             `In the world of ${snapshot.storyId}...`,
      usageEstimate: 500,
      estimatedDurationMs: 5000,
    }
  },
  
  async evaluateSemanticContinuity(_input: SemanticJudgeInput): Promise<SemanticJudgeResult> {
    return { verdict: 'PASS' as const, codes: [] as SemanticJudgeCode[] }
  },
  
  async generateChoices(_input) {
    // INVALID CHOICE OUTPUT (missing required field threadTouches on first choice)
    // This will fail production validator, causing RETRY_WAIT → eventually terminal failure
    const choices = [
      {
        text: 'Pilih opsi gagal 1',
        effect: { type: 'navigate' as const, destinationType: 'scene' as const, destinationId: 'scene_1' },
        evidenceAdded: [] as string[],
        endingBiasDeltas: {},
        // MISSING threadTouches: [] -- this will cause validation failure!
      },
      {
        text: 'Pilih opsi gagal 2',
        effect: { type: 'navigate' as const, destinationType: 'scene' as const, destinationId: 'scene_2' },
        threadTouches: [] as string[],
        evidenceAdded: [] as string[],
        endingBiasDeltas: {},
      },
    ]
    
    return {
      choicePrompt: 'Apa yang akan dilakukan?',
      choices,
      outcomes: choices.map((c, i) => ({
        selectedChoiceIndex: i,
        validation: 'PASSED' as const, // Claiming passed but struct is wrong
      })),
    }
  },
}

describe('Commercial Failure / No-Burn Test (Real DB)', () => {
  const idempotencyKey = '00000000-0000-4000-8000-fail-e2e'
  let userId = ''
  let admin: ReturnType<typeof createAdminClient>

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
    
    // WIRING FIX: Use faulty provider directly
    mocks.selectProvider.mockResolvedValue(faultyProvider)
    
    admin = createAdminClient()
    try { await admin.rpc('reload_schema_cache_v1') } catch {}

    userId = randomUUID()
    const { error: userErr } = await admin.rpc('create_test_auth_user_v1', {
      p_user_id: userId,
      p_email: `fail-${userId}@example.com`,
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

  it('proves financial no-burn on deliberate choice validation failure', async () => {
    // === SETUP ===
    
    // Seed user with starter claim
    await admin.from('stories').insert({
      id: 'story-starter-prev-fail',
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
      starter_story_id: 'story-starter-prev-fail',
      starter_claimed_at: new Date().toISOString(),
      welcome_credit_granted_at: new Date().toISOString(),
    })

    // Seed 20 credits, add +8 = 28 (enough for STORY_START price 24)
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `seed-fail-${Date.now()}`,
      p_credits: 20,
      p_reason: 'TEST_GRANT',
    })
    
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-fail-${Date.now()}`,
      p_credits: 8,
      p_reason: 'TEST_GRANT',
    })

    const initialBalance = 28
    
    // === PHASE 1: Initial attempt (will trigger job with fault generator) ===
    
    const resumeResult = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    const storyId = resumeResult.storyId
    expect(storyId).toBeDefined()

    // Get generation job for monitoring
    const { data: reqData } = await admin
      .from('story_creation_requests')
      .select('generation_job_id')
      .eq('owner_user_id', userId)
      .eq('story_id', storyId)
      .maybeSingle()

    expect(reqData?.generation_job_id).toBeDefined()
    
    const { data: jobRow } = await admin
      .from('generation_jobs')
      .select('id, status, attempt_count, max_attempts')
      .eq('id', reqData!.generation_job_id!)
      .single()

    expect(jobRow).not.toBeNull()

    // === PHASE 2: Monitor RETRY_WAIT state ===
    
    await waitForCondition(
      async () => {
        const { data: updatedJob } = await admin
          .from('generation_jobs')
          .select('status')
          .eq('id', jobRow!.id)
          .single()
        
        // Job should enter RETRY_WAIT due to choice validation failure
        return updatedJob?.status === 'RETRY_WAIT'
      },
      'Generation job entered RETRY_WAIT state',
      30_000
    )

    const { data: retryJob } = await admin
      .from('generation_jobs')
      .select('status, attempt_count, max_attempts, error_code')
      .eq('id', jobRow!.id)
      .single()

    expect(retryJob).not.toBeNull()
    expect(retryJob!.status).toBe('RETRY_WAIT')
    expect(retryJob!.error_code).toBe('CHOICE_GENERATION_FAILED')

    // PROVE: During RETRY_WAIT, reservation MUST BE ACTIVE (required by queue_paid_story_start_generation_v1)
    const { data: resAtRetry, error: resError } = await admin
      .from('credit_reservations')
      .select('ref, status, amount')
      .eq('ref', `story-start:${userId}:${storyId}`)
      .maybeSingle()
    
    if (resError) throw new Error(`Failed to query credit_reservations at RETRY_WAIT: ${JSON.stringify(resError)}`)
    
    expect(resAtRetry).not.toBeNull() // Reservation must exist during RETRY_WAIT
    expect(resAtRetry!.status).toBe('ACTIVE') // Must be active, not released yet
    expect(resAtRetry!.amount).toBe(24) // Correct price amount
    
    // CRITICAL: story_start debit MUST be ZERO at RETRY_WAIT stage
    const { data: ledgerAtRetry, error: ledgerError } = await admin
      .from('credit_ledger')
      .select('delta')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    
    if (ledgerError) throw new Error(`Failed to query credit_ledger at RETRY_WAIT: ${JSON.stringify(ledgerError)}`)
    
    expect(ledgerAtRetry?.length).toBe(0) // NO debit during RETRY_WAIT
    
    // Balance might show reduced funds due to reservation, but NOT negative from debit
    const { data: balAtRetry, error: balError } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    
    if (balError) throw new Error(`Failed to query balance at RETRY_WAIT: ${JSON.stringify(balError)}`)
    
    // At RETRY_WAIT: balance might be 4 (if 24 reserved) or 28 (if not captured yet)
    // BUT NEVER shows negative value from debit
    expect(balAtRetry!).toBeGreaterThanOrEqual(0)

    // === PHASE 3: Wait for terminal failure (max attempts exhausted) ===
    
    await waitForCondition(
      async () => {
        const { data: finalJob } = await admin
          .from('generation_jobs')
          .select('status')
          .eq('id', jobRow!.id)
          .single()
        
        // Job must eventually reach FAILED terminal state
        return finalJob?.status === 'FAILED'
      },
      'Generation job reached terminal FAILED state after max retries',
      180_000
    )

    const { data: terminalJob } = await admin
      .from('generation_jobs')
      .select('status, error_code, error_reason')
      .eq('id', jobRow!.id)
      .single()

    expect(terminalJob).not.toBeNull()
    expect(terminalJob!.status).toBe('FAILED')
    expect(['CHOICE_GENERATION_FAILED', 'MAX_ATTEMPTS_EXCEEDED']).toContain(terminalJob!.error_code)

    // === PHASE 4: Terminal failure post-conditions ===
    
    // 1. Reservation MUST BE RELEASED on terminal FAILED (terminal finalizer releases it)
    const { data: resAfterFail, error: resFailError } = await admin
      .from('credit_reservations')
      .select('ref, status, amount')
      .eq('ref', `story-start:${userId}:${storyId}`)
      .maybeSingle()
    
    if (resFailError) throw new Error(`Failed to query reservations after failure: ${JSON.stringify(resFailError)}`)
    
    expect(resAfterFail).not.toBeNull() // Must exist
    
    // TERMINAL FINALIZER PROOF: Reservation released after terminal FAILED
    expect(resAfterFail!.status).toBe('RELEASED')
    expect(resAfterFail!.amount).toBe(24)
    
    console.log(`[proof] Terminal finalizer released reservation after FAILED`)
    
    // CRITICAL: story_start debit count = 0 (NO credit burn even though reservation was active during retries)
    const { data: ledgerAfterFail, error: ledgerFailError } = await admin
      .from('credit_ledger')
      .select('delta')
      .eq('user_id', userId)
      .eq('reason', 'story_start')
    
    if (ledgerFailError) throw new Error(`Failed to query ledger after failure: ${JSON.stringify(ledgerFailError)}`)
    
    expect(ledgerAfterFail?.length).toBe(0) // Critical: no debit on failure
    
    console.log(`[proof] Credit ledger verified: zero story_start debits on terminal failure`)
    
    // Balance fully restored (no debit occurred)
    const { data: balAfterFail, error: balFailError } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    
    if (balFailError) throw new Error(`Failed to query balance after failure: ${JSON.stringify(balFailError)}`)
    
    // After terminal failure + release: balance fully restored to initial amount
    expect(balAfterFail).toBe(initialBalance)
    
    console.log(`[proof] Balance after terminal FAILED with RELEASED reservation: ${balAfterFail} (full restoration)`)

    // 4. Zero duplicate jobs/reservations/requests
    const { data: jobCountAfterFail } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', storyId)
    
    expect(jobCountAfterFail?.length).toBe(1) // Exactly one job, no retry duplicates
    
    const { count: reqCount } = await admin
      .from('story_creation_requests')
      .select('*', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .eq('request_kind', 'personalized')
    
    expect(reqCount).toBe(1) // Single durable request

    // 5. Story status reflects failure
    const { data: storyAfterFail } = await admin
      .from('stories')
      .select('generation_status, commercial_origin')
      .eq('id', storyId)
      .single()
    
    expect(storyAfterFail).not.toBeNull()
    expect(storyAfterFail!.generation_status).toBeOneOf(['failed', 'ready']) // Depends on implementation
    expect(storyAfterFail!.commercial_origin).toBeNull() // Never became PAID_START

    console.log(`[proof] ✅ FAILURE NO-BURN VERIFIED: RETRY_WAIT had zero debits, terminal FAILED released reservation, balance restored to ${initialBalance}, zero duplicates across all domains`)
  }, 240_000)
})
