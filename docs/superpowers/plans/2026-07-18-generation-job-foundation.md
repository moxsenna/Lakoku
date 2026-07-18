# Generation Job Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build backward-compatible PostgreSQL foundation and TypeScript contracts for durable chapter-generation jobs without cutting production APIs or provider execution over to worker flow.

**Architecture:** PostgreSQL owns job identity, legal state transitions, claims, claim-token fencing, heartbeats, lease renewal, stale recovery, and atomic publication completion. Existing web routes, process-local continuations, provider orchestration, and legacy publishers stay active through Workstream 1; new RPCs remain unused until later cutover.

**Tech Stack:** PostgreSQL 15/Supabase migrations, PL/pgSQL, pgTAP, Supabase CLI, Node.js 22, TypeScript 5.7, Zod 4, Vitest, `psql` multi-session race harnesses.

---

## Scope and compatibility decisions

This plan covers Workstream 1 only:

- Reproducible baseline migration for pre-existing lifecycle objects.
- `generation_jobs` and sanitized `generation_job_attempts`.
- DB-enforced state machine.
- Explicit-start enqueue.
- Worker claim, lease, heartbeat, finish, cancellation, and recovery RPCs.
- Fenced publication RPCs.
- Atomic personalized choice plus enqueue.
- Atomic standard choice plus enqueue.
- Public/internal TypeScript contracts and thin RPC adapters.
- pgTAP and multi-session race tests.

Deferred:

- Worker process and claim loop.
- Provider retry/fallback changes.
- Canon loader fix.
- HTTP/API cutover and status endpoint.
- Reader UI changes.
- Docker Compose worker.
- Production migration application, TestSprite, and paid 40-target run.

Physical identity types follow current schema, not conceptual UUID labels in design prose:

```sql
story_id text references public.stories(id)
trigger_choice_id text
```

Current story IDs and choice IDs are opaque text. Converting them to UUID would break existing data and remains out of scope.

## Baseline facts already verified

Read-only linked schema dump proved current production definitions:

- `generation_leases(id uuid, story_id text, chapter_number integer, status text, holder text, expires_at timestamptz, created_at timestamptz)`.
- Statuses: `ACTIVE`, `RELEASED`, `EXPIRED`.
- Unique partial index `generation_leases_one_active` on `story_id` where status is `ACTIVE`.
- `acquire_generation_lease(text,integer,text,integer,text) -> jsonb`.
- `release_generation_lease(text,uuid) -> jsonb`.
- Legacy `publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text) -> jsonb`.
- Current repo already owns `publish_chapter_v2` and personalized migrations.

Repository migrations also do not create pre-history core tables such as `stories`, `chapters`, `choice_outcomes`, `reader_states`, and canon tables referenced by earliest checked-in migrations. Task 1 therefore captures one verified core/runtime baseline at a timestamp before all current migrations. Copy definitions only from sanitized linked schema dump, preserve exact constraints/indexes/RLS/grants, and verify catalog hashes for legacy functions. Do not hand-reconstruct schema from application assumptions.

## File structure

Create:

- `supabase/migrations/20260707000000_core_runtime_baseline.sql` — verified pre-history core/runtime schema required by every checked-in migration, using idempotent DDL and exact linked definitions.
- `supabase/migrations/20260718010000_generation_jobs_foundation.sql` — queue, attempts, state-machine trigger, indexes, RLS/grants.
- `supabase/migrations/20260718020000_generation_job_enqueue.sql` — authenticated explicit enqueue.
- `supabase/migrations/20260718030000_generation_job_worker_rpcs.sql` — claim, bound lease, heartbeat, finish, cancel, recover.
- `supabase/migrations/20260718040000_generation_job_fencing.sql` — fenced legacy and V2 publication.
- `supabase/migrations/20260718050000_generation_choice_enqueue.sql` — atomic personalized/standard choice plus enqueue.
- `supabase/tests/runtime_lifecycle_baseline_test.sql`.
- `supabase/tests/generation_jobs_schema_test.sql`.
- `supabase/tests/generation_job_enqueue_test.sql`.
- `supabase/tests/generation_job_worker_rpc_test.sql`.
- `supabase/tests/generation_job_recovery_test.sql`.
- `supabase/tests/generation_job_fencing_test.sql`.
- `supabase/tests/generation_choice_enqueue_test.sql`.
- `packages/contracts/src/generation-job.ts` — reader-safe Zod schemas.
- `lib/runtime/generation-jobs.contract.ts` — internal Zod schemas/types.
- `lib/runtime/generation-jobs.ts` — thin server-only Supabase RPC adapters.
- `tests/contracts/generation-job-contracts.test.ts`.
- `tests/runtime/generation-jobs.test.ts`.
- `scripts/generation-job-enqueue-race.ts`.
- `scripts/generation-job-claim-race.ts`.
- `scripts/generation-job-recovery-race.ts`.

Modify:

- `packages/contracts/src/index.ts` — export public job contracts.
- `lib/runtime/index.ts` — export internal contracts/adapters.
- `package.json` — focused foundation gates.

Do not modify during Workstream 1:

- `app/api/stories/[id]/choices/route.ts`.
- `lib/api/generation-continuation.server.ts`.
- `lib/api/chapter-status.server.ts`.
- `lib/api/start-chapter.server.ts`.
- `lib/runtime/story-generation.ts`.
- `lib/runtime/personalized-generation.ts`.
- `docker-compose.yml`.

## Test commands

Local DB commands are destructive only to local Supabase. First create missing local CLI config in Task 1, then:

```powershell
pnpm exec supabase start
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
```

After start/reset, set marker only after loopback/container ownership verification:

```powershell
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
```

Never set `lakoku.test_target = 'local-cli'` on linked, staging, or production databases.

---

### Task 1: Capture reproducible legacy lifecycle baseline

**Files:**
- Create: `supabase/config.toml`
- Create: `scripts/set-local-db-test-marker.ts`
- Create: `supabase/tests/runtime_lifecycle_baseline_test.sql`
- Create: `supabase/migrations/20260707000000_core_runtime_baseline.sql`
- Create temporarily: `.zcode/generation-foundation-linked-schema.sql` (never commit)
- Create temporarily: `.zcode/generation-foundation-linked-inventory.txt` (never commit)

- [ ] **Step 1: Add reproducible local Supabase project config**

