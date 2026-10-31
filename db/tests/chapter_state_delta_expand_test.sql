-- pgTAP tests for M10-A1b storage expand: stories capability columns,
-- chapter_state_delta_hash_v1 (DB-owned, domain-separated, invoker),
-- checkpoint V3 conditional contract, upsert_generation_checkpoint_fenced_v2
-- (capability + exact base + DB hash + delta provenance), and V1 regression
-- (V1 still writes schema 2 with all-NULL delta fields).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    perform set_config('lakoku.test_target', 'local-cli', true);
  end if;
end
$$;

select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════════
-- Setup: owner auth user + base story
-- ═══════════════════════════════════════════════════════════════════════════════

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '55000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'state-delta-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values ('test:state-delta-expand', 'Expand Test', '55000000-0000-4000-8000-000000000001',
        'private', 'personalized_ai');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. stories capability columns
-- ═══════════════════════════════════════════════════════════════════════════════

select has_column('public', 'stories', 'living_canon_version', 'stories has living_canon_version');
select col_not_null('public', 'stories', 'living_canon_version', 'living_canon_version is NOT NULL');
select col_default_is('public', 'stories', 'living_canon_version', '0', 'living_canon_version defaults to 0');
select has_column('public', 'stories', 'canon_state_revision', 'stories has canon_state_revision');
select col_not_null('public', 'stories', 'canon_state_revision', 'canon_state_revision is NOT NULL');
select col_default_is('public', 'stories', 'canon_state_revision', '0', 'canon_state_revision defaults to 0');

