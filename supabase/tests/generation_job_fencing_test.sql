begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation job fencing tests require local-cli';
  end if;
end
$$;

select plan(42);

create temporary table fencing_signatures (
  function_name text primary key,
  arguments text[] not null,
  identity text not null
) on commit drop;
insert into fencing_signatures values
  (
    'publish_generation_job_chapter_v1',
    array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb'],
    'public.publish_generation_job_chapter_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb)'
  ),
  (
    'publish_generation_job_chapter_v2',
    array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb'],
    'public.publish_generation_job_chapter_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb)'
  );

select has_function('public', function_name, arguments, function_name || ' has exact signature')
from fencing_signatures order by function_name;
select function_returns('public', function_name, arguments, 'jsonb', function_name || ' returns jsonb')
from fencing_signatures order by function_name;
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure(identity)), false),
  function_name || ' is SECURITY DEFINER'
) from fencing_signatures order by function_name;
select is(
  (select proconfig from pg_proc where oid = to_regprocedure(identity)),
  array['search_path=""']::text[],
  function_name || ' fixes empty search_path'
) from fencing_signatures order by function_name;
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
) from fencing_signatures order by function_name;

select is(
  md5(pg_get_functiondef('public.publish_chapter(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure)),
  'e8f33f2aaca0b3343f8fe51200fc402b',
  'legacy publisher remains byte-stable'
);
select is(
  md5(pg_get_functiondef('public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)'::regprocedure)),
  'efcc06ecb050e48e561611951fdf11b7',
  'V2 publisher remains byte-stable'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'generation-fencing-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

create temporary table fencing_jobs (
  fixture_name text primary key,
  job_id uuid not null,
  story_id text not null,
  claim_token uuid not null,
  lease_id uuid not null
) on commit drop;

create or replace function pg_temp.effect_fixture()
returns jsonb language sql immutable
as $$
  select '{
    "routeDeltas": {},
    "trustDeltas": {},
    "flagsSet": {},
    "evidenceAdded": [],
    "endingBiasDeltas": {},
    "threadTouches": []
  }'::jsonb
$$;

create or replace function pg_temp.choices_fixture()
returns jsonb language sql immutable
as $$
  select '[
    {"id":"open-door","label":"Buka pintu gudang","hint":"Sari menunggu dekat gudang"},
    {"id":"stop-guard","label":"Hadang penjaga gudang"}
  ]'::jsonb
$$;

create or replace function pg_temp.outcomes_fixture(p_chapter integer)
returns jsonb language sql stable
as $$
  select jsonb_agg(jsonb_build_object(
    'choiceId', choice_id,
    'consequence', jsonb_build_array(consequence),
    'nextChapterNumber', p_chapter + 1,
    'isEnding', false,
    'effect_json', pg_temp.effect_fixture(),
    'choice_kind', 'normal'
  ) order by ordinal)
  from (values
    (1, 'open-door', 'Raka membuka pintu gudang.'),
    (2, 'stop-guard', 'Raka menghadang penjaga gudang.')
  ) fixture(ordinal, choice_id, consequence)
$$;

create or replace function pg_temp.add_fencing_job(
  p_fixture_name text,
  p_status text default 'RUNNING'
)
returns uuid
language plpgsql
as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_story_id text := 'test:generation-fencing:' || p_fixture_name;
  v_claim_token uuid := gen_random_uuid();
  v_lease_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values (
    v_story_id, 'Fencing ' || p_fixture_name,
    '71000000-0000-4000-8000-000000000001', 'private', 'standard'
  );

  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, max_attempts, available_at, deadline_at, created_at, updated_at,
    publication_idempotency_key
  ) values (
    v_job_id, v_story_id, 2, '71000000-0000-4000-8000-000000000001',
    'standard', 'choice:' || p_fixture_name, 'QUEUED', 4,
    v_now - interval '1 minute', v_now + interval '20 minutes',
    v_now - interval '5 minutes', v_now - interval '5 minutes',
    'generation-job:' || v_job_id::text || ':publish:2'
  );

  update public.generation_jobs
  set status = 'RUNNING', attempt_count = 1, worker_id = 'worker:' || p_fixture_name,
      claim_token = v_claim_token, claimed_at = v_now - interval '10 seconds',
      heartbeat_at = v_now - interval '1 second'
  where id = v_job_id;

  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (
    v_lease_id, v_story_id, 2, 'ACTIVE', 'worker:' || p_fixture_name,
    v_now + interval '10 minutes', v_job_id, v_claim_token
  );

  if p_status = 'CANCELLED' then
    update public.generation_jobs set status = 'CANCELLED' where id = v_job_id;
  elsif p_status = 'RETRY_WAIT' then
    update public.generation_jobs set status = 'RETRY_WAIT' where id = v_job_id;
    update public.generation_leases set status = 'EXPIRED' where id = v_lease_id;
  end if;

  insert into pg_temp.fencing_jobs values (
    p_fixture_name, v_job_id, v_story_id, v_claim_token, v_lease_id
  );
  return v_job_id;
