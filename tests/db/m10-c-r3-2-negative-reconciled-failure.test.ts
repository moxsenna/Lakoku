/**
 * M10-C R3.2 — Negative DB-backed proof of FAILED_REVIEW_REQUIRED reconciliation.
 *
 * This is an isolated DB-backed integration that:
 *   1. Seeds a legal story at real act boundary (chapter 5 → next act 6-12)
 *   2. Creates REAL production reconciliation failure via:
 *      - Structured blocking flags on main endings (C-R3-R2 Blocker #4: requiredPlotDebtIds authority)
 *      - Insufficient reachable endings (<2 main or <1 secret)
 *   3. Executes REAL post-publication lifecycle (no mocks)
 *   4. Proves chapter_blueprints NOT version++ when reconciliation fails
 *   5. Proves story_events persisted FAILED_REVIEW_REQUIRED
 *   6. Proves generation_status='needs_review' persists
 *   7. Proves generateNextPersonalizedChapter() returns FAILED_REVIEW_REQUIRED for chapter 6
 *   8. Proves zero new leases/checkpoints/publications/canon revisions during sync failure
 */
// @vitest-environment node

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest'

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
import { generateNextPersonalizedChapter } from '@/lib/runtime/personalized-generation'

// Isolation gate: MUST run against local/isolated Supabase only
assertIsolatedTarget()

const STORY_ID = 'm10c-r3-2-negative-test'
const ACT_BOUNDARY_CHAPTER = 5 // Checkpoint at end of act 1 → next act is 6-12
const NEXT_CHAPTER = 6 // Attempt to generate next chapter after failed boundary

