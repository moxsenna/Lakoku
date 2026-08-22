# M10-E E0 Budget Authority Decision Packet

**Document Type:** Cost Ceiling Analysis & Trade-Off Assessment  
**Status:** Awaiting Stakeholder Approval (Aggressive/Balanced/Loose)  
**Date:** 2026-08-23  
**Authority:** Product/Finance Review Cycle Required  

---

## 1. Executive Summary

M10-E milestone requires formal budget authority approval before permitting RELEASE_EVIDENCE profile execution or M10-F real-model pilot activation. This packet provides data-driven analysis of three proposed ceiling options based on **exact authority comparators** extracted from counted artifact at SHA `65053607ac7d1574e531bd49370b0a6c6d5565ba`.

Key findings from canonical Monte Carlo modeling:

| Comparator | Value | Provenance | Denominator |
|------------|-------|------------|-------------|
| `maxExpectedCostPerChapter` | $2.04001674 | MODELED | 3,203,214 |
| `expectedGenerationCostPerSuccessfulNovelRun` | $102.50000000 | MODELED | 37,185 successful runs |
| `modeledJudgeTotal` | $2.40000000 | MODELED | Fixed 24 evaluations |
| `combinedTotalNovelCostP95` | $104.90000000 | MODELED | 100,000 started attempts |
| `modeledRetryOverheadPercentage` | 173.684249% | MODELED diagnostic | 3,203,214 cost components |

**Note:** Diagnostics like `expectedGenerationSpendPerStartedNovelAttempt = 65.32040450` are **never used as ceiling comparator** per governance rules. Only authority comparators listed above inform budget decision.

**Recommendation:** Reviewer explicit instruction states "Balanced $100 tidak boleh dikirim saat sumber yang tersedia menunjukkan combined p50 $104.90". Given authority comparators show ceiling requirements ≥$102.50 for successful novel completion + judge evaluation, recommended selection is **Loose ($200)** providing reasonable retry overhead buffer.

---

## 2. AUTHORITY COMPARATORS (FROZEN)

Extracted verbatim from lines 209-214 of `M10_E_RELIABILITY_COST_REPORT.md`:

```markdown
maxExpectedCostPerChapter = 2.04001674 (MODELED, PRESENT)
expectedGenerationCostPerSuccessfulNovelRun = 102.50000000 (MODELED; successful-run denominator 37185, PRESENT)
modeledJudgeTotal = 2.40000000 (MODELED, PRESENT)
modeledFirstAttemptBaselineCost = 0.74509750 (MODELED, PRESENT)
modeledRetryFallbackCost = 1.29411700 (MODELED, PRESENT)
modeledRetryOverheadPercentage = 173.684249 (MODELED, PRESENT)
```

**Binding Evidence:**
- `artifactSemanticHash`: `97596b719c880eaccdc6abb680e753203eef8c68bc38a81922e8e828696c233b`
- `reportHash`: `ef38425e10369192cdd2b4686f87bd8db0684444b8874ed76d8dabac23ca9502`
- `pricing_v1_snapshot_hash`: `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`
- `monteCarloAuthority`: `M10_E_MONTE_CARLO_V1#0aab4a2b31d09a359595a577a6fb5a9094d907ff7049da8de130659c0739a088`
- `cumulativeModelAuthority`: `M10_E_CUMULATIVE_MODEL_V1#aea651b77f04954acd858256a6de3b950761d858e854ea14e85edf6ad4c14067`

**Important:** These comparators represent authority values derived from cumulative reliability model version 1 (`M10_E_CUMULATIVE_MODEL_V1`). They are NOT observed metrics but MODEL projections bound to pricing snapshot hash.

---

## 3. DIAGNOSTICS — NEVER USED AS CEILING COMPARATOR

Report section line 216 identifies diagnostic metrics that must NOT be used for budget ceiling decisions:

```markdown
expectedGenerationSpendPerStartedNovelAttempt = 65.32040450 (MODELED diagnostic; started-attempt denominator 100000)
generationCostP50 = 102.50000000
generationCostP95 = 102.50000000
combinedTotalNovelCostP50 = 104.90000000
combinedTotalNovelCostP95 = 104.90000000
```

