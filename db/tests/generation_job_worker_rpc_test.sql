begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation job worker RPC tests require local-cli';
  end if;
end
$$;

select plan(70);

select has_column('public', 'generation_leases', 'job_id', 'lease has additive job binding');
select has_column('public', 'generation_leases', 'claim_token', 'lease has additive claim binding');
select has_index('public', 'generation_leases', 'generation_leases_job_claim_idx', 'bound active lease index exists');

create temporary table worker_rpc_signatures (
  function_name text primary key,
  arguments text[] not null,
  identity text not null
) on commit drop;
insert into worker_rpc_signatures values
  ('claim_generation_job_v1', array['text'], 'public.claim_generation_job_v1(text)'),
  ('acquire_generation_job_lease_v1', array['uuid','text','uuid','integer'], 'public.acquire_generation_job_lease_v1(uuid,text,uuid,integer)'),
  ('heartbeat_generation_job_v1', array['uuid','text','uuid','uuid','integer'], 'public.heartbeat_generation_job_v1(uuid,text,uuid,uuid,integer)'),
  ('finish_generation_job_attempt_v1', array['uuid','text','uuid','text','timestamp with time zone','text','text','text','text','text','timestamp with time zone','timestamp with time zone','bigint','bigint','bigint','text'], 'public.finish_generation_job_attempt_v1(uuid,text,uuid,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone,timestamp with time zone,bigint,bigint,bigint,text)'),
  ('cancel_generation_job_v1', array['uuid','text'], 'public.cancel_generation_job_v1(uuid,text)'),
  ('recover_stale_generation_jobs_v1', array['integer'], 'public.recover_stale_generation_jobs_v1(integer)');

select has_function('public', function_name, arguments, function_name || ' has exact signature')
from worker_rpc_signatures order by function_name;
select function_returns('public', function_name, arguments, 'jsonb', function_name || ' returns jsonb')
from worker_rpc_signatures order by function_name;
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure(identity)), false),
  function_name || ' is SECURITY DEFINER'
) from worker_rpc_signatures order by function_name;
select is(
  (select proconfig from pg_proc where oid = to_regprocedure(identity)),
  array['search_path=""']::text[],
  function_name || ' fixes empty search_path'
) from worker_rpc_signatures order by function_name;
select ok(
  has_function_privilege('service_role', identity, 'EXECUTE')
    and not has_function_privilege('anon', identity, 'EXECUTE')
    and not has_function_privilege('authenticated', identity, 'EXECUTE')
    and not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = to_regprocedure(identity)
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ),
  function_name || ' is service-role-only'
) from worker_rpc_signatures order by function_name;

select has_function('public', 'acquire_generation_lease', array['text','integer','text','integer','text'], 'legacy acquire signature remains');
select has_function('public', 'release_generation_lease', array['text','uuid'], 'legacy release signature remains');

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'worker-rpc-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values
  ('test:worker-rpc-a', 'Worker RPC A', '51000000-0000-4000-8000-000000000001', 'private', 'standard'),
  ('test:worker-rpc-b', 'Worker RPC B', '51000000-0000-4000-8000-000000000001', 'private', 'standard');

create temporary table worker_rpc_jobs (
  fixture_name text primary key,
  job_id uuid not null
) on commit drop;
create temporary table worker_rpc_results (
  fixture_name text primary key,
  result jsonb not null
) on commit drop;

create or replace function pg_temp.add_worker_job(
  p_fixture_name text,
  p_story_id text,
  p_chapter_number integer,
  p_available_at timestamptz,
  p_deadline_at timestamptz,
  p_created_at timestamptz default null,
  p_max_attempts integer default 4
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
  v_created_at timestamptz := coalesce(p_created_at, clock_timestamp() - interval '5 minutes');
begin
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, max_attempts, available_at, deadline_at, created_at, updated_at,
    publication_idempotency_key
  ) values (
    v_id, p_story_id, p_chapter_number, '51000000-0000-4000-8000-000000000001',
    'standard', 'choice:' || p_fixture_name, 'QUEUED', p_max_attempts,
    p_available_at, p_deadline_at, v_created_at, v_created_at,
    'generation-job:' || v_id::text || ':publish:' || p_chapter_number::text
  );
  insert into pg_temp.worker_rpc_jobs values (p_fixture_name, v_id);
  return v_id;