Create `supabase/config.toml` with project ID `lakoku-v2`, standard local API/DB ports that do not conflict with existing services, migrations enabled, and seed disabled unless a tracked seed file exists. Run:

```powershell
pnpm exec supabase start
pnpm exec supabase status -o json
```

Expected: loopback API/DB URLs and container label `com.supabase.cli.project=lakoku-v2`.

- [ ] **Step 2: Add safe local marker helper**

Create `scripts/set-local-db-test-marker.ts`. Reuse `verifyLocalRaceTarget()` so marker can only target current loopback container, then run:

```ts
const target = verifyLocalRaceTarget('set local DB test marker')
execLocalPsql(target, "alter database postgres set lakoku.test_target = 'local-cli';")
```

Because `verifyLocalRaceTarget()` currently expects marker first and derives unsafe container name from folder `lakoku v2`, split container/loopback verification into exported `verifyLocalRaceContainer()`. Parse tracked `supabase/config.toml` project ID (`lakoku-v2`) using a strict `[a-zA-Z0-9_-]+` validator and derive container `supabase_db_lakoku-v2`; never derive from directory basename. Let `verifyLocalRaceTarget()` call container verifier plus marker check. Marker helper calls container-only verifier, sets DB marker, reconnects, then asserts marker.

- [ ] **Step 3: Produce sanitized linked baseline source and inventory**

Run read-only commands:

```powershell
pnpm exec supabase db dump --linked --schema public --file '.zcode/generation-foundation-linked-schema.sql'
rg -n '^CREATE (TABLE|OR REPLACE FUNCTION|UNIQUE INDEX|INDEX|POLICY)|^ALTER TABLE.*(CONSTRAINT|ROW LEVEL SECURITY)|^(GRANT|REVOKE)' '.zcode/generation-foundation-linked-schema.sql' > '.zcode/generation-foundation-linked-inventory.txt'
```

Never commit these artifacts. Record MD5 hashes from `pg_get_functiondef` for exact legacy functions. Add concrete acquired/released hashes to `runtime_lifecycle_baseline_test.sql` beside existing publisher hash; never leave symbolic values in committed test:

- `acquire_generation_lease(text,integer,text,integer,text)`.
- `release_generation_lease(text,uuid)`.
- `publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)` (`e8f33f2aaca0b3343f8fe51200fc402b` already verified).

- [ ] **Step 4: Write failing pgTAP baseline test**

Create `supabase/tests/runtime_lifecycle_baseline_test.sql` with local marker guard and assertions for exact objects consumed by current runtime:

```sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'runtime lifecycle tests require local-cli';
  end if;
end
$$;

select plan(23);
select has_table('public', 'generation_leases');
select has_table('public', 'idempotency_keys');
select has_table('public', 'story_events');
select has_table('public', 'outbox');
select has_column('public', 'generation_leases', 'id');
select has_column('public', 'generation_leases', 'story_id');
select has_column('public', 'generation_leases', 'chapter_number');
select has_column('public', 'generation_leases', 'status');
select has_column('public', 'generation_leases', 'holder');
select has_column('public', 'generation_leases', 'expires_at');
select has_index('public', 'generation_leases', 'generation_leases_one_active');
select has_function('public', 'acquire_generation_lease', array['text','integer','text','integer','text']);
select has_function('public', 'release_generation_lease', array['text','uuid']);
select has_function('public', 'publish_chapter', array['text','integer','text','jsonb','text','jsonb','jsonb','uuid','text']);
select ok((select prosecdef from pg_proc where oid = 'public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure));
select ok((select prosecdef from pg_proc where oid = 'public.release_generation_lease(text,uuid)'::regprocedure));
select ok(not has_function_privilege('anon', 'public.acquire_generation_lease(text,integer,text,integer,text)', 'EXECUTE'));
select ok(not has_function_privilege('authenticated', 'public.acquire_generation_lease(text,integer,text,integer,text)', 'EXECUTE'));
select ok(has_function_privilege('service_role', 'public.acquire_generation_lease(text,integer,text,integer,text)', 'EXECUTE'));
select ok(has_function_privilege('service_role', 'public.release_generation_lease(text,uuid)', 'EXECUTE'));
select ok(pg_get_functiondef('public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure) like '%generation_leases%' and pg_get_functiondef('public.acquire_generation_lease(text,integer,text,integer,text)'::regprocedure) like '%LEASE_HELD%');
select ok(pg_get_functiondef('public.release_generation_lease(text,uuid)'::regprocedure) like '%generation_leases%' and pg_get_functiondef('public.release_generation_lease(text,uuid)'::regprocedure) like '%RELEASED%');
select is(md5(pg_get_functiondef('public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure)), 'e8f33f2aaca0b3343f8fe51200fc402b');
select * from finish();
rollback;
```

- [ ] **Step 5: Reset local DB and prove missing history fails**

Run:

```powershell
pnpm exec supabase start
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/runtime_lifecycle_baseline_test.sql
```

Expected before migration: reset or focused test fails because core/lifecycle objects are missing from checked-in history. After every reset in later tasks, rerun `node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts` before guarded pgTAP tests because reset recreates database state.

- [ ] **Step 6: Add exact verified core/runtime baseline migration**

Create `supabase/migrations/20260707000000_core_runtime_baseline.sql` from sanitized linked dump. Include all pre-history public objects needed for a clean migration replay, not only lifecycle objects:

- Core reader tables: `stories`, `chapters`, `choice_outcomes`, `reader_states`.
- Canon tables referenced by authoring/personalized migrations: `characters`, aliases, voice sheets, facts, knowledge, secrets, timeline, threads, rollups, blueprints.
- Runtime tables: `idempotency_keys`, `generation_leases`, `story_events`, `outbox` and required sequences.
- Exact constraints, FKs, indexes, RLS state, policies, and grants that existed before `20260708000000`.
- Exact legacy functions needed by current migrations/runtime: `acquire_generation_lease`, `release_generation_lease`, `publish_chapter`, and pre-history RLS helpers used by early policies.

Rules:

```sql
-- Preserve dependency order: tables, keys, indexes, functions, RLS/policies, grants.
-- Use IF NOT EXISTS only where PostgreSQL supports it without hiding incompatible shape.
-- Functions: CREATE OR REPLACE with exact verified signatures/body.
-- Preserve verified legacy search_path and behavior; hardening happens only in new v1 RPCs.
-- Revoke PUBLIC/anon/authenticated execution from lifecycle writers.
-- Grant lifecycle writer execution to service_role only.
```