end
$$;

create or replace function pg_temp.job_id(p_fixture_name text)
returns uuid language sql stable
as $$select job_id from pg_temp.fencing_jobs where fixture_name = p_fixture_name$$;
create or replace function pg_temp.story_id(p_fixture_name text)
returns text language sql stable
as $$select story_id from pg_temp.fencing_jobs where fixture_name = p_fixture_name$$;
create or replace function pg_temp.claim_token(p_fixture_name text)
returns uuid language sql stable
as $$select claim_token from pg_temp.fencing_jobs where fixture_name = p_fixture_name$$;
create or replace function pg_temp.lease_id(p_fixture_name text)
returns uuid language sql stable
as $$select lease_id from pg_temp.fencing_jobs where fixture_name = p_fixture_name$$;

create or replace function pg_temp.publish_fixture(
  p_version integer,
  p_fixture_name text,
  p_job_id uuid default null,
  p_worker_id text default null,
  p_claim_token uuid default null,
  p_lease_id uuid default null,
  p_story_id text default null,
  p_chapter_number integer default 2,
  p_title text default 'Bab Uji',
  p_paragraphs jsonb default '["Raka berdiri di depan pintu gudang."]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_job_id uuid := coalesce(p_job_id, pg_temp.job_id(p_fixture_name));
  v_worker_id text := coalesce(p_worker_id, 'worker:' || p_fixture_name);
  v_claim_token uuid := coalesce(p_claim_token, pg_temp.claim_token(p_fixture_name));
  v_lease_id uuid := coalesce(p_lease_id, pg_temp.lease_id(p_fixture_name));
  v_story_id text := coalesce(p_story_id, pg_temp.story_id(p_fixture_name));
begin
  if p_version = 1 then
    return public.publish_generation_job_chapter_v1(
      v_job_id, v_worker_id, v_claim_token, v_lease_id,
      v_story_id, p_chapter_number, p_title, p_paragraphs,
      'Apa yang Raka lakukan sekarang?', pg_temp.choices_fixture(),
      pg_temp.outcomes_fixture(p_chapter_number)
    );
  end if;
  return public.publish_generation_job_chapter_v2(
    v_job_id, v_worker_id, v_claim_token, v_lease_id,
    v_story_id, p_chapter_number, p_title, p_paragraphs,
    'Apa yang Raka lakukan sekarang?', pg_temp.choices_fixture(),
    pg_temp.outcomes_fixture(p_chapter_number)
  );
end
$$;

select pg_temp.add_fencing_job('v1-success');
select is(
  pg_temp.publish_fixture(1, 'v1-success')->>'jobId',
  pg_temp.job_id('v1-success')::text,
  'matching legacy tuple publishes and returns jobId'
);
select is(
  (select row(status, publication_result->>'jobId', completed_at is not null,
              worker_id, claim_token, claimed_at, heartbeat_at)::text
   from public.generation_jobs where id = pg_temp.job_id('v1-success')),
  row('SUCCEEDED', pg_temp.job_id('v1-success')::text, true,
      null::text, null::uuid, null::timestamptz, null::timestamptz)::text,
  'legacy publication stores result, completes job, and clears ownership atomically'
);
select is((select status from public.generation_leases where id = pg_temp.lease_id('v1-success')), 'RELEASED', 'legacy wrapper releases exact bound lease');
select is(
  (select row(attempt_number, workflow_phase, retry_decision, error_code, worker_id,
              ended_at >= started_at, elapsed_ms >= 0)::text
   from public.generation_job_attempts where job_id = pg_temp.job_id('v1-success')),
  row(1, 'PUBLICATION_SUCCEEDED', null::text, null::text, 'worker:v1-success', true, true)::text,
  'legacy wrapper inserts sanitized success telemetry'
);
select is(
  (select row(
    (select count(*) from public.chapters where story_id = pg_temp.story_id('v1-success') and number = 2),
    (select count(*) from public.story_events where story_id = pg_temp.story_id('v1-success') and type = 'CHAPTER_PUBLISHED'),
    (select count(*) from public.outbox where payload @> jsonb_build_object('story_id', pg_temp.story_id('v1-success'), 'chapter_number', 2))
  )::text),
  row(1::bigint, 1::bigint, 1::bigint)::text,
  'legacy chapter, event, and outbox commit once'
);

select pg_temp.add_fencing_job('v2-success');
select is(pg_temp.publish_fixture(2, 'v2-success')->>'jobId', pg_temp.job_id('v2-success')::text, 'matching V2 tuple publishes and returns jobId');
select is(
  (select row(status, publication_result->>'ok', completed_at is not null, worker_id, claim_token)::text
   from public.generation_jobs where id = pg_temp.job_id('v2-success')),
  row('SUCCEEDED', 'true', true, null::text, null::uuid)::text,
  'V2 publication and job success commit atomically'
);
select is((select status from public.generation_leases where id = pg_temp.lease_id('v2-success')), 'RELEASED', 'V2 wrapper releases exact bound lease');
select is((select count(*) from public.generation_job_attempts where job_id = pg_temp.job_id('v2-success') and workflow_phase = 'PUBLICATION_SUCCEEDED'), 1::bigint, 'V2 wrapper inserts one success attempt');
select is(
  (select row(
    (select count(*) from public.chapters where story_id = pg_temp.story_id('v2-success') and number = 2),
    (select count(*) from public.story_events where story_id = pg_temp.story_id('v2-success') and type = 'CHAPTER_PUBLISHED'),
    (select count(*) from public.outbox where payload @> jsonb_build_object('story_id', pg_temp.story_id('v2-success'), 'chapter_number', 2))
  )::text),
  row(1::bigint, 1::bigint, 1::bigint)::text,
  'V2 chapter, event, and outbox commit once'
);

select pg_temp.add_fencing_job('rejects');
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'rejects', gen_random_uuid())$$,
  'P0001', 'GENERATION_JOB_NOT_FOUND', 'unknown job rejects'
);
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'rejects', p_worker_id => 'worker:wrong')$$,
  'P0001', 'GENERATION_JOB_OWNERSHIP_LOST', 'wrong worker rejects'
);
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'rejects', p_claim_token => gen_random_uuid())$$,
  'P0001', 'GENERATION_JOB_OWNERSHIP_LOST', 'wrong claim token rejects'
);
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'rejects', p_lease_id => gen_random_uuid())$$,
  'P0001', 'GENERATION_JOB_LEASE_INVALID', 'wrong lease rejects'
);
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'rejects', p_story_id => 'test:generation-fencing:other')$$,
  'P0001', 'GENERATION_JOB_TARGET_MISMATCH', 'wrong story target rejects'
);
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'rejects', p_chapter_number => 3)$$,
  'P0001', 'GENERATION_JOB_TARGET_MISMATCH', 'wrong chapter target rejects'
);

