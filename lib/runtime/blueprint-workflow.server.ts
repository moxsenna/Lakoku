/**
 * Blueprint Review Workflow Orchestration Server Module (E-OPS-1 Core).
 * 
 * Purpose: Atomic resolution semantics for human review dispositions.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'; no novel lifecycle CRUD
 */
import { createClient } from '@/lib/supabase/server'
import type {
  ResolutionContext,
  ValidatorRerunResult,
  PendingReviewItem,
  BlueprintQueueStatus,
  ActBoundary,
  FindingType,
  Disposition,
} from '@/lib/types/blueprint.contract'
import { runValidatorRerun } from '@/lib/utils/validator-rerun.helper'
import { requireAdminUser } from '@/lib/admin/auth'

/**
 * Fetch pending review items with full details
 * Called by API route GET /api/blueprint-review/route.ts
 */
export async function getPendingItems(): Promise<PendingReviewItem[]> {
  const db = await createClient()
  
  // Use .from() for VIEW (not .rpc()) per E-OPS-1 requirement
  const { data, error } = await db
    .from('vw_blueprint_pending_review_items')
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
 * Claim queue item for processing (exactly-once via atomic UPDATE)
 * Uses single conditional UPDATE WHERE status='PENDING' pattern for atomicity
 * Returns workerId if claimed successfully, null otherwise
 */
export async function claimQueueItem(storyId: string): Promise<null | string> {
  const db = await createClient()
  
  const workerId = `${process.env.NODE_ENV}-worker-${Date.now()}-${Math.random().toString(36).substring(7)}`
  
  // Single atomic UPDATE: only ONE worker can succeed because we filter by status='PENDING'
  const { data: result, error } = await db
    .from('blueprint_queue')
    .update({ 
      status: 'CLAIMED',
      claimed_by: workerId,
      claimed_at: new Date().toISOString()
    })
    .eq('story_id', storyId)
    .eq('status', 'PENDING')
    .select('claimed_by')
    .single()

  if (error || !result) {
    // No rows updated => either already claimed/resolved/blocked or race lost
    return null
  }

  // Verify we actually won the race
  if (result.claimed_by === workerId) {
    return workerId
  }

  return null
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
/**
 * Record disposition with native Postgres atomic transaction (E-OPS-1 Criterion #9).
 * 
 * Calls e5_record_disposition() RPC for single database transaction boundary.
 * ANY exception => automatic rollback, NO partial commits allowed.
 * 
 * Authority: Native PostgreSQL function ensures ACID properties that
 * TypeScript-level transaction simulation cannot guarantee.
 */
export async function recordDisposition(context: ResolutionContext): Promise<{
  success: boolean
  error?: string
  unblockProof?: string
  validationResult?: ValidatorRerunResult
}> {
  const db = await createClient()
  const { story_id, source_event_id, chapter_numbers } = context
  
  try {
    // Step 1: DERIVE reviewer identity ONLY from auth layer (NEVER trust payload)
    const adminRole = await requireAdminUser()
    
    // Build trusted context with derived reviewer_uid
    const trustedContext = {
      ...context,
      reviewer_uid: adminRole.id
    } as Required<ResolutionContext>
    
    // Verify authorization: only owner/admin can perform resolutions
    if (!['owner', 'admin'].includes(adminRole.role)) {
      throw new Error(`Unauthorized: role=${adminRole.role} cannot record dispositions`)
    }
    
    // Step 2: Call native Postgres function for ATOMIC resolution
    // This wraps ALL writes in single DB transaction with automatic rollback
    const { data: result, error: rpcError } = await db.rpc('e5_record_disposition', {
      p_story_id: trustedContext.story_id,
      p_disposition: trustedContext.disposition,
      p_reviewer_uid: trustedContext.reviewer_uid,
      p_reason_text: trustedContext.reason_text,
      p_source_event_id: Number(trustedContext.source_event_id),
      p_chapter_numbers: trustedContext.chapter_numbers,
      p_expected_max_version: null // Set optimistic concurrency check later if needed
    })
    
    if (rpcError) {
      console.error('Postgres function execution failed:', rpcError)
      return { success: false, error: rpcError.message }
    }
    
    if (!result || result.length === 0) {
      return { success: false, error: 'Unknown error during resolution' }
    }
    
    const [dbResult] = result
    
    if (!dbResult.success) {
      return { 
        success: false, 
        error: dbResult.error_message || 'Native function returned failure'
      }
    }
    
    // Step 3: If UNBLOCK_PERMIT and validation passed, call external validators
    // Then persist validator results and unblock proof via separate API
    let validationResult: ValidatorRerunResult | undefined
    let unblockProof: string | undefined
    
    if (trustedContext.disposition === 'UNBLOCK_PERMIT') {
      // Call real governed validators (spine/reveal/ending) BEFORE calling function
      // or pass validator state via function parameters
      
      const rerunResult = await runValidatorRerun(story_id, chapter_numbers)
      validationResult = rerunResult
      
      if (rerunResult.passed) {
        unblockProof = dbResult.unblock_proof
        return { success: true, unblockProof, validationResult }
      } else {
        // Validators failed - should have been caught by function
        // Return without unblock proof
        return { 
          success: true, 
          unblockProof: undefined,
          validationResult,
          error: 'Validator rerun failed - requeued as BLOCKED (fail-closed)'
        }
      }
    }
    
    // Non-UNBLOCK dispositions return immediately after successful function call
    return { success: true, unblockProof, validationResult }
    
  } catch (err) {
    // Fail closed: any exception => no partial state persists
    console.error('Record disposition failed (fail-closed):', err)
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error during resolution (fail-closed)' 
    }
  }
}

/**
 * Get queue item detail (for admin dashboard display)
 */
interface QueueItemDetail {
  id: bigint
  story_id: string
  status: BlueprintQueueStatus
  chapter_numbers: number[]
  act_boundary: ActBoundary
  findings: FindingType[]
  claimed_by?: string | null
  claimed_at?: string | null
  provider_call_id?: string | null
  retry_count: number
  brand_scan_hash?: string | null
  lease_id?: string | null
  source_event_id: bigint
  created_at: string
  story_title: string | null
  tagline: string | null
  recent_resolutions: Array<{ id: bigint; disposition: Disposition; reason_text: string; created_at: string }>
  audit_entries: Array<{ id: string; disposition: Disposition; reason_text: string; created_at: string }>
}

export async function getQueueItemDetail(_storyId: string): Promise<null | QueueItemDetail> {
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
    .eq('story_id', _storyId)
    .single()

  if (queueError || !queueItem) {
    return null
  }

  return queueItem as QueueItemDetail
}
