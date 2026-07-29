# Lakoku Full Generation Fix — Completion Audit

**Canonical specification:** `docs/superpowers/plans/lakoku-full-generation-fix-plan.md`
**Base branch:** `review/durable-generation-worker`
**Base SHA:** `21eae2eb527e093ca8cdc976ea860cd7af789a6e`
**Completion branch:** `review/full-generation-fix-completion`
**Audit date:** 29 July 2026 (Asia/Jakarta)
**Production deployment / linked push:** NOT RUN

## Baseline

| Item | Result |
|---|---|
| `git status --short --untracked-files=all` | `?? .commandcode/taste/taste.md`; `?? .omo/run-continuation/ses_05585bf83ffe1bK24eIh6YDSre.json`; `?? docs/plans/lakoku-full-generation-fix-completion.md`; `?? docs/superpowers/plans/2026-07-29-full-generation-fix-completion.md` (all present before Task 1 edits; `.commandcode` and `.omo` are foreign and excluded from work/staging) |
| `git rev-parse HEAD` | `21eae2eb527e093ca8cdc976ea860cd7af789a6e` |
| `git log -1 --oneline` | `21eae2e Merge branch 'review/plot-debt-phase1' into review/durable-generation-worker` |
| `git branch --show-current` before branch creation | `review/durable-generation-worker` |
| `node --version` | `v24.15.0` |
| `pnpm --version` | `11.7.0` |
| Highest existing migration version | `20260728040000` (`supabase/migrations/20260728040000_enqueue_contract_provenance.sql`) |
| Next unused/reserved migration version | `20260728050000` for planned additive common-checkpoint V4 redefinition; no file with this prefix exists at Task 1 baseline |

## Evidence rules

- **CODE EXISTS:** symbol, migration, or helper exists.
- **TEST WRITTEN:** test asserts relevant behavior.
- **TEST EXECUTED:** command was run in this audit and result recorded.
- **PRODUCTION PATH WIRED:** real API/worker/generator reaches behavior or RPC.
- `DONE` requires all four. File existence or source-text inspection alone is insufficient.

## Canonical PR completion matrix

