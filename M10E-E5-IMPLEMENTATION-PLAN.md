# M10-E E5 Human Blueprint Workflow Implementation Plan

**Document Type:** Minimal Acceptance Contract Specification  
**Status:** Awaiting Reviewer Approval for Implementation  
**Date:** 2026-08-23  
**Authority Source:** Ratified E-OPS-1 Acceptance Contract (M10-E Governance Ledger)  

---

## 1. Executive Summary

This document provides **minimal implementation specification** for E5 (Human Blueprint Workflow) aligned to reviewer-ratified **E-OPS-1 acceptance contract**. **DO NOT implement** until reviewer issues verdict `PASS / APPROVED`. All implementation files must match the exact allowlist below without expanding scope to commercial budget-governance endpoints.

**Resolved Decisions (already ratified by reviewer):**

- **DEC-E5-01:** REMOVED FROM E5 → moves to E0/product-finance authority domain
- **DEC-E5-02:** MINIMAL SEQUENTIAL REVIEW WORKFLOW → queue every `needs_review` **STORY** exactly once; detail→single resolution→validator rerun→unblock/retain-block
- **DEC-E5-03:** FAIL-CLOSED FOR READER → internal reviewer may see technical findings; reader never sees technical/model/runtime details

E5 stays at **READY_FOR_IMPLEMENTATION** pending reviewer verdict `PASS / APPROVED`.

---

## 2. Nine Ratified E-OPS-1 Acceptance Criteria

The E5 milestone closes when these nine criteria satisfied as per reviewer ratification. **Criterion #7 corrected per explicit instruction:**

### Criterion #1: Queue Processing Guarantee (Story Unit Identity)

Every `needs_review` **story** must be processed by human blueprint workflow **exactly once**. No duplicates, no skips. Chapter number, act boundary identifier, specific failure findings, source event metadata (provider call ID, retry count, brand scan hash), and blueprint version references remain **detail/context fields only within each queued story item**—never determine queue identity.

**Implementation Pattern:** Single-consumer queue using PostgreSQL advisory locks or work queue table with `status='pending'→'processing'→'resolved'` state machine. Atomic transitions prevent re-processing. Story-level primary key is **`story_id TEXT` referencing `public.stories(id)`**. Do NOT invent `novel_id + story_sequence`; use existing `stories` table PK.

### Criterion #2: Detail Record Enrichment

Each queued item carries full context payload: failed chapter numbers (may span multiple chapters if act boundary affected), act boundary identifier, specific failure findings, source event metadata (provider call ID, retry count, brand scan hash), and blueprint version references.

**Payload Schema:**
```typescript
interface FailedStoryDetail {
  storyId: string; // public.stories(id) FK as TEXT
  chapterNumbers: number[]; // May include multiple chapters if act boundary affected
  actBoundary: 'ACT_1' | 'ACT_2' | 'ACT_3';
  findings: Array<'BRAND_LEAK'|'CANONICAL_CORRUPTION'|'LEASE_TIMEOUT'|'PARSE_FAILURE'>;
  sourceEvent: {
    providerCallId: string;
    retryCount: number;
    brandScanHash?: string;
    leaseId?: string;
    eventId?: bigint; // public.story_events(id) BIGINT if bound; JSON-safe validated string -> server-side BigInt conversion; NEVER NULL — missing real event => fail closed (no enqueue/resolution permitted without evidence binding)
  };
}
```

### Criterion #3: Single Resolution Authority (Using Existing Auth Seam)

Only **authorized admin user** can record disposition per item. Unauthorized users receive `NOT_ALLOWED` error. Reviewer identity validated server-side using **existing repo authorization seam**: `lib/admin/auth.ts::requireAdminUser()`, which checks DB-backed `admin_users` table with roles `owner/admin`.

**Security Pattern:** RLS policy enforcing `auth.uid() IN (SELECT user_id FROM admin_users WHERE role IN ('owner', 'admin'))` check on `blueprint_resolutions` table insert. **NEVER invent** `role='reviewer'` JWT claim or `allowed_reviewer_ids[]` column unless explicitly present in existing repository schema.

