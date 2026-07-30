-- Checkpoint fencing + freshness versioning for choice-only prose reuse.
--
-- Prose checkpoints let a failed choice attempt be retried WITHOUT regenerating
-- prose. That reuse is only safe when the checkpoint was produced under the same
-- canon/blueprint/direction/mode/policy/prompt-contract as the current attempt.
-- These columns carry that provenance so verifyCheckpointFreshness() can reject
-- stale reuse. All nullable for backward compatibility with rows written before
-- this migration; the schema-version marker distinguishes legacy from new rows.
--
-- job_id + job_attempt_number are PROVENANCE (which job/attempt produced the
-- prose), NOT a freshness equality key. A choice-only retry re-claims the SAME
-- job and increments attempt_count, so freshness uses jobAttemptNumber <= current
-- (never ===). Publish ownership is enforced separately by claim_token/lease_id.

alter table public.chapter_generation_checkpoints
  add column if not exists generation_mode text,
  add column if not exists generation_policy_version integer,
  add column if not exists prompt_contract_version integer,
  add column if not exists job_id uuid,
  add column if not exists job_attempt_number integer;

-- Schema-version marker: existing rows are legacy (1); new writes are 2.
-- Legacy rows get compatibility freshness handling; v2 rows must carry non-null
-- versions/fingerprints or they are rejected (fail closed).
alter table public.chapter_generation_checkpoints
  add column if not exists checkpoint_schema_version integer;

update public.chapter_generation_checkpoints
  set checkpoint_schema_version = 1
  where checkpoint_schema_version is null;

alter table public.chapter_generation_checkpoints
  alter column checkpoint_schema_version set default 2;

alter table public.chapter_generation_checkpoints
  alter column checkpoint_schema_version set not null;

comment on column public.chapter_generation_checkpoints.job_id is
  'Provenance: generation_jobs.id that produced this prose. Not a freshness equality key.';
comment on column public.chapter_generation_checkpoints.job_attempt_number is
  'Provenance: attempt_count when prose was written. Freshness uses <= current, never ===.';
comment on column public.chapter_generation_checkpoints.checkpoint_schema_version is
  'Freshness policy marker. 1 = legacy compatibility, 2 = strict non-null versions required.';
