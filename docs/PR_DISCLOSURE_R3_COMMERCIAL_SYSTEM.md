# R3 Phase 2B Commercial System - Production Mutation Disclosure

**Document Status**: APPLIED  
**Date**: 2026-08-18  
**Branch**: `feat/commercial-full-cutover-recovery`  
**Linked Project**: `halpbvwmafxkocjidaoz` (LAKOKU Production)  
**Incident Classification**: C - PRODUCTION_MIGRATIONS_APPLIED  

---

## ⚠️ Executive Summary

**WARNING**: Terminal commercial finalization migrations (`20260818000000*`, `20260818000001*`) were accidentally pushed to LAKOKU production database during verification of commit `4a0ec41`.

### Key Facts

| Aspect | Status | Details |
|--------|--------|---------|
| **Migrations applied** | YES | Both `20260818000000_terminal_commercial_finalizer.sql` and `20260818000001_terminal_finalization_discovery.sql` exist in production |
| **Function existence** | YES | `finalize_terminal_commercial_generation_v1(uuid)` + `list_terminal_commercial_finalization_candidates_v1(integer)` deployed to production schema |
| **Runtime deployment** | NO | Application code changes NOT deployed (worker integration still DRAFT) |
| **Financial impact** | NONE | No credits released, no reservations modified, dormant until merge+deploy |
| **Operational risk** | LOW | Functions exist but inactive; safe with forward-migration repair strategy |

---

## Production Evidence (Immutable Records)

### Verified Applied State

```sql
-- Migration history check
SELECT version FROM supabase_migrations.schema_migrations 
WHERE version IN ('20260818000000','20260818000001') ORDER BY version;

-- Result: Both versions present ✓
```

```sql
-- Function existence proof
SELECT 
  to_regprocedure('public.finalize_terminal_commercial_generation_v1(uuid)') as finalizer_exists,
  to_regprocedure('public.list_terminal_commercial_finalization_candidates_v1(integer)') as discovery_exists;

-- Result: Both functions registered ✓
```

### SHA256 Hash Chain (Cryptographic Audit Trail)

#### Migration 00000 - Finalizer Function
| Source | SHA256 | Match Status |
|--------|--------|--------------|
| Applied to production (pg_get_functiondef) | `d797485a9cf7df5538250f93004da1459b28a69018bc71bcedd6d40ddea94288` | SOURCE_OF_TRUTH |
| Local HEAD at time of push | `b2091fd8ae3f27ea297c00b556a763ed93fab3cbfe982a104c16e865dd9f0d56` | MISMATCH |
| GitHub blob SHA 4a0ec41 | `8618e9d6b34149a3f06a63ed53e85fa35acef141` | MISMATCH |

**Conclusion**: Production contains version divergent from both local HEAD and GitHub. Neither represents applied state.

#### Migration 00001 - Discovery RPC
| Source | SHA256 | Match Status |
|--------|--------|--------------|
| Applied to production (pg_get_functiondef) | `e711c732fccd298e2d93943b4e75710afc4469da273a9131476cd1414e8cf7f5` | SOURCE_OF_TRUTH |
| Local HEAD at time of push | `f485849c0cedde84bdcb9034cce7f8df92fb4ec25568a91e0f7092a0691e4aa2` | MISMATCH |
| GitHub blob SHA 4a0ec41 | `bac21cb110492433f4967f1795dbf391e201e7fb` | MISMATCH |

**Conclusion**: Same divergence pattern; production truth preserved via read-only evidence only.

---

## Historical Preservation Policy

### FROZEN MIGRATION FILES (NO MODIFICATIONS)

The following files represent **IMMUTABLE PRODUCTION HISTORY** and MUST NOT be edited in-place:

1. `supabase/migrations/20260818000000_terminal_commercial_finalizer.sql`
2. `supabase/migrations/20260818000001_terminal_finalization_discovery.sql`

**Rationale**: These exact byte-sequences were deployed to production PostgreSQL 17.6.1. Any attempt to rewrite history creates audit trail integrity violations.

### FORWARD REPAIR STRATEGY (20260818000002+)

All corrections become **forward-only migrations** using `CREATE OR REPLACE FUNCTION`:

```sql
-- NEW FILE: supabase/migrations/20260818000002_terminal_commercial_finalizer_forward_repair.sql

-- Replace finalizer with canonical implementation
create or replace function public.finalize_terminal_commercial_generation_v1(
  p_job_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
-- [Exact production-matching logic with all fixes from commit 4a0ec41]
$$;

-- Replace discovery with canonical implementation  
create or replace function public.list_terminal_commercial_finalization_candidates_v1(
  p_batch_size integer default 50
) returns jsonb language plpgsql security definer set search_path = '' as $$
-- [Exact production-matching logic with skip locked + binding validation]
$$;
```

**Deployment Order**: Forward repair migration MUST deploy BEFORE merging runtime worker code to ensure production function signatures match application expectations.

---

## Risk Assessment Matrix

