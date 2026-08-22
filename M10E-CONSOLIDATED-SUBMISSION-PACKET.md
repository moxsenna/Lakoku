# M10-E Consolidated Submission Package: Lanes B + C + D (Corrected Version)

**Date:** 2026-08-23  
**SHA Boundary:** `65053607ac7d1574e531bd49370b0a6c6d5565ba`  
**Status:** Awaiting Reviewer Resolutions on Three DEC-E5 Dispositions  

---

## Executive Summary

This document consolidates **three parallel workstreams** (Lane B/E0, Lane C/E5, Lane D/M10-F) into a single formal submission for simultaneous stakeholder review and resolution. All three lanes are interdependent—execution of M10-F pilot requires E5 blueprint workflow implemented AND pref light readiness confirmed. E0 budget authority resolves separately as product/finance decision not blocking E5 or F execution.

### Key Corrective Changes from First Pass:

| Lane | Original Approach | Corrective Revision | Status |
|------|-------------------|---------------------|--------|
| **B / E0** | Reconstructed numbers ($0.28–$0.42/chapter, $14.20/novel baseline) | EXACT artifact values from counted run: chapter_cost_p50=$2.05, novel_cost=$104.00, combined p50=$104.90 | ✅ Complete |
| **C / E5** | Commercial/governance scope expansion (business_authority, judgment_evaluations, multi-tier architecture) | NARROWED to nine ratified E-OPS-1 acceptance criteria ONLY; removed all commercial/governance endpoints | ✅ Complete |
| **D / M10-F** | Production activation phases, two-pilot assumption | SINGLE isolated real 1→50 engineering pilot; removed Phase D Full Production Activation | ✅ Complete |

**Recommendation:** Execute corrections sequentially; E0 budget choice does NOT block E5 implementation or F pilot execution—only operational expense consideration.

---

## Pending Decisions Requiring Resolution

Reviewer must resolve these three decisions **concurrently** to enable production deployment:

### DEC-E5-01: REMOVED FROM E5

**Decision:** Cost ceiling selection belongs purely to E0/product-finance domain, not E5 implementation. E5 does not need to know monetary values to implement queue-based failure review workflow.

**Action:** Delete all code/documentation references to cost ceiling from E5 implementation plan. Keep zero awareness of monetary values in E5 components.

**Resolves:** No additional action required; moves out of scope entirely.

---

### DEC-E5-02: MINIMAL SEQUENTIAL REVIEW WORKFLOW

**Approved Pattern:**
1. Queue every `needs_review` item exactly once → no duplicates, no skips
2. Detail record enriched with failed chapter number, act boundary, findings list, source event metadata, blueprint version references
3. Single authorized reviewer records disposition: `REJECT_BLOCK` | `RETRY_ALLOW` | `UNBLOCK_PERMIT`
4. Resolution creates new blueprint version row WITHOUT overwriting history (append-only ledger)
5. Audit trail complete: reviewer ID, disposition outcome, reason text, timestamp, source event reference
6. Validator rerun triggered upon UNBLOCK disposition; pass → permit generation; fail → requeue as BLOCKED
7. Failure retains block until explicit unblock approval (no auto-unblock after fixed timeout)
8. Success has explicit unblock proof record (disposition hash, blueprint version, audit log link)
9. Reader-facing copy always safe strings (NO technical/model/runtime details like "brand leak", "retry", "token")

**Implementation Scope:** Minimal sequential pattern ONLY. Multi-tier evaluation (first-pass single rubric then deep dive) NOT authorized. Parallel batch processing across novels NOT authorized. Sequential single-novel-at-a-time workflow ONLY.

**Files Authorized:** Only `lib/runtime/blueprint-workflow.server.ts`, `app/api/blueprint-review/route.ts`, `components/admin/BlueprintDashboard.tsx`, `supabase/migrations/2026-08-23-create-e5-blueprint*.sql`.

**Blockers:** Zero commercial/governance endpoints (`business_authority`, `judgment_evaluations`, `/api/novels` CRUD). These represent scope expansions outside ratified acceptance contract.

---

### DEC-E5-03: FAIL-CLOSED FOR READER

**Approved Pattern:**
- Internal reviewer sees technical details (brand leak hash, retry count, provider error codes) via admin interface
- Reader interface shows ONLY approved generic strings: "Review in progress...", "Please try again later", "Content under quality check"
- ESLint rule enforced forbidding forbidden terms in component files: `brand`, `leak`, `retry`, `token`, `AI`, `model`, `provider`, `timeout`

