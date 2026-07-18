# Durable Chapter Generation Pipeline Design

## Status

Approved design for stabilizing chapter generation on the Lakoku VPS.

## Goal

Make chapter generation durable, bounded, observable, and recoverable on the current 4 CPU / 8 GiB RAM VPS. Completion requires 40/40 controlled production test chapters to finish without lost jobs, publication failures caused by lease expiry, stuck status, duplicate publication, or untracked terminal outcomes. Lease expiry after worker death remains an intentional recovery mechanism.

## Evidence and root-cause assessment

Live read-only audit found the VPS healthy:

- Four CPUs with low load and no CPU pressure.
- More than 4 GiB RAM available during audit.
- No swap activity, kernel OOM event, or container OOM kill.
- `lakoku-web` had zero restarts and used about 119 MiB RAM.
- Root filesystem used 37%; inode use was 13%.
- Local and public root requests returned HTTP 200.
- No explicit Caddy timeout override was present.

Therefore, machine capacity is not the demonstrated root cause.

Code inspection identified these reliability gaps:

1. A generation lease lasts 300 seconds, while valid serial provider fallback and repair work can exceed 300 seconds before publish.
2. Continuation jobs live in a process-local `Map` and Next `after()`. Process restart, deploy, crash, or OOM can lose work.
3. HTTP serving and long-running model work share one Node process without global or per-provider concurrency limits.
4. Provider fallback is serial and lacks candidate deduplication, exponential backoff, jitter, `Retry-After` handling, circuit breaking, and a total workflow deadline.
5. Canon loading reads `character_states` without filtering by `story_id`.
6. Persistent telemetry does not cover every exception path, and reader status collapses distinct failures into a generic failed state.
7. Existing TestSprite reruns use deterministic generation and do not reproduce the real production provider, lease, concurrency, or recovery paths.
8. Production builds ignore TypeScript errors, while `pnpm typecheck` currently fails.
9. Provider-related migration state on the VPS is not yet safely verified.

## Chosen approach

Use PostgreSQL as a durable generation queue and run generation in a separate worker service. Keep atomic chapter publication and story-level database leases, but add job persistence, heartbeat-driven lease renewal, stale-job recovery, bounded provider execution, and structured telemetry.

Alternatives rejected:

- Hardening only the current Next process leaves jobs vulnerable to restart and deployment loss.
- Increasing lease duration and adding logs fixes symptoms but cannot provide durable 40/40 reliability.
- Adding Redis introduces another operational dependency when PostgreSQL already provides transactional locking and persistence.

## Architecture

### Services

`web`:

- Serves Next.js UI and HTTP APIs.
- Authenticates and authorizes generation requests.
- Enqueues idempotent generation jobs.
- Returns HTTP 202 with a job identifier.
- Reads durable job status for clients.
- Does not execute long-running provider workflows.

`generation-worker`:

- Uses the same application image with a dedicated command.
- Claims queued jobs through PostgreSQL.
- Executes standard and personalized generation workflows.
- Maintains job heartbeat and story lease renewal.
- Publishes chapters atomically.
- Retries transient failures and records terminal failures.
- Has production default concurrency `2`; rollout temporarily overrides it to `1` until smoke validation passes.

PostgreSQL/Supabase:

- Stores durable generation jobs and attempt telemetry.
- Provides idempotent enqueue and job claiming RPCs.
- Coordinates workers with row locks and `FOR UPDATE SKIP LOCKED`.
- Retains existing atomic chapter publication and story-level concurrency rules.

No Redis or separate broker is required.

## Persistent data model

### `generation_jobs`

Required fields:

