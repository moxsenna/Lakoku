# Task R1 Report — M10-A Audit Correction (Audit-only)

- **Date**: 2026-08-04
- **Branch**: `audit/m10-a-story-bible-dataflow`
- **Scope**: audit tooling (`lib/narrative-qa/*`, `tests/narrative-qa/*`, `scripts/m10-*.ts`) + docs (`docs/audits/*`). NO production code changed.
- **Status**: DONE_WITH_CONCERNS (see Concerns).

## Change Set (reviewer mandate → applied state)

| # | Mandate | Applied | Where |
|---|---|---|---|
| 1 | ADD BLOCKER `LIVING_CANON_WRITEBACK_MISSING` (Canon/Persistence) | YES | `lib/narrative-qa/canon-writeback-audit.ts` (new detector + evidence citing `lifecycle.ts :: publishChapterV2`, `generation-jobs.ts :: publishGenerationJobChapterV4`, v4 SQL migration, `loader.ts :: loadCanonSnapshot`); wired into `runStoryBibleAudit` default input; matrix Thread row cites umbrella; register + dataflow doc updated |
| 2 | RECLASSIFY plot debt: BLOCKER `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED` + HIGH child `PLOT_DEBT_PROGRESS_NOT_PERSISTED` (milestone memory gap folded in) | YES | `lib/narrative-qa/plot-debt-audit.ts` (umbrella fires when ledger non-empty and `briefConsultsLedger !== true`; HIGH child on due milestones without progress; old `PLOT_DEBT_MILESTONE_MEMORY_GAP` removed) |
| 3 | `THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED` HIGH, child of BLOCKER (upgraded from MEDIUM) | YES | `thread-audit.ts` emits `parentFinding: "LIVING_CANON_WRITEBACK_MISSING"`; `canon-writeback-audit.ts :: auditThreadSignalAsCanonFollowUp` |
| 4 | REPLACE `ENDING_LOCK_NOT_DURABLE` → MEDIUM `ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH` | YES | `ending-audit.ts` — sync path persists lock via `persistEndingLock` → `persist_ending_lock_v1` BEFORE publish (durable); finding is the 2-transaction non-atomic window vs v4 atomic; stale JSDoc bullet `ENDING_LOCK_WORKER_LEGACY_PARITY_RISK` cleaned |
| 5 | FIX `CHOICE_HISTORY_RECENT_LOSS` false positive: expected = targetChapter − 1 | YES | `choice-history-audit.ts` — `targetChapter` takes precedence; 49 choices at Bab 50 → no RECENT_LOSS; remaining risk kept HIGH/MEDIUM for genuine gaps (see Concerns) |
| 6 | ADD MEDIUM `CHOICE_HISTORY_DUPLICATE_PREVIOUS` | YES | `choice-history-audit.ts` — fires on `summaryAppendsPreviousChoice: true` (production `[...history, previousChoice]` in `chapter-brief.ts :: summarizeChoiceHistory` + `choice-context.ts :: choiceNarrativeContextFromReader`) |
| 7 | KEEP HIGH `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE` | YES | unchanged, verified |
| 8 | RENAME HIGH `DEPENDENCY_DECLARED_BUT_UNUSED` (anchors) → `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` | YES | `propagation-audit.ts` — `GLOBAL_STORY_ANCHOR_FIELDS = {corePromise, mainConflict, finalQuestion}` → renamed HIGH ×3 with bootstrap-influence note; `DEPENDENCY_DECLARED_BUT_UNUSED` MEDIUM kept for dead-between-brief-and-prompt fields (plotDebts, endingCandidates, closureRunway, lockedEndingKey) |
| 9 | UPGRADE act-rollup `DEAD_PATH_CANDIDATE` MEDIUM → HIGH | YES | `act-rollup-audit.ts` — HIGH justified by `BUDGET_ALLOCATION.rollupsSummaries 0.25` compiler spend vs no rollup section in `build-writer-prompt.ts` |
| 10 | `RETRIEVAL_LOG` keep INFO | YES | `RETRIEVAL_LOG_WRITE_PATH_UNPROVEN` INFO (propagation-audit) |
| 11 | Context pressure split: compiler vs writer; HIGH `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` | YES | `context-pressure-audit.ts` — detector over `writerLayer3 {timelineChars, factsChars, threadsChars, charLimit}`; production verified: `build-writer-prompt.ts` lines 83–123 fixed 4800-char limit, whole-section eviction order timeline → facts → threads; fires on all 4 stress rows in `context-pressure.json` |

