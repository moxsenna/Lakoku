# Durable Worker Local Release-Readiness Design

**Date:** 2026-07-26
**Status:** Approved with review clarifications incorporated
**Release posture:** Durable worker remains disabled

## 1. Goal

Make durable chapter generation locally release-ready without committing, pushing, applying linked migrations, changing production secrets, deploying, or enabling `LAKOKU_GENERATION_WORKER`.

Local release-ready means:

- repository artifacts are safe to stage later;
- official unit, typecheck, lint, migration-version, and build gates pass;
- current migrations and pgTAP contracts pass against a reset local Supabase database;
- personalized generation has the same durable prose checkpoint and cancellation guarantees as standard generation;
- the internal generation route uses the shared durable kickoff path;
- deployment and recovery order is explicit: worker stays disabled throughout local work; controlled production activation is allowed only for smoke and soak after migration, secret, recovery timer, and worker-off deployment prerequisites pass; broad activation waits for all validation and sign-off.

## 2. Current State

Production's legacy generation path is healthy. The durable worker implementation exists only in the dirty local working tree. Two existing worker-related migrations are pending in the linked project; this design adds a third local checkpoint-fencing migration. None may be pushed during this work. Recovery scheduling is not installed, and the worker flag is unset and therefore off.

Current local release gates are blocked by:

- five Taste Profile V1/V2 unit-test failures;
- official lint scanning `.worktrees/**`;
- unexecuted current-schema pgTAP tests;
- missing personalized prose checkpoint reuse;
- missing `AbortSignal` propagation to personalized prose generation;
- direct synchronous dispatch from `app/api/stories/[id]/generate/route.ts`.

## 3. Scope

### 3.1 Included

1. Clean local repository artifacts without reverting source changes.
2. Update stale Taste Profile V1 test fixtures to current V2 behavior.
3. Exclude `.worktrees/**` from official ESLint traversal.
4. Run local Supabase reset and all current pgTAP tests.
5. Verify claim-by-ID, claim exclusivity, permissions, checkpoint versioning, freshness, and worker-owned checkpoint mutation fencing contracts.
6. Add personalized `PROSE_READY` checkpoint persistence and reuse.
7. Propagate worker cancellation to personalized prose and choice provider calls.
8. Move the internal generation route onto the shared durable kickoff seam.
9. Add focused regression tests, including recovery-route tests.
10. Update worker operations documentation and run all local release gates.

### 3.2 Excluded

- Git commit or push.
- Linked Supabase migration application.
- Production secret or scheduler changes.
- VPS deployment.
- Worker flag activation.
- Authenticated production generation smoke tests.
- Restart, ownership-loss, duplicate-claim, or 30-job production soak.

Those operations require a separate approval after this design's local acceptance criteria pass.

## 4. Safety and Working-Tree Cleanup

Before source edits:

1. Record branch, HEAD, tracked changes, untracked files, and diff statistics.
2. Inspect `nul`; delete it only if it is confirmed to be an accidental artifact.
3. Add repository ignore rules for:
   - `.env.local.bak`
   - `.aionrs/`
   - `.zcode/plans/`
4. Verify each listed artifact is ignored and is neither tracked nor staged. Use ignore and index checks without reading file contents; any tracked or staged secret-bearing artifact is a blocker.
5. Do not inspect or expose values from `.env.local.bak`.
6. Do not revert existing tracked or untracked implementation files.
7. Run `git diff --check`, `git diff --cached --check`, and inspect `git status --short` after cleanup.

Cleanup changes visibility and staging safety only. It must not alter runtime behavior.

## 5. Baseline Gate Repair

### 5.1 Taste Profile V2 tests

Runtime V2 behavior is authoritative. Tests must not force runtime back to V1.

Changes must:

- update owned-query expectations to the migrated V2 profile returned by current code;
- construct personalized-story request hashes from the same current profile/version used by runtime;
- preserve replay, shell reuse, and `IDEMPOTENCY_CONFLICT` semantics;
- add or retain assertions that detect a true request-hash contract regression.