- `id uuid primary key`
- `story_id uuid not null`
- `chapter_number integer not null`
- `user_id uuid not null`
- `generation_kind text not null` with standard or personalized values
- `trigger_choice_id uuid null`
- `status text not null`
- `attempt_count integer not null default 0`
- `max_attempts integer not null`
- `available_at timestamptz not null`
- `deadline_at timestamptz not null`
- `claimed_at timestamptz null`
- `heartbeat_at timestamptz null`
- `worker_id text null`
- `claim_token uuid null`
- `correlation_id uuid not null`
- `last_error_code text null`
- `last_error_class text null`
- `last_error_at timestamptz null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `completed_at timestamptz null`

A partial unique constraint prevents more than one nonterminal job for `(story_id, chapter_number)`. A duplicate with matching generation kind and trigger returns the existing job. A duplicate with incompatible generation kind, trigger, or owner fails with `GENERATION_JOB_CONFLICT`; caller input never mutates existing work. Chapter publication remains the final idempotency boundary.

### Job states

- `QUEUED`: ready for claim.
- `RUNNING`: claimed by a live worker.
- `RETRY_WAIT`: transient failure waiting for `available_at`.
- `SUCCEEDED`: target chapter exists and publication completed.
- `FAILED`: permanent failure or retry budget exhausted.
- `CANCELLED`: operator-cancelled before publication.

Valid transitions are enforced in database functions, not only application code:

- `QUEUED -> RUNNING | CANCELLED`
- `RUNNING -> SUCCEEDED | RETRY_WAIT | FAILED | CANCELLED`
- `RETRY_WAIT -> RUNNING | CANCELLED`
- `SUCCEEDED`, `FAILED`, and `CANCELLED` are terminal.

Cancellation revokes current claim ownership. Publication requires matching `claim_token`, active job status, and active story lease in the same transaction, so a cancelled or stale worker cannot publish.

### Attempt telemetry

Each attempt records sanitized operational metadata:

- Job and correlation IDs.
- Story ID and chapter number.
- Attempt number.
- Workflow phase.
- Provider and model identifiers.
- Start/end timestamps and elapsed time.
- Lease age and remaining lifetime at publish.
- Retry decision and sanitized error code.
- Worker ID.

Prompt text, generated prose, choices, credentials, API keys, tokens, and provider response bodies must never enter telemetry or logs.

## Database operations

### Idempotent enqueue

For choice-driven generation, applying the choice and enqueueing its next chapter occur in one database transaction and one RPC. Explicit chapter starts use a separate enqueue RPC because no choice mutation is required. This removes the crash window between accepted choice and durable job creation.

Security-definer RPCs use a fixed empty `search_path`, schema-qualified objects, ownership and story-state checks inside the function, revoked default public execute access, explicit grants only to intended roles, and validated identifiers. RLS remains defense in depth; caller-supplied owner IDs are never trusted without session ownership verification.

Each RPC inserts or returns the existing compatible active job. Concurrent duplicate requests return the same logical work item. Incompatible duplicate inputs return `GENERATION_JOB_CONFLICT`.

If the chapter already exists, enqueue returns `{ alreadyComplete: true, jobId: null, correlationId: null, status: 'SUCCEEDED' }` and does not create synthetic work. API response contracts therefore make `jobId` and `correlationId` nullable only for this completed fast path.

### Claim

A worker claims available jobs in a short transaction using `FOR UPDATE SKIP LOCKED`, ordered by `available_at` and creation time. Claiming sets:

- `status = 'RUNNING'`
- `claimed_at`
- `heartbeat_at`
- `worker_id`
- a fresh unguessable `claim_token`
- incremented `attempt_count`

The transaction does not include provider calls.

### Runtime budgets

Initial production values are explicit and configuration-validated:

- Story lease duration: `180 seconds`.
- Job heartbeat interval: `15 seconds`.
- Story lease renewal interval: `30 seconds`, renewing back to 180 seconds.
- Stale job threshold: `75 seconds` without heartbeat.
- Whole generation workflow deadline: `12 minutes` per attempt, clipped by the job's absolute 20-minute deadline.
- Prose candidate timeout: `90 seconds`.
- Choice candidate timeout: `45 seconds`.
- Maximum job attempts: `4`.
- Retry backoff: base `5 seconds`, exponential factor `2`, full jitter, cap `120 seconds`.
- Accepted `Retry-After` cap: `120 seconds`; larger values use the cap.
- Worker shutdown grace period: `120 seconds`.
- Preparing-state alert threshold: `15 minutes` from job creation.
- Jobs receive an immutable `deadline_at = created_at + 20 minutes`. Claiming is forbidden after this deadline. Active workers clip provider timeouts to remaining time, abort at `deadline_at`, and transition to `FAILED` with `GENERATION_DEADLINE_EXCEEDED` unless fenced publication already committed or the chapter already exists. Watchdog also terminalizes overdue queued, retry-wait, and stale-running jobs.

The absolute deadline takes precedence over retry count, backoff, and per-attempt deadline. Tests use injectable clocks and shorter values; production defaults remain above.

### Heartbeat and lease renewal

While generation runs, worker periodically:

- Updates `generation_jobs.heartbeat_at` only when `worker_id`, `claim_token`, and `RUNNING` status still match.
- Renews the story generation lease before expiration.
- Aborts provider work and stops before publish if ownership, cancellation state, workflow deadline, or lease renewal is lost.

Lease expiration remains a crash-recovery mechanism, not the normal workflow deadline.

### Stale recovery

Worker periodically scans `RUNNING` jobs whose heartbeat is older than the stale threshold. Recovery:

- Marks already-published chapters `SUCCEEDED`.
- Atomically fences old job ownership and revokes the matching old story lease when recovery proves the job heartbeat stale. Lease revocation matches job ID and old claim token, preventing recovery from releasing another worker's lease.
- Moves unpublished recoverable jobs from `RUNNING` to `RETRY_WAIT`, with `available_at` set to current time so they are immediately claimable without consuming an attempt on `LEASE_HELD`.
- Clears old worker ownership and `claim_token`.
- Preserves attempt history.
- Never deletes job rows.

A recovered stale worker cannot publish because publication fences on the current job claim token and active story lease.

Restarting only the worker during a controlled test must demonstrate this behavior.

## Request and status flow

1. Client submits a choice or explicit start request.
2. Web route validates session, ownership, story state, chapter number, and generation entitlement.
3. For choice-driven generation, route calls one combined RPC that atomically applies the choice and enqueues the compatible next-chapter job. For explicit starts, route calls the enqueue-only RPC.
4. RPC returns applied outcome plus durable job identity and status.
5. Route returns HTTP 202 with existing compatible outcome fields plus current status and normally non-null `jobId`/`correlationId`; already-published fast path returns success with both IDs null.
6. Reader polls a durable job-status endpoint. Endpoint authenticates session, verifies story ownership or reader entitlement, returns only reader-safe status/error codes, and never exposes worker IDs, claim tokens, provider internals, or another user's job identifiers.
7. Worker claims and executes the job independently of the HTTP request lifetime.
8. Successful atomic publish moves the job to `SUCCEEDED`.
9. Retryable failure moves it to `RETRY_WAIT`; permanent failure moves it to `FAILED`.
10. Reader displays preparing for queued, running, and retry-wait states; it displays failure only for terminal failed or cancelled states.

The process-local continuation `Map` and long-running `after()` generation path are removed from VPS execution. Cloudflare compatibility can retain a separate adapter only if it enqueues the same durable job rather than owning the work.

## Generation execution

### Workflow phases

Worker records and bounds these phases:

1. Job and chapter preflight.
2. Story lease acquisition.
3. Canon loading.
4. Context compilation and retrieval logging.
5. Provider candidate selection.
6. Prose generation.
7. Layer A validation and bounded repair.
8. Layer B validation and bounded repair.
9. Choice generation.
10. Plot-debt or personalized checks.
11. Atomic publication.
12. Completion telemetry.

### Canon isolation

Every story-scoped query, including `character_states`, must filter by `story_id`. Tests must create two stories and prove no cross-story state reaches the generated context.

### Provider candidate policy

Candidate identity is normalized from provider, base URL, and model ID. Duplicate candidates from DB routes and environment fallback are removed while preserving configured priority.

Controls:

- Global worker concurrency starts at `2`.
- Per-provider concurrency is configurable and cannot exceed global concurrency.
- Per-attempt prose and choice timeouts remain explicit.
- A total workflow deadline prevents unbounded serial fallback.
- Repair passes remain bounded to at most two Layer A repairs and two Layer B repairs per job attempt.
- Provider calls stop when the workflow deadline cannot accommodate another attempt.
- Abort signals propagate through provider requests.

### Retry policy

Transient failures:

- HTTP 429.
- HTTP 502, 503, and 504.
- Connection reset and temporary network failures.
- Provider timeout where workflow/job budget permits retry.
- Temporary database connectivity failure.

Permanent failures:

- Invalid or unauthorized provider configuration.
- Invalid canon or irreparable validation failure.
- Unsupported model or malformed route configuration.
- Retry budget exhaustion.

Within one job attempt, each normalized candidate is tried at most once per generation phase. Candidate-local timeout, connection error, or HTTP 429/502/503/504 advances to the next healthy configured candidate while phase and absolute deadlines permit. The worker does not sleep between candidates. If every eligible candidate fails transiently, the job moves to `RETRY_WAIT`; `available_at` uses the largest valid `Retry-After` returned by failed candidates, capped at 120 seconds, or exponential full-jitter backoff when none is present. A durable retry starts a new attempt and may evaluate the candidate chain again. Permanent configuration/auth errors disable only that candidate for the current attempt; if no valid candidate remains, job fails permanently.

Retry schedules are stored in `available_at`; no process-local timer owns durable retry state.

A circuit breaker is required per normalized provider endpoint. It opens after five transient failures within 60 seconds, remains open for 30 seconds, then permits one half-open probe. State is bounded and observable in each worker process; it is an optimization only, never a correctness dependency.

## Error handling

Errors are classified at the provider, workflow, database, and job layers. Each boundary preserves a stable sanitized error code and the original exception only in local process context.

Unexpected exceptions must:

1. Record an attempt failure when database access remains available.
2. Release or allow safe expiration of the story lease.
3. Move the job to retry or terminal failure according to classification.
4. Avoid returning provider internals or secrets to clients.

If DB access fails before telemetry can persist, stale recovery creates a synthetic `WORKER_ATTEMPT_INTERRUPTED` attempt record when it reclaims the job. Acceptance requires every terminal job and every recovered interrupted attempt to have durable telemetry; an individual transient exception may be reconstructed by recovery rather than written synchronously.

Chapter publication, publication events/outbox, job transition to `SUCCEEDED`, and terminal success telemetry occur in one database transaction. Publication verifies `job_id`, current `claim_token`, `RUNNING` status, expected chapter, and active story lease. This prevents published chapters with indefinitely running jobs and fences stale workers.

Publication conflicts are reconciled idempotently:

- Existing expected chapter means success.
- Existing incompatible state means a terminal conflict requiring operator review.
- Duplicate publication cannot create duplicate chapter or event records.

## Worker lifecycle

Startup:

- Verify required schema version.
- Verify provider route configuration without displaying credentials.
- Register a unique worker ID.
- Begin claim and stale-recovery loops.

Shutdown:

- Stop claiming new jobs.
- Keep heartbeats for active jobs during the 120-second grace period.
- Allow active jobs to finish when possible.
- At grace expiration, abort provider calls, stop heartbeat/renewal, and exit without publishing unless fenced publication already committed.
- Stale recovery resumes unfinished work after heartbeat threshold.

Health:

- Add a worker health signal covering process liveness, DB access, last successful heartbeat, and claim-loop progress.
- Root web health is insufficient to represent generation health.

## Deployment

Docker Compose gains `generation-worker` using the same built image as `web`. It has no public port. Restart policy remains `unless-stopped`.

Rollout order:

1. Back up database and verify current migration state.
2. Apply backward-compatible queue and telemetry migrations.
3. Deploy image containing both old and new-compatible code.
4. Start worker with concurrency `1` and verify health.
5. Enable API enqueue path.
6. Run one controlled smoke chapter.
7. Raise worker concurrency to `2` after clean telemetry.
8. Run TestSprite and controlled 40-chapter validation.
9. Raise to concurrency `4` only during the planned validation stage and only while resource and provider metrics remain healthy.

Rollback:

- Disable new enqueue for new requests while keeping status reads available.
- Let active jobs finish during grace; mark remaining queued/retry-wait jobs `CANCELLED` with operator reason.
- After worker exits, run the idempotent database recovery RPC from a one-shot maintenance command after the 75-second stale threshold. It reconciles interrupted running jobs to `SUCCEEDED`, `RETRY_WAIT`, or `CANCELLED` according to publication and rollback state; it does not require the worker service to remain enabled.
- Reader receives terminal retry guidance for cancelled jobs instead of indefinite preparing.
- Leave job and telemetry rows intact.
- Do not roll back destructive schema changes during incident response.
- Old client response compatibility remains intact.

## Test strategy

### Test-driven implementation

Before each behavior change, create the smallest failing automated test. Required cases:

- Duplicate enqueue returns one active job.
- Existing chapter makes enqueue idempotently complete.
- Two workers cannot claim the same job.
- Worker death leaves a recoverable stale job.
- Stale recovery detects an already-published chapter as success.
- Heartbeat renews job ownership and story lease.
- Lost ownership stops work before publish.
- Generation exceeding the old 300-second boundary can renew safely.
- HTTP 429 honors `Retry-After`.
- HTTP 502–504 and network errors use bounded backoff.
- Invalid provider auth fails permanently.
- Candidate normalization removes duplicates.
- Total workflow deadline prevents excessive serial fallback.
- Global and per-provider concurrency caps hold.
- Publication is idempotent across retry.
- `character_states` and all canon data remain story-scoped.
- Every terminal path emits sanitized telemetry.
- Reader status distinguishes retrying from terminal failure.
- TypeScript errors block production build.

### Local and database gates

Required green gates:

```bash
pnpm lint
pnpm typecheck
pnpm exec vitest run
pnpm run test:db:personalized
LAKOKU_DEPLOY=vps pnpm build
```

Focused fault-injection tests must run before the full suite. Database tests use isolated local/test data, not production user stories.

### TestSprite

TestSprite must target the running production deployment only after local and staging-equivalent gates pass. Use a dedicated production test account and dedicated stories. Existing credentials found in TestSprite artifacts must be rotated before this run.

TestSprite coverage:

- Authentication and test-story setup.
- Start generation and durable status polling.
- Choice submission and next-chapter enqueue.
- Duplicate request behavior.
- Retry status behavior.
- Terminal error presentation.
- Recovery after controlled worker restart.
- No impact on unrelated user stories.

Before invoking TestSprite bootstrap, check whether `.testsprite/config.json` exists. Existing configuration must be reused rather than bootstrapped.

### Controlled 40-chapter production validation

Budget: at most 40 chapter targets using real configured providers and dedicated production test data. Each target may consume normal in-job provider retries but may be generated only once as a chapter number. A failed target makes the 40/40 gate fail; it is not replaced or removed from the denominator. After fixing a confirmed defect, a new 40-target acceptance run requires separate user approval because it can consume additional provider cost.

Planned allocation:

- 8 serial baseline chapters at worker concurrency `1`.
- 12 chapters at concurrency `2`.
- 12 chapters at controlled concurrency `4`, only if safety thresholds remain green.
- 4 chapters covering worker restart and stale recovery.
- 4 chapters covering retry/fallback scenarios available without changing provider credentials or exposing user data.

If a stage fails, stop spending remaining chapter targets, preserve telemetry, investigate the single failure, add or improve a failing automated test, and fix the confirmed root cause. Do not resume a fresh paid acceptance run without user approval.

## Production safety

- Use only dedicated test account and stories.
- Never mutate real user stories.
- Do not expose `.env`, provider keys, tokens, prompts, prose, or personal data.
- Do not restart or reload shared Caddy during application tests.
- A controlled restart may target only `generation-worker`, never the shared `/opt/wacrm` stack.
- Monitor host RAM, CPU, disk, container restart count, queue depth, queue age, HTTP 5xx rate, and provider failures throughout validation at least every 15 seconds.
- Stop load escalation when any threshold holds: available RAM below 1.5 GiB for two consecutive samples; host CPU above 85% for 60 seconds; root disk above 80%; any unexpected web/worker restart or OOM; oldest runnable job above 15 minutes; provider 429/5xx above 20% over the latest 20 attempts; public root p95 latency above 2 seconds over 20 samples; or unrelated service healthcheck failure.

## Acceptance criteria

Work is complete only when all conditions hold:

- 40/40 controlled production chapters reach `SUCCEEDED`.
- No generation job is lost across HTTP completion or worker restart.
- No publish fails because a normally operating job's lease expires.
- No reader remains indefinitely in preparing state.
- No duplicate chapter or duplicate publication event exists.
- Every failed or retried attempt has sanitized durable telemetry.
- Queue depth returns to zero after validation.
- Web and worker containers remain healthy without OOM or unexpected restart.
- `pnpm lint`, `pnpm typecheck`, full Vitest, required database tests, VPS production build, and TestSprite all pass.
- Existing user stories and unrelated VPS services show no regression.

## Implementation workstreams

This design ships through separate approved implementation plans, each leaving the repository deployable and backward compatible:

1. **Foundation:** migrations, state machine, secure enqueue/claim/heartbeat/recovery RPCs, fencing, DB tests, and TypeScript generation-job contracts.
2. **Worker extraction:** dedicated worker command, runtime adapter, heartbeat/renewal, graceful shutdown, canon isolation fix, and fault-injection tests. API still may retain old execution behind a disabled-by-default compatibility flag until worker proves healthy.
3. **Provider resilience:** candidate normalization, concurrency controls, deadlines, retry/backoff, circuit breaker, and deterministic tests.
4. **API/status/telemetry cutover:** atomic choice-plus-enqueue RPC usage, explicit-start enqueue, authorized durable status, reader behavior, terminal telemetry, and removal of VPS process-local continuation.
5. **Deployment and verification:** Compose worker service, migration verification, rollout/rollback tooling, local gates, TestSprite, and separately approved paid 40-target production run.

Each workstream receives its own implementation plan and verification gate. Failure in one stage blocks later stages; no partial cutover routes production requests to an unverified worker.

## Out of scope

- Replacing Supabase/PostgreSQL with Redis or another broker.
- Scaling across multiple VPS hosts.
- Refactoring unrelated authoring or payment code beyond fixes required for green quality gates.
- Changing prose product requirements or story quality policy.
- Persisting prompts or generated content for operational debugging.
