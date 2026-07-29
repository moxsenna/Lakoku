begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'checkpoint fencing tests require local-cli';
  end if;
end
$$;

select no_plan();

select has_function(
  'public', 'upsert_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','integer','bigint','bigint','text','text','integer','integer','integer'],
  'fenced checkpoint upsert has exact signature'
);
select function_returns(
  'public', 'upsert_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','integer','bigint','bigint','text','text','integer','integer','integer'],
  'jsonb', 'fenced checkpoint upsert returns jsonb'
);
select has_function(
  'public', 'transition_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','uuid','text'],
  'fenced checkpoint transition has exact signature'
);
select function_returns(
  'public', 'transition_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','uuid','text'],
  'jsonb', 'fenced checkpoint transition returns jsonb'
);

create temporary table checkpoint_fencing_signatures (
  function_name text primary key,
  identity text not null
) on commit drop;
insert into checkpoint_fencing_signatures values
  ('upsert_generation_checkpoint_fenced_v1', 'public.upsert_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer)'),
  ('transition_generation_checkpoint_fenced_v1', 'public.transition_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,uuid,text)');

select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure(identity)), false),
  function_name || ' is SECURITY DEFINER'
) from checkpoint_fencing_signatures order by function_name;
select is(
  (select proconfig from pg_proc where oid = to_regprocedure(identity)),
  array['search_path=pg_catalog, public']::text[], function_name || ' fixes canonical search_path'
) from checkpoint_fencing_signatures order by function_name;
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure(identity)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute ' || function_name
) from checkpoint_fencing_signatures order by function_name;
select ok(not has_function_privilege('anon', identity, 'EXECUTE'), 'anon cannot execute ' || function_name)
from checkpoint_fencing_signatures order by function_name;
select ok(not has_function_privilege('authenticated', identity, 'EXECUTE'), 'authenticated cannot execute ' || function_name)
from checkpoint_fencing_signatures order by function_name;
select ok(has_function_privilege('service_role', identity, 'EXECUTE'), 'service_role can execute ' || function_name)
from checkpoint_fencing_signatures order by function_name;
select ok(
  position('from public.generation_jobs' in pg_get_functiondef(to_regprocedure(identity)))
    < position('from public.generation_leases' in pg_get_functiondef(to_regprocedure(identity))),
  function_name || ' locks job before lease'
) from checkpoint_fencing_signatures order by function_name;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '54000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'checkpoint-fencing-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

create temporary table checkpoint_fencing_jobs (
  fixture_name text primary key, job_id uuid not null, story_id text not null,
  worker_id text not null, claim_token uuid not null, lease_id uuid not null
) on commit drop;

create or replace function pg_temp.add_checkpoint_job(p_fixture text, p_kind text default 'standard')
returns uuid language plpgsql as $$
declare
  v_job uuid := gen_random_uuid();
  v_story text := 'test:checkpoint-fencing:' || p_fixture;
  v_worker text := 'worker:' || p_fixture;
  v_token uuid := gen_random_uuid();
  v_lease uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values (v_story, 'Checkpoint ' || p_fixture, '54000000-0000-4000-8000-000000000001', 'private', p_kind);
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, max_attempts, available_at, deadline_at, publication_idempotency_key
  ) values (
    v_job, v_story, 2, '54000000-0000-4000-8000-000000000001', p_kind,
    'choice:' || p_fixture, 'QUEUED', 4, v_now - interval '1 minute',
    v_now + interval '20 minutes', 'generation-job:' || v_job::text || ':publish:2'
  );
  update public.generation_jobs
  set status = 'RUNNING', attempt_count = 1, worker_id = v_worker,
      claim_token = v_token, claimed_at = v_now - interval '2 seconds', heartbeat_at = v_now
  where id = v_job;
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (v_lease, v_story, 2, 'ACTIVE', v_worker, v_now + interval '10 minutes', v_job, v_token);
  insert into pg_temp.checkpoint_fencing_jobs values (p_fixture, v_job, v_story, v_worker, v_token, v_lease);
  return v_job;
