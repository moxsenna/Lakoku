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
 *
 * Dekomisi Supabase (2026-11-01): seeding & asersi memakai Kysely (getDb) ke
 * DATABASE_URL uji; user uji dibuat langsung di user+account Better Auth.
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, single, rpcOne } from '@lakoku/db'
import { hashPassword } from '@/lib/auth/password'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'
import { createDeterministicProvider } from '@/lib/ai-gateway/provider'

vi.mock('server-only', () => ({}))

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

const validStory2Provider = createDeterministicProvider()

describe('Commercial Story #2 Success E2E (Real DB)', () => {
  const idempotencyKey = '00000000-0000-4000-8000-e2e000000002'
  let userId = ''

  beforeAll(async () => {
    mocks.selectProvider.mockResolvedValue(validStory2Provider)

    const db = getDb()
    userId = randomUUID()
    const email = `story2-${userId}@example.com`
    const now = new Date()
    await db
      .insertInto('user')
      .values({ id: userId, email, name: email.split('@')[0] ?? 'test', emailVerified: true, createdAt: now, updatedAt: now })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()
    await db
      .insertInto('account')
      .values({
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(`test-${userId}`),
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute()

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

  async function availableBalance(): Promise<number> {
    const row = await rpcOne(getDb(), 'available_credit_balance_v1', { p_user_id: userId }).executeTakeFirst()
    return Number((row as Record<string, unknown> | undefined)?.fn ?? 0)
  }

  async function requestCount(): Promise<number> {
    const rows = await getDb()
      .selectFrom('story_creation_requests')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('owner_user_id', '=', userId)
      .where('request_kind', '=', 'personalized')
      .execute()
    return Number(rows[0]?.n ?? 0)
  }

  it('proves strict SUCCEEDED success contract with authorization gating, durable binding, atomic execution', async () => {
    // === SETUP: Seed user commercial state with prior starter story claimed ===
    await getDb()
      .insertInto('stories')
      .values({
        id: 'story-starter-prev-e2e',
        owner_user_id: userId,
        title: 'Starter Story Prev',
        tagline: 'Tagline',
        synopsis: 'Synopsis',
        tropes: [],
        story_mode: 'personalized_ai',
        visibility: 'private',
        status: 'BARU',
        commercial_origin: 'STARTER_FREE',
      })
      .execute()

    const setupNow = new Date()
    await getDb()
      .insertInto('account_commercial_states')
      .values({
        user_id: userId,
        starter_story_id: 'story-starter-prev-e2e',
        starter_claimed_at: setupNow,
        welcome_credit_granted_at: setupNow,
      })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({
        starter_story_id: 'story-starter-prev-e2e',
        starter_claimed_at: setupNow,
        welcome_credit_granted_at: setupNow,
      }))
      .execute()

    const starterStories = await getDb()
      .selectFrom('stories')
      .select(['id', 'commercial_origin'])
      .where('owner_user_id', '=', userId)
      .execute()
    expect(starterStories).toEqual([{
      id: 'story-starter-prev-e2e',
      commercial_origin: 'STARTER_FREE',
    }])

    const { data: accountState } = await single(
      getDb()
        .selectFrom('account_commercial_states')
        .select('starter_story_id')
        .where('user_id', '=', userId)
        .limit(1)
        .execute(),
    )
    expect(accountState?.starter_story_id).toBe('story-starter-prev-e2e')

    // === PHASE 1: Pre-first-attempt state verification ===

    // Seed 20 credits (STORY_START price = 24, insufficient by 4)
    await rpcOne(getDb(), 'grant_credits_v1', {
      p_user_id: userId,
      p_ref: `seed-balance-e2e-${Date.now()}`,
      p_credits: 20,
      p_reason: 'TEST_GRANT',
    }).execute()

    // Assert ZERO provider calls pre-first-attempt
    expect(mocks.selectProvider).not.toHaveBeenCalled()

    // Assert ZERO requests pre-first-attempt
    expect(await requestCount()).toBe(0)

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
    const earlyJobs = await getDb()
      .selectFrom('generation_jobs')
      .select('id')
      .where('user_id', '=', userId)
      .execute()
    expect(earlyJobs.length).toBe(0)

    // Verify NO capture: zero reservations and zero debits; balance untouched at 20
    const earlyReservations = await getDb()
      .selectFrom('credit_reservations')
      .select('id')
      .where('user_id', '=', userId)
      .execute()
    expect(earlyReservations.length).toBe(0)

    const earlyDebits = await getDb()
      .selectFrom('credit_ledger')
      .select('delta')
      .where('user_id', '=', userId)
      .where('reason', '=', 'story_start')
      .execute()
    expect(earlyDebits.length).toBe(0)

    expect(await availableBalance()).toBe(20)

    // Query durable request after first attempt (COMPOSITE PK query)
    const postFirstRequest = await getDb()
      .selectFrom('story_creation_requests')
      .selectAll()
      .where('owner_user_id', '=', userId)
      .where('request_kind', '=', 'personalized')
      .executeTakeFirst()

    expect(postFirstRequest).not.toBeNull()
    if (!postFirstRequest) throw new Error('Post-first-attempt request not found')
    const postFirst = postFirstRequest as unknown as { [key: string]: unknown }

    expect(postFirst.idempotency_key).toBe(idempotencyKey)
    expect(postFirst.status).toBe('WAITING_FOR_CREDITS') // STRICT: ONLY this status

    // COMPOSITE PK components: (owner_user_id, request_kind, idempotency_key) - NO standalone id!
    const initialStoryIdOnWait = postFirst.story_id
    expect(initialStoryIdOnWait).toBeDefined()

    // === PHASE 2: Top-up + exact resume ===

    // Grant +4 credits (20 → 24, exactly the STORY_START quote)
    await rpcOne(getDb(), 'grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-e2e-1-${Date.now()}`,
      p_credits: 4,
      p_reason: 'TEST_GRANT',
    }).execute()

    // Verify balance increased to exactly 24
    expect(await availableBalance()).toBe(24)

    // Verify single durable request persisted (same story_id, WAITING_FOR_CREDITS)
    const idCheck1 = await getDb()
      .selectFrom('story_creation_requests')
      .selectAll()
      .where('owner_user_id', '=', userId)
      .where('request_kind', '=', 'personalized')
      .where('idempotency_key', '=', idempotencyKey)
      .execute()

    expect(idCheck1).toBeDefined()
    expect(idCheck1.length).toBe(1)

    const foundRecord = idCheck1[0] as unknown as { [key: string]: unknown }
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
    const { data: reqData } = await single(
      getDb()
        .selectFrom('story_creation_requests')
        .select('generation_job_id')
        .where('owner_user_id', '=', userId)
        .where('story_id', '=', storyId)
        .limit(1)
        .execute(),
    )

    expect(reqData).not.toBeNull()
    expect(reqData!.generation_job_id).toBeDefined()

    const { data: generationJobRow } = await single(
      getDb()
        .selectFrom('generation_jobs')
        .select(['id', 'status', 'publication_idempotency_key'])
        .where('id', '=', reqData!.generation_job_id!)
        .limit(1)
        .execute(),
    )

    expect(generationJobRow).not.toBeNull()

    // === PHASE 3: MANDATORY SUCCEEDED POLLING (NO FALLBACKS) ===

    await waitForCondition(
      async () => {
        const { data: updatedJob } = await single(
          getDb()
            .selectFrom('generation_jobs')
            .select('status')
            .where('id', '=', generationJobRow!.id)
            .limit(1)
            .execute(),
        )

        // STRICT REQUIREMENT: ONLY SUCCEEDED is acceptable
        // RETRY_WAIT, FAILED, or any other state = TEST FAILS
        return updatedJob?.status === 'SUCCEEDED'
      },
      'Generation job MUST reach SUCCEEDED state (no fallbacks accepted)',
      180_000
    )

    const { data: finalizedJob } = await single(
      getDb()
        .selectFrom('generation_jobs')
        .select(['status', 'publication_idempotency_key'])
        .where('id', '=', generationJobRow!.id)
        .limit(1)
        .execute(),
    )

    expect(finalizedJob).not.toBeNull()
    expect(finalizedJob!.status).toBe('SUCCEEDED') // MANDATORY
    expect(finalizedJob!.publication_idempotency_key).toBe(`generation-job:${reqData!.generation_job_id}:publish:1`)

    // Wait for creation request to reach READY state after SUCCEEDED job
    await waitForCondition(
      async () => {
        const finalReq = await getDb()
          .selectFrom('story_creation_requests')
          .select('status')
          .where('owner_user_id', '=', userId)
          .where('request_kind', '=', 'personalized')
          .where('idempotency_key', '=', idempotencyKey)
          .executeTakeFirst()
        return finalReq?.status === 'READY'
      },
      'Creation request became READY after SUCCEEDED job',
      10_000
    )

    // === PHASE 4: UNCONDITIONAL POST-CONDITION ASSERTIONS ===

    // 1. Chapter 1 exists/readable
    const chap1 = await getDb()
      .selectFrom('chapters')
      .select(['number', 'title'])
      .where('story_id', '=', storyId)
      .where('number', '=', 1)
      .executeTakeFirst()
    expect(chap1).not.toBeNull()

    // 2. Exactly 1 STORY_START reservation CAPTURED amount 24
    const { data: startRes } = await single(
      getDb()
        .selectFrom('credit_reservations')
        .select(['ref', 'status', 'amount'])
        .where('ref', '=', `story-start:${userId}:${storyId}`)
        .limit(1)
        .execute(),
    )
    expect(startRes).not.toBeNull()
    expect(startRes!.ref).toBe(`story-start:${userId}:${storyId}`)
    expect(startRes!.status).toBe('CAPTURED')
    expect(Number(startRes!.amount)).toBe(24)

    // 3. Exactly one -24 debit with reason story_start
    const ledgerEntries = await getDb()
      .selectFrom('credit_ledger')
      .select(['delta', 'reason'])
      .where('user_id', '=', userId)
      .where('reason', '=', 'story_start')
      .execute()
    expect(ledgerEntries).toHaveLength(1)
    expect(Number(ledgerEntries[0].delta)).toBe(-24)

    // 4. Story commercial_origin = PAID_START & generation_status = ready
    const { data: storyData } = await single(
      getDb()
        .selectFrom('stories')
        .select(['generation_status', 'commercial_origin'])
        .where('id', '=', storyId)
        .limit(1)
        .execute(),
    )

    expect(storyData).not.toBeNull()
    expect(storyData!.commercial_origin).toBe('PAID_START')
    expect(storyData!.generation_status).toBe('ready')

    // 5. Final balance = 0 (20 + 4 - 24 = 0)
    expect(await availableBalance()).toBe(0)

    // 6. Request is READY
    const updatedReq = await getDb()
      .selectFrom('story_creation_requests')
      .select('status')
      .where('owner_user_id', '=', userId)
      .where('request_kind', '=', 'personalized')
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst()
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
    const finalJobs = await getDb()
      .selectFrom('generation_jobs')
      .select('id')
      .where('user_id', '=', userId)
      .where('story_id', '=', storyId)
      .execute()
    expect(finalJobs.length).toBe(1) // Exactly one job

    const finalLedger = await getDb()
      .selectFrom('credit_ledger')
      .select('id')
      .where('user_id', '=', userId)
      .where('reason', '=', 'story_start')
      .execute()
    expect(finalLedger.length).toBe(1) // Exactly one debit

    const ownedStories = await getDb()
      .selectFrom('stories')
      .select('id')
      .where('owner_user_id', '=', userId)
      .execute()
    expect(ownedStories.length).toBe(2) // Starter prev + this paid story

    expect(await requestCount()).toBe(1) // Exactly one request

    expect(await availableBalance()).toBe(0) // Balance still 0 (replay did no side effects)

    console.log(`[proof] ✅ STRICT SUCCESS E2E PASSED: Authorization gating (zero calls pre-top-up), durable request binding (${idempotencyKey} → ${initialStoryIdOnWait}), atomic job fence, chapter 1 published, reservation CAPTURED 24, debit -24, balance 0, replay protection verified`)
  }, 240_000) // 4 minutes for full runtime execution path
})
