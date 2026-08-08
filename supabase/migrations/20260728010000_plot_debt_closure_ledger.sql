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
-- We backfill from public.stories.story_contract_version for existing rows.
-- If any contract row has no matching story, or story lacks a contract version,
-- the migration fails hard (no silent fallback to version 1).

alter table public.story_generation_contracts
  add column if not exists story_contract_version integer;

do $$
begin
  if exists (
    select 1
    from public.story_generation_contracts c
    left join public.stories s on s.id = c.story_id
    where s.id is null or s.story_contract_version is null
  ) then
    raise exception 'CONTRACT_VERSION_BACKFILL_INVALID';
  end if;
end;
$$;

update public.story_generation_contracts c
set story_contract_version = s.story_contract_version
from public.stories s
where s.id = c.story_id;

alter table public.story_generation_contracts
  alter column story_contract_version set not null;

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

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Update bootstrap_personalized_story_v1 for contract version compatibility
-- ──────────────────────────────────────────────────────────────────────────────
-- With public.story_generation_contracts.story_contract_version now NOT NULL,
-- bootstrap must populate this column by copying stories.story_contract_version.

create or replace function public.bootstrap_personalized_story_v1(
  p_story_id text,
  p_owner_user_id uuid,
  p_contract_source text,
  p_onboarding_json jsonb,
  p_story_contract_json jsonb,
  p_route_schema_json jsonb,
  p_plot_debts_json jsonb,
  p_ending_candidates_json jsonb,
  p_characters jsonb,
  p_character_aliases jsonb,
  p_voice_sheets jsonb,
  p_facts jsonb,
  p_knowledge jsonb,
  p_secrets jsonb,
  p_threads jsonb,
  p_blueprints jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_story public.stories%rowtype;
  v_payload_hash text;
  v_character_ids text[];
  v_fact_ids text[];
  v_secret_ids text[];
  v_thread_ids text[];
  v_expected_contract_keys constant text[] := array[
    'storyId','totalChapters','title','genre','tone','styleProfile','mainCharacter',
    'mainConflict','finalQuestion','corePromise','actPlan','chapterTargets',
    'revealRunway','closureRunway'
  ];
begin
  -- Bound full request before traversing nested JSON.
  if p_owner_user_id is null
    or p_story_id is null or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) not between 1 and 128
    or p_contract_source not in ('llm', 'llm_repaired', 'template_fallback')
    or pg_catalog.pg_column_size(pg_catalog.jsonb_build_object(
      'onboarding', p_onboarding_json, 'contract', p_story_contract_json,
      'route', p_route_schema_json, 'debts', p_plot_debts_json,
      'endings', p_ending_candidates_json, 'characters', p_characters,
      'aliases', p_character_aliases, 'voices', p_voice_sheets, 'facts', p_facts,
      'knowledge', p_knowledge, 'secrets', p_secrets, 'threads', p_threads,
      'blueprints', p_blueprints
    )) > 4 * 1024 * 1024
  then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_PAYLOAD';
  end if;

  -- Split contract payload keeps exact top-level shape and bounded scalar/array types.
  if pg_catalog.jsonb_typeof(p_onboarding_json) is distinct from 'object'
    or pg_catalog.pg_column_size(p_onboarding_json) > 64 * 1024
    or pg_catalog.jsonb_typeof(p_story_contract_json) is distinct from 'object'
    or not (p_story_contract_json ?& v_expected_contract_keys)
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_story_contract_json)) <> pg_catalog.cardinality(v_expected_contract_keys)
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_story_contract_json) k where not (k = any(v_expected_contract_keys)))
    or pg_catalog.jsonb_typeof(p_story_contract_json->'storyId') <> 'string'
    or p_story_contract_json->>'storyId' is distinct from p_story_id
    or pg_catalog.jsonb_typeof(p_story_contract_json->'totalChapters') <> 'number'
    or (p_story_contract_json->>'totalChapters')::numeric <> 50
    or pg_catalog.jsonb_typeof(p_story_contract_json->'title') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'title') not between 1 and 160
    or pg_catalog.jsonb_typeof(p_story_contract_json->'genre') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'genre') not between 1 and 80
    or pg_catalog.jsonb_typeof(p_story_contract_json->'tone') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'tone') not between 1 and 160
    or p_story_contract_json->>'styleProfile' is distinct from 'lakoku_mobile_drama_v1'
    or pg_catalog.jsonb_typeof(p_story_contract_json->'mainCharacter') <> 'object'
    or not (p_story_contract_json->'mainCharacter' ?& array['name','role','wound','desire'])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_story_contract_json->'mainCharacter')) <> 4
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_story_contract_json->'mainCharacter') k where not (k = any(array['name','role','wound','desire'])))
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,name}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,name}') not between 1 and 100
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,role}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,role}') not between 1 and 120
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,wound}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,wound}') not between 1 and 500
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,desire}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,desire}') not between 1 and 500
    or pg_catalog.jsonb_typeof(p_story_contract_json->'mainConflict') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'mainConflict') not between 1 and 800
    or pg_catalog.jsonb_typeof(p_story_contract_json->'finalQuestion') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'finalQuestion') not between 1 and 500
    or pg_catalog.jsonb_typeof(p_story_contract_json->'corePromise') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'corePromise') not between 1 and 800
    or pg_catalog.jsonb_typeof(p_story_contract_json->'actPlan') <> 'array'
    or pg_catalog.jsonb_array_length(p_story_contract_json->'actPlan') not between 1 and 12
    or pg_catalog.jsonb_typeof(p_story_contract_json->'chapterTargets') <> 'array'
    or pg_catalog.jsonb_array_length(p_story_contract_json->'chapterTargets') <> 50
    or pg_catalog.jsonb_typeof(p_story_contract_json->'revealRunway') <> 'array'
    or pg_catalog.jsonb_array_length(p_story_contract_json->'revealRunway') not between 1 and 20
    or pg_catalog.jsonb_typeof(p_story_contract_json->'closureRunway') <> 'object'
    or p_story_contract_json ? 'plotDebts'
    or p_story_contract_json ? 'endingCandidates'
    or pg_catalog.jsonb_typeof(p_route_schema_json) is distinct from 'object'
    or pg_catalog.pg_column_size(p_route_schema_json) > 256 * 1024
    or pg_catalog.jsonb_typeof(p_plot_debts_json) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_plot_debts_json) not between 1 and 20
    or pg_catalog.jsonb_typeof(p_ending_candidates_json) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_ending_candidates_json) not between 2 and 8
  then
    raise exception using errcode = '22023', message = 'INVALID_CONTRACT';
  end if;

  -- Exact nested contract keys and scalar bounds.
  if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_story_contract_json->'actPlan') item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['actNumber','fromChapter','toChapter','goal'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 4
        or pg_catalog.jsonb_typeof(item->'actNumber') <> 'number'
        or (item->>'actNumber')::numeric <> pg_catalog.trunc((item->>'actNumber')::numeric)
        or (item->>'actNumber')::numeric not between 1 and 12
        or pg_catalog.jsonb_typeof(item->'fromChapter') <> 'number'
        or (item->>'fromChapter')::numeric <> pg_catalog.trunc((item->>'fromChapter')::numeric)
        or (item->>'fromChapter')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'toChapter') <> 'number'
        or (item->>'toChapter')::numeric <> pg_catalog.trunc((item->>'toChapter')::numeric)
        or (item->>'toChapter')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'goal') <> 'string'
        or pg_catalog.char_length(item->>'goal') not between 1 and 500
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_story_contract_json->'chapterTargets') item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['chapterNumber','phase','goal','mustInclude','mustNotReveal','emotionalTurn','expectedThreadMovement'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 7
        or pg_catalog.jsonb_typeof(item->'chapterNumber') <> 'number'
        or (item->>'chapterNumber')::numeric <> pg_catalog.trunc((item->>'chapterNumber')::numeric)
        or (item->>'chapterNumber')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'phase') <> 'string' or pg_catalog.char_length(item->>'phase') not between 1 and 80
        or pg_catalog.jsonb_typeof(item->'goal') <> 'string' or pg_catalog.char_length(item->>'goal') not between 1 and 700
        or pg_catalog.jsonb_typeof(item->'mustInclude') <> 'array' or pg_catalog.jsonb_array_length(item->'mustInclude') not between 1 and 8
        or pg_catalog.jsonb_typeof(item->'mustNotReveal') <> 'array' or pg_catalog.jsonb_array_length(item->'mustNotReveal') > 20
        or pg_catalog.jsonb_typeof(item->'emotionalTurn') <> 'string' or pg_catalog.char_length(item->>'emotionalTurn') not between 1 and 500
        or pg_catalog.jsonb_typeof(item->'expectedThreadMovement') <> 'array' or pg_catalog.jsonb_array_length(item->'expectedThreadMovement') not between 1 and 8
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'mustInclude') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 400)
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'mustNotReveal') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 160)
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'expectedThreadMovement') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 500)
    ) or (select pg_catalog.count(distinct (item->>'chapterNumber')::integer) from pg_catalog.jsonb_array_elements(p_story_contract_json->'chapterTargets') item) <> 50
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_plot_debts_json) item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['id','question','introducedAt','mustProgressBy','mustCloseBy','status'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 6
        or pg_catalog.jsonb_typeof(item->'id') <> 'string' or pg_catalog.char_length(item->>'id') not between 1 and 100
        or pg_catalog.jsonb_typeof(item->'question') <> 'string' or pg_catalog.char_length(item->>'question') not between 1 and 500
        or pg_catalog.jsonb_typeof(item->'introducedAt') <> 'number' or (item->>'introducedAt')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'mustProgressBy') <> 'array' or pg_catalog.jsonb_array_length(item->'mustProgressBy') not between 1 and 12
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'mustProgressBy') v where pg_catalog.jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<>pg_catalog.trunc((v#>>'{}')::numeric) or (v#>>'{}')::numeric not between 1 and 50)
        or pg_catalog.jsonb_typeof(item->'mustCloseBy') <> 'number' or (item->>'mustCloseBy')::numeric not between 1 and 50
        or item->>'status' not in ('open','progressing','closed')
    ) or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'id') from pg_catalog.jsonb_array_elements(p_plot_debts_json) item)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_ending_candidates_json) item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['key','name','condition','requiredClosure'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) >= 4
        or pg_catalog.jsonb_typeof(item->'key') <> 'string' or pg_catalog.char_length(item->>'key') not between 1 and 80
        or pg_catalog.jsonb_typeof(item->'name') <> 'string' or pg_catalog.char_length(item->>'name') not between 1 and 160
        or pg_catalog.jsonb_typeof(item->'condition') <> 'string' or pg_catalog.char_length(item->>'condition') not between 1 and 500
        or pg_catalog.jsonb_typeof(item->'requiredClosure') <> 'array' or pg_catalog.jsonb_array_length(item->'requiredClosure') not between 1 and 8
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'requiredClosure') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 400)
    ) or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'key') from pg_catalog.jsonb_array_elements(p_ending_candidates_json) item)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_story_contract_json->'revealRunway') item
      where pg_catalog.jsonb_typeof(item)<>'object'
        or not(item?&array['secretId','revealGateChapter'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
        or pg_catalog.jsonb_typeof(item->'secretId')<>'string'
        or pg_catalog.char_length(item->>'secretId') not between 1 and 100
        or pg_catalog.jsonb_typeof(item->'revealGateChapter')<>'number'
        or (item->>'revealGateChapter')::numeric<>pg_catalog.trunc((item->>'revealGateChapter')::numeric)
        or (item->>'revealGateChapter')::numeric not between 1 and 50
    )
    or (select pg_catalog.count(*)<>pg_catalog.count(distinct item->>'secretId') from pg_catalog.jsonb_array_elements(p_story_contract_json->'revealRunway') item)
  then
    raise exception using errcode = '22023', message = 'INVALID_CONTRACT_ROW';
  end if;

  if pg_catalog.jsonb_typeof(p_characters) is distinct from 'array' or pg_catalog.jsonb_array_length(p_characters) not between 1 and 100
    or pg_catalog.jsonb_typeof(p_character_aliases) is distinct from 'array' or pg_catalog.jsonb_array_length(p_character_aliases) > 500
    or pg_catalog.jsonb_typeof(p_voice_sheets) is distinct from 'array' or pg_catalog.jsonb_array_length(p_voice_sheets) > 100
    or pg_catalog.jsonb_typeof(p_facts) is distinct from 'array' or pg_catalog.jsonb_array_length(p_facts) > 1000
    or pg_catalog.jsonb_typeof(p_knowledge) is distinct from 'array' or pg_catalog.jsonb_array_length(p_knowledge) > 5000
    or pg_catalog.jsonb_typeof(p_secrets) is distinct from 'array' or pg_catalog.jsonb_array_length(p_secrets) > 500
    or pg_catalog.jsonb_typeof(p_threads) is distinct from 'array' or pg_catalog.jsonb_array_length(p_threads) > 500
    or pg_catalog.jsonb_typeof(p_blueprints) is distinct from 'array' or pg_catalog.jsonb_array_length(p_blueprints) <> 50
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON';
  end if;

  -- Every canon row has exact keys, required JSON scalar types, and authoring bounds.
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_characters) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','canonical_name','role','motivation','introduced_chapter']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>6 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'canonical_name')<>'string' or pg_catalog.char_length(i->>'canonical_name') not between 2 and 60 or pg_catalog.jsonb_typeof(i->'role')<>'string' or pg_catalog.char_length(i->>'role') not between 2 and 60 or pg_catalog.jsonb_typeof(i->'motivation')<>'string' or pg_catalog.char_length(i->>'motivation') not between 10 and 240 or pg_catalog.jsonb_typeof(i->'introduced_chapter')<>'number' or (i->>'introduced_chapter')::numeric<>pg_catalog.trunc((i->>'introduced_chapter')::numeric) or (i->>'introduced_chapter')::numeric not between 1 and 50)
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_character_aliases) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','character_id','alias','alias_type']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>4 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'character_id')<>'string' or pg_catalog.char_length(i->>'character_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'alias')<>'string' or pg_catalog.char_length(i->>'alias') not between 1 and 60 or i->>'alias_type' not in ('NAME','NICKNAME','RELATION','TITLE'))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_voice_sheets) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','character_id','register','speech_habits','forbidden_words','sample_lines']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>6 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'character_id')<>'string' or pg_catalog.char_length(i->>'character_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'register')<>'string' or pg_catalog.char_length(i->>'register') not between 3 and 140 or pg_catalog.jsonb_typeof(i->'speech_habits')<>'array' or pg_catalog.jsonb_array_length(i->'speech_habits')>6 or pg_catalog.jsonb_typeof(i->'forbidden_words')<>'array' or pg_catalog.jsonb_array_length(i->'forbidden_words')>10 or pg_catalog.jsonb_typeof(i->'sample_lines')<>'array' or pg_catalog.jsonb_array_length(i->'sample_lines') not between 1 and 4 or exists(select 1 from pg_catalog.jsonb_array_elements(i->'speech_habits') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 2 and 120) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'forbidden_words') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 40) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'sample_lines') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 3 and 200))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_facts) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','statement','subject_character_id','established_chapter','salience','load_bearing','paid_off']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>8 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'statement')<>'string' or pg_catalog.char_length(i->>'statement') not between 8 and 240 or pg_catalog.jsonb_typeof(i->'subject_character_id') not in ('string','null') or (pg_catalog.jsonb_typeof(i->'subject_character_id')='string' and pg_catalog.char_length(i->>'subject_character_id') not between 1 and 256) or pg_catalog.jsonb_typeof(i->'established_chapter')<>'number' or (i->>'established_chapter')::numeric<>pg_catalog.trunc((i->>'established_chapter')::numeric) or (i->>'established_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'salience')<>'number' or (i->>'salience')::numeric not between 0 and 1 or pg_catalog.jsonb_typeof(i->'load_bearing')<>'boolean' or pg_catalog.jsonb_typeof(i->'paid_off')<>'boolean')
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_knowledge) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','character_id','fact_id','known_from_chapter']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>4 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'character_id')<>'string' or pg_catalog.char_length(i->>'character_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'fact_id')<>'string' or pg_catalog.char_length(i->>'fact_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'known_from_chapter')<>'number' or (i->>'known_from_chapter')::numeric<>pg_catalog.trunc((i->>'known_from_chapter')::numeric) or (i->>'known_from_chapter')::numeric not between 1 and 50)
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_secrets) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','description','reveal_gate_chapter','revealed']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>5 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'description')<>'string' or pg_catalog.char_length(i->>'description') not between 15 and 300 or pg_catalog.jsonb_typeof(i->'reveal_gate_chapter')<>'number' or (i->>'reveal_gate_chapter')::numeric<>pg_catalog.trunc((i->>'reveal_gate_chapter')::numeric) or (i->>'reveal_gate_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'revealed')<>'boolean')
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_threads) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','title','status','opened_chapter','last_touched_chapter','payoff_window','is_main_mystery','stale','stale_since_chapter']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>10 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'title')<>'string' or pg_catalog.char_length(i->>'title') not between 5 and 120 or i->>'status' not in ('OPEN','DEVELOPING','PAYOFF_DUE','RESOLVED','ABANDONED_APPROVED') or pg_catalog.jsonb_typeof(i->'opened_chapter')<>'number' or (i->>'opened_chapter')::numeric<>pg_catalog.trunc((i->>'opened_chapter')::numeric) or (i->>'opened_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'last_touched_chapter')<>'number' or (i->>'last_touched_chapter')::numeric<>pg_catalog.trunc((i->>'last_touched_chapter')::numeric) or (i->>'last_touched_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'payoff_window') not in ('number','null') or (pg_catalog.jsonb_typeof(i->'payoff_window')='number' and ((i->>'payoff_window')::numeric<>pg_catalog.trunc((i->>'payoff_window')::numeric) or (i->>'payoff_window')::numeric not between 1 and 50)) or pg_catalog.jsonb_typeof(i->'is_main_mystery')<>'boolean' or pg_catalog.jsonb_typeof(i->'stale')<>'boolean' or pg_catalog.jsonb_typeof(i->'stale_since_chapter') not in ('number','null') or (pg_catalog.jsonb_typeof(i->'stale_since_chapter')='number' and ((i->>'stale_since_chapter')::numeric<>pg_catalog.trunc((i->>'stale_since_chapter')::numeric) or (i->>'stale_since_chapter')::numeric not between 1 and 50)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_blueprints) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','chapter_number','version','phase','chapter_goal','mandatory_beats','forbidden_reveals','allowed_state_delta','introduces_characters','reconciled_from_version','reconciliation_reason']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>11 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'chapter_number')<>'number' or (i->>'chapter_number')::numeric<>pg_catalog.trunc((i->>'chapter_number')::numeric) or (i->>'chapter_number')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'version')<>'number' or (i->>'version')::numeric<>pg_catalog.trunc((i->>'version')::numeric) or (i->>'version')::numeric not between 1 and 1000 or pg_catalog.jsonb_typeof(i->'phase')<>'string' or pg_catalog.char_length(i->>'phase') not between 1 and 120 or pg_catalog.jsonb_typeof(i->'chapter_goal')<>'string' or pg_catalog.char_length(i->>'chapter_goal') not between 1 and 500 or pg_catalog.jsonb_typeof(i->'mandatory_beats')<>'array' or pg_catalog.jsonb_array_length(i->'mandatory_beats')>50 or pg_catalog.jsonb_typeof(i->'forbidden_reveals')<>'array' or pg_catalog.jsonb_array_length(i->'forbidden_reveals')>500 or pg_catalog.jsonb_typeof(i->'allowed_state_delta')<>'object' or i->'allowed_state_delta' <> '{}'::jsonb or pg_catalog.jsonb_typeof(i->'introduces_characters')<>'array' or pg_catalog.jsonb_array_length(i->'introduces_characters')>100 or pg_catalog.jsonb_typeof(i->'reconciled_from_version') not in ('number','null') or (pg_catalog.jsonb_typeof(i->'reconciled_from_version')='number' and ((i->>'reconciled_from_version')::numeric<>pg_catalog.trunc((i->>'reconciled_from_version')::numeric) or (i->>'reconciled_from_version')::numeric not between 1 and 1000)) or pg_catalog.jsonb_typeof(i->'reconciliation_reason') not in ('string','null') or (pg_catalog.jsonb_typeof(i->'reconciliation_reason')='string' and pg_catalog.char_length(i->>'reconciliation_reason') not between 1 and 500) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'mandatory_beats') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 500) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'forbidden_reveals') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 256) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'introduces_characters') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 256))
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON_ROW';
  end if;

  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_character_ids from pg_catalog.jsonb_array_elements(p_characters) item;
  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_fact_ids from pg_catalog.jsonb_array_elements(p_facts) item;
  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_secret_ids from pg_catalog.jsonb_array_elements(p_secrets) item;
  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_thread_ids from pg_catalog.jsonb_array_elements(p_threads) item;

  if (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_character_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct pg_catalog.lower(item->>'alias')) from pg_catalog.jsonb_array_elements(p_character_aliases) item)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'character_id') from pg_catalog.jsonb_array_elements(p_voice_sheets) item)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_fact_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct (item->>'character_id',item->>'fact_id')) from pg_catalog.jsonb_array_elements(p_knowledge) item)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_secret_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_thread_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'chapter_number') from pg_catalog.jsonb_array_elements(p_blueprints) item)
  then
    raise exception using errcode = '22023', message = 'DUPLICATE_CANON_ROW';
  end if;

  if exists (select 1 from pg_catalog.jsonb_array_elements(p_character_aliases) i where not ((i->>'character_id')=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_voice_sheets) i where not ((i->>'character_id')=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_facts) i where pg_catalog.jsonb_typeof(i->'subject_character_id')='string' and not ((i->>'subject_character_id')=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_knowledge) i where not ((i->>'character_id')=any(v_character_ids)) or not ((i->>'fact_id')=any(v_fact_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_blueprints) i cross join lateral pg_catalog.jsonb_array_elements_text(i->'introduces_characters') ref where not(ref=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_blueprints) i cross join lateral pg_catalog.jsonb_array_elements_text(i->'forbidden_reveals') ref where not(ref=any(v_secret_ids)))
  then
    raise exception using errcode = '22023', message = 'NONLOCAL_CANON_REFERENCE';
  end if;

  v_payload_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source',p_contract_source,'onboarding',p_onboarding_json,'contract',p_story_contract_json,
    'route',p_route_schema_json,'debts',p_plot_debts_json,'endings',p_ending_candidates_json,
    'characters',p_characters,'aliases',p_character_aliases,'voices',p_voice_sheets,
    'facts',p_facts,'knowledge',p_knowledge,'secrets',p_secrets,'threads',p_threads,
    'blueprints',p_blueprints
  )::text);

  -- Existing shell is mandatory. Row lock serializes first write and retries.
  select s.* into v_story from public.stories s where s.id=p_story_id for update;
  if not found then raise exception using errcode='P0001', message='STORY_SHELL_NOT_FOUND'; end if;
  if v_story.owner_user_id is null or v_story.owner_user_id is distinct from p_owner_user_id then raise exception using errcode='42501', message='STORY_OWNER_MISMATCH'; end if;
  if v_story.story_mode is distinct from 'personalized_ai' then raise exception using errcode='22023', message='INVALID_STORY_MODE'; end if;
  if v_story.visibility is distinct from 'private' then raise exception using errcode='22023', message='STORY_NOT_PRIVATE'; end if;
  if v_story.status is distinct from 'BARU' or v_story.current_chapter <> 0 or v_story.generation_status not in ('creating_contract','failed') then raise exception using errcode='55000', message='STORY_LIFECYCLE_STARTED'; end if;

  if exists(select 1 from public.chapters where story_id=p_story_id)
    or exists(select 1 from public.reader_states where story_id=p_story_id)
    or exists(select 1 from public.generation_leases where story_id=p_story_id)
    or exists(select 1 from public.story_events where story_id=p_story_id)
    or exists(select 1 from public.retrieval_logs where story_id=p_story_id)
  then
    raise exception using errcode='55000', message='STORY_GENERATION_STARTED';
  end if;

  if exists(select 1 from public.story_generation_contracts where story_id=p_story_id) then
    if (select bootstrap_payload_hash from public.story_generation_contracts where story_id=p_story_id) is distinct from v_payload_hash then
      raise exception using errcode='23000', message='BOOTSTRAP_PAYLOAD_MISMATCH';
    end if;
    return;
  end if;

  -- Reject globally keyed IDs owned by another story before first canon write.
  if exists(select 1 from public.characters c where c.id=any(v_character_ids))
    or exists(select 1 from public.facts_ledger f where f.id=any(v_fact_ids))
    or exists(select 1 from public.secrets_reveals s where s.id=any(v_secret_ids))
    or exists(select 1 from public.story_threads t where t.id=any(v_thread_ids))
  then raise exception using errcode='22023', message='CANON_ID_ALREADY_EXISTS'; end if;

  insert into public.story_generation_contracts(
    story_id,mode,total_chapters,contract_source,onboarding_json,story_contract_json,
    route_schema_json,plot_debts_json,ending_candidates_json,ending_lock_json,
    quality_profile,bootstrap_payload_hash,story_contract_version
  ) values (
    p_story_id,'personalized_ai',50,p_contract_source,p_onboarding_json,p_story_contract_json,
    p_route_schema_json,p_plot_debts_json,p_ending_candidates_json,null,
    'lakoku_mobile_drama_v1',v_payload_hash,v_story.story_contract_version
  );

  insert into public.characters(id,story_id,canonical_name,role,motivation,introduced_chapter)
  select x.id,x.story_id,x.canonical_name,x.role,x.motivation,x.introduced_chapter from pg_catalog.jsonb_to_recordset(p_characters) x(id text,story_id text,canonical_name text,role text,motivation text,introduced_chapter integer);
  insert into public.character_states(character_id,as_of_chapter,status,attributes)
  select x.id,x.introduced_chapter,'ALIVE','{}'::jsonb from pg_catalog.jsonb_to_recordset(p_characters) x(id text,introduced_chapter integer);
  insert into public.character_aliases(story_id,character_id,alias,alias_type)
  select x.story_id,x.character_id,x.alias,x.alias_type from pg_catalog.jsonb_to_recordset(p_character_aliases) x(story_id text,character_id text,alias text,alias_type text);
  insert into public.character_voice_sheets(story_id,character_id,register,speech_habits,forbidden_words,sample_lines)
  select x.story_id,x.character_id,x.register,x.speech_habits,x.forbidden_words,x.sample_lines from pg_catalog.jsonb_to_recordset(p_voice_sheets) x(story_id text,character_id text,register text,speech_habits jsonb,forbidden_words jsonb,sample_lines jsonb);
  insert into public.facts_ledger(id,story_id,statement,subject_character_id,established_chapter,salience,load_bearing,paid_off)
  select x.id,x.story_id,x.statement,x.subject_character_id,x.established_chapter,x.salience,x.load_bearing,x.paid_off from pg_catalog.jsonb_to_recordset(p_facts) x(id text,story_id text,statement text,subject_character_id text,established_chapter integer,salience real,load_bearing boolean,paid_off boolean);
  insert into public.knowledge_scopes(story_id,character_id,fact_id,known_from_chapter)
  select x.story_id,x.character_id,x.fact_id,x.known_from_chapter from pg_catalog.jsonb_to_recordset(p_knowledge) x(story_id text,character_id text,fact_id text,known_from_chapter integer);
  insert into public.secrets_reveals(id,story_id,description,reveal_gate_chapter,revealed)
  select x.id,x.story_id,x.description,x.reveal_gate_chapter,x.revealed from pg_catalog.jsonb_to_recordset(p_secrets) x(id text,story_id text,description text,reveal_gate_chapter integer,revealed boolean);
  insert into public.story_threads(id,story_id,title,status,opened_chapter,last_touched_chapter,payoff_window,is_main_mystery,stale,stale_since_chapter)
  select x.id,x.story_id,x.title,x.status,x.opened_chapter,x.last_touched_chapter,x.payoff_window,x.is_main_mystery,x.stale,x.stale_since_chapter from pg_catalog.jsonb_to_recordset(p_threads) x(id text,story_id text,title text,status text,opened_chapter integer,last_touched_chapter integer,payoff_window integer,is_main_mystery boolean,stale boolean,stale_since_chapter integer);
  insert into public.chapter_blueprints(story_id,chapter_number,version,phase,chapter_goal,mandatory_beats,forbidden_reveals,allowed_state_delta,introduces_characters,reconciled_from_version,reconciliation_reason)
  select x.story_id,x.chapter_number,x.version,x.phase,x.chapter_goal,x.mandatory_beats,x.forbidden_reveals,x.allowed_state_delta,x.introduces_characters,x.reconciled_from_version,x.reconciliation_reason from pg_catalog.jsonb_to_recordset(p_blueprints) x(story_id text,chapter_number integer,version integer,phase text,chapter_goal text,mandatory_beats jsonb,forbidden_reveals jsonb,allowed_state_delta jsonb,introduces_characters jsonb,reconciled_from_version integer,reconciliation_reason text);
