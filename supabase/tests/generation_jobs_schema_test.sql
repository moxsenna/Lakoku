begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation jobs schema tests require local-cli';
  end if;
end
$$;

select plan(80);

-- Exact schema, indexes, RLS, grants, and trigger-function security.
select has_table('public', 'generation_jobs', 'generation_jobs exists');
select has_table('public', 'generation_job_attempts', 'generation_job_attempts exists');
select columns_are(
  'public', 'generation_jobs',
  array[
    'id', 'story_id', 'chapter_number', 'user_id', 'generation_kind',
    'trigger_choice_id', 'status', 'attempt_count', 'max_attempts',
    'available_at', 'deadline_at', 'claimed_at', 'heartbeat_at', 'worker_id',
    'claim_token', 'correlation_id', 'last_error_code', 'last_error_class',
    'last_error_at', 'created_at', 'updated_at', 'completed_at',
    'publication_idempotency_key', 'publication_result'
  ],
  'generation_jobs has exact columns'
);
select columns_are(
  'public', 'generation_job_attempts',
  array[
    'id', 'job_id', 'correlation_id', 'story_id', 'chapter_number',
    'attempt_number', 'workflow_phase', 'provider_id', 'model_id', 'started_at',
    'ended_at', 'elapsed_ms', 'lease_age_ms', 'lease_remaining_ms',
    'retry_decision', 'error_code', 'worker_id', 'created_at'
  ],
  'generation_job_attempts has exact sanitized columns'
);
select has_index('public', 'generation_jobs', 'generation_jobs_one_active_target_idx', 'active target index exists');
select has_index('public', 'generation_jobs', 'generation_jobs_claim_idx', 'claim index exists');
select has_index('public', 'generation_jobs', 'generation_jobs_stale_idx', 'stale index exists');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_jobs'::regclass), 'generation_jobs has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_job_attempts'::regclass), 'generation_job_attempts has RLS');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('generation_jobs', 'generation_job_attempts')
  ),
  'generation job tables expose no RLS policies'
);
select ok(
  not has_table_privilege('anon', 'public.generation_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.generation_jobs', 'SELECT')
    and not has_table_privilege('anon', 'public.generation_job_attempts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.generation_job_attempts', 'SELECT'),
  'anon and authenticated have no effective read access'
);
select ok(
  not exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'public.generation_jobs'::regclass and acl.grantee = 0
  ),
  'PUBLIC has no generation_jobs privileges'
);
select ok(
  not has_table_privilege('anon', 'public.generation_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon has no generation_jobs privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.generation_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated has no generation_jobs privileges'
);
select ok(
  has_table_privilege('service_role', 'public.generation_jobs', 'SELECT'),
  'service_role can select generation_jobs'
);
select ok(
  has_table_privilege('service_role', 'public.generation_jobs', 'INSERT'),
  'service_role can insert generation_jobs'
);
select ok(
  has_table_privilege('service_role', 'public.generation_jobs', 'UPDATE'),
  'service_role can update generation_jobs'
);
select ok(
  not has_table_privilege('service_role', 'public.generation_jobs', 'DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'service_role has no extra generation_jobs privileges'
);
select ok(
  not exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'public.generation_job_attempts'::regclass and acl.grantee = 0
  ),
  'PUBLIC has no generation_job_attempts privileges'
);
select ok(
  not has_table_privilege('anon', 'public.generation_job_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon has no generation_job_attempts privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.generation_job_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated has no generation_job_attempts privileges'
);
select ok(
  has_table_privilege('service_role', 'public.generation_job_attempts', 'SELECT'),
  'service_role can select generation_job_attempts'
);
select ok(
  has_table_privilege('service_role', 'public.generation_job_attempts', 'INSERT'),
  'service_role can insert generation_job_attempts'
);
select ok(
  not has_table_privilege('service_role', 'public.generation_job_attempts', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'service_role has no extra generation_job_attempts privileges'
);
select has_function('public', 'generation_jobs_enforce_state_v1', array[]::text[], 'job state trigger function exists');
select has_function('public', 'generation_job_attempts_enforce_identity_v1', array[]::text[], 'attempt identity trigger function exists');
select ok(
  not (select prosecdef from pg_proc where oid = 'public.generation_jobs_enforce_state_v1()'::regprocedure),
  'job state trigger is SECURITY INVOKER'
);
select ok(
  not (select prosecdef from pg_proc where oid = 'public.generation_job_attempts_enforce_identity_v1()'::regprocedure),
  'attempt identity trigger is SECURITY INVOKER'
);
select is(
  (select proconfig from pg_proc where oid = 'public.generation_jobs_enforce_state_v1()'::regprocedure),
  array['search_path=""']::text[],
  'job state trigger fixes empty search_path'
);
select is(
  (select proconfig from pg_proc where oid = 'public.generation_job_attempts_enforce_identity_v1()'::regprocedure),
  array['search_path=""']::text[],
  'attempt identity trigger fixes empty search_path'
);
select ok(
  not has_function_privilege('public', 'public.generation_jobs_enforce_state_v1()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.generation_jobs_enforce_state_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.generation_jobs_enforce_state_v1()', 'EXECUTE'),
  'PUBLIC, anon, and authenticated cannot execute job state trigger function'
);
select ok(
  not has_function_privilege('public', 'public.generation_job_attempts_enforce_identity_v1()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.generation_job_attempts_enforce_identity_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.generation_job_attempts_enforce_identity_v1()', 'EXECUTE'),
  'PUBLIC, anon, and authenticated cannot execute attempt identity trigger function'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generation_job_attempts'
      and column_name in ('prompt', 'prose', 'response_body', 'token', 'secret', 'metadata')
  ),
  'attempt telemetry excludes forbidden payload columns'
);
select has_trigger('public', 'generation_jobs', 'generation_jobs_enforce_state_v1_trigger', 'job state trigger exists');
select has_trigger('public', 'generation_job_attempts', 'generation_job_attempts_enforce_identity_v1_trigger', 'attempt identity trigger exists');
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.generation_jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%publication_idempotency_key%generation-job:%:publish:%chapter_number%'
  ),
  'publication key has deterministic exact check'
);
select has_index('public', 'generation_job_attempts', 'generation_job_attempts_identity_key', 'attempt identity uniqueness exists');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_job_attempts'::regclass
      and contype = 'f' and confrelid = 'public.generation_jobs'::regclass
  ),
  'attempts reference parent job'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_jobs'::regclass
      and contype = 'f' and confrelid = 'public.stories'::regclass
  ),
  'jobs reference stories'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_jobs'::regclass
      and contype = 'f' and confrelid = 'auth.users'::regclass
  ),
  'jobs reference auth users'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'generation-job-owner@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp()),
  ('31000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'generation-job-other@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp())
