# M10-B Stage Report — Deterministic Evaluator Suite (R1 rework)

**Status:** M10-B.1 R1 REWORK COMPLETE — **M10-B NOT CLOSED** (awaiting reviewer)
**M10-A closure anchor:** `0997e7dd848eed77b8b480e5fa1057804827d303` (immutable; NOT the stage base)
**Stage B base SHA:** `ef12234c648d6b93c6e1f039df0a234c686f5774`
**Previous head (R1 HOLD):** `38a5e75aec51f655c75ec8b0f4010f0b12544f06`
**New head SHA:** _filled at commit time — see §8_

**Scope guard held:** no LLM/model calls, no semantic scoring, no M10-C 1→50 harness, no production DB mutation, no production activation, no runtime behavior changed to satisfy an evaluator.

---

## 1. What R1 changed

Reviewer raised 5 BLOCKERs. Each is addressed below with the concrete mechanism, not a claim.

### BLOCKER 1 — temporal validator was bypassable

`walkAndAssertChapters()` (reflective, name-based) is **deleted**. `validateEvaluatorEnvelope` now takes a **required second argument**:

```ts
export type TemporalExtractor<TInput> = (input: TInput) => ChapterRef[]
export type ChapterRefKind = 'OBSERVED' | 'DECLARED_DEADLINE'
export interface ChapterRef { path: string; chapter: number; kind: ChapterRefKind }
```

- Every evaluator exports its own extractor that enumerates **every** chapter-bearing field by dotted path, including `introducedChapter`, `lastTouchedChapter`, `mustCloseByChapter`, `closedChapter`, and array elements such as `progresses[0].closedChapter`.
- `OBSERVED` refs must be ≤ `evaluatedChapter` (CHAPTER_LOCAL) or inside `[fromChapter, toChapter]` (HORIZON / FINAL_HORIZON).
- `DECLARED_DEADLINE` refs (contract obligations such as `mustCloseByChapter = 48` read at Bab 10, act-plan `actToChapter`) are bounds-checked `1..50` but exempt from the past-only rule, so a legal forward obligation does not become a false invocation error.
- Calling without an extractor throws `InvalidEvaluatorInvocationError`.
- Violations are **test failures**, never story findings.

Proof: `tests/narrative-qa/m10-b-evaluators.test.ts` → `describe('temporal safety by construction')`, 5 cases including a future chapter on a non-`chapterNumber` field name and one nested inside an array (asserts the exact path `progresses[0].closedChapter`).

### BLOCKER 2 — suite implemented only a fraction of the B.3 contract

All 8 active evaluators rewritten at version `1.1.0` with full B.3 code coverage (matrix in §2). Inputs that were **precomputed caller conclusions** are removed; each evaluator now derives its verdict from raw canonical evidence:

| Removed precomputed input | Replaced by |
|---|---|
| `effectiveStateProjected: boolean` | `projectedState: ProjectedDebtState[] \| null` — evaluator compares projection vs ledger and emits `PLOT_DEBT_PROJECTION_DIVERGENCE` |
| `mainMysteryClosedAt48: boolean` | derived from `ledgerEvents` + `contracts[].mustCloseByChapter` |
| `wholeSectionEvicted: boolean` | `sections[].itemsBeforeCompaction / itemsIncluded / minimumRetainedItems` |
| `actRollupInContext` / `actRollupRequired` | `actRollups[].presentInDb` + `.presentAtWriterBoundary` vs act-plan boundary |
| `lockedEndingKeyMatch: boolean` | `lock.lockedEndingKey` vs chapter-50 `endingKey` |

### BLOCKER 3 — thread evaluator used non-canonical statuses

Now imports the canonical domain type and the **existing** G4 predicates rather than re-declaring rules:

```ts
import type { ThreadStatus } from '../../narrative/types'      // OPEN | DEVELOPING | PAYOFF_DUE | RESOLVED | ABANDONED_APPROVED
import {
  MAIN_MYSTERY_BLOCK_CHAPTER, MAX_ACTIVE_THREADS, NO_NEW_THREAD_FROM_CHAPTER,
  STALE_AFTER_CHAPTERS, STALE_CALLBACK_WINDOW, canTransition,
} from '../../narrative/threads'
```