select pg_temp.add_fencing_job('cancelled', 'CANCELLED');
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'cancelled')$$,
  'P0001', 'GENERATION_JOB_NOT_RUNNING', 'cancelled job rejects publication'
);
select pg_temp.add_fencing_job('recovered', 'RETRY_WAIT');
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'recovered')$$,
  'P0001', 'GENERATION_JOB_NOT_RUNNING', 'recovered job rejects stale publication'
);
select pg_temp.add_fencing_job('deadline');
alter table public.generation_jobs disable trigger generation_jobs_enforce_state_v1_trigger;
update public.generation_jobs set deadline_at = clock_timestamp() - interval '1 second' where id = pg_temp.job_id('deadline');
alter table public.generation_jobs enable trigger generation_jobs_enforce_state_v1_trigger;
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'deadline')$$,
  'P0001', 'GENERATION_JOB_DEADLINE_EXCEEDED', 'deadline-expired running job rejects publication'
);

select is(
  pg_temp.publish_fixture(
    2, 'v2-success', p_worker_id => 'worker:stale', p_claim_token => gen_random_uuid(),
    p_lease_id => gen_random_uuid(), p_story_id => 'wrong-story', p_chapter_number => 50,
    p_title => '', p_paragraphs => 'null'::jsonb
  ),
  (select publication_result from public.generation_jobs where id = pg_temp.job_id('v2-success')),
  'successful exact job replay returns stored result before live tuple, target, payload, or lease validation'
);
select is(
  (select row(
    (select count(*) from public.chapters where story_id = pg_temp.story_id('v2-success') and number = 2),
    (select count(*) from public.story_events where story_id = pg_temp.story_id('v2-success') and type = 'CHAPTER_PUBLISHED'),
    (select count(*) from public.outbox where payload @> jsonb_build_object('story_id', pg_temp.story_id('v2-success'), 'chapter_number', 2)),
    (select count(*) from public.generation_job_attempts where job_id = pg_temp.job_id('v2-success'))
  )::text),
  row(1::bigint, 1::bigint, 1::bigint, 1::bigint)::text,
  'duplicate wrapper replay creates no chapter, event, outbox, or telemetry duplicate'
);