end
$$;

create or replace function pg_temp.checkpoint_upsert(p_fixture text)
returns jsonb language sql as $$
  select public.upsert_generation_checkpoint_fenced_v1(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2,
    'Bab Fencing', '["Paragraf aman."]'::jsonb, 'prose-fingerprint-v2',
    case when (select generation_kind from public.generation_jobs where id = f.job_id) = 'personalized'
      then '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb else null end,
    case when (select generation_kind from public.generation_jobs where id = f.job_id) = 'personalized' then 1 else null end,
    7, 3, 'direction-fingerprint-v2',
    (select generation_kind from public.generation_jobs where id = f.job_id), 1, 1, 2
  ) from pg_temp.checkpoint_fencing_jobs f where f.fixture_name = p_fixture
$$;
create or replace function pg_temp.checkpoint_transition(p_fixture text, p_status text)
returns jsonb language sql as $$
  select public.transition_generation_checkpoint_fenced_v1(
    f.job_id, f.worker_id, f.claim_token, f.lease_id, f.story_id, 2, f.job_id, p_status
  ) from pg_temp.checkpoint_fencing_jobs f where f.fixture_name = p_fixture
$$;

select pg_temp.add_checkpoint_job('happy');
select is(pg_temp.checkpoint_upsert('happy')->>'result', 'UPDATED', 'upsert returns bounded UPDATED');
select is(
  (select row(attempt_id, correlation_id, status, job_id, job_attempt_number,
              checkpoint_schema_version, choice_attempt_count)::text
   from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:happy'),
  (select row(j.id, j.correlation_id, 'PROSE_READY', j.id, 1, 2, 0)::text
   from public.generation_jobs j where j.id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'happy')),
  'upsert derives complete protected checkpoint identity'
);
select is(pg_temp.checkpoint_upsert('happy')->>'result', 'UPDATED', 'same-attempt replay remains UPDATED');
select is((select count(*) from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:happy'), 1::bigint, 'same-attempt replay keeps one checkpoint row');
select is(pg_temp.checkpoint_transition('happy', 'RUNNING_CHOICES')->>'result', 'UPDATED', 'valid transition returns UPDATED');
select is((select choice_attempt_count from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:happy'), 1, 'entering RUNNING_CHOICES increments counter once');
select is((pg_temp.checkpoint_transition('happy', 'RUNNING_CHOICES')->>'changed')::boolean, false, 'same-status transition replay is idempotent');
select is((select choice_attempt_count from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:happy'), 1, 'same-status replay does not increment counter');
select is(pg_temp.checkpoint_transition('happy', 'PROSE_READY')->>'result', 'INVALID_TRANSITION', 'backward transition returns bounded INVALID_TRANSITION');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:happy'), 'RUNNING_CHOICES', 'invalid transition leaves checkpoint unchanged');
select is(pg_temp.checkpoint_transition('happy', 'CHOICES_RETRY_WAIT')->>'result', 'UPDATED', 'RUNNING_CHOICES can enter retry wait');

select pg_temp.add_checkpoint_job('expired-lease');
update public.generation_leases set expires_at = clock_timestamp() - interval '1 second'
where id = (select lease_id from checkpoint_fencing_jobs where fixture_name = 'expired-lease');
select is(pg_temp.checkpoint_upsert('expired-lease')->>'result', 'LEASE_INVALID', 'expired lease returns bounded LEASE_INVALID');
select is((select count(*) from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:expired-lease'), 0::bigint, 'expired lease causes no mutation');

select pg_temp.add_checkpoint_job('ownership');
update public.generation_jobs set status = 'RETRY_WAIT'
where id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'ownership');
select is(pg_temp.checkpoint_upsert('ownership')->>'result', 'OWNERSHIP_LOST', 'missing current ownership returns bounded OWNERSHIP_LOST');

select pg_temp.add_checkpoint_job('target');
select is(
  (select public.upsert_generation_checkpoint_fenced_v1(
    job_id, worker_id, claim_token, lease_id, 'wrong-story', 2, 'T', '["p"]', 'fp', null, null, 1, 1,
    'direction', 'standard', 1, 1, 1
  )->>'result' from checkpoint_fencing_jobs where fixture_name = 'target'),
  'PROVENANCE_CONFLICT', 'wrong target returns bounded PROVENANCE_CONFLICT'
);

select pg_temp.add_checkpoint_job('provenance');
select pg_temp.checkpoint_upsert('provenance');
update public.chapter_generation_checkpoints set generation_policy_version = 99
where story_id = 'test:checkpoint-fencing:provenance';
select is(pg_temp.checkpoint_upsert('provenance')->>'result', 'PROVENANCE_CONFLICT', 'different v2 freshness provenance cannot be overwritten');

select pg_temp.add_checkpoint_job('attempt-ahead');
select pg_temp.checkpoint_upsert('attempt-ahead');
update public.chapter_generation_checkpoints set job_attempt_number = 3
where story_id = 'test:checkpoint-fencing:attempt-ahead';
select is(pg_temp.checkpoint_upsert('attempt-ahead')->>'result', 'ATTEMPT_AHEAD', 'upsert rejects future checkpoint attempt with bounded ATTEMPT_AHEAD');
select is(pg_temp.checkpoint_transition('attempt-ahead', 'RUNNING_CHOICES')->>'result', 'ATTEMPT_AHEAD', 'transition rejects future checkpoint attempt with bounded ATTEMPT_AHEAD');
select is(
  (select row(status, choice_attempt_count)::text from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:attempt-ahead'),
  row('PROSE_READY', 0)::text, 'attempt-ahead rejection leaves row unchanged'
);

select pg_temp.add_checkpoint_job('earlier-attempt');
select pg_temp.checkpoint_upsert('earlier-attempt');
update public.generation_jobs set status = 'RETRY_WAIT'
where id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'earlier-attempt');
update public.generation_leases set status = 'EXPIRED'
where id = (select lease_id from checkpoint_fencing_jobs where fixture_name = 'earlier-attempt');
update public.generation_jobs set available_at = clock_timestamp() - interval '1 second'
where id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'earlier-attempt');
with claimed as (
  select public.claim_generation_job_by_id_v1(
    (select job_id from checkpoint_fencing_jobs where fixture_name = 'earlier-attempt'), 'worker:earlier-attempt:2'
  ) result
)
update checkpoint_fencing_jobs f
set worker_id = claimed.result->'job'->>'worker_id',
    claim_token = (claimed.result->'job'->>'claim_token')::uuid
from claimed where f.fixture_name = 'earlier-attempt';
with acquired as (
  select public.acquire_generation_job_lease_v1(f.job_id, f.worker_id, f.claim_token, 300) result
  from checkpoint_fencing_jobs f where f.fixture_name = 'earlier-attempt'
)
update checkpoint_fencing_jobs f
set lease_id = (acquired.result->>'lease_id')::uuid
from acquired where f.fixture_name = 'earlier-attempt';
select is(pg_temp.checkpoint_transition('earlier-attempt', 'RUNNING_CHOICES')->>'result', 'UPDATED', 'earlier attempt from same job remains reusable after reclaim');
select is(
  (select row(c.job_attempt_number, j.attempt_count)::text
   from public.chapter_generation_checkpoints c join public.generation_jobs j on j.id = c.job_id
   where c.story_id = 'test:checkpoint-fencing:earlier-attempt'),
  row(1, 2)::text, 'earlier checkpoint provenance remains below current attempt'
);

select pg_temp.add_checkpoint_job('terminal-expired');
select pg_temp.checkpoint_upsert('terminal-expired');
select is(pg_temp.checkpoint_transition('terminal-expired', 'EXPIRED')->>'result', 'UPDATED', 'EXPIRED terminal transition succeeds');
select ok(
  (select expires_at between clock_timestamp() + interval '59 minutes' and clock_timestamp() + interval '61 minutes'
   from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:terminal-expired'),
  'first EXPIRED transition sets one-hour expiry'
);
create temporary table terminal_expiry_snapshot(expires_at timestamptz) on commit drop;
insert into terminal_expiry_snapshot select expires_at from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:terminal-expired';
select is((pg_temp.checkpoint_transition('terminal-expired', 'EXPIRED')->>'changed')::boolean, false, 'EXPIRED replay is idempotent');
select is(
  (select expires_at from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:terminal-expired'),
  (select expires_at from terminal_expiry_snapshot), 'terminal replay does not extend expiry'
);

select pg_temp.add_checkpoint_job('published');
select pg_temp.checkpoint_upsert('published');
insert into public.chapters (story_id, number, title, paragraphs)
values ('test:checkpoint-fencing:published', 2, 'Published', '["published"]');
update public.generation_leases set status = 'RELEASED'
where id = (select lease_id from checkpoint_fencing_jobs where fixture_name = 'published');
update public.generation_jobs
set status = 'SUCCEEDED', publication_result = jsonb_build_object(
  'ok', true, 'jobId', id, 'chapter_number', chapter_number, 'seq', 1
)
where id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'published');
insert into public.idempotency_keys (key, story_id, scope, result)
select j.publication_idempotency_key, j.story_id,
       'publish_chapter_v2:' || j.chapter_number::text, j.publication_result
from public.generation_jobs j
where j.id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'published');
select is(pg_temp.checkpoint_transition('published', 'PUBLISHED')->>'result', 'UPDATED', 'post-publish proof permits PUBLISHED transition');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:published'), 'PUBLISHED', 'post-publish checkpoint becomes PUBLISHED');
select ok(
  (select expires_at between clock_timestamp() + interval '59 minutes' and clock_timestamp() + interval '61 minutes'
   from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:published'),
  'PUBLISHED transition sets one-hour expiry'
);

select pg_temp.add_checkpoint_job('publish-proof-missing');
select pg_temp.checkpoint_upsert('publish-proof-missing');
select is(pg_temp.checkpoint_transition('publish-proof-missing', 'PUBLISHED')->>'result', 'INVALID_TRANSITION', 'live job cannot claim post-publish completion');

select pg_temp.add_checkpoint_job('published-no-durable-proof');
select pg_temp.checkpoint_upsert('published-no-durable-proof');
insert into public.chapters (story_id, number, title, paragraphs)
values ('test:checkpoint-fencing:published-no-durable-proof', 2, 'Published', '["published"]');
update public.generation_leases set status = 'RELEASED'
where id = (select lease_id from checkpoint_fencing_jobs where fixture_name = 'published-no-durable-proof');
update public.generation_jobs
set status = 'SUCCEEDED', publication_result = jsonb_build_object(
  'ok', true, 'jobId', id, 'chapter_number', chapter_number, 'seq', 1
)
where id = (select job_id from checkpoint_fencing_jobs where fixture_name = 'published-no-durable-proof');
select is(
  pg_temp.checkpoint_transition('published-no-durable-proof', 'PUBLISHED')->>'result',
  'INVALID_TRANSITION',
  'terminal reconciliation rejects missing durable publication proof'
);

select pg_temp.add_checkpoint_job('late-rollback');
select pg_temp.checkpoint_upsert('late-rollback');
create or replace function pg_temp.transition_then_fail()
returns void language plpgsql as $$
begin
  perform pg_temp.checkpoint_transition('late-rollback', 'RUNNING_CHOICES');
  if (pg_temp.checkpoint_transition('late-rollback', 'PROSE_READY')->>'result') = 'INVALID_TRANSITION' then
    raise exception using errcode = 'P0001', message = 'LATE_INVALID_TRANSITION';
  end if;
end
$$;
select throws_ok(
  $$select pg_temp.transition_then_fail()$$,
  'P0001', 'LATE_INVALID_TRANSITION', 'late invalid transition aborts caller transaction scope'
);
select is(
  (select row(status, choice_attempt_count)::text from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-fencing:late-rollback'),
  row('PROSE_READY', 0)::text, 'late failure rolls back prior status and counter mutation'
);

select * from finish();
rollback;