The old `'T3'`-style statuses are gone from evaluators and fixtures.

### BLOCKER 4 — `G5-NOCONFLICT = DONE` was unsupported

Reverted. See §4. Disposition is now `OPEN_BLOCKED_NO_RUNTIME_AUTHORITY` and the evaluator is deliberately inert at version `0.0.0-blocked`.

### BLOCKER 5 — CLI could report PASS with broken red detectors

`scripts/m10-b-qa.ts` is fail-closed. Old logic:

```ts
result: greenFindings.length === 0 && fpFindings.length === 0 ? 'PASS' : 'FAIL'   // red ignored
```

New logic — every fixture (green, red, false-positive) must match its expected-code contract **exactly**:

```ts
const failedFixtures = outcomes.filter((o) => !o.passed).map((o) => o.fixtureId)
const result = failedFixtures.length === 0 ? 'PASS' : 'FAIL'
```

`outcome.passed` requires `missingFindingCodes.length === 0 && unexpectedFindingCodes.length === 0`. A red detector that stops firing produces `missing` codes → `FAIL`. Regression test: `'fails closed when a red detector stops firing'`.

Runner also fixed: `pnpm m10:b:qa` invoked `tsx`, which is not installed. It now uses the repo's real jiti runner via a side-effect-free CLI wrapper (`scripts/m10-b-qa-cli.ts`), so importing `m10-b-qa.ts` from tests writes no artifacts.

---

## 2. Evaluator / finding matrix

| Evaluator ID | Version | Mode | Finding codes emitted |
|---|---|---|---|
| `canon-drift` | `1.1.0` | `CHAPTER_LOCAL` | `CANON_WRITEBACK_MISSING`, `STATE_DELTA_WITHOUT_CHAPTER_PUBLICATION`, `CHAPTER_COMMIT_DUPLICATE`, `CHAPTER_COMMIT_MISSING`, `CANON_REVISION_DISCONTINUITY`, `CANON_SNAPSHOT_STALE`, `ILLEGAL_DEAD_RESURRECTION`, `CANON_STATE_DELTA_SEQUENCE_MISMATCH`, `REVEAL_GATE_BYPASS` |
| `blueprint-authority` | `1.1.0` | `CHAPTER_LOCAL` | `CHAPTER_BLUEPRINT_MISSING`, `STALE_BLUEPRINT_USED_FOR_BRIEF`, `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE`, `BLUEPRINT_RECONCILIATION_PROVENANCE_DISCONTINUITY`, `ACT_CHECKPOINT_REACHABILITY_EVIDENCE_MISSING` |
| `plot-debt-lifecycle` | `1.1.0` | `CHAPTER_LOCAL` | `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED`, `PLOT_DEBT_INTRODUCED_OUTSIDE_WINDOW`, `PLOT_DEBT_MILESTONE_DUPLICATE`, `PLOT_DEBT_MILESTONE_OMITTED`, `PLOT_DEBT_CLOSED_TWICE`, `PLOT_DEBT_CLOSED_AFTER_DEADLINE`, `PLOT_DEBT_OVERDUE_UNCLOSED`, `MAIN_MYSTERY_UNCLOSED_AT_48`, `PLOT_DEBT_PROJECTION_DIVERGENCE`, `CLOSED_PLOT_DEBT_STILL_DUE_IN_BRIEF` |
| `thread-lifecycle` | `1.1.0` | `CHAPTER_LOCAL` | `ILLEGAL_THREAD_STATUS_TRANSITION`, `THREAD_ABANDONED_WITHOUT_RECONCILIATION_PROVENANCE`, `THREAD_SILENT_DISAPPEARANCE`, `ACTIVE_THREAD_BUDGET_EXCEEDED`, `NEW_THREAD_INTRODUCED_AFTER_40`, `PAYOFF_DUE_THREAD_NOT_ADVANCED`, `STALE_THREAD_CALLBACK_DEADLINE_MISSED`, `STALE_THREAD_DETECTED`, `MAIN_MYSTERY_THREAD_UNRESOLVED_AT_48` |
| `context-memory` | `1.1.0` | `CHAPTER_LOCAL` | `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED`, `ACT_ROLLUP_MISSING_AT_COMPLETED_ACT`, `ACT_ROLLUP_LOST_BEFORE_WRITER_BOUNDARY`, `LOAD_BEARING_FACT_ABSENT_BEFORE_PAYOFF`, `FACT_EXCLUSION_LOG_MISSING`, `WRITER_CONTEXT_WHOLE_SECTION_EVICTION`, `CONTEXT_BUDGET_REPORT_INCONSISTENT`, `CONTEXT_BUDGET_EXCEEDED` |
| `choice-history` | `1.1.0` | `CHAPTER_LOCAL` | `CHOICE_HISTORY_NON_MONOTONIC`, `CHOICE_HISTORY_DUPLICATE_PREVIOUS`, `LATEST_ACCEPTED_CHOICE_MISSING`, `BOUNDED_SUMMARY_DROPPED_LATEST_CONSEQUENCE`, `BRANCH_IDENTITY_OVERWRITTEN` |
| `ending-runway` | `1.1.0` | `FINAL_HORIZON` | `ENDING_LOCK_NOT_DURABLE`, `NEW_MAJOR_CONFLICT_IN_CLOSURE_RUNWAY`, `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING`, `CHAPTER_50_CHOICES_NOT_NULL`, `LOCKED_ENDING_KEY_MISMATCH`, `ENDING_LEAVES_UNRESOLVED_DEBT`, `ENDING_LEAVES_UNRESOLVED_THREAD` |
| `repetition` | `1.1.0` | `HORIZON` | `EXACT_PARAGRAPH_REPETITION`, `DUPLICATE_SCENE_FINGERPRINT`, `REPEATED_OPENING_STRING`, `REPEATED_CLOSING_STRING`, `REPEATED_CHOICE_LABEL` |
| `entity-fact-conflict` | `0.0.0-blocked` | `CHAPTER_LOCAL` | **none — inert, see §4** |