select lives_ok($$
  update public.stories set living_canon_version = 1
  where id = 'test:state-delta-expand'
$$, 'living_canon_version 1 accepted');
select throws_ok($$
  update public.stories set living_canon_version = 2
  where id = 'test:state-delta-expand'
$$, '23514', null, 'living_canon_version 2 rejected (capability fails closed)');
select lives_ok($$
  update public.stories set canon_state_revision = 5
  where id = 'test:state-delta-expand'
$$, 'canon_state_revision increment accepted (A1b provides, never increments itself)');
select throws_ok($$
  update public.stories set canon_state_revision = -1
  where id = 'test:state-delta-expand'
$$, '23514', null, 'negative canon_state_revision rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. chapter_state_delta_hash_v1 — DB-owned, invoker, immutable, domain-separated
-- ═══════════════════════════════════════════════════════════════════════════════

select has_function('public', 'chapter_state_delta_hash_v1', array['jsonb'], 'hash helper exists');
select function_returns('public', 'chapter_state_delta_hash_v1', array['jsonb'], 'text', 'hash helper returns text');
select ok(
  not coalesce((select prosecdef from pg_proc
                where oid = to_regprocedure('public.chapter_state_delta_hash_v1(jsonb)')), true),
  'hash helper is SECURITY INVOKER (no DEFINER)'
);
select is(
  (select provolatile from pg_proc
   where oid = to_regprocedure('public.chapter_state_delta_hash_v1(jsonb)')),
  'i', 'hash helper is IMMUTABLE'
);
select ok(not has_function_privilege('anon', 'public.chapter_state_delta_hash_v1(jsonb)', 'EXECUTE'), 'anon cannot execute hash helper');
select ok(not has_function_privilege('authenticated', 'public.chapter_state_delta_hash_v1(jsonb)', 'EXECUTE'), 'authenticated cannot execute hash helper');
select ok(has_function_privilege('service_role', 'public.chapter_state_delta_hash_v1(jsonb)', 'EXECUTE'), 'service_role can execute hash helper');

select ok(
  public.chapter_state_delta_hash_v1('{"threads":{"touches":["t1"]}}'::jsonb) ~ '^[0-9a-f]{64}$',
  'hash is 64 lowercase hex'
);
select is(
  public.chapter_state_delta_hash_v1('{"a":1,"b":2}'::jsonb),
  public.chapter_state_delta_hash_v1('{"b":2,"a":1}'::jsonb),
  'hash is key-order independent (jsonb canonical text)'
);
select isnt(
  public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{"a":1}', 'UTF8')), 'hex'),
  'hash is domain-separated (prefix changes digest)'
);
select ok(public.chapter_state_delta_hash_v1(null) is null, 'null delta hashes to null (legacy)');
select ok(public.chapter_state_delta_hash_v1('[1,2]'::jsonb) is null, 'non-object delta hashes to null');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. checkpoint delta columns + conditional schema-version CHECK
-- ═══════════════════════════════════════════════════════════════════════════════

select has_column('public', 'chapter_generation_checkpoints', 'state_delta_json', 'checkpoints have state_delta_json');
select col_is_null('public', 'chapter_generation_checkpoints', 'state_delta_json', 'state_delta_json nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'state_delta_schema_version', 'checkpoints have state_delta_schema_version');
select col_is_null('public', 'chapter_generation_checkpoints', 'state_delta_schema_version', 'state_delta_schema_version nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'state_delta_hash', 'checkpoints have state_delta_hash');
select col_is_null('public', 'chapter_generation_checkpoints', 'state_delta_hash', 'state_delta_hash nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'base_canon_revision', 'checkpoints have base_canon_revision');
select col_is_null('public', 'chapter_generation_checkpoints', 'base_canon_revision', 'base_canon_revision nullable for legacy rows');

-- Legacy v2 row with NULL delta fields stays writable (backward compatibility).
select lives_ok($$
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, checkpoint_schema_version, expires_at
  ) values (
    'test:state-delta-expand', 1, '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222221', 'PROSE_READY', 'Bab Legasi',
    '["Paragraf legasi."]'::jsonb, 'fp-legacy', 2, clock_timestamp() + interval '1 hour'
  )
$$, 'legacy v2 row with NULL delta fields accepted');

-- V3 row with complete delta accepted.
select lives_ok($$
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, checkpoint_schema_version, expires_at,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'test:state-delta-expand', 2, '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333331', 'PROSE_READY', 'Bab Kanon',
    '["Paragraf kanon."]'::jsonb, 'fp-canon', 3, clock_timestamp() + interval '1 hour',
    '{"threads":{"touches":["t1"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t1"]}}'::jsonb), 0
  )
$$, 'v3 row with complete delta accepted');

-- Caller-supplied hash that does not match DB recompute → rejected (23514).
select throws_ok($$
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, checkpoint_schema_version, expires_at,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'test:state-delta-expand', 3, '44444444-4444-4444-8444-444444444444',
    '44444444-4444-4444-8444-444444444441', 'PROSE_READY', 'Bab Palsu',
    '["Paragraf palsu."]'::jsonb, 'fp-forged', 3, clock_timestamp() + interval '1 hour',
    '{"threads":{"touches":["t1"]}}'::jsonb, 1,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0
  )
$$, '23514', null, 'caller-supplied hash mismatch rejected (DB recomputes)');

-- V3 row with non-object delta rejected even with valid-format hash
-- (explicit jsonb_typeof pins the NULL-semantics loophole).
select throws_ok($$
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, checkpoint_schema_version, expires_at,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'test:state-delta-expand', 4, '55555555-5555-4555-8555-555555555555',
    '55555555-5555-4555-8555-555555555551', 'PROSE_READY', 'Bab Array',
    '["Paragraf array."]'::jsonb, 'fp-array', 3, clock_timestamp() + interval '1 hour',
    '[1,2]'::jsonb, 1,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 0
  )
$$, '23514', null, 'v3 non-object delta rejected');

-- V3 row with negative base revision rejected.
select throws_ok($$
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, checkpoint_schema_version, expires_at,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    'test:state-delta-expand', 5, '66666666-6666-4666-8666-666666666666',
    '66666666-6666-4666-8666-666666666661', 'PROSE_READY', 'Bab Negatif',
    '["Paragraf negatif."]'::jsonb, 'fp-neg', 3, clock_timestamp() + interval '1 hour',
    '{"threads":{"touches":["t1"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t1"]}}'::jsonb), -1
  )
$$, '23514', null, 'v3 negative base revision rejected');