Gate:

- `tests/api/owned-queries.test.ts` passes;
- `tests/api/personalized-stories.test.ts` passes;
- full `pnpm test:unit` passes with zero failures.

### 5.2 Official lint

Add `.worktrees/**` to ESLint global ignores so `pnpm lint` evaluates the repository source rather than nested checkouts.

Gate:

- `pnpm lint` exits zero;
- no source lint errors are hidden by a broad ignore;
- existing warnings may remain only if the official lint policy permits exit zero.

No worker feature work begins while either baseline gate remains red.

## 6. Local Database Verification

### 6.1 Environment gate

Check local Supabase and Docker Linux engine availability. If unavailable, source work may continue, but database verification stops and remains a release blocker. Do not substitute the linked database. Final status must be **implementation complete, DB verification blocked**; do not claim **local release-ready** until fresh reset and pgTAP evidence exists.

### 6.2 Schema setup

Run migrations from an empty local database using `supabase db reset`. This validates migration ordering against the actual repository schema.

After reset, run `node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts`. That script reconnects and verifies `lakoku.test_target = 'local-cli'` before pgTAP. This marker is local-only and must never be set on a linked database.

Ensure the project's DB test command includes:

- `supabase/tests/claim_generation_job_by_id_test.sql`
- `supabase/tests/checkpoint_versioning_test.sql`
- `supabase/tests/generation_checkpoint_fencing_test.sql`
- the checkpoint ownership race script added for the fenced RPCs

Then run the complete pgTAP suite.

### 6.3 Required database contracts

pgTAP tests must prove:

1. `claim_generation_job_by_id_v1` claims only the requested eligible job.
2. Concurrent claims produce one lease owner.
3. Attempts and leases fence stale workers.
4. Ineligible, missing, completed, or actively leased jobs are not incorrectly claimed.
5. `PUBLIC`, `anon`, and `authenticated` have no `EXECUTE` privilege on `claim_generation_job_by_id_v1`; `service_role` has `EXECUTE`. Tests assert every listed role explicitly. Function-owner and superuser behavior is excluded from the client-role assertion.
6. Existing checkpoint rows are backfilled to schema version 1.
7. New checkpoint rows default to schema version 2.
8. `checkpoint_schema_version` is `NOT NULL`; legacy-compatible provenance columns remain nullable. Runtime tests separately require schema-v2 writes to populate every freshness field needed for safe reuse.

### 6.4 Checkpoint-fencing RPC migration

Add a separate forward-only migration:

```text
supabase/migrations/20260724121000_generation_checkpoint_fencing.sql
```

Do not modify `20260724120000_checkpoint_versioning.sql`. The new RPCs depend on its provenance columns and schema-version marker, so a third migration keeps ordering, applied-history immutability, ACL review, and rollback scope explicit.

#### `upsert_generation_checkpoint_fenced_v1`

Create this exact service-role-only `SECURITY DEFINER` contract with an empty `search_path`:

```sql
public.upsert_generation_checkpoint_fenced_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_prose_fingerprint text,
  p_canon_version bigint,
  p_blueprint_version bigint,
  p_direction_fingerprint text,
  p_generation_mode text,
  p_generation_policy_version integer,
  p_prompt_contract_version integer,
  p_prose_attempt_count integer
) returns jsonb
```

Database derives `attempt_id = generation_jobs.id`, `correlation_id = generation_jobs.correlation_id`, status `PROSE_READY`, `job_id`, `job_attempt_number = generation_jobs.attempt_count`, schema version `2`, timestamps, choice counter, and expiry. Caller cannot override those values.

Within one transaction and job-before-lease lock order, it must verify:

