import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyPersonalizedChoice } from '@/lib/api/personalized-choice.server'
import { resumeCommercialOperation } from '@/lib/api/commercial-resume.server'

// Mocks
const mocks = vi.hoisted(() => ({
  continuePersonalizedGeneration: vi.fn(async () => ({
    nextChapterReady: false,
  })),
}))

let userId = ''

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const client = createAdminClient()
    client.auth.getUser = vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) as unknown as typeof client.auth.getUser
    return client
  }),
}))
vi.mock('@/lib/api/generation-continuation.server', () => ({
  continuePersonalizedGeneration: mocks.continuePersonalizedGeneration,
}))

const runsLocalDb = process.env.LAKOKU_LOCAL_DB_TEST === '1'
const describeLocalDb = runsLocalDb ? describe : describe.skip

describeLocalDb('Commercial Choice Cutover E2E', () => {
  let storyId = ''
  const chapterNumber = 4
  const choiceId = 'choice-e2e-4a'
  const idempotencyKey = '00000000-0000-4000-8000-e2e000000002'
  let admin: ReturnType<typeof createAdminClient>

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

    admin = createAdminClient()
    try { await admin.rpc('reload_schema_cache_v1') } catch {}
    storyId = `ai:choice-e2e-${randomUUID()}`

    userId = randomUUID()
    const { error: userErr } = await admin.rpc('create_test_auth_user_v1', {
      p_user_id: userId,
      p_email: `choice-${userId}@example.com`,
    })
    if (userErr) throw new Error(`create_test_auth_user_v1 failed: ${JSON.stringify(userErr)}`)
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('proves choice durability before authorization, WAITING_FOR_CREDITS 402 status, resume flow, and replay idempotency', async () => {
    // Setup story shell & contract & reader_state
    const { error: storyErr } = await admin.from('stories').upsert({
      id: storyId,
      owner_user_id: userId,
      title: 'Story Choice E2E',
      cover: 'https://example.com/cover.jpg',
      tagline: 'Tagline E2E',
      role: 'Protagonist',
      tropes: ['Drama'],
      total_chapters: 50,
      synopsis: 'Synopsis E2E',
      story_mode: 'personalized_ai',
      visibility: 'private',
      commercial_origin: 'PAID_START',
      story_contract_version: 1,
      generation_status: 'ready',
    })
    if (storyErr) console.error('storyErr:', storyErr)

    const { error: contractErr } = await admin.from('story_generation_contracts').upsert({
      story_id: storyId,
      mode: 'personalized_ai',
      total_chapters: 50,
      contract_source: 'llm',
      story_contract_version: 1,
    })
    if (contractErr) console.error('contractErr:', contractErr)

    const { error: readerErr } = await admin.from('reader_states').upsert({
      user_id: userId,
      story_id: storyId,
      status: 'BERJALAN',
      current_chapter: 4,
      jejak: [],
      ending_name: null,
      route_state: { truth: 0, risk: 0, secrecy: 0, empathy: 0, trust: {}, evidence: [], flags: {}, endingBias: {} },
      choice_history: [],
      locked_ending_key: null,
      updated_at: new Date().toISOString(),
    })
    if (readerErr) console.error('readerErr:', readerErr)

    const { error: chapErr } = await admin.from('chapters').upsert({
      story_id: storyId,
      number: 4,
      title: 'Bab 4 E2E',
      paragraphs: ['Paragraf Bab 4 E2E'],
      choices: [{ id: choiceId, label: 'Lanjutkan E2E' }],
    })
    if (chapErr) console.error('chapErr:', chapErr)

    const { error: outcomeErr } = await admin.from('choice_outcomes').upsert({
      story_id: storyId,
      chapter_number: 4,
      choice_id: choiceId,
      consequence: ['Consequence E2E'],
      next_chapter_number: 5,
      is_ending: false,
      effect_json: {
        routeDeltas: {},
        trustDeltas: {},
        flagsSet: {},
        evidenceAdded: [],
        endingBiasDeltas: {},
      },
      choice_kind: 'normal',
    })
    if (outcomeErr) console.error('outcomeErr:', outcomeErr)

    // 1. Seed partial balance (4 credits). Cost to unlock chapter 5 is 8.
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `seed-balance-choice-e2e-${Date.now()}`,
      p_credits: 4,
      p_reason: 'TEST_GRANT',
    })

    // 1a. Choice application succeeds (durable in DB), but intent authorization returns WAITING_FOR_CREDITS
    const result = await applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber,
      choiceId,
      idempotencyKey,
    })

    expect(result.status).toBe('WAITING_FOR_CREDITS')
    expect(result.requiredCredits).toBe(8)
    expect(result.availableCredits).toBe(4)

    // Verify NO reservation captured yet; balance untouched at 4 before resume attempt
    const { data: earlyReservations } = await admin
      .from('credit_reservations')
      .select('id')
      .eq('user_id', userId)
    expect(earlyReservations?.length ?? 0).toBe(0)

    const { data: earlyBalance } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(earlyBalance).toBe(4)

    // Verify intent created in DB with status WAITING_FOR_CREDITS
    const { data: intentData } = await admin
      .from('commercial_generation_intents')
      .select('status, trigger_choice_id, generation_job_id')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 5)
      .single()

    expect(intentData).not.toBeNull()
    expect(intentData!.status).toBe('WAITING_FOR_CREDITS')
    expect(intentData!.trigger_choice_id).toBe(choiceId)
    expect(intentData!.generation_job_id).toBeNull()

    // 2. Resume without choiceId (caller cannot supply choiceId; reads exact intent from DB)
    // 2a. Before top-up: resume throws INSUFFICIENT_CREDITS with available balance still 4
    await expect(
      resumeCommercialOperation({
        userId,
        storyId,
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      requiredCredits: 8,
      availableCredits: 4,
      targetChapterNumber: 5,
    })

    // 2b. Top-up 4 credits (4 -> 8)
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-choice-e2e-${Date.now()}`,
      p_credits: 4,
      p_reason: 'TEST_GRANT',
    })

    const { data: balanceAfterTopup } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(balanceAfterTopup).toBe(8)

    // 2c. Resume after top-up: Authorizes intent & queues Bab 5 job atomically
    const resumeRes = await resumeCommercialOperation({
      userId,
      storyId,
    })

    expect(resumeRes.ok).toBe(true)
    expect(resumeRes.operationType).toBe('chapter')
    expect(resumeRes.chapterNumber).toBe(5)

    // Verify intent status updated to QUEUED and bound to exact job
    const { data: updatedIntent } = await admin
      .from('commercial_generation_intents')
      .select('status, generation_job_id')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 5)
      .single()

    expect(updatedIntent).not.toBeNull()
    expect(updatedIntent!.status).toBe('QUEUED')
    expect(updatedIntent!.generation_job_id).toBeDefined()

    const { data: job } = await admin
      .from('generation_jobs')
      .select('publication_idempotency_key, trigger_choice_id')
      .eq('id', updatedIntent!.generation_job_id!)
      .single()

    expect(job).not.toBeNull()
    expect(job!.publication_idempotency_key).toBe(`generation-job:${updatedIntent!.generation_job_id}:publish:5`)
    expect(job!.trigger_choice_id).toBe(choiceId)

    // 2d. Execute real V6 worker publication pipeline for Bab 5
    const { data: claimData } = await admin.rpc('claim_generation_job_by_id_v1', {
      p_job_id: updatedIntent!.generation_job_id!,
      p_worker_id: 'worker-choice-e2e-1',
    })
    expect(claimData?.claimed).toBe(true)

    const claimToken = claimData.job.claim_token

    await admin.from('stories').update({ story_contract_version: 1 }).eq('id', storyId)
    await admin.from('generation_jobs').update({ story_contract_version: 1 }).eq('id', updatedIntent!.generation_job_id!)

    const { data: leaseData, error: leaseErr } = await admin.rpc('acquire_generation_job_lease_v1', {
      p_job_id: updatedIntent!.generation_job_id!,
      p_worker_id: 'worker-choice-e2e-1',
      p_claim_token: claimToken,
      p_ttl_seconds: 300,
    })
    expect(leaseErr).toBeNull()
    expect(leaseData?.ok).toBe(true)
    const leaseId = leaseData.lease_id

    await admin.from('story_generation_contracts').upsert({
      story_id: storyId,
      story_contract_version: 1,
      premise_title: 'Judul E2E Choice',
      premise_synopsis: 'Sinopsis E2E Choice',
      protagonist_name: 'Hero',
      protagonist_role: 'Pejuang',
      core_desire: 'Keadilan',
      main_mystery: 'Rahasia',
      initial_setting: 'Desa',
      plot_debts_json: [],
    })

    const { error: ckptInsErr } = await admin.from('chapter_generation_checkpoints').insert({
      story_id: storyId,
      chapter_number: 5,
      attempt_id: updatedIntent!.generation_job_id!,
      job_id: updatedIntent!.generation_job_id!,
      correlation_id: claimData.job.correlation_id,
      generation_mode: 'personalized',
      status: 'PROSE_READY',
      title: 'Bab 5: Pengungkapan E2E',
      paragraphs_json: ['Paragraf Bab 5 E2E.'],
      prose_fingerprint: 'fingerprint-5',
      canon_version: 1,
      blueprint_version: 1,
      direction_fingerprint: 'dir-5',
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
      p_job_id: updatedIntent!.generation_job_id!,
      p_worker_id: 'worker-choice-e2e-1',
      p_claim_token: claimToken,
      p_lease_id: leaseId,
      p_story_id: storyId,
      p_chapter_number: 5,
      p_title: 'Bab 5: Pengungkapan E2E',
      p_paragraphs: ['Paragraf Bab 5 E2E.'],
      p_choice_prompt: 'Apa pilihanmu?',
      p_choices: [
        { id: 'c5a', label: 'Ambil peti tua yang berdebu' },
        { id: 'c5b', label: 'Periksa jendela kaca retak' },
      ],
      p_outcomes: [
        {
          choiceId: 'c5a',
          consequence: ['Membuka isi peti tua.'],
          nextChapterNumber: 6,
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
          choiceId: 'c5b',
          consequence: ['Melihat keluar jendela.'],
          nextChapterNumber: 6,
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

    expect(pubErr).toBeNull()
    expect(pubData?.ok).toBe(true)

    // Verify V6 post-conditions for choice:
    // - Chapter 5 published
    const { data: chap5 } = await admin
      .from('chapters')
      .select('number, title')
      .eq('story_id', storyId)
      .eq('number', 5)
      .single()
    expect(chap5).not.toBeNull()

    // - Reservation CAPTURED
    const { data: choiceRes } = await admin
      .from('credit_reservations')
      .select('status')
      .eq('ref', `chapter-reservation:${userId}:${storyId}:5`)
      .single()
    expect(choiceRes?.status).toBe('CAPTURED')

    // - Intent FULFILLED
    const { data: fulfilledIntent } = await admin
      .from('commercial_generation_intents')
      .select('status')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 5)
      .single()
    expect(fulfilledIntent?.status).toBe('FULFILLED')

    // - Exactly one -8 debit with reason unlock_chapter
    const { data: ledgerEntries } = await admin
      .from('credit_ledger')
      .select('delta, reason')
      .eq('user_id', userId)
      .eq('reason', 'unlock_chapter')
    expect(ledgerEntries).toHaveLength(1)
    expect(ledgerEntries?.[0].delta).toBe(-8)

    // 3. Replay: Calling applyPersonalizedChoice again with same choice and idempotencyKey returns replayed outcome without duplicate job or intent
    const replayRes = await applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber,
      choiceId,
      idempotencyKey,
    })

    expect(replayRes.replayed).toBe(true)

    const { data: allJobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 5)

    expect(allJobs?.length).toBe(1)

    const { data: finalLedger } = await admin
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('reason', 'unlock_chapter')
    expect(finalLedger?.length).toBe(1)

    // - Final balance exactly 0 (4 + 4 - 8); one intent FULFILLED, no duplicate jobs/intents/chapters
    const { data: finalBalance } = await admin
      .rpc('available_credit_balance_v1', { p_user_id: userId })
    expect(finalBalance).toBe(0)

    const { data: finalIntent } = await admin
      .from('commercial_generation_intents')
      .select('status')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 5)
      .single()
    expect(finalIntent?.status).toBe('FULFILLED')
  }, 30_000)
})