-- Legacy v2 row with delta fields set → rejected (branch 2 requires NULLs).
select throws_ok($$
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, checkpoint_schema_version, expires_at,
    state_delta_json
  ) values (
    'test:state-delta-expand', 6, '77777777-7777-4777-8777-777777777777',
    '77777777-7777-4777-8777-777777777771', 'PROSE_READY', 'Bab Bocor',
    '["Paragraf bocor."]'::jsonb, 'fp-bocor', 2, clock_timestamp() + interval '1 hour',
    '{"threads":{"touches":["t1"]}}'::jsonb
  )
$$, '23514', null, 'v2 row with delta fields rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. upsert_generation_checkpoint_fenced_v2 — signature, security, behavior
-- ═══════════════════════════════════════════════════════════════════════════════

select has_function(
  'public', 'upsert_generation_checkpoint_fenced_v2',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','integer','bigint','bigint','text','text','integer','integer','integer','jsonb','smallint','bigint'],
  'V2 has exact 21-param signature'
);
select function_returns(
  'public', 'upsert_generation_checkpoint_fenced_v2',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','integer','bigint','bigint','text','text','integer','integer','integer','jsonb','smallint','bigint'],
  'jsonb', 'V2 returns jsonb'
);
select ok(
  coalesce((select prosecdef from pg_proc
            where oid = to_regprocedure('public.upsert_generation_checkpoint_fenced_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint)')), false),
  'V2 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure('public.upsert_generation_checkpoint_fenced_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint)')),
  array['search_path=""']::text[], 'V2 hardens empty search_path (V1 convention)'
);
select ok(not has_function_privilege('anon', 'public.upsert_generation_checkpoint_fenced_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint)', 'EXECUTE'), 'anon cannot execute V2');
select ok(not has_function_privilege('authenticated', 'public.upsert_generation_checkpoint_fenced_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint)', 'EXECUTE'), 'authenticated cannot execute V2');
select ok(has_function_privilege('service_role', 'public.upsert_generation_checkpoint_fenced_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer,jsonb,smallint,bigint)', 'EXECUTE'), 'service_role can execute V2');

create temporary table state_delta_fixtures (
  fixture_name text primary key, job_id uuid not null, story_id text not null,
  worker_id text not null, claim_token uuid not null, lease_id uuid not null
) on commit drop;

create or replace function pg_temp.add_state_delta_job(
  p_fixture text, p_living_version integer default 1, p_revision bigint default 0,
  p_kind text default 'personalized'
) returns uuid language plpgsql as $$
declare
  v_job uuid := gen_random_uuid();
  v_story text := 'test:state-delta:' || p_fixture;
  v_worker text := 'worker:' || p_fixture;
  v_token uuid := gen_random_uuid();
  v_lease uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode,
                              living_canon_version, canon_state_revision)
  values (v_story, 'State delta ' || p_fixture, '55000000-0000-4000-8000-000000000001',
          'private', case when p_kind = 'personalized' then 'personalized_ai' else p_kind end,
          p_living_version, p_revision);
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, max_attempts, available_at, deadline_at, publication_idempotency_key,
    story_contract_version
  ) values (
    v_job, v_story, 2, '55000000-0000-4000-8000-000000000001', p_kind,
    'choice:' || p_fixture, 'QUEUED', 4, v_now - interval '1 minute',
    v_now + interval '20 minutes', 'generation-job:' || v_job::text || ':publish:2', 1
  );
  update public.generation_jobs
  set status = 'RUNNING', attempt_count = 1, worker_id = v_worker,
      claim_token = v_token, claimed_at = v_now - interval '2 seconds', heartbeat_at = v_now
  where id = v_job;
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (v_lease, v_story, 2, 'ACTIVE', v_worker, v_now + interval '10 minutes', v_job, v_token);
  insert into pg_temp.state_delta_fixtures values (p_fixture, v_job, v_story, v_worker, v_token, v_lease);
  return v_job;
end
$$;

