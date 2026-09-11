# M10-F Pilot Preflight Package

**Document Type:** Single Isolated Non-Production Engineering Pilot Specification  
**Status:** M10-E CLOSED (2026-08-26, ledger Entry 13); M10-F STAGED_DRY_RUN — execution requires separate authorization  
**Date:** 2026-08-23 (closure update 2026-08-26)  
**Authority Constraint:** NO real model calls permitted until M10-F execution is separately authorized; M10-E CLOSED and E5 workflow complete as of 2026-08-26  
**Predecessor Evidence SHA:** `65053607ac7d1574e531bd49370b0a6c6d5565ba` (E3A/E4)  
**Execution SHA:** Closure batch child of `0037c950e039410d54c03d16663e3d73862dada4` (M10-E closure commit, ledger Entry 13)  
**Mandatory watchpoint:** observed chapter mean `2.05000000` exceeded approved ceiling `2.04001674` at E0 evaluation — must be re-checked during pilot evidence review    

---

## 1. Executive Summary

M10-F represents **initial isolated non-production engineering pilot** where reliability artifacts transition from dry-run simulation → actual AI provider invocations in disposable test environment. This preflight package specifies:

1. **Execution Authority:** SINGLE first real 1→50 engineering pilot ONLY (no second pilot requirement)
2. **Setup Environment:** Isolated disposable test environment with credential validation; NO production/shared/linked database
3. **Execution Runbook:** ONE complete 50-chapter novel generation cycle
4. **Evidence Capture:** Canonical artifact recording at completion
5. **Semantic Judging:** Post-generation evaluator suite applied automatically
6. **Shutdown Procedure:** Clean termination after evidence captured
7. **Failure Triage Protocol:** Root cause analysis if pilot fails mid-execution

**Critical Governance Constraint:** DO NOT execute real generation calls until:
- ✅ M10-E E3A/E4 counted pair verified at SHA `65053607` (predecessor evidence authority)
- ✅ E5 blueprint workflow implementation deployed and passing acceptance tests
- ✅ Monitoring dashboards configured for failure observation

Until all conditions met, M10-F stays in **STAGED_DRY_RUN** state.

---

## 2. Revised Authority Specification

### 2.1 Default Pilot Configuration: ONE First Real 1→50

**Authority Constraint:** Exactly ONE real 1→50 engineering pilot. NO second pilot requirement in acceptance criteria. Any follow-up exploration must be separately ratified via governance ledger and cannot be implied as mandatory.

**Rationale:** Observed success rate of 50% means one completed novel provides sufficient learning signal for core pipeline validation. Additional pilots only initiated if explicitly requested by product team after first completes AND passes judge evaluation with separate authority approval.

**Updated Acceptance Criteria:**

| Criterion | Old Requirement | New Requirement (Isolated Single Pilot) |
|-----------|-----------------|------------------------------------------|
| Novel Length | Two full 50-chapter novels | ONE full 50-chapter novel |
| Judge Pass Rate | Both novels ≥0.75 average score | Completion signal; scores recorded as DIAGNOSTIC ONLY |
| Brand Leak Rate | <1% across both pilots | <1% on single pilot (DIAGNOSTIC, not gate) |
| Retry Overhead | Absorbable within 2×50 total budget | Absorbable in isolated pilot execution (observed metric only) |
| p95 Latency Ceiling | <120s per chapter | <120s per chapter (DIAGNOSTIC OBSERVATION) |
| E5 Workflow Compliance | N/A | Pilot must route failures through E5 blueprint queue exactly once |

**Budget Impact:** 
- OLD: $200 expected for 2×50 = ~$44/novel × 2 = $88/novel (total $176)
- NEW: Single pilot estimated $104–$139 depending on retry frequency (+33.8% overhead observed in fixture runs)

All above metrics are **DIAGNOSTIC/OPERATOR WATCHPOINT** only. NO numerical thresholds constitute acceptance requirement unless explicitly bound to existing frozen authority. Currently none exist for M10-F acceptance gate.

**Note:** No statements made here about whether E0 blocks M10-F execution; that dependency must be explicitly ratified in separate governance record if it exists.

---

## 3. Setup Environment Checklist

Execute these steps sequentially BEFORE enabling any real AI provider calls. Each step must return green checkmark or abort sequence immediately.

### [ ] Step 1: Predecessor Evidence Verification

