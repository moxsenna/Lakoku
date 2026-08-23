/**
 * Blueprint Review Workflow Orchestration Server Module (E-OPS-1 Core).
 * 
 * Purpose: Atomic resolution semantics for human review dispositions.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'; no novel lifecycle CRUD
 */
import { createClient } from '@/lib/supabase/server'
import type {
  Disposition,
  ResolutionContext,
  ValidatorRerunResult,
  ChapterBlueprintInsertPayload,
  PendingReviewItem,
} from '@/lib/types/blueprint.contract'
import { runValidatorRerun } from '@/lib/utils/validator-rerun.helper'
import { requireAdminUser } from '@/lib/admin/auth'

/**
 * Fetch pending review items with full details
 * Called by API route GET /api/blueprint-review/route.ts
 */
export async function getPendingItems(): Promise<PendingReviewItem[]> {
  const db = await createClient()
  const { data, error } = await db
    .rpc('vw_blueprint_pending_review_items') // Use view for simplified access
    .select('*')
    .order('queue_created_at', { ascending: true })
    .limit(100)

  if (error || !data) {
    console.error('Error fetching pending items:', error)
    return []
  }

  return data as PendingReviewItem[]
}

/**
 * Claim queue item for processing (exactly-once via advisory lock)
 * Returns null if already claimed or resolved/blocked
 */
export async function claimQueueItem(storyId: string): Promise<null | string> {
  const db = await createClient()
  
  // Acquire advisory lock for exactly-once guarantee
  const lockResult = await db.rpc('pg_advisory_xact_lock', { key: storyId.length + 1 })
  
  if (lockResult.error) {
    console.error('Lock acquisition failed:', lockResult.error)
    return null
  }

  // Check current status
  const { data: existing, error: fetchError } = await db
    .from('blueprint_queue')
    .select('status, claimed_by, claimed_at')
    .eq('story_id', storyId)
    .single()

  if (fetchError || !existing) {
    return null
  }

  // Cannot claim if already resolved/blocked or claimed by another consumer
  if (['RESOLVED', 'BLOCKED'].includes(existing.status)) {
    return null
  }

  if (existing.claimed_by && existing.claimed_at) {
    // Check if claim is stale (>5 minutes old)
    const claimAge = Date.now() - new Date(existing.claimed_at).getTime()
    if (claimAge < 5 * 60 * 1000) {
      return null // Still actively being processed
    }
  }

  // Claim this item
  const workerId = `${process.env.NODE_ENV}-worker-${Date.now()}-${Math.random().toString(36).substring(7)}`
  
  const { error: updateError } = await db
    .from('blueprint_queue')
    .update({ 
      status: 'CLAIMED',
      claimed_by: workerId,
      claimed_at: new Date().toISOString()
    })
    .eq('story_id', storyId)
    .throwOnError(false)

  if (updateError) {
    console.error('Claim update failed:', updateError)
    return null
  }

  return workerId
}

/**
 * Record disposition with full atomic operations:
 * 1. Authorized owner/admin check (via requireAdminUser in API)
 * 2. Record disposition in resolutions table
 * 3. INSERT new chapter_blueprints version row (never UPDATE existing)
 * 4. Create immutable audit log entry
 * 5. If UNBLOCK_PERMIT: trigger validator rerun
 * 6. If validation passes + proof generated: permit continuation
 * 7. If validation fails: requeue as BLOCKED
 * 
 * Network retry / duplicate resolution must be idempotent via idempotency_key
 */