select pg_temp.add_fencing_job('reconcile-v1');
insert into public.chapters (story_id, number, title, paragraphs)
values (pg_temp.story_id('reconcile-v1'), 2, 'Existing legacy', '["published"]');
insert into public.idempotency_keys (key, story_id, scope, result)
values (
  'generation-job:' || pg_temp.job_id('reconcile-v1')::text || ':publish:2',
  pg_temp.story_id('reconcile-v1'), 'publish_chapter',
  '{"ok":true,"chapter_number":2,"seq":17}'
);
select is(pg_temp.publish_fixture(1, 'reconcile-v1')->>'jobId', pg_temp.job_id('reconcile-v1')::text, 'matching legacy idempotency proof reconciles existing chapter to success');

select pg_temp.add_fencing_job('reconcile-v2');
insert into public.chapters (story_id, number, title, paragraphs)
values (pg_temp.story_id('reconcile-v2'), 2, 'Existing V2', '["published"]');
insert into public.idempotency_keys (key, story_id, scope, result)
values (
  'generation-job:' || pg_temp.job_id('reconcile-v2')::text || ':publish:2',
  pg_temp.story_id('reconcile-v2'), 'publish_chapter_v2:2',
  '{"ok":true,"chapter_number":2,"seq":18}'
);
select is(pg_temp.publish_fixture(2, 'reconcile-v2')->>'jobId', pg_temp.job_id('reconcile-v2')::text, 'matching V2 idempotency proof reconciles existing chapter to success');

select pg_temp.add_fencing_job('existing-conflict');
insert into public.chapters (story_id, number, title, paragraphs)
values (pg_temp.story_id('existing-conflict'), 2, 'Unrelated', '["unrelated"]');
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'existing-conflict')$$,
  'P0001', 'GENERATION_PUBLICATION_CONFLICT', 'unrelated pre-existing chapter rejects as publication conflict'
);

