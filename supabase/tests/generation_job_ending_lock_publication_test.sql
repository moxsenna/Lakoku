begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'ending lock publication tests require local-cli';
  end if;
end
$$;

select plan(26);

select has_function(
  'public', 'publish_generation_job_chapter_v3',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb','text','text'],
  'V3 has exact signature'
);
select function_returns(
  'public', 'publish_generation_job_chapter_v3',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb','text','text'],
  'jsonb', 'V3 returns jsonb'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)')), false),
  'V3 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)')),
  array['search_path=""']::text[], 'V3 fixes empty search_path'
);
select ok(
  has_function_privilege('service_role', 'public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)', 'EXECUTE')
    and not exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = to_regprocedure('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)')
        and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ),
  'V3 is service-role-only'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '72000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'ending-lock-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

create temporary table ending_lock_jobs (
  fixture_name text primary key,
  job_id uuid not null,
  story_id text not null,
  chapter_number integer not null,
  claim_token uuid not null,
  lease_id uuid not null
) on commit drop;

create or replace function pg_temp.add_ending_job(
  p_fixture_name text,
  p_personalized boolean default true,
  p_with_contract boolean default true
) returns void language plpgsql as $$
declare
  v_job_id uuid := gen_random_uuid();
  v_story_id text := 'test:ending-lock:' || p_fixture_name;
  v_chapter integer := case when p_personalized then 45 else 2 end;
  v_claim_token uuid := gen_random_uuid();
  v_lease_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode)
  values (v_story_id, 'Ending ' || p_fixture_name, '72000000-0000-4000-8000-000000000001', 'private', case when p_personalized then 'personalized_ai' else 'standard' end);

  if p_personalized then
    insert into public.reader_states (user_id, story_id)
    values ('72000000-0000-4000-8000-000000000001', v_story_id);
    if p_with_contract then
      insert into public.story_generation_contracts (story_id, mode)
      values (v_story_id, 'personalized_ai');
    end if;
  end if;

  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
    status, max_attempts, available_at, deadline_at, created_at, updated_at,
    publication_idempotency_key
  ) values (
    v_job_id, v_story_id, v_chapter, '72000000-0000-4000-8000-000000000001',
    case when p_personalized then 'personalized' else 'standard' end,
    'choice:' || p_fixture_name, 'QUEUED', 4, v_now - interval '1 minute',
    v_now + interval '20 minutes', v_now - interval '5 minutes', v_now - interval '5 minutes',
    'generation-job:' || v_job_id::text || ':publish:' || v_chapter::text
  );
  update public.generation_jobs
  set status = 'RUNNING', attempt_count = 1, worker_id = 'worker:' || p_fixture_name,
      claim_token = v_claim_token, claimed_at = v_now - interval '10 seconds', heartbeat_at = v_now
  where id = v_job_id;

  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (
    v_lease_id, v_story_id, v_chapter, 'ACTIVE', 'worker:' || p_fixture_name,
    v_now + interval '10 minutes', v_job_id, v_claim_token
  );

  insert into pg_temp.ending_lock_jobs values
    (p_fixture_name, v_job_id, v_story_id, v_chapter, v_claim_token, v_lease_id);
end
$$;

create or replace function pg_temp.publish_ending_job(
  p_fixture_name text,
  p_ending_key text default null,
  p_ending_name text default null,
  p_claim_token uuid default null
) returns jsonb language plpgsql as $$
declare v pg_temp.ending_lock_jobs%rowtype;
begin
  select * into strict v from pg_temp.ending_lock_jobs where fixture_name = p_fixture_name;
  return public.publish_generation_job_chapter_v3(
    v.job_id, 'worker:' || p_fixture_name, coalesce(p_claim_token, v.claim_token), v.lease_id,
    v.story_id, v.chapter_number, 'Bab Uji', '["Bab atomik diterbitkan."]'::jsonb,
    'Apa tindakan pembaca berikutnya?',
    '[{"id":"open-door","label":"Buka pintu arsip"},{"id":"stop-guard","label":"Hadang penjaga arsip"}]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('choiceId','open-door','consequence',jsonb_build_array('Pintu arsip terbuka.'),'nextChapterNumber',v.chapter_number + 1,'isEnding',false,'effect_json','{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,'choice_kind','normal'),
      jsonb_build_object('choiceId','stop-guard','consequence',jsonb_build_array('Penjaga arsip tiba.'),'nextChapterNumber',v.chapter_number + 1,'isEnding',false,'effect_json','{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,'choice_kind','normal')
    ),
    p_ending_key, p_ending_name
  );