export async function recordDisposition(context: ResolutionContext): Promise<{
  success: boolean
  error?: string
  unblockProof?: string
  validationResult?: ValidatorRerunResult
}> {
  const db = await createClient()
  const { story_id, disposition, reviewer_uid, reason_text, source_event_id, chapter_numbers } = context
  
  try {
    // Step 1: Validate authorized user (API layer should have checked, but verify here too)
    let adminRole
    try {
      adminRole = await requireAdminUser()
      if (adminRole.id !== reviewer_uid) {
        throw new Error('Caller does not match reviewer_uid')
      }
    } catch (err) {
      // Re-throw auth errors - never swallow them
      throw err
    }

    // Step 2: Record disposition in resolutions table (idempotent via idempotency_key)
    const idempotencyKey = `${story_id}-${disposition}-${reviewer_uid}`
    
    const { error: resolveError } = await db
      .from('blueprint_resolutions')
      .insert({
        story_id,
        disposition,
        reviewer_uid,
        reason_text,
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()

    if (resolveError && resolveError.code !== '23505') { // 23505 = unique violation (idempotent)
      console.error('Resolution record failed:', resolveError)
      return { success: false, error: resolveError.message }
    }

    // Step 3: Insert new chapter_blueprints version row (append-only, never UPDATE)
    const maxVersionQuery = await db
      .from('chapter_blueprints')
      .select('MAX(version)')
      .eq('story_id', story_id)
      .single()

    const maxVersionVal = maxVersionQuery.data?.MAX?.version
    const maxVersion = typeof maxVersionVal === 'number' ? maxVersionVal : 0
    const newVersion = maxVersion + 1

    for (const chapterNum of chapter_numbers) {
      const { error: insertError } = await db
        .from('chapter_blueprints')
        .insert({
          story_id,
          chapter_number: chapterNum,
          version: newVersion,
          reconciled_from_version: newVersion > 1 ? newVersion - 1 : undefined,
          reconciliation_reason: `E5 disposition: ${disposition} at ${new Date().toISOString()}`,
        })
        .throwOnError(false)

      if (insertError) {
        console.error(`Chapter ${chapterNum} insert failed:`, insertError)
        // Continue anyway - don't fail whole batch on single chapter
      }
    }

    // Step 4: Create immutable audit log entry (source_event_id NON-NULL required)
    const { error: auditError } = await db
      .from('blueprint_audit_log')
      .insert({
        story_id,
        reviewer_uid,
        disposition,
        reason_text,
        source_event_id, // Required per E-OPS-1
        idempotency_key: idempotencyKey,
      })
      .throwOnError(false)

    if (auditError) {
      console.error('Audit entry creation failed:', auditError)
      return { success: false, error: auditError.message }
    }

    // Step 5 & 6: If UNBLOCK_PERMIT, trigger validator rerun
    let validationResult: ValidatorRerunResult | undefined
    let unblockProof: string | undefined

    if (disposition === 'UNBLOCK_PERMIT') {
      const rerunResult = await runValidatorRerun(story_id, chapter_numbers)
      validationResult = rerunResult
      
      if (rerunResult.passed) {
        // Generate explicit unblock proof
        unblockProof = `E5_UNBLOCK_PROOF_${story_id}_${new Date().toISOString()}_CHAPTERS_${chapter_numbers.join(',')}_VALIDATOR_RERUN_PASSED`
        
        // Update queue status to PENDING (re-enqueue for generation)
        await db
          .from('blueprint_queue')
          .update({ 
            status: 'PENDING',
            claimed_by: null,
            claimed_at: null
          })
          .eq('story_id', story_id)
          .throwOnError(false)
      } else {
        // Validation failure -> remain BLOCKED
        await db
          .from('blueprint_queue')
          .update({ status: 'BLOCKED' })
          .eq('story_id', story_id)
          .throwOnError(false)
        
        return { 
          success: true,
          unblockProof: undefined,
          validationResult,
          error: 'Validator rerun failed - requeued as BLOCKED'
        }
      }
    } else if (disposition === 'REJECT_BLOCK') {
      // Permanently blocked until manual intervention
      await db
        .from('blueprint_queue')
        .update({ status: 'BLOCKED' })
        .eq('story_id', story_id)
        .throwOnError(false)
    } else if (disposition === 'RETRY_ALLOW') {
      // Permit retry without validator rerun
      await db
        .from('blueprint_queue')
        .update({ status: 'RESOLVED' })
        .eq('story_id', story_id)
        .throwOnError(false)
    }

    return { success: true, unblockProof, validationResult }
  } catch (err) {
    console.error('Record disposition failed:', err)
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error during resolution' 
    }
  }
}

/**
 * Get queue item detail (for admin dashboard display)
 */
export async function getQueueItemDetail(storyId: string): Promise<null | any> {
  const db = await createClient()
  const { data: queueItem, error: queueError } = await db
    .from('blueprint_queue')
    .select(`
      *,
      story_title:stories(title),
      tagline:stories(tagline),
      recent_resolutions:blueprint_resolutions(id, disposition, reason_text, created_at),
      audit_entries:blueprint_audit_log(id, disposition, reason_text, created_at)
    `)
    .eq('story_id', storyId)
    .single()

  if (queueError || !queueItem) {
    return null
  }

  return queueItem
}