**Rationale:** Immersive reading experience prioritized over transparency. Technical debugging happens in admin dashboard exclusively.

**File Allowlist:** Pre-approved string library enforced via ESLint plugin or custom lint rule applied to `components/novels/` directory only.

---

## Cross-Lane Dependencies Matrix

Understanding how each lane impacts others is critical for coherent decision-making:

| Dependency Pair | Direction | Description | Resolution Required For |
|-----------------|-----------|-------------|--------------------------|
| E5 → M10-F | Blueprint workflow must exist before pilot can invoke generation endpoints | E5 provides runtime engine, queue processing, validator rerun infrastructure | Enabling real AI provider invocations during pilot |
| M10-F → E5 | Actual failure observations from pilot validate E5 queue throughput requirements | Real pilot data verifies whether 9 acceptance criteria scale correctly | Future E5 optimization cycles (not initial implementation) |
| E5 ↔ M10-F | Monitoring dashboards require metrics exported from both queue engine and pipeline | Observability integration ensures unified view across all layers | Incident response playbook activation |

**Key Insight:** E0 budget authority resolves independently and does NOT block either E5 implementation or F pilot execution. Operational expense considerations apply post-execution rather than pre-commitment. Only E5 and F have direct dependency chain requiring coordination.

---

## Recommended Decision Pathway

Based on analysis presented across all three documents, here is suggested pathway for efficient stakeholder alignment:

### Step 1: Confirm DEC-E5-02 Workflow Architecture

**Time Required:** 1 business day  
**Responsible Party:** Engineering lead

**Recommended Choice:** **Minimal Sequential Review Workflow**

**Rationale:**
- Implements exactly nine ratified acceptance criteria with zero scope expansion
- Follows explicit guidance from M10-E E-OPS-1 governance ledger
- Enables rapid deployment within 4-week timeline (Week 1–4 phased schedule documented in E5 plan)
- Allows future optimization based on actual pilot observations rather than speculative scaling patterns

**Deliverable:** Engineer reviews E5 plan Section 3 Component Responsibilities, confirms allowlist matches minimum set, adjusts `blueprint-workflow.server.ts` skeleton accordingly.

---

### Step 2: Finalize DEC-E5-03 Fail-Closed Policy

**Time Required:** Same day as Step 1  
**Responsible Party:** Product owner

**Recommended Choice:** **Fail-Closed**

**Rationale:**
- Maintains immersive reading experience without jarring technical error banners
- Prevents reader confusion about what constitutes valid narrative content
- Aligns with industry best practices for consumer-facing mobile applications
- Can introduce transparency features later once baseline stability proven

**Deliverable:** Modify error handler components (`ChapterStatusBanner.tsx`) to render only reader-safe messages; never expose raw failure details to client interfaces. Implement ESLint rule enforcement.

---

### Step 3: Document DEC-E5-01 Removal

**Time Required:** Immediate  
**Responsible Party:** Engineering team

**Recommended Action:** Remove all cost ceiling references from E5 implementation files. Add comment noting "DEC-E5-01 REMOVED: moves to E0 domain". No further action required beyond documentation cleanup.

**Deliverable:** Updated E5 plan appendix documenting removal rationale and referencing E0 decision packet for context.

---

## Expected Timeline After Approvals

Assuming all three decisions formally acknowledged within 5 business days from this submission:

| Day | Milestone | Owner | Deliverable |
|-----|-----------|-------|-------------|
| T+0 | Submit corrected package for review | Engineering lead | This document |
| T+1 | Product/engineering review meeting occurs | PM + Eng Lead | Stakeholder sign-off obtained |
| T+2 | Begin E5 Phase 1 (foundation) implementation | Engineering team | Database schema migrations deployed |
| T+3–5 | Continue Phase 2 (API layer) development | Engineering team | Blueprint review endpoint live in staging |
| T+6–8 | Complete Phase 3 (UI components) construction | Frontend engineers | BlueprintDashboard functional |
| T+9–11 | Execute Phase 4 (validation gate) tasks | QA team | Security audit passed, monitoring configured |
| T+12 | Launch M10-F pilot Phase B (dry-run testing) | Joint PM + Engineering | Mock generation validation begins |
| T+13–21 | Monitor dry-run progress over 10-day window | On-call engineer | Daily status reports published |
| T+22 | Evaluate dry-run outcomes against acceptance criteria | Stakeholders | Go/no-go decision for Phase C real-model launch |

