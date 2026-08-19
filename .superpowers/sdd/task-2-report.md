# Task 2 Report — Modular Characterization Detectors (`lib/narrative-qa/`)

Branch `audit/m10-a-story-bible-dataflow`, base `b7961311cf70b91cb7245149e400075c4e454d74`, contract commit `9e1f804`.
Status: DONE_WITH_CONCERNS (one pre-existing out-of-scope fixture breaks full-repo typecheck; my files are clean).

## Files created (all under `lib/narrative-qa/`, none committed)

1. `choice-history-audit.ts` — `auditChoiceHistory(items, opts)`; `estimateChoiceTokens` (chars/4)
2. `context-pressure-audit.ts` — `analyzeContextSample(sample)`; `buildContextPressureMilestone`; `estimateSampleUsed`
3. `blueprint-audit.ts` — `auditBlueprintVersions(entries)`
4. `thread-audit.ts` — `auditThreadSignals(sample)`
5. `plot-debt-audit.ts` — `auditPlotDebts(sample)`
6. `ending-audit.ts` — `auditEndingLocks(entries)`
7. `propagation-audit.ts` — `auditPropagation(input)`; `DEFAULT_CONTRACT_FIELD_TRACES`
8. `act-rollup-audit.ts` — `auditActRollupLifecycle(sample)`
9. `chapter50-audit.ts` — `auditChapter50Finalization(sample)`
10. `story-bible-audit.ts` — `runStoryBibleAudit(inputs)`, `buildSourceOfTruthMatrix()`, `buildContextPressureReport()`, `domainStatuses()`

All modules import only `./story-bible-audit-contract` (types) + each other. Pure, no server imports, no zod, no new deps, no `as any` / `@ts-ignore`.

## Detectors — code + trigger condition

| Detector | Module | Fires when |
|---|---|---|
| CHOICE_HISTORY_RECENT_LOSS | choice-history-audit | newest visible chapter < expectedLatestChapter, or chapter-sequence gap in items |
| CHOICE_HISTORY_DUPLICATE_PREVIOUS | choice-history-audit | consecutive entries share label AND consequence |
| CHOICE_HISTORY_BUDGET_PRESSURE | choice-history-audit | cumulative chars/4 estimate > declaredBudget (default 2500) |
| CONTEXT_DECLARED_BUDGET_OVERSHOOT | context-pressure-audit | estimated sample cost > declaredBudget |
| LOAD_BEARING_PRESSURE | context-pressure-audit | load-bearing fact cost >= 25% of declared budget (facts-section cap) |
| RELEVANT_FACT_EVICTION | context-pressure-audit | facts marked excluded while budget >= 90% used |
| ROLLUP_EVICTION_PRESSURE | context-pressure-audit | rollups marked excluded while budget >= 90% used |
| BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE | blueprint-audit | resolved version differs across runtime/compiler/brief for a chapter |
| THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED | thread-audit | expected-advance threads absent from threadContext advancedThreadIds; OR validatorReceivesDraftSignals=false |
| THREAD_OPEN_SIGNAL_DISCONNECTED | thread-audit | new thread exists (openedChapter===chapter / newThreadIds) while opensNewThread=false |
| THREAD_STALENESS_NOT_LOAD_BEARING | thread-audit | stale threads exist (stale flag ignored by context selection) |
| PLOT_DEBT_PROGRESS_NOT_PERSISTED | plot-debt-audit | mustProgressBy milestone <= chapter, contract still 'open', no progress recorded |
| PLOT_DEBT_CLOSE_NOT_PERSISTED | plot-debt-audit | closure proposed but absent from ledger AND checkpoint signals (BLOCKER); or in signals but not ledger (MEDIUM) |
| PLOT_DEBT_NEXT_CHAPTER_STATE_STALE | plot-debt-audit | ledger closed but contract status != 'closed' (brief derives from contract only) |
| PLOT_DEBT_MILESTONE_MEMORY_GAP | plot-debt-audit | some milestones met, others have no trace |
| ENDING_LOCK_NOT_DURABLE | ending-audit | chapter >= 45 resolved ending but lockedEndingId null |
| ENDING_LOCK_RETRY_DIVERGENCE | ending-audit | same chapter resolves different endings across attempts (BLOCKER) |
| ENDING_LOCK_POST45_SWITCH | ending-audit | chapter > 45 resolves != locked ending (BLOCKER) |
| ENDING_LOCK_WORKER_LEGACY_PARITY_RISK | ending-audit | chapter 45 attempt used publishPath 'v2' (cannot lock) |
| DEPENDENCY_DECLARED_BUT_UNUSED | propagation-audit | persisted field never prompt-visible (HIGH never leaves contract; MEDIUM dies between brief and prompt) |
| RETRIEVAL_LOG_WRITE_PATH_UNPROVEN | propagation-audit | retrievalLogInvoked=false (INFO) |
| CONTEXT_PACKET_CONSUMER_UNPROVEN | propagation-audit | contextPacketConsumerProven=false (INFO) |
| DEAD_PATH_CANDIDATE | act-rollup-audit | rollups seeded, never updated, never reach writer prompt |
| CONSUMER_UNPROVEN | act-rollup-audit | rollups in compiled packet but writer prompt has no rollup section |
| FINAL_STATE_RECONCILIATION_GAP | chapter50-audit | ch50 published but reader state not SELESAI (BLOCKER); or mark best-effort (MEDIUM) |
| FINAL_CHAPTER_DUPLICATE_STATE_RISK | chapter50-audit | >1 attempts report success for final chapter |
| FINAL_READER_STATE_STALE | chapter50-audit | last attempt success but reader state not SELESAI |

