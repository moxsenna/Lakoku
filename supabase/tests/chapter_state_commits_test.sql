-- pgTAP tests for chapter_state_commits: append-only living-canon commit
-- ledger. Exactly one commit per (story, chapter), exactly one per committed
-- revision, committed = base + 1, DB-verified object delta hash, worker AND
-- sync provenance (nullable source_job_id), zero direct mutation grants.

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
-- Setup: owner auth user + story + generation job (FK targets)
-- ═══════════════════════════════════════════════════════════════════════════════

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '56000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'state-commits-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode,
                            living_canon_version, canon_state_revision)
values ('test:state-commits', 'Commits Test', '56000000-0000-4000-8000-000000000001',
        'private', 'personalized_ai', 1, 0);

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  '66666666-6666-4666-8666-666666666666',
  'test:state-commits', 3, '56000000-0000-4000-8000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp(), clock_timestamp() + interval '1 hour',
  gen_random_uuid(), 'generation-job:66666666-6666-4666-8666-666666666666:publish:3'
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Table structure
-- ═══════════════════════════════════════════════════════════════════════════════

select has_table('public', 'chapter_state_commits', 'commit ledger exists');

select has_column('public', 'chapter_state_commits', 'id', 'has id');
select has_column('public', 'chapter_state_commits', 'story_id', 'has story_id');
select has_column('public', 'chapter_state_commits', 'chapter_number', 'has chapter_number');
select has_column('public', 'chapter_state_commits', 'base_canon_revision', 'has base_canon_revision');
select has_column('public', 'chapter_state_commits', 'committed_canon_revision', 'has committed_canon_revision');
select has_column('public', 'chapter_state_commits', 'state_delta_json', 'has state_delta_json');
select has_column('public', 'chapter_state_commits', 'state_delta_schema_version', 'has state_delta_schema_version');
select has_column('public', 'chapter_state_commits', 'state_delta_hash', 'has state_delta_hash');
select has_column('public', 'chapter_state_commits', 'generation_mode', 'has generation_mode');
select has_column('public', 'chapter_state_commits', 'actor_user_id', 'has actor_user_id');
select has_column('public', 'chapter_state_commits', 'source_job_id', 'has source_job_id');
select has_column('public', 'chapter_state_commits', 'checkpoint_attempt_id', 'has checkpoint_attempt_id');
select has_column('public', 'chapter_state_commits', 'commit_version', 'has commit_version');
select has_column('public', 'chapter_state_commits', 'created_at', 'has created_at');

select col_is_null('public', 'chapter_state_commits', 'source_job_id', 'source_job_id nullable (sync path)');
select col_is_null('public', 'chapter_state_commits', 'actor_user_id', 'actor_user_id nullable');
select col_not_null('public', 'chapter_state_commits', 'checkpoint_attempt_id', 'checkpoint_attempt_id NOT NULL');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Inserts: worker path (source_job_id) and sync path (NULL source_job_id)
-- ═══════════════════════════════════════════════════════════════════════════════

select lives_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 3, 0, 1,
    '{"threads":{"touches":["t1"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t1"]}}'::jsonb),
    'personalized', '66666666-6666-4666-8666-666666666666',
    '66666666-6666-4666-8666-666666666665'
  )
$$, 'worker-path commit accepted');

select lives_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 4, 1, 2,
    '{"threads":{"touches":[]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":[]}}'::jsonb),
    'personalized', '56000000-0000-4000-8000-000000000001', NULL,
    '66666666-6666-4666-8666-666666666664'
  )
$$, 'sync-path commit with NULL source_job_id accepted');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Identity constraints
-- ═══════════════════════════════════════════════════════════════════════════════

-- Exactly one commit per chapter: same chapter, different revision → rejected.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 3, 2, 3,
    '{"threads":{"touches":["t2"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t2"]}}'::jsonb),
    'personalized', NULL, '66666666-6666-4666-8666-666666666663'
  )
$$, '23505', null, 'duplicate chapter with different revision rejected');

-- Exactly one commit per committed revision: same revision, different chapter → rejected.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 5, 1, 2,
    '{"threads":{"touches":["t3"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t3"]}}'::jsonb),
    'personalized', NULL, '66666666-6666-4666-8666-666666666662'
  )
$$, '23505', null, 'duplicate committed revision rejected');

-- Monotonic invariant: committed != base + 1 → rejected.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 6, 1, 3,
    '{"threads":{"touches":["t4"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t4"]}}'::jsonb),
    'personalized', NULL, '66666666-6666-4666-8666-666666666661'
  )