on conflict (id) do nothing;

insert into public.stories (id, title)
values
  ('test:generation-job', 'Generation Job Fixture'),
  ('test:generation-job-other', 'Generation Job Other Fixture')
on conflict (id) do nothing;

create temporary table test_generation_jobs (
  fixture_name text primary key,
  job_id uuid not null
) on commit drop;

create or replace function pg_temp.add_queued_job(
  p_fixture_name text,
  p_overdue boolean default false,
  p_with_ownership boolean default false,
  p_chapter_number integer default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
  v_chapter_number integer;
  v_created_at timestamptz := case when p_overdue then clock_timestamp() - interval '2 hours' else clock_timestamp() end;
  v_deadline_at timestamptz := case when p_overdue then clock_timestamp() - interval '1 hour' else clock_timestamp() + interval '20 minutes' end;
begin
  select coalesce(p_chapter_number, 10 + count(*)::integer)
  into v_chapter_number
  from pg_temp.test_generation_jobs;
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, attempt_count, max_attempts, available_at, deadline_at,
    claimed_at, heartbeat_at, worker_id, claim_token, correlation_id,
    created_at, updated_at, publication_idempotency_key
  ) values (
    v_id, 'test:generation-job', v_chapter_number, '31000000-0000-4000-8000-000000000001',
    'standard', 'choice-a', 'QUEUED', 0, 4, v_created_at, v_deadline_at,
    case when p_with_ownership then v_created_at else null end,
    case when p_with_ownership then v_created_at else null end,
    case when p_with_ownership then 'worker-invalid' else null end,
    case when p_with_ownership then gen_random_uuid() else null end,
    gen_random_uuid(), v_created_at, v_created_at,
    'generation-job:' || v_id::text || ':publish:' || v_chapter_number::text
  );
  insert into pg_temp.test_generation_jobs (fixture_name, job_id) values (p_fixture_name, v_id);
  return v_id;
end;
$$;

create or replace function pg_temp.job_id(p_fixture_name text)
returns uuid
language sql
stable
as $$
  select job_id from pg_temp.test_generation_jobs where fixture_name = p_fixture_name;
$$;