- job exists and `job_id` matches;
- job status is `RUNNING`;
- `worker_id` and `claim_token` match current owner;
- story and chapter match job target;
- lease matches `job_id`, token, story, chapter, and worker;
- lease status is `ACTIVE` and `expires_at > clock_timestamp()`;
- current job attempt is not behind checkpoint provenance;
- schema-v2 freshness inputs are complete and consistent with job generation kind. A story with no creative direction uses one shared deterministic non-null absence fingerprint; worker-mode v2 rows never encode absence as `NULL`.

Only after all checks pass may it insert/update the checkpoint. Existing `PUBLISHED` or differently-provenanced rows cannot be overwritten.

#### `transition_generation_checkpoint_fenced_v1`

Create this exact service-role-only `SECURITY DEFINER` contract with an empty `search_path`:

```sql
public.transition_generation_checkpoint_fenced_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_checkpoint_attempt_id uuid,
  p_new_status text
) returns jsonb
```

It performs the same atomic ownership/lease/target verification, locks the checkpoint, enforces same-job provenance and attempt compatibility, validates the existing checkpoint status transition graph, updates status/counters/expiry once, and makes same-status replay idempotent. Entering `RUNNING_CHOICES` increments `choice_attempt_count` exactly once. First transition to `PUBLISHED` or `EXPIRED` sets terminal expiry to one hour; idempotent replay does not extend it.

`PUBLISHED` transition occurs after fenced chapter publication, when job is already `SUCCEEDED` and lease is `RELEASED`. For this transition only, RPC must verify successful publication proof for the same job/story/chapter and the exact released lease/token/worker tuple rather than requiring `RUNNING`/`ACTIVE`.

#### Bounded application result

Both RPCs return `jsonb`. Application-level outcomes are restricted to:

```text
UPDATED
OWNERSHIP_LOST
LEASE_INVALID
ATTEMPT_AHEAD
PROVENANCE_CONFLICT
INVALID_TRANSITION
```

`UPDATED` includes `changed: true|false` and normalized checkpoint data. Wrong/missing job owner maps to `OWNERSHIP_LOST`; wrong, inactive, expired, or mismatched lease maps to `LEASE_INVALID`; checkpoint numeric attempt above current job attempt maps to `ATTEMPT_AHEAD`; target/job/freshness identity mismatch maps to `PROVENANCE_CONFLICT`; forbidden status movement maps to `INVALID_TRANSITION`. Invalid scalar or payload shape remains a bounded SQL validation error and never mutates data.

