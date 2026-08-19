# Task 4 Report — M10-A CLI Audit Scripts

Status: DONE

## Files created

| File | Purpose |
|---|---|
| `scripts/m10-story-bible-audit.ts` | Story Bible dataflow audit CLI. Assembles synthetic inputs from `fixtures/long-horizon/story-bible-pressure.ts` (49 choices via `generateSyntheticChoices`, canon snapshots via `buildSyntheticCanonSnapshot` at milestones 10/20/30/40/45/50, contract via `buildSyntheticStoryContract`) + hypothesis flags (`retrievalLogInvoked: false`, `validatorReceivesDraftSignals: false`, `contextPacketConsumerProven: false`) into `runStoryBibleAudit` input groups; prints executionStatus/auditVerdict/summary/findings; writes full `AuditReportArtifact` to `.zcode/artifacts/m10-a/audit.json`; exit 0 on SUCCESS, 1 on auditor failure (try/catch). |
| `scripts/m10-context-pressure-audit.ts` | Context pressure audit CLI. Canon samples at milestones 1/10/20/30/35/40/45/48/49/50 (adapted from `buildSyntheticCanonSnapshot`), stress cases totalBudget=4000 with loadBearingCost 900/1500/3000/4500 (construction mirrors `tests/narrative-qa/sample-builder.ts :: stressContextSample`: 400-char facts = 100 tokens, 26 regular facts with 4 excluded, 5 threads, 8 timeline, 2 rollups with act 1 excluded, constant non-LB cost 2760), choice pressure rows at 10/20/30/40/50 over 49 choices; builds artifact via `buildContextPressureReport`; prints milestone table + choice rows + verdict; writes `ContextPressureReportArtifact` to `.zcode/artifacts/m10-a/context-pressure.json`; exit 0 on SUCCESS, 1 on auditor failure. |

No other files changed. No commits. `.zcode/` verified git-ignored (`.gitignore` contains `.zcode/`; `git check-ignore` confirms). Artifacts are local-only, never committed.

## Input design notes

- Choice history: 49 entries (consequence adapted `string -> string[]`), `expectedLatestChapter: 50` -> latest visible 49 < 50 -> `CHOICE_HISTORY_RECENT_LOSS` HIGH.
- Blueprint: fixture snapshot at chapter 20 has versions [v1, v2] in array order; brief resolves first match (v1), runtime/compiler highest version (v2) -> `BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE` HIGH (same divergence the production detector characterizes).
- Thread: snapshot at 50, `threadContextAdvancedThreadIds: []`, `threadContextOpensNewThread: false`, `validatorReceivesDraftSignals: false` -> `THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED` MEDIUM.
- Plot debt: contract debts (main_mystery, debt_2) both open at chapter 50, no ledger/progress -> `PLOT_DEBT_PROGRESS_NOT_PERSISTED` HIGH x2.
- Ending: ch44 clean, ch45 via legacy `publishPath: 'v2'` with no lock -> `ENDING_LOCK_NOT_DURABLE` HIGH + `ENDING_LOCK_WORKER_LEGACY_PARITY_RISK` MEDIUM, ch50 lock held.
- Propagation: `DEFAULT_CONTRACT_FIELD_TRACES` + `retrievalLogInvoked: false` + `contextPacketConsumerProven: false` -> 3 HIGH (corePromise/mainConflict/finalQuestion never leave the contract), 4 MEDIUM (plotDebts/endingCandidates/closureRunway/lockedEndingKey die between brief and prompt; chapterTargets/emotionalTurn/expectedThreadMovement correctly produce NO finding — they reach the writer prompt), 2 INFO.
- Act rollup: seeded at authoring, never updated, no prompt consumer -> `DEAD_PATH_CANDIDATE` MEDIUM + `CONSUMER_UNPROVEN` LOW.
- Chapter 50: published once, SELESAI deterministic -> no findings (clean finalization path).
- Deterministic timestamp: `now: new Date('2026-08-04T00:00:00.000Z')` so artifacts are reproducible.

## Output snippets

### scripts/m10-story-bible-audit.ts

```
M10-A Story Bible audit (synthetic fixtures)
executionStatus: SUCCESS
auditVerdict: HOLD
summary: blocker=0 high=8 medium=7 low=1 info=2 total=18
findings (18):
  [HIGH   ] CHOICE_HISTORY_RECENT_LOSS                 domain=Choice History status=BOUNDED_LOSS_RISK
  [HIGH   ] BLUEPRINT_VERSION_RESOLUTION_DIVERGENCE    domain=Blueprint      status=PARITY_RISK
  [MEDIUM ] THREAD_ADVANCEMENT_SIGNAL_DISCONNECTED     domain=Thread         status=PARITY_RISK
  [HIGH   ] PLOT_DEBT_PROGRESS_NOT_PERSISTED           domain=Plot Debt      status=BOUNDED_LOSS_RISK
  [HIGH   ] ENDING_LOCK_NOT_DURABLE                    domain=Ending         status=PARITY_RISK
  [MEDIUM ] ENDING_LOCK_WORKER_LEGACY_PARITY_RISK      domain=Ending         status=PARITY_RISK
  [HIGH   ] DEPENDENCY_DECLARED_BUT_UNUSED             domain=Story Contract status=WRITE_PATH_UNPROVEN
  [MEDIUM ] DEPENDENCY_DECLARED_BUT_UNUSED             domain=Story Contract status=CONSUMER_UNPROVEN
  [INFO   ] RETRIEVAL_LOG_WRITE_PATH_UNPROVEN          domain=Story Contract status=CONSUMER_UNPROVEN
  [INFO   ] CONTEXT_PACKET_CONSUMER_UNPROVEN           domain=Story Contract status=CONSUMER_UNPROVEN
  [MEDIUM ] DEAD_PATH_CANDIDATE                        domain=Act Rollup     status=DEAD_PATH_CANDIDATE
  [LOW    ] CONSUMER_UNPROVEN                          domain=Act Rollup     status=CONSUMER_UNPROVEN
artifact: D:\Coding\lakoku v2\.zcode\artifacts\m10-a\audit.json (95416 bytes)
m10-story-bible-audit: SUCCESS (auditVerdict HOLD/PASS is audit output, not a script failure)
```
(exit 0)

