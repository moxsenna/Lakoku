// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { continuationCalls } = vi.hoisted(() => ({
  continuationCalls: [] as Array<{ jobId?: string; storyId: string; chapterNumber: number }>,
}))

vi.mock('@/lib/api/generation-continuation.server', () => ({
  CONTINUATION_WAIT_MS: 25_000,
  continuationJobKey: (storyId: string, chapterNumber: number) => `${storyId}:${chapterNumber}`,
  continuePersonalizedGeneration: async (input: { jobId?: string; storyId: string; chapterNumber: number }) => {
    continuationCalls.push(input)
    return { nextChapterReady: false }
  },
  continueStandardGeneration: async () => ({ nextChapterReady: false }),
}))

const userId = '88888888-8888-4888-8888-888888888888'

function getLocalStatus() {
  try {
    const raw = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const jsonStr = raw.match(/{[\s\S]*}/)?.[0] ?? raw
    const parsed = JSON.parse(jsonStr) as Record<string, string>
    return {
      url: parsed.API_URL ?? 'http://127.0.0.1:54321',
      key: parsed.SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    }
  } catch {
    return {
      url: 'http://127.0.0.1:54321',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
    }
  }
}

const status = getLocalStatus()
process.env.SUPABASE_URL = status.url
process.env.SUPABASE_SERVICE_ROLE_KEY = status.key

import { createAdminClient } from '@/lib/supabase/admin'
import { applyPersonalizedChoice } from '@/lib/api/personalized-choice.server'
import { createPersonalizedStory } from '@/lib/api/personalized-stories.server'
import { clonePremiumStoryForUser, PremiumCloneError } from '@/lib/api/premium-clone.server'
import * as aiGatewayModule from '@lakoku/ai-gateway/server'
import * as contractGenModule from '@/lib/story-engine/contract-generation.server'
import * as personalizedGenModule from '@/lib/runtime/personalized-generation'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const admin = createAdminClient()
    return {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
      from: (table: string) => admin.from(table),
    }
  }),
}))