`DEAD_PATH_CANDIDATE` (a vague generic code from the previous round) is removed in favour of the specific `ACT_ROLLUP_LOST_BEFORE_WRITER_BOUNDARY`.

---

## 3. Fixture matrix — isolated per finding family

`fixtures/long-horizon/deterministic/long-horizon-fixtures.ts`. Every red fixture is the green baseline plus **one documented mutation**, and its `envelopes` object contains **only the targeted evaluator**, so it cannot pass or fail for an unrelated reason. `expectedFindingCodes` is fixture metadata consumed by the runner and tests; it is never part of any evaluator input.

**53 fixtures total: 1 green + 45 isolated red + 7 false-positive.**

### Red fixtures (45)

| Evaluator | Fixture → expected codes |
|---|---|
| canonDrift (8) | `red-canon-writeback-missing` → `CANON_WRITEBACK_MISSING`; `red-canon-revision-discontinuity` → `CANON_REVISION_DISCONTINUITY`; `red-chapter-commit-duplicate` → `CHAPTER_COMMIT_DUPLICATE` + `CANON_REVISION_DISCONTINUITY`; `red-state-delta-without-publication` → `STATE_DELTA_WITHOUT_CHAPTER_PUBLICATION`; `red-canon-snapshot-stale` → `CANON_SNAPSHOT_STALE`; `red-illegal-dead-resurrection` → `ILLEGAL_DEAD_RESURRECTION` + `CANON_STATE_DELTA_SEQUENCE_MISMATCH`; `red-canon-state-sequence-mismatch` → `CANON_STATE_DELTA_SEQUENCE_MISMATCH`; `red-reveal-gate-bypass` → `REVEAL_GATE_BYPASS` |
| blueprintAuthority (4) | `red-blueprint-version-divergence` → `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE` + `STALE_BLUEPRINT_USED_FOR_BRIEF`; `red-chapter-blueprint-missing` → `CHAPTER_BLUEPRINT_MISSING`; `red-blueprint-provenance-discontinuity` → `BLUEPRINT_RECONCILIATION_PROVENANCE_DISCONTINUITY`; `red-blueprint-reachability-missing` → `ACT_CHECKPOINT_REACHABILITY_EVIDENCE_MISSING` |
| plotDebt (6) | `red-plot-debt-projection-absent` → `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED`; `red-plot-debt-projection-divergence` → `PLOT_DEBT_PROJECTION_DIVERGENCE`; `red-plot-debt-introduced-outside-window` → `PLOT_DEBT_INTRODUCED_OUTSIDE_WINDOW`; `red-plot-debt-milestone-duplicate` → `PLOT_DEBT_MILESTONE_DUPLICATE`; `red-plot-debt-closed-twice` → `PLOT_DEBT_CLOSED_TWICE` + `CLOSED_PLOT_DEBT_STILL_DUE_IN_BRIEF`; `red-plot-debt-milestone-omitted` → `PLOT_DEBT_MILESTONE_OMITTED` |
| threadLifecycle (5) | `red-thread-illegal-transition` → `ILLEGAL_THREAD_STATUS_TRANSITION`; `red-thread-budget-exceeded` → `ACTIVE_THREAD_BUDGET_EXCEEDED`; `red-thread-abandoned-without-provenance` → `THREAD_ABANDONED_WITHOUT_RECONCILIATION_PROVENANCE`; `red-thread-silent-disappearance` → `THREAD_SILENT_DISAPPEARANCE`; `red-thread-stale-callback-missed` → `STALE_THREAD_CALLBACK_DEADLINE_MISSED` |
| contextMemory (8) | `red-context-anchor-not-propagated` → `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED`; `red-context-act-rollup-lost` → `ACT_ROLLUP_LOST_BEFORE_WRITER_BOUNDARY`; `red-context-act-rollup-missing` → `ACT_ROLLUP_MISSING_AT_COMPLETED_ACT`; `red-context-load-bearing-fact-absent` → `LOAD_BEARING_FACT_ABSENT_BEFORE_PAYOFF`; `red-context-exclusion-log-missing` → `FACT_EXCLUSION_LOG_MISSING`; `red-context-section-eviction` → `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` + `CONTEXT_BUDGET_REPORT_INCONSISTENT`; `red-context-budget-report-inconsistent` → `CONTEXT_BUDGET_REPORT_INCONSISTENT`; `red-context-budget-exceeded` → `CONTEXT_BUDGET_EXCEEDED` |
| choiceHistory (5) | `red-choice-duplicate-previous` → `CHOICE_HISTORY_DUPLICATE_PREVIOUS`; `red-choice-latest-missing` → `LATEST_ACCEPTED_CHOICE_MISSING`; `red-choice-non-monotonic` → `CHOICE_HISTORY_NON_MONOTONIC`; `red-choice-consequence-dropped` → `BOUNDED_SUMMARY_DROPPED_LATEST_CONSEQUENCE`; `red-choice-branch-overwritten` → `BRANCH_IDENTITY_OVERWRITTEN` |
| endingRunway (6) | `red-ending-lock-not-durable` → `ENDING_LOCK_NOT_DURABLE`; `red-ending-key-mismatch` → `LOCKED_ENDING_KEY_MISMATCH`; `red-ending-chapter50-choices` → `CHAPTER_50_CHOICES_NOT_NULL`; `red-ending-new-major-conflict` → `NEW_MAJOR_CONFLICT_IN_CLOSURE_RUNWAY`; `red-ending-chapter49-no-resolution` → `CHAPTER_49_EMOTIONAL_RESOLUTION_MISSING`; `red-ending-unresolved-state` → `ENDING_LEAVES_UNRESOLVED_DEBT` + `ENDING_LEAVES_UNRESOLVED_THREAD` |
| repetition (3) | `red-repetition-exact-paragraph` → `EXACT_PARAGRAPH_REPETITION`; `red-repetition-duplicate-scene` → `DUPLICATE_SCENE_FINGERPRINT` + `EXACT_PARAGRAPH_REPETITION` + `REPEATED_OPENING_STRING` + `REPEATED_CLOSING_STRING`; `red-repetition-choice-label` → `REPEATED_CHOICE_LABEL` |

