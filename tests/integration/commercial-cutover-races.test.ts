import { describe, it, expect, beforeAll, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createAdminClient } from '@/lib/supabase/admin'

const runsLocalDb = process.env.LAKOKU_LOCAL_DB_TEST === '1'
const describeLocalDb = runsLocalDb ? describe : describe.skip

describeLocalDb('Phase 2B Commercial Cutover Race & Invariant Tests', () => {
  let admin: ReturnType<typeof createAdminClient>
  const userId = '44444444-4444-4444-a444-444444444444'
  const storyId = `ai:race-${randomUUID()}`

  beforeAll(async () => {
    const raw = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { encoding: 'utf8' })
      : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { encoding: 'utf8' })
    const status = JSON.parse(raw)
    process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY

    admin = createAdminClient()
    // Seed auth user
    await admin.auth.admin.createUser({
      id: userId,
      email: 'race-test@example.com',
      email_confirm: true,
    }).catch(() => null)

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

  it('enforces that no committed QUEUED commercial job can exist without matching intent/request binding', async () => {
    const { data: jobs } = await admin
      .from('generation_jobs')
      .select('id, user_id, story_id, chapter_number, generation_kind')
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