## Corrected Counts (audit.json)

| Severity | Before (baseline v1) | After (R1) |
|---|---|---|
| BLOCKER | 0 | **2** |
| HIGH | 8 | 7 |
| MEDIUM | 7 | 7 |
| LOW | 1 | 1 |
| INFO | 2 | 2 |
| Total | 18 | **19** |

Findings after R1 (19): `LIVING_CANON_WRITEBACK_MISSING` (BLOCKER), `PLOT_DEBT_EFFECTIVE_STATE_NOT_PROJECTED` (BLOCKER), `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE` (HIGH), `THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED` (HIGH, child), `PLOT_DEBT_PROGRESS_NOT_PERSISTED` (HIGH, child), `GLOBAL_STORY_ANCHOR_NOT_DIRECTLY_PROPAGATED` ×3 (HIGH), `DEAD_PATH_CANDIDATE` (HIGH), `CHOICE_HISTORY_DUPLICATE_PREVIOUS` (MEDIUM), `PLOT_DEBT_NEXT_CHAPTER_STATE_STALE` (MEDIUM), `ENDING_LOCK_LEGACY_NONATOMIC_PUBLISH` (MEDIUM), `DEPENDENCY_DECLARED_BUT_UNUSED` ×4 (MEDIUM), `CONSUMER_UNPROVEN` (LOW), `RETRIEVAL_LOG_WRITE_PATH_UNPROVEN` (INFO), `CONTEXT_PACKET_CONSUMER_UNPROVEN` (INFO). `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` (HIGH) lives in `context-pressure.json` (stress rows chapter 50 ×4).

Stale codes verified absent from artifact: `ENDING_LOCK_NOT_DURABLE`, `ENDODE_LOCK_NOT_DURABLE`, `ENDING_LOCK_WORKER_LEGACY_PARITY_RISK`, `PLOT_DEBT_MILESTONE_MEMORY_GAP`, `CHOICE_HISTORY_RECENT_LOSS`, `DEPENDENCY_DECLARED_BUT_UNUSED` for anchors (anchors now renamed code; DEPENDENCY remains only for the 4 dead-between-brief-and-prompt fields).

## Validation Outputs

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS (tsc clean) |
| `pnpm exec eslint lib/narrative-qa/ tests/narrative-qa/ scripts/m10-*.ts` | PASS (0 errors, 0 warnings after removing unused `AuditSeverity` import in `canon-writeback-audit.ts`) |
| `pnpm run test:unit` (full suite) | PASS — 142 files passed, 1705 tests passed, 1 skipped (pre-existing integration skip) |
| `pnpm exec vitest run tests/narrative-qa` | PASS — 111 tests (11 files) |
| `node scripts/run-smoke.cjs scripts/m10-story-bible-audit.ts` | EXIT 0, `executionStatus: SUCCESS`, summary blocker=2 high=7 medium=7 low=1 info=2 total=19; artifact regenerated `.zcode/artifacts/m10-a/audit.json` (104189 bytes) |
| `node scripts/run-smoke.cjs scripts/m10-context-pressure-audit.ts` | EXIT 0, `executionStatus: SUCCESS`, verdict HOLD; artifact regenerated `.zcode/artifacts/m10-a/context-pressure.json` (7409 bytes); `WRITER_CONTEXT_WHOLE_SECTION_EVICTION` on all 4 stress rows |
| Artifact assertion script | ALL PASS — ≥2 BLOCKER, counts exact, no stale codes, 3 anchor findings, 4 DEPENDENCY findings, RECENT_LOSS absent |

## Files Changed (working tree, uncommitted — per mandate, NO commit)