| PR canonical | CODE EXISTS | TEST WRITTEN | TEST EXECUTED | PRODUCTION PATH WIRED | Status | Gap |
|---|---|---|---|---|---|---|
| PR 1 — Safety stop | Destructive contract fallback removed in `lib/authoring/persist-creative-direction.ts`; best-effort and terminal-failure guard exist in `lib/runtime/story-generation.ts:773-780,1236-1251,1272-1278`; reconciliation migration exists at `supabase/migrations/20260724100000_reconcile_choice_routes_and_creative_direction.sql`; migration checker is registered in `package.json:11-12`; read-only contract audit exists at `scripts/sql/audit-empty-generation-contracts.sql`. | `tests/authoring/persist-creative-direction.test.ts`; `tests/runtime/story-generation-observability.test.ts`; `tests/runtime/story-generation-post-publish.test.ts`; migration uniqueness smoke. | `pnpm run check:migration-versions` exited 0. Targeted 150-test command executed only overlapping story-generation/runtime coverage; it did not execute every PR 1 test or production data audit. | Creative-direction persistence and story-generation guards are reached by production modules. Migration checker is in `pnpm test`. Read-only audit script is not a wired runtime path and was not run against linked production. | PARTIAL | Canonical safety-stop scope includes production data audit/classification. `scripts/sql/audit-empty-generation-contracts.sql` exists, but linked query and classification evidence are absent; full PR 1 test set was not executed in this audit. |
| PR 2 — Choice Protocol V2 | Creative-only schema and deterministic finalizer exist in `lib/ai-gateway/choice-draft-v2.ts:13-46,76-85,165-278`; gateway conversion exists in `lib/ai-gateway/gateway.ts:407-483`; non-stream choice call exists in `lib/ai-gateway/gateway-provider.ts:780-851`. | `tests/ai-gateway/choice-prompt-contract.test.ts`; `tests/ai-gateway/choice-structured-output.test.ts`; `tests/runtime/choice-generation-baseline.test.ts`. | Exact targeted rerun passed `tests/runtime/choice-generation-baseline.test.ts` as part of 9 files/150 tests. Prompt-contract and structured-output suites were not executed in this Task 1 audit. | Production gateway requests V2 creative drafts, finalizes mechanical fields server-side, then applies strict branch validation. | PARTIAL | Relevant production path is wired, but this audit did not execute all named protocol suites; no all-criteria `DONE` claim. |
| PR 3 — Provider reliability | Choice-specific fail-closed route exists in `lib/ai-gateway/gateway-provider.ts:875-915,989-1015`; candidate calls loop in `gateway-provider.ts:789-851`; choice capacity gate exists in `lib/runtime/choice-concurrency.ts:83-99,108-169,301-323`; taxonomy/budget exists in `lib/runtime/choice-error-taxonomy.ts:5-40,109-136`. | `tests/runtime/choice-concurrency.test.ts`; `tests/runtime/choice-generation-repair.test.ts`; gateway/provider suites under `tests/ai-gateway/`; production adapter proof in `tests/story-engine/choice-provider.test.ts`. | Focused provider/status/personalized/final command passed as 4 files/102 tests. | Production `buildChoiceBranch()` reaches gateway/provider and choice-capacity logic. Provider adapter behavior is executed, but required programmable provider sequence through actual worker remains blocked. | PARTIAL | Provider adapter proof exists; production-worker provider A then B sequence, bounded-call soak, and production-seam programmable injection remain unproved. |
| PR 4 — Real repair | Findings-aware repair input exists in `lib/runtime/choice-generation.ts:384-411`; bounded repair loop exists at `choice-generation.ts:418-585`; repair notes exist in `lib/runtime/choice-error-taxonomy.ts:138-167`. | `tests/runtime/choice-generation-repair.test.ts`; repair cases in `tests/runtime/choice-generation-baseline.test.ts`. | Exact targeted rerun passed baseline repair cases; dedicated repair/taxonomy suite was not included. | Production `buildChoiceBranch()` executes bounded repair, but no executed programmable-provider vertical sequence proves timeout, malformed output, repair/fallback, then valid publication. | PARTIAL | Dedicated repair execution and production-path sequence proof remain absent. |
| PR 5 — Durable split | Standard and personalized worker paths now call V4 publication through `lib/runtime/generation-jobs.ts`; checkpoint binding and common publication contract exist; worker claim/lease/heartbeat exists in `lib/runtime/generation-worker.ts`; V4 RPC exists in `supabase/migrations/20260728030000_publish_generation_job_chapter_v4.sql`. | Runtime checkpoint, worker, personalized, publication-contract tests; 48-assertion recovery pgTAP; recovery race script. | Focused recovery pgTAP passed 48/48. Focused provider/status/personalized/final command passed 4 files/102 tests. `node scripts/run-smoke.cjs scripts/generation-job-recovery-race.ts` passed 3/3 iterations with 2 scenarios each. Full pgTAP aggregate remains red. | Production worker publication is wired to V4 for standard and personalized paths. Recovery pgTAP proves stale worker rejection, fresh global claim/lease, same prose fingerprint, fresh V4 publication, and atomic `PUBLISHED`/`SUCCEEDED`/`RELEASED`. | PARTIAL | Vertical DB/recovery proofs complete. Programmable provider behavior through actual production worker/dispatcher remains blocked; full pgTAP aggregate has stale failures. |
| PR 6 — Mode dispatcher and attempts | Durable enqueue, central mode dispatcher, worker dispatch, preserved `triggerChoiceId`, and checkpoint-aware status resolver exist. Current status change gives reusable prose precedence over generic queued/running/retry state. | `tests/runtime/generation-mode-dispatch.test.ts`; `tests/runtime/generation-worker.test.ts`; `tests/api/chapter-status.test.ts`; enqueue/start tests. | Focused status suite passed within 4 files/102 tests. Earlier targeted rerun passed dispatcher and worker suites. | Durable start and worker use central dispatcher; reader status now reports retained prose as choice preparation while guarding stalled `CHOICES_RETRY_WAIT`. | PARTIAL | Focused status vertical proof exists. No fresh all-entry-point/enqueue aggregate proof; no production rollout evidence. |
| PR 7 — Full soak/release | Ops runbook exists at `docs/GENERATION_WORKER_OPS.md`; worker remains OFF by default. No required programmable 10/30-job harness artifact was found. | Existing DB/race tests and deterministic narrative soak exist; required completion soak matrix is not written. | No required local DB reset, affected pgTAP/race aggregate, or 10/30-job completion soak was executed in Task 1. | Production rollout is intentionally not wired/enabled; worker flag remains OFF and linked push/deploy were not run. | MISSING | Missing programmable failure/restart soak, exact metrics, full gates, release evidence, and production readiness review. |

## Production path audit

### Durable start and worker

