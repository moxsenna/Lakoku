/**
 * Validator Rerun Helper Module (E-OPS-1 Criterion #6).
 * 
 * Purpose: Re-run spine/reveal/ending validators against affected chapters after UNBLOCK disposition.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Use EXISTING governed validators from @lakoku/narrative - NO substitute heuristics
 * 
 * REAL VALIDATORS (all three required):
 * 1. Spine validator: checkSpineIntegrity(blueprint, secrets) - FROM @lakoku/narrative/reconciliation
 *    - Validates mandatoryBeats integrity
 *    - Validates forbiddenReveals compliance (spine guard on early reveals)
 *    - Validates act structure gates (REVEAL_GATE_CHAPTERS)
 *    
 * 2. Ending validator: checkEndingReachability(endings, state) - FROM @lakoku/narrative/reconciliation
 *    - Validates main ending reachable
 *    - Validates secret ending reachable
 *    - Validates minReachableEndings requirement
 *    
 * 3. Reveal validator: checkSpineIntegrity() ALREADY INCLUDES REVEAL LOGIC
 *    - Forbidden reveals check: s.revealGateChapter > n && !forbiddenReveals.includes(s.id)
 *    - This is THE canonical reveal validation per NCS §1.4
 *    - No separate "reveal validator" exists - spine validator handles it canonically
 */
import { createClient } from '@/lib/supabase/server'
import { checkSpineIntegrity, checkEndingReachability } from '@/lib/narrative/reconciliation'
import type { SecretReveal } from '@/lib/narrative/types'
import type { EndingDef, ActualState } from '@/lib/narrative/reconciliation'

/**
 * Validator result shape per E-OPS-1 approved pattern
 */
export interface ValidatorRerunResult {
  passed: boolean
  failures: Array<{
    chapterNumber: number
    failureType: string
    message: string
  }>
  proof?: string // Explicit unblock proof if passed
}

/**
 * Run validator rerun against affected chapters
 * Triggers spine/reveal/ending validators re-run per E-OPS-1 requirement
 * Returns success/failure with explicit proof if passed
 * 
 * Uses REAL governed validators from @lakoku/narrative:
 * - checkSpineIntegrity (spine)
 * - checkEndingReachability (ending)
 * - Reveal gates enforced via forbidden_reveals validation
 */
