-- Living Canon storage foundation (M10-A1b). Storage-only: ZERO runtime
-- activation. canon_state_revision is provided but NEVER incremented here;
-- the first increment happens atomically inside the A1c publisher.
--
-- Surface:
-- 1. stories:   + living_canon_version, + canon_state_revision
-- 2. hash:      chapter_state_delta_hash_v1() — DB-owned, domain-separated
-- 3. checkpoints: + state_delta_json/schema_version/hash, + base_canon_revision
--                checkpoint_schema_version 3 = living canon (delta required)
-- 4. reader_plot_debt_progress: append-only milestone ledger
-- 5. chapter_state_commits: append-only commit ledger (worker + sync)
-- 6. upsert_generation_checkpoint_fenced_v2: V3 writer (no caller yet)
-- V1 (18-param) stays untouched; legacy rows keep all-NULL delta fields.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. stories: living canon capability + revision counter
-- ──────────────────────────────────────────────────────────────────────────────
-- Capability version fails closed: only 0 (legacy) and 1 (living canon) exist.
-- A future capability version requires an explicit constraint expansion.
-- Column grants to anon/authenticated are the static list from
-- 20260713000000 — these new columns are invisible to readers (service_role
-- only, via the existing grant all).

alter table public.stories
  add column if not exists living_canon_version smallint not null default 0;

alter table public.stories
  add column if not exists canon_state_revision bigint not null default 0;

alter table public.stories
  add constraint stories_living_canon_version_check
  check (living_canon_version in (0, 1));

alter table public.stories
  add constraint stories_canon_state_revision_check
  check (canon_state_revision >= 0);

comment on column public.stories.living_canon_version is
  'Living canon capability. 0 = legacy story, 1 = living canon enabled. Fail-closed IN (0,1).';
comment on column public.stories.canon_state_revision is
  'Monotonic committed-state revision. 0 = never committed. NOT incremented in A1b; first increment is atomic in A1c.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. chapter_state_delta_hash_v1() — DB-owned state delta hash
-- ──────────────────────────────────────────────────────────────────────────────
-- Hash is computed by the database, never trusted from a caller-supplied
-- value: checkpoint and commit constraints recompute it from state_delta_json.
-- Domain-separated: SHA256("lakoku:chapter-state-delta:v1|" || canonical text).
-- jsonb::text is canonical (key order normalized), so equal logical content
-- hashes identically. Pure hashing → SECURITY INVOKER (no protected-table
-- reads, so DEFINER would only widen the privilege surface).
--
-- MUST be created before the constraints below that reference it.

create or replace function public.chapter_state_delta_hash_v1(p_delta jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_delta is null then null
    when pg_catalog.jsonb_typeof(p_delta) <> 'object' then null
    else pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to('lakoku:chapter-state-delta:v1|' || p_delta::text, 'UTF8')
      ),
      'hex'
    )
  end
$$;

revoke all on function public.chapter_state_delta_hash_v1(jsonb) from public, anon, authenticated;
grant execute on function public.chapter_state_delta_hash_v1(jsonb) to service_role;

comment on function public.chapter_state_delta_hash_v1(jsonb) is
  'SHA-256 hex of "lakoku:chapter-state-delta:v1|" + canonical jsonb text. NULL for NULL/non-object input.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. chapter_generation_checkpoints: living canon state delta columns
-- ──────────────────────────────────────────────────────────────────────────────
-- checkpoint_schema_version semantics:
--   1 = legacy compatibility (delta fields NULL)
--   2 = strict non-null provenance (delta fields NULL)
--   3 = living canon (state delta REQUIRED, DB-computed hash, exact base)
-- Default REMAINS 2; V3 rows are written only by the fenced V2 writer.
-- Legacy rows keep all-NULL delta fields and stay readable.

alter table public.chapter_generation_checkpoints
  add column if not exists state_delta_json jsonb,
  add column if not exists state_delta_schema_version smallint,
  add column if not exists state_delta_hash text,
  add column if not exists base_canon_revision bigint;

alter table public.chapter_generation_checkpoints
  add constraint chapter_generation_checkpoints_state_delta_hash_check
  check (state_delta_hash is null or state_delta_hash ~ '^[0-9a-f]{64}$');