end
$$;

select pg_temp.add_ending_job('valid');
select is(pg_temp.publish_ending_job('valid', 'publish-truth', 'Arsip Dibuka')->>'ok', 'true', 'valid personalized chapter 45 publishes');
select is(
  (select row(
    (select locked_ending_key from public.reader_states where story_id = j.story_id),
    (select ending_lock_json from public.story_generation_contracts where story_id = j.story_id),
    (select count(*) from public.chapters where story_id = j.story_id and number = 45),
    j.status, l.status
  )::text from pg_temp.ending_lock_jobs f
  join public.generation_jobs j on j.id = f.job_id
  join public.generation_leases l on l.id = f.lease_id
  where f.fixture_name = 'valid'),
  row('publish-truth', '{"key":"publish-truth","name":"Arsip Dibuka","lockedAtChapter":45}'::jsonb, 1::bigint, 'SUCCEEDED', 'RELEASED')::text,
  'chapter, lock, job success, and lease release commit atomically'
);

select is(
  pg_temp.publish_ending_job('valid', 'different-lock', 'Tidak Boleh Ditulis'),
  (select publication_result from public.generation_jobs where id = (select job_id from pg_temp.ending_lock_jobs where fixture_name = 'valid')),
  'SUCCEEDED replay returns stored result before lock validation'
);
select is(
  (select locked_ending_key from public.reader_states where story_id = (select story_id from pg_temp.ending_lock_jobs where fixture_name = 'valid')),
  'publish-truth', 'SUCCEEDED replay does not rewrite ending lock'
);

select pg_temp.add_ending_job('stale');
select throws_ok(
  $$select pg_temp.publish_ending_job('stale', 'publish-truth', 'Arsip Dibuka', gen_random_uuid())$$,
  'P0001', 'GENERATION_JOB_OWNERSHIP_LOST', 'stale token rejects before lock write'
);
select is(
  (select row(rs.locked_ending_key, count(c.*), j.status)::text
   from pg_temp.ending_lock_jobs f join public.reader_states rs on rs.story_id = f.story_id
   join public.generation_jobs j on j.id = f.job_id
   left join public.chapters c on c.story_id = f.story_id
   where f.fixture_name = 'stale' group by rs.locked_ending_key, j.status),
  row(null::text, 0::bigint, 'RUNNING')::text, 'stale token leaves no lock or chapter'
);

select pg_temp.add_ending_job('expired');
update public.generation_leases set expires_at = clock_timestamp() - interval '1 second'
where id = (select lease_id from pg_temp.ending_lock_jobs where fixture_name = 'expired');
select throws_ok(
  $$select pg_temp.publish_ending_job('expired', 'publish-truth', 'Arsip Dibuka')$$,
  'P0001', 'GENERATION_JOB_LEASE_INVALID', 'expired lease rejects publication'
);
select is(
  (select row(rs.locked_ending_key, count(c.*), j.status)::text
   from pg_temp.ending_lock_jobs f join public.reader_states rs on rs.story_id = f.story_id
   join public.generation_jobs j on j.id = f.job_id
   left join public.chapters c on c.story_id = f.story_id
   where f.fixture_name = 'expired' group by rs.locked_ending_key, j.status),
  row(null::text, 0::bigint, 'RUNNING')::text, 'expired lease leaves no lock or chapter'
);

select pg_temp.add_ending_job('lock-failure', true, false);
select throws_ok(
  $$select pg_temp.publish_ending_job('lock-failure', 'publish-truth', 'Arsip Dibuka')$$,
  'P0002', 'CONTRACT_MISSING', 'ending-lock persistence failure aborts publication'
);
select is(
  (select row(rs.locked_ending_key, count(c.*), j.status, l.status)::text
   from pg_temp.ending_lock_jobs f join public.reader_states rs on rs.story_id = f.story_id
   join public.generation_jobs j on j.id = f.job_id join public.generation_leases l on l.id = f.lease_id
   left join public.chapters c on c.story_id = f.story_id
   where f.fixture_name = 'lock-failure' group by rs.locked_ending_key, j.status, l.status),
  row(null::text, 0::bigint, 'RUNNING', 'ACTIVE')::text,
  'lock failure rolls chapter, reader lock, job success, and lease release back'
);