create or replace function pg_temp.assert_identity_immutable(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    format('update public.generation_jobs set id = %L where id = %L', gen_random_uuid(), p_job_id),
    format('update public.generation_jobs set story_id = %L where id = %L', 'test:generation-job-other', p_job_id),
    format('update public.generation_jobs set chapter_number = 3 where id = %L', p_job_id),
    format('update public.generation_jobs set user_id = %L where id = %L', '31000000-0000-4000-8000-000000000002', p_job_id),
    format('update public.generation_jobs set generation_kind = %L where id = %L', 'personalized', p_job_id),
    format('update public.generation_jobs set trigger_choice_id = %L where id = %L', 'choice-b', p_job_id),
    format('update public.generation_jobs set max_attempts = 5 where id = %L', p_job_id),
    format('update public.generation_jobs set deadline_at = deadline_at + interval %L where id = %L', '1 minute', p_job_id),
    format('update public.generation_jobs set correlation_id = %L where id = %L', gen_random_uuid(), p_job_id),
    format('update public.generation_jobs set created_at = created_at - interval %L where id = %L', '1 minute', p_job_id),
    format('update public.generation_jobs set publication_idempotency_key = %L where id = %L', 'wrong-key', p_job_id)
  ] loop
    begin
      execute v_sql;
      raise exception 'identity mutation unexpectedly succeeded';
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'IMMUTABLE_GENERATION_JOB_IDENTITY' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

create or replace function pg_temp.assert_running_ownership_required(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_column text;
begin
  foreach v_column in array array['worker_id', 'claim_token', 'claimed_at', 'heartbeat_at'] loop
    begin
      execute format('update public.generation_jobs set %I = null where id = %L', v_column, p_job_id);
      raise exception 'running ownership omission unexpectedly succeeded';
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'GENERATION_JOB_RUNNING_OWNERSHIP_REQUIRED' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

create or replace function pg_temp.assert_running_identity_stable(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    format('update public.generation_jobs set worker_id = %L where id = %L', 'worker-other', p_job_id),
    format('update public.generation_jobs set claim_token = %L where id = %L', gen_random_uuid(), p_job_id),
    format('update public.generation_jobs set claimed_at = claimed_at + interval %L where id = %L', '1 second', p_job_id)
  ] loop
    begin
      execute v_sql;
      raise exception 'running identity mutation unexpectedly succeeded';
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'IMMUTABLE_GENERATION_JOB_OWNERSHIP' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

create or replace function pg_temp.assert_attempt_identity(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_sql text;
  v_started_at timestamptz := clock_timestamp();
begin
  foreach v_sql in array array[
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at) select id,%L,story_id,chapter_number,1,%L,%L from public.generation_jobs where id=%L', gen_random_uuid(), 'IDENTITY', v_started_at, p_job_id),
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at) select id,correlation_id,%L,chapter_number,1,%L,%L from public.generation_jobs where id=%L', 'test:generation-job-other', 'IDENTITY', v_started_at + interval '1 second', p_job_id),
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at) select id,correlation_id,story_id,3,1,%L,%L from public.generation_jobs where id=%L', 'IDENTITY', v_started_at + interval '2 seconds', p_job_id)
  ] loop
    begin
      execute v_sql;
      raise exception 'attempt identity mismatch unexpectedly succeeded';
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'GENERATION_JOB_ATTEMPT_IDENTITY_MISMATCH' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

create or replace function pg_temp.assert_attempt_timing_checks(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_sql text;
  v_started_at timestamptz := clock_timestamp() + interval '1 hour';
begin
  foreach v_sql in array array[
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at,ended_at) select id,correlation_id,story_id,chapter_number,1,%L,%L,%L from public.generation_jobs where id=%L', 'TIMING_END', v_started_at, v_started_at - interval '1 second', p_job_id),
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at,elapsed_ms) select id,correlation_id,story_id,chapter_number,1,%L,%L,-1 from public.generation_jobs where id=%L', 'TIMING_ELAPSED', v_started_at + interval '1 second', p_job_id),
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at,lease_age_ms) select id,correlation_id,story_id,chapter_number,1,%L,%L,-1 from public.generation_jobs where id=%L', 'TIMING_AGE', v_started_at + interval '2 seconds', p_job_id),
    format('insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at,lease_remaining_ms) select id,correlation_id,story_id,chapter_number,1,%L,%L,-1 from public.generation_jobs where id=%L', 'TIMING_REMAINING', v_started_at + interval '3 seconds', p_job_id)
  ] loop
    begin
      execute v_sql;
      raise exception 'invalid attempt timing unexpectedly succeeded';
    exception
      when check_violation then null;
    end;
  end loop;
end;
$$;

