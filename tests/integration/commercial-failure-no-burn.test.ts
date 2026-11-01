/**
 * Failure / No-Burn Test for Commercial System
 *
 * Deliberately triggers generation failure to prove financial isolation:
 * - RETRY_WAIT state: reservation ACTIVE allowed, story_start debit = 0
 * - Terminal failure: reservation RELEASED, balance restored, zero debits
 * - NO credit burn on any failure path
 *
 * Dekomisi Supabase (2026-11-01): seeding & asersi memakai Kysely (getDb) ke
 * DATABASE_URL uji — seeding via PostgREST era lama dipensiunkan. User uji
 * dibuat langsung di tabel user+account Better Auth.
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, single, rpcOne } from '@lakoku/db'
import { hashPassword } from '@/lib/auth/password'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'
import { createDeterministicProvider, type GenerationProvider, type PlanInput } from '@/lib/ai-gateway/provider'
import type { SemanticJudgeInput, SemanticJudgeResult, SemanticJudgeCode } from '@/lib/ai-gateway/semantic-continuation-judge'
import { claimAndRunAvailableJobs } from '@lakoku/runtime/server'

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

// FAULTY PROVIDER: Produces INVALID choice structure causing validation failure
const deterministicProvider = createDeterministicProvider()
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
      targetWordCount: 900,
      targetSceneCount: 2,
      opensThreadId: null,
      usesReveals: [],
      proposedStateDelta: {},
      introducesCharacters: blueprint.introducesCharacters ?? [],
    }
  },

  async writeChapter(input) {
    return deterministicProvider.writeChapter(input)
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

  beforeAll(async () => {
    // WIRING FIX: Use faulty provider directly
    mocks.selectProvider.mockResolvedValue(faultyProvider)

    const db = getDb()
    userId = randomUUID()
    const email = `fail-${userId}@example.com`
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

  it('proves financial no-burn on deliberate choice validation failure', async () => {
    // === SETUP ===

    // Seed user with starter claim
    await getDb()
      .insertInto('stories')
      .values({
        id: 'story-starter-prev-fail',
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

    const now = new Date()
    await getDb()
      .insertInto('account_commercial_states')
      .values({
        user_id: userId,
        starter_story_id: 'story-starter-prev-fail',
        starter_claimed_at: now,
        welcome_credit_granted_at: now,
      })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({
        starter_story_id: 'story-starter-prev-fail',
        starter_claimed_at: now,
        welcome_credit_granted_at: now,
      }))
      .execute()

    // Seed 20 credits, add +8 = 28 (enough for STORY_START price 24)
    await rpcOne(getDb(), 'grant_credits_v1', {
      p_user_id: userId,
      p_ref: `seed-fail-${Date.now()}`,
      p_credits: 20,
      p_reason: 'TEST_GRANT',
    }).execute()

    await rpcOne(getDb(), 'grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-fail-${Date.now()}`,
      p_credits: 8,
      p_reason: 'TEST_GRANT',
    }).execute()

    const initialBalance = 28

    // === PHASE 1: Initial attempt (will trigger job with fault generator) ===

    const resumeResult = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    const storyId = resumeResult.storyId
    expect(storyId).toBeDefined()

    // Get generation job for monitoring
    const { data: reqData } = await single(
      getDb()
        .selectFrom('story_creation_requests')
        .select('generation_job_id')
        .where('owner_user_id', '=', userId)
        .where('story_id', '=', storyId)
        .limit(1)
        .execute(),
    )

    expect(reqData?.generation_job_id).toBeDefined()

    const { data: jobRow } = await single(
      getDb()
        .selectFrom('generation_jobs')
        .select(['id', 'status', 'attempt_count', 'max_attempts'])
        .where('id', '=', reqData!.generation_job_id!)
        .limit(1)
        .execute(),
    )

    expect(jobRow).not.toBeNull()

    // === PHASE 2: Monitor RETRY_WAIT state ===

    await waitForCondition(
      async () => {
        const { data: updatedJob } = await single(
          getDb()
            .selectFrom('generation_jobs')
            .select('status')
            .where('id', '=', jobRow!.id)
            .limit(1)
            .execute(),
        )

        // Job should enter RETRY_WAIT due to choice validation failure
        return updatedJob?.status === 'RETRY_WAIT'
      },
      'Generation job entered RETRY_WAIT state',
      30_000
    )

    const { data: retryJob } = await single(
      getDb()
        .selectFrom('generation_jobs')
        .select(['status', 'attempt_count', 'max_attempts', 'last_error_code'])
        .where('id', '=', jobRow!.id)
        .limit(1)
        .execute(),
    )

    expect(retryJob).not.toBeNull()
    expect(retryJob!.status).toBe('RETRY_WAIT')
    expect(retryJob!.last_error_code).toBe('CHOICE_GENERATION_FAILED')

    // PROVE: During RETRY_WAIT, reservation MUST BE ACTIVE (required by queue_paid_story_start_generation_v1)
    const resAtRetry = await getDb()
      .selectFrom('credit_reservations')
      .select(['ref', 'status', 'amount'])
      .where('ref', '=', `story-start:${userId}:${storyId}`)
      .executeTakeFirst()

    expect(resAtRetry).not.toBeNull() // Reservation must exist during RETRY_WAIT
    expect(resAtRetry!.status).toBe('ACTIVE') // Must be active, not released yet
    expect(Number(resAtRetry!.amount)).toBe(24) // Correct price amount

    // CRITICAL: story_start debit MUST be ZERO at RETRY_WAIT stage
    const ledgerAtRetry = await getDb()
      .selectFrom('credit_ledger')
      .select('delta')
      .where('user_id', '=', userId)
      .where('reason', '=', 'story_start')
      .execute()

    expect(ledgerAtRetry.length).toBe(0) // NO debit during RETRY_WAIT

    // Balance might show reduced funds due to reservation, but NOT negative from debit
    const balAtRetry = await availableBalance()

    // At RETRY_WAIT: balance might be 4 (if 24 reserved) or 28 (if not captured yet)
    // BUT NEVER shows negative value from debit
    expect(balAtRetry).toBeGreaterThanOrEqual(0)

    // === PHASE 3: Drive production recovery tick → admission gate ===
    //
    // Kontrak runtime kini: kegagalan pilihan memasukkan story ke needs_review
    // (antrean review editorial), sehingga recovery tick berikutnya DIBLOKIR
    // oleh admission gate → job terminal FAILED dengan FAILED_REVIEW_REQUIRED.
    // Invarian no-burn (nol debit, reservasi dilepas, saldo pulih) tidak berubah.

    // Tunggu available_at job sebelum tick pemulihan.
    const { data: currentJob } = await single(
      getDb()
        .selectFrom('generation_jobs')
        .select(['status', 'attempt_count', 'max_attempts', 'available_at'])
        .where('id', '=', jobRow!.id)
        .limit(1)
        .execute(),
    )
    if (!currentJob) throw new Error('Failed to query generation job before recovery tick')
    expect(currentJob.status).toBe('RETRY_WAIT')

    const waitMs = Math.max(0, Date.parse(String(currentJob.available_at)) - Date.now())
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs + 100, 5_000)))
    }

    // Poll: skew jam DB (Neon) vs mesin lokal bisa membuat available_at efektif
    // sedikit lebih lambat dari perhitungan lokal — tick ulang sampai job ter-claim.
    let tick: Awaited<ReturnType<typeof claimAndRunAvailableJobs>> | undefined
    const claimDeadline = Date.now() + 20_000
    while (Date.now() < claimDeadline) {
      const t = await claimAndRunAvailableJobs({
        maxJobs: 1,
        workerIdPrefix: 'test-commercial-no-burn',
      })
      if (t.ran >= 1) {
        tick = t
        break
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    expect(tick).toBeDefined()
    expect(tick!.ran).toBe(1)
    expect(tick!.results[0]?.jobId).toBe(jobRow!.id)
    expect(tick!.results[0]?.outcome).toBe('FAILED') // Admission gate: needs_review → terminal

    await waitForCondition(
      async () => {
        const { data: finalJob } = await single(
          getDb()
            .selectFrom('generation_jobs')
            .select('status')
            .where('id', '=', jobRow!.id)
            .limit(1)
            .execute(),
        )

        return finalJob?.status === 'FAILED'
      },
      'Generation job reached terminal FAILED state via review admission gate',
      5_000,
    )

    const { data: terminalJob } = await single(
      getDb()
        .selectFrom('generation_jobs')
        .select(['status', 'last_error_code', 'last_error_class'])
        .where('id', '=', jobRow!.id)
        .limit(1)
        .execute(),
    )

    expect(terminalJob).not.toBeNull()
    expect(terminalJob!.status).toBe('FAILED')
    expect(terminalJob!.last_error_code).toBe('FAILED_REVIEW_REQUIRED')
    expect(terminalJob!.last_error_class).toBe('TERMINAL')

    // === PHASE 4: Terminal failure post-conditions ===

    // 1. Reservation MUST BE RELEASED on terminal FAILED (terminal finalizer releases it)
    const resAfterFail = await getDb()
      .selectFrom('credit_reservations')
      .select(['ref', 'status', 'amount'])
      .where('ref', '=', `story-start:${userId}:${storyId}`)
      .executeTakeFirst()

    expect(resAfterFail).not.toBeNull() // Must exist

    // TERMINAL FINALIZER PROOF: Reservation released after terminal FAILED
    expect(resAfterFail!.status).toBe('RELEASED')
    expect(Number(resAfterFail!.amount)).toBe(24)

    console.log(`[proof] Terminal finalizer released reservation after FAILED`)

    // CRITICAL: story_start debit count = 0 (NO credit burn even though reservation was active during retries)
    const ledgerAfterFail = await getDb()
      .selectFrom('credit_ledger')
      .select('delta')
      .where('user_id', '=', userId)
      .where('reason', '=', 'story_start')
      .execute()

    expect(ledgerAfterFail.length).toBe(0) // Critical: no debit on failure

    console.log(`[proof] Credit ledger verified: zero story_start debits on terminal failure`)

    // Balance fully restored (no debit occurred)
    const balAfterFail = await availableBalance()

    // After terminal failure + release: balance fully restored to initial amount
    expect(balAfterFail).toBe(initialBalance)

    console.log(`[proof] Balance after terminal FAILED with RELEASED reservation: ${balAfterFail} (full restoration)`)

    // 4. Zero duplicate jobs/reservations/requests
    const jobCountAfterFail = await getDb()
      .selectFrom('generation_jobs')
      .select('id')
      .where('user_id', '=', userId)
      .where('story_id', '=', storyId)
      .execute()

    expect(jobCountAfterFail.length).toBe(1) // Exactly one job, no retry duplicates

    const reqCount = await getDb()
      .selectFrom('story_creation_requests')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('owner_user_id', '=', userId)
      .where('request_kind', '=', 'personalized')
      .execute()
    expect(Number(reqCount[0]?.n)).toBe(1) // Single durable request

    // Terminal failure releases money but preserves retryable story/request shell.
    // Same-key retry may reactivate reservation and bind a replacement job.
    const { data: requestAfterFail } = await single(
      getDb()
        .selectFrom('story_creation_requests')
        .select(['status', 'generation_job_id'])
        .where('owner_user_id', '=', userId)
        .where('story_id', '=', storyId)
        .limit(1)
        .execute(),
    )

    expect(requestAfterFail?.status).toBe('RESERVED')
    expect(requestAfterFail?.generation_job_id).toBe(jobRow!.id)

    const { data: storyAfterFail } = await single(
      getDb()
        .selectFrom('stories')
        .select(['generation_status', 'commercial_origin'])
        .where('id', '=', storyId)
        .limit(1)
        .execute(),
    )

    expect(storyAfterFail).not.toBeNull()
    // Rute review editorial: shell cerita diparkir di needs_review menunggu
    // keputusan review (dulu creating_contract pada narasi auto-retry lama).
    expect(storyAfterFail!.generation_status).toBe('needs_review')
    expect(storyAfterFail!.commercial_origin).toBe('PENDING_PAID_START')

    console.log(`[proof] ✅ FAILURE NO-BURN VERIFIED: RETRY_WAIT had zero debits, terminal FAILED released reservation, balance restored to ${initialBalance}, shell preserved in needs_review, zero duplicates across all domains`)
  }, 300_000)
})