## Real production symbols cited (file :: symbol + observation)

- `lib/runtime/personalized-generation.ts :: generateNextPersonalizedChapter` — `const threadContext: ThreadContext = { threads: snapshot.threads, advancedThreadIds: [], opensNewThread: false }` (line ~808-812). `ENDING_LOCK_CHAPTER = 45` (line 116), `TOTAL_PERSONALIZED_CHAPTERS = 50` (line 115). Ch-50 durability block (line ~1234-1250): mark SELESAI after publish ok OR CHAPTER_EXISTS; `defaultMarkReaderStateSelesai` writes status/ending_name/locked_ending_key/current_chapter 50. `defaultPersistEndingLock` -> RPC `persist_ending_lock_v1`. `derivePlotDebtAuditFlags` derives opensNewThread/opensMajorMystery/opensNewConflict/endingLocked from draft+findings+delta. Worker publish via `publishGenerationJobChapterV4` with `closures: auditSignals.closesPlotDebts` and `endingLock` only at ch45.
- `lib/runtime/story-generation.ts :: generateNextChapterReal` — same hardcoded `{ advancedThreadIds: [], opensNewThread: false }` (line ~817-821); `compileContext (+retrieval_logs)` appears only in a comment (line 80), no actual call.
- `lib/ai-gateway/generate.ts :: runLayerA` — feeds `threadCtx.advancedThreadIds` / `threadCtx.opensNewThread` verbatim into `validateThreadLifecycle`; `ThreadContext` interface (line 42).
- `lib/ai-gateway/schemas.ts :: ChapterDraftSchema` — only `opensNewThread` optional; no `advancedThreadIds` slot (line 153).
- `lib/narrative/threads.ts :: validateThreadLifecycle` — THREAD_BUDGET_EXCEEDED / THREAD_NEW_FORBIDDEN / THREAD_STALE_UNADDRESSED / THREAD_PAYOFF_NOT_ADVANCED; constants MAX_ACTIVE_THREADS=7, NO_NEW_THREAD_FROM_CHAPTER=41, STALE_AFTER_CHAPTERS=6, STALE_CALLBACK_WINDOW=3, MAIN_MYSTERY_BLOCK_CHAPTER=48.
- `lib/narrative/continuity-checks.ts :: runContinuityChecks` — Layer A anchor checks (CONT_MISSING_CONTINUITY_ANCHOR), structured mentions.
- `lib/narrative/compiler.ts :: compileContext` — BUDGET_ALLOCATION (rollupsSummaries 0.25, facts 0.15...), load-bearing unpaid facts NEVER trimmed, facts/rollups trimmed into `excludedIds`, `estimateTokens` word proxy, DEFAULT_BUDGET=4000, `latestBlueprint` (version desc).
- `lib/narrative/continuation-context.ts :: buildContinuationContext` — projection only (anchorFacts CAP 6, openThreads CAP 6, recentTimeline CAP 5, mustNotReveal); ContinuationContext has NO actRollups / lockedEndingKey / budget fields.
- `lib/runtime/continuation-context.server.ts :: loadContinuationContextForChapter` — reader_states.choice_history is source of truth; fail-closed TRIGGER_CHOICE_REQUIRED_FOR_NON_FIRST_CHAPTER; compileContext invoked here (line 148); checkOutcomeDrift vs choice_outcomes.
- `lib/runtime/choice-context.ts :: choiceNarrativeContextFromReader` — full history passed un-truncated; previousChoice = last entry / triggerChoiceId match.
- `lib/narrative/loader.ts :: loadCanonSnapshot` — reads characters/character_states/aliases/voice/facts/knowledge/secrets/timeline/story_threads/act_rollups/chapter_blueprints; `persistRetrievalLog` (line 221) defined + append-only, errors ignored — NO production call sites (verified by grep).
- `lib/narrative/types.ts` — CanonSnapshot/StoryThread (stale optional)/ActRollup/Fact/ChapterBlueprint shapes.
- `lib/story-engine/story-contract.ts :: StoryContractSchema` — actual PlotDebtSchema: `{ id, question, introducedAt, mustProgressBy[], mustCloseBy, status: open|progressing|closed }` (NO openedChapter/milestones[{chapter,target}]/closedChapter — plan-brief sketch does not match committed schema; audit cites actual). chapterTargets length 50 with emotionalTurn/expectedThreadMovement; closureRunway literals 35/40/45/48/49/50.
- `lib/story-engine/plot-debt.ts :: auditPlotDebts` — CLOSURE_RUNWAY constants; finding codes.
- `lib/story-engine/plot-debt-closure.ts :: resolveDebtClosures` — pure projection `projectClosedDebts`; ledger of closed ids; contract never mutated.
- `lib/story-engine/chapter-brief.ts :: buildChapterBrief` — `snapshot.blueprints.find(...)` (no version sort → divergence); `summarizeChoiceHistory` slices at 4096 chars (silent oldest-drop); plotDebtsToProgress/ToClose from CONTRACT status only (ledger ignored); `endingKeyFor` -> resolveEnding.
- `lib/story-engine/pre-prose-brief.ts :: buildPreProseChapterBrief` — consumes chapterGoal/mustNotInclude/mustNotReveal/routeStateSummary/lockedEndingKey.
- `lib/story-engine/ending-resolver.ts :: resolveEnding` — throws before endingLockChapter; lockedEndingKey early-return; else rank by routeState.endingBias (tie: index, key).
- `lib/story-engine/contract-persistence.server.ts` — corePromise/mainConflict/finalQuestion persisted into canon rows (voice sample_lines, facts_ledger, secret rows).
- `lib/ai-gateway/gateway.ts :: projectChoiceInput` — pendingReveals never trimmed; choice snapshot bounds; `generateChoiceBranch`; ChapterBriefSchema/ChoiceHistoryEntrySchema imports.
- `lib/ai-gateway/gateway-provider.ts :: buildPrompt` — writer prompt built ONLY from plan + continuation; NO `brief` reference in the file (grep); `activeCharacterNames`, `voiceGuidance` read snapshot directly.
- `lib/prose/prompt-engine/build-writer-prompt.ts :: buildWriterPrompt` — layer-1 header comment claims "ending terkunci" invariant but code emits only names + mustNotReveal; layer-3 4800-char trim order timeline -> facts -> threads; no rollup/debt/ending-lock sections.
- `lib/ai-gateway/plan-continuation.ts :: composeChapterGoal` — continuity > brief.chapterGoal > blueprint.
- `lib/runtime/generation-jobs.ts :: publishGenerationJobChapterV3/V4` — maps endingLock -> p_ending_key/p_ending_name; v4 also p_closures.
- `lib/runtime/lifecycle.ts :: publishChapterV2` — sync path has NO ending-lock parameter, no reader-state writes.
- `supabase/migrations/20260707000000_core_runtime_baseline.sql :: act_rollups` — columns id/story_id/act_number/summary/state_delta/covers_from_chapter/covers_to_chapter/created_at; UNIQUE(story_id, act_number); no updated_at; no later migration writes it.
- `lib/authoring/compile.ts :: compileSnapshot` — seeds exactly one rollup (act 1); `lib/authoring/persist.ts :: snapshotPersistenceRows` — maps actRollups rows.
- `supabase/migrations/20260728050000_publish_generation_job_chapter_v4_common_checkpoint.sql :: publish_generation_job_chapter_v4` — ending lock only for personalized ch45 (INVALID_ENDING_LOCK_TARGET); advisory locks E1(120713)/E2(130600); atomic ledger insert reader_plot_debt_closures (on conflict do nothing); checkpoint closesPlotDebts must match caller (CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH); closure validation DEBT_CLOSURE_DEADLINE_VIOLATION/MAIN_MYSTERY_UNRESOLVED/OPEN_DEBT_AT_END/DEBT_CLOSURE_CONFLICT; dual-hash idempotency fast path; transition_checkpoint_published_atomic_v4.