-- Backward-compatible conditional check: v1/v2 rows must keep deltas NULL,
-- v3 rows must carry a valid object delta with a DB-verifiable hash. A NULL
-- marker (pre-migration state during replay of the historical versioning
-- migration) is treated as legacy: deltas must be NULL. NULL can never be
-- inserted in production (column is NOT NULL DEFAULT 2) — this branch exists
-- only so the migration replay path in checkpoint_versioning_test stays valid.
alter table public.chapter_generation_checkpoints
  add constraint chapter_generation_checkpoints_state_delta_check
  check (
    case
      when checkpoint_schema_version is null
        then state_delta_json is null and state_delta_schema_version is null
             and state_delta_hash is null and base_canon_revision is null
      when checkpoint_schema_version = 1
        then state_delta_json is null and state_delta_schema_version is null
             and state_delta_hash is null and base_canon_revision is null
      when checkpoint_schema_version = 2
        then state_delta_json is null and state_delta_schema_version is null
             and state_delta_hash is null and base_canon_revision is null
      when checkpoint_schema_version = 3
        then pg_catalog.jsonb_typeof(state_delta_json) = 'object'
             and state_delta_schema_version = 1
             and state_delta_hash is not null
             and base_canon_revision is not null and base_canon_revision >= 0
             and state_delta_hash = public.chapter_state_delta_hash_v1(state_delta_json)
      else false
    end
  ) not valid;

-- Existing rows are v1/v2 with NULL deltas → validation succeeds.
alter table public.chapter_generation_checkpoints
  validate constraint chapter_generation_checkpoints_state_delta_check;

comment on column public.chapter_generation_checkpoints.checkpoint_schema_version is
  'Freshness policy marker. 1 = legacy compatibility, 2 = strict non-null versions, 3 = living canon (state delta required).';
comment on column public.chapter_generation_checkpoints.state_delta_json is
  'Validated canonical state delta. V3 only; NULL for legacy v1/v2 rows.';
comment on column public.chapter_generation_checkpoints.state_delta_schema_version is
  'State delta contract version. 1 = current. V3 only.';
comment on column public.chapter_generation_checkpoints.state_delta_hash is
  'DB-computed SHA-256 (domain-separated) of state_delta_json. Never caller-supplied; CHECK re-derives it.';
comment on column public.chapter_generation_checkpoints.base_canon_revision is
  'stories.canon_state_revision the delta was computed against. V3 only; writer requires exact current revision.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. reader_plot_debt_progress: append-only per-milestone ledger
-- ──────────────────────────────────────────────────────────────────────────────
-- Row per (reader, story, debt, milestone_chapter) — NOT a mutable array.
-- Two retries paying milestone 45 collide on the unique key instead of racing
-- on a read-modify-write array. Security posture: zero direct mutation for
-- every role including service_role (revoke all) — INSERT only via the A1c
-- security-definer publisher — and RLS enabled with zero policies so direct
-- access stays closed even if grants are later re-added.

create table public.reader_plot_debt_progress (
  user_id               uuid not null,
  story_id              text not null,
  debt_id               text not null
                        check (debt_id = pg_catalog.btrim(debt_id)
                               and pg_catalog.char_length(debt_id) between 1 and 100),
  milestone_chapter     integer not null
                        check (milestone_chapter between 1 and 50),
  -- Fail-closed temporal invariant: with progress_version = 1 a milestone is
  -- recorded exactly at the chapter it belongs to. Late catch-up for a missed
  -- milestone (progressed_at > milestone) is prohibited by A1a resolver
  -- semantics; earlier recording would be a new semantic contract.
  progressed_at_chapter integer not null
                        check (progressed_at_chapter between 1 and 50
                               and progressed_at_chapter = milestone_chapter),
  source_job_id         uuid null
                        references public.generation_jobs(id) on delete restrict,
  progress_version      integer not null default 1
                        check (progress_version = 1),
  created_at            timestamptz not null default pg_catalog.clock_timestamp(),

  primary key (user_id, story_id, debt_id, milestone_chapter),

  constraint reader_plot_debt_progress_reader_fkey
    foreign key (user_id, story_id)
    references public.reader_states(user_id, story_id)
    on delete cascade
);