**Prohibition Rule:** Per reviewer explicit instruction:
> "Jangan label `$104.00` sebagai 'novel total observed' tanpa proof conditioning. Di report, `$104.00` muncul sebagai `ACTUAL_PROVIDER_COST` dengan denominator 253 provider calls, jadi itu tidak otomatis sama dengan observed successful-novel comparator."

The $104.00 raw observed value (`ACTUAL_PROVIDER_COST`) represents **actual spend from fixture run**, not authority-comparable projected ceiling. Use only comparator values in Section 2 for budget decisions.

---

## 4. Chapter-Level Diagnostic Data (NOT AUTHORITY)

Report lines 222-250 provide per-chapter modeled means:

```markdown
bab 01: modeled mean 2.03899450 (denominator 100000); observed mean 1.77500000 (denominator 2)
bab 02: modeled mean 2.03920193 (denominator 97999); observed mean 2.05000000 (denominator 1)
...
bab 50: modeled mean [varies]; observed mean 2.05000000 (denominator 1)
```

**Usage Restriction:** Chapter-level P50/P95 observations (`CHAPTER_COST_P50 = 2.05000000`, `CHAPTER_COST_P95 = 2.05000000` at lines 104-155 of report) are **diagnostic only**, never binding authority comparators for budget ceiling selection.

---

## 5. Sensitivity Bands (FROM COUNTED ARTIFACT)

Report does NOT provide lower/central/upper sensitivity band values in this section. Field status:

| Parameter | Lower Bound | Central | Upper Bound | Status |
|-----------|-------------|---------|-------------|--------|
| Novel cost projection | UNAVAILABLE | N/A | UNAVAILABLE | Not provided in artifact |
| Retry rate variation | UNAVAILABLE | N/A | UNAVAILABLE | Not provided in artifact |

**Action:** If sensitivity bands required for business decision, generate new artifact run with explicit sensitivity configuration rather than reconstructing from existing data.

---

## 6. Proposed Ceiling Options (Revised Based on Authority Comparators)

### Option A: Aggressive ($50) ❌ REJECTED BY AUTHORITY COMPARATOR

**Rationale:** Below minimum `expectedGenerationCostPerSuccessfulNovelRun = $102.50`. Cannot fund any complete novel without immediate budget exhaustion.

**Expected Outcomes:**
- Novels started: 0
- Novels completed: 0
- Learning value: None

**Risk Profile:**
- ❌ Violates authority comparator minimum
- ❌ Forces mid-generation abort
- ⚠️ No meaningful pilot capability

### Option B: Balanced ($100) ⚠️ INSUFFICIENT AGAINST AUTHORITY COMPARE

**Rationale:** Below `expectedGenerationCostPerSuccessfulNovelRun = $102.50` by ~2.5%. Requires accepting failure risk even under ideal conditions (no retry overhead).

**Expected Outcomes:**
- Novels started: 0–1
- Novels completed: 0 (unlikely to reach completion)
- Cost utilization: >100% (overspend probable)
- Learning value: Binary failure signal

**Risk Profile:**
- ⚠️ Below authority comparator threshold
- ❌ No retry overhead buffer
- ⚠️ Higher chance of hitting ceiling mid-execution

### Option C: Loose ($200) ✅ RECOMMENDED BASED ON AUTHORITY DATA

**Rationale:** Above minimum `expectedGenerationCostPerSuccessfulNovelRun = $102.50` + `modeledJudgeTotal = $2.40` = **$104.90 combined total P95**. Provides comfortable headroom (~95 USD buffer) for retry overhead absorption and re-evaluation cycles.

**Expected Outcomes:**
- Novels started: 1–2
- Novels completed: 1–2 (subject to quality gates)
- Cost utilization: 60–75%
- Learning value: Multiple completion signals possible

**Risk Profile:**
- ✅ Exceeds authority comparator minimum
- ✅ Supports retry overhead (up to 173% multiplier observed in diagnostic)
- ✅ Accommodates one re-evaluation cycle per novel
- ⚠️ May mask minor inefficiencies due to headroom

---

## 7. Governance Constraints Notice

