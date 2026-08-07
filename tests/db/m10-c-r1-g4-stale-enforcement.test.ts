// @vitest-environment node
/**
 * C-R1 G4-STALE DB regression (reviewer verdict 2026-08-08, option A):
 * runtime stale marking + enforcement chain against the ISOLATED local DB.
 *
 * Proves the NCS §4.2 chain end-to-end on harness-owned rows:
 *   1. markThreadStaleness (the C-R1 post-publication hook function) marks
 *      active threads with gap >= STALE_AFTER_CHAPTERS and leaves threads
 *      inside the window untouched — against the real story_threads table.
 *   2. loadCanonSnapshot (production loader) propagates the persisted stale
 *      flag + stale_since_chapter into ThreadContext input.
 *   3. validateThreadLifecycle (production Layer A) emits
 *      THREAD_STALE_UNADDRESSED MAJOR once the STALE_CALLBACK_WINDOW closed
 *      without a callback, and stays silent when the chapter advances the
 *      thread or the window is still open. MAJOR findings fail generation
 *      closed: generate.ts runs ≤2 prose-only repairs then returns
 *      FAILED_REVIEW_REQUIRED — a structural stale finding cannot be repaired
 *      by prose, so enforcement bites (this hop is existing production code
 *      the test cites rather than re-runs).
 *
 * Jalankan: LAKOKU_LOCAL_DB_TEST=1 pnpm exec vitest run tests/db/m10-c-r1-g4-stale-enforcement.test.ts
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'

vi.mock('server-only', () => ({}))

function getLocalStatus() {
  try {
    const raw = process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm exec supabase status -o json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      : execFileSync('pnpm', ['exec', 'supabase', 'status', '-o json'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
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
import {
  STALE_AFTER_CHAPTERS,
  STALE_CALLBACK_WINDOW,
  debtBackedThreadId,
  validateThreadLifecycle,
} from '@lakoku/narrative-core'
import { loadCanonSnapshot } from '@lakoku/narrative-core/server'
import { markThreadStaleness } from '@/lib/runtime/post-publication-lifecycle.server'

const STORY_ID = 'c-r1-g4-stale-regression'
const USER_ID = '99999999-9999-4999-9999-99999999c001'
const STALE_THREAD = debtBackedThreadId(STORY_ID, 'main_mystery')
const FRESH_THREAD = debtBackedThreadId(STORY_ID, 'debt:a')

async function cleanup(): Promise<void> {
  const admin = createAdminClient()
  await admin.from('story_events').delete().eq('story_id', STORY_ID)
  await admin.from('story_threads').delete().eq('story_id', STORY_ID)
  await admin.from('stories').delete().eq('id', STORY_ID)
}

describe.skipIf(!process.env.LAKOKU_LOCAL_DB_TEST)('C-R1 G4-STALE enforcement (isolated local DB)', () => {
  beforeAll(async () => {
    await cleanup()
    const admin = createAdminClient()
    // stories.owner_user_id references auth.users — seed the harness user the
    // same way the A1d smoke suites do (isolated local DB only).
    await admin.auth.admin.createUser({
      id: USER_ID,
      email: 'c-r1-g4-stale@example.com',
      password: 'password123',
      email_confirm: true,
    }).catch(() => null)
    const { error: storyError } = await admin.from('stories').insert({
      id: STORY_ID,
      title: 'C-R1 G4 stale regression',
      cover: '/cover.webp',
      tagline: 'isolated regression',
      role: 'Protector',
      tropes: ['misteri'],
      total_chapters: 50,
      synopsis: 'Regression story — harness-owned, isolated.',
      status: 'BERJALAN',
      current_chapter: 0,
      owner_user_id: USER_ID,
      jejak: [],
      visibility: 'private',
      story_mode: 'personalized_ai',
      generation_status: 'ready',
      story_contract_version: 1,
      living_canon_version: 1,
      canon_state_revision: 0,
    })
    if (storyError) throw new Error(`seed stories failed: ${storyError.message}`)

    const { error: threadError } = await admin.from('story_threads').insert([
      {
        id: STALE_THREAD,
        story_id: STORY_ID,
        title: 'Misteri brankas',
        status: 'OPEN',
        opened_chapter: 1,
        last_touched_chapter: 1,
        payoff_window: 48,
        is_main_mystery: true,
        stale: false,
        stale_since_chapter: null,
      },
      {
        id: FRESH_THREAD,
        story_id: STORY_ID,
        title: 'Surat di brankas',
        status: 'OPEN',
        opened_chapter: 1,
        // Touched recently enough to stay out of the stale window at Bab 7.
        last_touched_chapter: 3,
        payoff_window: 8,
        is_main_mystery: false,
        stale: false,
        stale_since_chapter: null,
      },
    ])
    if (threadError) throw new Error(`seed story_threads failed: ${threadError.message}`)
  })

  afterAll(async () => {
    if (process.env.LAKOKU_LOCAL_DB_TEST) await cleanup()
  })

  it('marks exactly the threads whose gap reached STALE_AFTER_CHAPTERS', async () => {
    const admin = createAdminClient()
    // Bab 7: main_mystery gap = 7-1 = 6 (>= threshold) → marked.
    //        debt:a     gap = 7-3 = 4 (< threshold)  → untouched.
    const { marked } = await markThreadStaleness(admin, STORY_ID, 7)
    expect(marked).toBe(1)

    const { data, error } = await admin
      .from('story_threads')
      .select('id,stale,stale_since_chapter,last_touched_chapter')
      .eq('story_id', STORY_ID)
      .order('id', { ascending: true })
    expect(error).toBeNull()
    const byId = new Map((data ?? []).map((row) => [String(row.id), row]))
    expect(byId.get(STALE_THREAD)?.stale).toBe(true)
    expect(Number(byId.get(STALE_THREAD)?.stale_since_chapter)).toBe(7)
    expect(byId.get(FRESH_THREAD)?.stale).toBe(false)
    expect(byId.get(FRESH_THREAD)?.stale_since_chapter).toBeNull()
  })

  it('marking is idempotent (already-stale rows are not re-marked)', async () => {
    const admin = createAdminClient()
    const { marked } = await markThreadStaleness(admin, STORY_ID, 8)
    expect(marked).toBe(0)
    const { data } = await admin
      .from('story_threads')
      .select('stale_since_chapter')
      .eq('story_id', STORY_ID)
      .eq('id', STALE_THREAD)
      .single()
    // stale_since_chapter stays at the first marking (Bab 7), not Bab 8.
    expect(Number(data?.stale_since_chapter)).toBe(7)
  })

  it('the production loader propagates the stale flag into the snapshot', async () => {
    const snapshot = await loadCanonSnapshot(STORY_ID, 8)
    const thread = snapshot.threads.find((t) => t.id === STALE_THREAD)
    expect(thread).toBeDefined()
    expect(thread?.stale).toBe(true)
    expect(thread?.staleSinceChapter).toBe(7)
  })

  it('Layer A fails closed once the callback window closed without a callback', async () => {
    const snapshot = await loadCanonSnapshot(STORY_ID, 8)
    const deadlineChapter = 7 + STALE_CALLBACK_WINDOW // window closed at Bab 10
    expect(STALE_AFTER_CHAPTERS).toBeGreaterThanOrEqual(STALE_CALLBACK_WINDOW)

    // No callback by the deadline → THREAD_STALE_UNADDRESSED MAJOR.
    const unaddressed = validateThreadLifecycle({
      threads: snapshot.threads,
      chapter: deadlineChapter,
      advancedThreadIds: [],
    })
    const staleFinding = unaddressed.find((f) => f.code === 'THREAD_STALE_UNADDRESSED')
    expect(staleFinding).toBeDefined()
    expect(staleFinding?.severity).toBe('MAJOR')

    // A callback in time (chapter advances the thread) clears the obligation.
    const addressed = validateThreadLifecycle({
      threads: snapshot.threads,
      chapter: deadlineChapter,
      advancedThreadIds: [STALE_THREAD],
    })
    expect(addressed.find((f) => f.code === 'THREAD_STALE_UNADDRESSED')).toBeUndefined()

    // Inside the window there is no finding yet — the callback is owed, not
    // overdue.
    const insideWindow = validateThreadLifecycle({
      threads: snapshot.threads,
      chapter: 7 + STALE_CALLBACK_WINDOW - 1,
      advancedThreadIds: [],
    })
    expect(insideWindow.find((f) => f.code === 'THREAD_STALE_UNADDRESSED')).toBeUndefined()
  })
})