Multi-code expectations are exact, not "at least". They are listed where one mutation genuinely and necessarily produces more than one true finding (e.g. a duplicate commit row also breaks revision continuity; an identical scene also repeats its opening and closing strings).

### False-positive battery (7) — all must stay silent

1. `fp-main-mystery-closed-exactly-at-48` — main mystery closes **exactly** at Bab 48, evaluated at Bab 48.
2. `fp-ending-lock-exactly-at-45` — ending lock written **exactly** at Bab 45, atomically, honoured at Bab 50.
3. `fp-act-rollup-exactly-on-act-boundary` — act 2 ends exactly at the evaluated chapter and its rollup is present; an act that has not completed yet must not be flagged.
4. `fp-legal-thread-transition-and-touch-same-chapter` — `PAYOFF_DUE → RESOLVED` plus a touch in the same chapter.
5. `fp-exact-retry-unchanged-checkpoint-provenance` — chapter 20 retried with the identical delta hash; a correctly de-duplicating ledger keeps exactly one commit row.
6. `fp-late-thread-touched-within-callback-window` — thread untouched for exactly the stale threshold, not past it.
7. `fp-green-full-suite` — the full green baseline across all nine evaluators.

---

## 4. `G5-NOCONFLICT` disposition — **OPEN / BLOCKED (NOT PROVEN)**

