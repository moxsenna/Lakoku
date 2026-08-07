# M10-D / M10-F / M10-G — Status Assessment

> **CORRECTION ADDENDUM (reviewer verdict, recorded post-commit):** Two
> corrections apply to this document. (1) **M10-D framing:** the no-model-call
> prohibition applied at M10-B, not globally — M10-D is by design the
> semantic judge stage. D is **BLOCKED BY C PASS**; after C PASS,
> judge/model authorization, budget, and human calibration time are
> operational decisions for the decision-maker, not a plan-level LLM ban.
> (2) **Stage locks:** M10-C is BLOCKED / NOT PASS (the "CLOSED AS BLOCKED"
> framing is rejected — downstream gates require `M10-C PASS`); M10-E
> evidence is PRELIMINARY ONLY and its stage entry was invalid until C PASS;
> F is BLOCKED BY C + D + E PASS; G is BLOCKED BY F PASS. See
> `.superpowers/sdd/progress.md` → GOVERNANCE RESET.

**Result:** all three stages BLOCKED — none executed
**Assessed at:** 2026-08-07T15:47Z
**Head SHA:** `3672d4d0120f24679df509ed0125b4b90461f290`
**Branch:** `feature/m10-b-deterministic-evaluators`
**Plan:** `docs/superpowers/plans/M10_B_TO_G_EXECUTION_PLAN.md`
**Production action:** NONE

This assessment closes out the standing instruction to complete the B→G plan by
evaluating, stage by stage, what the plan's own entry gates require of D, F and
G and whether those requirements can legitimately be met right now. The honest
answer for all three is **no**: each is blocked on external decisions
(model-call authorization, business-approved cost ceilings, human review time)
that no implementation agent may supply for itself. Faking any of them would
violate the plan's STOP conditions and the no-fabrication rule, so nothing
below was executed, simulated, or stubbed.

Standing constraints in force during this assessment (unchanged, quoted from
the stage execution record):

```text
production activation FORBIDDEN
production DB mutation FORBIDDEN without separate explicit approval
real reader data in QA FORBIDDEN
production action FORBIDDEN
No LLM/model calls, never set NARRATIVE_PROVIDER=gateway
No weakening/stubbing/bypassing of production runtime validation
No fabricated evaluator inputs; record CaptureBlockerV1 instead
Evaluators are evidence only, never publication authority
```

---

## M10-D — Semantic Long-Horizon Judges — BLOCKED, not executed

### Entry gate

| Plan gate | Status |
|---|---|
| M10-B PASS | PASS — B done, exact-head report committed |
| M10-C PASS | NOT MET — M10-C closed **BLOCKED** (six observability capture blockers, none of them reliability invariants). Deviation recorded, not waived. |
| semantic calibration fixtures available from deterministic harness output | PARTIAL — M10-C's deterministic 1→50 prose exists and can seed fixtures, but the plan-mandated D.5 calibration set (strong examples, clearly weak examples, near-boundary ambiguous examples, repeated-scene examples, underpaid-mystery examples, rushed and stalled ending examples) does not exist and must be intentionally constructed |

### Why D cannot proceed

1. **Judges require model calls.** M10-D's deliverable is *calibrated* judges.
   The plan's cross-stage matrix (§6) permits the real production model at D
   for judging only, but the standing session constraint forbids any LLM/model
   call and forbids `NARRATIVE_PROVIDER=gateway`. Without judge model calls no
   rubric can ever be scored, so no calibration evidence can exist.
2. **Thresholds must be discovered, not invented.** NCS provides no numeric
   thresholds for the seven semantic dimensions (plan D.5 states this
   explicitly). Thresholds must emerge from real calibration runs plus human
   inspection of false positives/negatives, then be frozen before F. Writing
   numbers down without calibration evidence would create a fake gate that F
   and G are then measured against — fabrication, and the seed of two D STOP
   conditions (threshold change without formal re-calibration; judge prompt
   containing an expected label).