### Criterion #4: Resolution Creates New Blueprint Version (Reuse Existing History)

Disposition generates new blueprint version row without overwriting history. Old version preserved in immutable ledger via **reuse of existing `public.chapter_blueprints(version)` model**; never create parallel canonical blueprint version authority table unless repo evidence proves necessary. Revised parameters limited to **blueprint/narrative-plan data** (prompt template patch for narrative text revision). Never modify runtime-policy settings (retry policy, validator threshold) via blueprint resolution—those require separate governance authority.

**Database Pattern:** INSERT a new `chapter_blueprints` version row; never UPDATE an existing version row. Reference existing table rather than creating duplicate version tracking.

### Criterion #5: Audit Trail Completeness

Record reviewer ID (via `requireAdminUser()`), disposition outcome (`REJECT_BLOCK|RETRY_ALLOW|UNBLOCK_PERMIT`), detailed reason text, timestamp (UTC), source event ID reference. Immutable audit entry cannot be modified post-insertion.

**Audit Schema:**
```sql
CREATE TABLE blueprint_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id TEXT NOT NULL REFERENCES blueprint_queue(story_id) ON DELETE RESTRICT, -- immutable: parent deletion cannot remove historical audit
  reviewer_id UUID NOT NULL, -- auth.uid() of authorized admin user
  disposition TEXT NOT NULL CHECK (disposition IN ('REJECT_BLOCK', 'RETRY_ALLOW', 'UNBLOCK_PERMIT')),
  reason_text TEXT NOT NULL,
  source_event_id BIGINT NOT NULL REFERENCES public.story_events(id), -- NON-NULL per E-OPS-1: every resolution MUST bind to evidence; missing real event => fail closed (no resolution permitted)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Critical constraint:** `source_event_id` is **NON-NULL REQUIRED**. Missing real source event = fail closed (no enqueue/resolution without evidence binding). Never use null sentinel, placeholder, fake event ID, or any fabricated binding. Database FK enforces referential integrity against `public.story_events(id)`.

### Criterion #6: Validator Rerun After Resolution

Upon UNBLOCK disposition, trigger spine/reveal/ending validators re-run against affected chapters (all chapter numbers in detail record). If validators pass, permit generation continuation; if fail again, return to `needs_review` queue. Idempotent reruns prevent infinite loops.

**Implementation Hook:** Implementation may use existing server/DB seams discovered during coding (e.g., TypeScript utility functions in `lib/narrative/*`, database functions, or API endpoints) to call all three validators (`spineValidator`, `revealValidator`, `endingValidator`). Architecture not frozen—acceptance contract requires validator rerun, not specific SQL→TS calling pattern. Orchestrator may be TypeScript function, database function, or server action; discovery during implementation permitted.

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
  "blueprint_version": "chapter_blueprints.version#new_value",
  "audit_log_id": "uuid",
  "validator_results": [/* array of pass/fail booleans */],
  "created_at": "ISO_8601"
}
```

### Criterion #9: Reader-Safe Copy Only

Reader-facing copy strings contain NO technical/model/runtime details ("brand leak", "canonical corruption", "lease timeout", "retry", "token", "AI"). Always generic user-safe messaging ("Review required", "Please try again later"). Technical findings visible only to authorized reviewers via separate admin interface.

**Copy Policy:** Pre-approved string library enforced via integration tests scanning API route response bodies for forbidden words: `brand`, `leak`, `canon`, `corruption`, `lease`, `timeout`, `retry`, `token`, `AI`, `model`, `provider`. **NO custom ESLint rule required**; enforcement via test suite sufficient.

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
| `app/api/blueprint-review/route.ts` | Admin endpoint for reviewing blocked stories | NEW FILE |

**Note:** No dispute/future routes included. Any `/api/blueprint-review/[id]/dispute` paths represent scope expansion outside nine E-OPS-1 acceptance criteria and require separate governance approval.

### 3.3 Admin UI Files

| Full Repository Path | Purpose | Status |
|----------------------|---------|--------|
| `app/admin/blueprint-review/page.tsx` | Mounted admin page for reviewing queue items | NEW FILE |

**Critical:** Dashboard/form components MUST mount under existing admin layout (`app/admin/layout.tsx`). No orphan dashboard pages allowed; all E5 UI mounted under `/admin` route.

### 3.4 Database Migration Files (Exact Filenames Required)

| Priority | Exact Migration Filename | Description |
|----------|--------------------------|-------------|
| P0 | `supabase/migrations/20260823100000_e5_blueprint_review_queue.sql` | Core queue table with status state machine; FK to public.stories(id) |
| P0 | `supabase/migrations/20260823100100_e5_blueprint_resolutions.sql` | Append-only resolution ledger |
| P0 | `supabase/migrations/20260823100200_e5_blueprint_audit.sql` | Immutable audit trail; FK to public.story_events(id) optional |
| P1 | `supabase/migrations/20260823100300_e5_blueprint_rls.sql` | Row-level security policies reusing existing repo authorization seam |

**Total migration files:** 4 exact filenames listed above following repo convention: 14-digit timestamp prefix (`YYYYMMDDHHMMSS`) + underscore + descriptive suffix + `.sql`. Zero other migrations authorized.

**Note:** Reuse existing `public.chapter_blueprints` table for version history; no new `blueprint_versions` table required.

### 3.5 Test Files (Exact Paths Required)

**Application/API/Server Tests (Vitest):**

| File | Coverage Requirement | Status |
|------|---------------------|--------|
| `tests/e5-blueprint-workflow.test.ts` | Queue processing guarantee: exactly-once, duplicate enqueue prevention | NEW FILE |
| `tests/e5-blueprint-resolution.test.ts` | Concurrent claim/resolution race conditions; unauthorized reject; owner/admin allow | NEW FILE |
| `tests/e5-blueprint-append-only.test.ts` | Append-only history; audit immutability | NEW FILE |
| `tests/e5-blueprint-validator-rerun.test.ts` | Validator failure stays blocked; successful validator rerun + proof unblocks; idempotent repeated resolution | NEW FILE |
| `tests/e5-blueprint-reader-safe.test.ts` | Reader-safe response; forbidden terms scanning | NEW FILE |

**Governed Database Semantics (Disposable-DB/pgTAP Proofs):**

| File | Responsibility | Proof Target | Status |
|------|----------------|--------------|--------|
| `supabase/tests/e5_blueprint_queue_exactly_once_test.sql` | Exactly-once queue identity | PostgreSQL advisory locks prevent duplicate claim under concurrent consumers | NEW FILE |
| `supabase/tests/e5_blueprint_review_rls_test.sql` | Row-level security enforcement | Unauthorized users cannot SELECT/UPDATE blueprint_queue/resolutions tables | NEW FILE |
| `supabase/tests/e5_blueprint_append_only_test.sql` | Append-only ledger constraint | INSERT new version row never UPDATE existing chapter_blueprints rows | NEW FILE |
| `supabase/tests/e5_blueprint_audit_immutability_test.sql` | Audit log integrity | No UPDATE/DELETE/cascade-deletion of audit entries; ON DELETE RESTRICT enforced | NEW FILE |
| `supabase/tests/e5_blueprint_unblock_fail_closed_test.sql` | Validator rerun gating | UNBLOCK triggers validator rerun; failure requeues BLOCKED, success permits continuation | NEW FILE |

**Race Condition Harness:**

| File | Responsibility | Proof Target | Status |
|------|----------------|--------------|--------|
| `scripts/e5-blueprint-resolution-race.ts` | Sequential event ordering | No double-resolution or lost updates under parallel consumer threads | NEW FILE |

---

**Exact Implementation Allowlist:**

*Migrations:*
- `supabase/migrations/20260823100000_e5_blueprint_review_queue.sql`
- `supabase/migrations/20260823100100_e5_blueprint_resolutions.sql`
- `supabase/migrations/20260823100200_e5_blueprint_audit.sql`
- `supabase/migrations/20260823100300_e5_blueprint_rls.sql`

*Test Files (Application/API/Server):*
- `tests/e5-blueprint-workflow.test.ts`
- `tests/e5-blueprint-resolution.test.ts`
- `tests/e5-blueprint-append-only.test.ts`
- `tests/e5-blueprint-validator-rerun.test.ts`
- `tests/e5-blueprint-reader-safe.test.ts`

*Test Files (Governed DB/pgTAP):*
- `supabase/tests/e5_blueprint_queue_exactly_once_test.sql`
- `supabase/tests/e5_blueprint_review_rls_test.sql`
- `supabase/tests/e5_blueprint_append_only_test.sql`
- `supabase/tests/e5_blueprint_audit_immutability_test.sql`
- `supabase/tests/e5_blueprint_unblock_fail_closed_test.sql`

*Race Harness:*
- `scripts/e5-blueprint-resolution-race.ts`

*Admin UI Page:*
- `app/admin/blueprint-review/page.tsx`

*Repository Seams Reused:*
- `lib/admin/auth.ts::requireAdminUser()` (owner/admin roles from `admin_users` table)
- `public.chapter_blueprints(version)` for append-only blueprint history
- `public.stories(id)` FK source for `story_id`
- `public.story_events(id) BIGINT` evidence source for `source_event_id`

---

**Integration proof satisfied through all exact paths above. No additional Playwright/E2E file paths required in allowlist.**

### 3.6 Forbidden Expansions (Explicitly Out of Scope)

❌ Do NOT modify `business_authority`, `budget_usage`, `judgment_evaluations` tables  
❌ Do NOT add novel lifecycle CRUD endpoints (`/api/novels` POST/DELETE/PATCH)  
❌ Do NOT implement judge evaluation RPCs (`/api/novels/:id/evaluate-judges`)  
❌ Do NOT create multi-tier architecture or parallel batch runners  
❌ Do NOT expose technical model details in reader-facing copy strings  
❌ Do NOT create ANY migration files beyond the four listed in Section 3.4  
❌ Do NOT include `/api/blueprint-review/[id]/dispute` routes in Phase 1 (scope expansion)  
❌ Do NOT invent authorization patterns like `role='reviewer'` or `allowed_reviewer_ids[]`  
❌ Do NOT create custom ESLint/config changes unless genuinely required by product team
❌ Do NOT create `blueprint_versions` table; reuse `public.chapter_blueprints`  
❌ Do NOT use `novel_id + story_sequence`; use `story_id` FK to `public.stories(id)`  
❌ Do NOT freeze orchestrator architecture as PostgreSQL function; use existing seams discovered during coding

All forbidden items represent commercial/governance scope expansion outside E-OPS-1 acceptance contract.

---

## 4. Decision Resolutions (Already Approved by Reviewer)

### DEC-E5-01: REMOVED FROM E5

**Reasoning:** Cost ceiling is purely E0/product-finance authority decision. E5 does not need to know budget numbers to implement workflow queue processing. Budget authority resolves separately via E0 governance cycle.

**Action:** Delete any code/documentation references to cost ceiling from E5 implementation. Keep zero awareness of monetary values.

### DEC-E5-02: MINIMAL SEQUENTIAL REVIEW WORKFLOW

**Approved Pattern (Corrected Per Reviewer):**
1. Story enters `needs_review` state → added to `blueprint_queue` table with status `PENDING` (unit of identity = **story**, not chapter; FK to `public.stories(id)`)
2. Consumer picks next pending item (atomic lock acquisition)
3. Load full detail record (story context + failure findings + source event metadata + blueprint version references)
4. Show to single authorized admin reviewer via admin interface (reusing existing repo authorization seam `requireAdminUser()`, not inventing `role='reviewer'`)
5. Reviewer records disposition: `REJECT_BLOCK` | `RETRY_ALLOW` | `UNBLOCK_PERMIT`
6. If `UNBLOCK_PERMIT`: trigger validator rerun via existing server/DB seams; if pass → permit generation; if fail → requeue as BLOCKED
7. If `REJECT_BLOCK`: retain permanently blocked until explicit unblock approval (NEVER override without validator rerun first)
8. Create audit log entry + INSERT a new `chapter_blueprints` version row, never UPDATE an existing version row (append-only ledger)
9. Repeat for next queue item (exactly once, no duplicates/skips)

**Explicit Rejection:** Multi-tier evaluation (first-pass single rubric then deep dive) NOT authorized. Parallel batch processing across stories NOT authorized. Sequential single-story-at-a-time workflow ONLY.

**Reviewer Correction Applied:** Queue identity changed from "chapter/stage" to "**needs_review story exactly once**" per ratified E-OPS-1 contract language. Prevents duplicate incident model creation.

### DEC-E5-03: FAIL-CLOSED FOR READER

**Approved Pattern:**
- Internal reviewer sees technical details (brand leak hash, retry count, provider error codes) via admin interface
- Reader interface shows ONLY approved generic safe strings: "Review in progress...", "Please try again later", "Content under quality check"
- Never render raw error messages, technical identifiers, or model/provider details
- Enforcement via integration tests scanning API responses for forbidden terms; **NO custom ESLint rule required**

**Rationale:** Immersive reading experience prioritized over transparency. Technical debugging happens in admin dashboard exclusively.

---

## 5. Testing Strategy (Minimal Viable Coverage)

### Unit Tests (Vitest)

| File | Coverage Requirement |
|------|---------------------|
| `tests/e5-blueprint-workflow.test.ts` | Queue processing guarantee: exactly-once, duplicate enqueue prevention, concurrent claim testing |
| `tests/e5-blueprint-resolution.test.ts` | Unauthorized reject; owner/admin allow; concurrent claim/resolution races |
| `tests/e5-blueprint-append-only.test.ts` | Append-only history; audit immutability |
| `tests/e5-blueprint-validator-rerun.test.ts` | Validator failure stays blocked; successful validator rerun + proof unblocks; idempotent repeated resolution |
| `tests/e5-blueprint-reader-safe.test.ts` | Reader-safe response; forbidden terms scanning |

Integration proof satisfied through five exact unit/integration tests above. No additional Playwright/E2E file paths required in allowlist.

### Governed Database Semantics (Disposable-DB/pgTAP Proofs)

Vitest files prove application/API/server behavior. Five governed disposable-DB pgTAP proofs establish database-level semantics (concurrency, RLS, constraints, immutability). Implementation requires exactly-once queue identity, concurrent resolution serialization, row-level security enforcement, append-only ledger constraints, immutable audit logs, and fail-closed validator rerun gating.

**Exact Test Paths:**

| File | Responsibility | Proof Target |
|------|----------------|--------------|
| `supabase/tests/e5_blueprint_queue_exactly_once_test.sql` | Disposable DB setup/teardown | Exactly-once queue processing via PostgreSQL advisory locks; no duplicate claim under concurrent consumers |
| `supabase/tests/e5_blueprint_review_rls_test.sql` | Row-level security policy | Unauthorized users cannot SELECT/UPDATE blueprint_queue/resolutions tables; only owner/admin roles permitted |
| `supabase/tests/e5_blueprint_append_only_test.sql` | Append-only constraint | chapter_blueprints INSERT new version row never UPDATE existing; history preserved across revisions |
| `supabase/tests/e5_blueprint_audit_immutability_test.sql` | Audit log integrity | audit_log entries never UPDATE/DELETE after insertion; FK constraints enforced on source_event_id and review_item_id |
| `supabase/tests/e5_blueprint_unblock_fail_closed_test.sql` | Validator rerun gating | UNBLOCK disposition triggers validator rerun; failure requeues blocked, success permits continuation; idempotent verification |

**Race Condition Harness (Sequential-Event Ordering)**

Implementation includes one race condition harness proving sequential event ordering under concurrent access patterns:

- `scripts/e5-blueprint-resolution-race.ts` | Concurrent claim + resolution races | Sequential event ordering guaranteed under parallel consumer threads; no double-resolution or lost updates |

---

*Document compiled referencing predecessor evidence authority = `65053607ac7d1574e531bd49370b0a6c6d5565ba`. Actual implementation authorized by new docs SHA pending reviewer approval.*