**Command:**
```bash
git ls-remote origin refs/heads/m10-e-e1-fault-harness
```

**Expected Output:** `65053607ac7d1574e531bd49370b0a6c6d5565ba` (predecessor E3A/E4 closure SHA)

**Validation:** This SHA represents **predecessor evidence authority**. Execution SHA will be future exact M10-E/E5 closure SHA after E5 implementation completes—never require local HEAD == `65053607`. Abort if remote repository inaccessible or branch missing.

### [ ] Step 2: Isolated Test Environment Setup

**Command:**
```bash
cd supabase/migrations && pgen exec latest --db-url=postgresql://localhost/isolated_test_db
```

**Expected Output:** Zero migration errors; all blueprint-related migrations applied successfully.

**Validation:** Query database directly:
```sql
SELECT COUNT(*) FROM blueprint_queue;
SELECT COUNT(*) FROM blueprint_resolutions;
```

Both tables must exist with zero rows before pilot starts. **CRITICAL:** Use isolated disposable database only. NEVER use `--linked` flag or production/shared database connection.

### [ ] Step 3: Allowlist Diff Verification

**Command:**
```bash
cd .worktrees/m10-e-e1-fault-harness
npm run m10-e-e3a-e4-allowlist-cli HEAD
```

**Expected Exit Code:** 0  
**Expected Output:** `"M10-E E3A/E4 allowlist audit PASS: X changed path(s)..."`

**Validation:** Every changed file must match allowed paths:
- Backend logic files (`lib/runtime/blueprint-workflow.server.ts`)
- API route handlers (`app/api/blueprint-review/route.ts`)
- Database migrations (`supabase/migrations/2026082309*.sql`)
- Admin UI components (`components/admin/BlueprintDashboard.tsx`)
- Test files (`tests/e5-blueprint*.test.ts`)

If ANY unlisted paths detected, abort immediately and submit governance request.

### [ ] Step 4: Unit Test Suite Green Light

**Command:**
```bash
pnpm test:unit --grep "blueprint"
```

**Expected Result:** All tests pass (exit code 0), coverage report shows:
- `tests/e5-blueprint-workflow.test.ts`: ≥90% coverage
- `tests/e5-validator-rerun.helper.test.ts`: ≥95% coverage

**Abandon Condition:** Any failing test indicates bug in implementation that requires fix before proceeding.

### [ ] Step 5: Lint & Typecheck Clean

**Commands:**
```bash
pnpm typecheck
pnpm lint
```

**Expected Results:**
- `typecheck`: Zero errors emitted
- `lint`: May have warnings but zero ESLINT_FORBIDDEN_WORDS violations allowed (readersafe copy enforcement)

### [ ] Step 6: Environment Variable Validation (ISOLATED ONLY)

**Required Vars (must exist in `.env.isolated-test` on development machine):**

| Variable | Purpose | Validation Regex |
|----------|---------|------------------|
| `SUPABASE_URL` | Supabase project endpoint URL (TEST INSTANCE) | `^https://.*\.supabase\.co$` |
| `SUPABASE_ANON_KEY` | Read-only anonymous key | Length ≥ 30 characters |
| `OPENAI_API_KEY` | Primary provider credential | Starts with `sk-`, length ≥ 40 |
| `LAKOKU_DEPLOY` | Deployment mode flag | Must equal `isolated-test` or `dev` |
| `MAX_RETRY_ATTEMPTS` | Maximum retry attempts per chapter | Integer 1–5 |
| `LEASE_TTL_MS` | Lease expiration time | Integer ≥ 10000 |

**Security Audit:** Run `scripts/security-regression-check.ts` to verify no sensitive credentials hardcoded anywhere in working directory. DO NOT invent `BLUEPRINT_REVIEWER_IDS` environment variable; reuse existing repo authorization seam (`lib/admin/auth.ts::requireAdminUser()` with DB-backed `admin_users` table roles `owner/admin`).

### [ ] Step 7: Model Provider Quota Check

**Action:** Log into OpenAI dashboard and verify available quota for current billing cycle.

**Minimum Required:** 5 million input tokens + 2 million output tokens (sufficient for ~20 chapters at average usage). For 50-chapter pilot, expect ~88k tokens used based on observed metrics.

**Fallback Plan:** If quota insufficient:
1. Wait until next billing cycle (automatic reset on day 1 of month)
2. Use secondary provider fallback if configured
3. Extend timeline until quota replenishes