create or replace function pg_temp.assert_invalid_initial_status(p_status text, p_chapter_number integer)
returns void
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  begin
    insert into public.generation_jobs (
      id, story_id, chapter_number, user_id, generation_kind, status, deadline_at,
      publication_idempotency_key
    ) values (
      v_id, 'test:generation-job', p_chapter_number,
      '31000000-0000-4000-8000-000000000001', 'standard', p_status,
      clock_timestamp() + interval '20 minutes',
      'generation-job:' || v_id::text || ':publish:' || p_chapter_number::text
    );
    raise exception 'invalid initial status unexpectedly succeeded';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'INVALID_GENERATION_JOB_INITIAL_STATE' then
        raise;
      end if;
  end;
end;
$$;

create or replace function pg_temp.assert_dirty_queue_inserts_rejected()
returns void
language plpgsql
as $$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    'attempt_count = 1',
    'claimed_at = clock_timestamp()',
    'heartbeat_at = clock_timestamp()',
    'worker_id = ''worker-dirty''',
    'claim_token = gen_random_uuid()',
    'completed_at = clock_timestamp()',
    'publication_result = ''{"ok":true}''::jsonb',
    'last_error_code = ''DIRTY''',
    'last_error_class = ''DIRTY''',
    'last_error_at = clock_timestamp()'
  ] loop
    begin
      execute format(
        'insert into public.generation_jobs (id,story_id,chapter_number,user_id,generation_kind,status,deadline_at,publication_idempotency_key,%s) select v.id,%L,45,%L,%L,%L,clock_timestamp()+interval %L,%L||v.id::text||%L,%s from (select gen_random_uuid() id) v',
        split_part(v_sql, ' = ', 1),
        'test:generation-job', '31000000-0000-4000-8000-000000000001', 'standard', 'QUEUED',
        '20 minutes', 'generation-job:', ':publish:45', split_part(v_sql, ' = ', 2)
      );
      raise exception 'dirty queued insert unexpectedly succeeded';
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'INVALID_GENERATION_JOB_INITIAL_STATE' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

create or replace function pg_temp.assert_invalid_telemetry_values(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_case text;
  v_column text;
  v_value text;
  v_started_at timestamptz := clock_timestamp() + interval '2 hours';
begin
  foreach v_case in array array[
    'workflow_phase|' || '',
    'workflow_phase|' || repeat('W', 101),
    'workflow_phase|' || E'PHASE\nSECRET',
    'provider_id|' || repeat('p', 201),
    'provider_id|' || E'provider\tsecret',
    'model_id|' || repeat('m', 201),
    'model_id|' || E'model\nsecret',
    'retry_decision|' || repeat('r', 201),
    'retry_decision|' || E'retry\rsecret',
    'error_code|' || repeat('e', 201),
    'error_code|' || E'error\nsecret',
    'worker_id|' || repeat('w', 201),
    'worker_id|' || E'worker\tsecret'
  ] loop
    v_column := split_part(v_case, '|', 1);
    v_value := split_part(v_case, '|', 2);
    begin
      if v_column = 'workflow_phase' then
        execute format(
          'insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at) select id,correlation_id,story_id,chapter_number,attempt_count,%L,%L from public.generation_jobs where id=%L',
          v_value, v_started_at, p_job_id
        );
      else
        execute format(
          'insert into public.generation_job_attempts (job_id,correlation_id,story_id,chapter_number,attempt_number,workflow_phase,started_at,%I) select id,correlation_id,story_id,chapter_number,attempt_count,%L,%L,%L from public.generation_jobs where id=%L',
          v_column, 'VALID_PHASE', v_started_at, v_value, p_job_id
        );
      end if;
      raise exception 'invalid telemetry value unexpectedly succeeded';
    exception
      when check_violation then null;
    end;
    v_started_at := v_started_at + interval '1 second';
  end loop;
end;
$$;

create or replace function pg_temp.assert_attempt_identity_immutable(p_job_id uuid)
returns void
language plpgsql
as $$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    'job_id = gen_random_uuid()',
    'correlation_id = gen_random_uuid()',
    'story_id = ''test:generation-job-other''',
    'chapter_number = 49',
    'attempt_number = 1',
    'workflow_phase = ''OTHER_PHASE''',
    'started_at = started_at + interval ''1 second'''
  ] loop
    begin
      execute format(
        'update public.generation_job_attempts set %s where job_id = %L and workflow_phase = %L',
        v_sql, p_job_id, 'PUBLICATION'
      );
      raise exception 'attempt identity mutation unexpectedly succeeded';
    exception
      when sqlstate 'P0001' then
        if sqlerrm is distinct from 'IMMUTABLE_GENERATION_JOB_ATTEMPT_IDENTITY' then
          raise;
        end if;
    end;
  end loop;