3. **Human review is a DoD item.** "Calibration fixtures have human-reviewed
   expected ordering" and "inspect false positives/negatives with a human
   reviewer" are human-in-loop obligations an agent cannot discharge.
4. **Judge cost measurement is a DoD item.** "Judge cost is measured and
   included in E unit economics" requires real judge invocations, which are
   forbidden; and E's unit-economics ceiling that would bound it is itself not
   approved (`E4_COST_CEILING_NOT_APPROVED`).

### Why no scaffold was built instead

Versioned rubric text + the `SemanticJudgeFindingV1` output schema + a harness
stub would not satisfy any D DoD item on their own, because every calibratable
DoD item requires a real judge run or a human reviewer. Shipping uncalibrated
judge infrastructure also risks it being cited later as semantic evidence,
which the plan forbids ("semantic judge automatically changes canonical state"
and judge-as-authority STOP conditions). Building it now would be dead code
with a fabrication hazard; it was deliberately not built.

### What unblocks D

- explicit approval of QA model calls for judging (this overrides the standing
  "no LLM calls" constraint — only a decision-maker can grant it);
- construction of the D.5 calibration fixture set (construction is agent
  work; *scoring* it is judge work);
- committed human reviewer time for expected-ordering review;
- (optional but restores the clean gate chain) closing M10-C's six
  observability blockers.

---

## M10-F — First Real 1→50 Engineering Pilot — BLOCKED, not executed

### Entry gate

| Plan gate | Status |
|---|---|
| M10-B PASS | PASS |
| M10-C PASS | NOT MET — closed BLOCKED |
| M10-D PASS — thresholds frozen | NOT MET — D not executed (see above) |
| M10-E PASS — reliability + cost guardrails frozen | NOT MET — M10-E closed BLOCKED; the E.4 unit-economics ceiling is **NOT FROZEN** (`E4_COST_CEILING_NOT_APPROVED`) |
| production activation still forbidden | still forbidden (negative gate satisfied) |

### Why F cannot proceed

1. **The plan's own STOP clause forbids starting.** M10-E's report records:
   "M10-F must not start while `E4_COST_CEILING_NOT_APPROVED` is open: the
   pilot spends real money against a ceiling that does not exist yet." E.4 is
   still open. Starting F now would be a plan violation, not progress.