end;
$$;

revoke all on function public.bootstrap_personalized_story_v1(
  text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.bootstrap_personalized_story_v1(
  text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

comment on function public.bootstrap_personalized_story_v1(
  text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) is
  'Bootstrap personalized story contract and initial canon. Copy version from stories.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Update clone_premium_story_instance for contract version compatibility
-- ──────────────────────────────────────────────────────────────────────────────
-- With public.story_generation_contracts.story_contract_version now NOT NULL,
-- cloning must populate this column by copying the source contract's version.

create or replace function public.clone_premium_story_instance(
  p_template_story_id text,
  p_user_id uuid,
  p_new_story_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.stories%rowtype;
  v_source_found boolean;
  v_blueprint_count bigint;
  v_blueprint_distinct_count bigint;
  v_blueprint_min_chapter integer;
  v_blueprint_max_chapter integer;
  v_text_id_count bigint;
  v_distinct_text_id_count bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_character_old_ids text[];
  v_character_new_ids text[];
  v_fact_old_ids text[];
  v_fact_new_ids text[];
  v_secret_old_ids text[];
  v_secret_new_ids text[];
  v_thread_old_ids text[];
  v_thread_new_ids text[];
  v_old_ids text[];
  v_new_ids text[];
begin
  if p_template_story_id is null
    or p_template_story_id = ''
    or p_template_story_id <> pg_catalog.btrim(p_template_story_id)
    or p_new_story_id is null
    or p_new_story_id = ''
    or p_new_story_id <> pg_catalog.btrim(p_new_story_id)
    or pg_catalog.char_length(p_template_story_id) > 200
    or pg_catalog.char_length(p_new_story_id) > 128
    or p_template_story_id = p_new_story_id then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;

  if p_user_id is null
    or not exists (
      select 1
      from auth.users as users
      where users.id = p_user_id
    ) then
    raise exception using errcode = '22023', message = 'INVALID_OWNER';
  end if;

  -- Lock source before target. Source uses authoring RPC namespace; target uses clone namespace.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_template_story_id, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clone_premium_story_instance:' || p_new_story_id, 0)
  );

  select source.*
  into v_source
  from public.stories as source
  where source.id = p_template_story_id
  for share;
  v_source_found := found;

  select
    pg_catalog.count(*),
    pg_catalog.count(distinct blueprint.chapter_number),
    pg_catalog.min(blueprint.chapter_number),
    pg_catalog.max(blueprint.chapter_number)
  into
    v_blueprint_count,
    v_blueprint_distinct_count,
    v_blueprint_min_chapter,
    v_blueprint_max_chapter
  from public.chapter_blueprints as blueprint
  where blueprint.story_id = p_template_story_id;

  select pg_catalog.count(*), pg_catalog.count(distinct source_id)
  into v_text_id_count, v_distinct_text_id_count
  from (
    select character.id as source_id
    from public.characters as character
    where character.story_id = p_template_story_id
    union all
    select fact.id
    from public.facts_ledger as fact
    where fact.story_id = p_template_story_id
    union all
    select secret.id
    from public.secrets_reveals as secret
    where secret.story_id = p_template_story_id
    union all
    select thread.id
    from public.story_threads as thread
    where thread.story_id = p_template_story_id
  ) as remapped_source_ids;

  if not v_source_found
    or v_source.story_mode is distinct from 'premium_template'
    or v_source.visibility is distinct from 'public'
    or v_source.total_chapters is distinct from 50
    or not exists (
      select 1
      from public.story_generation_contracts as contract
      where contract.story_id = p_template_story_id
        and contract.mode = 'premium_template'
        and contract.total_chapters = 50
        and pg_catalog.jsonb_typeof(contract.story_contract_json) = 'object'
    )
    or v_blueprint_count <> 50
    or v_blueprint_distinct_count <> 50
    or v_blueprint_min_chapter <> 1
    or v_blueprint_max_chapter <> 50
    or v_text_id_count <> v_distinct_text_id_count
    or not public.clone_premium_story_curated_chapter_is_valid(p_template_story_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'INVALID_TEMPLATE');
  end if;

  select
    coalesce(
      pg_catalog.array_agg(character.id order by character.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':character:' || pg_catalog.md5(character.id)
        order by character.id
      ),
      array[]::text[]
    )
  into v_character_old_ids, v_character_new_ids
  from public.characters as character
  where character.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(fact.id order by fact.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':fact:' || pg_catalog.md5(fact.id)
        order by fact.id
      ),
      array[]::text[]
    )
  into v_fact_old_ids, v_fact_new_ids
  from public.facts_ledger as fact
  where fact.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(secret.id order by secret.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':secret:' || pg_catalog.md5(secret.id)
        order by secret.id
      ),
      array[]::text[]
    )
  into v_secret_old_ids, v_secret_new_ids
  from public.secrets_reveals as secret
  where secret.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(thread.id order by thread.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':thread:' || pg_catalog.md5(thread.id)
        order by thread.id
      ),
      array[]::text[]
    )
  into v_thread_old_ids, v_thread_new_ids
  from public.story_threads as thread
  where thread.story_id = p_template_story_id;

  v_old_ids := v_character_old_ids || v_fact_old_ids || v_secret_old_ids || v_thread_old_ids;
  v_new_ids := v_character_new_ids || v_fact_new_ids || v_secret_new_ids || v_thread_new_ids;

  insert into public.stories (
    id,
    title,
    cover,
    tagline,
    role,
    tropes,
    total_chapters,
    synopsis,
    status,
    current_chapter,
    jejak,
    ending_name,
    created_at,
    owner_user_id,
    visibility,
    source_story_id,
    story_mode,
    generation_status,
    story_contract_version
  ) values (
    p_new_story_id,
    v_source.title,
    v_source.cover,
    v_source.tagline,
    v_source.role,
    v_source.tropes,
    v_source.total_chapters,
    v_source.synopsis,
    'BARU',
    1,
    '[]'::jsonb,
    null,
    v_now,
    p_user_id,
    'private',
    p_template_story_id,
    'premium_instance',
    'ready',
    v_source.story_contract_version
  )
  on conflict (id) do nothing;

  if not found then
    raise exception using errcode = '23505', message = 'TARGET_STORY_EXISTS';
  end if;

  insert into public.story_generation_contracts (
    story_id,
    mode,
    total_chapters,
    contract_source,
    onboarding_json,
    story_contract_json,
    route_schema_json,
    plot_debts_json,
    ending_candidates_json,
    ending_lock_json,
    quality_profile,
    created_at,
    updated_at,
    story_contract_version
  )
  select
    p_new_story_id,
    'premium_instance',
    contract.total_chapters,
    contract.contract_source,
    public.clone_premium_story_remap_jsonb(contract.onboarding_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.story_contract_json, v_old_ids, v_new_ids)
      || pg_catalog.jsonb_build_object('storyId', p_new_story_id),
    public.clone_premium_story_remap_jsonb(contract.route_schema_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.plot_debts_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.ending_candidates_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.ending_lock_json, v_old_ids, v_new_ids),
    contract.quality_profile,
    v_now,
    v_now,
    contract.story_contract_version
  from public.story_generation_contracts as contract
  where contract.story_id = p_template_story_id;

  insert into public.characters (
    id,
    story_id,
    canonical_name,
    role,
    motivation,
    introduced_chapter,
    created_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(character.id),
    p_new_story_id,
    character.canonical_name,
    character.role,
    character.motivation,
    character.introduced_chapter,
    v_now
  from public.characters as character
  where character.story_id = p_template_story_id;

  insert into public.character_states (
    character_id,
    status,
    as_of_chapter,
    attributes,
    updated_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(state.character_id),
    state.status,
    state.as_of_chapter,
    public.clone_premium_story_remap_jsonb(state.attributes, v_old_ids, v_new_ids),
    v_now
  from public.character_states as state
  join public.characters as character
    on character.id = state.character_id
  where character.story_id = p_template_story_id;

  insert into public.character_aliases (
    story_id,
    character_id,
    alias,
    alias_type,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(alias.character_id),
    alias.alias,
    alias.alias_type,
    v_now
  from public.character_aliases as alias
  join public.characters as character
    on character.id = alias.character_id
  where character.story_id = p_template_story_id;

  insert into public.character_voice_sheets (
    story_id,
    character_id,
    register,
    speech_habits,
    forbidden_words,
    sample_lines,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(voice.character_id),
    voice.register,
    voice.speech_habits,
    voice.forbidden_words,
    voice.sample_lines,
    v_now
  from public.character_voice_sheets as voice
  join public.characters as character
    on character.id = voice.character_id
  where character.story_id = p_template_story_id;

  insert into public.facts_ledger (
    id,
    story_id,
    statement,
    subject_character_id,
    established_chapter,
    salience,
    load_bearing,
    paid_off,
    created_at
  )
  select
    p_new_story_id || ':fact:' || pg_catalog.md5(fact.id),
    p_new_story_id,
    fact.statement,
    case
      when fact.subject_character_id is null then null
      else p_new_story_id || ':character:' || pg_catalog.md5(fact.subject_character_id)
    end,
    fact.established_chapter,
    fact.salience,
    fact.load_bearing,
    fact.paid_off,
    v_now
  from public.facts_ledger as fact
  where fact.story_id = p_template_story_id;

  insert into public.knowledge_scopes (
    story_id,
    character_id,
    fact_id,
    known_from_chapter,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(scope.character_id),
    p_new_story_id || ':fact:' || pg_catalog.md5(scope.fact_id),
    scope.known_from_chapter,
    v_now
  from public.knowledge_scopes as scope
  join public.characters as character
    on character.id = scope.character_id
  join public.facts_ledger as fact
    on fact.id = scope.fact_id
  where character.story_id = p_template_story_id
    and fact.story_id = p_template_story_id;

  insert into public.secrets_reveals (
    id,
    story_id,
    description,
    reveal_gate_chapter,
    revealed,
    created_at
  )
  select
    p_new_story_id || ':secret:' || pg_catalog.md5(secret.id),
    p_new_story_id,
    secret.description,
    secret.reveal_gate_chapter,
    secret.revealed,
    v_now
  from public.secrets_reveals as secret
  where secret.story_id = p_template_story_id;

  insert into public.story_threads (
    id,
    story_id,
    title,
    status,
    opened_chapter,
    last_touched_chapter,
    payoff_window,
    is_main_mystery,
    stale,
    stale_since_chapter,
    created_at
  )
  select
    p_new_story_id || ':thread:' || pg_catalog.md5(thread.id),
    p_new_story_id,
    thread.title,
    thread.status,
    thread.opened_chapter,
    thread.last_touched_chapter,
    thread.payoff_window,
    thread.is_main_mystery,
    thread.stale,
    thread.stale_since_chapter,
    v_now
  from public.story_threads as thread
  where thread.story_id = p_template_story_id;

  insert into public.chapter_blueprints (
    story_id,
    chapter_number,
    version,
    phase,
    chapter_goal,
    mandatory_beats,
    forbidden_reveals,
    allowed_state_delta,
    introduces_characters,
    reconciled_from_version,
    reconciliation_reason,
    created_at
  )
  select
    p_new_story_id,
    blueprint.chapter_number,
    blueprint.version,
    blueprint.phase,
    blueprint.chapter_goal,
    public.clone_premium_story_remap_jsonb(blueprint.mandatory_beats, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.forbidden_reveals, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.allowed_state_delta, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.introduces_characters, v_old_ids, v_new_ids),
    blueprint.reconciled_from_version,
    blueprint.reconciliation_reason,
    v_now
  from public.chapter_blueprints as blueprint
  where blueprint.story_id = p_template_story_id;

  insert into public.timeline_events (
    story_id,
    chapter_number,
    ordinal,
    description,
    is_flashback,
    occurs_at,
    created_at
  )
  select
    p_new_story_id,
    event.chapter_number,
    event.ordinal,
    event.description,
    event.is_flashback,
    event.occurs_at,
    v_now
  from public.timeline_events as event
  where event.story_id = p_template_story_id;

  insert into public.act_rollups (
    story_id,
    act_number,
    summary,
    state_delta,
    covers_from_chapter,
    covers_to_chapter,
    created_at
  )
  select
    p_new_story_id,
    rollup.act_number,
    rollup.summary,
    public.clone_premium_story_remap_jsonb(rollup.state_delta, v_old_ids, v_new_ids),
    rollup.covers_from_chapter,
    rollup.covers_to_chapter,
    v_now
  from public.act_rollups as rollup
  where rollup.story_id = p_template_story_id;

  insert into public.chapters (
    story_id,
    number,
    title,
    paragraphs,
    choice_prompt,
    choices,
    created_at
  )
  select
    p_new_story_id,
    chapter.number,
    chapter.title,
    public.clone_premium_story_remap_jsonb(chapter.paragraphs, v_old_ids, v_new_ids),
    chapter.choice_prompt,
    public.clone_premium_story_remap_jsonb(chapter.choices, v_old_ids, v_new_ids),
    v_now
  from public.chapters as chapter
  where chapter.story_id = p_template_story_id
    and chapter.number = 1;

  insert into public.choice_outcomes (
    story_id,
    chapter_number,
    choice_id,
    consequence,
    next_chapter_number,
    is_ending,
    created_at,
    effect_json,
    choice_kind
  )
  select
    p_new_story_id,
    outcome.chapter_number,
    outcome.choice_id,
    public.clone_premium_story_remap_jsonb(outcome.consequence, v_old_ids, v_new_ids),
    outcome.next_chapter_number,
    outcome.is_ending,
    v_now,
    public.clone_premium_story_remap_jsonb(outcome.effect_json, v_old_ids, v_new_ids),
    outcome.choice_kind
  from public.choice_outcomes as outcome
  where outcome.story_id = p_template_story_id
    and outcome.chapter_number = 1;

  insert into public.reader_states (
    user_id,
    story_id,
    status,
    current_chapter,
    jejak,
    ending_name,
    updated_at,
    created_at,
    route_state,
    choice_history,
    locked_ending_key
  ) values (
    p_user_id,
    p_new_story_id,
    'BERJALAN',
    1,
    '[]'::jsonb,
    null,
    v_now,
    v_now,
    jsonb_build_object(
      'truth', 0,
      'risk', 0,
      'secrecy', 0,
      'empathy', 0,
      'trust', '{}'::jsonb,
      'evidence', '[]'::jsonb,
      'flags', '{}'::jsonb,
      'endingBias', '{}'::jsonb
    ),
    '[]'::jsonb,
    null
  );

  return pg_catalog.jsonb_build_object('ok', true, 'story_id', p_new_story_id);
end;
$$;

revoke all on function public.clone_premium_story_instance(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.clone_premium_story_instance(text, uuid, text)
  to service_role;

comment on function public.clone_premium_story_instance(text, uuid, text) is
  'Clone premium template instance. Copy version from source contract.';