New (untracked):
- `lib/narrative-qa/canon-writeback-audit.ts`
- `tests/narrative-qa/canon-writeback-audit.test.ts`
- `.superpowers/sdd/task-r1-report.md` (this report)

Modified:
- `lib/narrative-qa/act-rollup-audit.ts`, `choice-history-audit.ts`, `context-pressure-audit.ts`, `ending-audit.ts`, `plot-debt-audit.ts`, `propagation-audit.ts`, `story-bible-audit.ts`, `thread-audit.ts`
- `scripts/m10-story-bible-audit.ts`, `scripts/m10-context-pressure-audit.ts`
- `tests/narrative-qa/act-rollup-lifecycle-audit.test.ts`, `choice-history-pressure.test.ts`, `context-pressure.test.ts`, `ending-lock-parity-audit.test.ts`, `plot-debt-lifecycle-audit.test.ts`, `story-bible-audit.test.ts`, `thread-signal-audit.test.ts`, `writer-propagation-audit.test.ts`
- `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md` (§9 validation coverage, §11 parity, §12 chapter 45–50, §13 context pressure split compiler vs writer, §14 proven gaps with 2 BLOCKERs + evidence strings, §16 PR list, counts 94→111 tests)
- `docs/audits/M10A_RISK_REGISTER.md` (fully rewritten: 19 rows, 2 BLOCKER / 7 HIGH / 7 MEDIUM / 1 LOW / 2 INFO, all stale rows replaced)

Regenerated artifacts (gitignored):
- `.zcode/artifacts/m10-a/audit.json`, `.zcode/artifacts/m10-a/context-pressure.json`

## Concerns

1. **`CHOICE_HISTORY_RECENT_LOSS` severity kept HIGH for genuine gaps.** Mandate item 5 says "reframe remaining risk as INFO theoretical headroom if appropriate". The false positive (49 choices at Bab 50) is fixed via `targetChapter − 1`, and RECENT_LOSS is absent from the artifact. However the detector still emits HIGH for a *genuine* gap (e.g., target 51 with 49 entries) and tests assert that (choice-history-pressure.test.ts). I judged genuine-loss HIGH defensible (append-only history loss = real risk), and artifact requirement ("no RECENT_LOSS as HIGH") is met. If reviewer wants the theoretical-headroom INFO reframe, it is a 2-line severity change in `choice-history-audit.ts` + 2 test updates.
2. **Working tree contained pre-existing uncommitted work from a prior session** (the R1 changes were already partially applied before this run; I verified every mandate point, fixed gaps: risk register rewrite, JSDoc stale bullet, doc count 117→111, §14.10 fabricated eviction detail corrected to real computed values 28920 / ["timeline","facts"], §16 severity mismatch). All listed changes above are verified current.
3. **Untracked `scripts/canary-prod-db-e2e.ts`** present in working tree — NOT part of this mandate (not an m10-* script; canary touches prod DB). Left untouched; needs ownership decision (commit elsewhere or delete). Also untracked `docs/superpowers/plans/*` from earlier planning.
4. **LIVING_CANON_WRITEBACK_MISSING matrix representation**: no dedicated 18th matrix row (matrix stays 17 domains per `AUDIT_DOMAINS` contract); the BLOCKER is carried as a finding + cited in the Thread matrix row evidence. Test asserts 17 rows. Accepted as within contract; a dedicated "Canon" row would require contract change (out of scope).
5. **No commit made** (mandate: do not commit). Branch working tree carries all changes.

## Handoff

- M10-B must NOT start: `auditVerdict: HOLD` with 2 BLOCKERs stands.
- Recommended fix PRs enumerated in `docs/audits/M10A_STORY_BIBLE_DATAFLOW.md` §16 (PR-1 canon writeback, PR-2 ledger projection, PR-3 thread signals, PR-4 anchors, PR-5 blueprint, PR-6 rollups, PR-7 writer trim + choice dedup, PR-8 lock atomization, PR-9 debt progress persist, PR-10 retrieval log, PR-11 M10-C DB harness).