---

## 4. Execution Runbook: ONE Real 1→50 Engineer Pilot

Execute phases sequentially. Each phase has explicit duration window and exit criteria. If fail criteria triggered, rollback to previous stable state immediately.

### Phase A: Initial Setup (Day 1)

**Duration:** 4 hours max  
**Goal:** Validate infrastructure readiness, confirm allowlist compliance, enable read-only operations only.

#### Tasks:

1. Deploy Docker container to isolated test instance (NOT VPS):
   ```bash
   cd /opt/lakoku-isolated
   docker compose -f docker-compose.test.yml up -d lakoku-web
   docker logs -f lakoku-web  # Watch for startup errors
   ```

2. Confirm health check endpoint responds (localhost only):
   ```bash
   curl http://localhost:3000/api/health
   # Expected: {"status":"ok","version":"1.0.0"}
   ```

3. Run blueprint queue verification (must be empty):
   ```bash
   curl http://localhost:3000/api/blueprint-review/stats
   # Expected: {"pending":0,"processing":0,"resolved":0}
   ```

4. Create pilot novel record manually in isolated DB:
   ```sql
   INSERT INTO novels (id, title, concept, owner_id, status, created_at)
   VALUES (
     gen_random_uuid(),
     'M10-F Pilot Novel',
     'A standalone exploration testing real-model generation pipeline for first-time 1→50 execution',
     auth.uid(),
     'DRAFT',
     NOW()
   );
   ```
   Note this novel ID for execution tracking.

5. **DO NOT** trigger any real generation yet.

**Exit Criteria:** Zero error logs, HTTP 200 response from `/api/health`, allowlist audit passed, novel record created.

**Rollback Procedure:** If any issue emerges:
```bash
docker compose -f docker-compose.test.yml down
docker rmi lakoku-web:test
docker compose -f docker-compose.test.yml up -d lakoku-web  # Revert to previous tagged image if using versioned tags
```

---

### Phase B: Dry-Run Validation (Days 2–3)

**Duration:** 48 hours  
**Goal:** Test generation endpoint with mocked responses before enabling real model calls.

#### Tasks:

1. Set `MOCK_AI_PROVIDER=true` in environment variables
2. Create test novel via isolated CLI command (NO browser UI navigation to production):
   ```
   npm run create-test-novel --concept="Testing mock generation flow" --novel-id=$(generate-uuid)
   ```
3. Attempt to generate chapter with mock flag enabled:
   ```
   POST /api/novels/{id}/generate-chapter
   Response should return pre-defined stubbed output instead of calling real provider
   ```
4. Verify novel appears in local development dashboard, progress indicator works correctly
5. Test blocked story injection using LOCAL database connection:
   ```sql
   UPDATE chapters SET status='BLOCKED' WHERE id=(SELECT id FROM chapters LIMIT 1);
   INSERT INTO blueprint_queue (novel_id, story_id, status, failed_reasons, source_event)
   VALUES (...);
   ```
6. Trigger E5 workflow consumer and verify routing through admin dashboard (LOCAL DEVELOPMENT ONLY - NOT PRODUCTION)

**Exit Criteria:** All endpoints respond within SLA (<200ms for non-generation routes, <2s for generation), no console errors in browser DevTools, E5 blueprint queue processes items correctly.

**Rollback Procedure:** If mock responses cause unexpected behavior:
- Disable `MOCK_AI_PROVIDER=true` flag entirely
- Restart deployment container
- Proceed directly to Phase C once clean.

---

### Phase C: Limited Isolated Real-Model Launch (Days 4–14)

**Duration:** 10 days  
**Goal:** Execute FIRST real 1→50 pilot in isolated non-production environment under controlled conditions. No budget-related statements made here; dependency on E0 business authority determined by separate governance record if it exists.

#### Pre-Launch Checks:

- [ ] **Predecessor evidence SHA** verified at remote repository (`65053607` - E3A/E4 closure)
- [ ] **Execution SHA** = future exact M10-E/E5 closure HEAD (after E5 implementation completes)
- [ ] E5 blueprint workflow deployed in isolated test environment (NOT production DB)
- [ ] Dry-run checklist all steps completed successfully
- [ ] Monitoring dashboards configured for local observation only
- [ ] Provider quota verified sufficient for full novel (DIAGNOSTIC: 5M input + 2M output tokens)