describe('M10-C R3.2 — Negative DB-backed FAILED_REVIEW_REQUIRED proof', () => {
  test('FAILED_REVIEW_REQUIRED persists + no version++ when main endings unreachable', async () => {
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
    await admin.from('reader_states').delete().eq('story_id', STORY_ID).eq('user_id', HARNESS_USER_ID)
    
    // STEP 1: Seed isolated story with canonical act boundary
    const contract = buildHarnessContract(STORY_ID)
    
    // Override contract endings to create FAILURE scenario:
    // - Add structured blocking flag that's ALWAYS present in snapshot via canonical facts
    // - Use requiredPlotDebtIds with legal debt ID from contract (must reference existing plotDebt IDs)
    
    // For V2 contract: use requiredPlotDebtIds with legal debt ID from contract
    const blockedMainEndingId = contract.endingCandidates.find(e => e.kind === 'main')?.key
    if (!blockedMainEndingId) throw new Error('No main ending found to block')
    
    // Get first plot debt ID from contract for legal requiredPlotDebtIds reference
    const firstPlotDebtId = contract.plotDebts[0]?.id
    if (!firstPlotDebtId) throw new Error('No plot debts available for requiredPlotDebtIds')
    
    const failedContract = {
      ...contract,
      endingCandidates: contract.endingCandidates.map((candidate) => {
        if (candidate.key === blockedMainEndingId && candidate.kind === 'main') {
          // Make this main ending unreachable via STRUCTURED blocking mechanism
          return {
            ...candidate,
            blockingConditions: ['block-always-present-flag'], // Flag we'll seed as canonical fact
            // Use LEGAL debt ID from contract (not fictional 'never-abandoned-debt')
            // This debt will NOT be abandoned, so closure proof remains satisfiable=true
            requiredPlotDebtIds: [firstPlotDebtId], 
          }
        }
        return candidate
      }),
    }
    
    // Insert story row with EXACT shape from harness canonical (not invented fields)
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
    
    // Create reader state for harness user (required by applyPersonalizedChoice)
    await admin.from('reader_states').insert({
      user_id: HARNESS_USER_ID,
      story_id: STORY_ID,
      status: 'BERJALAN',
      current_chapter: ACT_BOUNDARY_CHAPTER,
      jejak: [],
      ending_name: null,
      route_state: {},
      choice_history: [],
      locked_ending_key: null,
      updated_at: new Date().toISOString(),
    })

    // Insert story contract with EXACT shape from harness canonical (not invented fields)
    const parsedContract = parseStoryContractWithNormalization(failedContract)
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

    // STEP 3: Inject BLOCKING FLAG as canonical fact (production way, NOT pseudo-snapshot table)
    // Production loadCanonSnapshot() derives flags from facts_ledger and secrets_reveals tables
    // Writing directly to canonical_snapshots.story_flags_json won't be read by production loader
    const { error: factError } = await admin.from('facts_ledger').insert({
      id: 'block-always-present-flag',
      story_id: STORY_ID,
      statement: 'Critical blocking condition always present for testing',
      subject_character_id: null,
      established_chapter: 1,
      salience: 0.5,
      load_bearing: true,
      paid_off: false,
    })
    
    if (factError) throw new Error(`Failed to seed blocking fact: ${factError.message}`)

    // STEP 4: Execute REAL post-publication reconciliation via production hook
    const { runActBoundaryReconciliation } = await import('../../lib/runtime/post-publication-lifecycle.server')
    
    const reconcileResult = await runActBoundaryReconciliation(admin, {
      storyId: STORY_ID,
      chapterNumber: ACT_BOUNDARY_CHAPTER,
      contract: parsedContract,
    })

    // ASSERTION 1: Reconciliation was triggered BUT FAILED
    expect(reconcileResult.triggered).toBe(true)
    expect(reconcileResult.status).toBe('FAILED_REVIEW_REQUIRED')

    // ASSERTION 2: Query DB for detailed reconciliation info
    const { data: events, error: eventError } = await admin
      .from('story_events')
      .select('payload')
      .eq('story_id', STORY_ID)
      .eq('type', 'ACT_RECONCILIATION')
      .order('seq', { ascending: false })
      .limit(1)
      .single()

    if (eventError) throw new Error(`Failed to read reconciliation event: ${eventError.message}`)

    // ASSERTION 3: Failed reconciliation recorded with status and finding codes
    // Production ACT_RECONCILIATION payload contains: actNumber, checkpointChapter, nextAct, status, driftByChapter, reconciledChapters, findingCodes
    expect(events?.payload?.status).toBe('FAILED_REVIEW_REQUIRED')
    expect(Array.isArray(events?.payload?.findingCodes)).toBe(true)
    
    // Verify reachability violations detected - finding codes use ENDING_UNREACHABLE not MAIN_ENDINGS_UNREACHABLE
    const findingCodes = events?.payload?.findingCodes as string[]
    const unreachableFinding = findingCodes.find(f => f === 'ENDING_UNREACHABLE')
    expect(unreachableFinding).toBeDefined()

    // ASSERTION 4: Blueprints NOT version++ on failure
    const { data: oldBlueprint, error: oldError } = await admin
      .from('chapter_blueprints')
      .select('*')
      .eq('story_id', STORY_ID)
      .eq('chapter_number', 6) // Next act first chapter
      .eq('version', 1)
      .single()

    if (oldError) throw new Error(`Failed to read old blueprint: ${oldError.message}`)
    expect(oldBlueprint).not.toBeNull()

    // Critical: NO version++ happened because reconciliation FAILED
    const { data: newBlueprint, error: newError } = await admin
      .from('chapter_blueprints')
      .select('*')
      .eq('story_id', STORY_ID)
      .eq('chapter_number', 6)
      .eq('version', 2)
      .maybeSingle()

    if (newError) throw new Error(`Failed to read new blueprint: ${newError.message}`)
    expect(newBlueprint).toBeNull() // No new version created on failure

    // ASSERTION 5: generation_status remains 'needs_review' after failure
    const { data: updatedStory, error: storyQueryError } = await admin
      .from('stories')
      .select('generation_status, canon_state_revision')
      .eq('id', STORY_ID)
      .single()

    if (storyQueryError) throw new Error(`Failed to query story status: ${storyQueryError.message}`)
    expect(updatedStory?.generation_status).toBe('needs_review') // Changed from 'published'

    // === STEP 7: SYNC PATH PROOF - Attempt chapter 6 generation through REAL production seam ===
    // Production: generateNextPersonalizedChapter() → should fail CLOSED due to needs_review
    // No triggerChoiceId required for pure generation admission test
    
    // Save baseline state before attempt
    const baselineRevision = updatedStory.canon_state_revision ?? 0

    const nextChapterAttempt = await generateNextPersonalizedChapter({
      storyId: STORY_ID,
      userId: HARNESS_USER_ID,
      chapterNumber: NEXT_CHAPTER,
      correlationId: randomUUID(),
      attemptId: 'sync-proof-attempt',
    })

    // ASSERTION 6: Real generation admission returns FAILED_REVIEW_REQUIRED
    // NOT a provider call, NOT a checkpoint, NOT a chapter publication
    expect(nextChapterAttempt.ok).toBe(false)
    
    // Narrow type to access reason property
    if (!nextChapterAttempt.ok && 'reason' in nextChapterAttempt) {
      expect(nextChapterAttempt.reason).toBe('FAILED_REVIEW_REQUIRED')
    } else {
      throw new Error(`Expected FAILED_REVIEW_REQUIRED but got ok=false without reason: ${JSON.stringify(nextChapterAttempt)}`)
    }
    
    // Assert no state mutations occurred during failed attempt
    const { count: activeLeases } = await admin
      .from('generation_leases')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('status', 'ACTIVE')
    
    expect(activeLeases ?? 0).toBe(0) // No new lease created on rejected request
    
    const { count: allCheckpoints } = await admin
      .from('chapter_generation_checkpoints')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
    
    expect(allCheckpoints ?? 0).toBe(0) // No checkpoint persisted on rejected attempt
    
    const { count: newChapters } = await admin
      .from('chapters')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('chapter_number', NEXT_CHAPTER)
    
    expect(newChapters ?? 0).toBe(0) // No chapter published on rejected attempt
    
    // Verify canon_state_revision unchanged
    const { data: postStory, error: postStoryError } = await admin
      .from('stories')
      .select('canon_state_revision')
      .eq('id', STORY_ID)
      .single()
    
    if (postStoryError) throw new Error(`Failed to query post-state revision: ${postStoryError.message}`)
    expect(postStory?.canon_state_revision).toBe(baselineRevision) // Immutable on failure

    // STEP 8: Verify failure event persisted
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
  }, 30000)
})
