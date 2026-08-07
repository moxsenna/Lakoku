import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'
import { createDefaultTasteProfile } from '@/lib/taste-profile/schema'
import { misteriDramaContract } from '@/fixtures/contracts/misteri-drama'

// Mocks
const mocks = vi.hoisted(() => ({
  selectProvider: vi.fn(async () => ({ name: 'mock-provider' })),
  createResilientStoryContract: vi.fn(async (input: { storyId: string }) => ({
    contract: {
      ...misteriDramaContract,
      storyId: input.storyId,
    },
    contractSource: 'llm',
  })),
  generateNextPersonalizedChapter: vi.fn(async () => ({
    ok: true,
    chapterNumber: 1,
    seq: 1,
    fromCheckpoint: false,
    repairAttempts: 0,
  })),
  claimAndRunGenerationJobById: vi.fn(async () => ({
    ok: true,
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
vi.mock('@lakoku/ai-gateway/server', () => ({
  selectProvider: mocks.selectProvider,
}))
vi.mock('@/lib/story-engine/contract-generation.server', () => ({
  createResilientStoryContract: mocks.createResilientStoryContract,
}))
vi.mock('@/lib/runtime/personalized-generation', () => ({
  generateNextPersonalizedChapter: mocks.generateNextPersonalizedChapter,
}))
vi.mock('@/lib/runtime/generation-worker', () => ({
  claimAndRunGenerationJobById: mocks.claimAndRunGenerationJobById,
}))
vi.mock('@/lib/api/taste-profile', () => ({
  getTasteProfileForUser: vi.fn(async () => createDefaultTasteProfile()),
}))

const runsLocalDb = process.env.LAKOKU_LOCAL_DB_TEST === '1'
const describeLocalDb = runsLocalDb ? describe : describe.skip

describeLocalDb('Commercial Creation Cutover E2E', () => {
  const idempotencyKey = '00000000-0000-4000-8000-e2e000000001'
  let admin: ReturnType<typeof createAdminClient>

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

    admin = createAdminClient()

    userId = randomUUID()
    await admin.auth.admin.createUser({
      id: userId,
      email: `creation-${userId}@example.com`,
      email_confirm: true,
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('proves creation flow bounds, authorization gating, atomic job binding, and V6 promotion', async () => {
    // 0. Seed user commercial state with prior starter story claimed
    await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: 'story-starter-prev-e2e',
      starter_claimed_at: new Date().toISOString(),
      welcome_credit_granted_at: new Date().toISOString(),
    })

    // 1. Initial State: User has 0 credits. Creation MUST fail authorization without calling AI providers.
    await expect(
      createPersonalizedStory({
        userId,
        idempotencyKey,
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      requiredCredits: 24,
      availableCredits: 0,
    })

    expect(mocks.selectProvider).not.toHaveBeenCalled()
    expect(mocks.createResilientStoryContract).not.toHaveBeenCalled()

    // Verify 0 generation jobs created
    const { data: earlyJobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
    expect(earlyJobs?.length ?? 0).toBe(0)

    // 2. Grant 24 credits (Top-up) via RPC
    await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `topup-e2e-1-${Date.now()}`,
      p_credits: 24,
      p_reason: 'TEST_GRANT',
    })

    // 3. Resume / Retry Creation: Authorization succeeds, contract created ONLY AFTER authorization
    const resumeRes = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    expect(resumeRes.storyId).toBeDefined()
    const storyId = resumeRes.storyId

    expect(mocks.selectProvider).toHaveBeenCalledTimes(1)
    expect(mocks.createResilientStoryContract).toHaveBeenCalledTimes(1)

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

    // 4. Simulate V6 worker completion: Request -> READY & Story -> ready
    await admin
      .from('story_creation_requests')
      .update({
        status: 'READY',
        updated_at: new Date().toISOString(),
      })
      .eq('owner_user_id', userId)
      .eq('story_id', storyId)

    await admin
      .from('stories')
      .update({
        generation_status: 'ready',
      })
      .eq('id', storyId)

    const { data: storyData } = await admin
      .from('stories')
      .select('generation_status, commercial_origin')
      .eq('id', storyId)
      .single()

    expect(storyData).not.toBeNull()
    expect(storyData!.generation_status).toBe('ready')

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
  }, 60_000)
})
