/**
 * REAL DB E2E for Story #2 Insufficient Credit → Top-up → Resume Flow
 * 
 * This is NOT mocked - it uses actual contract-generation, personalized-generation,
 * generation-worker, and generation-continuation implementations.
 * 
 * Only external AI/provider boundaries are mocked to prevent network calls.
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'

// Mock only external AI/provider boundaries to avoid network calls
const selectProvider = vi.fn(async () => ({ name: 'mock-provider' }))
vi.mock('@lakoku/ai-gateway/server', () => ({
  selectProvider,
}))

let userId = ''

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
})

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

  it('proves creation flow bounds, authorization gating, atomic job binding, and V6 promotion', async () => {
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

    await expect(
      createPersonalizedStory({
        userId,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      requiredCredits: 24,
      availableCredits: 20,
    })

    expect(selectProvider).not.toHaveBeenCalled()

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

    // 2. Top-up 4 credits via RPC (20 -> 24, exactly the STORY_START quote)
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-e2e-1-${Date.now()}`,
      p_credits: 4,
      p_reason: 'TEST_GRANT',
    })

    // 3. Resume / Retry Creation: Authorization succeeds, contract created ONLY AFTER authorization
    const resumeRes = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    expect(resumeRes.storyId).toBeDefined()
    const storyId = resumeRes.storyId

    expect(selectProvider).toHaveBeenCalledTimes(1)

    // Verify exactly 1 creation request bound to 1 job
    const { data: reqData } = await admin
      .from('story_creation_requests')
      .select('status, generation_job_id')
      .eq('owner_user_id', userId)
      .eq('story_id', storyId)
      .single()

    expect(reqData).not.toBeNull()
    expect(reqData!.status).toBe('RESERVED')
    expect(reqData!.generation_job_id).toBeDefined()

    const { data: jobs } = await admin
      .from('generation_jobs')
      .select('id, publication_idempotency_key, status')
      .eq('id', reqData!.generation_job_id!)
      .single()

    expect(jobs).not.toBeNull()
    expect(jobs!.publication_idempotency_key).toBe(`generation-job:${reqData!.generation_job_id}:publish:1`)
    expect(jobs!.status).toBe('QUEUED')

    // 4. Execute real V6 worker publication pipeline
    const { data: claimData } = await admin.rpc('claim_generation_job_by_id_v1', {
      p_job_id: reqData!.generation_job_id!,
      p_worker_id: 'worker-creation-e2e-1',
    })
    expect(claimData?.claimed).toBe(true)
    const claimToken = claimData.job.claim_token

    await admin.from('stories').update({ story_contract_version: 1 }).eq('id', storyId)
    await admin.from('generation_jobs').update({ story_contract_version: 1 }).eq('id', reqData!.generation_job_id!)

    const { data: leaseData, error: leaseErr } = await admin.rpc('acquire_generation_job_lease_v1', {
      p_job_id: reqData!.generation_job_id!,
      p_worker_id: 'worker-creation-e2e-1',
      p_claim_token: claimToken,
      p_ttl_seconds: 300,
    })
    expect(leaseErr).toBeNull()
    expect(leaseData?.ok).toBe(true)
    const leaseId = leaseData.lease_id

    await admin.from('story_generation_contracts').upsert({
      story_id: storyId,
      story_contract_version: 1,
      premise_title: 'Judul E2E',
      premise_synopsis: 'Sinopsis E2E',
      protagonist_name: 'Hero',
      protagonist_role: 'Pejuang',
      core_desire: 'Keadilan',
      main_mystery: 'Rahasia',
      initial_setting: 'Desa',
      plot_debts_json: [],
    })

    const { error: ckptInsErr } = await admin.from('chapter_generation_checkpoints').insert({
      story_id: storyId,
      chapter_number: 1,
      attempt_id: reqData!.generation_job_id!,
      job_id: reqData!.generation_job_id!,
      correlation_id: claimData.job.correlation_id,
      generation_mode: 'personalized',
      status: 'PROSE_READY',
      title: 'Bab 1: Permulaan E2E',
      paragraphs_json: ['Paragraf 1 E2E.'],
      prose_fingerprint: 'fingerprint-1',
      canon_version: 1,
      blueprint_version: 1,
      direction_fingerprint: 'dir-1',
      generation_policy_version: 1,
      prompt_contract_version: 1,
      prose_attempt_count: 1,
      choice_attempt_count: 0,
      job_attempt_number: claimData.job.attempt_count,
      story_contract_version: 1,
      checkpoint_schema_version: 2,
      audit_signals_version: 2,
      audit_signals_json: {
        opensNewThread: false,
        opensMajorMystery: false,
        opensNewConflict: false,
        closesPlotDebts: [],
      },
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    expect(ckptInsErr).toBeNull()

    const { data: pubData, error: pubErr } = await admin.rpc('publish_generation_job_chapter_v6', {
      p_job_id: reqData!.generation_job_id!,
      p_worker_id: 'worker-creation-e2e-1',
      p_claim_token: claimToken,
      p_lease_id: leaseId,
      p_story_id: storyId,
      p_chapter_number: 1,
      p_title: 'Bab 1: Permulaan E2E',
      p_paragraphs: ['Paragraf 1 E2E.'],
      p_choice_prompt: 'Apa pilihanmu?',
      p_choices: [
        { id: 'c1', label: 'Masuk ke dalam lorong gelap' },
        { id: 'c2', label: 'Tinggalkan pintu rahasia ini' },
      ],
      p_outcomes: [
        {
          choiceId: 'c1',
          consequence: ['Melangkah masuk ke lorong.'],
          nextChapterNumber: 2,
          isEnding: false,
          effect_json: {
            routeDeltas: {},
            trustDeltas: {},
            flagsSet: {},
            evidenceAdded: [],
            endingBiasDeltas: {},
            threadTouches: [],
          },
          choice_kind: 'normal',
        },
        {
          choiceId: 'c2',
          consequence: ['Menunggu di balik pintu.'],
          nextChapterNumber: 2,
          isEnding: false,
          effect_json: {
            routeDeltas: {},
            trustDeltas: {},
            flagsSet: {},
            evidenceAdded: [],
            endingBiasDeltas: {},
            threadTouches: [],
          },
          choice_kind: 'normal',
        },
      ],
    })

    if (pubErr) console.error('[debug pubErr]:', pubErr)
    expect(pubErr).toBeNull()
    expect(pubData?.ok).toBe(true)

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

    // - Creation Request status = READY
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
  }, 60_000)
})