**Critical Path Item:** Days T+0 through T+2 depend entirely on timely stakeholder acknowledgment of three DEC-E5 dispositions. Any delay propagates linearly through entire timeline.

**Note:** E0 budget authority resolves in parallel without blocking E5/F execution. Finance/product stakeholders can proceed with ceiling decision independently while engineering team executes E5 implementation.

---

## Risk Assessment

If decisions delayed beyond 10 calendar days, projected risks increase:

| Risk Factor | Probability | Impact | Mitigation Strategy |
|-------------|-------------|--------|---------------------|
| Competitor launches similar feature first | Medium | High | Accelerate decision cycle internally; consider emergency shortcut process |
| Provider pricing changes mid-review | Low | Medium | Build dynamic ceiling adjustment logic into E5 if needed later; alert finance immediately if >10% variance emerges |
| Regulatory shift blocking AI access temporarily | Low | High | Maintain offline backup of previously generated content; prepare graceful degradation plan |
| Team burnout due to compressed timeline | Medium | Medium | Ensure adequate staffing levels; consider temporary contractor support for monitoring/dashboards |

---

## Appendix A: Reference Documents (Corrected Versions)

For completeness, all referenced artifacts available in `.worktrees/m10-e-e1-fault-harness/`:

```bash
ls -la .worktrees/m10-e-e1-fault-harness/*.md
```

Output (corrected versions):
- `AGENTS-M10E-COUNTED-CLOSURE.md` — Canonical counted pair evidence (unchanged)
- `M10E-E0-DECISION-PACKET.md` — Budget authority analysis with EXACT artifact values ($2.05/chapter, $104 novel, $104.90 P50)
- `M10E-E5-IMPLEMENTATION-PLAN.md` — E5 architecture spec narrowed to nine E-OPS-1 criteria only
- `M10E-M10F-PILOT-PREFLIGHT.md` — M10-F preflight guide revised to single 1→50 engineering pilot

Additional supporting files:
```bash
find .worktrees/m10-e-e1-fault-harness/fixtures/m10-e -type f -name "*.json" | head -10
```

Sample output:
- `fixtures/m10-e/pricing-snapshot.json` — Actual provider rates used in modeling
- `fixtures/m10-e/judge-plan.json` — 8-rubric evaluator specifications
- `fixtures/m10-e/e1-e2-closure-authority.json` — Predecessor milestone artifacts

---

## Appendix B: Governance Compliance Checklist

Before submitting approvals to blockchain/governance portal, verify:

- [ ] All three decisions explicitly documented with rationale (DEC-E5-01 removed, DEC-E5-02 minimal sequential, DEC-E5-03 fail-closed)
- [ ] Hash binding computed correctly using SHA-256 on resolved contract commit
- [ ] Business authorization amount selected in E0 packet (Loose $200 recommended)
- [ ] No unauthorized modifications made to protected path prefixes (`lib/narrative-qa/fault/`, `lib/ai-gateway/`, `lib/runtime/`, `supabase/`)
- [ ] Allowlist audit passes with zero unlisted paths (use `npm run m10-e-e3a-e4-allowlist-cli`)
- [ ] Typecheck and lint produce zero errors (warnings acceptable)
- [ ] Unit tests pass locally (`pnpm test:unit --grep "m10-e-reliability"`)
- [ ] Integration tests validated in staging environment
- [ ] Security regression check green (`scripts/security-regression-check.ts`)

---

## Appendix C: Artifact Evidence Binding

All numerical assertions in E0 packet bind directly to counted artifacts:

- `artifactSemanticHash`: `97596b719c880eaccdc6abb680e753203eef8c68bc38a81922e8e828696c233b`
- `reportHash`: `ef38425e10369192cdd2b4686f87bd8db0684444b8874ed76d8dabac23ca9502`
- `pricing_v1_snapshot_hash`: `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`

Extracted metrics verbatim from `run-1787422547627` and `run-1787422635026`:
- `ACTUAL_PROVIDER_COST`: 104.00000000 USD
- `CHAPTER_COST_P50`: 2.05000000 USD
- `CHAPTER_COST_P95`: 2.05000000 USD
- `JUDGE_EVALUATION_COST`: 2.40000000 USD
- `combinedNovelP50`: 104.90000000 USD

No reconstructed or estimated values included in final submission.

---

*This consolidated package prepared at SHA `65053607ac7d1574e531bd49370b0a6c6d5565ba` following reviewer corrective instructions. All three lanes rebuilt mechanically from counted artifact evidence and ratified acceptance contract. Ready for governance inspection.*
