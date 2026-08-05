// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'

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

// Real application integration test against local Supabase DB
describe.skipIf(!process.env.LAKOKU_LOCAL_DB_TEST)('Real Application -> Local DB Integration Test Harness', () => {
  let admin: ReturnType<typeof createAdminClient>
  const storyId = 'story-real-db-ch3'

  beforeAll(async () => {
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

  it('admin.rpc executes 9-arg apply_personalized_choice_v2 against real local Postgres DB', async () => {
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

    // Call 9-arg apply_personalized_choice_v2 RPC directly on local DB
    const { data: choiceData, error: choiceErr } = await admin.rpc('apply_personalized_choice_v2', {
      p_user_id: userId,
      p_story_id: storyId,
      p_chapter_number: 3,
      p_choice_id: 'choice-real-a',
      p_idempotency_key: `real-key:${storyId}:3:choice-real-a`,
      p_expected_state: {
        user_id: userId,
        story_id: storyId,
        status: 'BERJALAN',
        current_chapter: 3,
        jejak: [],
        ending_name: null,
        route_state: { truth: 1, risk: 0, secrecy: 0, empathy: 0, trust: {}, evidence: [], flags: {}, endingBias: {} },
        choice_history: [],
        locked_ending_key: null,
        updated_at: initialUpdatedAt,
      },
      p_next_route_state: { truth: 2, risk: 0, secrecy: 0, empathy: 0, trust: {}, evidence: [], flags: { secret_revealed: true }, endingBias: {} },
      p_history_entry: {
        chapterNumber: 3,
        choiceId: 'choice-real-a',
        label: 'Buka Rahasia',
        consequence: ['Rahasia terungkap.'],
        effectSummary: { flagsSet: ['secret_revealed'], truth: 1 },
        createdAt: '2026-08-05T00:00:00.000Z',
      },
      p_jejak_entry: {
        chapter: 3,
        decision: 'Buka Rahasia',
        consequence: 'Rahasia terungkap.',
      },
    })

    expect(choiceErr).toBeNull()
    expect(choiceData?.outcome?.nextChapterNumber).toBe(4)

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
  })

  it('Personalized Story #2 creation state machine: initial shell origin NULL -> reserve_story_start_v1 transitions origin to PENDING_PAID_START', async () => {
    // 1. Mark user as having claimed starter
    const { error: upsertErr } = await admin.from('account_commercial_states').upsert({
      user_id: userId,
      starter_story_id: 'story-starter-1',
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

    const story2Id = 'ai:test-story-shell-null'

    // 3. Create initial shell with commercial_origin NULL (as created by application TS)
    await admin.from('stories').insert({
      id: story2Id,
      title: 'Story 2 Shell',
      cover: '/cover.webp',
      tagline: 'Tagline',
      role: 'Role',
      tropes: [],
      total_chapters: 50,
      status: 'BARU',
      current_chapter: 0,
      jejak: [],
      owner_user_id: userId,
      visibility: 'private',
      story_mode: 'personalized_ai',
      commercial_origin: null,
      generation_status: 'creating_contract',
    })

    // Verify initial shell origin is NULL/falsy
    const { data: initialShell } = await admin
      .from('stories')
      .select('commercial_origin')
      .eq('id', story2Id)
      .single()

    expect(initialShell?.commercial_origin ?? null).toBeNull()

    // 4. Call reserve_story_start_v1 RPC
    const { data: resData, error: resError } = await admin.rpc('reserve_story_start_v1', {
      p_user_id: userId,
      p_story_id: story2Id,
    })

    expect(resError).toBeNull()
    expect(resData?.ok).toBe(true)

    // 5. Verify DB story row was transitioned to PENDING_PAID_START by reserve_story_start_v1
    const { data: transitionedStory } = await admin
      .from('stories')
      .select('commercial_origin')
      .eq('id', story2Id)
      .single()

    expect(transitionedStory?.commercial_origin).toBe('PENDING_PAID_START')
  })
})