end;
$$;

-- Insert identity and deterministic publication boundary.
select pg_temp.add_queued_job('normal', false, false, 2);
select is(
  (select publication_idempotency_key from public.generation_jobs where id = pg_temp.job_id('normal')),
  'generation-job:' || pg_temp.job_id('normal')::text || ':publish:2',
  'queued insert stores exact deterministic publication key'
);
select throws_ok(
  $$insert into public.generation_jobs (
      id, story_id, chapter_number, user_id, generation_kind, status, deadline_at,
      publication_idempotency_key
    ) values (
      '32000000-0000-4000-8000-000000000001', 'test:generation-job', 3,
      '31000000-0000-4000-8000-000000000001', 'standard', 'QUEUED',
      clock_timestamp() + interval '20 minutes', 'wrong-key'
    )$$,
  '23514', null,
  'insert rejects nondeterministic publication key'
);
select is(
  (select publication_result from public.generation_jobs where id = pg_temp.job_id('normal')),
  null::jsonb,
  'publication result is null before success'
);
select lives_ok(
  $$select pg_temp.assert_invalid_initial_status(status, 30 + ordinal::integer)
    from unnest(array['RUNNING','RETRY_WAIT','FAILED','CANCELLED','SUCCEEDED'])
         with ordinality as rejected(status, ordinal)$$,
  'direct running, retry, and terminal inserts reject with exact initial-state token'
);
select lives_ok(
  $$select pg_temp.assert_dirty_queue_inserts_rejected()$$,
  'dirty QUEUED inserts reject with exact initial-state token'
);

-- Legal normal flow: QUEUED -> RUNNING -> RETRY_WAIT -> RUNNING -> SUCCEEDED.
update public.generation_jobs
set status = 'RUNNING', attempt_count = 1, worker_id = 'worker-a',
    claim_token = '33000000-0000-4000-8000-000000000001',
    claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
where id = pg_temp.job_id('normal');
select is(
  (select row(status, attempt_count, worker_id, claim_token is not null, claimed_at is not null, heartbeat_at is not null)::text
   from public.generation_jobs where id = pg_temp.job_id('normal')),
  row('RUNNING', 1, 'worker-a', true, true, true)::text,
  'QUEUED enters RUNNING with full ownership and one attempt increment'
);
update public.generation_jobs
set status = 'RETRY_WAIT', available_at = clock_timestamp() + interval '5 seconds'
where id = pg_temp.job_id('normal');
select is(
  (select row(status, attempt_count, worker_id, claim_token, claimed_at, heartbeat_at)::text
   from public.generation_jobs where id = pg_temp.job_id('normal')),
  row('RETRY_WAIT', 1, null::text, null::uuid, null::timestamptz, null::timestamptz)::text,
  'RUNNING enters RETRY_WAIT with stable attempts and cleared ownership'
);
update public.generation_jobs
set status = 'RUNNING', attempt_count = 2, worker_id = 'worker-b',
    claim_token = '33000000-0000-4000-8000-000000000002',
    claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
where id = pg_temp.job_id('normal');
select is(
  (select row(status, attempt_count, worker_id)::text
   from public.generation_jobs where id = pg_temp.job_id('normal')),
  row('RUNNING', 2, 'worker-b')::text,
  'RETRY_WAIT reenters RUNNING with exactly one attempt increment'
);
update public.generation_jobs
set status = 'SUCCEEDED', publication_result = '{"ok":true,"chapter_number":2}'::jsonb
where id = pg_temp.job_id('normal');
select is(
  (select row(status, attempt_count, publication_result, completed_at is not null,
              worker_id, claim_token, claimed_at, heartbeat_at)::text
   from public.generation_jobs where id = pg_temp.job_id('normal')),
  row('SUCCEEDED', 2, '{"ok":true,"chapter_number":2}'::jsonb, true,
      null::text, null::uuid, null::timestamptz, null::timestamptz)::text,
  'RUNNING succeeds with publication result, completion time, and cleared ownership'
);
select throws_ok(
  $$update public.generation_jobs set publication_result = '{"ok":false}' where id = pg_temp.job_id('normal')$$,
  'P0001', 'GENERATION_JOB_TERMINAL',
  'publication result is immutable after success'
);