select pg_temp.add_ending_job('late-ending');
create or replace function pg_temp.fail_ending_publication_outbox()
returns trigger language plpgsql
as $$
begin
  if current_setting('lakoku.test_target', true) = 'local-cli'
    and new.payload->>'story_id' = (select story_id from pg_temp.ending_lock_jobs where fixture_name = 'late-ending') then
    raise exception using errcode = 'P0001', message = 'ENDING_TEST_LATE_FAILURE';
  end if;
  return new;
end
$$;
create trigger ending_test_late_failure
before insert on public.outbox
for each row execute function pg_temp.fail_ending_publication_outbox();
select throws_ok(
  $$select pg_temp.publish_ending_job('late-ending', 'publish-truth', 'Arsip Dibuka')$$,
  'P0001', 'ENDING_TEST_LATE_FAILURE', 'late publication failure follows early ending persistence'
);
select is(
  (select row(rs.locked_ending_key, c.ending_lock_json, count(ch.*), j.status, l.status)::text
   from pg_temp.ending_lock_jobs f join public.reader_states rs on rs.story_id = f.story_id
   join public.story_generation_contracts c on c.story_id = f.story_id
   join public.generation_jobs j on j.id = f.job_id join public.generation_leases l on l.id = f.lease_id
   left join public.chapters ch on ch.story_id = f.story_id
   where f.fixture_name = 'late-ending'
   group by rs.locked_ending_key, c.ending_lock_json, j.status, l.status),
  row(null::text, null::jsonb, 0::bigint, 'RUNNING', 'ACTIVE')::text,
  'late fence failure rolls early reader and contract ending updates back with publication'
);
drop trigger ending_test_late_failure on public.outbox;

select pg_temp.add_ending_job('partial');
select throws_ok(
  $$select pg_temp.publish_ending_job('partial', 'publish-truth', null)$$,
  '22023', 'INVALID_ENDING_LOCK_PAYLOAD', 'partial ending lock payload rejects'
);
select pg_temp.add_ending_job('ordinary', false, false);
select throws_ok(
  $$select pg_temp.publish_ending_job('ordinary', 'publish-truth', 'Arsip Dibuka')$$,
  '22023', 'INVALID_ENDING_LOCK_TARGET', 'ending lock rejects ordinary target'
);
select is(pg_temp.publish_ending_job('ordinary')->>'ok', 'true', 'ordinary null-lock V3 publication succeeds');
select is(
  (select row(j.status, l.status, count(c.*))::text
   from pg_temp.ending_lock_jobs f join public.generation_jobs j on j.id = f.job_id
   join public.generation_leases l on l.id = f.lease_id left join public.chapters c on c.story_id = f.story_id
   where f.fixture_name = 'ordinary' group by j.status, l.status),
  row('SUCCEEDED', 'RELEASED', 1::bigint)::text, 'ordinary null-lock behavior preserves fenced success'
);

select ok(
  position('public.persist_ending_lock_v1' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure))
    < position('pg_advisory_xact_lock' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure)),
  'V3 ending path persists E-R-C before story lock'
);
select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure))
    < position('for update' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure)),
  'V3 acquires story lock before locking job'
);
select ok(
  position('for update' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure))
    < position('from public.generation_leases' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure)),
  'V3 locks job before lease'
);
select ok(
  position('from public.generation_leases' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure))
    < position('public.publish_chapter_v2' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure)),
  'V3 locks lease before publishing'
);
select ok(
  position('public.publish_chapter_v2' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure))
    < position('update public.generation_jobs' in pg_get_functiondef('public.publish_generation_job_chapter_v3(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text)'::regprocedure)),
  'V3 finalizes job only after publication'
);

select * from finish();
rollback;