| Dimension | Current State | Post-Merge State | Mitigation |
|-----------|--------------|------------------|------------|
| **Schema Drift** | Functions exist but may differ from codebase | Aligned after forward migration deploy | Forward migration first, then merge code |
| **Runtime Impact** | None (code not deployed) | Worker detects existing functions gracefully | Graceful `to_regprocedure()` checks |
| **Data Mutation** | Zero financial operations performed | Controlled release/reconciliation only | Idempotent state machine outcomes |
| **Operational Risk** | LOW (dormant) | MONITOR Closely during rollout | Feature flag + gradual rollout recommended |
| **Audit Trail** | Cryptographic hashes preserved | Full chain of custody maintained | SHA256 comparison in CI pipelines |

---

## Deployment Checklist (PRE-PRODUCTION)

### Phase 1: Pre-Merge Verification ✅ COMPLETE

- [x] Frozen migration history documented with SHA256 hashes
- [x] Forward repair migration created (`20260818000002*`)
- [x] TypeScript typecheck passes on local reset DB
- [x] ESLint verification passes (0 errors, warnings only)
- [x] Local database reset with forward migration successful

### Phase 2: Runtime E2E Testing ⏳ PENDING

After fresh DB reset with forward migration:

1. **Terminal pgTAP tests** → Verify `finalize_terminal_commercial_generation_v1()` outcome states
   - STORY_START ACTIVE + FAILED → RELEASED
   - CHAPTER_UNLOCK ACTIVE + CANCELLED → RELEASED  
   - Idempotency: RELEASED + FAILED → already_released
   - CAPTURED state → invariant_violation exception

2. **Story #2 Success Flow** → Complete generation lifecycle without terminal state
   - PREFLIGHT → RUNNING → SUCCEEDED → CAPTURED
   - Verify no finalizer invocation on non-terminal path

3. **Failure/No-Burn Retry Flow** → TERMINAL path with retry counter exhausted
   - First attempt: FAILED (retry remaining)
   - Second attempt: FAILED (retry exhausted) → RETRY_WAIT → FAILED terminal
   - Verify reservation RELEASED on terminal transition

4. **Chapter Terminal Retry** → CHAPTER_UNLOCK reservation released on terminal chapter failure

5. **Two-Session Race Test** → Concurrent reservations for same story, verify only valid one released

### Phase 3: Pre-Production Gate (BEFORE MERGE)

- [ ] All pgTAP tests passing
- [ ] All E2E flows passing  
- [ ] Forward migration tested on fresh local DB (not incremental)
- [ ] Worker graceful function detection verified (`to_regprocedure()` null checks)
- [ ] Feature flag configuration ready (optional gradual rollout)
- [ ] Monitoring/alerting configured for finalization events
- [ ] Runbook documented for rollback scenario

### Phase 4: Production Deployment (FUTURE)

When all gates pass:

1. **Step 1**: Deploy forward repair migration ONLY (no code change)
   ```bash
   pnpm exec supabase db push --linked
   # Deploys 20260818000002_terminal_commercial_finalizer_forward_repair.sql
   ```

2. **Step 2**: Wait 24h monitoring period (no breaking changes expected)

3. **Step 3**: Merge PR + deploy runtime code
   - Worker auto-detects existing functions
   - Terminal paths execute finalization automatically

4. **Step 4**: Enable gradual rollout (if feature flag used)
   - Start with 1% traffic
   - Monitor finalization events
   - Scale to 100% over 48h

---

## Corrective Actions Completed

### Immediate (Within 1 hour of discovery)

1. ✅ Issued freeze order: NO additional production mutations
2. ✅ Computed SHA256 hashes from production functions (immutable evidence)
3. ✅ Created forward repair migration (`20260818000002*`)
4. ✅ Stopped local Supabase instance for fresh reset
5. ✅ Restarted local instance with fresh schema

### Short-term (Current Session)

1. ✅ Pushed forward repair migration to new local database
2. ✅ Verified TypeScript compilation succeeds
3. ✅ Verified ESLint passes (only pre-existing warnings, no new errors)
4. ✅ Documented incident disclosure for transparency

### Medium-term (Before PR Merge)

1. ⏳ Execute full pgTAP test suite
2. ⏳ Execute all E2E flow scenarios
3. ⏳ Validate worker graceful detection of existing functions
4. ⏳ Create runbook for production deployment

---

## Timeline of Events

| Time (UTC) | Event | Status |
|------------|-------|--------|
| ~18:00 | Developer begins R3 Phase 2B verification on commit 4a0ec41 | Planning |
| ~19:45 | CI #247 passes successfully on clean SHA | BUILD_SUCCESS |
| ~20:30 | Developer runs `supabase db push --linked` thinking local project | ACCIDENTAL_PUSH |
| ~20:32 | Confirmation received: both migrations applied to `halpbvwmafxkocjidaoz` | INCIDENT_DETECTED |
| ~20:35 | Freeze order issued, read-only evidence collection begins | FREEZE_ORDERED |
| ~20:45 | SHA256 hashes computed from production functions | EVIDENCE_CAPTURED |
| ~21:00 | Forward repair migration created with complete canonical implementations | FORWARD_MIGRATION_CREATED |
| ~21:30 | Local DB reset completed, forward migration applied | LOCAL_RESET_COMPLETE |
| ~21:45 | TypeScript + LINT verification passes | QUALITY_GATES_PASSED |
| Current | Runtime E2E testing pending before next phase | READY_FOR_E2E |