-- Narrow watchdog deadline transitions.
select pg_temp.add_queued_job('overdue-queued', true);
update public.generation_jobs
set status = 'FAILED', last_error_code = 'GENERATION_DEADLINE_EXCEEDED'
where id = pg_temp.job_id('overdue-queued');
select is(
  (select row(status, last_error_code, completed_at is not null)::text
   from public.generation_jobs where id = pg_temp.job_id('overdue-queued')),
  row('FAILED', 'GENERATION_DEADLINE_EXCEEDED', true)::text,
  'overdue QUEUED fails only with deadline code and completion time'
);
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind, status,
  deadline_at, created_at, updated_at, publication_idempotency_key
) values (
  '32000000-0000-4000-8000-000000000002', 'test:generation-job', 4,
  '31000000-0000-4000-8000-000000000001', 'standard', 'QUEUED',
  clock_timestamp() - interval '1 hour', clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '2 hours',
  'generation-job:32000000-0000-4000-8000-000000000002:publish:4'
);
insert into pg_temp.test_generation_jobs values ('overdue-retry', '32000000-0000-4000-8000-000000000002');
update public.generation_jobs
set status = 'RUNNING', attempt_count = 1, worker_id = 'worker-overdue',
    claim_token = gen_random_uuid(), claimed_at = clock_timestamp() - interval '90 minutes',
    heartbeat_at = clock_timestamp() - interval '90 minutes'
where id = pg_temp.job_id('overdue-retry');
update public.generation_jobs set status = 'RETRY_WAIT'
where id = pg_temp.job_id('overdue-retry');
update public.generation_jobs
set status = 'FAILED', last_error_code = 'GENERATION_DEADLINE_EXCEEDED'
where id = pg_temp.job_id('overdue-retry');
select is(
  (select row(status, last_error_code, completed_at is not null)::text
   from public.generation_jobs where id = pg_temp.job_id('overdue-retry')),
  row('FAILED', 'GENERATION_DEADLINE_EXCEEDED', true)::text,
  'overdue RETRY_WAIT fails only with deadline code and completion time'
);
select pg_temp.add_queued_job('premature-queued');
select throws_ok(
  $$update public.generation_jobs set status = 'FAILED', last_error_code = 'GENERATION_DEADLINE_EXCEEDED' where id = pg_temp.job_id('premature-queued')$$,
  'P0001', 'INVALID_GENERATION_JOB_TRANSITION',
  'premature QUEUED to FAILED rejects'
);
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind, status,
  deadline_at, publication_idempotency_key
) values (
  '32000000-0000-4000-8000-000000000003', 'test:generation-job', 5,
  '31000000-0000-4000-8000-000000000001', 'standard', 'QUEUED',
  clock_timestamp() + interval '20 minutes',
  'generation-job:32000000-0000-4000-8000-000000000003:publish:5'
);
insert into pg_temp.test_generation_jobs values ('premature-retry', '32000000-0000-4000-8000-000000000003');
update public.generation_jobs
set status = 'RUNNING', attempt_count = 1, worker_id = 'worker-premature',
    claim_token = gen_random_uuid(), claimed_at = clock_timestamp(),
    heartbeat_at = clock_timestamp()
where id = pg_temp.job_id('premature-retry');
update public.generation_jobs set status = 'RETRY_WAIT'
where id = pg_temp.job_id('premature-retry');
select throws_ok(
  $$update public.generation_jobs set status = 'FAILED', last_error_code = 'GENERATION_DEADLINE_EXCEEDED' where id = pg_temp.job_id('premature-retry')$$,
  'P0001', 'INVALID_GENERATION_JOB_TRANSITION',
  'premature RETRY_WAIT to FAILED rejects'
);
select pg_temp.add_queued_job('illegal-success');
select throws_ok(
  $$update public.generation_jobs set status = 'SUCCEEDED', publication_result = '{"ok":true}' where id = pg_temp.job_id('illegal-success')$$,
  'P0001', 'INVALID_GENERATION_JOB_TRANSITION',
  'QUEUED to SUCCEEDED rejects'
);
select throws_ok(
  $$update public.generation_jobs set updated_at = clock_timestamp() where id = pg_temp.job_id('normal')$$,
  'P0001', 'GENERATION_JOB_TERMINAL',
  'SUCCEEDED rejects every later mutation'
);
select throws_ok(
  $$update public.generation_jobs set updated_at = clock_timestamp() where id = pg_temp.job_id('overdue-queued')$$,
  'P0001', 'GENERATION_JOB_TERMINAL',
  'FAILED rejects every later mutation'
);
do $fixture$
begin
  perform pg_temp.add_queued_job('cancelled');
end
$fixture$;
update public.generation_jobs set status = 'CANCELLED' where id = pg_temp.job_id('cancelled');
select throws_ok(
  $$update public.generation_jobs set updated_at = clock_timestamp() where id = pg_temp.job_id('cancelled')$$,
  'P0001', 'GENERATION_JOB_TERMINAL',
  'CANCELLED rejects every later mutation'
);