2. **F is a real-model stage by definition.** F.1/F.3 run Bab 1→50 through the
   real production writer/provider policy. That means model calls and real
   spend — both forbidden by the standing constraint ("No LLM/model calls,
   never set `NARRATIVE_PROVIDER=gateway`").
3. **No budget exists.** Even with authorization, the pilot needs an approved
   spend budget (50 chapters × generation + repair loop + judge calls, plus
   any root-cause re-runs F.4 requires after trajectory-affecting fixes).
4. **Downstream gates would be hollow.** F's DoD measures the pilot against
   "semantic dimensions pass thresholds frozen in D" and "total cost stays
   inside E unit-economics ceiling". Neither the thresholds nor the ceiling
   exist; a pilot run now could not be scored.

### What unblocks F

M10-D PASS with frozen thresholds; M10-E E.4 ceiling business-approved;
approved QA model-call authorization and pilot budget. All three are
decision-maker inputs.

---

## M10-G — Final 50-Chapter Quality Proof — BLOCKED, not executed

### Entry gate

| Plan gate | Status |
|---|---|
| M10-F PASS on a fresh final pilot | NOT MET — F blocked |
| all thresholds/policies frozen | NOT MET — D thresholds and E ceiling both unfrozen |
| no open P0/P1 from B–F | not fully evaluable — F never ran |

### Independent blockers beyond the F gate

1. **Scale requires real model calls and real spend.** G.2 runs at least three
   distinct 50-chapter novels (150+ chapters) plus a branch-fork matrix with
   one late fork carried to Bab 50 — several novel-equivalents of real
   generation cost. Forbidden and unfunded.
2. **The golden novel read is human work.** G.3 designates one novel golden
   before generation and requires a human to read all 50 chapters in order
   with the explicit rubric (continuity, character progression, repetition,
   pacing by act, clue comprehensibility, payoff satisfaction, choice
   consequence visibility, Bab 45/48/49/50 transitions). An agent cannot
   perform this read, and substituting one would be exactly the fabrication
   the plan forbids.
3. **Unit economics pass/fail needs the frozen E ceiling.** G.6 judges cost
   "using the ceiling frozen in M10-E" — which does not exist yet.
4. **The live reader KPI can never be closed from QA.** G.7 states
   `reader_inconsistency_report_rate < 3%` cannot be legitimately closed from
   internal QA and must be reported as `BETA_KPI_PENDING` with a tested
   reporting path — "no synthetic rate may be substituted for real reader
   reports". Even a perfect D/E/F chain leaves this row open until live beta.

### What unblocks G

Everything that unblocks D and F, plus pilot-scale budget, committed human
golden-read time, and (for the KPI row) a live beta with real readers — the
last of which is outside M10 entirely.

---

## Decisions required from the decision-maker (complete list)

1. **QA model-call authorization** — approve (or deny) real model calls in the
   isolated QA environment: judges-only first for D, then full pilot for F/G.
   This explicitly overrides the current "no LLM calls" constraint; it cannot
   be assumed.
2. **E.4 unit-economics ceiling** — business-approved numbers for: max cost
   per chapter; max cost per 50-chapter novel; max judge cost per novel; max
   retry overhead %; p95 latency guardrail. The plan forbids inventing these.
3. **Pilot budget** — approved real spend for the F pilot and the G proof
   matrix (≥3 novels + fork runs + judge cost + root-cause re-runs).
4. **Human reviewer time** — D calibration review; F engineering review
   (Bab 1, every act boundary, every HIGH/CRITICAL-flagged chapter, Bab 45–50);
   G golden-novel full read with sign-off.
5. **(Optional) M10-C observability blockers** — authorize closing the six
   capture/reporting gaps so C's gate chain is clean for D/F. They are
   observability defects, not runtime invariants.

---

## What M10 has proven so far (as of `3672d4d`)

| Stage | Status | What was proven |
|---|---|---|
| M10-B | DONE | Deterministic long-horizon evaluators, no-cheating capture, exact-head release gating |
| M10-C | CLOSED AS BLOCKED | Real production runtime drove an isolated Bab 1→50 sync+worker run with parity; tamper probes fail-closed. Six observability capture blockers recorded |
| M10-E | CLOSED AS BLOCKED | 17 fault scenarios over the real runtime: 0 invariant violations, 0 duplicate publications, 0 canonical corruption, 0 terminal failures; bounded repair loop proven; checkpoint reuse proven at mid and late horizons. Cost ceiling not approved; token/cost unmeasurable without model calls; 7 declared fault bullets uncovered |
| M10-D | BLOCKED, not executed | — |
| M10-F | BLOCKED, not executed | — |
| M10-G | BLOCKED, not executed | — |

What is **not** proven anywhere in M10 so far: semantic quality of generated
prose (needs D), behavior under real model outputs (needs F), and multi-novel
final proof with human read and real unit economics (needs G). No artifact in
this repository claims otherwise.

## Production boundary — unchanged

Plan §8 applies in full: even a future D/F/G PASS does not authorize
production migration/deploy, living-canon activation, worker activation, real
reader canary, or beta rollout. Each requires separate approval. M10 evidence
is input to a deployment decision, not the deployment itself.

## STOP

M10-B → G has been taken as far as the standing constraints allow. The plan is
**not** engineering-complete and cannot be until the five decisions above are
supplied. Awaiting decision-maker input.