Previous round claimed `DONE`. That claim is **withdrawn**.

```ts
export const G5_NOCONFLICT_DISPOSITION: G5Disposition = 'OPEN_BLOCKED_NO_RUNTIME_AUTHORITY'
```

Read-only evidence at this baseline:

- `supabase/migrations/20260707000000_core_runtime_baseline.sql` — `facts_ledger` columns are exactly `id, story_id, statement, subject_character_id, established_chapter, salience, load_bearing, paid_off`. There is **no structured claim dimension** (no entity/predicate/value), no `supersedes`, no `conflicts_with`, no `retracted_at`.
- `lib/narrative/chapter-state-apply.ts:78,86,92` and `supabase/migrations/20260805020000_living_canon_publication_primitives.sql:372,391,398` — the existing `STATE_FACT_CONFLICT` fires only on (a) duplicate fact id, (b) unknown `markPaidOff` target, (c) add + `markPaidOff` in the same delta. That is an **identity/idempotency guard**, not a contradiction gate.

Therefore a deterministic `ENTITY_FACT_CONFLICT` cannot be proven. Two shortcuts were explicitly **not** taken, per instruction:

- ✗ substituting the `DEAD → ALIVE` character-status check so the row would read `DONE` (that is canon-drift's job and is already covered by `ILLEGAL_DEAD_RESURRECTION`; it is not entity-fact conflict);
- ✗ a pseudo-semantic string matcher over free-text `statement`.

`entity-fact-conflict` therefore ships **inert** at `0.0.0-blocked`, emits nothing, and its header documents the unblocking requirements (structured claim dimension, publication-time conflict authority, deterministic resolution rule, retraction/supersession semantics, migration + pgTAP coverage). The CLI surfaces the disposition on every run so a green result can never be misread as G5 closure.

---

## 5. Runner result (executed twice, byte-identical)

```
$ pnpm m10:b:qa
M10-B Evaluator Suite Execution Summary:
  Result: PASS
  Fixtures: 53
  Red fixtures passed: 45/45
  False-positive fixtures passed: 7/7
  Total findings: 55
  Findings hash: 24f9f0b3a9bb28a1b09f94d4d0fc647a4fc2229331a293cf2e72b2c6283ab0bb
  Summary hash: 1b88c837089ca85b34816e89c4716a1d81cb39e0c857a8a0c66dd39ad1fe8e65
  G5-NOCONFLICT: OPEN_BLOCKED_NO_RUNTIME_AUTHORITY
```

Both invocations produced identical `findingsHash` and `summaryHash`. `runId` is derived from the findings hash (`m10-b-24f9f0b3a9bb`), not wall clock, so repeated runs write byte-identical artifacts.

Severity distribution across all fixtures: BLOCKER 18, HIGH 24, MEDIUM 13, LOW 0, INFO 0 (total 55).

Artifacts: `.zcode/artifacts/m10-b/m10-b-24f9f0b3a9bb/{findings,summary,outcomes,manifest}.json`.

---

## 6. Gate evidence

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | PASS (clean, no output) |
| Lint | `pnpm lint` | PASS — 0 errors, 11 warnings, all pre-existing and outside M10-B files |
| Unit | `pnpm test:unit` | PASS — 155 files, **1967 passed**, 8 skipped (DB-gated) |
| M10-B suite | `pnpm exec vitest run tests/narrative-qa/m10-b-evaluators.test.ts` | PASS — **110 tests** |
| Smoke | `pnpm smoke` | PASS — all suites, ending `personalized-story-smoke: 30/30 PASS` |
| Determinism | `pnpm m10:b:qa` ×2 | identical hashes (§5) |

No production DB was contacted. No production feature was activated.

---

## 7. Test coverage added

`tests/narrative-qa/m10-b-evaluators.test.ts` — 110 tests:

- temporal safety by construction (5): non-`chapterNumber` field name, nested array path assertion, legal `DECLARED_DEADLINE` beyond the evaluated chapter, out-of-range deadline, missing extractor;
- green fixture emits zero findings;
- red fixtures: per-fixture exact expected-code equality (45), per-fixture single-evaluator isolation (45), plus a coverage assertion that all 8 active evaluators have at least one isolated fixture;
- false-positive battery: each of the 7 sets asserted silent individually;
- G5 disposition asserted `OPEN_BLOCKED_NO_RUNTIME_AUTHORITY` and the evaluator asserted to emit nothing;
- determinism: identical findings/summary/outcomes hashes across two runs, and `computeFindingsHash` agrees with the manifest;
- fail-closed: substituting green envelopes into a red fixture yields `passed: false` with non-empty `missingFindingCodes`;
- a green run can never report G5 closure.

---

## 8. Change inventory

```
 fixtures/long-horizon/deterministic/long-horizon-fixtures.ts | 1421 ++++++++++-----
 lib/narrative-qa/contracts/evaluator-contract.ts             |  171 ++-
 lib/narrative-qa/evaluators/blueprint-evaluator.ts           |  217 ++-
 lib/narrative-qa/evaluators/canon-drift-evaluator.ts         |  361 ++++-
 lib/narrative-qa/evaluators/choice-evaluator.ts              |  192 ++-
 lib/narrative-qa/evaluators/context-evaluator.ts             |  318 ++++-
 lib/narrative-qa/evaluators/ending-evaluator.ts              |  233 +++-
 lib/narrative-qa/evaluators/fact-conflict-evaluator.ts       |  134 +-
 lib/narrative-qa/evaluators/plot-debt-evaluator.ts           |  398 +++++-
 lib/narrative-qa/evaluators/repetition-evaluator.ts          |  180 ++-
 lib/narrative-qa/evaluators/thread-evaluator.ts              |  303 ++++-
 package.json                                                 |    2 +-
 scripts/m10-b-qa.ts                                          |  230 +++-
 scripts/m10-b-qa-cli.ts                                      |  new
 tests/narrative-qa/m10-b-evaluators.test.ts                  |  231 +++-
```

`lib/narrative-qa/scoring/canonical-serializer.ts` is unchanged — the reviewer marked it PASS.

---

## 9. Status

- `M10-B NOT CLOSED` — awaiting reviewer verdict on this R1 rework.
- `M10-C BLOCKED BY B` — not started, runtime not extended.
- `G5-NOCONFLICT OPEN / BLOCKED` — needs a separate schema + publication-authority decision before it can be closed.
- `production activation FORBIDDEN`, `production DB mutation FORBIDDEN`, `real reader data in QA FORBIDDEN` — all held.

**STOP discipline active.**