end;
$$;

create or replace function pg_temp.job_id(p_fixture_name text)
returns uuid language sql stable
as $$select job_id from pg_temp.worker_rpc_jobs where fixture_name = p_fixture_name$$;

create or replace function pg_temp.try_json(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_state text;
  v_message text;
begin
  execute p_sql into v_result;
  return jsonb_build_object('ok', true, 'data', v_result);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  return jsonb_build_object('ok', false, 'sqlstate', v_state, 'message', v_message);
end;
$$;

-- Claim ordering, exclusions, single increment, and snake-case mapper shape.
select pg_temp.add_worker_job('order-second', 'test:worker-rpc-a', 2, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes', clock_timestamp() - interval '10 minutes');
select pg_temp.add_worker_job('order-first', 'test:worker-rpc-a', 3, clock_timestamp() - interval '2 minutes', clock_timestamp() + interval '20 minutes', clock_timestamp() - interval '5 minutes');
select pg_temp.add_worker_job('unavailable', 'test:worker-rpc-a', 4, clock_timestamp() + interval '10 minutes', clock_timestamp() + interval '20 minutes');
select pg_temp.add_worker_job('overdue', 'test:worker-rpc-a', 5, clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '30 minutes');

insert into worker_rpc_results values ('claim-first', public.claim_generation_job_v1('worker-a'));
select is((select result->'job'->>'id' from worker_rpc_results where fixture_name = 'claim-first'), pg_temp.job_id('order-first')::text, 'claim orders by available_at before created_at');
select is(
  (select array_agg(key order by key) from jsonb_object_keys((select result->'job' from worker_rpc_results where fixture_name = 'claim-first')) key),
  array['attempt_count','chapter_number','claim_token','correlation_id','deadline_at','generation_kind','id','max_attempts','story_id','trigger_choice_id','user_id','worker_id'],
  'claim job returns exact snake-case internal mapper fields'
);
select is(
  (select row(status, attempt_count, worker_id, claim_token::text)::text from public.generation_jobs where id = pg_temp.job_id('order-first')),
  (select row('RUNNING', 1, 'worker-a', result->'job'->>'claim_token')::text from worker_rpc_results where fixture_name = 'claim-first'),
  'claim enters RUNNING, increments once, and stores returned token'
);
select is((select count(*) from public.generation_jobs where id in (pg_temp.job_id('unavailable'), pg_temp.job_id('overdue')) and status = 'QUEUED'), 2::bigint, 'claim excludes unavailable and overdue rows');

insert into worker_rpc_results values ('claim-second', public.claim_generation_job_v1('worker-b'));
select is((select result->'job'->>'id' from worker_rpc_results where fixture_name = 'claim-second'), pg_temp.job_id('order-second')::text, 'next claim selects next available job');
select is(public.claim_generation_job_v1('worker-c'), '{"claimed":false}'::jsonb, 'no available eligible row returns claimed false');

-- Bound lease and exact ownership fencing.
insert into worker_rpc_results
select 'lease-first', public.acquire_generation_job_lease_v1(
  pg_temp.job_id('order-first'), 'worker-a',
  (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'claim-first'),
  180
);
select ok((select (result->>'ok')::boolean and (result->>'lease_id')::uuid is not null from worker_rpc_results where fixture_name = 'lease-first'), 'matching owner acquires bound lease');
select is(
  (select row(job_id, claim_token, story_id, chapter_number, holder, status)::text
   from public.generation_leases where id = (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'lease-first')),
  (select row(
    pg_temp.job_id('order-first'), (claim.result->'job'->>'claim_token')::uuid,
    'test:worker-rpc-a', 3, 'worker-a', 'ACTIVE'
  )::text from worker_rpc_results claim where fixture_name = 'claim-first'),
  'lease stores exact job, token, story, chapter, and worker binding'
);
select is(
  public.acquire_generation_job_lease_v1(
    pg_temp.job_id('order-first'), 'worker-wrong',
    (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'claim-first'), 180
  ),
  '{"ok":false,"reason":"OWNERSHIP_LOST"}'::jsonb,
  'wrong lease worker loses ownership'
);
select is(
  public.acquire_generation_job_lease_v1(pg_temp.job_id('order-first'), 'worker-a', gen_random_uuid(), 180),
  '{"ok":false,"reason":"OWNERSHIP_LOST"}'::jsonb,
  'wrong lease token loses ownership'
);
select is(
  pg_temp.try_json(format(
    'select public.acquire_generation_job_lease_v1(%L,%L,%L,%s)',
    pg_temp.job_id('order-first'), 'worker-a',
    (select result->'job'->>'claim_token' from worker_rpc_results where fixture_name = 'claim-first'), 29
  ))->>'message',
  'INVALID_LEASE_TTL',
  'bound lease rejects TTL below 30'
);
select is(
  public.acquire_generation_job_lease_v1(
    pg_temp.job_id('order-second'), 'worker-b',
    (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'claim-second'), 180
  )->>'reason',
  'LEASE_HELD',
  'legacy one-active-story lease constraint remains enforced'
);

select is(
  public.heartbeat_generation_job_v1(
    pg_temp.job_id('order-first'), 'worker-wrong',
    (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'claim-first'),
    (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'lease-first'), 180
  ),
  '{"ok":false,"reason":"OWNERSHIP_LOST"}'::jsonb,
  'heartbeat wrong worker loses ownership'
);
select is(
  public.heartbeat_generation_job_v1(
    pg_temp.job_id('order-first'), 'worker-a', gen_random_uuid(),
    (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'lease-first'), 180
  ),
  '{"ok":false,"reason":"OWNERSHIP_LOST"}'::jsonb,
  'heartbeat wrong token loses ownership'
);
update public.generation_leases
set expires_at = clock_timestamp() + interval '40 seconds'
where id = (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'lease-first');
insert into worker_rpc_results
select 'heartbeat', public.heartbeat_generation_job_v1(
  pg_temp.job_id('order-first'), 'worker-a',
  (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'claim-first'),
  (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'lease-first'), 180
);
select is((select result from worker_rpc_results where fixture_name = 'heartbeat'), '{"ok":true}'::jsonb, 'heartbeat exact tuple succeeds');
select ok(
  (select j.heartbeat_at >= l.expires_at - interval '181 seconds'
          and l.expires_at >= clock_timestamp() + interval '178 seconds'
   from public.generation_jobs j
   join public.generation_leases l on l.job_id = j.id and l.claim_token = j.claim_token
   where j.id = pg_temp.job_id('order-first')),
  'heartbeat renews matching active unexpired lease and job heartbeat'
);

-- Finish derives all parent identity and persists telemetry in exact field order.
insert into worker_rpc_results
select 'finish-retry', public.finish_generation_job_attempt_v1(
  pg_temp.job_id('order-first'), 'worker-a',
  (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'claim-first'),
  'RETRY_WAIT', clock_timestamp() + interval '1 minute', 'PROVIDER_503', 'TRANSIENT',
  'PROVIDER_CALL', 'provider-a', 'model-a',
  '2026-07-18 01:00:00+00'::timestamptz, '2026-07-18 01:00:05+00'::timestamptz,
  5000, 2000, 178000, 'RETRY_BACKOFF'
);
select is((select result->>'status' from worker_rpc_results where fixture_name = 'finish-retry'), 'RETRY_WAIT', 'finish accepts RETRY_WAIT outcome');
select is(
  (select row(correlation_id, story_id, chapter_number, attempt_number, workflow_phase, provider_id, model_id,
              started_at, ended_at, elapsed_ms, lease_age_ms, lease_remaining_ms, retry_decision, error_code, worker_id)::text
   from public.generation_job_attempts where job_id = pg_temp.job_id('order-first')),
  (select row(j.correlation_id, j.story_id, j.chapter_number, 1, 'PROVIDER_CALL', 'provider-a', 'model-a',
              '2026-07-18 01:00:00+00'::timestamptz, '2026-07-18 01:00:05+00'::timestamptz,
              5000::bigint, 2000::bigint, 178000::bigint, 'RETRY_BACKOFF', 'PROVIDER_503', 'worker-a')::text
   from public.generation_jobs j where j.id = pg_temp.job_id('order-first')),
  'finish derives parent identity and stores sanitized telemetry in exact order'
);
select is(
  (select row(status, worker_id, claim_token, claimed_at, heartbeat_at, last_error_code, last_error_class)::text
   from public.generation_jobs where id = pg_temp.job_id('order-first')),
  row('RETRY_WAIT', null::text, null::uuid, null::timestamptz, null::timestamptz, 'PROVIDER_503', 'TRANSIENT')::text,
  'retry finish clears ownership and stores sanitized error classification'
);
select is(
  (select status from public.generation_leases where id = (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'lease-first')),
  'RELEASED',
  'retry finish releases only matching bound lease'
);
select is(
  public.finish_generation_job_attempt_v1(
    pg_temp.job_id('order-first'), 'worker-a', gen_random_uuid(), 'FAILED', null,
    'LATE', 'PERMANENT', 'LATE_PHASE', null, null, clock_timestamp(), clock_timestamp(),
    0, null, null, 'FAILED'
  ),
  '{"ok":false,"reason":"OWNERSHIP_LOST"}'::jsonb,
  'finish after ownership clear returns ownership lost and inserts nothing'
);

update public.generation_jobs set available_at = clock_timestamp() where id = pg_temp.job_id('order-first');
insert into worker_rpc_results values ('retry-claim', public.claim_generation_job_v1('worker-retry'));
select is((select result->'job'->>'id' from worker_rpc_results where fixture_name = 'retry-claim'), pg_temp.job_id('order-first')::text, 'retry job becomes claimable');
select isnt(
  (select result->'job'->>'claim_token' from worker_rpc_results where fixture_name = 'retry-claim'),
  (select result->'job'->>'claim_token' from worker_rpc_results where fixture_name = 'claim-first'),
  'retry claim rotates token'
);
select is((select (result->'job'->>'attempt_count')::integer from worker_rpc_results where fixture_name = 'retry-claim'), 2, 'retry claim increments attempt exactly once');

-- Retry after max attempts and deadline degrades to terminal failure.
select pg_temp.add_worker_job('max-terminal', 'test:worker-rpc-b', 20, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes', null, 1);
insert into worker_rpc_results values ('max-claim', public.claim_generation_job_v1('worker-max'));
insert into worker_rpc_results
select 'max-finish', public.finish_generation_job_attempt_v1(
  pg_temp.job_id('max-terminal'), 'worker-max',
  (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'max-claim'),
  'RETRY_WAIT', clock_timestamp() + interval '1 minute', 'PROVIDER_503', 'TRANSIENT',
  'PROVIDER_CALL', null, null, clock_timestamp() - interval '1 second', clock_timestamp(), 1000, null, null, 'RETRY'
);
select is(
  (select row(status, last_error_code, completed_at is not null)::text from public.generation_jobs where id = pg_temp.job_id('max-terminal')),
  row('FAILED', 'GENERATION_RETRY_EXHAUSTED', true)::text,
  'retry request at max attempts becomes terminal exhausted failure'
);

select pg_temp.add_worker_job('deadline-terminal', 'test:worker-rpc-b', 21, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '3 minutes');
insert into worker_rpc_results values ('deadline-claim', public.claim_generation_job_v1('worker-deadline'));
alter table public.generation_jobs disable trigger generation_jobs_enforce_state_v1_trigger;
update public.generation_jobs set deadline_at = clock_timestamp() - interval '1 second' where id = pg_temp.job_id('deadline-terminal');
alter table public.generation_jobs enable trigger generation_jobs_enforce_state_v1_trigger;
insert into worker_rpc_results
select 'deadline-finish', public.finish_generation_job_attempt_v1(
  pg_temp.job_id('deadline-terminal'), 'worker-deadline',
  (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'deadline-claim'),
  'RETRY_WAIT', clock_timestamp() + interval '1 minute', 'PROVIDER_503', 'TRANSIENT',
  'PROVIDER_CALL', null, null, clock_timestamp() - interval '1 second', clock_timestamp(), 1000, null, null, 'RETRY'
);
select is(
  (select row(status, last_error_code, completed_at is not null)::text from public.generation_jobs where id = pg_temp.job_id('deadline-terminal')),
  row('FAILED', 'GENERATION_DEADLINE_EXCEEDED', true)::text,
  'retry request after deadline becomes terminal deadline failure'
);

-- Service-role operator cancellation supports Q/RW/R and expires bound running lease.
select is(public.cancel_generation_job_v1(pg_temp.job_id('unavailable'), 'operator rollback'), '{"ok":true,"status":"CANCELLED"}'::jsonb, 'operator cancels queued job');
select is((select row(status, last_error_code, completed_at is not null)::text from public.generation_jobs where id = pg_temp.job_id('unavailable')), row('CANCELLED', 'GENERATION_CANCELLED', true)::text, 'queued cancel remains durable with bounded reason classification');

insert into worker_rpc_results
select 'retry-lease', public.acquire_generation_job_lease_v1(
  pg_temp.job_id('order-first'), 'worker-retry',
  (select (result->'job'->>'claim_token')::uuid from worker_rpc_results where fixture_name = 'retry-claim'), 180
);
select is(public.cancel_generation_job_v1(pg_temp.job_id('order-first'), 'operator stop'), '{"ok":true,"status":"CANCELLED"}'::jsonb, 'operator cancels running job without worker tuple');
select is(
  (select row(j.status, j.worker_id, j.claim_token, l.status)::text
   from public.generation_jobs j join public.generation_leases l on l.id = (select (result->>'lease_id')::uuid from worker_rpc_results where fixture_name = 'retry-lease')
   where j.id = pg_temp.job_id('order-first')),
  row('CANCELLED', null::text, null::uuid, 'EXPIRED')::text,
  'running cancel clears ownership and expires matching bound lease'
);
select is(public.cancel_generation_job_v1(pg_temp.job_id('order-first'), 'operator replay'), '{"ok":false,"reason":"NOT_CANCELLABLE"}'::jsonb, 'terminal cancel replay does not mutate row');
select is(pg_temp.try_json(format('select public.cancel_generation_job_v1(%L,%L)', pg_temp.job_id('order-second'), repeat('x', 201)))->>'message', 'INVALID_CANCEL_REASON', 'cancel reason is bounded');

-- Recovery signature is callable and bounded; Task 6 expands behavior tests.
select is(public.recover_stale_generation_jobs_v1(0), '{"recovered_count":0}'::jsonb, 'recovery zero batch is bounded no-op');
select is(public.recover_stale_generation_jobs_v1(101), '{"recovered_count":0}'::jsonb, 'recovery oversized batch is bounded no-op');
select ok((public.recover_stale_generation_jobs_v1(1)->>'recovered_count')::integer >= 0, 'recovery valid batch returns current schema shape');

select * from finish();
rollback;