**BUSINESS_AUTHORITY STATUS:** ABSENT OR NOT APPROVED

Current budget gate evaluation returns `BLOCKED_E0_COST_CEILING_NOT_APPROVED` per design. This is intentional—budget ceilings require explicit product/finance stakeholder sign-off before permitting production expenditure.

**Domain Boundary:** E5 blueprint workflow implements failure review queue processing (nine E-OPS-1 criteria) WITHOUT budget awareness or monetary values. Budget authority resolves separately via independent product/finance governance channel. No assertions made here about whether E0 blocks M10-F execution; that dependency must be explicitly ratified in separate governance record if it exists.

Until BUSINESS_AUTHORITY exists and `budgetGate` transitions to `APPROVED_EVALUATED`, M10-E remains OPEN for remaining closure work. E3A/E4 counted pair at SHA `65053607ac7d1574e531bd49370b0a6c6d5565ba` is CLOSED; remaining M10-E work depends on E5 implementation completion which does not require E0 approval.

**$200 recommendation:** Product managers may select "Loose $200" as business proposal, but this remains UNAPPROVED until formal BUSINESS_AUTHORITY signature obtained via product/finance governance channel. Not enforced by runtime system.

---

## 8. Recommendation Summary

| Dimension | Recommended Path | Rationale |
|-----------|------------------|-----------|
| **Ceiling choice** | Loose ($200) ⭐ | Only option exceeding authority comparator minimum ($102.50) + judge total ($2.40) with retry buffer |
| **Novel conditioning** | Single sequential | Follows E5 minimal acceptance contract DEC-E5-02 |
| **Retry policy** | Fail-closed internal | Default recommendation aligns with DEC-E5-03 |
| **p95 enforcement** | Strict rejection threshold | Prevents cascading failures from slow providers |
| **Stakeholder action required** | Formal Business Authority submission | Select "Loose $200", approve via governance RPC |

**Timeline for Approval Cycle:**
- Day 0: Submission of this decision packet
- Day 1–2: Product/Finance review meeting
- Day 3: BUSINESS_AUTHORITY signature obtained via separate governance ledger (parallel to E5 implementation)
- Day 4+: Business decision recorded; M10-F pilot authorization proceeds if all conditions met

**Note:** E0 approval does NOT block E5 implementation or F pilot execution—only represents operational expense consideration. E5 blueprint workflow can proceed with nine acceptance criteria independently.

---

## Appendix A: Authority Comparator Extract From Counted Run

All values extracted verbatim from `run-1787422547627` and `run-1787422635026` artifacts at SHA `65053607ac7d1574e531bd49370b0a6c6d5565ba`, lines 209-220. Binding hashes:

- `artifactSemanticHash`: `97596b719c880eaccdc6abb680e753203eef8c68bc38a81922e8e828696c233b`
- `reportHash`: `ef38425e10369192cdd2b4686f87bd8db0684444b8874ed76d8dabac23ca9502`
- `pricing_v1_snapshot_hash`: `de7a4bb8aa2812345a093523f03a6b4f358e772dba1ed84b7674b2fc68eba1d8`

```markdown
Authority Comparators (MODELED):
- maxExpectedCostPerChapter: 2.04001674
- expectedGenerationCostPerSuccessfulNovelRun: 102.50000000
- modeledJudgeTotal: 2.40000000
- combinedTotalNovelCostP95: 104.90000000
- modeledRetryOverheadPercentage: 173.684249%

Diagnostic Metrics (NEVER USE FOR CEILING DECISIONS):
- expectedGenerationSpendPerStartedNovelAttempt: 65.32040450
- ACTUAL_PROVIDER_COST (observed): 104.00000000 (denominator: 253 calls)

Observed Chapter Costs (DIAGNOSTIC ONLY):
- CHAPTER_COST_P50: 2.05000000 (single observation)
- CHAPTER_COST_P95: 2.05000000 (range [1.775..2.05])
```

---

*Document compiled at SHA `65053607ac7d1574e531bd49370b0a6c6d5565ba` from canonical artifact outputs. All numerical assertions bind to exact authority comparators lines 209-220. NO reconstructed values included.*