#### Execution Sequence:

1. **Select Pilot Novel Concept:**
   - Choose story universe with moderate branching complexity (not too simple, not too complex)
   - Avoid topics requiring high creative risk (may trigger brand leaks due to unusual phrasing)
   - Recommended: Slice-of-life drama or light fantasy adventure

2. **Initiate Generation Pipeline in Isolated Environment:**
   ```bash
   npm run launch-m10f-pilot \
     --novel-id={created-novel-uuid} \
     --worker-count=1 \
     --max-chapters=50 \
     --env=isolated-test \
     --db-host=localhost \
     --no-linked
   ```
   **CRITICAL:** DO NOT use `--linked` flag; isolated evidence collection requires explicit connection string, NOT production database reference.

3. **Monitor Progress (Local Dashboard Only):**
   - Watch generation progress bar in local development UI (should advance smoothly chapter by chapter)
   - Check audit log entries appearing every 5 minutes
   - Review retry rate metric (diagnostic observation only, no acceptance threshold)
   - Track blocked stories routed through E5 blueprint queue automatically

4. **Handle Emergencies:**
   - If retry rate spikes above 50% continuously for >30 min: pause generation, investigate brand leak pattern (diagnostic observation)
   - If blocked stories accumulate >10 simultaneously: notify engineering lead immediately
   - Monitor judge evaluation results as diagnostic signal; NO acceptance thresholds applied (thresholds removed per reviewer instruction)

5. **Post-Completion Review:**
   - Once novel reaches chapter 50, run full 8-rubric judge suite automatically
   - Aggregate scores across all rubrics as operator watchpoint (NO ≥0.75 or ≥0.80 requirement)
   - Submit evaluation report to stakeholder review channel for informational purposes only

**Exit Criteria:** Novel completes all 50 chapters (DIAGNOSTIC OBSERVATION). E5 workflow processes all blocked stories correctly (acceptance gate). Judge evaluation results recorded as diagnostic evidence (OPERATOR GUIDANCE). Total cost observed for future budget authority decisions (not acceptance constraint per reviewer instruction).

**Rollback Procedure:** If novel fails fundamentally (brand leaks throughout, cannot complete past Bab 20):
- Mark novel status as `FAILED` in database
- Document root cause analysis
- Decide whether to retry same concept with adjusted temperature settings OR abandon and select new concept

---

### Phase D: Evidence Capture and Shutdown (Day 15)

**Duration:** 4 hours  
**Goal:** Finalize pilot results, capture canonical artifacts, terminate all worker processes cleanly.

#### Tasks:

1. Generate canonical counted artifacts for pilot execution:
   ```bash
   npm run m10-e-e3a-e4 -- --capture-final-report --output-dir=.zcode/artifacts/m10-f-pilot-1
   ```

2. Run semantic integrity validation:
   ```bash
   npm run validate-artifact-integrity -- --path=.zcode/artifacts/m10-f-pilot-1
   ```

3. Extract all evidence logs into isolated directory:
   ```bash
   cp -r .zcode/artifacts/m10-f-pilot-1 /tmp/m10f-pilot-1-evidence/
   ```

4. Terminate all active generation workers:
   ```bash
   curl -X POST http://localhost:3000/api/admin-shutdown-workers
   ```

5. Verify zero residual processes still running:
   ```bash
   ps aux | grep lakoku-worker
   # Expected: Zero matching processes
   ```

6. Archive pilot evidence in secure storage location accessible only to engineering team.

7. Write final evaluation report documenting:
   - Total cost incurred vs. budget projection
   - Number of blocked stories processed through E5 workflow
   - Judge evaluation results summary
   - Retriability lessons learned for future pilots

**Exit Criteria:** Canonical artifacts captured, evidence archived, workers terminated, final report submitted. Pilot officially complete.

---

## 5. Monitoring Requirements

### 5.1 Dashboard Widgets

Build Grafana/Loki stack or equivalent observability platform integration. Essential widgets:

1. **Active Novel Counter** — Gauge showing current novels in `GENERATING` state
2. **Chapter Completion Rate Trend** — Line chart plotting successful completions per hour
3. **Retry Rate Heatmap** — Color-coded matrix displaying retry frequency by chapter number and worker ID
4. **Blocked Queue Depth** — Visual indicator of pending blueprint_review items
5. **Judge Evaluation Scores Pie Chart** — Circular chart breaking down rubric score distribution
6. **Average Token Usage Per Chapter** — Dual-line chart comparing input vs. output token counts over time
7. **Provider Latency Boxplot** — Statistical plot showing median, quartiles, and outliers for model response times

