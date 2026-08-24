/**
 * Blueprint Review Workflow Orchestration Server Module (E-OPS-1 Core).
 * 
 * Purpose: Atomic resolution semantics for human review dispositions.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: Reuse requireAdminUser() owner/admin roles; NO invented role='reviewer'; no novel lifecycle CRUD
 */
import { createAdminClient } from '@lakoku/db'
import { createClient } from '@/lib/supabase/server'
import type {
  ResolutionContext,
  ValidatorRerunResult,
  PendingReviewItem,
  BlueprintQueueStatus,
  ActBoundary,
  FindingType,
  Disposition,
  E5DispositionRpcArgs,
  E5DispositionRpcRow,
} from '@/lib/types/blueprint.contract'
import { runValidatorRerun } from '@/lib/utils/validator-rerun.helper'
import { requireAdminUser } from '@/lib/admin/auth'

const E5_CANONICAL_VALIDATOR_VERSION = 'E5_CANONICAL_VALIDATOR_V1'

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
 * Record disposition with native Postgres atomic transaction (E-OPS-1 Criterion #9).
 * 
 * REVERSED ORDER (Reviewer Requirement #2):
 * 1. DERIVE reviewer identity ONLY from auth layer (NEVER trust payload)
 * 2. Run CANONICAL validators BEFORE any DB writes (spine/reveal/ending)
 * 3. If validators PASS: call native RPC with validator evidence as parameters
 * 4. If validators FAIL: stay BLOCKED, never call success RPC
 * 5. Native RPC atomically applies everything in one transaction
 * 
 * ANY exception => automatic rollback via SECURITY DEFINER function, NO partial commits
 */
function isE5DispositionRpcRow(value: unknown): value is E5DispositionRpcRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.success === 'boolean' &&
    (typeof row.unblock_proof === 'string' || row.unblock_proof === null) &&
    (typeof row.error_message === 'string' || row.error_message === null)
  )
}

export async function recordDisposition(context: ResolutionContext): Promise<{
  success: boolean
  error?: string
  unblockProof?: string
  validationResult?: ValidatorRerunResult
}> {
  const db = await createClient()

  try {
    // reviewer_uid from request context is intentionally ignored.
    const adminRole = await requireAdminUser()
    if (!['owner', 'admin'].includes(adminRole.role)) {
      throw new Error(`Unauthorized: role=${adminRole.role} cannot record dispositions`)
    }

    const trustedContext: Required<ResolutionContext> = {
      story_id: context.story_id,
      disposition: context.disposition,
      reviewer_uid: adminRole.id,
      reason_text: context.reason_text,
      source_event_id: context.source_event_id,
      chapter_numbers: context.chapter_numbers,
    }

    let validationResult: ValidatorRerunResult | undefined
    if (trustedContext.disposition === 'UNBLOCK_PERMIT') {
      validationResult = await runValidatorRerun(
        trustedContext.story_id,
        trustedContext.chapter_numbers,
      )

      if (!validationResult.passed) {
        console.warn(
          '[E5] Canonical validators failed - staying BLOCKED (fail-closed)',
          validationResult.failures,
        )
        return {
          success: false,
          error: 'Canonical validators rejected - remain BLOCKED',
          validationResult,
        }
      }
    }

    const validatedEvidence =
      trustedContext.disposition === 'UNBLOCK_PERMIT' && validationResult?.passed === true
        ? validationResult
        : null
    let validatorAttestationId: string | null = null
    if (validatedEvidence) {
      const adminDb = createAdminClient()
      const { data: issuedAttestation, error: attestationError } = await adminDb.rpc(
        'e5_issue_validator_attestation',
        {
          p_story_id: trustedContext.story_id,
          p_source_event_id: trustedContext.source_event_id,
          p_reviewer_uid: trustedContext.reviewer_uid,
          p_chapter_numbers: validatedEvidence.validatedChapterVersions.map(({ chapter }) => chapter),
          p_validator_version: E5_CANONICAL_VALIDATOR_VERSION,
          p_spine_reveal_findings: validatedEvidence.spineRevealFindings ?? [],
          p_ending_results: validatedEvidence.endingResults,
          p_expected_chapter_versions: validatedEvidence.validatedChapterVersions,
        },
      )
      if (attestationError || typeof issuedAttestation !== 'string') {
        return {
          success: false,
          error: attestationError?.message ?? 'Canonical validator attestation failed',
          validationResult,
        }
      }
      validatorAttestationId = issuedAttestation
    }

    const rpcArgs: E5DispositionRpcArgs = {
      p_story_id: trustedContext.story_id,
      p_disposition: trustedContext.disposition,
      p_reviewer_uid: trustedContext.reviewer_uid,
      p_reason_text: trustedContext.reason_text,
      p_source_event_id: trustedContext.source_event_id,
      p_chapter_numbers: validatedEvidence
        ? validatedEvidence.validatedChapterVersions.map(({ chapter }) => chapter)
        : trustedContext.chapter_numbers,
      p_validator_attestation_id: validatorAttestationId,
    }
    const { data: result, error: rpcError } = await db.rpc(
      'e5_record_disposition',
      rpcArgs,
    )

    if (rpcError) {
      console.error('Postgres function execution failed:', rpcError)
      return { success: false, error: rpcError.message }
    }

    if (!Array.isArray(result) || result.length === 0 || !isE5DispositionRpcRow(result[0])) {
      return { success: false, error: 'Invalid response from resolution authority' }
    }

    const dbResult = result[0]
    if (!dbResult.success) {
      return {
        success: false,
        error: dbResult.error_message || 'Native function returned failure',
      }
    }

    return {
      success: true,
      unblockProof: dbResult.unblock_proof ?? undefined,
      validationResult,
    }

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
  source_event_id: string
  created_at: string
  story_title: string | null
  tagline: string | null
  recent_resolutions: Array<{ id: string; disposition: Disposition; reason_text: string; created_at: string }>
  audit_entries: Array<{ id: string; disposition: Disposition; reason_text: string; created_at: string }>
}

export async function getQueueItemDetail(_storyId: string): Promise<null | QueueItemDetail> {
  const db = await createClient()
  const { data: queueItem, error: queueError } = await db
    .from('vw_blueprint_review_item_details')
    .select('*')
    .eq('story_id', _storyId)
    .single()

  if (queueError || !queueItem) {
    return null
  }

  return queueItem as QueueItemDetail
}