1. `startOwnedChapterGeneration()` verifies owner and exact chapter readiness/lease.
2. Worker flag ON resolves generation mode, maps kind, and commits `generation_jobs` before returning `STARTED + attemptId`.
3. `after()` calls `claimAndRunGenerationJobById(jobId)`, so request A cannot claim request B's job.
4. Worker acquires bound lease, heartbeats before provider work, propagates `AbortSignal`, and calls central dispatcher.
5. Worker never calls `finish(SUCCEEDED)`; success is accepted only after generator returns fenced publication metadata.
6. Retryable choice failure calls `finishGenerationJobAttempt(... RETRY_WAIT ...)`; terminal failure calls `FAILED`; ownership loss calls neither finish nor publish.

### Standard and personalized generation

- Both modes validate prose before checkpoint creation.
- Both modes load reusable prose checkpoint before prose provider generation.
- Both mark `RUNNING_CHOICES`, run shared `buildChoiceBranch()`, retain checkpoint as `CHOICES_RETRY_WAIT` on exhausted choices, and avoid generic fallback publication.
- Both publish chapter 50 with `choicePrompt = null`, `choices = null`, and `outcomes = []`.
- Standard currently publishes via fenced V2; personalized via fenced V3. Neither production path reaches V4.

### Generic fallback reachability

- Production `buildChoiceBranch()` returns structured failure after provider exhaustion.
- Standard story generation converts that result to `CHOICE_GENERATION_FAILED`, marks `CHOICES_RETRY_WAIT`, and returns before publication.
- Generic production helper, wrapper, telemetry hook, and test export were removed after call-graph inspection proved no production caller reached publication.
- Production-seam regression covers structured failure, retry checkpoint, and zero publication calls.

## Executed evidence

### Targeted baseline

Initial targeted run:

```text
command:
pnpm exec vitest run tests/runtime/choice-generation-baseline.test.ts tests/runtime/choice-only-resume.test.ts tests/runtime/checkpoint-persistence.test.ts tests/runtime/checkpoint-freshness.test.ts tests/runtime/generation-worker.test.ts tests/runtime/generation-job-execution.test.ts tests/runtime/generation-mode-dispatch.test.ts tests/runtime/personalized-generation.test.ts tests/api/chapter-status.test.ts

exit code: 1
test files: 8 passed, 1 failed
tests: 149 passed, 1 failed
diagnosis: failure was non-reproducible and likely Vitest mock/cache contamination; systematic isolated and full-runtime investigation passed.
```

Exact targeted rerun after investigation:

```text
command:
pnpm exec vitest run tests/runtime/choice-generation-baseline.test.ts tests/runtime/choice-only-resume.test.ts tests/runtime/checkpoint-persistence.test.ts tests/runtime/checkpoint-freshness.test.ts tests/runtime/generation-worker.test.ts tests/runtime/generation-job-execution.test.ts tests/runtime/generation-mode-dispatch.test.ts tests/runtime/personalized-generation.test.ts tests/api/chapter-status.test.ts

exit code: 0
test files: 9 passed, 0 failed
tests: 150 passed, 0 failed
duration: 33.18s
```

The green rerun establishes current baseline, but the initial transient failure remains recorded and is not evidence of deterministic stability by itself.

### Current focused vertical proofs

```text
command:
pnpm exec vitest run tests/story-engine/choice-provider.test.ts tests/api/chapter-status.test.ts tests/runtime/personalized-generation.test.ts tests/runtime/story-generation-post-publish.test.ts

exit code: 0
test files: 4 passed, 0 failed
tests: 102 passed, 0 failed
duration: 39.74s
coverage represented: production choice-provider adapter, chapter status, personalized generation/recovery/publication, and standard final/post-publish behavior
```

```text
command: pnpm exec supabase test db --local supabase/tests/generation_job_recovery_test.sql
exit code: 0
pgTAP: 48 passed, 0 failed
proof: stale RUNNING_CHOICES recovery; old lease expiration; same-job fresh global claim and bound lease; stale-token V4 publication rejection; unchanged prose fingerprint; fresh-token V4 publication; atomic PUBLISHED/SUCCEEDED/RELEASED terminal tuple
```

```text
command: node scripts/run-smoke.cjs scripts/generation-job-recovery-race.ts
exit code: 0
result: Generation job recovery races: 3/3 iterations, 2 scenarios each PASS
```

### Latest typed publication patch evidence

```text
focused unit command: latest five-file typed publication patch selection
exit code: 0
test files: 5 passed, 0 failed
tests: 120 passed, 0 failed
result: PASS
```

```text
command: pnpm run typecheck
exit code: 0
result: PASS
```

Policy review result: **APPROVED**.

### Repository gates and known aggregate failures

```text
command: pnpm run build
exit code: 0
result: PASS
```