## Matrix statuses (17 domains, `buildSourceOfTruthMatrix`)

| Domain | Status |
|---|---|
| Character | PROVEN_E2E |
| Voice | PROVEN_E2E |
| Facts | PROVEN_E2E |
| Knowledge | CONSUMER_UNPROVEN |
| Secret | PROVEN_E2E |
| Timeline | PROVEN_E2E |
| Thread | PARITY_RISK (validator fed hardcoded empty signals) |
| Act Rollup | DEAD_PATH_CANDIDATE |
| Blueprint | PARITY_RISK (brief resolver has no version sort) |
| Story Contract | BOUNDED_LOSS_RISK (corePromise/mainConflict/finalQuestion persisted, never prompt-visible) |
| Reader Route | PROVEN_E2E |
| Choice History | PROVEN_E2E (bounded: 4096-char summary slice) |
| Ending | PARITY_RISK (lock only via worker v4; v2 sync cannot lock) |
| Plot Debt | BOUNDED_LOSS_RISK (ledger is SoT; contract status never mutated) |
| Chapter | PROVEN_E2E |
| Checkpoint | PROVEN_E2E (worker v4 path) |
| Retrieval | DEAD_PATH_CANDIDATE (persistRetrievalLog never invoked) |

## Validation

- `pnpm typecheck` — FAILS only on pre-existing untracked `fixtures/long-horizon/story-bible-pressure.ts` (3x TS2307, bad relative imports). Zero errors in `lib/narrative-qa/`. Fixture is out of scope (brief: do not depend on it; uncommitted).
- `pnpm exec eslint lib/narrative-qa/` — clean after fixing 2 warnings (unused `EvidenceClass` import in choice-history-audit; unused `m` param in plot-debt-audit).
- Smoke: temp vitest test exercised `runStoryBibleAudit` with all 9 input groups — executionStatus SUCCESS, verdict HOLD, >5 findings, 17 matrix rows, domainStatuses()['Act Rollup']=DEAD_PATH_CANDIDATE, ['Thread']=PARITY_RISK. Temp test deleted after run.
- `git status` — only the 10 new audit files + pre-existing untracked items; nothing committed.