-- Reject UPDATE only. DELETE via CASCADE from reader_states is legitimate.
create or replace function public.reject_plot_debt_progress_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = 'PLOT_DEBT_PROGRESS_IMMUTABLE';
end;
$$;

create trigger reader_plot_debt_progress_immutable
  before update on public.reader_plot_debt_progress
  for each row execute function public.reject_plot_debt_progress_update();

-- Every role (including service_role) is denied ALL direct access. These
-- ledgers have no reader-facing API and hold canonical/private state, so
-- authorization must not depend on ambient/default ACLs — INSERT only via the
-- A1c security-definer publisher. RLS is enabled with ZERO policies so direct
-- access stays closed even if grants are later re-added.
revoke all on public.reader_plot_debt_progress
  from public, anon, authenticated, service_role;
grant select on public.reader_plot_debt_progress to service_role;
alter table public.reader_plot_debt_progress enable row level security;

comment on table public.reader_plot_debt_progress is
  'Append-only plot-debt milestone ledger. Progress rows are immutable; server-controlled writes only. RLS on, zero policies — no direct access for any role.';
comment on column public.reader_plot_debt_progress.source_job_id is
  'Worker provenance; NULL when progress was recorded by the sync path (no generation job).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. chapter_state_commits: append-only committed-state ledger
-- ──────────────────────────────────────────────────────────────────────────────
-- Exactly one commit per (story, chapter) and exactly one per committed
-- revision. committed_canon_revision = base_canon_revision + 1 (monotonic).
-- One ledger for worker AND sync paths: source_job_id is nullable so the sync
-- path never needs a fake generation job. Immutable after insert (UPDATE
-- rejected); mutation only via the A1c security-definer atomic publisher.

create table public.chapter_state_commits (
  id                        uuid primary key default pg_catalog.gen_random_uuid(),
  story_id                  text not null,
  chapter_number            integer not null
                            check (chapter_number between 1 and 50),
  base_canon_revision       bigint not null
                            check (base_canon_revision >= 0),
  committed_canon_revision  bigint not null
                            check (committed_canon_revision >= 1),
  state_delta_json          jsonb not null,
  -- Explicit shape check: a non-object delta would make the hash equality
  -- CHECK evaluate NULL (CHECK passes on NULL), so object-ness is pinned here.
  state_delta_schema_version smallint not null default 1
                            check (state_delta_schema_version = 1),
  state_delta_hash          text not null
                            check (state_delta_hash ~ '^[0-9a-f]{64}$'
                                   and state_delta_hash = public.chapter_state_delta_hash_v1(state_delta_json)),
  generation_mode           text not null
                            check (generation_mode in ('standard', 'personalized')),
  actor_user_id             uuid null
                            references auth.users(id) on delete set null,
  source_job_id             uuid null
                            references public.generation_jobs(id) on delete restrict,
  checkpoint_attempt_id     uuid not null,
  commit_version            integer not null default 1
                            check (commit_version = 1),
  created_at                timestamptz not null default pg_catalog.clock_timestamp(),

  constraint chapter_state_commits_state_delta_shape_check
    check (pg_catalog.jsonb_typeof(state_delta_json) = 'object'),

  constraint chapter_state_commits_story_fkey
    foreign key (story_id) references public.stories(id) on delete cascade,

  -- Monotonic revision invariant: every commit lands exactly one past its base.
  constraint chapter_state_commits_revision_step_check
    check (committed_canon_revision = base_canon_revision + 1),

  -- Exactly one committed state per chapter.
  constraint chapter_state_commits_unique_chapter
    unique (story_id, chapter_number),

  -- Exactly one commit per committed revision (no double-commit at same step).
  constraint chapter_state_commits_unique_revision
    unique (story_id, committed_canon_revision)
);

-- Reject UPDATE only. DELETE via CASCADE from stories is legitimate.
create or replace function public.reject_chapter_state_commit_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = 'STATE_COMMIT_IMMUTABLE';
end;
$$;

create trigger chapter_state_commits_immutable
  before update on public.chapter_state_commits
  for each row execute function public.reject_chapter_state_commit_update();