select pg_temp.add_fencing_job('proof-conflict');
insert into public.chapters (story_id, number, title, paragraphs)
values (pg_temp.story_id('proof-conflict'), 2, 'Wrong proof', '["unrelated"]');
insert into public.idempotency_keys (key, story_id, scope, result)
values (
  'generation-job:' || pg_temp.job_id('proof-conflict')::text || ':publish:2',
  pg_temp.story_id('proof-conflict'), 'publish_chapter',
  '{"ok":true,"chapter_number":3,"seq":19}'
);
select throws_ok(
  $$select pg_temp.publish_fixture(1, 'proof-conflict')$$,
  'P0001', 'GENERATION_PUBLICATION_CONFLICT', 'mismatched deterministic idempotency proof rejects'
);

select pg_temp.add_fencing_job('late');
create or replace function pg_temp.fail_fencing_outbox()
returns trigger language plpgsql
as $$
begin
  if current_setting('lakoku.test_target', true) = 'local-cli'
    and new.payload->>'story_id' = pg_temp.story_id('late') then
    raise exception using errcode = 'P0001', message = 'TASK7_TEST_OUTBOX_FAILURE';
  end if;
  return new;
end
$$;
create trigger task7_test_outbox_failure
before insert on public.outbox
for each row execute function pg_temp.fail_fencing_outbox();
select throws_ok(
  $$select pg_temp.publish_fixture(2, 'late')$$,
  'P0001', 'TASK7_TEST_OUTBOX_FAILURE', 'controlled late outbox failure aborts fenced publication'
);
select is(
  (select row(
    (select status from public.generation_jobs where id = pg_temp.job_id('late')),
    (select publication_result from public.generation_jobs where id = pg_temp.job_id('late')),
    (select status from public.generation_leases where id = pg_temp.lease_id('late')),
    (select count(*) from public.chapters where story_id = pg_temp.story_id('late')),
    (select count(*) from public.story_events where story_id = pg_temp.story_id('late')),
    (select count(*) from public.outbox where payload @> jsonb_build_object('story_id', pg_temp.story_id('late'))),
    (select count(*) from public.generation_job_attempts where job_id = pg_temp.job_id('late')),
    (select count(*) from public.idempotency_keys where key = 'generation-job:' || pg_temp.job_id('late')::text || ':publish:2')
  )::text),
  row('RUNNING', null::jsonb, 'ACTIVE', 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint)::text,
  'late failure rolls back chapter, job success, lease release, event, outbox, key, and success telemetry'
);
drop trigger task7_test_outbox_failure on public.outbox;
select is(pg_temp.publish_fixture(2, 'late')->>'ok', 'true', 'clean fenced retry succeeds after late failure removal');
select is(
  (select row(j.status, l.status,
              (select count(*) from public.chapters where story_id = pg_temp.story_id('late')),
              (select count(*) from public.story_events where story_id = pg_temp.story_id('late') and type = 'CHAPTER_PUBLISHED'),
              (select count(*) from public.outbox where payload @> jsonb_build_object('story_id', pg_temp.story_id('late'))),
              (select count(*) from public.generation_job_attempts where job_id = pg_temp.job_id('late')))::text
   from public.generation_jobs j
   join public.generation_leases l on l.id = pg_temp.lease_id('late')
   where j.id = pg_temp.job_id('late')),
  row('SUCCEEDED', 'RELEASED', 1::bigint, 1::bigint, 1::bigint, 1::bigint)::text,
  'clean retry commits chapter, job success, exact lease release, event, outbox, and telemetry once'
);

select ok(
  position('from public.generation_jobs' in pg_get_functiondef('public.publish_generation_job_chapter_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb)'::regprocedure))
    < position('from public.generation_leases' in pg_get_functiondef('public.publish_generation_job_chapter_v2(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb)'::regprocedure)),
  'wrapper source locks job before lease'
);

select * from finish();
rollback;
