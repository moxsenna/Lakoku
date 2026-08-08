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

import { test, expect, describe } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildHarnessContract } from '../../lib/narrative-qa/harness/fixture'
import { parseStoryContractWithNormalization } from '../../lib/story-engine/story-contract'
import { assertIsolatedTarget } from '../../lib/narrative-qa/harness/seed'

// Isolation gate: MUST run against local/isolated Supabase only
assertIsolatedTarget()

const STORY_ID = 'm10c-r3-2-positive-test'
// C-R3-R2 Blocker #5: Correct act boundary target.
// Production derivation uses nextAct.fromChapter === chapterNumber + 1
// For checkpoint at end of act 1 (chapter 5), NEXT ACT is 6-12.
// We seed blueprints for chapters 6-12 and execute reconciliation FROM chapter 5.
const ACT_BOUNDARY_CHAPTER = 5 // Checkpoint at end of act 1 → next act is 6-12

describe('M10-C R3.2 — Positive DB-backed RECONCILED proof', () => {
  test('version++ chain + reconciled_from_version persistence at act boundary', async () => {
    const admin = createAdminClient()

    // STEP 1: Seed isolated story with canonical act boundary
    const contract = buildHarnessContract(STORY_ID)
    
    // Override chapter 6's expectedThreadMovement to create drift ≥2
    // Both required threads absent from canonical snapshot state.threadStatuses
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
    
    // Insert story row
    const { error: storyError } = await admin.from('stories').insert({
      id: STORY_ID,
      title: contract.title,
      genre: contract.genre,
      tone: contract.tone,
      total_chapters: contract.totalChapters,
      generation_status: 'published', // Normal published state (NOT needs_review)
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (storyError) throw new Error(`Failed to seed stories: ${storyError.message}`)

    // Parse and insert story contract
    const parsedContract = parseStoryContractWithNormalization(overriddenContract)
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

    // Seed act rollups (both act 1 and act 2 for proper boundary detection)
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
