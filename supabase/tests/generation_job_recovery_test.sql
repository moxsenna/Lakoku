begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation job recovery tests require local-cli';
  end if;
end
$$;

select plan(34);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '61000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'generation-recovery-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

create temporary table recovery_jobs (
  fixture_name text primary key,
  job_id uuid not null,
  story_id text not null,
  claim_token uuid
) on commit drop;

create or replace function pg_temp.add_recovery_job(
  p_fixture_name text,
  p_status text,
  p_heartbeat_age interval default interval '76 seconds',
  p_deadline_age interval default interval '-20 minutes',
  p_attempt_count integer default 1,
  p_max_attempts integer default 4,
  p_sort_age interval default interval '10 minutes'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
  v_story_id text := 'test:generation-recovery:' || p_fixture_name;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_created_at timestamptz := v_now - greatest(p_sort_age, p_deadline_age + interval '1 minute');
  v_deadline_at timestamptz := v_now - p_deadline_age;
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values (v_story_id, 'Recovery ' || p_fixture_name, '61000000-0000-4000-8000-000000000001', 'private', 'standard');

  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, max_attempts, available_at, deadline_at, created_at, updated_at,
    publication_idempotency_key
  ) values (
    v_id, v_story_id, 2, '61000000-0000-4000-8000-000000000001',
    'standard', 'choice:' || p_fixture_name, 'QUEUED', p_max_attempts,
    v_now - p_sort_age, v_deadline_at, v_created_at, v_created_at,
    'generation-job:' || v_id::text || ':publish:2'
  );

  if p_status in ('RUNNING', 'RETRY_WAIT') then
    update public.generation_jobs
    set status = 'RUNNING', attempt_count = p_attempt_count,
        worker_id = 'worker:' || p_fixture_name, claim_token = v_token,
        claimed_at = v_now - p_sort_age,
        heartbeat_at = v_now - p_heartbeat_age
    where id = v_id;
  end if;
  if p_status = 'RETRY_WAIT' then
    update public.generation_jobs set status = 'RETRY_WAIT' where id = v_id;
  end if;

  insert into pg_temp.recovery_jobs values (
    p_fixture_name, v_id, v_story_id,
    case when p_status = 'RUNNING' then v_token else null end
  );
  return v_id;
end;
$$;

create or replace function pg_temp.job_id(p_fixture_name text)
returns uuid language sql stable
as $$select job_id from pg_temp.recovery_jobs where fixture_name = p_fixture_name$$;

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

-- Fixed 75-second stale threshold uses heartbeat freshness, regardless of lease lifetime.
select pg_temp.add_recovery_job('fresh', 'RUNNING', interval '74 seconds');
select pg_temp.add_recovery_job('stale-live-lease', 'RUNNING');
insert into public.generation_leases (
  story_id, chapter_number, status, holder, expires_at, job_id, claim_token
)
select story_id, 2, 'ACTIVE', 'worker:stale-live-lease', clock_timestamp() + interval '5 minutes',
       job_id, claim_token
from pg_temp.recovery_jobs where fixture_name = 'stale-live-lease';

select is(public.recover_stale_generation_jobs_v1(100)->>'recovered_count', '1', 'stale heartbeat is recovered despite future matching active lease');
select is((select status from public.generation_jobs where id = pg_temp.job_id('fresh')), 'RUNNING', 'heartbeat newer than 75 seconds remains RUNNING');
select is(
  (select row(status, worker_id, claim_token, claimed_at, heartbeat_at)::text
   from public.generation_jobs where id = pg_temp.job_id('stale-live-lease')),
  row('RETRY_WAIT', null::text, null::uuid, null::timestamptz, null::timestamptz)::text,
  'stale heartbeat recovery clears old ownership despite future lease'
);
select is((select status from public.generation_leases where job_id = pg_temp.job_id('stale-live-lease')), 'EXPIRED', 'stale heartbeat recovery expires matching future lease');

select pg_temp.add_recovery_job('heartbeat-fresh-first', 'RUNNING', interval '1 second', interval '-20 minutes', 1, 4, interval '2 hours');
insert into public.generation_leases (
  story_id, chapter_number, status, holder, expires_at, job_id, claim_token
)
select story_id, 2, 'ACTIVE', 'worker:heartbeat-fresh-first', clock_timestamp() + interval '5 minutes',
       job_id, claim_token
