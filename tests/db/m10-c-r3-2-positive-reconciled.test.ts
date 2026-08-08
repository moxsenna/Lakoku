/**
 * M10-C R3.2 — Positive DB-backed proof of RECONCILED reconciliation.
 *
 * This is NOT a unit test; it's an isolated DB-backed integration that:
 *   1. Seeds a legal story at real act boundary (chapter 12)
 *   2. Injects canonical drift through fixture/bootstrap setup
 *   3. Executes REAL post-publication lifecycle (no mocks)
 *   4. Proves chapter_blueprints version++ and reconciled_from_version persistence
 *
 * Per reviewer Entry 10:
 *   > real post-publication path → runActBoundaryReconciliation() → RECONCILED
 *   → DB chapter_blueprints version++ → reconciled_from_version persisted → spine unchanged
 */
// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest'

// Mock server-only for vitest environment (required because admin.ts uses 'server-only' directive)
vi.mock('server-only', () => ({}))

// ---------------------------------------------------------------------------
// Local Supabase bootstrap
// ---------------------------------------------------------------------------

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
import { buildHarnessContract } from '../../lib/narrative-qa/harness/fixture'
import { parseStoryContractWithNormalization } from '../../lib/story-engine/story-contract'
import { assertIsolatedTarget, HARNESS_USER_ID } from '../../lib/narrative-qa/harness/seed'

assertIsolatedTarget()

const STORY_ID = 'm10c-r3-2-positive-test'
const ACT_BOUNDARY_CHAPTER = 5