-- Append-only: no direct access for any role, including service_role — INSERT
-- only via the A1c security-definer atomic publisher. RLS is enabled with ZERO
-- policies (defense in depth; direct access stays closed even if grants are
-- later re-added).
revoke all on public.chapter_state_commits
  from public, anon, authenticated, service_role;
grant select on public.chapter_state_commits to service_role;
alter table public.chapter_state_commits enable row level security;

comment on table public.chapter_state_commits is
  'Append-only committed living-canon state ledger. One row per story/chapter, one per committed revision, immutable. RLS on, zero policies — no direct access for any role.';
comment on column public.chapter_state_commits.base_canon_revision is
  'Pre-commit revision the delta was computed against (stories.canon_state_revision before increment).';
comment on column public.chapter_state_commits.committed_canon_revision is
  'Post-increment revision; must equal base_canon_revision + 1.';
comment on column public.chapter_state_commits.actor_user_id is
  'User acting on the story, when known (worker path may be NULL).';
comment on column public.chapter_state_commits.source_job_id is
  'Generation job provenance; NULL for the sync path (no generation job exists).';
comment on column public.chapter_state_commits.checkpoint_attempt_id is
  'chapter_generation_checkpoints.attempt_id that produced the delta (sync: synthetic attempt id).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. upsert_generation_checkpoint_fenced_v2 — V3 (living canon) writer
-- ──────────────────────────────────────────────────────────────────────────────
-- Copy of the current 18-param V1 fencing semantics (job → lease → checkpoint
-- lock order, ownership/provenance/contract checks, DB-derived identities)
-- plus:
--   * personalized mode only (V3 checkpoints exist only for living canon)
--   * story must have living_canon_version = 1 (capability, fail closed)
--   * p_base_canon_revision must equal the CURRENT stories.canon_state_revision
--     — stale (STALE_CANON_REVISION) and ahead (BASE_CANON_AHEAD) both rejected.
--     Read-only story select, no new lock (V1 lock order unchanged); the final
--     A1c publisher revalidates under its transaction.
--   * hash is DB-computed (chapter_state_delta_hash_v1), never caller-supplied
--   * replay provenance binds delta json + schema version + base revision
-- NO runtime caller in A1b — storage contract for A1c/A1d only.

create or replace function public.upsert_generation_checkpoint_fenced_v2(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_prose_fingerprint text,
  p_audit_signals jsonb,
  p_audit_signals_version integer,
  p_canon_version bigint,
  p_blueprint_version bigint,
  p_direction_fingerprint text,
  p_generation_mode text,
  p_generation_policy_version integer,
  p_prompt_contract_version integer,
  p_prose_attempt_count integer,
  p_state_delta_json jsonb,
  p_state_delta_schema_version smallint,
  p_base_canon_revision bigint
) returns jsonb
language plpgsql
volatile
security definer
-- Hardened empty search_path (V1 convention): every object reference in the
-- body is fully qualified, so no writable schema can shadow them.
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_paragraph_count integer;
  v_story_contract_version integer;
  v_living_canon_version smallint;
  v_canon_state_revision bigint;
  v_state_delta_hash text;