Do not include objects created by checked-in migrations dated `20260708000000` or later. Generate an object inventory diff between sanitized linked dump and clean replay; every object referenced by existing migrations must exist before its first reference.

Existing-install guard is mandatory because this backdated migration will be discovered by `supabase db push --include-all` after later migrations have already run:

```sql
do $$
begin
  if pg_catalog.to_regclass('public.stories') is not null then
    -- Validate exact required tables, signatures, indexes, and legacy function hashes.
    -- Raise BASELINE_SCHEMA_DRIFT on mismatch.
    -- Perform no CREATE, ALTER, policy, grant, revoke, or function replacement.
    return;
  end if;
  -- Empty local database path: create verified pre-history baseline.
end
$$;
```

Thus linked/staging/production execution is validation-only and cannot restore removed grants/policies or overwrite newer functions. Test both paths: empty local creation and pre-populated sentinel no-op with before/after ACL/function hashes. Deployment later must use `supabase db push --include-all` so backdated migration receives a ledger entry; Workstream 1 does not run that command against production.


- [ ] **Step 7: Reset local DB and prove baseline passes**

Run:

```powershell
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/runtime_lifecycle_baseline_test.sql
pnpm exec supabase test db --local supabase/tests/publish_chapter_v2_test.sql
```

Expected: all assertions pass; V2 compatibility remains green.

- [ ] **Step 8: Remove temporary linked artifacts**

Run:

```powershell
Remove-Item -LiteralPath '.zcode/generation-foundation-linked-schema.sql'
Remove-Item -LiteralPath '.zcode/generation-foundation-linked-inventory.txt'
```

Expected: schema dump gone; no production schema dump enters git.

- [ ] **Step 9: Commit baseline**

```bash
git add supabase/config.toml scripts/set-local-db-test-marker.ts scripts/authoring-race-session.ts supabase/migrations/20260707000000_core_runtime_baseline.sql supabase/tests/runtime_lifecycle_baseline_test.sql
git commit -m "test: capture runtime lifecycle baseline"
```

---

### Task 2: Define public and internal generation-job contracts

**Files:**
- Create: `packages/contracts/src/generation-job.ts`
- Create: `lib/runtime/generation-jobs.contract.ts`
- Create: `tests/contracts/generation-job-contracts.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `lib/runtime/index.ts`

- [ ] **Step 1: Write failing contract tests**

Create tests covering strict reader-safe and internal shapes:

```ts
import { describe, expect, it } from 'vitest'
import {
  EnqueueGenerationJobResultSchema,
  GenerationJobReaderStatusSchema,
} from '@lakoku/contracts'
import { ClaimedGenerationJobSchema } from '@/lib/runtime/generation-jobs.contract'