from pg_temp.recovery_jobs where fixture_name = 'heartbeat-fresh-first';
select pg_temp.add_recovery_job('eligible-behind-fresh', 'RUNNING', interval '90 seconds', interval '-20 minutes', 1, 4, interval '90 seconds');
select is(public.recover_stale_generation_jobs_v1(1)->>'recovered_count', '1', 'heartbeat-fresh row does not consume batch slot before eligible row');
select is(
  (select row(p.status, e.status)::text
   from public.generation_jobs p, public.generation_jobs e
   where p.id = pg_temp.job_id('heartbeat-fresh-first')
     and e.id = pg_temp.job_id('eligible-behind-fresh')),
  row('RUNNING', 'RETRY_WAIT')::text,
  'batch one leaves heartbeat-fresh row and recovers eligible stale row'
);

-- Stale unpublished attempt retries immediately, clears owner tuple, and expires only matching lease.
select pg_temp.add_recovery_job('retry', 'RUNNING');
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
)
select '62000000-0000-4000-8000-000000000001', story_id, 2, 'ACTIVE', 'worker:retry',
       clock_timestamp() - interval '1 second', job_id, claim_token
from pg_temp.recovery_jobs where fixture_name = 'retry';
insert into public.generation_leases (
  id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
)
select '62000000-0000-4000-8000-000000000002', story_id, 2, 'RELEASED', 'other-worker',
       clock_timestamp() - interval '1 minute', job_id, gen_random_uuid()
from pg_temp.recovery_jobs where fixture_name = 'retry';

select is(public.recover_stale_generation_jobs_v1(1)->>'recovered_count', '1', 'one stale unpublished attempt is recovered');
select is(
  (select row(status, available_at <= clock_timestamp(), worker_id, claim_token, claimed_at, heartbeat_at,
              last_error_code, last_error_class)::text
   from public.generation_jobs where id = pg_temp.job_id('retry')),
  row('RETRY_WAIT', true, null::text, null::uuid, null::timestamptz, null::timestamptz,
      'WORKER_ATTEMPT_INTERRUPTED', 'TRANSIENT')::text,
  'stale unpublished job retries immediately with cleared owner tuple'
);
select is((select status from public.generation_leases where id = '62000000-0000-4000-8000-000000000001'), 'EXPIRED', 'matching old job and token lease expires');
select is((select status from public.generation_leases where id = '62000000-0000-4000-8000-000000000002'), 'RELEASED', 'unrelated token lease remains untouched');
select is(
  (select row(attempt_number, workflow_phase, retry_decision, error_code, worker_id,
              ended_at >= started_at, elapsed_ms >= 0)::text
   from public.generation_job_attempts where job_id = pg_temp.job_id('retry')),
  row(1, 'WORKER_ATTEMPT_INTERRUPTED', 'RETRY_IMMEDIATE', 'WORKER_ATTEMPT_INTERRUPTED',
      'worker:retry', true, true)::text,
  'retry recovery writes one sanitized parent-bound interrupted attempt'
);
select is(public.recover_stale_generation_jobs_v1(100)->>'recovered_count', '0', 'recovery replay is idempotent');
select is((select count(*) from public.generation_job_attempts where job_id = pg_temp.job_id('retry')), 1::bigint, 'recovery replay does not duplicate telemetry');
select is((select count(*) from public.generation_jobs where id = pg_temp.job_id('retry')), 1::bigint, 'recovered job row remains durable');

-- Existing chapter requires exact publisher key/story/scope/chapter/success proof.
select pg_temp.add_recovery_job('published-v2', 'RUNNING');
insert into public.chapters (story_id, number, title, paragraphs)
select story_id, 2, 'Published V2', '["published"]'::jsonb from pg_temp.recovery_jobs where fixture_name = 'published-v2';
insert into public.idempotency_keys (key, story_id, scope, result)
select 'generation-job:' || job_id::text || ':publish:2', story_id, 'publish_chapter_v2:2',
       '{"ok":true,"chapter_number":2,"seq":17}'::jsonb
from pg_temp.recovery_jobs where fixture_name = 'published-v2';