```text
command: pnpm run lint
exit code: 0
result: 0 errors; warnings only, existing warning baseline
```

```text
command: pnpm run test:unit
exit code: 1
result: FAIL — 15 tests failed under latest aggregate run
failure scope: `tests/runtime/choice-generation-baseline.test.ts` and `tests/runtime/personalized-generation.test.ts`
qualification: both failing files pass in isolation; choice baseline passes 21/21 and personalized passes 42/42. Isolated success narrows aggregate interaction/timing behavior but does not convert the full-unit aggregate to PASS or classify failures as unrelated.
```

```text
command: pnpm exec supabase test db --local
exit code: 1
result: prior aggregate FAIL — 12 assertions across 5 files; aggregate plan count 1350
classification: no newer aggregate pgTAP execution is claimed. Focused recovery pgTAP remains 48/48 PASS. Aggregate remains red until expectations are reconciled.
```

Production soak remains blocked and **NOT RUN**. Process-local simulation remains excluded from acceptance evidence.

No stronger counts are claimed where raw output was not retained in this document.

### Migration version uniqueness

```text
command: pnpm run check:migration-versions
output: $ node scripts/run-smoke.cjs scripts/check-migration-version-uniqueness.ts
exit code: 0
failed checks: 0
highest existing inventory version: 20260728040000 (`20260728040000_enqueue_contract_provenance.sql`)
next unused/reserved version: 20260728050000 (no matching migration file exists)
```

## Proven implementation gaps

### P0

1. Add integrated programmable-provider proof through production generator/worker seams for original bug. Current process-local simulation is explicitly excluded.
2. Reconcile prior aggregate pgTAP failures (12 assertions across 5 files; aggregate plan count 1350) and return the aggregate to green.
3. Resolve 15 latest full-unit aggregate failures without calling them unrelated; choice baseline 21/21 and personalized 42/42 isolated passes only narrow aggregate interaction/timing behavior.

Completed vertical proofs removed from blocker list: V4 worker publication wiring; exhausted-choice checkpoint retention; checkpoint-aware status; restart/global-claim recovery with same prose fingerprint and stale-worker rejection; recovery race.

### P1

1. Prove actual gateway cross-provider calls A then B through production worker, including workflow phases.
2. Verify all continuation/retry entry points use durable central dispatcher.
3. Preserve current focused final-chapter zero-choice proof under full aggregate execution.

## Task 10 process-local simulation and HOLD

`scripts/full-generation-worker-soak.ts` is relabelled process-local simulation, not approved soak. Commands are `simulate:full-generation:10` and `simulate:full-generation:30`. It measures real process-local generation/choice capacity gates and exercises production fingerprint/error-taxonomy helpers, but provider calls and all lifecycle state are adapters/in-memory objects. Its retry, repair, fallback, recovery, publication, stale-token, and eventual-publication counters are simulation-only and are not acceptance evidence.

Strongest non-invasive production-seam evidence available is split across local Supabase tests: real `generation_jobs`, `chapter_generation_checkpoints`, and `generation_leases`; `recover_stale_generation_jobs_v1`; fresh global claim and bound lease; rejected stale-token `publish_generation_job_chapter_v4`; accepted fresh-token V4 publication. Recovery/fencing race scripts exercise concurrent PostgreSQL sessions. These DB proofs do not run production worker/dispatcher or candidate provider sequence.

**APPROVED PROGRAMMABLE SOAK: HOLD.** Exact blockers:

1. Production worker statically imports `runChapterGenerationAttempt`; no dependency-injection seam can replace generation/provider behavior while retaining worker claim, lease, heartbeat, finish, and dispatcher code.
2. Production choice path resolves gateway candidate chain internally; no test-only programmable candidate-provider adapter can inject timeout, malformed output, repair, fallback, then success through actual worker without invasive production DI or external provider calls.
3. DB RPC fixtures can prove lifecycle, concurrent recovery, and V4 fencing/publication, but cannot truthfully measure production generation/choice concurrency or provider retry/repair/fallback.
4. Process-local 10-job 1/1 and 30-job 6/2 runs therefore remain capacity simulations only. No acceptance or release-readiness claim derives from them.

## Current verdict

**COMPLETION HOLD — BLOCKERS REMAIN. NO PR MATRIX ROW IS GREEN.**

Production worker flag: **OFF**.
Production deployment: **NOT RUN**.
Linked migration push: **NOT RUN**.
Approved production-seam programmable soak: **BLOCKED / NOT RUN**.
Process-local simulation: **excluded from acceptance evidence**.

No production deployment, linked migration push, or production soak is permitted from this audit state.