describe('generation job contracts', () => {
  it('accepts active enqueue with UUID identities', () => {
    expect(EnqueueGenerationJobResultSchema.parse({
      alreadyComplete: false,
      jobId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      status: 'QUEUED',
    })).toMatchObject({ status: 'QUEUED' })
  })

  it('accepts completed fast path only with null identities', () => {
    expect(EnqueueGenerationJobResultSchema.parse({
      alreadyComplete: true,
      jobId: null,
      correlationId: null,
      status: 'SUCCEEDED',
    })).toMatchObject({ alreadyComplete: true })
    expect(() => EnqueueGenerationJobResultSchema.parse({
      alreadyComplete: true,
      jobId: '11111111-1111-4111-8111-111111111111',
      correlationId: null,
      status: 'SUCCEEDED',
    })).toThrow()
  })

  it('rejects internal fields from reader status', () => {
    expect(() => GenerationJobReaderStatusSchema.parse({
      status: 'RUNNING',
      jobId: '11111111-1111-4111-8111-111111111111',
      chapterNumber: 2,
      workerId: 'worker-a',
      claimToken: '22222222-2222-4222-8222-222222222222',
    })).toThrow()
  })

  it('requires full ownership for running internal claim', () => {
    expect(() => ClaimedGenerationJobSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      storyId: 'story-a',
      chapterNumber: 2,
      userId: '33333333-3333-4333-8333-333333333333',
      generationKind: 'standard',
      triggerChoiceId: null,
      attemptCount: 1,
      maxAttempts: 4,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      correlationId: '44444444-4444-4444-8444-444444444444',
      workerId: 'worker-a',
      claimToken: null,
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run focused test and prove red**

```powershell
pnpm exec vitest run tests/contracts/generation-job-contracts.test.ts
```

Expected: FAIL because modules/schemas do not exist.

- [ ] **Step 3: Implement reader-safe schemas**

Create `packages/contracts/src/generation-job.ts` with:

```ts
import { z } from 'zod'

export const GENERATION_JOB_STATUSES = ['QUEUED','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED'] as const
export const GENERATION_KINDS = ['standard','personalized'] as const
export const GenerationJobStatusSchema = z.enum(GENERATION_JOB_STATUSES)
export const GenerationKindSchema = z.enum(GENERATION_KINDS)
export const GenerationJobReaderErrorCodeSchema = z.enum([
  'GENERATION_JOB_CONFLICT',
  'GENERATION_DEADLINE_EXCEEDED',
  'GENERATION_RETRY_EXHAUSTED',
  'GENERATION_FAILED',
  'GENERATION_CANCELLED',
])

const ActiveEnqueueSchema = z.object({
  alreadyComplete: z.literal(false),
  jobId: z.string().uuid(),
  correlationId: z.string().uuid(),
  status: z.enum(['QUEUED','RUNNING','RETRY_WAIT']),
}).strict()
const CompleteEnqueueSchema = z.object({
  alreadyComplete: z.literal(true),
  jobId: z.null(),
  correlationId: z.null(),
  status: z.literal('SUCCEEDED'),
}).strict()
export const EnqueueGenerationJobResultSchema = z.discriminatedUnion('alreadyComplete', [
  ActiveEnqueueSchema,
  CompleteEnqueueSchema,
])

export const GenerationJobReaderStatusSchema = z.object({
  jobId: z.string().uuid(),
  chapterNumber: z.number().int().min(1).max(50),
  status: GenerationJobStatusSchema,
  errorCode: GenerationJobReaderErrorCodeSchema.nullable(),
}).strict()

export type GenerationJobStatus = z.infer<typeof GenerationJobStatusSchema>
export type GenerationKind = z.infer<typeof GenerationKindSchema>
export type EnqueueGenerationJobResult = z.infer<typeof EnqueueGenerationJobResultSchema>
export type GenerationJobReaderStatus = z.infer<typeof GenerationJobReaderStatusSchema>
```

Export it from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Implement internal schemas**

Create `lib/runtime/generation-jobs.contract.ts` with strict Zod schemas for:

- `ClaimedGenerationJobSchema`.
- `GenerationJobClaimResultSchema` (`claimed: false` or `claimed: true` + job).
- `GenerationJobLeaseResultSchema` (`ok` + lease ID, or `LEASE_HELD`/`OWNERSHIP_LOST`).
- `GenerationJobHeartbeatResultSchema`.
- `GenerationJobFinishOutcomeSchema`.
- `GenerationJobRecoveryResultSchema`.
- `FencedPublicationIdentitySchema`.

Use camelCase TypeScript fields and ISO offset timestamps. Keep `storyId`/`triggerChoiceId` as strings.

- [ ] **Step 5: Export runtime contracts and run green test**

Add to `lib/runtime/index.ts`:

```ts
export * from './generation-jobs.contract'
```

Run:

```powershell
pnpm exec vitest run tests/contracts/generation-job-contracts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit contracts**

```bash
git add packages/contracts/src/generation-job.ts packages/contracts/src/index.ts lib/runtime/generation-jobs.contract.ts lib/runtime/index.ts tests/contracts/generation-job-contracts.test.ts
git commit -m "feat: define generation job contracts"
```

---

### Task 3: Create queue schema, telemetry schema, and state machine

**Files:**
- Create: `supabase/tests/generation_jobs_schema_test.sql`
- Create: `supabase/migrations/20260718010000_generation_jobs_foundation.sql`

- [ ] **Step 1: Write failing schema/security tests**

Create pgTAP test with local marker and assertions for:

```sql
select has_table('public', 'generation_jobs');
select has_table('public', 'generation_job_attempts');
select has_column('public', 'generation_jobs', 'claim_token');
select has_column('public', 'generation_jobs', 'deadline_at');
select has_index('public', 'generation_jobs', 'generation_jobs_one_active_target_idx');
select has_index('public', 'generation_jobs', 'generation_jobs_claim_idx');
select has_index('public', 'generation_jobs', 'generation_jobs_stale_idx');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_jobs'::regclass));
select ok(not has_table_privilege('anon', 'public.generation_jobs', 'SELECT'));
select ok(not has_table_privilege('authenticated', 'public.generation_jobs', 'SELECT'));
select ok(has_table_privilege('service_role', 'public.generation_jobs', 'SELECT'));
```

Add behavior blocks proving:

- Legal normal flow `QUEUED -> RUNNING -> RETRY_WAIT -> RUNNING -> SUCCEEDED`.
- Legal watchdog deadline flow `QUEUED -> FAILED` and `RETRY_WAIT -> FAILED` only when `deadline_at <= clock_timestamp()` and `last_error_code = 'GENERATION_DEADLINE_EXCEEDED'` in same update.
- Premature direct `QUEUED -> FAILED`/`RETRY_WAIT -> FAILED` fails `INVALID_GENERATION_JOB_TRANSITION`.
- Illegal `QUEUED -> SUCCEEDED` fails `INVALID_GENERATION_JOB_TRANSITION`.
- Terminal mutation fails `GENERATION_JOB_TERMINAL`.
- Immutable story/user/chapter/deadline/correlation fields fail `IMMUTABLE_GENERATION_JOB_IDENTITY`.
- Deterministic publication key exists at insert and is immutable; publication result is null before success, written only during `RUNNING -> SUCCEEDED`, then immutable.
- `RUNNING` requires worker, claim token, timestamps.
- Non-running states clear ownership.
- Terminal states require `completed_at`.
- Attempt count never decreases and increments only when entering `RUNNING`.
- Attempts table has no `prompt`, `prose`, `response_body`, `token`, `secret`, or generic `metadata` columns.

- [ ] **Step 2: Run focused test and prove red**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_jobs_schema_test.sql
```

Expected: FAIL because tables do not exist.

- [ ] **Step 3: Implement migration**

Create tables using current identities:

```sql
create table public.generation_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  story_id text not null references public.stories(id) on delete cascade,
  chapter_number integer not null check (chapter_number between 1 and 50),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_kind text not null check (generation_kind in ('standard','personalized')),
  trigger_choice_id text,
  status text not null check (status in ('QUEUED','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 20),
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  deadline_at timestamptz not null,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  worker_id text,
  claim_token uuid,
  correlation_id uuid not null default pg_catalog.gen_random_uuid(),
  last_error_code text,
  last_error_class text,
  last_error_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  publication_idempotency_key text not null,
  publication_result jsonb,
  check (attempt_count <= max_attempts),
  check (deadline_at > created_at)
);
```

Create partial indexes:

```sql
create unique index generation_jobs_one_active_target_idx
on public.generation_jobs(story_id, chapter_number)
where status in ('QUEUED','RUNNING','RETRY_WAIT');

create index generation_jobs_claim_idx
on public.generation_jobs(available_at, created_at)
where status in ('QUEUED','RETRY_WAIT');

create index generation_jobs_stale_idx
on public.generation_jobs(heartbeat_at)
where status = 'RUNNING';
```

Create sanitized attempts table with exact fields required by later worker telemetry:

```sql
create table public.generation_job_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  correlation_id uuid not null,
  story_id text not null,
  chapter_number integer not null,
  attempt_number integer not null check (attempt_number >= 1),
  workflow_phase text not null,
  provider_id text,
  model_id text,
  started_at timestamptz not null,
  ended_at timestamptz,
  elapsed_ms bigint,
  lease_age_ms bigint,
  lease_remaining_ms bigint,
  retry_decision text,
  error_code text,
  worker_id text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(job_id, attempt_number, workflow_phase, started_at)
);
```

Add `unique(job_id, attempt_number, workflow_phase, started_at)`, bounds/checks for nonnegative timing values, and `ended_at >= started_at`. Add `generation_job_attempts_enforce_identity_v1()` trigger that loads parent job and rejects mismatched correlation/story/chapter or `attempt_number > parent.attempt_count`. No generic payload or metadata JSON. Create `generation_jobs_enforce_state_v1()` trigger with fixed `search_path = ''`; enforce normal transitions, terminal immutability, and narrowly allowed overdue `QUEUED/RETRY_WAIT -> FAILED` transition described by tests.

Enable RLS. Revoke all from PUBLIC/anon/authenticated. Grant required DML only to `service_role`.

- [ ] **Step 4: Run focused schema test**

```powershell
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/generation_jobs_schema_test.sql
```

Expected: PASS.

- [ ] **Step 5: Commit schema**

```bash
git add supabase/migrations/20260718010000_generation_jobs_foundation.sql supabase/tests/generation_jobs_schema_test.sql
git commit -m "feat: add durable generation job schema"
```

---

### Task 4: Add authenticated idempotent explicit enqueue

**Files:**
- Create: `supabase/tests/generation_job_enqueue_test.sql`
- Create: `supabase/migrations/20260718020000_generation_job_enqueue.sql`
- Create: `scripts/generation-job-enqueue-race.ts`

- [ ] **Step 1: Write failing pgTAP enqueue tests**

Test exact function:

```sql
public.enqueue_generation_job_v1(text,integer,text,text)
```

Parameters: story ID, chapter number, generation kind, nullable trigger choice ID. User comes only from `auth.uid()`.

Assertions:

- `SECURITY DEFINER`.
- `proconfig = array['search_path=""']`.
- Authenticated execute allowed; anon/PUBLIC denied.
- New request returns queued UUID IDs.
- Exact duplicate returns same IDs.
- Different kind/trigger/owner returns `GENERATION_JOB_CONFLICT`.
- Existing chapter returns `{alreadyComplete:true,jobId:null,correlationId:null,status:'SUCCEEDED'}`.
- Missing auth returns `AUTH_REQUIRED`.
- Other user's private story appears not found.
- Invalid chapter/kind/trigger bounds reject.
- No direct authenticated table grant exists.

- [ ] **Step 2: Run and prove red**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_job_enqueue_test.sql
```

Expected: FAIL missing RPC.

- [ ] **Step 3: Implement secure enqueue RPC**

Rules:

```sql
security definer
set search_path = ''
```

Inside RPC:

1. `v_user_id := auth.uid()`; reject null.
2. Validate bounded input.
3. Verify target story authorization and generation kind compatibility.
4. Story owner can enqueue private personalized or owned standard story; a standard reader must have own `reader_states` row and readable story.
5. Acquire same story advisory transaction lock as `publish_chapter_v2`: `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_story_id, 120712))`.
6. Under lock, recheck chapter existence and return completed fast path if present; then inspect active job. This closes enqueue/publication race.
7. Return compatible active row.
8. Reject incompatible active row with `GENERATION_JOB_CONFLICT`.
9. Insert `QUEUED`, `max_attempts=4`, `deadline_at=clock_timestamp()+interval '20 minutes'`, and deterministic `publication_idempotency_key = 'generation-job:' || job_id::text || ':publish:' || chapter_number::text`. Generate job UUID before insert so key exists from queue creation.
10. Return only reader-safe IDs/status.

- [ ] **Step 4: Run pgTAP green**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_job_enqueue_test.sql
```

Expected: PASS.

- [ ] **Step 5: Write multi-session duplicate enqueue race**

Reuse `scripts/authoring-race-session.ts`. Two authenticated `psql` sessions call exact same enqueue request behind advisory barrier. Assert:

```text
same jobId
same correlationId
one active DB row
```

- [ ] **Step 6: Run race test**

```powershell
node scripts/run-smoke.cjs scripts/generation-job-enqueue-race.ts
```

Expected: PASS and cleanup fixtures.

- [ ] **Step 7: Commit enqueue**

```bash
git add supabase/migrations/20260718020000_generation_job_enqueue.sql supabase/tests/generation_job_enqueue_test.sql scripts/generation-job-enqueue-race.ts
git commit -m "feat: add idempotent generation enqueue"
```

---

### Task 5: Add worker claim and claim-token fencing primitives

**Files:**
- Create: `supabase/tests/generation_job_worker_rpc_test.sql`
- Create: `supabase/migrations/20260718030000_generation_job_worker_rpcs.sql`
- Create: `scripts/generation-job-claim-race.ts`

- [ ] **Step 1: Write failing worker RPC tests**

Test exact service-role-only functions:

```sql
claim_generation_job_v1(text)
acquire_generation_job_lease_v1(uuid,text,uuid,integer)
heartbeat_generation_job_v1(uuid,text,uuid,uuid,integer)
finish_generation_job_attempt_v1(uuid,text,uuid,text,timestamptz,text,text,text,text,text,timestamptz,timestamptz,bigint,bigint,bigint,text)
cancel_generation_job_v1(uuid,text)
recover_stale_generation_jobs_v1(integer)
```

Cover:

- Available order by `available_at, created_at`.
- Overdue/unavailable rows not claimed.
- Claim increments attempt once and creates fresh token.
- Retry claim rotates token.
- Wrong worker/token loses ownership.
- Lease binds job ID + claim token.
- Heartbeat renews only matching lease.
- Retry/failure/cancel clears ownership and bound lease.
- Retry after max attempts/deadline becomes terminal.
- Functions inaccessible to anon/authenticated/PUBLIC.

- [ ] **Step 2: Prove tests red**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_job_worker_rpc_test.sql
```

Expected: FAIL missing worker RPCs/lease columns.

- [ ] **Step 3: Add additive lease fencing columns**

Migration adds nullable fields to preserve legacy callers:

```sql
alter table public.generation_leases
  add column if not exists job_id uuid references public.generation_jobs(id),
  add column if not exists claim_token uuid;

create index if not exists generation_leases_job_claim_idx
on public.generation_leases(job_id, claim_token)
where status = 'ACTIVE';
```

Do not alter legacy acquire/release signatures.

- [ ] **Step 4: Implement claim RPC with SKIP LOCKED**

Core query:

```sql
select j.id into v_job_id
from public.generation_jobs j
where j.status in ('QUEUED','RETRY_WAIT')
  and j.available_at <= pg_catalog.clock_timestamp()
  and j.deadline_at > pg_catalog.clock_timestamp()
  and j.attempt_count < j.max_attempts
order by j.available_at, j.created_at
for update skip locked
limit 1;
```

Transition to `RUNNING`, increment attempt, set worker/token/claimed/heartbeat. Return snake-case JSON matching internal adapter mapping.

- [ ] **Step 5: Implement bound lease, heartbeat, finish, and cancel**

All ownership mutations lock job row and require exact `(job_id, worker_id, claim_token, status='RUNNING')`.

`finish_generation_job_attempt_v1` receives and persists exact sanitized telemetry fields in this order after outcome/retry/error values: workflow phase, provider ID, model ID, started/ended timestamps, elapsed/lease-age/lease-remaining milliseconds, and retry decision. Function derives job/correlation/story/chapter/attempt/worker identity from locked parent row; callers cannot forge them. It inserts attempt row and changes job state in one transaction.

- Lease TTL input allowed `30..600`; production later uses 180.
- Heartbeat lease TTL allowed `30..600`.
- Finish outcomes only `RETRY_WAIT`, `FAILED`, `CANCELLED`.
- Retry requires `available_at`; rejects after deadline/max attempts.
- Cancel accepts only bounded operator reason.
- Lease update/release matches both `job_id` and old `claim_token`.

- [ ] **Step 6: Run focused pgTAP**

```powershell
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/generation_job_worker_rpc_test.sql
```

Expected: PASS.

- [ ] **Step 7: Write and run claim race**

Launch two service-role `psql` sessions simultaneously. Assert one job claimed once and contenders receive distinct jobs when two exist.

```powershell
node scripts/run-smoke.cjs scripts/generation-job-claim-race.ts
```

Expected: PASS.

- [ ] **Step 8: Commit worker primitives**

```bash
git add supabase/migrations/20260718030000_generation_job_worker_rpcs.sql supabase/tests/generation_job_worker_rpc_test.sql scripts/generation-job-claim-race.ts
git commit -m "feat: add generation job claim primitives"
```

---

### Task 6: Add stale and deadline recovery

**Files:**
- Create: `supabase/tests/generation_job_recovery_test.sql`
- Create: `scripts/generation-job-recovery-race.ts`
- Modify: `supabase/migrations/20260718030000_generation_job_worker_rpcs.sql`

- [ ] **Step 1: Write failing recovery tests**

Cover:

- Fresh heartbeat remains `RUNNING`.
- Stale threshold fixed at 75 seconds; batch input only controls `1..100` row count.
- Stale unpublished job becomes `RETRY_WAIT`, immediately available.
- Old worker/token cleared.
- Matching old lease becomes `EXPIRED`; unrelated lease untouched.
- Existing chapter becomes `SUCCEEDED` only with matching publication idempotency proof; unrelated chapter becomes `FAILED` with `GENERATION_PUBLICATION_CONFLICT`.
- Overdue queued/retry/running jobs become `FAILED` with `GENERATION_DEADLINE_EXCEEDED`; attempt-exhausted stale jobs become `FAILED` with `GENERATION_RETRY_EXHAUSTED` instead of stranded `RETRY_WAIT`.
- One sanitized `WORKER_ATTEMPT_INTERRUPTED` row inserted per recovered attempt.
- Recovery is idempotent.
- Rows remain present.

- [ ] **Step 2: Prove recovery red**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_job_recovery_test.sql
```

Expected: FAIL until recovery body is complete.

- [ ] **Step 3: Implement bounded recovery**

Use `FOR UPDATE SKIP LOCKED LIMIT p_batch_size`. Capture old claim token before clearing it. Resolve in order:

1. Existing chapter plus matching deterministic publication key in `idempotency_keys`: copy key/result and mark `SUCCEEDED`. Existing chapter without matching key/story/scope/result proof: mark `FAILED` with `GENERATION_PUBLICATION_CONFLICT`.
2. Absolute deadline or `attempt_count >= max_attempts`: `FAILED` with `GENERATION_DEADLINE_EXCEEDED` or `GENERATION_RETRY_EXHAUSTED` respectively.
3. Otherwise: `RETRY_WAIT`, `available_at=clock_timestamp()`.

Expire only lease matching old job ID/token. Insert synthetic attempt with no raw exception/payload.

- [ ] **Step 4: Run pgTAP green**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_job_recovery_test.sql
```

Expected: PASS.

- [ ] **Step 5: Write heartbeat/recovery race**

Use two sessions: one heartbeat, one recovery, same stale boundary. Assert exactly one legal result:

- Heartbeat wins and claim stays owned; or
- Recovery wins and old heartbeat returns ownership lost.

Never allow two owners or active lease with stale token.

- [ ] **Step 6: Run race and commit**

```powershell
node scripts/run-smoke.cjs scripts/generation-job-recovery-race.ts
git add supabase/migrations/20260718030000_generation_job_worker_rpcs.sql supabase/tests/generation_job_recovery_test.sql scripts/generation-job-recovery-race.ts
git commit -m "feat: recover stale generation jobs"
```

---

### Task 7: Add fenced publication and atomic job success

**Files:**
- Create: `supabase/tests/generation_job_fencing_test.sql`
- Create: `supabase/migrations/20260718040000_generation_job_fencing.sql`

- [ ] **Step 1: Write failing fenced publication tests**

Define wrappers:

```sql
publish_generation_job_chapter_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb)
publish_generation_job_chapter_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb)
```

Inputs start with job ID, worker ID, claim token, lease ID, then existing publisher payload without duplicate lease ID.

Test:

- Matching job/worker/token/lease publishes and job succeeds atomically.
- Wrong job/worker/token/lease rejects.
- Cancelled/recovered/deadline-expired job rejects.
- Exact replay of a previously successful wrapper call returns stored success before live-claim/lease validation.
- Existing chapter reconciles to `SUCCEEDED` only when job target matches and publication identity proves same logical work; unrelated pre-existing chapter returns `GENERATION_PUBLICATION_CONFLICT`.
- Late outbox failure rolls back chapter, job success, lease release, and success telemetry.
- Duplicate wrapper replay creates one chapter/event/outbox.
- Legacy publishers remain unchanged; existing V2 test still passes.

- [ ] **Step 2: Prove tests red**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_job_fencing_test.sql
```

Expected: FAIL missing wrappers.

- [ ] **Step 3: Implement fenced wrappers**

Each wrapper uses publication idempotency key as stable replay identity:

1. Lock job `FOR UPDATE` first.
2. Under lock, derive expected key from job ID/chapter and require stored key equals it. If job is already `SUCCEEDED` and stored publication result exists, return stored success before requiring live ownership/lease. Wrapper accepts no caller-selected publication key.
3. For nonterminal job, validate exact story/chapter/worker/token/status/deadline.
4. Lock lease `FOR UPDATE` and validate bound job/token/story/chapter/status/expiry.
5. Call existing `publish_chapter` or `publish_chapter_v2` in same SQL transaction.
6. Call legacy/V2 publisher using job's deterministic stored key. If publisher reports `CHAPTER_EXISTS`, accept only when existing idempotency record binds that key to same story, publisher scope, chapter, and successful result; otherwise return conflict.
7. Update job to `SUCCEEDED`, store publication result, set completed time, clear ownership.
8. Insert sanitized success attempt.
9. Return publisher-compatible result plus job ID.

Race test pauses first caller after locking job, starts second identical caller, then releases first. Expected: first commits; second wakes, re-reads `SUCCEEDED` under lock, and returns identical stored result.

All SQL functions use empty search path, schema-qualified calls, service-role-only execute.

- [ ] **Step 4: Run focused and compatibility gates**

```powershell
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/generation_job_fencing_test.sql
pnpm exec supabase test db --local supabase/tests/publish_chapter_v2_test.sql
pnpm run test:db:publish-v2-race
```

Expected: PASS.

- [ ] **Step 5: Commit fencing**

```bash
git add supabase/migrations/20260718040000_generation_job_fencing.sql supabase/tests/generation_job_fencing_test.sql
git commit -m "feat: fence generation job publication"
```

---

### Task 8: Add atomic personalized and standard choice enqueue

**Files:**
- Create: `supabase/tests/generation_choice_enqueue_test.sql`
- Create: `supabase/migrations/20260718050000_generation_choice_enqueue.sql`

- [ ] **Step 1: Write failing combined RPC tests**

New functions:

```sql
apply_personalized_choice_and_enqueue_generation_v1(text,integer,text,text,jsonb,jsonb,jsonb,jsonb)
apply_standard_choice_and_enqueue_generation_v1(text,integer,text,text)
```

Both derive user from `auth.uid()` and must be `SECURITY DEFINER`, `set search_path = ''`, executable only by `authenticated`, with PUBLIC/anon execution revoked. pgTAP asserts exact signatures, owner mode, `proconfig`, ACLs, and that direct table grants remain absent.

Personalized input removes caller-supplied `p_user_id` from existing signature and appends no separate job owner. Test:

- Choice application and job commit together.
- Enqueue conflict rolls choice back.
- Choice failure creates no job.
- Exact replay returns same choice and job.
- Ending choice returns no job.
- Existing next chapter returns completed fast path.
- Other user cannot mutate or learn IDs.
- Existing `apply_personalized_choice` remains callable and unchanged.

Standard test:

- Loads canonical chapter/outcome/decision in DB.
- Monotonically applies reader state and enqueues next chapter atomically.
- Guest rejected; owner/read-entitled authenticated user accepted.
- Ending choice creates no job.
- Duplicate tap is idempotent.

- [ ] **Step 2: Prove tests red**

```powershell
pnpm exec supabase test db --local supabase/tests/generation_choice_enqueue_test.sql
```

Expected: FAIL missing combined RPCs.

- [ ] **Step 3: Extract private enqueue helper**

Inside migration create a non-API helper such as:

```sql
public.enqueue_generation_job_internal_v1(uuid,text,integer,text,text)
```

It accepts already-authorized user ID, is callable only by definer-owned functions/service role, and returns same safe enqueue envelope. Revoke PUBLIC/anon/authenticated execute.

Combined RPCs and explicit enqueue call this helper so uniqueness/conflict semantics remain one implementation.

- [ ] **Step 4: Implement personalized combined RPC**

Copy current canonical calculations from `apply_personalized_choice`; do not call service-role-only existing RPC because user derivation and atomic enqueue must remain explicit. Preserve old RPC untouched for rolling compatibility.

- [ ] **Step 5: Implement standard combined RPC**

Move current standard state mutation semantics from `applyChoiceToUserState` into DB form:

- Lock own `reader_states` row.
- Reload canonical choice outcome and label.
- Merge `jejak` by chapter.
- Preserve monotonic chapter/status/ending semantics.
- Enqueue next chapter only for non-ending outcome.

Do not route production calls here yet.

- [ ] **Step 6: Run choice and regression gates**

```powershell
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm exec supabase test db --local supabase/tests/generation_choice_enqueue_test.sql
pnpm exec supabase test db --local supabase/tests/personalized_story_rls_test.sql
```

Expected: PASS.

- [ ] **Step 7: Commit combined RPCs**

```bash
git add supabase/migrations/20260718050000_generation_choice_enqueue.sql supabase/tests/generation_choice_enqueue_test.sql
git commit -m "feat: enqueue generation with reader choices"
```

---

### Task 9: Add thin TypeScript job RPC adapters

**Files:**
- Create: `lib/runtime/generation-jobs.ts`
- Create: `lib/api/generation-job-enqueue.server.ts`
- Create: `tests/runtime/generation-jobs.test.ts`
- Create: `tests/api/generation-job-enqueue.test.ts`
- Modify: `lib/runtime/index.ts`

- [ ] **Step 1: Write failing adapter tests**

Follow `tests/runtime/publish-chapter-v2.test.ts` mock pattern. Test exact payloads for service-role worker adapters:

```ts
claimGenerationJob
acquireGenerationJobLease
heartbeatGenerationJob
finishGenerationJobAttempt
cancelGenerationJob
recoverStaleGenerationJobs
publishGenerationJobChapterV1
publishGenerationJobChapterV2
```

Separately test authenticated enqueue in `tests/api/generation-job-enqueue.test.ts` by mocking cookie/Bearer Supabase client, not admin client. Adapter calls `enqueue_generation_job_v1` through user-scoped client so `auth.uid()` is populated. It never accepts caller-supplied user ID.

Also test:

- Malformed RPC result rejected by Zod.
- Known SQL token maps to typed `GenerationJobError`.
- Unknown DB error maps to `INTERNAL_ERROR` without exposing raw text in error code.
- Input object not mutated.

Example red test:

```ts
expect(rpc).toHaveBeenCalledWith('claim_generation_job_v1', {
  p_worker_id: 'worker-a',
})
```

- [ ] **Step 2: Run and prove red**

```powershell
pnpm exec vitest run tests/runtime/generation-jobs.test.ts
```

Expected: FAIL missing adapter module.

- [ ] **Step 3: Implement adapters**

Create `lib/runtime/generation-jobs.ts` for worker/service-role RPCs:

```ts
import 'server-only'
import { createAdminClient } from '@lakoku/db'
```

Create `lib/api/generation-job-enqueue.server.ts` for user-facing explicit enqueue:

```ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'
```

Cookie client carries authenticated user context into `auth.uid()`. Bearer-specific route plumbing stays Workstream 4; do not fall back to service-role caller identity.

Use input Zod validation, exact `p_snake_case` mapping, output Zod parsing, and stable error allowlist:

```ts
export type GenerationJobErrorCode =
  | 'AUTH_REQUIRED'
  | 'STORY_NOT_FOUND'
  | 'GENERATION_JOB_CONFLICT'
  | 'GENERATION_JOB_OWNERSHIP_LOST'
  | 'LEASE_HELD'
  | 'GENERATION_DEADLINE_EXCEEDED'
  | 'GENERATION_RETRY_EXHAUSTED'
  | 'GENERATION_PUBLICATION_CONFLICT'
  | 'INVALID_GENERATION_JOB_TRANSITION'
  | 'INTERNAL_ERROR'
```

Never return raw DB message as public code.

- [ ] **Step 4: Export adapters and run focused tests**

Add:

```ts
export * from './generation-jobs'
```

Run:

```powershell
pnpm exec vitest run tests/contracts/generation-job-contracts.test.ts tests/runtime/generation-jobs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit adapters**

```bash
git add lib/runtime/generation-jobs.ts lib/api/generation-job-enqueue.server.ts lib/runtime/index.ts tests/runtime/generation-jobs.test.ts tests/api/generation-job-enqueue.test.ts
git commit -m "feat: add generation job rpc adapters"
```

---

### Task 10: Add aggregate foundation gate and clear baseline typecheck blockers

**Files:**
- Modify: `package.json`
- Modify: `app/api/stories/authoring/lock/route.ts:22-27`
- Modify: `components/brainstorm/brainstorm-wizard.tsx:23-30,232-235`
- Modify: `lib/api/client.ts:22-37`
- Modify: `lib/api/user-state.ts:60-104`
- Test: existing TypeScript suite

Current `pnpm typecheck` fails before Workstream 1. These four known errors must be fixed as prerequisite quality-gate work, with no behavior change.

- [ ] **Step 1: Capture failing baseline**

```powershell
pnpm typecheck
```

Expected diagnostics:

```text
app/api/stories/authoring/lock/route.ts TS2339
components/brainstorm/brainstorm-wizard.tsx TS2345
lib/api/user-state.ts TS2577
lib/api/user-state.ts TS7023
```

- [ ] **Step 2: Fix authoring union narrowing**

In route, narrow explicit error branch:

```ts
if ('needsAuthor' in result && result.needsAuthor) {
  return NextResponse.json(result, { status: 422 })
}
if ('error' in result) {
  const status = result.error === AUTHORING_AUTH_REQUIRED_ERROR ? 401 : 400
  return NextResponse.json(result, { status })
}
```

- [ ] **Step 3: Type `Finding[]` in browser lock contract**

Import `Finding` type in `lib/api/client.ts` and replace `findings: unknown[]` with `findings: Finding[]`. No runtime payload change.

- [ ] **Step 4: Break circular session-user return inference**

Import Supabase `User` type. Define:

```ts
type SessionUser = User | null
```

Give both functions explicit returns:

```ts
async function getUserFromBearerAuthorization(): Promise<SessionUser>
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser>
```

- [ ] **Step 5: Run typecheck green**

```powershell
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 6: Add aggregate DB script**

Add scripts:

```json
"test:db:generation-jobs": "pnpm exec supabase test db --local supabase/tests/runtime_lifecycle_baseline_test.sql supabase/tests/generation_jobs_schema_test.sql supabase/tests/generation_job_enqueue_test.sql supabase/tests/generation_job_worker_rpc_test.sql supabase/tests/generation_job_recovery_test.sql supabase/tests/generation_job_fencing_test.sql supabase/tests/generation_choice_enqueue_test.sql && node scripts/run-smoke.cjs scripts/generation-job-enqueue-race.ts && node scripts/run-smoke.cjs scripts/generation-job-claim-race.ts && node scripts/run-smoke.cjs scripts/generation-job-recovery-race.ts"
```

- [ ] **Step 7: Run complete foundation verification**

```powershell
pnpm lint
pnpm typecheck
pnpm exec vitest run
pnpm exec supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm run test:db:generation-jobs
pnpm run test:db:personalized
$env:LAKOKU_DEPLOY = 'vps'
pnpm build
Remove-Item Env:LAKOKU_DEPLOY
```

Expected: every command exits 0. No TestSprite or production generation run in Workstream 1.

- [ ] **Step 8: Verify untouched cutover files**

Run:

```bash
git diff --exit-code HEAD -- app/api/stories/[id]/choices/route.ts lib/api/generation-continuation.server.ts lib/api/chapter-status.server.ts lib/api/start-chapter.server.ts lib/runtime/story-generation.ts lib/runtime/personalized-generation.ts docker-compose.yml
```

Expected: no Workstream 1 diff in cutover/deployment files.

- [ ] **Step 9: Commit gates and prerequisite fixes**

```bash
git add package.json app/api/stories/authoring/lock/route.ts components/brainstorm/brainstorm-wizard.tsx lib/api/client.ts lib/api/user-state.ts
git commit -m "chore: enforce generation foundation gates"
```

---

## Workstream 1 acceptance checklist

- [ ] Clean local DB reset reconstructs legacy lifecycle objects.
- [ ] Queue and attempts schemas pass pgTAP.
- [ ] Illegal direct state mutations fail.
- [ ] Duplicate enqueue race creates one job.
- [ ] Claim race never double-claims.
- [ ] Heartbeat and recovery race leaves one owner.
- [ ] Old claim token cannot publish after cancel/recovery.
- [ ] Publication and job success commit atomically.
- [ ] Choice mutation and enqueue commit atomically.
- [ ] Public schemas reject internal worker fields.
- [ ] Existing legacy/V2 publishers remain compatible.
- [ ] Existing production routes still use old path; no partial cutover.
- [ ] Lint, typecheck, Vitest, all DB tests, race tests, and VPS-mode build pass.
- [ ] No linked schema dump, credentials, prompts, prose, or provider body enters git.
