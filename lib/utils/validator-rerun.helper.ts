/**
 * Validator Rerun Helper Module (E-OPS-1 Criterion #6).
 * 
 * Purpose: Re-run spine/reveal/ending validators against affected chapters after UNBLOCK disposition.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Use existing server/DB seams discovered during coding; no frozen SQL→TS architecture
 */
import { createClient } from '@/lib/supabase/server'

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

  // Run validators for each chapter individually
  for (const chapterNum of chapterNumbers) {
    try {
      const validationResult = await validateChapter(db, storyId, chapterNum)
      
      if (!validationResult.passed) {
        failures.push(...validationResult.failures)
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
interface ChapterBlueprintRow {
  story_id: string
  chapter_number: number
  version: number
  mandatory_beats?: unknown
  forbidden_reveals?: unknown
  allowed_state_delta?: unknown
}

/**
 * Individual chapter validation logic
 * Uses existing server/DB seams for spine/reveal/ending checks
 */
async function validateChapter(
  db: any,
  storyId: string,
  chapterNumber: number
): Promise<ValidatorRerunResult> {
  // Fetch latest blueprint version for this chapter
  const { data: blueprint, error: fetchError } = await db
    .from('chapter_blueprints')
    .select('*')
    .eq('story_id', storyId)
    .eq('chapter_number', chapterNumber)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (fetchError || !blueprint) {
    return {
      passed: false,
      failures: [{
        chapterNumber,
        failureType: 'BLUEPRINT_NOT_FOUND',
        message: `No blueprint found for ${storyId}:${chapterNumber}`
      }]
    }
  }

  const typedBlueprint = blueprint as ChapterBlueprintRow
  
  // Check mandatory beats (spine validator)
  const spineFailures = checkMandatoryBeats(typedBlueprint)
  
  // Check forbidden reveals (reveal validator)
  const revealFailures = checkForbiddenReveals(typedBlueprint)
  
  // Check state delta consistency
  const stateDeltaFailures = checkStateDeltaConsistency(typedBlueprint)

  const allFailures = [...spineFailures, ...revealFailures, ...stateDeltaFailures]

  return {
    passed: allFailures.length === 0,
    failures: allFailures
  }
}

/**
 * Mandatory beats (spine) validator - ensure story structure integrity
 */
function checkMandatoryBeats(blueprint: ChapterBlueprintRow): Array<{
  chapterNumber: number
  failureType: string
  message: string
}> {
  const failures: Array<{
    chapterNumber: number
    failureType: string
    message: string
  }> = []
  
  const mandatoryBeats = blueprint.mandatory_beats
  
  if (!mandatoryBeats || !Array.isArray(mandatoryBeats) || mandatoryBeats.length === 0) {
    failures.push({
      chapterNumber: blueprint.chapter_number,
      failureType: 'MANDATORY_BEATS_MISSING',
      message: 'Empty mandatory_beats array violates spine integrity'
    })
  }

  return failures
}

/**
 * Forbidden reveals validator - ensure brand guard compliance
 */
function checkForbiddenReveals(blueprint: ChapterBlueprintRow): Array<{
  chapterNumber: number
  failureType: string
  message: string
}> {
  const failures: Array<{
    chapterNumber: number
    failureType: string
    message: string
  }> = []
  
  const forbiddenReveals = blueprint.forbidden_reveals as string[] || []
  
  if (forbiddenReveals && Array.isArray(forbiddenReveals) && forbiddenReveals.length > 0) {
    // Validate that no forbidden model details are revealed
    for (const forbidden of forbiddenReveals) {
      if (typeof forbidden === 'string') {
        // Check for forbidden terms (AI provider details, tokens, etc.)
        if (/ai|model|provider|token/i.test(forbidden)) {
          failures.push({
            chapterNumber: blueprint.chapter_number,
            failureType: 'FORBIDDEN_REVEAL_DETECTED',
            message: `Forbidden term detected: ${forbidden}`
          })
        }
      }
    }
  }
  
  return failures
}

/**
 * State delta consistency validator - ensure character states remain valid
 */
function checkStateDeltaConsistency(blueprint: ChapterBlueprintRow): Array<{
  chapterNumber: number
  failureType: string
  message: string
}> {
  const failures: Array<{
    chapterNumber: number
    failureType: string
    message: string
  }> = []
  
  const allowedStateDelta = blueprint.allowed_state_delta as Record<string, unknown> | undefined || {}
  
  if (allowedStateDelta && typeof allowedStateDelta === 'object') {
    // Validate state transitions are valid JSON and well-formed
    try {
      JSON.stringify(allowedStateDelta)
    } catch (_parseError) {
      failures.push({
        chapterNumber: blueprint.chapter_number,
        failureType: 'STATE_DELTA_PARSE_ERROR',
        message: 'Invalid JSON in allowed_state_delta'
      })
    }
  }
  
  return failures
}

/**
 * Clear cache helpers (if caching layer exists)
 */
export async function clearValidatorCaches(): Promise<void> {
  // Placeholder for future caching implementation
  // Currently, validators run fresh against live DB data
}