describe('M10-C R3.2 — Positive DB-backed RECONCILED proof', () => {
  test('version++ chain + reconciled_from_version persistence at act boundary', async () => {
    const admin = createAdminClient()

    // Ensure harness user exists in auth.users (stories.owner_user_id references it)
    await admin.auth.admin.createUser({
      id: HARNESS_USER_ID,
      email: 'm10c-harness@example.invalid',
      password: 'harness123',
      email_confirm: true,
    }).catch(() => null) // Silently ignore if already exists
    
    // Cleanup any previous test data for this story ID
    await admin.from('act_rollups').delete().eq('story_id', STORY_ID)
    await admin.from('chapter_blueprints').delete().eq('story_id', STORY_ID)
    await admin.from('story_generation_contracts').delete().eq('story_id', STORY_ID)
    await admin.from('stories').delete().eq('id', STORY_ID)
    
    // STEP 1: Seed canonical story with EXACT shape from harness (not invented fields)
    // This matches seedHarnessStory() - NO genre/tone fields (these columns don't exist in canonical stories)
    const { error: storyError } = await admin.from('stories').insert({
      id: STORY_ID,
      title: 'Brankas Rahasia 50 Bab',
      cover: '/cover.webp',
      tagline: 'Misteri brankas basement',
      role: 'Protector',
      tropes: ['misteri'],
      total_chapters: 50,
      synopsis: 'Synopsis deterministik.',
      status: 'BERJALAN',
      current_chapter: 0,
      owner_user_id: HARNESS_USER_ID,
      jejak: [],
      visibility: 'private',
      story_mode: 'personalized_ai',
      generation_status: 'ready', // Starting state per canonical harness
      story_contract_version: 1,
      living_canon_version: 1,
      canon_state_revision: 0,
      commercial_origin: 'LEGACY_GRANDFATHERED',
    })
    if (storyError) throw new Error(`Failed to seed stories: ${storyError.message}`)

    // Parse contract with drift injection
    const contract = buildHarnessContract(STORY_ID)
    const overriddenContract = {
      ...contract,
      chapterTargets: contract.chapterTargets.map((target) => {
        if (target.chapterNumber === 6) {
          return {
            ...target,
            expectedThreadMovement: ['missing-thread-A', 'missing-thread-B'],
          }
        }
        return target
      }),
    }
    const parsedContract = parseStoryContractWithNormalization(overriddenContract)
    
    // Insert story contract with EXACT shape from harness canonical (not invented fields)
    const { error: contractError } = await admin.from('story_generation_contracts').insert({
      story_id: STORY_ID,
      mode: 'personalized_ai',
      total_chapters: parsedContract.totalChapters,
      contract_source: 'llm_repaired',
      onboarding_json: { hero: 'char:hero' },
      story_contract_json: parsedContract,
      route_schema_json: {},
      plot_debts_json: parsedContract.plotDebts,
      ending_candidates_json: parsedContract.endingCandidates,
      ending_lock_json: {},
      quality_profile: 'lakoku_mobile_drama_v1',
      story_contract_version: 1,
    })
    if (contractError) throw new Error(`Failed to seed contracts: ${contractError.message}`)

    // Seed act rollups (both act 1 and act 2 for proper boundary detection)
    // Canonical schema uses covers_from_chapter/covers_to_chapter/summary, not from_chapter/to_chapter/checkpoint_chapter
    const { error: rollupError } = await admin.from('act_rollups').insert([
      {
        story_id: STORY_ID,
        act_number: 1,
        covers_from_chapter: 1,
        covers_to_chapter: 5,
        summary: 'Act 1 summary',
      },
      {
        story_id: STORY_ID,
        act_number: 2,
        covers_from_chapter: 6,
        covers_to_chapter: 12,
        summary: 'Act 2 summary',
      },
    ])
    if (rollupError) throw new Error(`Failed to seed act_rollups: ${rollupError.message}`)

    // STEP 2: Create draft blueprints for NEXT ACT (chapters 6-12) at version 1
    // C-R3-R2 Blocker #5: Production derives reconciliation from NEXT ACT chapters
    // We need to seed chapters 6-12 with required thread movement that creates drift ≥2
    // via expectedThreadMovement not materialized in state.threadStatuses.
    const blueprintsToInsert = Array.from({ length: 7 }, (_, i) => ({
      chapterNumber: i + 6, // Chapters 6-12
      phase: 'BABAK_2',
      chapterGoal: `Draft goal for chapter ${i + 6}`,
      mandatoryBeats: ['beat-utama'],
      forbiddenReveals: [],
      introducedCharacters: [`char:hero-${i + 6}`],
      version: 1,
    }))

    const { error: blueprintError } = await admin
      .from('chapter_blueprints')
      .insert(
        blueprintsToInsert.map((bp) => ({
          story_id: STORY_ID,
          chapter_number: bp.chapterNumber,
          version: bp.version,
          phase: bp.phase,
          chapter_goal: bp.chapterGoal,
          mandatory_beats: bp.mandatoryBeats,
          forbidden_reveals: bp.forbiddenReveals,
          introduces_characters: bp.introducedCharacters,
          reconciled_from_version: null,
        }))
      )
    if (blueprintError) throw new Error(`Failed to seed blueprints: ${blueprintError.message}`)

    // STEP 3: Execute REAL post-publication reconciliation via production hook
    const { runActBoundaryReconciliation } = await import('../../lib/runtime/post-publication-lifecycle.server')
    
    const reconcileResult = await runActBoundaryReconciliation(admin, {
      storyId: STORY_ID,
      chapterNumber: ACT_BOUNDARY_CHAPTER,
      contract: parsedContract,
    })

    // ASSERTION 1: Reconciliation was triggered
    expect(reconcileResult.triggered).toBe(true)
    expect(reconcileResult.status).toBe('RECONCILED')

    // ASSERTION 2: Query DB directly for detailed reconciliation info (status + drift evidence)
    const { data: events, error: eventError } = await admin
      .from('story_events')
      .select('payload')
      .eq('story_id', STORY_ID)
      .eq('type', 'ACT_RECONCILIATION')
      .order('seq', { ascending: false })
      .limit(1)
      .single()

    if (eventError) throw new Error(`Failed to read reconciliation event: ${eventError.message}`)

    // ASSERTION 3: Drift and reconciled chapters recorded in event payload
    expect(events?.payload?.driftByChapter).toBeDefined()
    expect(Array.isArray(events?.payload?.reconciledChapters)).toBe(true)
    expect((events?.payload?.reconciledChapters as number[]).length).toBeGreaterThan(0)

    // STEP 4: Query DB to verify version++ and reconciled_from_version persistence
    // C-R3-R2 Blocker #5: Reconciliation triggers for NEXT ACT chapters (6-12)
    // We need to check chapter 6 has v2 (not chapter 5 which is checkpoint)
    const { data: oldBlueprint, error: oldError } = await admin
      .from('chapter_blueprints')
      .select('*')
      .eq('story_id', STORY_ID)
      .eq('chapter_number', 6) // Next act first chapter
      .eq('version', 1)
      .single()

    if (oldError) throw new Error(`Failed to read old blueprint: ${oldError.message}`)
    expect(oldBlueprint).not.toBeNull()

    const { data: newBlueprint, error: newError } = await admin
      .from('chapter_blueprints')
      .select('*')
      .eq('story_id', STORY_ID)
      .eq('chapter_number', 6) // Next act first chapter should have v2
      .eq('version', 2) // Must be N+1
      .single()

    if (newError) throw new Error(`Failed to read new blueprint: ${newError.message}`)
    expect(newBlueprint).not.toBeNull()

    // ASSERTION 3: New blueprint has correct version++
    expect(newBlueprint.version).toBe(2)
    expect(newBlueprint.reconciled_from_version).toBe(1)

    // ASSERTION 4: Reconciliation reason recorded
    expect(newBlueprint.reconciliation_reason).toBeDefined()
    expect(typeof newBlueprint.reconciliation_reason).toBe('string')
    expect(newBlueprint.reconciliation_reason.length).toBeGreaterThan(0)

    // ASSERTION 5: Spine fields unchanged (mandatory_beats preserved)
    expect(newBlueprint.mandatory_beats).toEqual(oldBlueprint.mandatory_beats)
    expect(newBlueprint.chapter_goal !== oldBlueprint.chapter_goal).toBe(true) // Goal should change due to drift

    // STEP 5: Verify events persisted
    const { count: reconciliationEvents } = await admin
      .from('story_events')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('type', 'ACT_RECONCILIATION')

    expect(reconciliationEvents).toBeGreaterThanOrEqual(1)

    const { count: reachabilityEvents } = await admin
      .from('story_events')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('type', 'ACT_ENDING_REACHABILITY')

    expect(reachabilityEvents).toBeGreaterThanOrEqual(1)

    // STEP 6: Verify old blueprint row still exists (never overwritten)
    const { count: remainingRows } = await admin
      .from('chapter_blueprints')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', 6) // Next act first chapter

    expect(remainingRows).toBe(2) // Version 1 + Version 2
  })
})
