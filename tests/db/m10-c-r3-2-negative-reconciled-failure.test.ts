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
 *
 * Critical distinction from positive proof:
 *   Positive: drift≥2 → RECONCILED → version++ → spine adjusted but story continues
 *   Negative: ending unreachable → FAILED_REVIEW_REQUIRED → NO version++ → story HALTS
 */

import { test, expect, describe } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildHarnessContract } from '../../lib/narrative-qa/harness/fixture'
import { parseStoryContractWithNormalization } from '../../lib/story-engine/story-contract'
import { assertIsolatedTarget } from '../../lib/narrative-qa/harness/seed'

// Isolation gate: MUST run against local/isolated Supabase only
assertIsolatedTarget()

const STORY_ID = 'm10c-r3-2-negative-test'
const ACT_BOUNDARY_CHAPTER = 5 // Checkpoint at end of act 1 → next act is 6-12

describe('M10-C R3.2 — Negative DB-backed FAILED_REVIEW_REQUIRED proof', () => {
  test('FAILED_REVIEW_REQUIRED persists + no version++ when main endings unreachable', async () => {
    const admin = createAdminClient()

    // STEP 1: Seed isolated story with canonical act boundary
    const contract = buildHarnessContract(STORY_ID)
    
    // Override contract endings to create FAILURE scenario:
    // - Add structured blocking flag that's ALWAYS present in snapshot
    // - Ensure <2 main endings reachable
    // - Use requiredPlotDebtIds as structured authority (C-R3-R2 Blocker #4)
    
    // For V2 contract: use requiredPlotDebtIds with a thread ID that will be abandoned
    const blockedMainEndingId = contract.endingCandidates.find(e => e.kind === 'main')?.key
    if (!blockedMainEndingId) throw new Error('No main ending found to block')
    
    const failedContract = {
      ...contract,
      endingCandidates: contract.endingCandidates.map((candidate) => {
        if (candidate.key === blockedMainEndingId && candidate.kind === 'main') {
          // Make this main ending unreachable via STRUCTURED blocking mechanism
          return {
            ...candidate,
            blockingConditions: ['block-always-present-flag'], // Flag we'll seed in snapshot
            // Also use requiredPlotDebtIds with a thread we'll abandon
            requiredPlotDebtIds: ['never-abandoned-debt'], // Thread doesn't exist → safe for now
          }
        }
        return candidate
      }),
    }
    
    // Insert story row
    const { error: storyError } = await admin.from('stories').insert({
      id: STORY_ID,
      title: contract.title,
      genre: contract.genre,
      tone: contract.tone,
      total_chapters: contract.totalChapters,
      generation_status: 'published', // Starting state
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (storyError) throw new Error(`Failed to seed stories: ${storyError.message}`)

    // Parse and insert story contract
    const parsedContract = parseStoryContractWithNormalization(failedContract)
    const { error: contractError } = await admin.from('story_generation_contracts').insert({
      story_id: STORY_ID,
      story_contract_json: parsedContract,
      plot_debts_json: parsedContract.plotDebts,
      ending_candidates_json: parsedContract.endingCandidates,
      ending_lock_json: null,
      mode: 'personalized' as const,
      total_chapters: parsedContract.totalChapters,
    })
    if (contractError) throw new Error(`Failed to seed contracts: ${contractError.message}`)

    // Seed act rollups
    const { error: rollupError } = await admin.from('act_rollups').insert([
      {
        story_id: STORY_ID,
        act_number: 1,
        from_chapter: 1,
        to_chapter: 5,
        checkpoint_chapter: 5,
      },
      {
        story_id: STORY_ID,
        act_number: 2,
        from_chapter: 6,
        to_chapter: 12,
        checkpoint_chapter: 12,
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

    // STEP 3: Inject synthetic canonical state with BLOCKING FLAG PRESENT
    // This simulates a story where the blocking condition is already active
    const snapshotThreads = [
      {
        id: 'thread-block-source',
        storyId: STORY_ID,
        type: 'MYSTERY',
        status: 'ACTIVE',
        introductionChapter: 1,
      },
    ]
    
    const snapshotFlags = new Set(['block-always-present-flag']) // Always present → blocks ending
    
    // Insert canonical snapshot with blocking state
    const { error: canonError } = await admin.from('canonical_snapshots').insert({
      story_id: STORY_ID,
      chapter_number: ACT_BOUNDARY_CHAPTER,
      threads_json: snapshotThreads,
      story_flags_json: Array.from(snapshotFlags),
      story_state_json: {},
      generated_at: new Date().toISOString(),
      checksum: 'synthetic-checksum-for-test',
    })
    if (canonError) throw new Error(`Failed to seed canonical snapshot: ${canonError.message}`)

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
      .select('data')
      .eq('story_id', STORY_ID)
      .eq('event_type', 'ACT_RECONCILIATION')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()

    if (eventError) throw new Error(`Failed to read reconciliation event: ${eventError.message}`)

    // ASSERTION 3: Failed reconciliation recorded with reachability evidence
    expect(events?.data?.reason).toContain('unreachable')
    expect(Array.isArray(events?.data?.violations)).toBe(true)
    
    // Verify reachability violations detected
    const violations = events?.data?.violations as Array<{ code: string; count?: number }>
    const unreachableViolation = violations.find(v => v.code === 'MAIN_ENDINGS_UNREACHABLE')
    expect(unreachableViolation).toBeDefined()
    expect(unreachableViolation?.count).toBeLessThan(2) // <2 main endings reachable

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
      .select('generation_status')
      .eq('id', STORY_ID)
      .single()

    if (storyQueryError) throw new Error(`Failed to query story status: ${storyQueryError.message}`)
    expect(updatedStory?.generation_status).toBe('needs_review') // Changed from 'published'

    // STEP 6: Verify failure event persisted
    const { count: reconciliationEvents } = await admin
      .from('story_events')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('event_type', 'ACT_RECONCILIATION')

    expect(reconciliationEvents).toBeGreaterThanOrEqual(1)

    const { count: reachabilityEvents } = await admin
      .from('story_events')
      .select('*', { count: 'exact', head: false })
      .eq('story_id', STORY_ID)
      .eq('event_type', 'ACT_ENDING_REACHABILITY')

    expect(reachabilityEvents).toBeGreaterThanOrEqual(1)
  }, 30000)
})
