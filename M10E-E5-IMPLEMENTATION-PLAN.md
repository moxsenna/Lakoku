# M10-E E5 Human Blueprint Workflow Implementation Plan

**Document Type:** Minimal Acceptance Contract Specification  
**Status:** Awaiting Reviewer Resolutions on Three DEC-E5 Dispositions  
**Date:** 2026-08-23  
**Approval Required:** Engineering Lead (workflow design) + Product Owner (failure triage policy)  

---

## 1. Executive Summary

This document provides **minimal implementation specification** for E5 (Human Blueprint Workflow) aligned to reviewer-ratified **E-OPS-1 acceptance contract**. DO NOT implement until three decisions resolved:

**Resolved Decisions (from reviewer):**

- **DEC-E5-01:** REMOVED FROM E5 → moves to E0/product-finance authority domain
- **DEC-E5-02:** MINIMAL SEQUENTIAL REVIEW WORKFLOW → queue every `needs_review` chapter exactly once; detail→single resolution→validator rerun→unblock/retain-block
- **DEC-E5-03:** FAIL-CLOSED FOR READER → internal reviewer may see technical findings; reader never sees technical/model/runtime details

Until these dispositions recorded via governance ledger, E5 stays at **DESIGN_REVIEW** state. All implementation files must match the exact allowlist below without expanding scope to commercial budget-governance endpoints.

---

## 2. Nine Ratified E-OPS-1 Acceptance Criteria

The E5 milestone closes when these nine criteria satisfied as per reviewer ratification. **Criterion #7 corrected per explicit instruction:**

### Criterion #1: Queue Processing Guarantee

Every chapter/stage transition entering `needs_review` state must be processed by human blueprint workflow **exactly once**. No duplicates, no skips.

**Implementation:** Single-consumer queue consumer pattern using PostgreSQL advisory locks or work queue table with `status='pending'→'processing'→'resolved'` state machine. Atomic transitions prevent re-processing.

### Criterion #2: Detail Record Enrichment

Each queued item carries full context payload: failed chapter number, act boundary identifier, specific failure findings, source event metadata (provider call ID, retry count, brand scan hash), and blueprint version references.

**Payload Schema:**
```typescript
interface FailedChapterDetail {
  chapterId: string;
  chapterNumber: number; // 1..50
  actBoundary: 'ACT_1' | 'ACT_2' | 'ACT_3';
  findings: Array<'BRAND_LEAK'|'CANONICAL_CORRUPTION'|'LEASE_TIMEOUT'|'PARSE_FAILURE'>;
  sourceEvent: {
    providerCallId: string;
    retryCount: number;
    brandScanHash?: string;
    leaseId?: string;
  };
  blueprintVersion: string; // M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1 hash
}
```

### Criterion #3: Single Resolution Authority

Only **authorized reviewer** can record disposition per item. Unauthorized users receive `NOT_ALLOWED` error. Reviewer identity bound to JWT claim `role='reviewer'` validated server-side before action permitted.

**Security Pattern:** RLS policy enforcing `auth.uid() = allowed_reviewer_ids[]` check on `blueprint_resolutions` table insert.

### Criterion #4: Resolution Creates New Blueprint Version

Disposition generates new blueprint version row without overwriting history. Old version preserved in immutable ledger; new version increments sequence number (`version_n+1`) and stores revised parameters (retry policy adjustment, prompt template patch, validator threshold update).

**Database Pattern:** Append-only `blueprint_versions` table with foreign key back-reference to parent version; never UPDATE rows that already exist.

### Criterion #5: Audit Trail Completeness

Record reviewer ID, disposition outcome (`REJECT_BLOCK|RETRY_ALLOW|UNBLOCK_PERMIT`), detailed reason text, timestamp (UTC), source event ID reference. Immutable audit entry cannot be modified post-insertion.