Explicitly revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`. pgTAP and a local concurrency script must prove exact signatures, ACL, job-before-lease lock order, stale owner rejection, expired lease rejection, same-attempt replay, earlier-attempt reuse, attempt-ahead rejection, transition idempotency, post-publication completion, and transaction rollback on late failure.

No `supabase db push --linked` occurs in this work.

## 7. Personalized Generation Parity

### 7.1 Shared checkpoint model

Personalized generation must use the existing checkpoint abstraction and schema. It must not create a parallel checkpoint system.

Expected flow:

1. Resolve generation mode and establish current story, chapter, job, attempt, and provenance.
2. Load a checkpoint through existing freshness and fencing validation.
3. If a valid `PROSE_READY` checkpoint exists, reuse its prose and skip prose provider generation.
4. If no usable checkpoint exists, generate prose.
5. Persist a schema-v2 `PROSE_READY` checkpoint before the first choice provider call.
6. Generate and validate choices.
7. If choices fail, preserve the usable checkpoint so retry is choice-only.
8. On successful fenced publication, invoke the same checkpoint-completion operation used by standard generation: mark the checkpoint `PUBLISHED` and use the same terminal expiry behavior. Do not add a personalized-only clear/finalize branch.

Checkpoint writes record story, chapter, generation contract, mode, job ID, producing attempt, and every existing freshness dimension. Worker-mode reuse uses this explicit provenance rule:

```text
checkpoint.jobId === currentJob.id
checkpoint.jobAttemptNumber <= currentJob.attemptNumber
```

`jobAttemptNumber` identifies the attempt that produced prose; it is provenance, not an equality key. Reclaiming the same job increments current attempt, so an earlier checkpoint remains reusable when all stable freshness fields match. `checkpoint.jobAttemptNumber > currentJob.attemptNumber` is `ATTEMPT_AHEAD`. Checkpoint write and chapter publish ownership always use the current claim token and current active lease, never the producing attempt's old ownership.

Worker-mode checkpoint upserts and status mutations must be atomically fenced in the database using current `jobId`, `workerId`, `claimToken`, and `leaseId`. Ownership validation and checkpoint mutation occur in one DB operation; a prior `AbortSignal` check alone is insufficient. Legacy worker-off execution may retain direct checkpoint mutation. This requires a migration/RPC and pgTAP race coverage in local scope; it remains unpushed until separate approval.

### 7.2 Cancellation

Pass the same `jobContext.signal` through every standard and personalized model-request path:

- initial prose call;
- per-candidate prose leak repair;
- every Layer A and Layer B prose repair;
- initial choice call;
- structural/content repair;
- creative/quality repair;
- transient choice retry;
- every prose and choice fallback candidate;
- each native structured-output request;
- each text/JSON parse-fallback candidate request.

Current native structured output and local JSON parsing share one provider response; no extra provider call should be invented. If future code adds a second non-native parse-fallback request, it must receive the same signal and consume the same provider-call budget.

Cancellation must also stop queue waits, retry backoff, candidate traversal, and repair loops. Before scheduling each candidate or repair, check the parent signal and return ownership-cancelled semantics when aborted. Do not continue to another provider after an abort-class failure.

On ownership loss:

- abort the active provider request;
- atomically reject checkpoint mutations from the stale owner even when ownership changes after a signal check;
- do not publish chapter or choice writes;
- classify cancellation using existing worker semantics rather than as an ordinary provider-content failure.

Tests must include a provider double that ignores `AbortSignal`, resolves after ownership loss, and returns otherwise valid prose/choices. Fenced checkpoint RPCs and fenced publication must still prevent checkpoint mutation and publish.

A failed checkpoint write before choices fails the attempt. Continuing would allow expensive prose generation without a safe choice-only resume point.

### 7.3 Boundary

Refactor only the shared checkpoint seams needed by standard and personalized flows. Do not merge both generators or perform unrelated runtime restructuring.

## 8. Internal Generation Route Cutover

`app/api/stories/[id]/generate/route.ts` must call the same kickoff seam used by the owner start flow rather than invoking `runChapterGenerationAttempt` directly.

### 8.1 Mode and flag behavior

- `mode: 'fake'` remains the deterministic synchronous fixture path. It does not enqueue a generation job and preserves its existing `201` success or `409` conflict contract.
- Real mode calls `startOwnedChapterGeneration`; it no longer invokes `runChapterGenerationAttempt` directly.
- `LAKOKU_GENERATION_WORKER` off: the shared kickoff schedules its supported legacy `after()` execution and returns `attemptId: null`.
- `LAKOKU_GENERATION_WORKER` on: the shared kickoff enqueues the durable job, returns its durable `attemptId`, and schedules exact job claiming.

The route must not maintain a second durable enqueue implementation.

### 8.2 Required guarantees

- Existing `RUNTIME_ADMIN_TOKEN`, session, and owner authorization remain intact. The route may retain its early owner lookup or delegate owner verification to the shared kickoff, but it must not weaken either guard.
- Real-mode response mapping is explicit: `STARTED` → HTTP `202`, `ALREADY_RUNNING` → HTTP `202`, and `ALREADY_READY` → HTTP `200`, each with the full `StartChapterSuccess` body. `ALREADY_READY` is a completed-state read, not accepted background work.
- This `ALREADY_READY` mapping applies to the internal `/generate` route cutover. Existing public `/start-chapter` HTTP behavior remains unchanged in this scope; changing it requires a separate client-contract decision.
- Real-mode shared-kickoff failures use the established start-chapter mapping: auth `401`, story missing `404`, and other validation or kickoff failures `400`, with the `StartChapterFailure` body.
- A durable job is committed before a worker-enabled `STARTED` response.
- Enqueue failure cannot return false success.
- Existing durable job or lease results propagate the shared kickoff seam's `STARTED` or `ALREADY_RUNNING` result unchanged and never enqueue, claim, or schedule a second job beyond the seam's idempotent behavior.
- The direct synchronous dispatcher import is removed from the route.

### 8.3 Route tests

Tests must cover:

- admin-token, anonymous, and wrong-owner rejection;
- unchanged fake-mode success and conflict behavior;
- real-mode `STARTED` → `202` while the worker flag is off;
- one durable enqueue and `STARTED` → `202` while the flag is on;
- durable `attemptId` response;
- `ALREADY_RUNNING` → `202` and `ALREADY_READY` → `200`;
- regression coverage proving public `/start-chapter` retains its current status mapping in this scope;
- existing-job and active-lease behavior without duplicate creation;
- enqueue failure response;
- authorization mocks through the same public barrel seam used by production code.

## 9. Recovery Route Tests

Add automated coverage for `app/api/generation/recover/route.ts`:

- secret unset returns `404` fail-closed;
- missing, malformed, or incorrect bearer secret returns `401`;
- worker flag unset or off returns `202` and does not call `after()`, recover stale jobs, claim, dispatch, or schedule work;
- worker flag on with a valid secret schedules bounded recovery once and returns `202` immediately;
- `LAKOKU_RECOVERY_MAX_JOBS` defaults to `5` when absent or unparsable, clamps parsed values to `1..20`, and preserves current `Number.parseInt` prefix behavior;
- scheduled recovery first processes at most the fixed stale-recovery batch of `20`, then claims/runs at most the configured job count;
- asynchronous recovery failure is caught and logged without changing the already-returned `202` or exposing secrets;
- synchronous `after()` registration failure follows the route's generic non-secret error handling contract.

Flag-on coverage uses process-local test configuration and mocked scheduling only. Tests must not modify `.env*`, launch a real worker, or claim a real job.

Production timer installation remains outside local scope.

## 10. Error Handling

Use existing error taxonomy where possible.

- Checkpoint stale, provenance mismatch, and attempt-ahead remain distinct validation outcomes.
- Ownership-loss abort is not reported as an ordinary provider timeout or malformed response.
- Provider budget exhaustion remains `CHOICE_PROVIDER_CALL_BUDGET_EXHAUSTED`.
- Failed enqueue never returns `STARTED`.
- Failed checkpoint persistence before choices stops the attempt.
- Recovery remains fail-closed when `LAKOKU_RECOVERY_SECRET` is absent.
- Logs and responses must not expose secrets, provider credentials, or full sensitive payloads.

## 11. Test Strategy

Use test-driven changes for each behavior group:

1. Add or adjust a focused test and confirm the relevant failure.
2. Apply the smallest production change.
3. Run the focused test to green.
4. Run the related subsystem suite.
5. Run the complete local gate after all groups pass.

Required focused areas:

- Taste Profile V2 owned-query and idempotency behavior;
- personalized checkpoint persistence, earlier-attempt same-job reuse, and failed-choice retention;
- personalized successful publication produces the same `PUBLISHED` terminal checkpoint state and expiry behavior as standard generation;
- cancellation propagation through prose initial/leak repair/Layer A/Layer B, choice initial/structural/creative/transient repair, every fallback candidate, and native/parse paths;
- provider-ignores-abort regression proving no checkpoint mutation or publish after ownership loss;
- worker ownership loss, including race where ownership changes immediately before checkpoint upsert/status mutation, and atomically fenced rejection;
- internal route authorization, fake-mode compatibility, asynchronous real-mode mapping, and flag behavior;
- recovery authentication, worker-off no-op, and bounded dispatch;
- runtime checkpoint tests reject stale, provenance-mismatched, and attempt-ahead checkpoints;
- claim concurrency and exact-ID behavior.

## 12. Final Local Gate

Record full output, exit code, test-file count, test count, and skipped count where applicable for:

```bash
pnpm test:unit
pnpm run typecheck
pnpm lint
pnpm run check:migration-versions
pnpm run build
supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
supabase test db
git diff --check
git diff --cached --check
git status --short
```

Every intended untracked source, migration, and test file must receive equivalent whitespace validation; `git diff --check` alone does not inspect untracked files.

Also record focused worker, checkpoint, personalized, route, recovery, and DB test results.

A focused green suite cannot replace a red full suite. Migration filename uniqueness cannot replace migration execution. HTTP health cannot replace authenticated generation smoke.

## 13. Operations Documentation

Update `docs/GENERATION_WORKER_OPS.md` with this mandatory production order:

1. Review local evidence and approve all three pending migrations, including `20260724121000_generation_checkpoint_fencing.sql`.
2. Apply linked migrations in order.
3. Verify linked schema, function permissions, and claim behavior.
4. Configure `LAKOKU_RECOVERY_SECRET`.
5. Install the recovery timer or cron in a disabled state; verify endpoint authentication and worker-off no-dispatch behavior.
6. Deploy an exact committed revision with worker and recovery timer off.
7. Verify worker-off legacy generation and recovery no-op behavior.
8. Because `LAKOKU_GENERATION_WORKER` is process-global, enable worker and recovery timer only in a dedicated canary deployment with explicitly scoped traffic. Do not claim account/cohort isolation unless external routing enforces it.
9. Run controlled authenticated generation smoke against the canary.
10. Run controlled restart, ownership-loss, and duplicate-claim tests.
11. Run a controlled 30-job soak and inspect stuck jobs, duplicate publication, heartbeat failures, and logs.
12. On any failed criterion, stop new canary traffic, inventory `QUEUED`, `RUNNING`, and `RETRY_WAIT` jobs, and choose an explicitly approved disposition before disabling the worker. Once the flag is off, recovery must no-op and cannot drain jobs. Options are later reactivation to drain under fixed code, or an approved DB remediation/restore procedure. Enable broadly only after explicit sign-off and a documented rollback decision.

Migration, scheduler, and deployment steps remain instructions only during this local work.

Repository migrations are forward-only. Rollback requires a separately approved forward-fix or database restore. No down migration, linked rollback, or restore exercise occurs during this local work.

## 14. Acceptance Criteria

The implementation is locally release-ready only when all statements are backed by fresh evidence:

- listed local artifacts are verified ignored and absent from tracked and staged index entries;
- `nul` is safely disposed of or explicitly retained with a reason;
- unstaged, staged, and intended untracked implementation files pass whitespace validation;
- all unit tests pass;
- official lint exits zero;
- typecheck, build, migration-version check, and diff checks pass;
- local Supabase reset succeeds;
- all pgTAP tests, including claim-by-ID, checkpoint versioning, and checkpoint fencing files, pass;
- claim exclusivity, permissions, and atomic worker-owned checkpoint mutation fencing are proven locally;
- personalized retries reuse valid prose checkpoints;
- personalized prose and choices abort on ownership loss;
- internal route uses the shared kickoff seam;
- recovery route has automated authentication and dispatch tests;
- operations documentation reflects the safe rollout sequence;
- no commit, push, linked migration, production secret change, deployment, or worker enablement occurred.

Passing these criteria changes status only to **local release-ready**. If source work and non-DB gates pass but Docker/Supabase local remains unavailable, report **implementation complete, DB verification blocked** and keep local release-ready unchecked. Broad production enablement remains **NO-GO** until local DB proof, remote migration, scheduler, worker-off deployment, controlled authenticated smoke, controlled restart/ownership/duplicate tests, controlled 30-job soak, and release sign-off pass.