select pg_temp.add_recovery_job('published-legacy', 'RUNNING');
insert into public.chapters (story_id, number, title, paragraphs)
select story_id, 2, 'Published legacy', '["published"]'::jsonb from pg_temp.recovery_jobs where fixture_name = 'published-legacy';
insert into public.idempotency_keys (key, story_id, scope, result)
select 'generation-job:' || job_id::text || ':publish:2', story_id, 'publish_chapter',
       '{"ok":true,"chapter_number":2,"seq":18}'::jsonb
from pg_temp.recovery_jobs where fixture_name = 'published-legacy';

select pg_temp.add_recovery_job('publication-conflict', 'RUNNING');
insert into public.chapters (story_id, number, title, paragraphs)
select story_id, 2, 'Conflict', '["published"]'::jsonb from pg_temp.recovery_jobs where fixture_name = 'publication-conflict';
insert into public.idempotency_keys (key, story_id, scope, result)
select 'generation-job:' || job_id::text || ':publish:2', story_id, 'publish_chapter_v2:2',
       '{"ok":true,"chapter_number":3,"seq":19}'::jsonb
from pg_temp.recovery_jobs where fixture_name = 'publication-conflict';

select is(public.recover_stale_generation_jobs_v1(3)->>'recovered_count', '3', 'published and conflicting stale attempts are bounded together');
select is(
  (select row(status, publication_result)::text from public.generation_jobs where id = pg_temp.job_id('published-v2')),
  row('SUCCEEDED', '{"ok":true,"seq":17,"chapter_number":2}'::jsonb)::text,
  'matching V2 publication proof resolves SUCCEEDED'
);
select is((select status from public.generation_jobs where id = pg_temp.job_id('published-legacy')), 'SUCCEEDED', 'matching legacy publication proof resolves SUCCEEDED');
select is(
  (select row(status, last_error_code, publication_result)::text from public.generation_jobs where id = pg_temp.job_id('publication-conflict')),
  row('FAILED', 'GENERATION_PUBLICATION_CONFLICT', null::jsonb)::text,
  'unrelated chapter result proof resolves publication conflict'
);
select is(
  (select row(retry_decision, error_code)::text from public.generation_job_attempts where job_id = pg_temp.job_id('published-v2')),
  row(null::text, null::text)::text,
  'successful recovery telemetry has no retry or error'
);
select is(
  (select row(retry_decision, error_code)::text from public.generation_job_attempts where job_id = pg_temp.job_id('publication-conflict')),
  row(null::text, 'GENERATION_PUBLICATION_CONFLICT')::text,
  'conflict recovery telemetry carries exact terminal error and no retry'
);

-- Deadline sweep includes QUEUED/RETRY_WAIT and stale RUNNING; exhaustion wins over retry.
select pg_temp.add_recovery_job('overdue-queued', 'QUEUED', interval '0', interval '1 minute', 0, 4, interval '20 minutes');
select pg_temp.add_recovery_job('overdue-retry-wait', 'RETRY_WAIT', interval '76 seconds', interval '1 minute', 1, 4, interval '19 minutes');
select pg_temp.add_recovery_job('overdue-running', 'RUNNING', interval '76 seconds', interval '1 minute', 1, 4, interval '18 minutes');
select pg_temp.add_recovery_job('overdue-running-fresh-lease', 'RUNNING', interval '1 second', interval '1 minute', 1, 4, interval '17 minutes 30 seconds');
insert into public.generation_leases (
  story_id, chapter_number, status, holder, expires_at, job_id, claim_token
)
select story_id, 2, 'ACTIVE', 'worker:overdue-running-fresh-lease', clock_timestamp() + interval '5 minutes',
       job_id, claim_token
from pg_temp.recovery_jobs where fixture_name = 'overdue-running-fresh-lease';
select pg_temp.add_recovery_job('exhausted-running', 'RUNNING', interval '76 seconds', interval '-20 minutes', 1, 1, interval '17 minutes');