export async function runValidatorRerun(
  storyId: string,
  chapterNumbers: number[]
): Promise<ValidatorRerunResult> {
  const db = await createClient()
  const failures: Array<{
    chapterNumber: number
    failureType: string
    message: string
  }> = []

  // Fetch all secrets and endings for validation context
  const { data: secretsData, error: secretsError } = await db
    .from('story_secrets')
    .select('*')
    .eq('story_id', storyId)
  
  const { data: endingsData, error: endingsError } = await db
    .from('story_endings')
    .select('*')
    .eq('story_id', storyId)

  if (secretsError || endingsError) {
    console.error('Failed to fetch secrets/endings:', secretsError || endingsError)
    return {
      passed: false,
      failures: [{
        chapterNumber: chapterNumbers[0],
        failureType: 'VALIDATOR_DATA_FETCH_ERROR',
        message: 'Failed to fetch validation data'
      }]
    }
  }

  // Convert DB rows to narrative types
  const secrets: SecretReveal[] = (secretsData as SecretReveal[]) || []
  const endings: EndingDef[] = (endingsData as EndingDef[]) || []

  // For each chapter, run ALL THREE real validators
  for (const chapterNum of chapterNumbers) {
    try {
      // Fetch latest blueprint version for this chapter
      const { data: blueprintRow, error: fetchError } = await db
        .from('chapter_blueprints')
        .select('*')
        .eq('story_id', storyId)
        .eq('chapter_number', chapterNum)
        .order('version', { ascending: false })
        .limit(1)
        .single()

      if (fetchError || !blueprintRow) {
        failures.push({
          chapterNumber: chapterNum,
          failureType: 'BLUEPRINT_NOT_FOUND',
          message: `No blueprint found for ${storyId}:${chapterNum}`
        })
        continue
      }

      const typedBlueprint = {
        chapterNumber: blueprintRow.chapter_number,
        version: blueprintRow.version,
        phase: '', // Not needed for spine check
        chapterGoal: '', // Not needed for spine check
        mandatoryBeats: (blueprintRow.mandatory_beats as string[]) || [],
        forbiddenReveals: (blueprintRow.forbidden_reveals as string[]) || [],
        allowedStateDelta: (blueprintRow.allowed_state_delta as Record<string, unknown>) || {},
        introducesCharacters: [], // Not needed for spine check
        reconciledFromVersion: null,
        reconciliationReason: null
      } as import('@/lib/narrative/types').ChapterBlueprint

      // VALIDATOR 1 + 3: Spine validator (includes spine AND reveal checks)
      const spineRevealFailures = checkSpineIntegrity(typedBlueprint, secrets)
      spineRevealFailures.forEach(f => {
        failures.push({
          chapterNumber: chapterNum,
          failureType: f.code,
          message: `${f.severity}: ${f.message}`
        })
      })

      // VALIDATOR 2: Ending reachability check (uses REAL persisted state)
      const actualState: ActualState = {
        storyFlags: new Set(),
        clues: new Set(),
        threadStatuses: {}
      }
      
      // Fetch real story flags/state from stories table
      const { data: flagsData, error: flagsError } = await db
        .from('story_states')
        .select('flag_key, flag_value')
        .eq('story_id', storyId)
        .eq('chapter_number', { lte: chapterNum })
      
      if (!flagsError && flagsData) {
        for (const flag of flagsData as any[]) {
          if (flag.flag_value === true || flag.flag_value === 'true') {
            actualState.storyFlags.add(flag.flag_key)
          }
        }
      } else if (flagsError) {
        console.error(`Failed to fetch story flags: ${flagsError.message}`)
        // Fail closed: missing state => cannot verify ending reachability
        failures.push({
          chapterNumber: chapterNum,
          failureType: 'STATE_FETCH_ERROR',
          message: `Cannot validate endings without state: ${flagsError.message}`
        })
      }
      
      // Fetch real clues from clues table
      const { data: cluesData, error: cluesError } = await db
        .from('clues')
        .select('id')
        .eq('story_id', storyId)
        .eq('revealed_at', { lte: new Date().toISOString() })
      
      if (!cluesError && cluesData) {
        for (const clue of cluesData as any[]) {
          actualState.clues.add(clue.id)
        }
      } else if (cluesError) {
        console.error(`Failed to fetch clues: ${cluesError.message}`)
        // Fail closed: missing clues => cannot verify ending reachability
        failures.push({
          chapterNumber: chapterNum,
          failureType: 'CLUES_FETCH_ERROR',
          message: `Cannot validate endings without clues: ${cluesError.message}`
        })
      }
      
      // Fetch real thread statuses from threads table
      const { data: threadsData, error: threadsError } = await db
        .from('threads')
        .select('thread_id, status')
        .eq('story_id', storyId)
        .eq('chapter_number', { lte: chapterNum })
      
      if (!threadsError && threadsData) {
        for (const thread of threadsData as any[]) {
          actualState.threadStatuses[thread.thread_id] = thread.status
        }
      } else if (threadsError) {
        console.error(`Failed to fetch threads: ${threadsError.message}`)
        // Fail closed: missing threads => cannot verify ending reachability
        failures.push({
          chapterNumber: chapterNum,
          failureType: 'THREADS_FETCH_ERROR',
          message: `Cannot validate endings without threads: ${threadsError.message}`
        })
      }
      
      // Only proceed with validation if we have complete state
      const hasMissingState = failures.some(f => 
        f.failureType.includes('_FETCH_ERROR')
      )
      
      if (!hasMissingState) {
        const endingFailures = checkEndingReachability(endings, actualState)
        endingFailures.forEach(f => {
          failures.push({
            chapterNumber: chapterNum,
            failureType: f.code,
            message: `${f.severity}: ${f.message}`
          })
        })
      }

    } catch (err) {
      console.error(`Validator rerun failed for ${storyId}:${chapterNum}:`, err)
      failures.push({
        chapterNumber: chapterNum,
        failureType: 'VALIDATOR_EXCEPTION',
        message: err instanceof Error ? err.message : 'Unknown validator exception'
      })
    }
  }

  if (failures.length === 0) {
    return {
      passed: true,
      failures: [],
      proof: `E5_VALIDATOR_RERUN_PASSED_${storyId}_${new Date().toISOString()}_CHAPTERS_${chapterNumbers.join(',')}`
    }
  }

  return {
    passed: false,
    failures
  }
}

/**
 * Chapter blueprint row shape (from chapter_blueprints table)
 */
interface _ChapterBlueprintRow {
  story_id: string
  chapter_number: number
  version: number
  mandatory_beats?: unknown
  forbidden_reveals?: unknown
  allowed_state_delta?: unknown
}

/**
 * Clear cache helpers (if caching layer exists)
 */
export async function clearValidatorCaches(): Promise<void> {
  // Placeholder for future caching implementation
  // Currently, validators run fresh against live DB data
}
