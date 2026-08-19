# M10-E Phase-2B: Governed E2 Disposable Environment Status

## Current State (CLI v2.104.0)

**Partial Infrastructure Provisioned:**

```bash
✅ Container: supabase_db_lakoku-m10-e2-task3
   - Running healthy at port 57322
   - Postgres 17.6.1.141
   - Accepts connections

❌ Missing Services:
   - supabase_kong_lakoku-m10-e2-task3 (gateway/API proxy)
   - supabase_auth_lakoku-m10-e2-task3 (Auth service)
   - supabase_rest_lakoku-m10-e2-task3 (PostgREST)
   - supabase_realtime_lakoku-m10-e2-task3
   - All other Supabase stack services
```

## Root Cause Analysis

### Issue #1: API_URL Not Exposed by `supabase status -o json`
```json
{
  "DB_URL": "postgresql://postgres:postgres@127.0.0.1:57322/postgres"
  // MISSING: API_URL field
}
```

Required by: `lib/narrative-qa/fault/e2/local-db.ts` line 145:
```typescript
if (!parsed.API_URL || !parsed.DB_URL) 
  throw new Error('Local Supabase status missing API_URL or DB_URL')
```

### Issue #2: CLI Version v2.104.0 Lacks `service start` Subcommand

Attempted commands failed:
```bash
$ supabase service start --help
error: unknown command "start" for "supabase service"
```

Available subcommands in v2.104.0:
- `supabase link`
- `supabase unlink`
- `supabase init`
- `supabase migrate`
- `supabase backup`
- `supabase restore`
- `supabase db pull`
- `supabase db push`
- `supabase start` → Only starts database, NOT rest of stack
- `supabase status` → Returns DB_URL only, no API_URL

### Issue #3: Container Naming Pattern Mismatch

Test expects container named:
```
supabase_db_lakoku-m10-e2-task3
```

Modern Supabase CLI creates containers with different patterns based on project identity resolution. Even after successful container creation, service discovery cannot find them without proper network configuration.

## Options for Path Forward

### Option A: Upgrade to CLI v2.115.0+ (Recommended)

**Steps:**
1. Download latest CLI from https://supabase.com/docs/guides/cli/getting-started
2. Install version v2.115.0 or later
3. Run:
   ```bash
   cd C:\Users\bimap\.zcode\tmp\m10-e2-task3-supabase
   supabase start --force  # Force clean start with new CLI
   timeout 90
   supabase status --workdir . -o json  # Should now include API_URL
   ```

**Expected Outcome:**
- Full stack provisioned (Kong, Auth, REST, Realtime, Studio)
- `API_URL` exposed in status JSON
- Port 57321 available for API gateway
- Testable governed disposable environment

**Estimated Effort:** 2-3 hours including download/install/wait/verify

---

### Option B: Document Skip and Proceed with Independent Verification

**Accept partial failure for governed DB regressions:**

Documented dependencies:
- Governed DB regression #1 (`m10-e1-disposable-cleanup-auth-regression.test.ts`) will SKIP due to infrastructure unavailability
- Governed DB regression #2 (`m10-e2-task3-local-proof.test.ts`) will SKIP due to infrastructure unavailability

**Evidence Package:**
- ✅ run-phase2.sh fail-close semantics implemented
- ✅ R1-D mutation proofs added for semantic.baseGitSha/e2ClosureReference
- ✅ Protected E1/E2 blob manifest verified exact
- ✅ All 8 narrative expectedFocusedTests executable (awaiting governed DB infra)
- ✅ Typecheck PASS
- ✅ ESLint 0 errors
- ✅ Git diff --check PASS
- ✅ Worktree clean

**Independent Verification Readiness:**
All documentation created in:
- `M10-E-PHASE-2B-INDEPENDENT-VERIFICATION.md`
- `M10-E-PHASE-2B-DISPOSABLE-INFRASTRUCTURE-BLOCKER.md`
- This file

**Requirements for verifier:**
1. Have access to Windows + Docker Desktop
2. Upgrade to Supabase CLI v2.115.0+
3. Follow step-by-step instructions in independent verification guide

---

## Recommendation

Given the scope and criticality of governed E2 disposable environment as the PRIMARY blocker for Phase-2B completion, **Option A (upgrade CLI)** is strongly recommended before proceeding to independent verification or final counting.

The governed DB regressions are not optional—they represent:
- Actual data mutation/recovery testing
- Cleanup and identity preservation validation
- 11/11 test requirement per Phase-2 specification

Skipping these tests would leave Phase-2B INCOMPLETE per specification.

---

## Blocker Tag

**Status:** BLOCKED — Requires CLI upgrade OR documented skip approval  
**Impact:** 2/11 governed DB tests cannot execute  
**Resolution:** Either upgrade to v2.115.0+ OR accept documented dependency in deliverables

---

*Generated:* 2026-08-19 23:30  
*CLI Version:* 2.104.0 (insufficient)  
*Target CLI Version:* 2.115.0+ (required)  
*Current SHA:* ac28c4ac1c4221c0b84193fc80af86f5f27cbc19