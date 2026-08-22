# Task 3 Report — Narrative QA Unit Test Suite (`tests/narrative-qa/`)

## Status
DONE — 10 test files + 1 shared helper, 94 tests, all validation green.

## Files created
- `tests/narrative-qa/sample-builder.ts` — shared minimal sample builders for every detector's REAL exported input interface (ChoiceHistoryItem, CanonContextSample, BlueprintVersionEntry, ThreadAuditSample, PlotDebtAuditSample, EndingFixtureEntry, ActRollupLifecycleSample, FinalizationSample, ContractFieldTrace) + `detailOf()` helper that extracts the finding detail JSON from the `PURE_CHARACTERIZATION` evidence observation (the `StoryBibleAuditFinding` contract has no `detail` field — details only live in evidence observations).
- `tests/narrative-qa/story-bible-audit.test.ts` — 13 tests
- `tests/narrative-qa/context-pressure.test.ts` — 10 tests
- `tests/narrative-qa/choice-history-pressure.test.ts` — 14 tests
- `tests/narrative-qa/blueprint-version-audit.test.ts` — 5 tests
- `tests/narrative-qa/plot-debt-lifecycle-audit.test.ts` — 10 tests
- `tests/narrative-qa/ending-lock-parity-audit.test.ts` — 9 tests
- `tests/narrative-qa/thread-signal-audit.test.ts` — 8 tests
- `tests/narrative-qa/act-rollup-lifecycle-audit.test.ts` — 6 tests
- `tests/narrative-qa/writer-propagation-audit.test.ts` — 11 tests
- `tests/narrative-qa/chapter50-finalization-audit.test.ts` — 8 tests

Total: 94 tests, all passing.

## Plan §18 acceptance coverage
- **StoryContract**: exactly 50 targets; acts contiguous 1→50; cutoff 35/40/45/48/49/50 (via `buildSyntheticStoryContract` in story-bible-audit.test.ts).
- **Choice history**: pressure at 10/20/30/40/50 (append-only history clean); recent-choice truncation (CHOICE_HISTORY_RECENT_LOSS HIGH/MEDIUM incl. gap + empty); duplicate previous (CHOICE_HISTORY_DUPLICATE_PREVIOUS); budget pressure (BUDGET_PRESSURE at 150 entries and tiny declaredBudget); 4096-char slice characterization (49 realistic choices fit under the cap — newest AND oldest survive; beyond the cap the newest stays, oldest drops).
- **Blueprint**: multi-version selection characterization (runtime/compiler v2 vs brief v1 → BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE HIGH); parity clean case (all sources same version → no finding).
- **Context**: growing facts / load-bearing / rollups across milestones 10/30/45/50 (monotonic actualUsed, loadBearingIncluded, rollupsIncluded 0→2); excluded/included IDs (RELEVANT_FACT_EVICTION + ROLLUP_EVICTION_PRESSURE on stress cases totalBudget=4000 with loadBearingCost 900/1500/3000/4500); budget overshoot characterization (CONTEXT_DECLARED_BUDGET_OVERSHOOT, no auto-fail — executionStatus stays SUCCESS); detectorsTriggered non-empty regression for buildContextPressureMilestone.
- **Thread**: actual advancement signal traced (THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED HIGH+MEDIUM); staleness lifecycle traced (THREAD_STALENESS_NOT_LOAD_BEARING LOW); open-signal disconnect (THREAD_OPEN_SIGNAL_DISCONNECTED HIGH); all-wired sample clean.
- **Plot debt**: milestone source-of-truth traced (per-milestone progress clean at 10/20, PLOT_DEBT_MILESTONE_MEMORY_GAP when only the second milestone is recorded, PROGRESS_NOT_PERSISTED when none); closure persistence traced (BLOCKER/MEDIUM CLOSE_NOT_PERSISTED); next-chapter reload traced (PLOT_DEBT_NEXT_CHAPTER_STATE_STALE HIGH at Bab 36 after ledger close).
- **Ending**: lock 45 (clean lock lifecycle 44→50); retry 45 (ENDING_LOCK_RETRY_DIVERGENCE BLOCKER); 46–50 cannot switch (no POST45_SWITCH when locked; BLOCKER when it does); ENDING_LOCK_NOT_DURABLE; worker/legacy parity (v2 path at 45 → ENDING_LOCK_WORKER_LEGACY_PARITY_RISK).
- **Runtime**: worker/legacy state parity characterized (act-rollup DEAD_PATH_CANDIDATE/CONSUMER_UNPROVEN; ending v2 parity; chapter-50 v4 dual-hash duplicate-state risk).
- **Chapter 50**: publish + SELESAI reconciliation characterized (clean deterministic, FINAL_READER_STATE_STALE + reconciliation gap BLOCKER, transient-fail-then-recover clean, FINAL_CHAPTER_DUPLICATE_STATE_RISK, best-effort mark MEDIUM, all-failed no findings).

## Validation commands + results
1. `pnpm exec vitest run tests/narrative-qa` — **10 files, 94 tests, all passed** (2 runs: first run 59/93 passed; failures were test-side bugs: findings expose no `detail` field, substring-prefix collision `Bab 10` vs `Bab 1`, wrong rollup count expectation, off-by-one token estimate, empty-rollup CONSUMER_UNPROVEN semantics — all corrected; final run clean).
2. `pnpm typecheck` — **clean** (tsc --noEmit, no output, exit 0).
3. `pnpm exec eslint tests/narrative-qa lib/narrative-qa` — **clean** (exit 0, no warnings).
4. `git status` — only `tests/narrative-qa/` added; nothing under `lib/`, `scripts/`, `supabase/` touched (untracked `scripts/canary-prod-db-e2e.ts` pre-existed this task).

No production edits, no new dependencies, no `as any`/`@ts-ignore`, no timers/random/network/env access. Not committed.

## Concerns
1. **Finding details not on the contract**: `StoryBibleAuditFinding` exposes details only as JSON inside the `PURE_CHARACTERIZATION` evidence observation. Tests parse them via `detailOf()`. Task 4 CLI / Task 5 reports that need structured detail (chapter numbers, entry counts, resolved versions) must do the same or the contract should be extended — detector behavior is correct, this is a surface-shape observation.
2. **Act-rollup CONSUMER_UNPROVEN fires with an empty rollup array** when `compilerIncludesRollups=true` and `writerPromptIncludesRollups=false` (condition does not check `rollups.length`). Current semantics asserted in tests.
3. **4096-char cap is not reached at 49 realistic choices** (joined summary ≈ 3.5KB); truncation pressure only appears beyond ~55 entries. The detector's chars/4 token estimate (≈27 tokens/entry) stays under the default 2500 budget at 49 entries.
4. **Plot-debt suppression semantics confirmed**: PROGRESS_NOT_PERSISTED is suppressed whenever any per-milestone progress exists (PLOT_DEBT_MILESTONE_MEMORY_GAP fires instead) — tests assert the current behavior per the reviewer confirmation.
5. **ERROR-path test** uses a throwing property getter in a context sample to exercise `runStoryBibleAudit`'s per-module catch; it is a valid natural JS input, not a cast or `any`.