### scripts/m10-context-pressure-audit.ts (milestone table excerpt)

```
chapter declared used   factsI factsX lbInc rollI rollX thr tln layer3 detectorsTriggered
1       4000     27     1      0      0     0     0     2   1   0      -
10      4000     246    15     0      3     0     0     4   10  0      -
...
50      4000     1040   75     0      18    2     0     10  20  0      -
50      4000     3660   31     4      9     1     1     5   8   0      RELEVANT_FACT_EVICTION,ROLLUP_EVICTION_PRESSURE
50      4000     4260   37     4      15    1     1     5   8   0      CONTEXT_DECLARED_BUDGET_OVERSHOOT,LOAD_BEARING_PRESSURE,RELEVANT_FACT_EVICTION,ROLLUP_EVICTION_PRESSURE
50      4000     5760   52     4      30    1     1     5   8   0      CONTEXT_DECLARED_BUDGET_OVERSHOOT,LOAD_BEARING_PRESSURE,RELEVANT_FACT_EVICTION,ROLLUP_EVICTION_PRESSURE
50      4000     7260   67     4      45    1     1     5   8   0      CONTEXT_DECLARED_BUDGET_OVERSHOOT,LOAD_BEARING_PRESSURE,RELEVANT_FACT_EVICTION,ROLLUP_EVICTION_PRESSURE
choice-history pressure (49 choices per chapter):
chapter total visible trunc dupPrev estTokens detectorsTriggered
10      49    49      0     false   1363      -
...
50      49    49      0     false   1363      CHOICE_HISTORY_RECENT_LOSS
executionStatus: SUCCESS
auditVerdict: HOLD
artifact: D:\Coding\lakoku v2\.zcode\artifacts\m10-a\context-pressure.json (7007 bytes)
m10-context-pressure-audit: SUCCESS (auditVerdict HOLD/PASS is audit output, not a script failure)
```
(exit 0)

Stress characterization matches the committed tests: cost 900 -> eviction without overshoot and without LOAD_BEARING_PRESSURE (900/4000 = 0.225 < 0.25); 1500/3000/4500 -> overshoot + LOAD_BEARING_PRESSURE + evictions. Choice pressure: 49 choices = 1363 estimated tokens, under the 2500 threshold; only the chapter-50 row triggers RECENT_LOSS (expected latest 50, latest visible 49).

## Artifacts

| Path | Size | Shape |
|---|---|---|
| `.zcode/artifacts/m10-a/audit.json` | 95416 B | `AuditReportArtifact`: executionStatus SUCCESS, auditVerdict HOLD, baselineSha b7961311cf70b91cb7245149e400075c4e454d74, summary {blocker 0, high 8, medium 7, low 1, info 2, total 18}, matrix 17 rows, findings 18 |
| `.zcode/artifacts/m10-a/context-pressure.json` | 7007 B | `ContextPressureReportArtifact`: executionStatus SUCCESS, auditVerdict HOLD, milestones 14 (10 growth + 4 stress), choiceHistoryPressure 5 rows |

Both valid JSON (parsed with `JSON.parse`), git-ignored via `.zcode/`.

## Validation commands + results

| Command | Result |
|---|---|
| `node scripts/run-smoke.cjs scripts/m10-story-bible-audit.ts` | exit 0, prints summary, writes audit.json |
| `node scripts/run-smoke.cjs scripts/m10-context-pressure-audit.ts` | exit 0, prints milestone table, writes context-pressure.json |
| `pnpm typecheck` | clean (after widening `pad()` to accept `boolean` — initial run flagged `duplicatePreviousDetected`) |
| `pnpm exec eslint scripts/m10-story-bible-audit.ts scripts/m10-context-pressure-audit.ts` | clean, exit 0 |
| artifact JSON verification | both files exist, valid JSON, expected fields (see table above) |

## Concerns

1. `writerLayer3CharLength` is always 0 — the milestone builder in `lib/narrative-qa/context-pressure-audit.ts` hardcodes it (no writer-prompt char measurement exists in the pure detector set). Table column is honest but not informative; noted in artifact, not fabricated.
2. Stress-case rows share `chapter: 50` with the growth milestone (14 rows, 5 with chapter 50). Row semantics are distinguishable by `detectorsTriggered`/`factsExcluded`, but chapter alone is ambiguous; a future `label`/`caseId` field would disambiguate.
3. Thread staleness detector (`THREAD_STALENESS_NOT_LOAD_BEARING`) cannot fire from the committed fixture: `buildSyntheticCanonSnapshot` computes `stale = chapter - lastTouched > 6` where `lastTouched = chapter - (i % 5)`, so the delta is always <= 4. No fixture change made (out of scope); the finding simply does not appear.
4. Deterministic timestamp `2026-08-04T00:00:00.000Z` fixed in both scripts — artifacts reproducible across runs; overrides the natural `new Date()` default from the detectors.
5. No test files added (task scope is scripts-only; detectors already covered by `tests/narrative-qa/`).