create or replace function pg_temp.state_delta_upsert(
  p_fixture text, p_base bigint default 0,
  p_delta jsonb default '{"threads":{"touches":["t1"]}}'::jsonb,
  p_delta_schema smallint default 1
) returns jsonb language sql as $$
  select public.upsert_generation_checkpoint_fenced_v2(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Kanon', '["Paragraf kanon."]'::jsonb, 'prose-fingerprint-v3',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb, 1,
    7, 3, 'direction-fingerprint-v3', 'personalized', 1, 1, 2,
    p_delta, p_delta_schema, p_base
  ) from pg_temp.state_delta_fixtures f where f.fixture_name = p_fixture
$$;

-- Happy path: capability 1, revision 0, exact base 0 → UPDATED, schema 3, DB hash.
select pg_temp.add_state_delta_job('happy');
select is(pg_temp.state_delta_upsert('happy')->>'result', 'UPDATED', 'V2 happy path returns UPDATED');
select is(
  (select checkpoint_schema_version from public.chapter_generation_checkpoints
   where story_id = 'test:state-delta:happy'),
  3, 'V2 writes checkpoint_schema_version 3'
);
select is(
  (select state_delta_hash from public.chapter_generation_checkpoints
   where story_id = 'test:state-delta:happy'),
  public.chapter_state_delta_hash_v1('{"threads":{"touches":["t1"]}}'::jsonb),
  'V2 persists DB-computed hash (caller never supplies one)'
);
select is(
  (select base_canon_revision from public.chapter_generation_checkpoints
   where story_id = 'test:state-delta:happy'),
  0::bigint, 'V2 persists exact base revision'
);
select is(pg_temp.state_delta_upsert('happy')->>'result', 'UPDATED', 'identical replay stays UPDATED');
select is(
  (select count(*) from public.chapter_generation_checkpoints where story_id = 'test:state-delta:happy'),
  1::bigint, 'replay keeps one checkpoint row'
);

-- Capability: legacy story (version 0) → LIVING_CANON_NOT_ACTIVE, no mutation.
select pg_temp.add_state_delta_job('legacy', 0, 0);
select is(pg_temp.state_delta_upsert('legacy')->>'result', 'LIVING_CANON_NOT_ACTIVE', 'legacy story (capability 0) rejected');
select is(
  (select count(*) from public.chapter_generation_checkpoints where story_id = 'test:state-delta:legacy'),
  0::bigint, 'capability rejection causes no mutation'
);

-- Stale base: story revision 5, base 3 → STALE_CANON_REVISION.
select pg_temp.add_state_delta_job('revision', 1, 5);
select is(pg_temp.state_delta_upsert('revision', 3)->>'result', 'STALE_CANON_REVISION', 'stale base rejected');

-- Ahead base: story revision 5 base 7 → BASE_CANON_AHEAD; revision 0 base 1 → ahead.
select is(pg_temp.state_delta_upsert('revision', 7)->>'result', 'BASE_CANON_AHEAD', 'ahead base rejected');
select pg_temp.add_state_delta_job('ahead', 1, 0);
select is(pg_temp.state_delta_upsert('ahead', 1)->>'result', 'BASE_CANON_AHEAD', 'ahead base on revision 0 rejected');

-- Exact base on revision-5 story → success.
select is(pg_temp.state_delta_upsert('revision', 5)->>'result', 'UPDATED', 'exact current base accepted');

-- Replay provenance: different delta on same attempt → PROVENANCE_CONFLICT.
select pg_temp.add_state_delta_job('replay-delta');
select is(pg_temp.state_delta_upsert('replay-delta')->>'result', 'UPDATED', 'first upsert for replay-delta');
select is(
  pg_temp.state_delta_upsert('replay-delta', 0, '{"threads":{"touches":["t2"]}}'::jsonb)->>'result',
  'PROVENANCE_CONFLICT', 'different delta on replay rejected as provenance conflict'
);