-- Identity, ownership, publication, heartbeat, and attempt invariants.
do $fixture$
begin
  perform pg_temp.add_queued_job('identity');
end
$fixture$;
select lives_ok(
  $$select pg_temp.assert_identity_immutable(pg_temp.job_id('identity'))$$,
  'all immutable job identity fields reject mutation with exact token'
);

do $fixture$
begin
  perform pg_temp.add_queued_job('ownership-required');
end
$fixture$;
update public.generation_jobs
set status = 'RUNNING', attempt_count = 1, worker_id = 'worker-required',
    claim_token = gen_random_uuid(), claimed_at = clock_timestamp() - interval '2 seconds',
    heartbeat_at = clock_timestamp()
where id = pg_temp.job_id('ownership-required');
select lives_ok(
  $$select pg_temp.assert_running_ownership_required(pg_temp.job_id('ownership-required'))$$,
  'RUNNING requires worker, token, claimed time, and heartbeat'
);
select throws_ok(
  $$update public.generation_jobs set publication_result = '{"ok":true}' where id = pg_temp.job_id('ownership-required')$$,
  'P0001', 'GENERATION_JOB_PUBLICATION_RESULT_INVALID',
  'publication result cannot be set before RUNNING to SUCCEEDED'
);
select throws_ok(
  $$update public.generation_jobs set status = 'SUCCEEDED' where id = pg_temp.job_id('ownership-required')$$,
  'P0001', 'GENERATION_JOB_PUBLICATION_RESULT_REQUIRED',
  'RUNNING to SUCCEEDED requires publication result in same update'
);
update public.generation_jobs
set heartbeat_at = clock_timestamp()
where id = pg_temp.job_id('ownership-required');
select ok(
  (select heartbeat_at >= claimed_at and updated_at >= heartbeat_at
   from public.generation_jobs where id = pg_temp.job_id('ownership-required')),
  'RUNNING heartbeat moves forward and updated_at advances last'
);
select throws_ok(
  $$update public.generation_jobs set heartbeat_at = heartbeat_at - interval '1 second' where id = pg_temp.job_id('ownership-required')$$,
  'P0001', 'GENERATION_JOB_HEARTBEAT_MOVED_BACKWARD',
  'RUNNING heartbeat cannot move backward'
);
select throws_ok(
  $$update public.generation_jobs set heartbeat_at = claimed_at - interval '1 second' where id = pg_temp.job_id('ownership-required')$$,
  'P0001', 'INVALID_GENERATION_JOB_OWNERSHIP_CHRONOLOGY',
  'RUNNING heartbeat cannot precede claim'
);
select throws_ok(
  $$update public.generation_jobs set heartbeat_at = clock_timestamp() + interval '1 minute' where id = pg_temp.job_id('ownership-required')$$,
  'P0001', 'INVALID_GENERATION_JOB_OWNERSHIP_CHRONOLOGY',
  'RUNNING heartbeat cannot be future dated'
);
select lives_ok(
  $$update public.generation_jobs set heartbeat_at = heartbeat_at where id = pg_temp.job_id('ownership-required')$$,
  'RUNNING heartbeat equality remains legal for idempotence'
);
select lives_ok(
  $$select pg_temp.assert_running_identity_stable(pg_temp.job_id('ownership-required'))$$,
  'RUNNING same-state worker, token, and claimed time stay stable'
);
select throws_ok(
  $$update public.generation_jobs set attempt_count = attempt_count - 1 where id = pg_temp.job_id('ownership-required')$$,
  'P0001', 'INVALID_GENERATION_JOB_ATTEMPT_COUNT',
  'attempt count never decreases'
);
do $fixture$
begin
  perform pg_temp.add_queued_job('attempt-stable');
end
$fixture$;
select throws_ok(
  $$update public.generation_jobs set attempt_count = attempt_count + 1 where id = pg_temp.job_id('attempt-stable')$$,
  'P0001', 'INVALID_GENERATION_JOB_ATTEMPT_COUNT',
  'attempt count cannot increment outside entry to RUNNING'
);
do $fixture$
begin
  perform pg_temp.add_queued_job('attempt-exact');