## Concerns

1. `fixtures/long-horizon/story-bible-pressure.ts` (untracked, not mine) breaks repo-wide `pnpm typecheck`. Needs fixing by its owner (or deleting) before Task 3 CI can pass a full typecheck; my modules are unaffected.
2. Plot-debt detector input interface uses the ACTUAL committed schema (`introducedAt/mustProgressBy/mustCloseBy/status`), not the brief's sketch (`openedChapter/milestones[{chapter,target}]/closedChapter`) — brief sketch does not match `lib/story-engine/story-contract.ts :: PlotDebtSchema`. Task 3 tests should use the real schema.
3. Hardcoded-empty thread signals and never-invoked `persistRetrievalLog` are confirmed at source level; those are the highest-value findings for the report (Task 5) and are emitted only when input data triggers them, not pre-pushed.
4. `runStoryBibleAudit` catches per-module throws and returns executionStatus ERROR while keeping partial findings — intentional, matches contract (no error-finding type exists).

---

## Fix Report (review round 1 — 2026-08-04)

Status: **DONE** (all 4 review fixes applied, validated)

### IMPORTANT #1 — matrix statuses downgraded
`lib/narrative-qa/story-bible-audit.ts :: buildSourceOfTruthMatrix`: all 9 rows that cited only static SOURCE_TRACE evidence (Character, Voice, Facts, Secret, Timeline, Reader Route, Choice History, Chapter, Checkpoint) downgraded `PROVEN_E2E` → `PROVEN_READ_ONLY`. Static source tracing caps at PROVEN_READ_ONLY; PROVEN_E2E requires executable evidence which the pure modules cannot produce. Verified: 9/9 occurrences replaced, 0 `PROVEN_E2E` remain. `domainStatuses()` reads MATRIX_ROWS so it stays consistent automatically.

