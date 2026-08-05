// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

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
import { createPersonalizedStory, PersonalizedStoryError } from '@/lib/api/personalized-stories.server'
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

// Real application integration test against local Supabase DB
describe.skipIf(!process.env.LAKOKU_LOCAL_DB_TEST)('Real Application -> Local DB Integration Test Harness', () => {
  let admin: ReturnType<typeof createAdminClient>
  let selectProviderSpy: ReturnType<typeof vi.spyOn>
  let createResilientStoryContractSpy: ReturnType<typeof vi.spyOn>
  let generateNextPersonalizedChapterSpy: ReturnType<typeof vi.spyOn>
  const storyId = 'story-real-db-ch3'

  beforeAll(async () => {
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
    await admin.from('reader_states').delete().eq('user_id', userId)
    await admin.from('choice_outcomes').delete().eq('story_id', storyId)
    await admin.from('chapters').delete().eq('story_id', storyId)
    await admin.from('stories').delete().eq('owner_user_id', userId)
    await admin.from('story_creation_requests').delete().eq('owner_user_id', userId)
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
    // Cleanup after test
    await admin.from('commercial_generation_intents').delete().eq('user_id', userId)
    await admin.from('reader_states').delete().eq('user_id', userId)
    await admin.from('choice_outcomes').delete().eq('story_id', storyId)
    await admin.from('chapters').delete().eq('story_id', storyId)
    await admin.from('stories').delete().eq('owner_user_id', userId)
    await admin.from('story_creation_requests').delete().eq('owner_user_id', userId)
    await admin.from('account_commercial_states').delete().eq('user_id', userId)
  })

  beforeEach(() => {
    selectProviderSpy?.mockClear()
    createResilientStoryContractSpy?.mockClear()
    generateNextPersonalizedChapterSpy?.mockClear()
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

  it('createPersonalizedStory Story #2 application orchestration: shell created with NULL origin -> reserve_story_start_v1 updates origin to PENDING_PAID_START -> stops with COMMERCIAL_RUNTIME_NOT_READY (0 provider calls)', async () => {
    // 1. Mark user as having claimed a DIFFERENT starter story
    const { error: upsertErr } = await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: 'story-starter-prev-1',
      starter_claimed_at: new Date().toISOString(),
      welcome_credit_granted_at: new Date().toISOString(),
    })
    expect(upsertErr).toBeNull()

    // 2. Grant credits
    const { data: gData, error: gErr } = await admin.rpc('grant_credits_v1', {
      p_user_id: userId,
      p_ref: `ref-test-grant-story2-${Date.now()}`,
      p_credits: 100,
      p_reason: 'TEST_GRANT',
    })
    expect(gErr).toBeNull()
    expect(gData).toBe(true)

    const idempotencyKey = `p2-app-key-${Date.now()}`

    // 3. Invoke application creation function
    let errToVerify: unknown
    try {
      await createPersonalizedStory({
        userId,
        idempotencyKey,
      })
    } catch (err) {
      errToVerify = err
    }

    expect(selectProviderSpy).toHaveBeenCalledTimes(0)
    expect(createResilientStoryContractSpy).toHaveBeenCalledTimes(0)
    expect(generateNextPersonalizedChapterSpy).toHaveBeenCalledTimes(0)

    expect(errToVerify).toBeInstanceOf(PersonalizedStoryError)
    const pErr = errToVerify as PersonalizedStoryError
    expect(pErr.code).toBe('COMMERCIAL_RUNTIME_NOT_READY')
    const createdStoryId = pErr.storyId
    expect(createdStoryId).toBeDefined()

    // 4. Verify DB creation request remains RESERVED
    const { data: reqRow } = await admin
      .from('story_creation_requests')
      .select('status')
      .eq('owner_user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .single()

    expect(reqRow?.status).toBe('RESERVED')

    // 5. Verify DB story row was transitioned to PENDING_PAID_START by reserve_story_start_v1
    const { data: transitionedStory } = await admin
      .from('stories')
      .select('commercial_origin')
      .eq('id', createdStoryId)
      .single()

    expect(transitionedStory?.commercial_origin).toBe('PENDING_PAID_START')

    // 6. Replay with same idempotency key returns same story ID and stops cleanly (0 provider calls)
    let replayErr: unknown
    try {
      await createPersonalizedStory({
        userId,
        idempotencyKey,
      })
    } catch (err) {
      replayErr = err
    }
    expect(replayErr).toBeInstanceOf(PersonalizedStoryError)
    expect((replayErr as PersonalizedStoryError).storyId).toBe(createdStoryId)

    expect(selectProviderSpy).toHaveBeenCalledTimes(0)
    expect(createResilientStoryContractSpy).toHaveBeenCalledTimes(0)
    expect(generateNextPersonalizedChapterSpy).toHaveBeenCalledTimes(0)
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