end
$fixture$;
select throws_ok(
  $$update public.generation_jobs
    set status = 'RUNNING', attempt_count = 2, worker_id = 'worker-exact',
        claim_token = gen_random_uuid(), claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
    where id = pg_temp.job_id('attempt-exact')$$,
  'P0001', 'INVALID_GENERATION_JOB_ATTEMPT_COUNT',
  'entry to RUNNING requires exactly one attempt increment'
);
do $fixture$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, status,
    max_attempts, deadline_at, publication_idempotency_key
  ) values (
    v_id, 'test:generation-job', 46, '31000000-0000-4000-8000-000000000001',
    'standard', 'QUEUED', 1, clock_timestamp() + interval '20 minutes',
    'generation-job:' || v_id::text || ':publish:46'
  );
  insert into pg_temp.test_generation_jobs values ('retry-exhausted', v_id);
end
$fixture$;
update public.generation_jobs
set status = 'RUNNING', attempt_count = 1,
    worker_id = 'worker-budget', claim_token = gen_random_uuid(),
    claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
where id = pg_temp.job_id('retry-exhausted');
select throws_ok(
  $$update public.generation_jobs set status = 'RETRY_WAIT'
    where id = pg_temp.job_id('retry-exhausted')$$,
  'P0001', 'INVALID_GENERATION_JOB_ATTEMPT_COUNT',
  'RUNNING cannot enter RETRY_WAIT after attempt budget exhausted'
);

-- Sanitized attempts remain parent-bound even after parent leaves RUNNING.
insert into public.generation_job_attempts (
  job_id, correlation_id, story_id, chapter_number, attempt_number,
  workflow_phase, provider_id, model_id, started_at, ended_at,
  elapsed_ms, lease_age_ms, lease_remaining_ms, retry_decision, error_code, worker_id
)
select id, correlation_id, story_id, chapter_number, 2,
       'PUBLICATION', 'provider-a', 'model-a', clock_timestamp() - interval '1 second',
       clock_timestamp(), 1000, 100, 5000, 'SUCCEEDED', null, 'worker-b'
from public.generation_jobs where id = pg_temp.job_id('normal');
select is(
  (select row(attempt_number, workflow_phase, elapsed_ms, worker_id)::text
   from public.generation_job_attempts where job_id = pg_temp.job_id('normal')),
  row(2, 'PUBLICATION', 1000::bigint, 'worker-b')::text,
  'valid sanitized attempt can be recorded after parent leaves RUNNING'
);
select lives_ok(
  $$select pg_temp.assert_attempt_identity(pg_temp.job_id('normal'))$$,
  'attempt correlation, story, and chapter must match parent identity'
);
select throws_ok(
  $$insert into public.generation_job_attempts (
      job_id, correlation_id, story_id, chapter_number, attempt_number, workflow_phase, started_at
    )
    select id, correlation_id, story_id, chapter_number, attempt_count + 1, 'TOO_HIGH', clock_timestamp()
    from public.generation_jobs where id = pg_temp.job_id('normal')$$,
  'P0001', 'GENERATION_JOB_ATTEMPT_NUMBER_INVALID',
  'attempt number cannot exceed parent attempt count'
);
select lives_ok(
  $$select pg_temp.assert_attempt_timing_checks(pg_temp.job_id('normal'))$$,
  'attempt end and nonnegative timing constraints reject invalid values'
);
select lives_ok(
  $$select pg_temp.assert_invalid_telemetry_values(pg_temp.job_id('normal'))$$,
  'attempt telemetry rejects empty, oversized, and control-character values'
);
select lives_ok(
  $$insert into public.generation_job_attempts (
      job_id, correlation_id, story_id, chapter_number, attempt_number,
      workflow_phase, provider_id, model_id, started_at, retry_decision, error_code, worker_id
    )
    select id, correlation_id, story_id, chapter_number, attempt_count,
           'provider_workflow:phase-1', 'provider.v1/model', 'model:latest-v2',
           clock_timestamp() + interval '3 hours', 'retry-later', 'provider:error-429',
           'worker.region/01'
    from public.generation_jobs where id = pg_temp.job_id('normal')$$,
  'likely lowercase provider, model, phase, decision, error, and worker IDs remain allowed'
);
select lives_ok(
  $$select pg_temp.assert_attempt_identity_immutable(pg_temp.job_id('normal'))$$,
  'attempt identity fields reject privileged UPDATE with exact token'
);
select throws_ok(
  $$insert into public.generation_job_attempts (
      job_id, correlation_id, story_id, chapter_number, attempt_number,
      workflow_phase, started_at
    )
    select job_id, correlation_id, story_id, chapter_number, attempt_number,
           workflow_phase, started_at
    from public.generation_job_attempts
    where job_id = pg_temp.job_id('normal') and workflow_phase = 'PUBLICATION'$$,
  '23505', null,
  'attempt identity tuple is unique'
);

select * from finish();
rollback;