### 5.2 Alert Rules

Configure PagerDuty/OpsGenie notifications for these conditions:

| Alert Name | Trigger Condition | Severity | Action Required |
|------------|-------------------|----------|-----------------|
| `HIGH_RETRY_RATE_SPIKE` | Avg retry rate >50% sustained for >10 min | Critical | Page on-call engineer immediately |
| `BLUEPRINT_QUEUE_BACKLOG` | Pending items >20 for >30 min | Warning | Manual intervention required to process queue |
| `JUDGE_EVALUATION_FAILURE_MASS` | >30% HIGH/CRITICAL findings across rubrics | High | Manual review workflow triggered |
| `PROVIDER_LATENCY_P95_EXCEEDED` | P95 latency >120s for consecutive 10 chapters | Warning | Scale provider quota if available |
| `BRAND_LEAK_PATTERN_DETECTED` | Brand scan failures concentrate on specific chapter ranges | Medium | Investigate narrative coherence drift, adjust prompt engineering |

### 5.3 Log Aggregation Requirements

All logs must flow through centralized logging pipeline with retention period of 90 days minimum:

**Log Levels & Sources:**
- `ERROR`: Runtime exceptions, database constraint violations, lease fencing conflicts
- `WARN`: Retry attempts, temporary provider timeouts, blueprint queue backlog warnings
- `INFO`: Chapter completion events, judgment evaluation results, user session starts
- `DEBUG`: Detailed token accounting data (enable only during pilot phase)

**Filter Patterns:** Exclude noisy debug messages from production logs except for specific diagnostic queries. Example filter rule:
```
level != "DEBUG" OR message contains "retry_count > 2"
```

---

## 6. Risk Mitigation

### 6.1 Identified Risks + Countermeasures

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| Budget exhaustion before novel completion | Low | High | Implement hard ceiling checks at start of each chapter batch; auto-pause generation if remaining <$20 |
| Retry loop consuming disproportionate resources | Medium | Medium | Exponential backoff with maximum attempts capped at 3; fallback to simpler prompt template if failures persist |
| Brand leak cascade affecting multiple chapters | Low | High | Increase brand guard strictness during pilot (temperature=0.3 instead of 0.7); disable choice branching until pattern stabilizes |
| Provider downtime forcing extended wait times | Medium | Low | Implement provider failover routing to secondary gpt-4.1-turbo instance if primary unavailable |
| Regulatory changes blocking AI access temporarily | Low | High | Maintain offline backup of previously generated content; prepare graceful degradation plan if access terminated |
| User experience fragmentation due to partial generations | Medium | Low | Display clear status banners when novel interrupted mid-generation; provide "resume" button once resource constraints resolve |

### 6.2 Emergency Procedures

#### Scenario 1: Pilot Failure Before Chapter 20 Completion

**Detection:** Monitor alert triggers when novel status becomes `FAILED` before reaching Bab 50.

**Immediate Actions:**
1. Call stops all ongoing generation jobs gracefully
2. Display "Pilot terminated early" banner to affected users
3. Create incident ticket documenting circumstances
4. Notify engineering lead for root cause analysis

**Resolution Path:**
- Option A: Retry same concept with adjusted temperature/prompt engineering
- Option B: Abandon concept, select entirely new story universe
- Option C: Escalate to research team for advanced debugging investigation

#### Scenario 2: Persistent Blueprint Queue Backlog

**Detection:** Alert triggers when pending queue depth >20 items for >30 minutes.

**Immediate Actions:**
1. Pause incoming blocked item generation if queue exceeds capacity
2. Manually prioritize queue items by severity (CRITICAL first)
3. Add temporary reviewer if authorized personnel available
4. Consider temporary UNBLOCK_PERMIT blanket authorization if systemic issue

**Escalation Path:** If queue cannot drain after manual intervention:
- Escalate to engineering lead for potential E5 workflow bug investigation
- Consider reverting to simplified retry policy until queue clears

---

## 7. Approval Sign-Off Template

Copy this form into email/message to respective stakeholders for formal authorization signatures.

---

**M10-F PILOT EXECUTION AUTHORIZATION FORM**

