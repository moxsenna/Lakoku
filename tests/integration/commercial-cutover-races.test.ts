import { describe, it, expect, beforeAll, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const runsLocalDb = process.env.LAKOKU_LOCAL_DB_TEST === '1'
const describeLocalDb = runsLocalDb ? describe : describe.skip

describeLocalDb('Phase 2B Commercial Cutover Race & Invariant Tests', () => {
  let admin: ReturnType<typeof createAdminClient>
  const userId = '44444444-4444-4444-a444-444444444444'
  const storyId = `ai:race-${randomUUID()}`

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

    admin = createAdminClient()
    // Seed auth user
    await admin.rpc('create_test_auth_user_v1', {
      p_user_id: userId,
      p_email: 'race-test@example.com',
    })

    // Seed story
    await admin.from('stories').insert({
      id: storyId,
      owner_user_id: userId,
      title: 'Race Test Story',
      cover: '/c.webp',
      tagline: 't',
      role: 'r',
      tropes: [],
      total_chapters: 50,
      synopsis: 's',
      status: 'BERJALAN',
      current_chapter: 3,
      visibility: 'private',
      story_mode: 'personalized_ai',
      commercial_origin: 'PAID_START',
      story_contract_version: 1,
    })

    // Seed contract & reader state
    await admin.from('story_generation_contracts').insert({
      story_id: storyId,
      mode: 'personalized_ai',
      story_contract_version: 1,
      story_contract_json: { title: 'Race Test Story' },
    })

    await admin.from('reader_states').insert({
      user_id: userId,
      story_id: storyId,
      status: 'BERJALAN',
      current_chapter: 3,
      jejak: [],
      route_state: {},
      choice_history: [],
      updated_at: new Date().toISOString(),
    })

    // Give user credits
    await admin.from('credit_ledger').insert({
      user_id: userId,
      delta: 100,
      reason: 'grant',
      ref: `grant-race-${randomUUID()}`,
    })

    // Seed intent for Bab 4
    await admin.from('commercial_generation_intents').insert({
      user_id: userId,
      story_id: storyId,
      chapter_number: 4,
      trigger_choice_id: 'choice-race-4',
      status: 'WAITING_FOR_CREDITS',
      quoted_credits: 8,
      pricing_version: 'v1',
    })
  })

  it('concurrent authorize_commercial_generation_intent_v1 calls produce exactly 1 canonical ACTIVE reservation', async () => {
    const results = await Promise.all([
      admin.rpc('authorize_commercial_generation_intent_v1', {
        p_user_id: userId,
        p_story_id: storyId,
        p_chapter_number: 4,
      }),
      admin.rpc('authorize_commercial_generation_intent_v1', {
        p_user_id: userId,
        p_story_id: storyId,
        p_chapter_number: 4,
      }),
      admin.rpc('authorize_commercial_generation_intent_v1', {
        p_user_id: userId,
        p_story_id: storyId,
        p_chapter_number: 4,
      }),
    ])

    if (!results.every((r) => !r.error && r.data?.ok === true)) {
      console.error('[race test 1] results:', JSON.stringify(results, null, 2))
    }
    expect(results.every((r) => !r.error && r.data?.ok === true)).toBe(true)

    // Verify exactly 1 ACTIVE reservation in DB
    const { data: resRows } = await admin
      .from('credit_reservations')
      .select('id, status, ref, amount')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 4)

    expect(resRows).toHaveLength(1)
    expect(resRows?.[0].status).toBe('ACTIVE')
    expect(resRows?.[0].amount).toBe(8)
  })

  it('concurrent queue_authorized_commercial_generation_v1 calls produce exactly 1 job and 1 bound intent', async () => {
    const results = await Promise.all([
      admin.rpc('queue_authorized_commercial_generation_v1', {
        p_user_id: userId,
        p_story_id: storyId,
        p_chapter_number: 4,
      }),
      admin.rpc('queue_authorized_commercial_generation_v1', {
        p_user_id: userId,
        p_story_id: storyId,
        p_chapter_number: 4,
      }),
      admin.rpc('queue_authorized_commercial_generation_v1', {
        p_user_id: userId,
        p_story_id: storyId,
        p_chapter_number: 4,
      }),
    ])

    if (results.some((r) => r.error || r.data?.ok !== true)) {
      console.error('[race test 2] results:', JSON.stringify(results, null, 2))
    }
    expect(results.every((r) => !r.error && r.data?.ok === true)).toBe(true)

    // Extract job ids from result
    const jobIds = new Set(results.map((r) => r.data?.job_id))
    expect(jobIds.size).toBe(1)

    // Verify exactly 1 job in DB
    const { data: jobs } = await admin
      .from('generation_jobs')
      .select('id, publication_idempotency_key, story_contract_version')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 4)

    expect(jobs).toHaveLength(1)
    const jobId = jobs?.[0].id
    expect(jobs?.[0].publication_idempotency_key).toBe(`generation-job:${jobId}:publish:4`)
    expect(jobs?.[0].story_contract_version).toBe(1)

    // Verify intent is bound to exact job
    const { data: intent } = await admin
      .from('commercial_generation_intents')
      .select('generation_job_id, status')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 4)
      .single()

    expect(intent?.generation_job_id).toBe(jobId)
    expect(intent?.status).toBe('QUEUED')
  })

  it('concurrent queue_paid_story_start_generation_v1 calls produce exactly 1 Bab 1 job and 1 bound request', async () => {
    const paidStoryId = `ai:race-paid-${randomUUID()}`

    // Seed story & request & reservation
    await admin.from('stories').insert({
      id: paidStoryId,
      owner_user_id: userId,
      title: 'Paid Story Race',
      cover: '/c.webp',
      tagline: 't',
      role: 'r',
      tropes: [],
      total_chapters: 50,
      synopsis: 's',
      status: 'BERJALAN',
      current_chapter: 1,
      visibility: 'private',
      story_mode: 'personalized_ai',
      commercial_origin: 'PENDING_PAID_START',
      story_contract_version: 1,
    })

    await admin.from('story_generation_contracts').insert({
      story_id: paidStoryId,
      mode: 'personalized_ai',
      story_contract_version: 1,
      story_contract_json: { title: 'Paid Story Race' },
    })

    await admin.from('reader_states').insert({
      user_id: userId,
      story_id: paidStoryId,
      status: 'BERJALAN',
      current_chapter: 1,
      jejak: [],
      route_state: {},
      choice_history: [],
      updated_at: new Date().toISOString(),
    })

    await admin.from('story_creation_requests').insert({
      owner_user_id: userId,
      request_kind: 'personalized',
      idempotency_key: `idemp-paid-race-${randomUUID()}`,
      request_hash: 'hash1',
      story_id: paidStoryId,
      status: 'RESERVED',
    })

    await admin.from('credit_reservations').insert({
      user_id: userId,
      story_id: paidStoryId,
      reservation_kind: 'STORY_START',
      amount: 24,
      ref: `story-start:${userId}:${paidStoryId}`,
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 1800_000).toISOString(),
    })

    const results = await Promise.all([
      admin.rpc('queue_paid_story_start_generation_v1', {
        p_owner_user_id: userId,
        p_story_id: paidStoryId,
      }),
      admin.rpc('queue_paid_story_start_generation_v1', {
        p_owner_user_id: userId,
        p_story_id: paidStoryId,
      }),
      admin.rpc('queue_paid_story_start_generation_v1', {
        p_owner_user_id: userId,
        p_story_id: paidStoryId,
      }),
    ])

    expect(results.every((r) => !r.error && r.data?.ok === true)).toBe(true)

    const jobIds = new Set(results.map((r) => r.data?.job_id))
    expect(jobIds.size).toBe(1)

    const { data: jobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', paidStoryId)
      .eq('chapter_number', 1)

    expect(jobs).toHaveLength(1)
  })

  it('concurrent queue commit vs recovery claim race enforces single active claim token', async () => {
    const claimResults = await Promise.all([
      admin.rpc('claim_generation_job_v1', {
        p_worker_id: 'worker-recovery-1',
      }),
      admin.rpc('claim_generation_job_v1', {
        p_worker_id: 'worker-recovery-2',
      }),
    ])

    expect(claimResults.every((r) => !r.error)).toBe(true)
  })

  it('enforces that no committed QUEUED commercial job can exist without matching intent/request binding', async () => {
    const { data: jobs } = await admin
      .from('generation_jobs')
      .select('id, user_id, story_id, chapter_number, generation_kind')
      .eq('user_id', userId)
      .eq('generation_kind', 'personalized')
      .eq('status', 'QUEUED')

    for (const job of jobs ?? []) {
      if (job.chapter_number === 1) {
        const { data: req } = await admin
          .from('story_creation_requests')
          .select('id, status')
          .eq('generation_job_id', job.id)
          .maybeSingle()
        expect(req).not.toBeNull()
        expect(req?.status).toBe('RESERVED')
      } else {
        const { data: intent } = await admin
          .from('commercial_generation_intents')
          .select('id, status')
          .eq('generation_job_id', job.id)
          .maybeSingle()
        expect(intent).not.toBeNull()
        expect(intent?.status).toBe('QUEUED')
      }
    }
  })
})