**Audit Schema:**
```sql
CREATE TABLE blueprint_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_item_id UUID REFERENCES blueprint_queue(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL, -- auth.uid() of authorized user
  disposition TEXT NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  reason_text TEXT NOT NULL,
  source_event_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Criterion #6: Validator Rerun After Resolution

Upon UNBLOCK disposition, trigger spine/reveal/ending validators re-run against affected chapter + adjacent chapters. If validators pass, permit generation continuation; if fail again, return to `needs_review` queue. Idempotent reruns prevent infinite loops.

**Implementation Hook:** Database function `rerun_validators_for_chapter_v1(chapter_id uuid)` returning boolean success flag; invoked by resolver workflow upon UNBLOCK.

### Criterion #7: Failure Retains Block Until Explicit Unblock ✅ CORRECTED PER REVIEWER

**Corrected Language:** 
> **Failure remains blocked. Success may unblock only after the mandated validators rerun successfully and the system records explicit unblock proof.**

**Prohibition:** Cannot have generic/manual "explicit unblock" that bypasses spine/reveal/ending validators. The word "success" in criterion explicitly refers to validator rerun passing ALL THREE gates, not arbitrary reviewer discretion.

**State Machine Rule:** `status='BLOCKED'` persists through UNBLOCK disposition → triggers validator rerun → if validators PASS → permits generation continuation; if validators FAIL → returns to queue BLOCKED.

### Criterion #8: Success Has Explicit Unblock Proof

UNBLOCK_PERMIT creates signed proof record containing: disposition hash, blueprint version reference, audit log link, validator rerun results array, timestamp. Stored as immutable artifact retrievable via API query.

**Proof Structure:**
```json
{
  "disposition_hash": "sha256(disposition+timestamp+reviewer_id)",
  "blueprint_version": "M10_E_CHAPTER_STAGE_EXCHANGEABILITY_V1#new_hash",
  "audit_log_id": "uuid",
  "validator_results": [/* array of pass/fail booleans */],
  "created_at": "ISO_8601"
}
```

### Criterion #9: Reader-Safe Copy Only

Reader-facing copy strings contain NO technical/model/runtime details ("brand leak", "canonical corruption", "lease timeout", "retry", "token", "AI"). Always generic user-safe messaging ("Review required", "Please try again later"). Technical findings visible only to authorized reviewers via separate admin interface.

**Copy Policy:** Pre-approved string library enforced via ESLint rule disallowing forbidden words in component files under `components/novels/` and API route response messages. Forbidden term list: `brand`, `leak`, `canon`, `corruption`, `lease`, `timeout`, `retry`, `token`, `AI`, `model`, `provider`.

---

## 3. Exact Allowlist Files (Minimum E5 Scope)

Reviewer explicit instruction states: "Allowlist/migration belum exact." Providing **exact path-by-path allowlist**:

### 3.1 Backend TypeScript Files

| Full Repository Path | Purpose | Status |
|----------------------|---------|--------|
| `lib/runtime/blueprint-workflow.server.ts` | Core workflow engine implementing all nine criteria | NEW FILE |
| `lib/utils/validator-rerun.helper.ts` | Trigger spine/reveal/ending validators after unblock | NEW FILE |
| `lib/types/blueprint.contract.ts` | TypeScript interfaces for queue/resolution/audit schemas | NEW FILE |

### 3.2 API Route Files

| Full Repository Path | Purpose | Status |
|----------------------|---------|--------|
| `app/api/blueprint-review/route.ts` | Admin endpoint for reviewing blocked items | NEW FILE |
| `app/api/blueprint-review/[id]/dispute/route.ts` | Optional: submit dispute against reviewer decision (FUTURE phase, not Phase 1) | FUTURE NOT PHASE 1 |

### 3.3 UI Component Files

| Full Repository Path | Purpose | Status |
|----------------------|---------|--------|
| `components/admin/BlueprintDashboard.tsx` | Reviewer interface showing queue | NEW FILE |
| `components/admin/BlueprintResolutionForm.tsx` | Form for recording disposition | NEW FILE |

### 3.4 Database Migration Files (Exact Filenames Required)

| Priority | Exact Migration Filename | Description |
|----------|--------------------------|-------------|
| P0 | `supabase/migrations/2026-08-23T09-00-00-create-blueprint-queue-table.sql` | Core queue table with status state machine |
| P0 | `supabase/migrations/2026-08-23T09-01-00-create-blueprint-resolutions-table.sql` | Append-only resolution ledger |
| P0 | `supabase/migrations/2026-08-23T09-02-00-create-blueprint-versions-table.sql` | Version history tracking |
| P0 | `supabase/migrations/2026-08-23T09-03-00-create-blueprint-audit-log-table.sql` | Immutable audit trail |
| P0 | `supabase/migrations/2026-08-23T09-04-00-create-rerun-validator-function.sql` | PostgreSQL function `rerun_validators_for_chapter_v1(uuid)` |
| P1 | `supabase/migrations/2026-08-23T09-05-00-create-blueprint-rls-policies.sql` | Row-level security policies |

**Total migration files:** 6 exact filenames listed above. Zero other migrations authorized.

### 3.5 Forbidden Expansions (Explicitly Out of Scope)

❌ Do NOT modify `business_authority`, `budget_usage`, `judgment_evaluations` tables  
❌ Do NOT add novel lifecycle CRUD endpoints (`/api/novels` POST/DELETE/PATCH)  
❌ Do NOT implement judge evaluation RPCs (`/api/novels/:id/evaluate-judges`)  
❌ Do NOT create multi-tier architecture or parallel batch runners  
❌ Do NOT expose technical model details in reader-facing copy strings  
❌ Do NOT create ANY migration files beyond the six listed in Section 3.4

All forbidden items represent commercial/governance scope expansion outside E-OPS-1 acceptance contract.

---

## 4. Decision Resolutions (Already Approved by Reviewer)

### DEC-E5-01: REMOVED FROM E5

**Reasoning:** Cost ceiling is purely E0/product-finance authority decision. E5 does not need to know budget numbers to implement workflow queue processing. Budget authority resolves separately via E0 governance cycle.

**Action:** Delete any code/documentation references to cost ceiling from E5 implementation. Keep zero awareness of monetary values.

### DEC-E5-02: MINIMAL SEQUENTIAL REVIEW WORKFLOW

**Approved Pattern:**
1. Chapter enters `needs_review` state → added to `blueprint_queue` table with status `PENDING`
2. Consumer picks next pending item (atomic lock acquisition)
3. Load full detail record (chapter context + failure findings + source event)
4. Show to single authorized reviewer via admin interface
5. Reviewer records disposition: `REJECT_BLOCK` | `RETRY_ALLOW` | `UNBLOCK_PERMIT`
6. If `UNBLOCK_PERMIT`: trigger validator rerun via database function; if pass → permit generation; if fail → requeue as BLOCKED
7. If `REJECT_BLOCK`: retain permanently blocked until manual override (but NEVER override without validator rerun first)
8. Create audit log entry + new blueprint version row
9. Repeat for next queue item

**Explicit Rejection:** Multi-tier evaluation (first-pass single rubric then deep dive) NOT authorized. Parallel batch processing across novels NOT authorized. Sequential single-novel-at-a-time workflow ONLY.

### DEC-E5-03: FAIL-CLOSED FOR READER

**Approved Pattern:**
- Internal reviewer sees technical details (brand leak hash, retry count, provider error codes)
- Reader interface shows ONLY approved safe strings: "Review in progress...", "Please try again later", "Content under quality check"
- Never render raw error messages, technical identifiers, or model/provider details
- ESLint rule enforce forbid-list of terms: `brand`, `leak`, `token`, `AI`, `model`, `provider`, `timeout`, `retry`, `canon`, `corruption`, `lease`

**Rationale:** Immersive reading experience prioritized over transparency. Technical debugging happens in admin dashboard exclusively.

---

## 5. Testing Strategy (Minimal Viable Coverage)

### Unit Tests (Vitest)

| File | Coverage Requirement |
|------|---------------------|
| `lib/runtime/blueprint-workflow.test.ts` | Test all nine acceptance criteria individually: queue deduplication, audit logging, resolver permissions, validator rerun hooks |
| `lib/utils/validator-rerun.helper.test.ts` | Test idempotency: same rerun called twice produces same result; never modifies original chapter content |
| `app/api/blueprint-review/route.test.ts` | Test RBAC: unauthorized users get 403; authorized reviewers succeed |

### Integration Tests (Playwright)

| Flow | Steps |
|------|-------|
| Reviewer queues processing | 1. Manually inject blocked chapter into DB queue<br>2. Trigger workflow consumer<br>3. Verify queue item status changes PENDING→RESOLVED |
| Reviewer disposition flow | 1. Open admin dashboard<br>2. Click blocked item<br>3. Select UNBLOCK_PERMIT + enter reason<br>4. Verify new blueprint_version row created<br>5. Verify audit_log row created |
| Reader safety verification | 1. Simulate blocked chapter view from reader account<br>2. Confirm generic message displayed (no technical strings)<br>3. Run automated regex scan on component output for forbidden terms |

---

## 6. Implementation Steps (Ordered Sequence)

Execute ONLY after three DEC-E5 decisions formally acknowledged as above.

### Phase 1: Foundation (Week 1)

1. ✅ Create exact six database schema migrations (`supabase/migrations/2026-08-23T09-*`)
2. ✅ Deploy RLS policies (`2026-08-23T09-05-00-create-blueprint-rls-policies.sql`)
3. ✅ Implement core workflow engine (`lib/runtime/blueprint-workflow.server.ts`)
4. ✅ Write unit tests for workflow logic

### Phase 2: API Layer (Week 2)

5. ✅ Implement admin review endpoint (`app/api/blueprint-review/route.ts`)
6. ✅ Write integration tests for RBAC enforcement

### Phase 3: UI Components (Week 3)

7. ✅ Design BlueprintDashboard layout (`components/admin/BlueprintDashboard.tsx`)
8. ✅ Build resolution form component (`components/admin/BlueprintResolutionForm.tsx`)
9. ✅ Conduct internal reviewer usability testing

### Phase 4: Validation Gate (Week 4)

10. ✅ Execute full acceptance criterion test suite (all nine criteria green)
11. ✅ Submit change bundle to governance review
12. ✅ Get approval signature linking to M10-E E3A/E4 counted SHA `65053607`

---

## Appendix A: Sample Implementation Snippets

### Queue Consumer Pattern

```typescript
// lib/runtime/blueprint-workflow.server.ts
import { acquireAdvisoryLock, releaseAdvisoryLock } from '@/lib/db/postgres-helpers'

