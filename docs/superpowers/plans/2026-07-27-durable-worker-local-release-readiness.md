# Durable Worker Local Release-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make durable generation worker implementation locally release-ready while keeping production worker OFF and performing no commit, push, linked migration, production secret change, scheduler activation, or deployment.

**Architecture:** Work proceeds through hard gates: repository safety, existing baseline repair, local DB contracts, fenced checkpoint adapters, personalized/cancellation parity, route/recovery cutover, then full verification. Worker-mode checkpoint mutations use two service-role-only transactional RPCs; legacy worker-off mode retains direct checkpoint writes. Standard and personalized generation share checkpoint lifecycle and cancellation semantics without merging both generators.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Supabase/PostgreSQL, PL/pgSQL, pgTAP, Zod, ESLint, pnpm.

**Authoritative design:** `docs/superpowers/specs/2026-07-26-durable-worker-release-readiness-design.md`

**Hard constraints:**

- Keep `LAKOKU_GENERATION_WORKER` OFF.
- Never run `supabase db push --linked`.
- Do not commit, push, deploy, install/enable scheduler, or change production secrets.
- Never read or print `.env.local.bak`.
- Stop before worker feature changes if full baseline unit or official lint remains red.
- If local Docker/Supabase is unavailable, source work may finish, but final status is `implementation complete, DB verification blocked`, never `local release-ready`.

---

## File map

### Repository and baseline

- Modify `.gitignore` — local artifact exclusions.
- Modify `eslint.config.mjs` — exclude nested `.worktrees/**` from official lint.
- Modify `tests/api/owned-queries.test.ts` — assert V1-on-disk to V2-on-read behavior.
- Modify `tests/api/personalized-stories.test.ts` — derive idempotency hashes from current profile version.

### Database fencing

- Create `supabase/migrations/20260724121000_generation_checkpoint_fencing.sql` — two atomic checkpoint mutation RPCs.
- Modify `supabase/tests/claim_generation_job_by_id_test.sql` — explicit client-role ACL assertions.
- Modify `supabase/tests/checkpoint_versioning_test.sql` — retain nullable legacy provenance and schema marker proofs.
- Create `supabase/tests/generation_checkpoint_fencing_test.sql` — RPC signatures, ACL, result codes, transitions, and rollback.
- Create `scripts/generation-checkpoint-fencing-race.ts` — ownership race and lock-order proof.
- Modify `package.json` — include all new DB verification files/scripts.

### Runtime checkpoint and cancellation

- Modify `lib/runtime/chapter-generation-checkpoint.pure.ts` — strict worker provenance and deterministic absent-direction fingerprint.
- Modify `lib/runtime/chapter-generation-checkpoint.ts` — dispatch legacy direct mutations versus worker fenced RPCs.
- Modify `lib/runtime/generation-jobs.ts` — Zod-validated fenced checkpoint RPC adapters.
- Modify `lib/runtime/story-generation.ts` — use fenced checkpoint identity and fail closed in worker mode.
- Modify `lib/runtime/personalized-generation.ts` — checkpoint parity and complete worker signal propagation.
- Create `lib/runtime/abort.ts` — shared abort guard and cancellable sleep.
- Modify `lib/runtime/choice-generation.ts` — abort-aware retries/repairs/backoff.
- Modify `lib/runtime/choice-concurrency.ts` — remove aborted waiters and cancel jitter.
- Modify `lib/runtime/generation-concurrency.ts` — remove aborted generation waiters.
- Modify `lib/ai-gateway/generate.ts` — abort checks before prose initial and repairs.
- Modify `lib/ai-gateway/gateway-provider.ts` — abort checks before every candidate/request and no fallback after abort.

### Routes and operations

- Modify `app/api/stories/[id]/generate/route.ts` — real mode uses shared kickoff; fake remains synchronous.
- Modify `tests/authoring/generation-route-authorization.test.ts` — new async status contract.
- Create `tests/api/generation-recover.test.ts` — recovery authentication, worker-off no-op, limits, and errors.
- Modify `app/api/generation/recover/route.ts` only if tests expose missing synchronous `after()` failure handling.
- Modify `docs/GENERATION_WORKER_OPS.md` — three-migration, timer-off, canary, soak, and rollback sequence.

---

### Task 1: Make working tree safe and repair existing release gates

**Files:**
- Modify: `.gitignore`
- Modify: `eslint.config.mjs:12-21`
- Modify: `tests/api/owned-queries.test.ts:332-350`
- Modify: `tests/api/personalized-stories.test.ts:57-65` and affected replay/conflict fixtures

- [ ] **Step 1: Record tree identity without changing files**

