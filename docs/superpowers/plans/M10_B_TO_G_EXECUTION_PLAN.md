# Lakoku — M10-B → M10-G Execution Plan

**Status:** EXECUTION-READY (M10-A CLOSED / M10-B NEXT)  
**Drafting baseline:** `46c68e9374e8e57defff421b777f38a419387fac` (`main`, after PR #54 / M10-A1d squash)  
**Execution baseline:** `0997e7dd848eed77b8b480e5fa1057804827d303` (`main`, after PR #55 / M10-A closure correctives)  
**Date:** 6 August 2026  
**Scope:** M10-B, M10-C, M10-D, M10-E, M10-F, M10-G only  
**Governs / follows:** `docs/ARCHITECTURE_v1.1.md`, `docs/NARRATIVE_CONSISTENCY_SPEC.md`, `docs/NARRATIVE_TRACEABILITY_MATRIX.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/audits/M10A_RISK_REGISTER.md`, `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md`

---

## 0. Status Lock

### 0.1 Current status at execution baseline

```text
M10-A audit                     DONE
M10-A1a                        DONE
M10-A1b                        DONE
M10-A1c                        DONE
M10-A1d                        DONE
M10-A full closure             PROVEN — zero reproducible BLOCKER/HIGH (PR #55)

M10-A CLOSED
M10-B NEXT
M10-C                          BLOCKED BY B
M10-D                          BLOCKED BY B+C
M10-E                          BLOCKED BY C
M10-F                          BLOCKED BY B–E
M10-G                          BLOCKED BY F

production activation          FORBIDDEN
production DB mutation         FORBIDDEN without separate explicit approval
real reader data in QA         FORBIDDEN
```

---

## 1. Mandatory Entry Gate — Close M10-A Before Executing This Plan

M10-A1a–A1d closed the Living Canon storage/publication/runtime track, including durable state deltas, atomic V3/V5 publication, plot-debt effective state, 1→50 state evolution, Bab 48/49 fail-closed behavior, and clean-reset proof. That does **not automatically** close every HIGH finding from the original M10-A audit.

At drafting baseline `46c68e9`, the following HIGH surfaces still require explicit closure or evidence-based reclassification before M10-B can start:

| M10-A finding | Current evidence at drafting baseline | Required closure action |
|---|---|---|
| `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE` | `lib/story-engine/chapter-brief.ts::buildChapterBrief()` still resolves `snapshot.blueprints.find(...)` rather than a highest-version resolver | Make all production consumers use the same latest-blueprint authority, then add regression proof |
| `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` — `corePromise` | `lib/prose/prompt-engine/build-writer-prompt.ts` does not emit this anchor directly | Propagate the anchor into bounded writer context/prompt, with long-horizon fixture |
| `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` — `mainConflict` | Same writer boundary lacks the direct anchor | Same as above |
| `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` — `finalQuestion` | Same writer boundary lacks the direct final-question anchor | Make it prompt-visible by the ending runway at minimum, with Bab 45–50 regression |
| `DEAD_PATH_CANDIDATE` — act rollup | A1c/A1d now persist `act_rollups`, but `ContinuationContext` / writer prompt still do not carry them; compiler budget can therefore still be lost at the writer boundary | Bridge T1 rollups into bounded writer context and prove they survive to Bab 45/50 |

Already-closed HIGH/BLOCKER families from the audit must also be re-run, not merely assumed closed:

- `LIVING_CANON_WRITEBACK_MISSING` → A1a–A1d state lifecycle.
- `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED` → effective ledger projection before brief/resolver.
- `PLOT_DEBT_PROGRESS_NOT_PERSISTED` → progress ledger + shared applier + runtime wiring.
- `THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED` → validated delta feeds `advancedThreadIds`.

### M10-A closure DoD

Before flipping this plan to executable:

- [ ] Re-run the M10-A audit on exact current `main`.
- [ ] Zero reproducible **BLOCKER** findings.
- [ ] Zero unresolved **HIGH** findings, unless a HIGH is explicitly reclassified with written evidence and reviewer approval.
- [ ] `docs/audits/M10A_RISK_REGISTER.md` gets a closure addendum or a new version that no longer says `VERDICT: HOLD` for current baseline.
- [ ] Exact closure SHA is written into this document as **Execution baseline**.
- [ ] CI on that exact SHA is green.
- [ ] STOP for reviewer confirmation; only then mark `M10-A CLOSED / M10-B NEXT`.

This entry gate is outside M10-B scope. Do not hide an M10-A problem inside an M10-B evaluator.

---

## 2. Purpose of M10-B → M10-G

M10-A proves that canonical story state can evolve safely. M10-B → M10-G proves that the **whole 50-chapter product can be measured, reproduced, hardened, and finally trusted**.

The sequence is deliberately layered:

```text
M10-B  deterministic long-horizon QA contracts
   ↓
M10-C  reusable isolated Bab 1→50 harness
   ├──────────────→ M10-E reliability + cost hardening
   ↓
M10-D  semantic long-horizon judges
   ↓                 ↓
   └──────────────┬──┘
                  ↓
M10-F  first real-model engineering pilot 1→50 + root-cause fixes
                  ↓
M10-G  final 50-chapter quality proof
```

M10-D and M10-E may proceed in parallel **after M10-C closes**, but M10-F waits for **B, C, D, and E**.

This plan does not add new product requirements. Where NCS/ARCH provide no numeric semantic or cost threshold, the stage must **lock a measured threshold before the pilot** instead of inventing or moving one after results are visible.

---

## 3. Normative Success Contract

### 3.1 NCS §8 remains the top narrative success contract

A story system is ready for 50 chapters when the required proof shows:

1. **0 CRITICAL continuity contradictions** escape publication in the required full-run set.
2. `reader_inconsistency_report_rate < 3%` for beta stories reaching Bab 30+.
3. All required endings remain reachable at each reconciliation checkpoint.
4. Cost per chapter stays inside the approved architecture/business guardrail as context grows.

Important distinction: item 2 is a **live beta KPI**. A synthetic/staging M10 run cannot honestly manufacture real reader report rate. M10-G must therefore report one of:

```text
ENGINEERING_PROOF_PASS / BETA_KPI_PENDING
```

or, if enough real beta data legitimately exists at that time:

```text
ENGINEERING_PROOF_PASS / BETA_KPI_PASS
```

Never mark the live reader KPI as passed from synthetic judges or internal QA reports.

### 3.2 Current NTM posture to carry through M10

At drafting baseline, the current NTM still contains meaningful unfinished rows:

- **G1 reconciliation:** `IN_PROGRESS` across version/drift/reach/spine because runtime checkpoint side-effects are not yet fully production-wired/persisted.
- **G2 memory:** `IN_PROGRESS` for tiers/budget/load-bearing final proof and release gating.
- **G3:** Layer A, Layer B, repair, and metrics are `DONE`.
- **G4:** budget + Bab48 block are `DONE`; status/staleness remain `IN_PROGRESS` pending production side-effects.
- **G5:** alias + voice are `DONE`; `G5-NOCONFLICT` remains `TODO`.

M10-G cannot claim final engineering proof while a relevant NTM row remains open merely because a model-based judge liked the prose.

---

## 4. Global Engineering Rules for All M10-B → G Stages

### 4.1 Canonical authority

- PostgreSQL canonical records remain the source of truth.
- Generated prose can propose state; it never becomes state authority.
- Deterministic evaluator output is **evidence**, not canonical state.
- Semantic judge output is **quality evidence**, not permission to mutate story state.
- No evaluator/judge is allowed to repair a story inside the evaluation pass.

### 4.2 Evaluator no-cheating rule

Every evaluator/judge must declare its allowed input surface.

**Deterministic evaluators may read:**

- committed canonical snapshot for the evaluated chapter;
- committed state delta / chapter commit provenance;
- versioned story contract/blueprint active at that chapter;
- chapter/checkpoint metadata needed for reliability proof;
- reader choice history up to that chapter.

**Deterministic evaluators must not read:**

- hidden fixture labels such as `expected_failure_code`;
- future chapter state when evaluating chapter N, unless the evaluator is explicitly a final-horizon evaluator;
- manually curated “correct answer” annotations at runtime.

**Reader-quality semantic judges may read:**

- reader-visible prose and choices up to the evaluation horizon;
- route history needed to judge continuity and payoff.

They must **not** receive canonical “expected answer” fields that trivially disclose the score.

**Structural semantic judges** may receive bounded story-contract / thread / debt summaries when the rubric explicitly asks whether promises were paid off, but the input contract must be logged and versioned.

**Writer and judge separation:**

- judge policy/version must be distinct from the writer task policy;
- a judge never receives writer hidden reasoning;
- no judge prompt may contain the desired score or “this chapter should pass” label;
- thresholds are frozen before M10-F begins.

### 4.3 Isolation and privacy

- M10-B/C use synthetic/deterministic fixtures only.
- M10-D calibration uses synthetic/staging content or approved internal fixtures.
- M10-E fault tests use isolated local/staging DBs.
- M10-F/G use staging or an isolated QA Supabase project, never production reader data.
- Full prose and model raw output must not be dumped into public CI logs.
- CI artifacts containing story prose must be private/short-retention; committed artifacts contain hashes, scores, finding summaries, and synthetic fixtures only.
- No production database migration, deploy, worker activation, or feature-flag activation is implied by any M10 stage.

### 4.4 No goalpost moving

A red result is fixed by changing product/runtime/evaluator logic for a demonstrated reason — **not** by weakening a threshold after seeing the pilot.

Threshold changes after M10-D/E lock require:

1. written rationale;
2. reviewer approval;
3. version bump;
4. rerun of the entire calibration set;
5. rerun of any pilot used to claim pass.

### 4.5 Reproducibility

Each stage report must include:

```text
base SHA
head SHA
branch / PR
runtime policy versions
model/judge policy versions (when applicable)
DB migration state
seed / route profile ids
artifact manifest hash
exact test commands
gate results
known exclusions
```

### 4.6 Stage STOP discipline

Each stage ends in **STOP for review**. No agent may silently start the next stage because local tests are green.

---

## 5. Artifact and File Conventions

Recommended ownership; exact paths may be adjusted after preflight, but there must be one canonical home per artifact type.

```text
lib/narrative-qa/
  contracts/
  evaluators/
  judges/
  scoring/

fixtures/long-horizon/
  deterministic/
  semantic-calibration/
  route-profiles/

scripts/
  m10-b-*.ts
  m10-c-*.ts
  m10-d-*.ts
  m10-e-*.ts
  m10-f-*.ts
  m10-g-*.ts

tests/narrative-qa/
tests/db/

.zcode/artifacts/m10-b/   # local/CI private artifact, normally not committed
.zcode/artifacts/m10-c/
...
.zcode/artifacts/m10-g/

docs/qa/m10/             # committed sanitized reports / manifests
```

Every stage artifact manifest should include at least:

```ts
interface M10ArtifactManifestV1 {
  schemaVersion: 1
  stage: 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  baselineSha: string
  runId: string
  startedAt: string
  finishedAt: string
  environment: 'local' | 'isolated-qa' | 'staging'
  storyIds: string[]       // synthetic/QA ids only
  routeProfiles: string[]
  runtimePolicyVersions: Record<string, string | number>
  evaluatorVersions: Record<string, string | number>
  judgePolicyVersions?: Record<string, string | number>
  artifactHashes: Record<string, string>
  result: 'PASS' | 'FAIL' | 'BLOCKED'
}
```

No raw secret, provider credential, email, auth token, or production story id may appear in the manifest.

---

# M10-B — Long-Horizon QA Contracts + Deterministic Evaluators

## B.1 Objective

Build **non-LLM, deterministic, versioned evaluators** that can detect long-horizon failure from canonical evidence. M10-B creates the measuring instruments; it does not prove a 50-chapter novel yet.

### Entry gate

```text
M10-A CLOSED
exact execution baseline locked
M10-A audit rerun has zero unresolved BLOCKER/HIGH
```

### Forbidden in M10-B

- real model generation;
- semantic quality scoring;
- production DB/action;
- 50-chapter end-to-end generation as a stage claim;
- changing story behavior merely to satisfy evaluator output without a root-cause finding.

---

## B.2 Deterministic finding contract

Create one shared versioned shape, for example:

```ts
type LongHorizonSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

interface LongHorizonFindingV1 {
  schemaVersion: 1
  code: string
  severity: LongHorizonSeverity
  domain: string
  storyId: string
  chapterNumber?: number
  horizon?: { fromChapter: number; toChapter: number }
  evidence: Array<{
    kind: 'canon' | 'commit' | 'checkpoint' | 'chapter' | 'choice' | 'context' | 'contract'
    ref: string
    detail: Record<string, unknown>
  }>
  message: string
  remediationClass: 'runtime' | 'dataflow' | 'policy' | 'prompt' | 'fixture' | 'observability'
}
```

Rules:

- same input → byte-stable finding ordering and codes;
- finding codes never depend on human prose wording;
- no model/provider call;
- no raw full prose in default finding detail;
- every evaluator has positive and negative fixtures.

---

## B.3 Required evaluator suite

### B.3.1 Canon drift / state evolution evaluator

Detect:

- canon revision discontinuity;
- chapter commit missing/duplicate;
- state delta applied without matching chapter publication;
- published chapter without matching canonical commit for living-v1;
- fact/secret/thread/character/timeline state that does not match committed delta sequence;
- illegal DEAD resurrection / reveal gate bypass;
- stale canon snapshot after a successful publication.

Must work from canonical snapshots and commit ledgers, not prose interpretation.

### B.3.2 Blueprint authority evaluator

Detect:

- multiple blueprint versions with consumers resolving different versions;
- stale blueprint used for brief/policy;
- missing chapter blueprint;
- reconciliation provenance discontinuity;
- act/checkpoint reachability evidence missing.

This evaluator becomes the permanent regression guard for the M10-A blueprint-version fix.

### B.3.3 Plot-debt lifecycle evaluator

Detect:

- debt introduced before/after allowed chapter window;
- required progress milestone omitted;
- duplicate milestone write;
- debt closed twice;
- closed debt still presented as due in a later brief;
- closure after `mustCloseBy`;
- main mystery missing closure at Bab 48;
- ledger / effective-state projection divergence.

### B.3.4 Thread lifecycle evaluator

Detect:

- illegal status transitions;
- active-thread budget > 7;
- new thread at Bab ≥ 41;
- `PAYOFF_DUE` not advanced;
- stale 6-chapter rule + callback deadline violation;
- silent disappearance;
- `ABANDONED_APPROVED` without audited reconciliation provenance;
- post-Bab48 unresolved main mystery.

### B.3.5 Context-pressure / memory evaluator

Detect evidence-level long-horizon degradation:

- T1 act rollup missing at a completed act;
- act rollup exists in DB but is lost before writer boundary;
- LOAD_BEARING fact absent before payoff;
- exclusion log missing for pruned facts;
- whole prompt section eviction where bounded compaction should have preserved a minimum surface;
- global story anchors absent at required writer horizons;
- context budget report inconsistent with actual included sections.

### B.3.6 Choice-history degradation evaluator

Detect:

- duplicate previous choice;
- missing latest accepted choice;
- non-monotonic choice history;
- branch identity overwritten by another choice;
- bounded summary dropping the latest N−1 causal consequence.

### B.3.7 Ending-runway evaluator

Deterministically inspect:

- ending lock durability/atomic provenance at Bab 45;
- no new major conflict/thread after configured closure runway;
- main mystery closure at 48;
- Bab 49 emotional-resolution constraints;
- Bab 50 has no primary reader choice if final policy forbids it;
- Bab 50 does not leave deterministic unresolved debt/thread state;
- ending key used at final publication matches locked ending provenance.

### B.3.8 Basic repetition evaluator

Non-semantic only:

- exact/near-exact paragraph fingerprint repetition across chapters;
- excessive repeated opening/closing strings;
- repeated choice labels/structures above a configured deterministic limit;
- duplicate scene text fingerprints.

This evaluator must **not** claim semantic repetition; that belongs to M10-D.

### B.3.9 Entity/fact no-conflict evaluator — NTM `G5-NOCONFLICT`

Add deterministic proof that conflicting facts for the same canonical entity cannot silently become last-write-wins.

Required negative fixture:

```text
existing canonical fact about character X
→ proposed conflicting fact about the same canonical entity
→ CRITICAL finding / publication blocked
→ original canon remains unchanged
```

This is the natural M10-B closure lane for the current `G5-NOCONFLICT` TODO, but mark NTM `DONE` only when schema/runtime/fixture/gate evidence is actually complete.

---

## B.4 Fixture contract

For every evaluator:

- at least one green fixture;
- at least one isolated red fixture per finding family;
- red fixture must fail for exactly the intended reason, not because setup is invalid;
- fixture metadata containing expected finding codes stays test-only and is never passed into evaluator input;
- mutation used to create a red fixture must be explicit and documented.

Add a “false-positive battery” containing legal edge cases, especially:

- closure exactly at Bab 48;
- ending lock exactly at Bab 45;
- act rollup exactly on valid act boundary;
- legal thread transition + touch in the same chapter;
- exact retry replay with unchanged checkpoint provenance.

---

## B.5 CLI / artifact

One command should produce a machine-readable result, for example:

```text
pnpm m10:b:qa --fixture <id>
```

Output:

```text
.zcode/artifacts/m10-b/<run-id>/findings.json
.zcode/artifacts/m10-b/<run-id>/summary.json
.zcode/artifacts/m10-b/<run-id>/manifest.json
```

### M10-B DoD

- [ ] All deterministic evaluator contracts are versioned.
- [ ] No evaluator calls an LLM/provider.
- [ ] Same fixture run twice → identical sorted findings and hashes.
- [ ] All required red fixtures produce intended codes.
- [ ] False-positive battery is green.
- [ ] `G5-NOCONFLICT` has complete deterministic proof or remains explicitly open with a blocker.
- [ ] Current M10-A audit detectors are either reused or superseded with traceable mappings; no silent duplicate truth source.
- [ ] Typecheck/lint/unit/smoke relevant gates green.
- [ ] Sanitized `M10_B_REPORT.md` committed with exact-head evidence.
- [ ] STOP for review.

### M10-B STOP conditions

- evaluator needs a model call to decide pass/fail;
- evaluator reads future state while claiming chapter-local evidence;
- fixture expected label leaks into evaluator input;
- a known BLOCKER/HIGH is “fixed” by deleting/weakening the detector;
- evaluator output is nondeterministic for identical canonical input;
- M10-A closure evidence regresses.

---

# M10-C — Reusable Isolated 50-Chapter Harness

## C.1 Objective

Build a reusable **Bab 1 → choice → Bab 2 → … → Bab 50** harness that exercises the real production runtime boundaries against an isolated DB, while using deterministic generation inputs so failures are reproducible.

M10-C is not the final quality proof. It is the laboratory in which B/D/E/F/G run.

### Entry gate

```text
M10-B PASS
all deterministic evaluator contracts frozen at B version
```

---

## C.2 Harness non-negotiables

- Uses production runtime functions/RPCs; no test-only chapter insert bypass.
- Initial story/bootstrap setup may use fixture seed helpers.
- After story start, canonical state advances only through normal publication/state paths.
- Every reader choice is submitted through the normal accepted-choice seam used by the harness mode.
- No “skip failed chapter and continue”.
- A failure at Bab N stops that run unless the test case is explicitly a recovery/fault scenario.
- Sync and worker publication modes must be selectable.
- Harness never mutates production or linked DB.

---

## C.3 Run contract

Suggested run spec:

```ts
interface M10HarnessRunSpecV1 {
  schemaVersion: 1
  storyFixtureId: string
  routeProfile: 'high-trust' | 'low-trust' | 'mixed' | string
  publicationMode: 'sync' | 'worker'
  generationMode: 'deterministic'
  chapters: 50
  choicePolicyVersion: string
  checkpointResumePlan: Array<{ chapter: number; mode: 'same-attempt' | 'new-attempt' }>
  forkPlan?: Array<{ chapter: number; choiceIds: string[] }>
}
```

Per-chapter capture must include hashes/summaries for:

- chapter publication result;
- `chapter_state_commits`;
- canon revision;
- state delta hash;
- facts / character states / knowledge / secrets / timeline;
- thread status/staleness;
- plot-debt progress/closure ledgers;
- act rollups;
- reader route/choice history;
- checkpoint schema/provenance;
- context packet budget summary;
- B evaluator findings.

---

## C.4 Required harness capabilities

### C.4.1 Full 1→50 deterministic run

One command creates an isolated story and completes all 50 chapters with no manual state patch.

### C.4.2 Sync/worker parity mode

The harness must be able to run equivalent input through:

```text
sync schema-3 → V3
worker schema-3 → V5
```

and normalize only legitimate provenance differences (`source_job_id`, worker-only job metadata, timestamps/opaque IDs). Canonical narrative end-state must match.

### C.4.3 Resume/retry injection

At minimum prove:

- one mid-story checkpoint resume (≤ Bab 20);
- one late-story checkpoint resume (≥ Bab 45);
- replay does not increment canon revision twice;
- valid prose checkpoint avoids unnecessary prose regeneration;
- altered provenance/delta fails closed.

### C.4.4 Act-boundary hooks

At every configured act boundary, capture and verify:

- rollup presence;
- reconciliation trigger/result if required;
- ending reachability evidence;
- thread/payoff status;
- blueprint version in effect for the next act.

### C.4.5 Branch-fork support

The harness must be able to clone/restore an isolated canonical snapshot at a legal choice boundary and run two different accepted choices without cross-story contamination.

Do not use branch forks yet as final proof; M10-G defines the required final matrix.

---

## C.5 Known NTM runtime gaps become C blockers

The current NTM has deterministic runtime rows still `IN_PROGRESS`. M10-C is where missing production side-effects become undeniable.

The harness must explicitly prove, not simulate:

- G1 reconciliation version/drift/reach/spine executes through the production runtime at act-end or required on-demand point;
- G2 T1 rollup is written at real act boundaries and reaches the consumer that needs it;
- G4 thread status/touch/staleness changes are real committed side-effects, not only soak-script local mutations.

If C exposes a missing production wire:

1. stop the harness run;
2. open a narrow corrective PR under the C gate;
3. add a regression fixture;
4. rerun from a clean DB/story;
5. do not defer a deterministic missing runtime side-effect to the real-model pilot.

---

## C.6 Reproducibility requirement

Two clean runs using the same run spec must produce identical normalized canonical hashes at every chapter.

Allowed differences:

- timestamps;
- generated UUIDs/correlation ids;
- job provenance in worker mode.

All allowed differences must be explicitly normalized; never blanket-drop an entire table to make parity green.

### M10-C DoD

- [ ] Clean isolated DB can run Bab 1→50 without manual state patch.
- [ ] Sync and worker modes supported.
- [ ] Per-chapter artifacts + B findings are captured.
- [ ] Two identical runs produce identical normalized canonical hashes.
- [ ] Mid + late checkpoint resume proven.
- [ ] Act boundary hooks proven from production runtime.
- [ ] Branch-fork primitive exists and is isolated.
- [ ] Known NTM G1/G2-TIERS/G4 status-stale runtime gaps are either proven closed or remain explicit C blockers.
- [ ] Harness can be executed by CI/QA with one documented command.
- [ ] `M10_C_HARNESS_REPORT.md` records exact-head evidence.
- [ ] STOP for review.

### M10-C STOP conditions

- direct table mutation is required to make normal chapter N succeed;
- a failed chapter is skipped;
- sync and worker produce unexplained canonical divergence;
- resume regenerates or reapplies committed state incorrectly;
- act reconciliation/rollup/thread side-effects are still test-only simulations;
- artifact snapshots include production/private reader data.

---

# M10-D — Semantic Long-Horizon Judges

## D.1 Objective

Measure quality failures that deterministic rules cannot reliably see: pacing, arc progression, semantic repetition, payoff quality, and ending satisfaction.

M10-D judges **do not become story authority**. Their purpose is ranking/flagging and release evidence.

### Entry gate

```text
M10-B PASS
M10-C PASS
semantic calibration fixtures available from deterministic harness output
```

---

## D.2 Judge dimensions

At minimum create versioned rubrics for:

1. **Pacing** — scene/chapter progression does not stall or rush relative to act position.
2. **Character progression** — protagonist/core characters change in a traceable way rather than reset each chapter.
3. **Conflict escalation/convergence** — pressure grows appropriately and contracts into the closure runway instead of opening endless new conflict.
4. **Semantic repetition** — scenes, revelations, emotional beats, and choices do not repeat with superficial wording changes.
5. **Chapter purpose** — each chapter materially advances plot, character, clue/debt, route, or payoff.
6. **Payoff quality** — planted promises, mysteries, and PAYOFF_DUE threads receive understandable payoff proportional to setup.
7. **Ending satisfaction** — ending follows the locked route, answers the final dramatic question, resolves major promises, and does not feel like an arbitrary stop.

Optional secondary rubrics may be added only if they are traceable to NCS/PRD and versioned before F.

---

## D.3 Two judge views

### D.3.1 Reader-view judge

Input:

- reader-visible chapter prose;
- accepted choices / consequences visible to the reader;
- previous chapter excerpt as a reader experienced it.

No canonical expected answer. Used for pacing, repetition, emotional arc, ending satisfaction.

### D.3.2 Structural-view judge

Input may additionally include bounded:

- story promise/main conflict/final question;
- active/resolved thread summaries;
- debt/payoff schedule;
- locked ending key/name;
- act position.

Used for payoff, promise fulfillment, and long-horizon purpose. It must not receive a hidden “correct score”.

---

## D.4 Judge output contract

Example:

```ts
interface SemanticJudgeFindingV1 {
  schemaVersion: 1
  rubricId: string
  rubricVersion: number
  horizon: { fromChapter: number; toChapter: number }
  score: number
  confidence: number
  findingCodes: string[]
  evidenceChapterNumbers: number[]
  rationaleSummary: string   // bounded; no hidden chain-of-thought requirement
}
```

Store a concise rationale/evidence summary; do not require or persist hidden reasoning.

---

## D.5 Calibration before threshold lock

NCS does not provide numeric thresholds for these semantic dimensions. Therefore D must establish them **before M10-F**.

Calibration set must contain intentionally:

- strong examples;
- clearly weak examples;
- near-boundary ambiguous examples;
- repeated-scene examples;
- underpaid mystery examples;
- rushed and stalled ending examples.

For each rubric:

- prove strong fixtures score meaningfully above weak fixtures;
- inspect false positives/negatives with a human reviewer;
- record judge-policy version and prompt hash;
- freeze threshold/config in source before pilot prose is judged.

Do not tune thresholds using M10-F/G final stories.

---

## D.6 Semantic repetition horizon

Judge at multiple horizons:

```text
chapter-local: N vs N-1/N-2
act-local: current act
novel-wide: 1..N
ending runway: 41..50
```

The evaluator may use embeddings/similarity **for QA only**. Vector similarity remains non-authoritative and cannot mutate canon or decide a fact.

### M10-D DoD

- [ ] Seven required rubric families are versioned.
- [ ] Reader-view and structural-view inputs are separated.
- [ ] Calibration fixtures have human-reviewed expected ordering.
- [ ] Judge policy is distinct from writer policy.
- [ ] Strong-vs-weak calibration behaves as expected.
- [ ] Numeric thresholds are frozen before F.
- [ ] Judge output is schema-validated and bounded.
- [ ] No hidden expected label enters judge input.
- [ ] Judge cost is measured and included in E unit economics.
- [ ] `M10_D_SEMANTIC_JUDGE_REPORT.md` committed.
- [ ] STOP for review.

### M10-D STOP conditions

- thresholds are changed after seeing M10-F/G story scores without formal re-calibration;
- judge prompt includes expected score/pass label;
- same provider response is used as both writer output and judge verdict without an independent task call;
- semantic judge automatically changes canonical state or republishes chapters;
- calibration cannot separate intentionally good vs intentionally bad fixtures.

---

# M10-E — Reliability & Cost Hardening

## E.1 Objective

Quantify and harden the probability, latency, retry behavior, and cost of completing a 50-chapter novel.

M10-E asks: **Can the system reach 50 reliably and economically, not just correctly when nothing fails?**

### Entry gate

```text
M10-C PASS
fault-injection hooks can run against the same isolated harness
```

M10-D is not required to start E, but F waits for both D and E.

---

## E.2 Reliability test matrix

Inject failures at controlled boundaries, including:

### Provider / structured-output failures

- timeout before first byte;
- timeout after partial response;
- 429 / retryable provider failure;
- non-retryable provider failure;
- malformed prose structured output;
- malformed choices output;
- malformed structured state proposal/delta candidate;
- provider fallback succeeds;
- all provider candidates exhausted.

### Worker / checkpoint failures

- process stop after valid prose checkpoint;
- ownership/heartbeat loss;
- stale lease reclamation;
- retry with exact same checkpoint;
- retry with altered checkpoint provenance;
- attempt-ahead checkpoint;
- expired checkpoint;
- schema mismatch;
- state delta hash mismatch.

### Publication / DB failures

- DB transient before publication;
- V2/V3/V5 publication uncertainty/retry;
- duplicate publish attempt;
- sync-vs-worker race;
- transaction failure after chapter insert but before state commit — must fully rollback;
- transaction failure after state applier but before terminalization — must fully rollback;
- stale canon revision;
- commit-ledger replay with mismatched provenance.

### Post-publish failures

- analytics/attempt record failure;
- notification/outbox failure;
- non-critical observability failure.

Published chapter/canon must remain valid; optional post-publish failures cannot undo publication.

---

## E.3 Reliability measurements

Collect per chapter and per novel:

- first-attempt success rate;
- retry success rate;
- terminal failure rate;
- checkpoint reuse rate;
- prose-regeneration-on-choice-retry rate;
- ownership-loss recovery rate;
- duplicate publication count;
- canonical corruption count;
- p50/p95 generation latency;
- p50/p95 recovery latency;
- provider call count by task;
- retry count by task;
- token/input/output usage by task;
- estimated and actual provider cost where available.

### Cumulative failure probability

Do not infer 50-chapter reliability from one chapter.

Produce:

- empirical chapter-stage failure distribution;
- observed full-novel completion rate in repeated isolated runs/fault scenarios;
- an offline cumulative/Monte-Carlo estimate using measured stage probabilities, clearly labelled as an estimate rather than observed truth.

The report must distinguish:

```text
observed data
modeled estimate
assumption
```

---

## E.4 Cost guardrail lock

ARCH requires cost guardrails but does not supply a numeric ceiling in the available normative text. Therefore M10-E.0 must lock a business-approved numeric budget before F.

Required budget dimensions:

```text
max expected generation cost / chapter
max expected generation cost / 50-chapter novel
max judge/evaluation cost / novel
max retry-overhead percentage
optional p95 cost guardrail
```

The ceiling must be based on:

- current provider pricing/config at execution time;
- measured task token use from the harness;
- expected retry/fallback policy;
- approved product unit economics.

Do not invent the number in this plan and do not silently raise it after a pilot fails.

---

## E.5 Recovery guarantees

Required invariants under every fault scenario:

- no chapter publishes twice;
- no canon revision increments twice;
- no partial canonical state survives rollback;
- valid prose checkpoint can resume choice-only where contract allows;
- stale worker cannot publish after ownership loss;
- exact replay returns canonical prior result;
- altered replay fails conflict;
- final story can continue after a recoverable fault without manual DB mutation.

### M10-E DoD

- [ ] Fault matrix implemented and repeatable.
- [ ] All safety invariants hold under every injected failure class.
- [ ] No unbounded retry loop.
- [ ] Latency/token/cost instrumentation captured at task/chapter/novel levels.
- [ ] Numeric unit-economics guardrail frozen before F.
- [ ] Cumulative failure estimate produced with assumptions separated from observations.
- [ ] Recovery from checkpoint demonstrated at mid and late horizons.
- [ ] `G2-BUDGET` has cost/release evidence sufficient for its NTM status or remains explicitly blocked.
- [ ] `M10_E_RELIABILITY_COST_REPORT.md` committed.
- [ ] STOP for review.

### M10-E STOP conditions

- any injected failure causes duplicate publication or partial canon mutation;
- retry can silently regenerate/replace committed narrative state;
- cost is unavailable at novel level;
- cost ceiling is changed after F begins without formal re-baseline;
- production traffic/data is used for fault injection;
- a post-publish optional subsystem can roll back a valid chapter.

---

# M10-F — First Real 1→50 Engineering Pilot + Root-Cause Fixes

## F.1 Objective

Run **one complete 50-chapter novel with the real production writer/provider policy** through the production runtime in an isolated QA/staging environment, with all B deterministic evaluators, D semantic judges, and E reliability/cost telemetry enabled.

This is the first place the full long-horizon system is tested against real model behavior.

### Entry gate

```text
M10-B PASS
M10-C PASS
M10-D PASS — thresholds frozen
M10-E PASS — reliability + cost guardrails frozen
production activation still forbidden
```

---

## F.2 Pilot freeze

Before generating Bab 1, write a pilot manifest that freezes:

- exact code SHA;
- DB migration baseline;
- story contract / template version;
- writer/provider policy version;
- choice policy version;
- validator/repair policy versions;
- deterministic evaluator versions;
- judge rubric/prompt versions;
- semantic thresholds;
- cost guardrails;
- selected route profile;
- seed inputs.

Changing any of these creates a new pilot run id.

---

## F.3 Pilot execution

```text
bootstrap isolated story
→ Bab 1 real model
→ deterministic validation
→ semantic evaluation artifact
→ publish
→ accepted route choice
→ ...
→ Bab 50
```

Run normally; do not intentionally inject E faults into the primary F pilot. Reliability telemetry still records naturally occurring retries/fallbacks.

At each act boundary, record:

- reconciliation result and active blueprint version;
- ending reachability;
- context budget + act rollup evidence;
- thread/debt status;
- deterministic findings;
- semantic act-level scores;
- accumulated cost.

At Bab 45–50 increase review density: every chapter receives all ending/payoff semantic rubrics and deterministic runway checks.

---

## F.4 Root-cause loop

A red pilot is not automatically a failed milestone. F explicitly allows root-cause engineering fixes.

Classify each issue:

```text
RUNTIME_STATE
PROMPT_DATAFLOW
MODEL_BEHAVIOR
VALIDATOR_POLICY
CHOICE_PATH
RECONCILIATION
CONTEXT_COMPACTION
RELIABILITY
COST
DETERMINISTIC_EVALUATOR_BUG
SEMANTIC_JUDGE_CALIBRATION_BUG
```

For every product/runtime fix:

1. reproduce in a minimal fixture;
2. add deterministic/semantic regression evidence;
3. fix root cause;
4. rerun affected lower-level suites;
5. run a **fresh full 1→50 pilot** when the fix can alter canonical trajectory, prompt context, reconciliation, choices, or ending behavior.

Partial resume may be used for diagnosis, but it cannot be the final pass proof after a trajectory-affecting fix.

### Evaluator/judge bug rule

If the evaluator is wrong, fix it only with calibration evidence. Never weaken an evaluator simply because the real story received a red score.

---

## F.5 Human engineering review

A reviewer must inspect at minimum:

- Bab 1;
- every act boundary;
- every chapter flagged HIGH/CRITICAL by B/D;
- Bab 45, 46, 47, 48, 49, 50.

This is an engineering review, not yet the full golden-novel human read required by G.

### M10-F DoD

- [ ] One fresh real-model story reaches Bab 50.
- [ ] Zero deterministic BLOCKER/CRITICAL publication escapes.
- [ ] No unresolved HIGH product defect from the final run.
- [ ] Semantic dimensions pass thresholds frozen in D.
- [ ] Ending runway/payoff checks pass.
- [ ] Reconciliation/rollup/thread/debt side-effects are production-runtime evidence, not fixture simulation.
- [ ] Reliability behavior stays inside E guardrails.
- [ ] Total chapter + novel cost stays inside E unit-economics ceiling.
- [ ] All root-cause fixes have regression evidence.
- [ ] Final pilot is re-run from a clean story after any trajectory-affecting fix.
- [ ] `M10_F_ENGINEERING_PILOT_REPORT.md` committed.
- [ ] STOP for review before G.

### M10-F STOP conditions

- threshold/guardrail is relaxed to make the pilot pass;
- an evaluator is disabled without calibration proof;
- a chapter is manually edited in DB/prose artifact to continue;
- a failed chapter is skipped;
- real production reader data is copied into the pilot;
- any canonical corruption/duplicate publication occurs;
- cost cannot be attributed to the pilot novel.

---

# M10-G — Final 50-Chapter Quality Proof

## G.1 Objective

Produce the final engineering evidence that the system can generate multiple complete novels to Bab 50 with controlled route variation, long-horizon continuity, acceptable semantic quality, reliable recovery, and known unit economics.

M10-G is a **proof run**, not an exploratory tuning stage.

### Entry gate

```text
M10-F PASS on a fresh final pilot
all thresholds/policies frozen
no open P0/P1 from B–F
```

---

## G.2 Minimum final proof matrix

### G.2.1 Three complete novels × 50 chapters

Run at least three distinct QA story contracts/novels:

| Novel | Required route profile | Chapters |
|---|---|---:|
| G-1 | high-trust | 50 |
| G-2 | low-trust | 50 |
| G-3 | mixed | 50 |

Do not merely clone the same prose/story state with different labels. The three stories must exercise distinct choices/state trajectories while staying under the same released template/runtime policy being proven.

For each novel capture:

- all B deterministic evaluator results;
- all D semantic rubric aggregates;
- checkpoint/reconciliation evidence;
- ending reachability at required act checkpoints;
- final ending lock/result;
- cost/latency/retry report;
- canonical artifact hashes.

### G.2.2 Branch-fork proof

Before the final run starts, choose at least two legal fork points:

- one early/mid-story fork;
- one late-story fork.

For each fork:

1. fork from the same pre-choice canonical snapshot;
2. submit two different legal choices;
3. run both branches through the next act boundary;
4. at least one late fork must continue both alternatives to Bab 50;
5. prove no cross-branch state leakage;
6. prove branch consequences remain visible and endings remain policy-valid.

Fork chapter numbers are selected from the actual template topology and frozen in the G manifest — do not cherry-pick after seeing failures.

---

## G.3 Golden novel full human read

One of the three novels is designated **golden** before generation.

A human reviewer reads **all 50 chapters**, in order, as a reader would.

Human rubric must explicitly record:

- continuity/confusing contradictions;
- character progression;
- repeated scenes/phrases/choices;
- pacing by act;
- clue/mystery comprehensibility;
- thread/payoff satisfaction;
- choice consequence visibility;
- Bab 45 ending lock transition;
- Bab 48 mystery closure;
- Bab 49 emotional resolution;
- Bab 50 finality/satisfaction.

The human read does not replace automated judges; disagreement is recorded and investigated.

No silent manual prose correction is allowed inside the proof run.

---

## G.4 Final deterministic gates

Across all G proof runs:

- zero canonical corruption;
- zero duplicate publication;
- zero unhandled BLOCKER/CRITICAL deterministic finding that reached publication;
- no unresolved main mystery after Bab 48;
- no illegal thread/secret/character-state transition;
- final canon revision/commit sequence complete;
- all required act rollups/reconciliation records present;
- branch histories remain isolated.

---

## G.5 Final semantic gates

Use thresholds frozen in M10-D.

Required dimensions:

```text
pacing
character progression
conflict escalation/convergence
semantic repetition
chapter purpose
payoff quality
ending satisfaction
```

Do not average away a catastrophic ending or payoff failure. The aggregation config must have hard-fail rules for dimensions/chapters designated critical during D calibration, especially the ending runway.

---

## G.6 Final unit-economics proof

For each novel and aggregate 3-novel set report:

- writer/provider cost;
- repair/fallback cost;
- choice-generation cost;
- semantic judge cost;
- total cost/chapter;
- total cost/novel;
- p50/p95 chapter cost;
- retry overhead;
- full-novel latency distribution;
- cost by act / ending runway.

Pass/fail uses the ceiling frozen in M10-E.

---

## G.7 NTM and release-gate closure

Before M10-G is called engineering-complete:

- revisit every NTM row touched by M10;
- mark `DONE` only where all required schema/runtime/fixture/metric/gate evidence exists;
- integrate the M10 final gate into the existing release gate (`release:m9` or its canonical successor) so a stale/missing proof cannot silently pass a release;
- gate must bind to exact template/runtime/evaluator policy versions, not merely the existence of an old report file.

Expected rows to scrutinize closely:

```text
G1-VERSION / G1-DRIFT / G1-REACH / G1-SPINE
G2-TIERS / G2-BUDGET / G2-LOADBEAR
G4-STATUS / G4-STALE
G5-NOCONFLICT
```

Rows already `DONE` must still have regression proof on the final baseline.

### Live beta metric exception

`reader_inconsistency_report_rate < 3%` cannot be legitimately closed from internal QA alone.

If G occurs before sufficient beta data:

```text
M10-G engineering result: PASS
NCS §8 reader KPI: BETA_KPI_PENDING
```

The dashboard/reporting path must be ready and tested, but no synthetic rate may be substituted for real reader reports.

---

## G.8 Final deliverables

```text
docs/qa/m10/M10_G_FINAL_50_CHAPTER_PROOF.md
docs/qa/m10/M10_G_GOLDEN_NOVEL_HUMAN_READ.md
docs/qa/m10/M10_G_UNIT_ECONOMICS.md
docs/qa/m10/M10_G_NTM_CLOSURE.md
.zcode/artifacts/m10-g/<run-id>/manifest.json
```

The sanitized final proof document must identify every raw/private artifact by hash/ref without embedding private raw provider output.

### M10-G DoD

- [ ] 3 distinct novels × 50 chapters complete.
- [ ] Required high-trust / low-trust / mixed profiles complete.
- [ ] Required branch-fork matrix passes, including a late fork to Bab 50.
- [ ] B deterministic evaluator gate passes across final set.
- [ ] D semantic gate passes using frozen thresholds.
- [ ] Golden novel receives full 50-chapter human read and sign-off.
- [ ] Ending/payoff/arc/repetition/pacing all explicitly evaluated.
- [ ] E reliability and cost guardrails pass.
- [ ] No unresolved P0/P1 engineering defect.
- [ ] NTM in-scope rows are updated from evidence, not assertion.
- [ ] Exact-head CI/release gate passes.
- [ ] Production activation remains a **separate decision** after this proof.

### M10-G STOP / FAIL conditions

- any final novel requires manual DB/prose patch to finish;
- deterministic BLOCKER/CRITICAL escapes publication;
- a locked semantic hard-fail threshold is missed;
- ending reachability fails at a required checkpoint;
- main mystery remains unresolved after Bab 48;
- canonical state or branch isolation corrupts;
- novel cost exceeds the E ceiling without prior approved re-baseline;
- evaluator/judge threshold is changed after seeing G output;
- golden human read finds an unresolved release-blocking continuity/payoff defect;
- proof uses production reader data without approved privacy process.

---

# 6. Cross-Stage Dependency / Closure Matrix

| Capability / evidence | B | C | D | E | F | G |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Deterministic long-horizon contracts | **Build** | Use | Use | Use | Gate | Final gate |
| Reusable 1→50 harness | — | **Build** | Use | Use | Use | Use |
| Canon/plot-debt/thread deterministic checks | **Build** | Prove runtime | — | Fault-test | Gate | Final gate |
| Reconciliation + T1 + thread side-effect E2E | Detect | **Prove/fix blocker** | Observe | Fault-test | Gate | Final gate |
| Semantic pacing/arc/payoff judges | — | — | **Build/calibrate** | Cost input | Gate | Final gate |
| Reliability/fault injection | — | Harness support | — | **Build** | Observe | Final gate |
| Numeric unit economics | — | Measure raw | Judge cost | **Lock** | Gate | Final proof |
| Real production model | FORBIDDEN | FORBIDDEN | Judge only | Optional controlled measurement | **1 novel** | **≥3 novels** |
| Full human read | — | — | Calibration only | — | Engineering sample | **1 golden 50-chapter novel** |
| NTM final closure | map | runtime evidence | semantic evidence | cost/gate evidence | provisional | **final engineering sign-off** |

---

# 7. Required Stage Review Report Format

At every STOP point, the implementation agent returns this exact class of evidence:

```text
Stage:
Base SHA:
Head SHA:
Branch:
PR:
Changed files:
Schema/migration changes:
Runtime activation changes:
Production action: NONE

Artifacts:
- manifest path + hash
- findings/report paths

Gates:
- typecheck
- lint
- unit
- DB/pgTAP if relevant
- smoke
- stage-specific command
- exact-head CI

Results:
- PASS/FAIL counts
- finding codes by severity
- semantic thresholds/scores if relevant
- cost/latency if relevant

NTM mapping:
- rows improved
- rows still open

Known exclusions / risks:

STOP — awaiting reviewer verdict.
```

Do not report “all green” without exact counts/commands where a stage has a numeric suite.

---

# 8. Production / Deployment Boundary

M10-B → G does **not** authorize production activation.

Even after M10-G PASS:

```text
production migration/deploy          requires separate approval
living-canon feature activation      requires separate approval
worker activation                    requires separate approval
real reader canary                   requires separate approval
beta rollout                          requires release/product approval
```

A final M10-G proof is evidence for a deployment decision, not the deployment itself.

---

# 9. Final Definition of “M10 Complete”

M10 can be declared engineering-complete only when:

1. M10-A has an evidence-backed closure baseline.
2. B deterministic evaluators are stable and no-cheating.
3. C isolated 1→50 harness is reproducible.
4. D semantic judges are calibrated with frozen thresholds.
5. E reliability + cost guardrails are measured and frozen.
6. F one real-model 1→50 pilot passes after root-cause fixes.
7. G final proof passes ≥3 complete novels, branch forks, one full human-read golden novel, semantic/deterministic gates, and unit economics.
8. Relevant NTM rows are closed from actual row-level evidence.
9. Any live-only KPI is explicitly labelled `BETA_KPI_PENDING`, never faked.
10. Exact final baseline + policy versions are bound to the release gate.

Only then may the project move from “we can generate 50 chapters” to “we have engineering evidence that Lakoku can sustain 50 chapters.”

---

# 10. Immediate Next Action

Because this document is drafted at `46c68e9` while M10-A full closure is not yet proven, the **next executable action is not M10-B**.

It is:

```text
Re-run M10-A risk register on exact main 46c68e9
→ close/reclassify remaining HIGH findings with evidence
→ merge corrective PR(s)
→ rerun M10-A audit
→ zero BLOCKER/HIGH
→ lock new exact main SHA
→ update this document:
   Status = EXECUTION-READY
   Execution baseline = <new SHA>
   M10-A CLOSED
   M10-B NEXT
→ reviewer approval
→ begin M10-B.0
```

Until then, M10-B remains **BLOCKED**, even though the B→G plan is now fully specified.