-- Replay provenance: same delta but base changed after story advance → conflict.
select pg_temp.add_state_delta_job('replay-base', 1, 5);
select is(pg_temp.state_delta_upsert('replay-base', 5)->>'result', 'UPDATED', 'first upsert at base 5');
update public.stories set canon_state_revision = 6 where id = 'test:state-delta:replay-base';
select is(
  pg_temp.state_delta_upsert('replay-base', 6)->>'result',
  'PROVENANCE_CONFLICT', 'same delta with advanced base rejected as provenance conflict'
);

-- Payload raises (22023): delta schema version 2, non-object delta, negative base.
select pg_temp.add_state_delta_job('bad-schema');
select throws_ok($$
  select public.upsert_generation_checkpoint_fenced_v2(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Kanon', '["Paragraf kanon."]'::jsonb, 'prose-fingerprint-v3',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb, 1,
    7, 3, 'direction-fingerprint-v3', 'personalized', 1, 1, 2,
    '{"threads":{"touches":["t1"]}}'::jsonb, 2::smallint, 0::bigint
  ) from pg_temp.state_delta_fixtures f where f.fixture_name = 'bad-schema'
$$, '22023', null, 'delta schema version 2 rejected (22023)');

select pg_temp.add_state_delta_job('bad-shape');
select throws_ok($$
  select public.upsert_generation_checkpoint_fenced_v2(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Kanon', '["Paragraf kanon."]'::jsonb, 'prose-fingerprint-v3',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb, 1,
    7, 3, 'direction-fingerprint-v3', 'personalized', 1, 1, 2,
    '[1,2]'::jsonb, 1::smallint, 0::bigint
  ) from pg_temp.state_delta_fixtures f where f.fixture_name = 'bad-shape'
$$, '22023', null, 'non-object delta rejected (22023)');

select pg_temp.add_state_delta_job('bad-base');
select throws_ok($$
  select public.upsert_generation_checkpoint_fenced_v2(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Kanon', '["Paragraf kanon."]'::jsonb, 'prose-fingerprint-v3',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb, 1,
    7, 3, 'direction-fingerprint-v3', 'personalized', 1, 1, 2,
    '{"threads":{"touches":["t1"]}}'::jsonb, 1::smallint, (-1)::bigint
  ) from pg_temp.state_delta_fixtures f where f.fixture_name = 'bad-base'
$$, '22023', null, 'negative base rejected (22023)');

-- V2 is the V3 writer: standard-mode job rejected (mode mismatch raise).
select pg_temp.add_state_delta_job('standard', 1, 0, 'standard');
select throws_ok($$
  select public.upsert_generation_checkpoint_fenced_v2(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Kanon', '["Paragraf kanon."]'::jsonb, 'prose-fingerprint-v3',
    null, null,
    7, 3, 'direction-fingerprint-v3', 'standard', 1, 1, 2,
    '{"threads":{"touches":["t1"]}}'::jsonb, 1::smallint, 0::bigint
  ) from pg_temp.state_delta_fixtures f where f.fixture_name = 'standard'
$$, '22023', null, 'standard-mode job rejected for V2 (22023)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. V1 regression — 18-param V1 still writes schema 2 with all-NULL deltas
-- ═══════════════════════════════════════════════════════════════════════════════

select pg_temp.add_state_delta_job('v1-regression', 1, 0);
select is(
  (select public.upsert_generation_checkpoint_fenced_v1(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Lama', '["Paragraf lama."]'::jsonb, 'prose-fingerprint-v1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb, 1,
    7, 3, 'direction-fingerprint-v1', 'personalized', 1, 1, 2
  )->>'result' from pg_temp.state_delta_fixtures f where f.fixture_name = 'v1-regression'),
  'UPDATED', 'V1 upsert still works on personalized job'
);
select is(
  (select checkpoint_schema_version from public.chapter_generation_checkpoints
   where story_id = 'test:state-delta:v1-regression'),
  2, 'V1 still writes checkpoint_schema_version 2'
);
select is(
  (select row(state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision)::text
   from public.chapter_generation_checkpoints where story_id = 'test:state-delta:v1-regression'),
  row(null, null, null, null)::text,
  'V1 rows keep all-NULL delta fields'
);

select * from finish();
rollback;
