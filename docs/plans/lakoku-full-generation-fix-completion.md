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
| PR 3 — Provider reliability | Choice-specific fail-closed route exists in `lib/ai-gateway/gateway-provider.ts:875-915,989-1015`; candidate calls loop in `gateway-provider.ts:789-851`; choice capacity gate exists in `lib/runtime/choice-concurrency.ts:83-99,108-169,301-323`; taxonomy/budget exists in `lib/runtime/choice-error-taxonomy.ts:5-40,109-136`. | `tests/runtime/choice-concurrency.test.ts`; `tests/runtime/choice-generation-repair.test.ts`; gateway/provider suites under `tests/ai-gateway/`. | None of dedicated provider-chain/capacity suites were included in Task 1 targeted command. | Production `buildChoiceBranch()` reaches gateway/provider and choice-capacity logic, but actual cross-provider sequence has no integrated executed proof. | PARTIAL | Missing provider A then provider B call-order proof with workflow phases, bounded calls, and one prose call. |
| PR 4 — Real repair | Findings-aware repair input exists in `lib/runtime/choice-generation.ts:384-411`; bounded repair loop exists at `choice-generation.ts:418-585`; repair notes exist in `lib/runtime/choice-error-taxonomy.ts:138-167`. | `tests/runtime/choice-generation-repair.test.ts`; repair cases in `tests/runtime/choice-generation-baseline.test.ts`. | Exact targeted rerun passed baseline repair cases; dedicated repair/taxonomy suite was not included. | Production `buildChoiceBranch()` executes bounded repair, but no executed programmable-provider vertical sequence proves timeout, malformed output, repair/fallback, then valid publication. | PARTIAL | Dedicated repair execution and production-path sequence proof remain absent. |
| PR 5 — Durable split | Standard checkpoint persist/resume exists in `lib/runtime/story-generation.ts:683-699,789-1043,1104-1158`; personalized path exists in `lib/runtime/personalized-generation.ts:701-727,771-915,958-989`; worker claim/lease/heartbeat exists in `lib/runtime/generation-worker.ts:57-72,105-207`; V4 RPC exists in `supabase/migrations/20260728030000_publish_generation_job_chapter_v4.sql:140-155,657-805`. | `tests/runtime/choice-only-resume.test.ts`; `checkpoint-persistence.test.ts`; `checkpoint-freshness.test.ts`; `generation-worker.test.ts`; SQL fencing/publication tests. | Exact targeted rerun passed included runtime suites. SQL tests, races, and exact original-bug integration were not executed in Task 1. | Checkpoint reuse and worker dispatch are wired. Atomic V4 publication is not wired from TypeScript: standard uses V2 and personalized uses V3 (`story-generation.ts:564-582`; `personalized-generation.ts:1067-1091`). | PARTIAL | Pure simulation/source inspection is insufficient; V4 wrapper, common checkpoint binding, audit V2 identity, DB/race evidence, and vertical recovery proof remain absent. |
| PR 6 — Mode dispatcher and attempts | Durable enqueue exists in `lib/api/start-chapter.server.ts:202-314`; resolver/dispatcher exists in `lib/runtime/generation-mode.ts:21-75,99-137`; worker dispatch exists in `lib/runtime/generation-worker.ts:191-207`; status resolver exists in `lib/api/chapter-status.server.ts:224-310`. | `tests/runtime/generation-mode-dispatch.test.ts`; `tests/runtime/generation-worker.test.ts`; `tests/api/chapter-status.test.ts`; enqueue/start tests. | Exact targeted rerun passed three named included suites; enqueue/start suites were not included. | Durable start and worker use central dispatcher. Post-choice continuation still directly selects generators, and reader status checks generic `RETRY_WAIT` before retained checkpoint. | PARTIAL | Preserve `triggerChoiceId`, route all continuation/retry entry points through dispatcher, and prefer `preparing_choices` for reusable choice checkpoints. |
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

1. Add integrated programmable-provider proof through production generator/worker seams for original bug.
2. Add exhausted-choice proof retaining prose and returning job to `RETRY_WAIT` without chapter publication.
3. Add restart/global-claim recovery proof with same prose fingerprint and stale-worker publication rejection.
4. Wire existing V4 publication contract instead of creating another RPC; align personalized audit metadata with V2 and preserve standard atomic checkpoint publication requirement.

### P1

1. Prove actual gateway cross-provider calls A then B, including workflow phases.
2. Prefer retained prose checkpoint phase over generic durable `RETRY_WAIT` reader status.
3. Remove production fallback import/wrapper and keep any helper only in test fixtures.
4. Verify all continuation/retry entry points use durable central dispatcher rather than direct generator selection.
5. Preserve final chapter zero-choice behavior through integrated reader test.

## Current verdict

**COMPLETION HOLD — BLOCKERS REMAIN**

Worker flag remains OFF. No production deployment, linked migration push, or production soak is permitted from this audit state.
