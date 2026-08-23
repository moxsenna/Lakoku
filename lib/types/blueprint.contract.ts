/**
 * Blueprint Review Workflow Type Definitions (E-OPS-1 Contract).
 * 
 * Purpose: Shared types for blueprint review workflow queue processing.
 * Authority: M10-E E5 implementation authority SHA = `a16b5a3b950ead2385a41c4fe12369336fbbc15f`
 * Boundary: NO novel lifecycle CRUD; NO budget authority tracking; NO multi-tier architecture
 */

/**
 * Queue item status per E-OPS-1 approved pattern
 */
export type BlueprintQueueStatus = 'PENDING' | 'CLAIMED' | 'RESOLVED' | 'BLOCKED';

/**
 * Act boundary classification
 */
export type ActBoundary = 'ACT_1' | 'ACT_2' | 'ACT_3';

/**
 * Failure findings from runtime incident capture
 */
export type FindingType = 
  | 'BRAND_LEAK'
  | 'CANONICAL_CORRUPTION' 
  | 'LEASE_TIMEOUT'
  | 'PARSE_FAILURE';

/**
 * Disposition outcome per E-OPS-1 Criterion #4
 */
export type Disposition = 'REJECT_BLOCK' | 'RETRY_ALLOW' | 'UNBLOCK_PERMIT';

/**
 * Failed story detail payload schema
 * Note: sourceEvent.eventId must be bigint JSON-safe string -> server-side BigInt conversion
 * MISSING real event => fail closed (no enqueue/resolution permitted without evidence binding)
 */
export interface FailedStoryDetail {
  storyId: string; // FK to public.stories(id) as TEXT
  chapterNumbers: number[]; // May include multiple chapters if act boundary affected
  actBoundary: ActBoundary;
  findings: FindingType[];
  sourceEvent: {
    providerCallId: string;
    retryCount: number;
    brandScanHash?: string;
    leaseId?: string;
    eventId?: string; // JSON-safe decimal string representation of BIGINT; NULL not allowed - missing real event => fail closed
  };
}

/**
 * Queue item record shape matching database schema
 */
export interface BlueprintQueueItem {
  story_id: string;
  status: BlueprintQueueStatus;
  chapter_numbers: number[];
  act_boundary: ActBoundary;
  findings: FindingType[];
  claimed_by?: string | null;
  claimed_at?: string | null;
  provider_call_id?: string | null;
  retry_count: number;
  brand_scan_hash?: string | null;
  lease_id?: string | null;
  source_event_id: bigint; // BIGINT NOT NULL per E-OPS-1 requirement
  created_at: string;
}

/**
 * Resolution disposition record shape
 */
export interface BlueprintResolution {
  id?: bigint;
  story_id: string;
  disposition: Disposition;
  reviewer_uid: string; // auth.uid()
  reason_text: string;
  created_at: string;
  idempotency_key?: string;
}

/**
 * Audit log entry shape (immutable after insertion)
 */
export interface BlueprintAuditEntry {
  id: string; // UUID
  story_id: string;
  reviewer_uid: string;
  disposition: Disposition;
  reason_text: string;
  source_event_id: bigint; // BIGINT NOT NULL REQUIRED - no null/sentinel/placeholder/fake
  created_at: string;
  idempotency_key?: string;
}

/**
 * Pending review item view shape (from vw_blueprint_pending_review_items)
 */
export interface PendingReviewItem extends BlueprintQueueItem {
  story_title?: string | null;
  tagline?: string | null;
  role?: string | null;
  total_chapters?: number | null;
  status?: string | null;
}

/**
 * API response shapes
 */
export interface GetPendingItemsResponse {
  items: PendingReviewItem[];
}

export interface GetItemDetailResponse {
  item: Omit<BlueprintQueueItem, 'source_event_id'> & {
    story_title: string | null;
    genre?: string | null;
    author_note?: string | null;
    recent_resolutions: Array<{
      id: bigint;
      disposition: Disposition;
      reason_text: string;
      created_at: string;
    }>;
    audit_entries: Array<{
      id: string;
      disposition: Disposition;
      reason_text: string;
      created_at: string;
    }>;
  };
}

export interface RecordDispositionRequest {
  disposition: Disposition;
  reason_text: string;
}

export interface RecordDispositionResponse {
  success: boolean;
}

/**
 * Core workflow orchestration interfaces
 */

/**
 * Validator rerun result
 */
export interface ValidatorRerunResult {
  passed: boolean;
  failures: Array<{
    chapterNumber: number;
    failureType: string;
    message: string;
  }>;
  proof?: string; // Explicit unblock proof if passed
}

/**
 * Chapter blueprint insert payload (append-only, never UPDATE existing version)
 */
export interface ChapterBlueprintInsertPayload {
  story_id: string;
  chapter_number: number;
  version: number; // Should be MAX(version) + 1 for append-only
  phase?: string;
  chapter_goal?: string;
  mandatory_beats?: unknown;
  forbidden_reveals?: unknown;
  allowed_state_delta?: unknown;
  introduces_characters?: unknown;
  reconciled_from_version?: number;
  reconciliation_reason?: string;
}

/**
 * Full resolution context for atomic operation
 */
export interface ResolutionContext {
  story_id: string;
  disposition: Disposition;
  reviewer_uid: string;
  reason_text: string;
  source_event_id: bigint;
  chapter_numbers: number[];
}