To: [Engineering Lead Name], [Product Owner Name]  
From: [Your Name/Role]  
Date: _______________  
Subject: Authorization Request for M10-F Single Novel Pilot

Dear Stakeholders,

I am requesting formal approval to proceed with M10-F pilot execution under the following conditions:

### Prerequisites Met (Check All That Apply):
- [ ] M10-E E3A/E4 counted pair SHA verified at remote repository (`65053607`)
- [ ] E5 blueprint workflow implementation deployed and tests passing
- [ ] Dry-run checklist completed successfully (all seven steps green)
- [ ] Monitoring dashboards configured with appropriate alert rules
- [ ] Emergency procedures documented and communicated to team
- [ ] Provider quota verified sufficient for full 50-chapter novel

### Authorization Details:

**Pilot Start Date:** _______________  
**Expected Duration:** 10 days (Phase C pilot execution)  
**Novel Concept:** [Brief description selected story universe]  
**Maximum Cost Allocation:** $139 USD (based on observed $104 + 33.8% retry overhead buffer)  
**Primary Contact During Pilot:** [Name + Email]  

**Stakeholder Approvals:**

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Engineering Lead | ___________________ | ___________________ | _______ |
| Product Owner | ___________________ | ___________________ | _______ |

---

*Submit this form electronically via company governance portal or via direct email reply chain.*

---

## Appendix A: M10-F Execution Command Examples

### Command 1: Launch Single Novel Pilot

```bash
npm run launch-m10f-pilot \
  --novel-id=$(cat /tmp/current-novel-id.txt) \
  --worker-count=1 \
  --max-chapters=50
```

### Command 2: Pause Active Generation

```bash
curl -X POST http://localhost:3000/api/admin-pause-generation \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"reason": "Review required", "novelIds": ["xxx"]}'
```

### Command 3: Resume After Pause

```bash
curl -X POST http://localhost:3000/api/admin-resume-generation \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"novelIds": ["xxx"], "priority": "high"}'
```

### Command 4: Capture Final Evidence

```bash
npm run m10-e-e3a-e4 -- --capture-final-report --output-dir=.zcode/artifacts/m10-f-pilot-1
```

---

## 0. Kickoff Readiness Record (2026-08-26, corrected by PM governance decision)

Prepared at M10-E closure (ledger Entry 13, closure commit `81cfdf507d6e55fb539b8d6810cdb93734adf199`, child of `0037c950`); corrected by the superseding R1 ratification and sequencing amendment (ledger Entry 14). This package is PREPARED and, on the conditions below, EXECUTION-AUTHORIZED.

| Prerequisite | State |
|---|---|
| M10-E PASS/CLOSED | ✅ ledger Entry 13, corrected basis Entry 14 |
| E5 blueprint workflow | ✅ E-OPS-1 CLOSED (Entry 13 §13.1) |
| E0 BUSINESS_AUTHORITY | ✅ R1 current: `LAKOKU-E0-2026-08-26-LOOSE-200-R1`, chapter ceiling `$2.10000000`, others unchanged; `budgetGate = PASS` proven in `tests/narrative-qa/m10-e-e0-closure.test.ts` (R0 preserved as superseded history) |
| Sequencing amendment | ✅ RATIFIED (ledger Entry 14 §14.2): CONTRACT_FIXTURE engineering closure valid; M10-F is first RELEASE_EVIDENCE pilot |
| Counted predecessor evidence | ✅ frozen at `65053607` / runner `7324d0fd…` / normalized `cfe6734d…` |
| Monitoring dashboards for failure observation | ⬜ must be configured before Steps begin (Step 1) |
| Disposable isolated environment + credential validation | ⬜ Steps 1–2 of this package |

**Watchpoint resolution:** the observed chapter mean `2.05000000` breach against `2.04001674` is resolved by the superseding authority (`≤ 2.10000000`); chapter-level cost stays a standing evidence-review item during the pilot.

**Authorization state:** M10-F execution was CONDITIONALLY AUTHORIZED by the project lead on (a) corrected E0 `budgetGate = PASS` and (b) this amendment committed clean — both satisfied in the Entry 14 batch. After its clean push and remote verification, **the pilot proceeds without another approval review**: Step 1 monitoring setup, Step 2 disposable isolated environment, then the SINGLE real-provider 1→50 engineering pilot. Production remains forbidden throughout.
