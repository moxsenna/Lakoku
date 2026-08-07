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
  const storyId = 'story-choice-e2e-1'
  const chapterNumber = 4
  const choiceId = 'choice-e2e-4a'
  const idempotencyKey = '00000000-0000-4000-8000-e2e000000002'
  let admin: ReturnType<typeof createAdminClient>

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

    admin = createAdminClient()

    userId = randomUUID()
    await admin.auth.admin.createUser({
      id: userId,
      email: `choice-${userId}@example.com`,
      email_confirm: true,
    })
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

    // 1. Initial State: User has 0 credits. Choice application succeeds (durable in DB), but intent authorization returns WAITING_FOR_CREDITS
    const result = await applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber,
      choiceId,
      idempotencyKey,
    })

    expect(result.status).toBe('WAITING_FOR_CREDITS')
    expect(result.requiredCredits).toBe(8)
    expect(result.availableCredits).toBe(0)

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
    // 2a. Before top-up: resume throws INSUFFICIENT_CREDITS
    await expect(
      resumeCommercialOperation({
        userId,
        storyId,
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      requiredCredits: 8,
      availableCredits: 0,
      targetChapterNumber: 5,
    })

    // 2b. Top-up: Add 8 credits via RPC
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-choice-e2e-${Date.now()}`,
      p_credits: 8,
      p_reason: 'TEST_GRANT',
    })

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
  }, 30_000)
})