select is(public.recover_stale_generation_jobs_v1(5)->>'recovered_count', '5', 'bounded sweep handles overdue queue states and stale running attempts');
select is((select count(*) from public.generation_jobs where id in (pg_temp.job_id('overdue-queued'), pg_temp.job_id('overdue-retry-wait'), pg_temp.job_id('overdue-running')) and status = 'FAILED' and last_error_code = 'GENERATION_DEADLINE_EXCEEDED'), 3::bigint, 'overdue QUEUED, RETRY_WAIT, and stale RUNNING fail deadline');
select is(
  (select row(j.status, j.worker_id, j.claim_token, l.status)::text
   from public.generation_jobs j
   join public.generation_leases l on l.job_id = j.id
   where j.id = pg_temp.job_id('overdue-running-fresh-lease')),
  row('FAILED', null::text, null::uuid, 'EXPIRED')::text,
  'overdue RUNNING fails deadline and clears ownership despite fresh heartbeat and future lease'
);
select is((select row(status, last_error_code)::text from public.generation_jobs where id = pg_temp.job_id('exhausted-running')), row('FAILED', 'GENERATION_RETRY_EXHAUSTED')::text, 'attempt-exhausted stale RUNNING fails retry exhaustion');
select is(
  (select row(retry_decision, error_code)::text from public.generation_job_attempts where job_id = pg_temp.job_id('overdue-running')),
  row(null::text, 'GENERATION_DEADLINE_EXCEEDED')::text,
  'deadline telemetry carries exact terminal error and no retry'
);
select is(
  (select row(retry_decision, error_code)::text from public.generation_job_attempts where job_id = pg_temp.job_id('exhausted-running')),
  row(null::text, 'GENERATION_RETRY_EXHAUSTED')::text,
  'exhaustion telemetry carries exact terminal error and no retry'
);

-- Total batch cap is shared across deterministic Q/RW deadline and stale RUNNING order.
select pg_temp.add_recovery_job('batch-oldest', 'QUEUED', interval '0', interval '1 minute', 0, 4, interval '30 minutes');
select pg_temp.add_recovery_job('batch-middle', 'RUNNING', interval '90 seconds', interval '-20 minutes', 1, 4, interval '25 minutes');
select pg_temp.add_recovery_job('batch-newest', 'QUEUED', interval '0', interval '1 minute', 0, 4, interval '20 minutes');
select is(public.recover_stale_generation_jobs_v1(2)->>'recovered_count', '2', 'batch size caps total deadline and stale recovery rows');
select is(
  (select array_agg(fixture_name order by fixture_name) from pg_temp.recovery_jobs r join public.generation_jobs j on j.id = r.job_id where r.fixture_name like 'batch-%' and j.status = 'FAILED'),
  array['batch-newest','batch-oldest'],
  'deterministic ordering selects oldest eligible timestamps first'
);
select is((select status from public.generation_jobs where id = pg_temp.job_id('batch-middle')), 'RUNNING', 'row beyond total batch cap remains untouched');
select is(public.recover_stale_generation_jobs_v1(0), '{"recovered_count":0}'::jsonb, 'batch below one is rejected as bounded no-op');
select is(public.recover_stale_generation_jobs_v1(101), '{"recovered_count":0}'::jsonb, 'batch above 100 is rejected as bounded no-op');

-- Finish rejects unbounded durable error class and invalid telemetry before mutation.
select pg_temp.add_recovery_job('finish-validation', 'RUNNING', interval '1 second');
select is(
  pg_temp.try_json(format(
    'select public.finish_generation_job_attempt_v1(%L,%L,%L,%L,null,%L,%L,%L,null,null,%L,%L,0,null,null,null)',
    pg_temp.job_id('finish-validation'), 'worker:finish-validation',
    (select claim_token from pg_temp.recovery_jobs where fixture_name = 'finish-validation'),
    'FAILED', 'ERROR', repeat('x', 201), 'PHASE', clock_timestamp(), clock_timestamp()
  ))->>'message',
  'INVALID_ERROR_CLASS',
  'finish explicitly bounds durable error class'
);
select is(
  pg_temp.try_json(format(
    'select public.finish_generation_job_attempt_v1(%L,%L,%L,%L,null,%L,%L,%L,null,null,%L,%L,-1,null,null,null)',
    pg_temp.job_id('finish-validation'), 'worker:finish-validation',
    (select claim_token from pg_temp.recovery_jobs where fixture_name = 'finish-validation'),
    'FAILED', 'ERROR', 'TERMINAL', 'PHASE', clock_timestamp(), clock_timestamp()
  ))->>'message',
  'INVALID_ELAPSED_MS',
  'finish explicitly rejects negative metrics'
);
select is((select status from public.generation_jobs where id = pg_temp.job_id('finish-validation')), 'RUNNING', 'invalid finish telemetry leaves ownership unchanged');

select * from finish();
rollback;