describe.skipIf(!process.env.LAKOKU_LOCAL_DB_TEST)('Real Application -> Local DB Integration Test Harness', () => {
  let admin: ReturnType<typeof createAdminClient>
  let selectProviderSpy: ReturnType<typeof vi.spyOn>
  let createResilientStoryContractSpy: ReturnType<typeof vi.spyOn>
  let generateNextPersonalizedChapterSpy: ReturnType<typeof vi.spyOn>
  const storyId = 'story-real-db-ch3'

  beforeAll(async () => {
    if (!process.env.LAKOKU_LOCAL_DB_TEST) return
    selectProviderSpy = vi.spyOn(aiGatewayModule, 'selectProvider')
    createResilientStoryContractSpy = vi.spyOn(contractGenModule, 'createResilientStoryContract')
    generateNextPersonalizedChapterSpy = vi.spyOn(personalizedGenModule, 'generateNextPersonalizedChapter')
    admin = createAdminClient()

    // Ensure user exists in auth.users
    await admin.auth.admin.createUser({
      id: userId,
      email: 'realappdb@example.com',
      password: 'password123',
      email_confirm: true,
    }).catch(() => null)

    // 1. Cleanup test fixtures
    await admin.from('commercial_generation_intents').delete().eq('user_id', userId)
    await admin.from('generation_leases').delete().eq('story_id', storyId)
    await admin.from('reader_states').delete().eq('user_id', userId)
    await admin.from('choice_outcomes').delete().eq('story_id', storyId)
    await admin.from('chapters').delete().eq('story_id', storyId)
    await admin.from('stories').delete().eq('owner_user_id', userId)
    await admin.from('story_creation_requests').delete().eq('owner_user_id', userId)
    await admin.from('generation_jobs').delete().eq('user_id', userId)
    await admin.from('credit_reservations').delete().eq('user_id', userId)
    await admin.from('account_commercial_states').delete().eq('user_id', userId)

    // Ensure template story exists for premium clone test
    await admin.from('chapter_blueprints').delete().eq('story_id', 'premium:rain-archive')
    await admin.from('story_generation_contracts').delete().eq('story_id', 'premium:rain-archive')
    await admin.from('stories').delete().eq('id', 'premium:rain-archive')

    await admin.from('stories').insert({
      id: 'premium:rain-archive',
      title: 'Rain Archive Template',
      cover: '/cover.webp',
      tagline: 'Template Tagline',
      role: 'Role',
      tropes: ['mystery'],
      total_chapters: 50,
      synopsis: 'Template synopsis',
      status: 'SELESAI',
      current_chapter: 50,
      jejak: [],
      visibility: 'public',
      story_mode: 'premium_template',
      generation_status: 'ready',
      story_contract_version: 1,
    })

    await admin.from('story_generation_contracts').insert({
      story_id: 'premium:rain-archive',
      mode: 'premium_template',
      total_chapters: 50,
      contract_source: 'llm_repaired',
      onboarding_json: { hero: 'char:hero' },
      story_contract_json: { storyId: 'premium:rain-archive' },
      route_schema_json: {},
      plot_debts_json: [],
      ending_candidates_json: [],
      ending_lock_json: {},
      quality_profile: 'lakoku_mobile_drama_v1',
      story_contract_version: 1,
    })

    const blueprints = Array.from({ length: 50 }, (_, i) => ({
      story_id: 'premium:rain-archive',
      chapter_number: i + 1,
      version: 1,
      phase: i < 15 ? 'ACT_1' : i < 35 ? 'ACT_2' : 'ACT_3',
      chapter_goal: `Goal ${i + 1}`,
      mandatory_beats: ['beat-1'],
      forbidden_reveals: [],
      allowed_state_delta: {},
      introduces_characters: [],
    }))
    await admin.from('chapter_blueprints').insert(blueprints)
  })

  afterAll(async () => {
    selectProviderSpy?.mockRestore()
    createResilientStoryContractSpy?.mockRestore()
    generateNextPersonalizedChapterSpy?.mockRestore()
    // Cleanup after test
    await admin.from('commercial_generation_intents').delete().eq('user_id', userId)
    await admin.from('generation_leases').delete().eq('story_id', storyId)
    await admin.from('reader_states').delete().eq('user_id', userId)
    await admin.from('choice_outcomes').delete().eq('story_id', storyId)
    await admin.from('chapters').delete().eq('story_id', storyId)
    await admin.from('stories').delete().eq('owner_user_id', userId)
    await admin.from('story_creation_requests').delete().eq('owner_user_id', userId)
    await admin.from('generation_jobs').delete().eq('user_id', userId)
    await admin.from('credit_reservations').delete().eq('user_id', userId)
    await admin.from('account_commercial_states').delete().eq('user_id', userId)
  })

  beforeEach(() => {
    selectProviderSpy?.mockClear()
    createResilientStoryContractSpy?.mockClear()
    generateNextPersonalizedChapterSpy?.mockClear()
    continuationCalls.length = 0
  })

  it('applyPersonalizedChoice application TS wrapper executes 9-arg apply_personalized_choice_v2 against real local Postgres DB', async () => {
    // Seed test story & state
    const { error: storyErr } = await admin.from('stories').insert({
      id: storyId,
      title: 'Real DB Integration Story',
      cover: '/cover.webp',
      tagline: 'Tagline',
      role: 'Role',
      tropes: [],
      total_chapters: 50,
      status: 'BARU',
      current_chapter: 3,
      jejak: [],
      owner_user_id: userId,
      visibility: 'private',
      story_mode: 'personalized_ai',
      commercial_origin: 'STARTER_FREE',
      generation_status: 'ready',
    })
    expect(storyErr).toBeNull()

    // Also seed starter account state matching storyId for STARTER_FREE identity check
    await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: storyId,
      starter_claimed_at: new Date().toISOString(),
    })

    const initialUpdatedAt = new Date().toISOString()

    const { error: rsErr } = await admin.from('reader_states').insert({
      user_id: userId,
      story_id: storyId,
      status: 'BERJALAN',
      current_chapter: 3,
      jejak: [],
      route_state: { truth: 1, risk: 0, secrecy: 0, empathy: 0, trust: {}, evidence: [], flags: {}, endingBias: {} },
      choice_history: [],
      updated_at: initialUpdatedAt,
    })
    expect(rsErr).toBeNull()

    const { error: chErr } = await admin.from('chapters').insert({
      story_id: storyId,
      number: 3,
      title: 'Bab 3',
      paragraphs: ['Isi bab 3.'],
      choice_prompt: 'Pilihan:',
      choices: [{ id: 'choice-real-a', label: 'Buka Rahasia' }],
    })
    expect(chErr).toBeNull()

    const { error: coErr } = await admin.from('choice_outcomes').insert({
      story_id: storyId,
      chapter_number: 3,
      choice_id: 'choice-real-a',
      consequence: ['Rahasia terungkap.'],
      next_chapter_number: 4,
      is_ending: false,
      effect_json: { routeDeltas: { truth: 1 }, trustDeltas: {}, flagsSet: { secret_revealed: true }, evidenceAdded: [], endingBiasDeltas: {} },
      choice_kind: 'normal',
    })
    expect(coErr).toBeNull()

    let choiceResult
    try {
      choiceResult = await applyPersonalizedChoice({
        userId,
        storyId,
        chapterNumber: 3,
        choiceId: 'choice-real-a',
        idempotencyKey: `real-key:${storyId}:3:choice-real-a`,
      })
    } catch (err) {
      console.error('APPLY_CHOICE_FULL_ERROR:', err)
      throw err
    }

    expect(choiceResult.nextChapterNumber).toBe(4)
    expect(choiceResult.replayed).toBe(false)

    // Verify reader_states mutated in DB
    const { data: readerState } = await admin
      .from('reader_states')
      .select('current_chapter, jejak, choice_history, route_state')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .single()

    expect(readerState?.current_chapter).toBe(4)
    expect(readerState?.jejak).toHaveLength(1)
    expect(readerState?.choice_history).toHaveLength(1)

    // Verify intent created atomically in DB for Chapter 4
    const { data: intent } = await admin
      .from('commercial_generation_intents')
      .select('status, trigger_choice_id, quoted_credits, pricing_version')
      .eq('user_id', userId)
      .eq('story_id', storyId)
      .eq('chapter_number', 4)
      .single()

    expect(intent).toBeDefined()
    expect(intent?.status).toBe('WAITING_FOR_CREDITS')
    expect(intent?.trigger_choice_id).toBe('choice-real-a')
    expect(intent?.quoted_credits).toBeGreaterThan(0)

    // Replay idempotently via app wrapper
    const replayResult = await applyPersonalizedChoice({
      userId,
      storyId,
      chapterNumber: 3,
      choiceId: 'choice-real-a',
      idempotencyKey: `real-key:${storyId}:3:choice-real-a`,
    })

    expect(replayResult.replayed).toBe(true)
  })

  it('createPersonalizedStory Story #2 application orchestration: shell created with NULL origin -> reserve_story_start_v1 updates origin to PENDING_PAID_START -> queues exact Bab 1 job (job-authoritative, no legacy generation)', async () => {
    // 1. Mark user as having claimed a DIFFERENT starter story
    const { error: upsertErr } = await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: 'story-starter-prev-1',
      starter_claimed_at: new Date().toISOString(),
      welcome_credit_granted_at: new Date().toISOString(),
    })
    expect(upsertErr).toBeNull()

    // 2. Grant credits (sufficient for STORY_START quote)
    const { data: gData, error: gErr } = await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `ref-test-grant-story2-${Date.now()}`,
      p_credits: 100,
      p_reason: 'TEST_GRANT',
    })
    expect(gErr).toBeNull()
    expect(gData).toBe(true)

    const idempotencyKey = `p2-app-key-${Date.now()}`

    // 3. Invoke application creation function: commercial flow proceeds via exact queued job
    const result = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })

    // Pending until the claimed job publishes Bab 1
    expect(result.storyId).toBeDefined()
    expect(result.pending).toBe(true)
    const createdStoryId = result.storyId

    // 4. Verify DB creation request remains RESERVED and is bound to the canonical job
    const { data: reqRow } = await admin
      .from('story_creation_requests')
      .select('status, generation_job_id')
      .eq('owner_user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .single()

    expect(reqRow?.status).toBe('RESERVED')
    expect(reqRow?.generation_job_id).toBeTruthy()

    // 5. Verify DB story row was transitioned to PENDING_PAID_START by reserve_story_start_v1
    const { data: transitionedStory } = await admin
      .from('stories')
      .select('commercial_origin')
      .eq('id', createdStoryId)
      .single()

    expect(transitionedStory?.commercial_origin).toBe('PENDING_PAID_START')

    // 6. Exactly one canonical Bab 1 generation job, bound to the request
    const { data: jobRows } = await admin
      .from('generation_jobs')
      .select('id, chapter_number, status')
      .eq('user_id', userId)
      .eq('story_id', createdStoryId)
      .eq('chapter_number', 1)

    expect(jobRows).toHaveLength(1)
    expect(jobRows?.[0].id).toBe(reqRow?.generation_job_id)

    // 7. Continuation was kicked with the EXACT queued jobId (job-authoritative wiring)
    expect(continuationCalls).toHaveLength(1)
    expect(continuationCalls[0]?.jobId).toBe(reqRow?.generation_job_id)
    expect(continuationCalls[0]?.storyId).toBe(createdStoryId)

    // 8. Exactly one ACTIVE STORY_START reservation for the quoted amount
    const { data: reservationRows } = await admin
      .from('credit_reservations')
      .select('status, amount, reservation_kind')
      .eq('user_id', userId)
      .eq('story_id', createdStoryId)
      .eq('reservation_kind', 'STORY_START')

    expect(reservationRows).toHaveLength(1)
    expect(reservationRows?.[0].status).toBe('ACTIVE')
    expect(reservationRows?.[0].amount).toBe(24)

    // 9. Commercial path must NOT fall into legacy generation
    expect(generateNextPersonalizedChapterSpy).toHaveBeenCalledTimes(0)

    // 10. Contract created through the real pipeline; provider selected only for contract
    expect(createResilientStoryContractSpy).toHaveBeenCalledTimes(1)
    expect(selectProviderSpy).toHaveBeenCalledTimes(1)

    // 11. Replay with same idempotency key returns same story ID and re-kicks the SAME job
    const replayResult = await createPersonalizedStory({
      userId,
      idempotencyKey,
    })
    expect(replayResult.storyId).toBe(createdStoryId)

    const { data: replayJobs } = await admin
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', createdStoryId)
      .eq('chapter_number', 1)
    expect(replayJobs).toHaveLength(1)

    const { data: replayReservations } = await admin
      .from('credit_reservations')
      .select('id')
      .eq('user_id', userId)
      .eq('story_id', createdStoryId)
      .eq('reservation_kind', 'STORY_START')
    expect(replayReservations).toHaveLength(1)

    expect(continuationCalls).toHaveLength(2)
    expect(continuationCalls[1]?.jobId).toBe(reqRow?.generation_job_id)
  })

  it('clonePremiumStoryForUser Story #2 application orchestration: shell target created -> reserve_story_start_v1 updates origin to PENDING_PAID_START -> stops with COMMERCIAL_RUNTIME_NOT_READY (0 provider calls)', async () => {
    // User already claimed different starter story
    await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: 'story-starter-prev-1',
      starter_claimed_at: new Date().toISOString(),
    })

    const idempotencyKey = `p2-prem-app-key-${Date.now()}`

    let errToVerify: unknown
    try {
      await clonePremiumStoryForUser({
        userId,
        templateStoryId: 'premium:rain-archive',
        idempotencyKey,
      })
    } catch (err) {
      errToVerify = err
    }

    expect(errToVerify).toBeInstanceOf(PremiumCloneError)
    const pErr = errToVerify as PremiumCloneError
    expect(pErr.code).toBe('COMMERCIAL_RUNTIME_NOT_READY')
    expect(pErr.result?.storyId).toBeDefined()

    const createdStoryId = pErr.result!.storyId

    // Verify DB story creation request remains RESERVED
    const { data: reqRow } = await admin
      .from('story_creation_requests')
      .select('status')
      .eq('owner_user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .single()

    expect(reqRow?.status).toBe('RESERVED')

    // Verify DB story row origin transitioned to PENDING_PAID_START
    const { data: transitionedStory } = await admin
      .from('stories')
      .select('commercial_origin')
      .eq('id', createdStoryId)
      .single()

    expect(transitionedStory?.commercial_origin).toBe('PENDING_PAID_START')
    expect(generateNextPersonalizedChapterSpy).toHaveBeenCalledTimes(0)
  })

  it('rejects non-canonical reservation ref in resolveCommercialAuthorization against local DB', async () => {
    const testStoryId = `story-non-canon-${Date.now()}`
    await admin.from('stories').insert({
      id: testStoryId,
      owner_user_id: userId,
      title: 'Test Story',
      cover: '/covers/default.webp',
      tagline: 'Test',
      role: 'Tokoh',
      tropes: [],
      total_chapters: 50,
      synopsis: 'Test',
      status: 'BARU',
      current_chapter: 0,
      jejak: [],
      visibility: 'private',
      story_mode: 'personalized_ai',
      commercial_origin: 'PENDING_PAID_START',
    })

    // Insert active reservation with a deliberately non-canonical ref format
    const expiresAt = new Date(Date.now() + 3600000).toISOString()
    const { error: resErr } = await admin.from('credit_reservations').insert({
      user_id: userId,
      story_id: testStoryId,
      chapter_number: 1,
      reservation_kind: 'STORY_START',
      amount: 24,
      ref: `non-canonical-ref:${testStoryId}:1`,
      status: 'ACTIVE',
      expires_at: expiresAt,
    })
    expect(resErr).toBeNull()

    const { resolveCommercialAuthorization } = await import('@/lib/commercial/resolver.server')
    const decision = await resolveCommercialAuthorization({
      userId,
      storyId: testStoryId,
      chapterNumber: 1,
    })

    expect(decision.status).toBe('NEEDS_RESERVATION')
    expect(decision.reservationRef).toBeUndefined()
  })
})