begin
  if p_job_id is null or p_worker_id is null or pg_catalog.btrim(p_worker_id) = ''
    or p_claim_token is null or p_lease_id is null or p_story_id is null
    or pg_catalog.btrim(p_story_id) = '' or p_chapter_number is null
    or p_chapter_number not between 1 and 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_IDENTITY';
  end if;

  -- Lock job row and read authoritative contract provenance.
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'OWNERSHIP_LOST');
  end if;

  if v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  -- Authoritative generation_kind from job, not from caller parameter.
  if p_generation_mode is distinct from v_job.generation_kind then
    raise exception using errcode = '22023', message = 'GENERATION_MODE_MISMATCH';
  end if;

  -- Authoritative contract version from locked job.
  v_story_contract_version := v_job.story_contract_version;

  -- Personalized without contract provenance is rejected.
  if v_job.generation_kind = 'personalized' and v_story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'CONTRACT_PROVENANCE_MISSING';
  end if;

  -- V2 is the V3 (living canon) writer: personalized mode only.
  if p_generation_mode <> 'personalized' then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- State delta payload validation (format errors raise before state checks).
  if p_state_delta_json is null
    or pg_catalog.jsonb_typeof(p_state_delta_json) <> 'object'
    or pg_catalog.pg_column_size(p_state_delta_json) > 1000000
    or p_state_delta_schema_version is null or p_state_delta_schema_version <> 1
    or p_base_canon_revision is null or p_base_canon_revision < 0 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Hash is computed by the database; callers can never supply it.
  v_state_delta_hash := public.chapter_state_delta_hash_v1(p_state_delta_json);

  -- Living canon capability + exact base revision. Read-only select — V1 lock
  -- order stays untouched; the A1c publisher revalidates under its own locks.
  select s.living_canon_version, s.canon_state_revision
    into v_living_canon_version, v_canon_state_revision
  from public.stories s
  where s.id = v_job.story_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;
  if v_living_canon_version <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LIVING_CANON_NOT_ACTIVE');
  end if;
  if p_base_canon_revision < v_canon_state_revision then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'STALE_CANON_REVISION');
  end if;
  if p_base_canon_revision > v_canon_state_revision then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'BASE_CANON_AHEAD');
  end if;

  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found or v_lease.job_id is distinct from v_job.id
    or v_lease.claim_token is distinct from v_job.claim_token
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or v_lease.holder is distinct from v_job.worker_id
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LEASE_INVALID');
  end if;

  -- Payload validation (V1 semantics).
  if p_title is null or pg_catalog.btrim(p_title) = '' or pg_catalog.length(p_title) > 500
    or p_paragraphs is null or pg_catalog.jsonb_typeof(p_paragraphs) <> 'array'
    or p_prose_fingerprint is null or pg_catalog.btrim(p_prose_fingerprint) = ''
    or pg_catalog.length(p_prose_fingerprint) > 256
    or p_canon_version is null or p_canon_version < 0
    or p_blueprint_version is null or p_blueprint_version < 0
    or p_direction_fingerprint is null or pg_catalog.btrim(p_direction_fingerprint) = ''
    or pg_catalog.length(p_direction_fingerprint) > 256
    or p_generation_policy_version is null or p_generation_policy_version < 1
    or p_prompt_contract_version is null or p_prompt_contract_version < 1
    or p_prose_attempt_count is null or p_prose_attempt_count < 0 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Audit signals validation: V2 writer is personalized-only, so V1/V2
  -- signals are mandatory (V1 semantics for personalized).
  if p_audit_signals is null or p_audit_signals_version is null then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;
  if p_audit_signals_version = 1 then
    -- V1: exact three booleans, no closesPlotDebts
    if pg_catalog.jsonb_typeof(p_audit_signals) <> 'object'
      or p_audit_signals - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' <> '{}'::jsonb
      or not (p_audit_signals ?& array['opensNewThread','opensMajorMystery','opensNewConflict'])
      or pg_catalog.jsonb_typeof(p_audit_signals->'opensNewThread') <> 'boolean'
      or pg_catalog.jsonb_typeof(p_audit_signals->'opensMajorMystery') <> 'boolean'
      or pg_catalog.jsonb_typeof(p_audit_signals->'opensNewConflict') <> 'boolean'
    then
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
  elsif p_audit_signals_version = 2 then
    if not public.is_valid_checkpoint_audit_signals_v2(p_audit_signals) then
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
  else
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Paragraph validation.
  select pg_catalog.count(*)::integer into v_paragraph_count
  from pg_catalog.jsonb_array_elements(p_paragraphs) paragraph
  where pg_catalog.jsonb_typeof(paragraph) = 'string'
    and pg_catalog.btrim(paragraph #>> '{}') <> ''
    and pg_catalog.length(paragraph #>> '{}') <= 20000;
  if v_paragraph_count = 0
    or v_paragraph_count <> pg_catalog.jsonb_array_length(p_paragraphs)
    or pg_catalog.pg_column_size(p_paragraphs) > 1000000 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Load existing checkpoint for this story+chapter+attempt.
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = v_job.id
  for update;

  if found then
    if v_checkpoint.job_attempt_number > v_job.attempt_count then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'ATTEMPT_AHEAD');
    end if;
    if v_checkpoint.status <> 'PROSE_READY' then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'INVALID_TRANSITION');
    end if;
    if v_checkpoint.checkpoint_schema_version <> 3
      or v_checkpoint.attempt_id is distinct from v_job.id
      or v_checkpoint.correlation_id is distinct from v_job.correlation_id
      or v_checkpoint.job_id is distinct from v_job.id
      or v_checkpoint.prose_fingerprint is distinct from p_prose_fingerprint
      or v_checkpoint.audit_signals_json is distinct from p_audit_signals
      or v_checkpoint.audit_signals_version is distinct from p_audit_signals_version
      or v_checkpoint.canon_version is distinct from p_canon_version
      or v_checkpoint.blueprint_version is distinct from p_blueprint_version
      or v_checkpoint.direction_fingerprint is distinct from p_direction_fingerprint
      or v_checkpoint.generation_mode is distinct from p_generation_mode
      or v_checkpoint.generation_policy_version is distinct from p_generation_policy_version
      or v_checkpoint.prompt_contract_version is distinct from p_prompt_contract_version
      -- Delta provenance binds json + schema version + base revision: same
      -- JSON with a different base is NOT an identical replay.
      or v_checkpoint.state_delta_json is distinct from p_state_delta_json
      or v_checkpoint.state_delta_schema_version is distinct from p_state_delta_schema_version
      or v_checkpoint.base_canon_revision is distinct from p_base_canon_revision then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
    end if;
  end if;

  -- Upsert checkpoint with contract version from job; V3 with DB-computed hash.
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, audit_signals_json, audit_signals_version,
    canon_version, blueprint_version,
    direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at,
    story_contract_version,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    v_job.story_id, v_job.chapter_number, v_job.id, v_job.correlation_id,
    'PROSE_READY', p_title, p_paragraphs, p_prose_fingerprint,
    p_audit_signals, p_audit_signals_version, p_canon_version, p_blueprint_version,
    p_direction_fingerprint, p_generation_mode, p_generation_policy_version,
    p_prompt_contract_version,
    v_job.id, v_job.attempt_count, 3, p_prose_attempt_count, 0,
    pg_catalog.clock_timestamp() + interval '24 hours',
    v_story_contract_version,
    p_state_delta_json, p_state_delta_schema_version, v_state_delta_hash, p_base_canon_revision
  )
  on conflict (story_id, chapter_number, attempt_id) do update
  set status = 'PROSE_READY',
      title = excluded.title,
      paragraphs_json = excluded.paragraphs_json,
      prose_fingerprint = excluded.prose_fingerprint,
      audit_signals_json = excluded.audit_signals_json,
      audit_signals_version = excluded.audit_signals_version,
      canon_version = excluded.canon_version,
      blueprint_version = excluded.blueprint_version,
      direction_fingerprint = excluded.direction_fingerprint,
      generation_mode = excluded.generation_mode,
      generation_policy_version = excluded.generation_policy_version,
      prompt_contract_version = excluded.prompt_contract_version,
      job_id = excluded.job_id,
      job_attempt_number = excluded.job_attempt_number,
      checkpoint_schema_version = 3,
      prose_attempt_count = excluded.prose_attempt_count,
      choice_attempt_count = 0,
      updated_at = pg_catalog.clock_timestamp(),
      expires_at = excluded.expires_at,
      story_contract_version = excluded.story_contract_version,
      state_delta_json = excluded.state_delta_json,
      state_delta_schema_version = excluded.state_delta_schema_version,
      state_delta_hash = excluded.state_delta_hash,
      base_canon_revision = excluded.base_canon_revision
  returning * into v_checkpoint;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'result', 'UPDATED', 'changed', true,
    'checkpoint', pg_catalog.to_jsonb(v_checkpoint)
  );
end;
$$;

revoke all on function public.upsert_generation_checkpoint_fenced_v2(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint
) from public, anon, authenticated;
grant execute on function public.upsert_generation_checkpoint_fenced_v2(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint
) to service_role;

comment on function public.upsert_generation_checkpoint_fenced_v2 is
  'V3 (living canon) checkpoint writer. Requires living_canon_version=1, exact current base revision, DB-computed hash. No runtime caller in A1b.';