$$, '23514', null, 'committed revision must equal base + 1');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Delta contract
-- ═══════════════════════════════════════════════════════════════════════════════

-- Non-object delta rejected (explicit shape check — hash equality alone would
-- pass on NULL).
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 7, 2, 3,
    '[1,2]'::jsonb, 1,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'personalized', NULL, '66666666-6666-4666-8666-666666666660'
  )
$$, '23514', null, 'non-object state delta rejected');

-- Tampered hash rejected (DB recomputes).
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 8, 3, 4,
    '{"threads":{"touches":["t5"]}}'::jsonb, 1,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'personalized', NULL, '66666666-6666-4666-8666-666666666659'
  )
$$, '23514', null, 'caller-supplied hash mismatch rejected');

-- Delta schema version must be 1.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 9, 4, 5,
    '{"threads":{"touches":["t6"]}}'::jsonb, 2,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t6"]}}'::jsonb),
    'personalized', NULL, '66666666-6666-4666-8666-666666666658'
  )
$$, '23514', null, 'delta schema version 2 rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Envelope constraints
-- ═══════════════════════════════════════════════════════════════════════════════

-- chapter_number range.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 51, 5, 6,
    '{"threads":{"touches":["t7"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t7"]}}'::jsonb),
    'personalized', NULL, '66666666-6666-4666-8666-666666666657'
  )
$$, '23514', null, 'chapter_number out of range rejected');

-- generation_mode CHECK.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 10, 5, 6,
    '{"threads":{"touches":["t8"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t8"]}}'::jsonb),
    'bogus', NULL, '66666666-6666-4666-8666-666666666656'
  )
$$, '23514', null, 'generation_mode outside (standard, personalized) rejected');

-- commit_version must be 1.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id, commit_version
  ) values (
    'test:state-commits', 11, 6, 7,
    '{"threads":{"touches":["t9"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t9"]}}'::jsonb),
    'personalized', NULL, '66666666-6666-4666-8666-666666666655', 2
  )
$$, '23514', null, 'commit_version 2 rejected');

-- checkpoint_attempt_id NOT NULL.
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, source_job_id, checkpoint_attempt_id
  ) values (
    'test:state-commits', 12, 7, 8,
    '{"threads":{"touches":["t10"]}}'::jsonb, 1,
    public.chapter_state_delta_hash_v1('{"threads":{"touches":["t10"]}}'::jsonb),
    'personalized', NULL, NULL
  )
$$, '23502', null, 'null checkpoint_attempt_id rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Immutability + privileges
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  update public.chapter_state_commits
  set generation_mode = 'standard'
  where story_id = 'test:state-commits' and chapter_number = 3
$$, 'P0001', null, 'UPDATE rejected (STATE_COMMIT_IMMUTABLE trigger)');

select ok(not has_table_privilege('public', 'public.chapter_state_commits', 'INSERT'), 'public INSERT denied');
select ok(not has_table_privilege('anon', 'public.chapter_state_commits', 'INSERT'), 'anon INSERT denied');
select ok(not has_table_privilege('authenticated', 'public.chapter_state_commits', 'INSERT'), 'authenticated INSERT denied');
select ok(not has_table_privilege('service_role', 'public.chapter_state_commits', 'INSERT'), 'service_role direct INSERT denied');
select ok(not has_table_privilege('service_role', 'public.chapter_state_commits', 'UPDATE'), 'service_role direct UPDATE denied');
select ok(not has_table_privilege('service_role', 'public.chapter_state_commits', 'DELETE'), 'service_role direct DELETE denied');
select ok(not has_table_privilege('service_role', 'public.chapter_state_commits', 'TRUNCATE'), 'service_role direct TRUNCATE denied');
-- No ambient SELECT either: canonical/private state, direct access must not
-- rely on default ACLs.
select ok(not has_table_privilege('public', 'public.chapter_state_commits', 'SELECT'), 'public SELECT denied');
select ok(not has_table_privilege('anon', 'public.chapter_state_commits', 'SELECT'), 'anon SELECT denied');
select ok(not has_table_privilege('authenticated', 'public.chapter_state_commits', 'SELECT'), 'authenticated SELECT denied');
select ok(has_table_privilege('service_role', 'public.chapter_state_commits', 'SELECT'), 'service_role SELECT granted');

-- Defense in depth: RLS enabled, but ZERO policies (no anon/authenticated path).
select ok((select relrowsecurity from pg_catalog.pg_class
           where oid = 'public.chapter_state_commits'::regclass),
          'RLS enabled on commit ledger');
select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'chapter_state_commits'),
  0::bigint, 'zero RLS policies (no anon/auth direct access)');

select * from finish();
rollback;