Run:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
git diff --cached --stat
```

Expected: branch/HEAD recorded; dirty tree retained. Do not stage anything.

- [ ] **Step 2: Verify `nul` is an accidental filesystem artifact, then remove only that entry**

Use filesystem metadata/name inspection only. Do not open `.env.local.bak`. If `nul` is not an ordinary accidental empty/artifact entry, stop and report contradiction instead of deleting it.

After confirmed artifact removal, run:

```bash
git status --short
```

Expected: `?? nul` absent; source changes unchanged.

- [ ] **Step 3: Add exact artifact ignores**

Append to `.gitignore`:

```gitignore
.env.local.bak
.aionrs/
.zcode/plans/
```

Verify without reading secret content:

```bash
git check-ignore -v -- .env.local.bak .aionrs/ .zcode/plans/
git ls-files -- .env.local.bak .aionrs .zcode/plans
git diff --cached --name-only
```

Expected: each artifact resolves to an ignore rule; none appears in tracked or staged output. Any tracked/staged secret backup is a blocker.

- [ ] **Step 4: Update failing owned-query expectation to V2-on-read**

In `tests/api/owned-queries.test.ts`, keep stored V1 fixture and exact `.select('taste_json')` checks, but assert returned profile uses normalized V2 contract:

```ts
expect(result).toMatchObject({
  version: 2,
})
expect(fixture.calls).toContainEqual(['select', 'taste_json'])
expect(fixture.calls).not.toContainEqual(['select', '*'])
```

Use existing V2 fixture fields from `lib/taste-profile/schema.ts`; do not reduce assertion to version only if test already compares full normalized object.

- [ ] **Step 5: Run owned-query test and confirm repair**

Run:

```bash
pnpm exec vitest run tests/api/owned-queries.test.ts
```

Expected: test file passes; no runtime production code change.

- [ ] **Step 6: Make personalized idempotency fixtures use runtime profile version**

In `tests/api/personalized-stories.test.ts`, replace stale canonical reservation hashes such as:

```ts
requestHashFor(1)
```

with:

```ts
requestHashFor(tasteProfile.version)
```

Retain a deliberately different version only in conflict tests:

```ts
const sameHash = requestHashFor(tasteProfile.version)
const differentHash = requestHashFor(tasteProfile.version + 1)
expect(differentHash).not.toBe(sameHash)
```

Ensure replay fixtures reserve `sameHash`; conflict fixtures reserve `differentHash`.

- [ ] **Step 7: Run personalized API tests**

Run:

```bash
pnpm exec vitest run tests/api/personalized-stories.test.ts
```

Expected: all four previously failing personalized tests pass; replay still returns same story; conflict still throws/maps `IDEMPOTENCY_CONFLICT`.

- [ ] **Step 8: Exclude only nested worktrees from ESLint**

Add to global ignores in `eslint.config.mjs`:

```js
'.worktrees/**',
```

Do not ignore `app/**`, `lib/**`, `tests/**`, `scripts/**`, or generated source broadly.

- [ ] **Step 9: Run baseline hard gate**

Run:

```bash
pnpm test:unit
pnpm lint
```

Expected: both exit `0`. If either fails, fix only observed baseline failures and rerun. Do not begin Task 2 while gate remains red.

---

### Task 2: Add transactional checkpoint-fencing RPCs and DB proofs

**Files:**
- Create: `supabase/migrations/20260724121000_generation_checkpoint_fencing.sql`
- Create: `supabase/tests/generation_checkpoint_fencing_test.sql`
- Create: `scripts/generation-checkpoint-fencing-race.ts`
- Modify: `supabase/tests/claim_generation_job_by_id_test.sql:16-41`
- Modify: `supabase/tests/checkpoint_versioning_test.sql:16-66`
- Modify: `package.json:17-22`

- [ ] **Step 1: Write pgTAP contract tests before migration**

Create `supabase/tests/generation_checkpoint_fencing_test.sql` with transaction wrapper, local marker guard, and planned assertions:

```sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'checkpoint fencing tests require local-cli';
  end if;
end
$$;

select no_plan();

select has_function(
  'public', 'upsert_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','bigint','bigint','text','text','integer','integer','integer'],
  'fenced checkpoint upsert has exact signature'
);
select function_returns(
  'public', 'upsert_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','bigint','bigint','text','text','integer','integer','integer'],
  'jsonb',
  'fenced checkpoint upsert returns jsonb'
);
select has_function(
  'public', 'transition_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','uuid','text'],
  'fenced checkpoint transition has exact signature'
);
select function_returns(
  'public', 'transition_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','uuid','text'],
  'jsonb',
  'fenced checkpoint transition returns jsonb'
);
```

Continue file with existing generation-job/user/story fixture patterns from `generation_job_fencing_test.sql`. Add named cases for every bounded result: `UPDATED`, `OWNERSHIP_LOST`, `LEASE_INVALID`, `ATTEMPT_AHEAD`, `PROVENANCE_CONFLICT`, `INVALID_TRANSITION`. Mandatory RPC-level cases:

```sql
-- Expire exact lease, call upsert, expect LEASE_INVALID and no checkpoint mutation.
-- Call upsert twice in same current attempt, expect UPDATED and one checkpoint row.
-- Create checkpoint with job_attempt_number = 1, reclaim same job to attempt_count = 2,
-- transition it with current owner, expect UPDATED because 1 <= 2.
-- Set checkpoint job_attempt_number = 3 while current attempt_count = 2,
-- expect ATTEMPT_AHEAD and unchanged row.
```

Also prove same-status replay, one-time `RUNNING_CHOICES` increment, one-hour terminal expiry, successful post-publish `PUBLISHED`, and rollback after a late invalid transition. `no_plan()` removes guessed counts, but every named assertion remains mandatory. End with:

```sql
select * from finish();
rollback;
```

- [ ] **Step 2: Make claim-by-ID ACL proof explicit**

Replace combined ACL assertion in `supabase/tests/claim_generation_job_by_id_test.sql` with four named assertions and update `plan(...)` count accordingly:

```sql
select ok(not has_function_privilege('PUBLIC', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'PUBLIC cannot execute claim-by-id');
select ok(not has_function_privilege('anon', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'anon cannot execute claim-by-id');
select ok(not has_function_privilege('authenticated', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'authenticated cannot execute claim-by-id');
select ok(has_function_privilege('service_role', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'service_role can execute claim-by-id');
```

- [ ] **Step 3: Complete checkpoint-versioning pgTAP proof**

Modify `supabase/tests/checkpoint_versioning_test.sql`. Keep new-row default/version checks, then add explicit nullability assertions for every legacy-compatible provenance column:

```sql
select col_is_null('public', 'chapter_generation_checkpoints', 'generation_mode', 'generation_mode remains nullable for legacy rows');
select col_is_null('public', 'chapter_generation_checkpoints', 'generation_policy_version', 'generation_policy_version remains nullable for legacy rows');
select col_is_null('public', 'chapter_generation_checkpoints', 'prompt_contract_version', 'prompt_contract_version remains nullable for legacy rows');
select col_is_null('public', 'chapter_generation_checkpoints', 'job_id', 'job_id remains nullable for legacy rows');
select col_is_null('public', 'chapter_generation_checkpoints', 'job_attempt_number', 'job_attempt_number remains nullable for legacy rows');
```

Prove backfill algorithm inside the test transaction rather than inserting an already-versioned row. Temporarily reproduce pre-migration marker state, insert a legacy row with null marker, replay the migration's backfill/default/not-null sequence, then assert version `1`:

```sql
alter table public.chapter_generation_checkpoints
  alter column checkpoint_schema_version drop not null,
  alter column checkpoint_schema_version drop default;

insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint, expires_at,
  checkpoint_schema_version
) values (
  'test:checkpoint-version', 2, gen_random_uuid(), gen_random_uuid(),
  'PROSE_READY', 'Legacy', '["p"]'::jsonb, 'legacy-fp',
  clock_timestamp() + interval '1 hour', null
);

update public.chapter_generation_checkpoints
set checkpoint_schema_version = 1
where checkpoint_schema_version is null;

alter table public.chapter_generation_checkpoints
  alter column checkpoint_schema_version set default 2,
  alter column checkpoint_schema_version set not null;

select is(
  (select checkpoint_schema_version from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-version' and chapter_number = 2),
  1,
  'migration backfills an existing null marker to schema version 1'
);
```

Transaction rollback restores schema/data after test. Use `select no_plan();` or update fixed `plan(...)` to exact assertion count; do not leave count stale.

- [ ] **Step 4: Run migration uniqueness check before creating migration**

Run:

```bash
pnpm run check:migration-versions
```

Expected: exit `0`; `20260724121000` unused.

- [ ] **Step 5: Implement `upsert_generation_checkpoint_fenced_v1`**

Create `supabase/migrations/20260724121000_generation_checkpoint_fencing.sql`. Use exact signature from spec. Function structure:

```sql
create or replace function public.upsert_generation_checkpoint_fenced_v1(
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
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok', false, 'result', 'OWNERSHIP_LOST');
  end if;
  if v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number then
    return jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  select * into v_lease from public.generation_leases where id = p_lease_id for update;
  if not found or v_lease.job_id is distinct from p_job_id
    or v_lease.claim_token is distinct from p_claim_token
    or v_lease.story_id is distinct from p_story_id
    or v_lease.chapter_number is distinct from p_chapter_number
    or v_lease.holder is distinct from p_worker_id
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'result', 'LEASE_INVALID');
  end if;
```

Then validate non-null schema-v2 provenance, generation kind/mode, prose payload bounds, and reject an existing `PUBLISHED` or differently-provenanced row. Upsert derives protected fields:

```sql
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, canon_version, blueprint_version,
    direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at
  ) values (
    v_job.story_id, v_job.chapter_number, v_job.id, v_job.correlation_id,
    'PROSE_READY', p_title, p_paragraphs, p_prose_fingerprint,
    p_canon_version, p_blueprint_version, p_direction_fingerprint,
    p_generation_mode, p_generation_policy_version, p_prompt_contract_version,
    v_job.id, v_job.attempt_count, 2, p_prose_attempt_count, 0,
    clock_timestamp() + interval '24 hours'
  )
  on conflict (story_id, chapter_number, attempt_id) do update
  set status = 'PROSE_READY', title = excluded.title,
      paragraphs_json = excluded.paragraphs_json,
      prose_fingerprint = excluded.prose_fingerprint,
      canon_version = excluded.canon_version,
      blueprint_version = excluded.blueprint_version,
      direction_fingerprint = excluded.direction_fingerprint,
      generation_mode = excluded.generation_mode,
      generation_policy_version = excluded.generation_policy_version,
      prompt_contract_version = excluded.prompt_contract_version,
      job_id = excluded.job_id,
      job_attempt_number = excluded.job_attempt_number,
      checkpoint_schema_version = 2,
      prose_attempt_count = excluded.prose_attempt_count,
      choice_attempt_count = 0,
      updated_at = clock_timestamp(),
      expires_at = excluded.expires_at
  returning * into v_checkpoint;

  return jsonb_build_object('ok', true, 'result', 'UPDATED', 'changed', true, 'checkpoint', to_jsonb(v_checkpoint));
end;
$$;
```

Keep all rejection branches before mutation. Use `pg_catalog` qualification where surrounding security-definer migrations do.

- [ ] **Step 6: Implement `transition_generation_checkpoint_fenced_v1`**

Use exact spec signature. Lock job, then lease, then checkpoint. For live transitions require `RUNNING` plus exact active lease. For `PUBLISHED`, require same job `SUCCEEDED`, successful `publication_result` containing same `jobId`, target chapter existence, and exact released lease tuple.

Attempt rule must be literal:

```sql
if v_checkpoint.job_id is distinct from v_job.id then
  return jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
end if;
if v_checkpoint.job_attempt_number > v_job.attempt_count then
  return jsonb_build_object('ok', false, 'result', 'ATTEMPT_AHEAD');
end if;
```

Implement status graph with explicit current/target pairs. Same-status returns:

```sql
return jsonb_build_object(
  'ok', true,
  'result', 'UPDATED',
  'changed', false,
  'checkpoint', to_jsonb(v_checkpoint)
);
```

On changed transition, increment choice count only when entering `RUNNING_CHOICES`; set terminal expiry only on first `PUBLISHED`/`EXPIRED` transition.

- [ ] **Step 7: Lock down RPC permissions**

Append exact identity revokes/grants for both functions:

```sql
revoke all on function public.upsert_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,bigint,bigint,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.upsert_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,bigint,bigint,text,text,integer,integer,integer) to service_role;

revoke all on function public.transition_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.transition_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,uuid,text) to service_role;
```

- [ ] **Step 8: Add local race script**

Create `scripts/generation-checkpoint-fencing-race.ts` using existing local-target guards from `scripts/generation-job-fencing-race.ts`. Prove two separate cases:

1. **Committed ownership change rejects stale caller.** Let recovery/reclaim commit first. Then call checkpoint upsert and transition with old `workerId`/`claimToken`/`leaseId`. Assert `OWNERSHIP_LOST` and unchanged checkpoint row.
2. **Job-before-lease lock order completes without deadlock.** Pause a competing transaction before the fenced RPC acquires the job lock, then release operations in controlled order. Do not expect ownership to change while any transaction holds the job row lock. Assert both sessions complete and final checkpoint provenance belongs to committed current owner/attempt.

Core assertions:

```ts
assert.equal(staleMutation.result, 'OWNERSHIP_LOST')
assert.deepEqual(checkpointAfterStaleCall, checkpointBeforeStaleCall)
assert.equal(freshMutation.result, 'UPDATED')
assert.equal(checkpoint.job_attempt_number, currentJob.attempt_count)
```

Add equivalent stale transition rejection and verify no partial status/counter update. Script must call local-target guard before opening sessions.

- [ ] **Step 9: Wire DB scripts**

Add focused script to `package.json` and extend `test:db:generation-jobs`:

```json
"test:db:generation-checkpoints": "node scripts/run-smoke.cjs scripts/runtime-baseline-sentinel.ts && pnpm exec supabase test db --local supabase/tests/claim_generation_job_by_id_test.sql supabase/tests/checkpoint_versioning_test.sql supabase/tests/generation_checkpoint_fencing_test.sql && node scripts/run-smoke.cjs scripts/generation-checkpoint-fencing-race.ts"
```

- [ ] **Step 10: Run local DB red/green gate**

Run:

```bash
supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
pnpm run test:db:generation-checkpoints
pnpm run test:db:generation-jobs
```

Expected: reset succeeds; marker prints `Local DB test marker: PASS`; all pgTAP and race checks pass. If Docker/Supabase is unavailable, record blocker and continue source tasks without claiming local release-ready. Never use linked DB as substitute.

---

### Task 3: Add typed fenced checkpoint adapters and standard-flow integration

**Files:**
- Modify: `lib/runtime/generation-jobs.ts`
- Modify: `lib/runtime/chapter-generation-checkpoint.pure.ts`
- Modify: `lib/runtime/chapter-generation-checkpoint.ts`
- Modify: `lib/runtime/story-generation.ts`
- Modify: `tests/runtime/checkpoint-freshness.test.ts`
- Create: `tests/runtime/checkpoint-persistence.test.ts`

- [ ] **Step 1: Write failing adapter and provenance tests**

Add tests for:

```ts
expect(verifyCheckpointFreshness(checkpointAttempt1, currentAttempt2)).toEqual({ fresh: true })
expect(verifyCheckpointFreshness(checkpointAttempt3, currentAttempt2)).toEqual({ fresh: false, reason: 'ATTEMPT_AHEAD' })
expect(NO_CREATIVE_DIRECTION_FINGERPRINT).toMatch(/^[a-f0-9]{32}$/)
```

In `checkpoint-persistence.test.ts`, mock admin `.rpc` and assert worker persistence sends all four current ownership values and maps each bounded result without swallowing it.

Run:

```bash
pnpm exec vitest run tests/runtime/checkpoint-freshness.test.ts tests/runtime/checkpoint-persistence.test.ts
```

Expected: new adapter tests fail because exports/adapters do not exist.

- [ ] **Step 2: Add bounded TypeScript result schema**

In `lib/runtime/generation-jobs.ts`, add:

```ts
const FencedCheckpointResultSchema = z.object({
  ok: z.boolean(),
  result: z.enum([
    'UPDATED',
    'OWNERSHIP_LOST',
    'LEASE_INVALID',
    'ATTEMPT_AHEAD',
    'PROVENANCE_CONFLICT',
    'INVALID_TRANSITION',
  ]),
  changed: z.boolean().optional(),
  checkpoint: z.record(z.string(), z.unknown()).optional(),
})

export type FencedCheckpointMutationResult = z.infer<typeof FencedCheckpointResultSchema>
```

Add `upsertGenerationCheckpointFenced` and `transitionGenerationCheckpointFenced`. Each calls exact RPC name, validates response with Zod, and returns typed bounded outcome. Do not translate ownership/lease loss into generic provider errors.

- [ ] **Step 3: Add deterministic absence fingerprint and strict worker helper**

In `chapter-generation-checkpoint.pure.ts`:

```ts
export const NO_CREATIVE_DIRECTION_FINGERPRINT = createHash('sha256')
  .update('lakoku:creative-direction:absent:v1')
  .digest('hex')
  .slice(0, 32)
```

Retain legacy nullable compatibility. For worker schema-v2 contexts, require same non-null job ID and formula:

```ts
cp.jobId === ctx.jobId
cp.jobAttemptNumber <= ctx.jobAttemptNumber
```

Return `JOB_ID_MISMATCH` or `ATTEMPT_AHEAD` distinctly.

- [ ] **Step 4: Dispatch checkpoint mutation by execution identity**

Extend `persistProseReadyCheckpoint` and `markCheckpointStatus` with:

```ts
jobContext?: GenerationJobExecutionContext | null
```

Behavior:

```ts
if (args.jobContext) {
  return upsertGenerationCheckpointFenced({
    jobId: args.jobContext.jobId,
    workerId: args.jobContext.workerId,
    claimToken: args.jobContext.claimToken,
    leaseId: args.jobContext.leaseId,
    // target and prose/freshness payload
  })
}
// existing legacy direct table mutation
```

Worker status transition uses fenced RPC and returns its result. Legacy direct update remains best-effort. Worker outcomes must never be swallowed.

- [ ] **Step 5: Pass current worker identity from standard generator**

In `story-generation.ts`, use `NO_CREATIVE_DIRECTION_FINGERPRINT` when direction is absent. Pass `jobContext` into every persist/status call. Worker-mode checkpoint failure before choices returns a failed attempt; legacy mode may retain current table-unavailable fallback.

Before choice call, transition to `RUNNING_CHOICES`; on choice failure transition to `CHOICES_RETRY_WAIT`; after successful fenced publish transition to `PUBLISHED` using released-lease proof.

- [ ] **Step 6: Run focused standard checkpoint suite**

Run:

```bash
pnpm exec vitest run tests/runtime/checkpoint-freshness.test.ts tests/runtime/checkpoint-persistence.test.ts tests/runtime/choice-only-resume.test.ts tests/runtime/checkpoint-freshness.test.ts
```

Expected: all pass; earlier same-job attempt reuse remains green; worker mutation failures remain explicit.

---

### Task 4: Add full cancellation propagation

**Files:**
- Create: `lib/runtime/abort.ts`
- Modify: `lib/ai-gateway/generate.ts`
- Modify: `lib/ai-gateway/gateway-provider.ts`
- Modify: `lib/runtime/choice-generation.ts`
- Modify: `lib/runtime/choice-concurrency.ts`
- Modify: `lib/runtime/generation-concurrency.ts`
- Modify: `lib/runtime/story-generation.ts`
- Modify: `lib/runtime/personalized-generation.ts`
- Modify tests under `tests/ai-gateway/` and `tests/runtime/`

- [ ] **Step 1: Add failing abort traversal tests**

Use deferred provider promises and `AbortController`. Assert:

```ts
controller.abort()
providerDeferred.resolve(validResult)
await expect(run).rejects.toMatchObject({ name: 'AbortError' })
expect(nextFallback).not.toHaveBeenCalled()
expect(repairProvider).not.toHaveBeenCalled()
expect(persistCheckpoint).not.toHaveBeenCalled()
expect(publish).not.toHaveBeenCalled()
```

Cover prose initial/leak repair/Layer A/Layer B, choice initial/structural/quality/transient repair, fallback candidate, native structured request, queue wait, and retry backoff. Current native response parsing is local; assert no new provider request is added for parse fallback.

- [ ] **Step 2: Create abort helpers**

Create `lib/runtime/abort.ts`:

```ts
export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
```

- [ ] **Step 3: Stop prose traversal after abort**

In `generate.ts`, call `throwIfAborted(options.signal)` before initial write and each Layer A/B repair. In `gateway-provider.ts`, check before each candidate and leak repair. Catch behavior:

```ts
if (options.signal?.aborted || isAbortError(error)) throw error
```

Only non-abort failures may continue to next candidate.

- [ ] **Step 4: Stop choice traversal, repair, and backoff after abort**

In `choice-generation.ts`, check signal at loop start and before every provider/repair call. Replace timer backoff with:

```ts
await abortableSleep(backoffMs, input.signal)
```

In `gateway-provider.ts`, check signal before every choice candidate/native request; do not continue fallback on abort. Preserve shared five-call provider budget and single native-response parse.

- [ ] **Step 5: Make concurrency queues abort-aware**

Add optional `signal` to generation and choice slot acquisition. On queued abort: remove waiter, clear timeout/listener, never promote it. During choice jitter: use `abortableSleep`; release reserved slot if abort occurs. Pass `jobContext?.signal` from standard and personalized flows.

- [ ] **Step 6: Pass signal into personalized prose**

Add to personalized prose execution options:

```ts
signal: jobContext?.signal,
```

Repairs inherit same options through `generateChapter`.

- [ ] **Step 7: Prove ignored abort cannot mutate state**

Add provider double that ignores signal and resolves valid output after ownership loss. Mock fenced adapters to return `OWNERSHIP_LOST` and assert generator stops before subsequent checkpoint mutation/publish. Add equivalent DB-backed race proof through Task 2 script.

- [ ] **Step 8: Run cancellation suites**

Run:

```bash
pnpm exec vitest run tests/ai-gateway/gateway-provider-observability.test.ts tests/runtime/choice-generation-baseline.test.ts tests/runtime/choice-concurrency.test.ts tests/runtime/generation-worker.test.ts tests/runtime/personalized-generation.test.ts
```

Expected: all abort paths pass; no fallback/repair/provider call after abort; provider budget tests unchanged.

---

### Task 5: Add personalized checkpoint parity

**Files:**
- Modify: `lib/runtime/personalized-generation.ts`
- Modify: `tests/runtime/personalized-generation.test.ts`
- Modify: `tests/runtime/choice-only-resume.test.ts` if shared resume assertions live there

- [ ] **Step 1: Add failing personalized checkpoint lifecycle tests**

Add tests in call-order form:

```ts
expect(events).toEqual([
  'load-checkpoint',
  'transition-running-choices',
  'generate-choices',
  'publish',
  'transition-published',
])
expect(generateProse).not.toHaveBeenCalled()
```

Cover valid same-job earlier-attempt reuse, different job rejection, attempt-ahead rejection, fresh prose persist before choices, failed choices retaining checkpoint, persistence failure stopping choices, successful `PUBLISHED`, final chapter completion, and current worker identity on every mutation.

- [ ] **Step 2: Reuse shared checkpoint seams**

Extend `PersonalizedGenerationDeps` with existing `loadUsableProseCheckpoint`, `persistProseReadyCheckpoint`, and `markCheckpointStatus`. Do not create personalized checkpoint table/types.

- [ ] **Step 3: Load and validate before prose generation**

After required canon/blueprint/contract context exists, build same freshness context as standard with personalized mode and current job provenance. On valid checkpoint:

```ts
const draft = draftFromCheckpoint(checkpoint)
fromCheckpoint = true
```

Skip prose provider. Transition to `RUNNING_CHOICES` with current job context.

- [ ] **Step 4: Persist fresh prose before choices**

After personalized prose passes validation, persist `PROSE_READY` schema v2 with all non-null freshness values and current job context. Worker mutation failure stops attempt before first choice call.

- [ ] **Step 5: Preserve/reuse checkpoint through choice failure and publish**

Choice failure transitions to `CHOICES_RETRY_WAIT`; success uses existing fenced publication then shared `PUBLISHED` transition. Chapter 50 uses same `PUBLISHED` operation. No personalized-only delete/finalize branch.

- [ ] **Step 6: Run personalized and resume suites**

Run:

```bash
pnpm exec vitest run tests/runtime/personalized-generation.test.ts tests/runtime/choice-only-resume.test.ts tests/runtime/generation-mode-dispatch.test.ts
```

Expected: personalized retries skip prose; standard behavior remains unchanged.

---

### Task 6: Cut internal real-mode route to shared kickoff and test recovery

**Files:**
- Modify: `app/api/stories/[id]/generate/route.ts`
- Modify: `tests/authoring/generation-route-authorization.test.ts`
- Modify: `tests/api/authoring-lock-start.test.ts`
- Create: `tests/api/generation-recover.test.ts`
- Modify: `app/api/generation/recover/route.ts` only for observed sync scheduling failure

- [ ] **Step 1: Rewrite route tests against shared kickoff seam**

Mock `startOwnedChapterGeneration` from its server seam. Add exact status cases:

```ts
it.each([
  ['STARTED', 202],
  ['ALREADY_RUNNING', 202],
  ['ALREADY_READY', 200],
] as const)('maps %s to %i', async (status, expectedStatus) => {
  mocks.startOwnedChapterGeneration.mockResolvedValue({
    ok: true,
    chapterNumber: 1,
    status,
    attemptId: status === 'STARTED' ? 'job-1' : null,
  })
  const response = await POST(request(), params)
  expect(response.status).toBe(expectedStatus)
})
```

Retain admin-token/session/owner checks. Add fake `201` success and `409` conflict; assert fake never calls kickoff. Add failure mapping `401/404/400`. Mock exact production seam `@/lib/api/start-chapter.server`. Keep public `/start-chapter` existing `ALREADY_READY=202` regression unchanged in `authoring-lock-start.test.ts`.

Also add shared-kickoff worker-ON tests to `tests/api/authoring-lock-start.test.ts`:

```ts
it('returns failure without scheduling when durable enqueue fails', async () => {
  mocks.enqueueGenerationJob.mockRejectedValue(new Error('DB_UNAVAILABLE'))
  const result = await startOwnedChapterGeneration('story-a', 1)
  expect(result.ok).toBe(false)
  expect(mocks.after).not.toHaveBeenCalled()
  expect(mocks.claimAndRunGenerationJobById).not.toHaveBeenCalled()
})

it.each(['GENERATION_JOB_CONFLICT', 'LEASE_HELD'] as const)(
  'maps %s to ALREADY_RUNNING without a second claim',
  async (code) => {
    mocks.enqueueGenerationJob.mockRejectedValue(new GenerationJobError(code))
    const result = await startOwnedChapterGeneration('story-a', 1)
    expect(result).toMatchObject({ ok: true, status: 'ALREADY_RUNNING' })
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.claimAndRunGenerationJobById).not.toHaveBeenCalled()
  },
)
```

`GenerationJobError` accepts exactly one `GenerationJobErrorCode`, so `new GenerationJobError(code)` is the current constructor. These tests prove enqueue failure cannot return `STARTED` and conflict/lease paths schedule no duplicate claim.

- [ ] **Step 2: Verify route and shared-kickoff tests fail against current gaps**

Run:

```bash
pnpm exec vitest run tests/authoring/generation-route-authorization.test.ts tests/api/authoring-lock-start.test.ts
```

Expected: new internal route tests fail because route still calls `runChapterGenerationAttempt`; public route tests remain green.

- [ ] **Step 3: Replace real-mode direct dispatcher**

Keep `generateNextChapter` for fake mode. Remove `runChapterGenerationAttempt`. For real mode:

```ts
const result = await startOwnedChapterGeneration(id, n)
if (!result.ok) {
  const status = result.error === AUTHORING_AUTH_REQUIRED_ERROR
    ? 401
    : result.error === STORY_NOT_FOUND_ERROR
      ? 404
      : 400
  return NextResponse.json(result, { status })
}
const status = result.status === 'ALREADY_READY' ? 200 : 202
return NextResponse.json(result, { status })
```

Keep `guardAdminToken` first. Avoid route-local enqueue/claim logic. If shared helper already performs owner lookup, retain current early owner lookup for unchanged authorization response unless tests show duplicate lookup harms contract.

- [ ] **Step 4: Add recovery route tests**

Create `tests/api/generation-recover.test.ts` with `vi.hoisted`, `vi.resetModules`, env restore, mocked `after`, and mocked runtime functions. Cover:

```ts
expect(unsetSecret.status).toBe(404)
expect(wrongBearer.status).toBe(401)
expect(workerOff.status).toBe(202)
expect(afterMock).not.toHaveBeenCalled()
```

For worker on, capture callback, assert immediate `202`, then invoke callback and assert stale recovery `{ batchSize: 20 }` happens before claim `{ maxJobs: 5 }`. Test absent/unparsable default `5`, clamp `1..20`, `parseInt('7junk') === 7`, async error logging, and fixed generic response if `after()` throws synchronously.

- [ ] **Step 5: Add sync scheduling error boundary only if red test proves gap**

Wrap scheduling registration without exposing error text:

```ts
try {
  after(async () => { /* existing caught callback */ })
} catch {
  console.error('GENERATION_RECOVER_SCHEDULE_FAILED')
  return NextResponse.json({ error: 'recovery_unavailable' }, { status: 500 })
}
```

Do not change async callback semantics: response stays `202`; later failure is logged only.

- [ ] **Step 6: Run route/recovery suites**

Run:

```bash
pnpm exec vitest run tests/authoring/generation-route-authorization.test.ts tests/api/authoring-lock-start.test.ts tests/api/generation-recover.test.ts
```

Expected: internal status map `202/202/200`; public `/start-chapter` remains current behavior; recovery worker-off schedules nothing.

---

### Task 7: Update operations contract and run complete local gates

**Files:**
- Modify: `docs/GENERATION_WORKER_OPS.md`
- Verify all changed/untracked implementation files

- [ ] **Step 1: Replace rollout checklist with approved order**

Document all three migrations:

```text
20260724115000_claim_generation_job_by_id.sql
20260724120000_checkpoint_versioning.sql
20260724121000_generation_checkpoint_fencing.sql
```

State timer installed disabled; worker and timer remain off through migration verification and worker-off deploy; controlled activation only in dedicated canary with externally scoped traffic; broad enablement follows authenticated smoke, restart/ownership/duplicate tests, 30-job soak, and sign-off.

- [ ] **Step 2: Correct rollback semantics**

Remove claim that recovery drains jobs after worker OFF. Document:

```text
Before disabling worker: stop new canary traffic; inventory QUEUED/RUNNING/RETRY_WAIT jobs; approve disposition. Once worker flag is OFF, recovery returns 202 no-op and cannot drain. Remaining jobs require later fixed-code reactivation or separately approved DB remediation/restore.
```

State migrations are forward-only.

- [ ] **Step 3: Run focused changed-area suites**

Run:

```bash
pnpm exec vitest run tests/api/owned-queries.test.ts tests/api/personalized-stories.test.ts
pnpm exec vitest run tests/runtime/checkpoint-freshness.test.ts tests/runtime/checkpoint-persistence.test.ts tests/runtime/choice-only-resume.test.ts
pnpm exec vitest run tests/runtime/personalized-generation.test.ts tests/runtime/generation-mode-dispatch.test.ts
pnpm exec vitest run tests/runtime/choice-generation-baseline.test.ts tests/runtime/choice-concurrency.test.ts tests/runtime/generation-worker.test.ts
pnpm exec vitest run tests/ai-gateway/gateway-provider-observability.test.ts
pnpm exec vitest run tests/authoring/generation-route-authorization.test.ts tests/api/authoring-lock-start.test.ts tests/api/generation-recover.test.ts
```

Expected: every listed file passes. Record exact file/test/skip counts and exit codes.

- [ ] **Step 4: Run full source release gates**

Run separately and retain full output:

```bash
pnpm test:unit
pnpm run typecheck
pnpm lint
pnpm run check:migration-versions
pnpm run build
```

Expected: every command exits `0`. A focused green suite cannot replace a red full suite.

- [ ] **Step 5: Run complete local DB gates**

Run:

```bash
supabase db reset
node scripts/run-smoke.cjs scripts/set-local-db-test-marker.ts
supabase test db
pnpm run test:db:generation-checkpoints
pnpm run test:db:generation-jobs
```

Expected: reset, marker, all pgTAP files, and all race scripts pass. If Docker/Supabase local is unavailable, record exact failure and status `implementation complete, DB verification blocked`; do not run linked commands.

- [ ] **Step 6: Validate whitespace and staging safety**

Run:

```bash
git diff --check
git diff --cached --check
git status --short
git check-ignore -v -- .env.local.bak .aionrs/ .zcode/plans/
git ls-files -- .env.local.bak .aionrs .zcode/plans
```

For intended untracked source/migration/test files, validate line endings/trailing whitespace with the project's formatter/linter or add them temporarily to a non-committing index only if permission policy allows; do not commit. Expected: no secret artifact tracked/staged; no `nul`; no whitespace errors.

- [ ] **Step 7: Report truthful terminal status**

If every source and DB gate passes:

```text
Status: local release-ready
Production rollout: NO-GO
Worker: OFF
Remote actions performed: none
```

If source passes but DB cannot run:

```text
Status: implementation complete, DB verification blocked
Local release-ready: not claimed
Production rollout: NO-GO
Worker: OFF
Remote actions performed: none
```

Include exact test counts, command exits, remaining warnings, migration list, and dirty-tree inventory. Do not commit or perform any remote action.