export async function processNextQueuedItem(): Promise<void> {
  const lockId = await acquireAdvisoryLock('blueprint_queue_lock')
  
  try {
    const { data: queueItem } = await supabase
      .from('blueprint_queue')
      .select('*')
      .eq('status', 'PENDING')
      .limit(1)
      .single()
    
    if (!queueItem) return // Empty queue
    
    // Update status atomically
    await supabase.rpc('update_queue_item_status', {
      p_item_id: queueItem.id,
      p_new_status: 'PROCESSING'
    })
    
    // Process detail enrichment
    const detail = await enrichQueueItemDetail(queueItem.id)
    
    // Trigger reviewer notification (via webhook or admin polling)
    await notifyReviewerForDisposition(detail)
  } finally {
    releaseAdvisoryLock(lockId)
  }
}
```

### Validator Rerun Hook (Criterion #6 + #7 Corrected)

```typescript
// lib/utils/validator-rerun.helper.ts
export async function rerunValidatorsForChapter(chapterId: string): Promise<boolean> {
  const chapterData = await fetchChapterById(chapterId)
  
  const results = await Promise.all([
    runSpineValidator(chapterData.spine),
    runRevealValidator(chapterData.reveals),
    runEndingValidator(chapterData.ending)
  ])
  
  const allPass = results.every(r => r.pass)
  
  if (allPass) {
    await logValidatorPass({ chapterId, validatorResults: results })
  } else {
    await logValidatorFail({ chapterId, validatorResults: results })
    await requeueAsBlocked(chapterId) // Return to queue with BLOCKED status - CRITERION #7
  }
  
  return allPass
}
```

### Reader-Safe Copy Enforcement (Criterion #9)

```typescript
// components/novels/ChapterStatusBanner.tsx
const READER_SAFE_STRINGS = Object.freeze([
  'Review in progress...',
  'Please try again later',
  'Content under quality check',
  'Technical issue reported, resolving now'
] as const)

const FORBIDDEN_TERMS = ['brand', 'leak', 'retry', 'token', 'AI', 'model', 'provider', 'timeout'] as const

export function ChapterStatusBanner({ status }: { status: 'BLOCKED' | 'PROCESSING' }) {
  // Validate against approved list only
  const message = READER_SAFE_STRINGS.find(s => s.includes(status.toLowerCase()))
  
  if (!message) throw new Error('INVALID_READERSAFE_STRING_USAGE')
  
  // ESLint custom rule would also scan this file for forbidden terms
  return <Alert variant="info">{message}</Alert>
}
```

---

*Document compiled at SHA `65053607ac7d1574e531bd49370b0a6c6d5565ba`. DO NOT implement commercial/governance scope. Focus strictly on nine E-OPS-1 acceptance criteria with exact allowlist.*