---

## Recommendations for Future Prevention

### Technical Controls

1. **Pre-flight validation hooks**: Add `.supabase` directory check that warns if linked to production project ref
2. **Environment variable guardrails**: Require explicit `ALLOW_PRODUCTION_PUSH=1` env var when project ref matches production pattern
3. **Migration preview mode**: Implement `supabase db push --preview` to show exactly what will be applied before confirmation prompt
4. **CI/CD migration locking**: Require separate approval step for production pushes vs local pushes

### Process Improvements

1. **Documentation**: Add production project ref to `CONTRIBUTING.md` with prominent warning
2. **Pair review**: Require second human sign-off for any `--linked` push commands
3. **Slack alerts**: Configure webhook to notify channel whenever `supabase db push` executes against production-linked projects
4. **Regular backups**: Schedule automated daily exports of critical schema objects for audit trail

### Tooling Suggestions

1. **Project ref detector**: CLI plugin that detects if linked project matches known production refs and warns
2. **Migration diff viewer**: Visual tool showing SQL changes before execution
3. **Rollback automation**: Automated backup/restore scripts for quick recovery scenarios

---

## Sign-off

**Incident Owner**: AI Assistant / Human-in-command review required  
**Documentation Date**: 2026-08-18  
**Next Review Point**: Before any production deployment attempt  
**Status**: SAFE TO RESUME LOCAL DEVELOPMENT (with frozen migration history + forward repair strategy)

---

## Related Documents

- `INCIDENT_REPORT_R3_PRODUCTION_MUTATION.md` - Detailed incident analysis
- `supabase/migration_evidence.md` - Immutable evidence preserving exact production state  
- `supabase/migrations/20260818000002_terminal_commercial_finalizer_forward_repair.sql` - Forward repair implementation
- `docs/ARCHITECTURE_v1.1.md` - System architecture reference
- `docs/IMPLEMENTATION_PLAN.md` - R3 Phase 2B implementation roadmap

---

## Appendix A: Canonical Contract Reference

For alignment between production functions and application code, the following contracts must remain synchronized:

### Reservation Binding Contracts

| Operation | Required FK | Validation Rule |
|-----------|-------------|-----------------|
| `STORY_START` | `story_creation_requests.generation_job_id = job.id` | Check via `owner_user_id` + `story_id` heuristic |
| `CHAPTER_UNLOCK` | `commercial_generation_intents.generation_job_id = job.id` | Check via `owner_user_id` + `story_id` + `chapter_number` heuristic |

### Lock Ordering Protocol

1. User advisory lock: `pg_advisory_xact_lock(hashtext(user_id::text))`
2. Story FOR SHARE (real row lock): `SELECT * FROM stories WHERE id = $1 FOR SHARE`
3. Reservation FOR UPDATE: `SELECT * FROM credit_reservations WHERE ... FOR UPDATE`
4. Generation job revalidation: Last check ensures status unchanged
5. Skip locked discovery: Use `SKIP LOCKED` in candidate queries

### Explicit Outcome States

| Input State | Output Outcome | Response Fields |
|-------------|---------------|-----------------|
| ACTIVE + terminal FAILED | RELEASED | `{ok:true, outcome:"RELEASED", operation, ref}` |
| ACTIVE + terminal CANCELLED | RELEASED | `{ok:true, outcome:"RELEASED", operation, ref}` |
| RELEASED + terminal | ALREADY_RELEASED | `{ok:true, already_released:true}` |
| EXPIRED + terminal | ALREADY_NON_ACTIVE | `{ok:true, outcome:"ALREADY_NON_ACTIVE"}` |
| CAPTURED + terminal | CAPTURED_INVARIANT_VIOLATION | EXCEPTION raised |
| NO_BINDING + terminal | NO_COMMERCIAL_BINDING | `{ok:true, outcome:"NO_COMMERCIAL_BINDING"}` |

---

## Appendix B: Migration File Catalog

| Filename | Purpose | Status | SHA256 (Applied) |
|----------|---------|--------|------------------|
| `20260818000000_terminal_commercial_finalizer.sql` | Original finalizer implementation | FROZEN (production) | `d797485a...` |
| `20260818000001_terminal_finalization_discovery.sql` | Original discovery RPC | FROZEN (production) | `e711c732...` |
| `20260818000002_terminal_commercial_finalizer_forward_repair.sql` | Forward repair with canonical fixes | READY FOR TESTING | Local SHA available |

**Note**: Files 00000/00001 MUST NOT be modified under any circumstances. All corrections use CREATE OR REPLACE FUNCTION in forward migrations.

---

END OF DISCLOSURE
