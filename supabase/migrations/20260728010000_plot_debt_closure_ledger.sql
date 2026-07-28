-- Plot-debt closure ledger + contract provenance columns.
--
-- Phase 1 of plot-debt closure persistence. Adds:
-- 1. story_contract_version to generation_jobs (snapshot at enqueue, immutable)
-- 2. story_contract_version to chapter_generation_checkpoints (copied from job)
-- 3. closure_payload_hash + publication_payload_hash to generation_jobs
-- 4. reader_plot_debt_closures table (append-only, immutable ledger)

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. generation_jobs: contract provenance + publication hashes
-- ──────────────────────────────────────────────────────────────────────────────

alter table public.generation_jobs
  add column if not exists story_contract_version integer;

alter table public.generation_jobs
  add column if not exists closure_payload_hash text;

alter table public.generation_jobs
  add constraint generation_jobs_closure_payload_hash_check
  check (closure_payload_hash is null or closure_payload_hash ~ '^[0-9a-f]{64}$');

alter table public.generation_jobs
  add column if not exists publication_payload_hash text;

alter table public.generation_jobs
  add constraint generation_jobs_pub_payload_hash_check
  check (publication_payload_hash is null or publication_payload_hash ~ '^[0-9a-f]{64}$');

comment on column public.generation_jobs.story_contract_version is
  'Snapshot of stories.story_contract_version at enqueue time. Immutable after insert.';
comment on column public.generation_jobs.closure_payload_hash is
  'SHA-256 hex of canonical closure set. NULL until publication succeeds.';
comment on column public.generation_jobs.publication_payload_hash is
  'SHA-256 hex of canonical publication payload. NULL until publication succeeds.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. chapter_generation_checkpoints: contract provenance
-- ──────────────────────────────────────────────────────────────────────────────

alter table public.chapter_generation_checkpoints
  add column if not exists story_contract_version integer;

comment on column public.chapter_generation_checkpoints.story_contract_version is
  'Copied from generation_jobs.story_contract_version at checkpoint creation.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2b. story_generation_contracts: contract provenance (matches stories.*)
-- ──────────────────────────────────────────────────────────────────────────────
-- V4 verifies job = checkpoint = story = contract on story_contract_version.
-- Backfill existing rows to 1 (matches stories default) so provenance holds.

alter table public.story_generation_contracts
  add column if not exists story_contract_version integer not null default 1;

comment on column public.story_generation_contracts.story_contract_version is
  'Contract version; V4 requires job = checkpoint = story = contract to match.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. reader_plot_debt_closures: append-only per-reader closure ledger
-- ──────────────────────────────────────────────────────────────────────────────

create table public.reader_plot_debt_closures (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  user_id            uuid not null,
  story_id           text not null,
  debt_id            text not null
                     check (debt_id = pg_catalog.btrim(debt_id)
                            and pg_catalog.char_length(debt_id) between 1 and 100),
  closure_form       text not null
                     check (closure_form in ('RESOLVED','SUBVERTED','TRANSFORMED','ABANDONED')),
  closed_at_chapter  integer not null
                     check (closed_at_chapter between 1 and 50),
  closed_by_job_id   uuid not null
                     references public.generation_jobs(id) on delete restrict,
  closure_version    integer not null default 1
                     check (closure_version = 1),
  created_at         timestamptz not null default pg_catalog.clock_timestamp(),

  constraint reader_plot_debt_closures_reader_fkey
    foreign key (user_id, story_id)
    references public.reader_states(user_id, story_id)
    on delete cascade,

  constraint reader_plot_debt_closures_unique_debt
    unique (user_id, story_id, debt_id)
);

-- Reject UPDATE only. DELETE via CASCADE from reader_states is legitimate.
create or replace function public.reject_plot_debt_closure_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = 'P0001', message = 'PLOT_DEBT_CLOSURE_IMMUTABLE';
end;
$$;

create trigger plot_debt_closures_no_update
  before update on public.reader_plot_debt_closures
  for each row execute function public.reject_plot_debt_closure_update();

-- All DML revoked. INSERT only via security-definer RPC.
-- RLS is NOT enabled; protection is from revoke + security-definer.
revoke insert, update, delete, truncate on public.reader_plot_debt_closures
  from public, anon, authenticated, service_role;

-- SELECT only for admin/debug queries.
grant select on public.reader_plot_debt_closures to service_role;

comment on table public.reader_plot_debt_closures is
  'Append-only per-reader plot-debt closure ledger. Immutable after insert.';
comment on column public.reader_plot_debt_closures.closed_by_job_id is
  'Provenance: generation_jobs.id that produced this closure. ON DELETE RESTRICT.';