### IMPORTANT #2 — PLOT_DEBT_MILESTONE_MEMORY_GAP reachable
`lib/narrative-qa/plot-debt-audit.ts`: old branch was unreachable because `progressRecordedThisChapter` is debt-id-level (either whole `dueMilestones` or none). Added per-milestone input model:
- new `PlotDebtMilestoneProgress { debtId, milestoneIndex, progressedAt? }` interface;
- new optional `progressedMilestones` field on `PlotDebtAuditSample`;
- loop now computes `progressedDue` / `missingMilestones` per `debtId:milestoneIndex` against `mustProgressBy` indices ≤ chapter, and fires PLOT_DEBT_MILESTONE_MEMORY_GAP exactly when `0 < progressedDue.length < dueMilestones.length` (plan §10 "Bab 20 milestone kedua" scenario). Detector detail now carries per-milestone `{milestoneIndex, milestoneChapter}` for both progressed and missing.
- PLOT_DEBT_PROGRESS_NOT_PERSISTED condition updated: fires only when BOTH debt-level and per-milestone progress are absent (partial per-milestone progress is covered by the gap finding instead).
Smoke-tested via temp vitest (3 cases: partial-progress fires gap, all-progressed no gap, zero-progress fires progress-gap only) — 3/3 pass; temp file deleted.

### MINOR #3 — wrong doc path
`lib/narrative-qa/propagation-audit.ts` header: `lib/runtime/loader.ts :: persistRetrievalLog` → `lib/narrative/loader.ts :: persistRetrievalLog`.

### MINOR #4 — hardcoded detectorsTriggered
`lib/narrative-qa/context-pressure-audit.ts :: buildContextPressureMilestone`: `detectorsTriggered` now populated from `analyzeContextSample(sample).map((f) => f.code)` instead of hardcoded `[]`.

### Validation
- `pnpm typecheck` — clean (includes `fixtures/long-horizon/story-bible-pressure.ts`, now fixed as reviewer stated).
- `pnpm exec eslint lib/narrative-qa/` — exit 0, clean.
- No commits. No tests/ or scripts/ touched. Only the 4 audit-module files changed.

### Remaining concerns (unchanged from original report)
1. Plot-debt detector input interface uses the ACTUAL committed schema (`introducedAt/mustProgressBy/mustCloseBy/status`), not the plan brief sketch (`openedChapter/milestones/closedChapter`) — sketch does not match `lib/story-engine/story-contract.ts :: PlotDebtSchema`. Task 3 tests should use the real schema.
2. Hardcoded-empty thread signals and never-invoked `persistRetrievalLog` confirmed at source level; emitted only when input data triggers them, not pre-pushed.
