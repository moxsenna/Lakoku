begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'claim-by-id tests require local-cli';
  end if;
end
$$;

select plan(20);

-- ---- Signature + ACL ----
select has_function(
  'public', 'claim_generation_job_by_id_v1', array['uuid','text'],
  'claim_generation_job_by_id_v1 has exact signature'
);
select function_returns(
  'public', 'claim_generation_job_by_id_v1', array['uuid','text'], 'jsonb',
  'claim_generation_job_by_id_v1 returns jsonb'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.claim_generation_job_by_id_v1(uuid,text)')), false),
  'claim_generation_job_by_id_v1 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.claim_generation_job_by_id_v1(uuid,text)')),
  array['search_path=""']::text[],
  'claim_generation_job_by_id_v1 fixes empty search_path'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.claim_generation_job_by_id_v1(uuid,text)')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute claim-by-id'
);
select ok(not has_function_privilege('anon', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'anon cannot execute claim-by-id');
select ok(not has_function_privilege('authenticated', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'authenticated cannot execute claim-by-id');
select ok(has_function_privilege('service_role', 'public.claim_generation_job_by_id_v1(uuid,text)', 'EXECUTE'), 'service_role can execute claim-by-id');

-- ---- Fixtures ----
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '52000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'claim-by-id-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values ('test:claim-by-id', 'Claim By Id', '52000000-0000-4000-8000-000000000001', 'private', 'standard');

create temporary table cbid_jobs (fixture_name text primary key, job_id uuid not null) on commit drop;

create or replace function pg_temp.add_job(
  p_fixture text, p_chapter integer, p_available timestamptz, p_deadline timestamptz,
  p_max_attempts integer default 4
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  -- Inserts must be QUEUED + attempt_count=0 (trigger enforces initial state).
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, attempt_count, max_attempts, available_at, deadline_at, created_at, updated_at,
    publication_idempotency_key
  ) values (
    v_id, 'test:claim-by-id', p_chapter, '52000000-0000-4000-8000-000000000001',
    'standard', 'choice:' || p_fixture, 'QUEUED', 0, p_max_attempts,
    p_available, p_deadline, clock_timestamp() - interval '5 minutes', clock_timestamp() - interval '5 minutes',
    'generation-job:' || v_id::text || ':publish:' || p_chapter::text
  );
  insert into pg_temp.cbid_jobs values (p_fixture, v_id);
  return v_id;
end $$;

create or replace function pg_temp.jid(p_fixture text)
returns uuid language sql stable
as $$select job_id from pg_temp.cbid_jobs where fixture_name = p_fixture$$;

-- Two independent QUEUED jobs (chapter differs so unique-active index allows both).
select pg_temp.add_job('job-a', 2, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes');
select pg_temp.add_job('job-b', 3, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes');
select pg_temp.add_job('unavailable', 4, clock_timestamp() + interval '10 minutes', clock_timestamp() + interval '20 minutes');
select pg_temp.add_job('overdue', 5, clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 minute');
-- Exhausted: max_attempts=1, claim once, finish RETRY_WAIT -> terminal FAILED (not re-claimable).
select pg_temp.add_job('exhausted', 6, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes', 1);

-- ---- Targeted claim only claims the requested job ----
create temporary table cbid_results (fixture_name text primary key, result jsonb not null) on commit drop;

insert into cbid_results values ('claim-a', public.claim_generation_job_by_id_v1(pg_temp.jid('job-a'), 'worker-1'));
select is(
  (select result->'job'->>'id' from cbid_results where fixture_name = 'claim-a'),
  pg_temp.jid('job-a')::text,
  'claim-by-id claims exactly the requested job'
);
select is(
  (select row(status, attempt_count, worker_id)::text from public.generation_jobs where id = pg_temp.jid('job-a')),
  (select row('RUNNING', 1, 'worker-1')::text),
  'claim-by-id transitions to RUNNING and increments attempt once'
);
select is(
  (select status from public.generation_jobs where id = pg_temp.jid('job-b')),
  'QUEUED',
  'claim-by-id does NOT touch the other job (request A never claims job B)'
);

-- ---- Non-claimable cases return claimed:false ----
select is(
  public.claim_generation_job_by_id_v1(pg_temp.jid('job-a'), 'worker-2'),
  '{"claimed":false}'::jsonb,
  'already-RUNNING job is not re-claimable'
);
select is(
  public.claim_generation_job_by_id_v1(pg_temp.jid('unavailable'), 'worker-2'),
  '{"claimed":false}'::jsonb,
  'future available_at is not claimable'
);
select is(
  public.claim_generation_job_by_id_v1(pg_temp.jid('overdue'), 'worker-2'),
  '{"claimed":false}'::jsonb,
  'past deadline is not claimable'
);
-- Exhaust budget: claim once (attempt_count 0->1 = max), finish RETRY_WAIT -> FAILED.
insert into cbid_results values (
  'exhausted-claim',
  public.claim_generation_job_by_id_v1(pg_temp.jid('exhausted'), 'worker-ex')
);
select is(
  (select (result->>'claimed')::boolean from cbid_results where fixture_name = 'exhausted-claim'),
  true,
  'exhausted fixture claimable once (max_attempts=1)'
);
select is(
  public.finish_generation_job_attempt_v1(
    pg_temp.jid('exhausted'),
    'worker-ex',
    (select (result->'job'->>'claim_token')::uuid from cbid_results where fixture_name = 'exhausted-claim'),
    'RETRY_WAIT', clock_timestamp() + interval '1 minute',
    'PROVIDER_503', 'TRANSIENT', 'PROVIDER_CALL', null, null,
    clock_timestamp() - interval '1 second', clock_timestamp(),
    1000, null, null, 'RETRY'
  )->>'status',
  'FAILED',
  'finish RETRY_WAIT at max attempts becomes FAILED'
);
select is(
  public.claim_generation_job_by_id_v1(pg_temp.jid('exhausted'), 'worker-2'),
  '{"claimed":false}'::jsonb,
  'attempt budget exhausted (terminal FAILED) is not claimable'
);
select is(
  public.claim_generation_job_by_id_v1(gen_random_uuid(), 'worker-2'),
  '{"claimed":false}'::jsonb,
  'unknown job id is not claimable'
);

-- RETRY_WAIT within budget: claim, finish RETRY_WAIT (attempt 1 of 4), re-claim by id.
select pg_temp.add_job('retryable', 7, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes', 4);
insert into cbid_results values (
  'retryable-claim1',
  public.claim_generation_job_by_id_v1(pg_temp.jid('retryable'), 'worker-r1')
);
select is(
  public.finish_generation_job_attempt_v1(
    pg_temp.jid('retryable'),
    'worker-r1',
    (select (result->'job'->>'claim_token')::uuid from cbid_results where fixture_name = 'retryable-claim1'),
    'RETRY_WAIT', clock_timestamp() + interval '1 minute',
    'PROVIDER_503', 'TRANSIENT', 'PROVIDER_CALL', null, null,
    clock_timestamp() - interval '1 second', clock_timestamp(),
    1000, null, null, 'RETRY'
  )->>'status',
  'RETRY_WAIT',
  'finish RETRY_WAIT within budget stays RETRY_WAIT'
);
-- Make available now so claim-by-id can pick it up (available_at must be in the past).
update public.generation_jobs
  set available_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.jid('retryable');
select is(
  (public.claim_generation_job_by_id_v1(pg_temp.jid('retryable'), 'worker-3')->>'claimed')::boolean,
  true,
  'available RETRY_WAIT within budget is claimable by id'
);

select * from finish();
rollback;
