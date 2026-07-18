begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation job enqueue tests require local-cli';
  end if;
end
$$;

select plan(36);

select has_function(
  'public',
  'enqueue_generation_job_v1',
  array['text', 'integer', 'text', 'text'],
  'enqueue RPC has exact signature'
);
select function_returns(
  'public',
  'enqueue_generation_job_v1',
  array['text', 'integer', 'text', 'text'],
  'jsonb',
  'enqueue RPC returns jsonb'
);
select ok(
  coalesce((select p.prosecdef from pg_proc p
    where p.oid = to_regprocedure('public.enqueue_generation_job_v1(text,integer,text,text)')), false),
  'enqueue RPC is SECURITY DEFINER'
);
select is(
  (select p.proconfig from pg_proc p
   where p.oid = to_regprocedure('public.enqueue_generation_job_v1(text,integer,text,text)')),
  array['search_path=""']::text[],
  'enqueue RPC fixes empty search_path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.enqueue_generation_job_v1(text,integer,text,text)',
    'EXECUTE'
  ),
  'authenticated can execute enqueue RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.enqueue_generation_job_v1(text,integer,text,text)',
    'EXECUTE'
  ),
  'anon cannot execute enqueue RPC'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.enqueue_generation_job_v1(text,integer,text,text)')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no enqueue RPC EXECUTE grant'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.generation_jobs',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'authenticated has no direct generation_jobs privileges'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.generation_job_attempts',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'authenticated has no direct generation_job_attempts privileges'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('41000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'enqueue-owner@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp()),
  ('41000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'enqueue-reader@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp()),
  ('41000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'enqueue-stranger@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp())
on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values
  ('test:enqueue-standard-owned', 'Owned standard', '41000000-0000-4000-8000-000000000001', 'private', 'standard'),
  ('test:enqueue-personalized-owned', 'Owned personalized', '41000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('test:enqueue-premium-owned', 'Owned premium instance', '41000000-0000-4000-8000-000000000001', 'private', 'premium_instance'),
  ('test:enqueue-standard-public', 'Public standard', '41000000-0000-4000-8000-000000000001', 'public', 'standard'),
  ('test:enqueue-standard-public-no-state', 'Public standard without state', null, 'public', 'standard'),
  ('test:enqueue-private-other', 'Other private story', '41000000-0000-4000-8000-000000000001', 'private', 'standard');

insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name, updated_at
) values (
  '41000000-0000-4000-8000-000000000002',
  'test:enqueue-standard-public',
  'BERJALAN', 1, '[]'::jsonb, null, clock_timestamp()
);

insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values (
  'test:enqueue-standard-owned', 10, 'Existing chapter',
  '["Existing reader-safe prose."]'::jsonb, null, null
);

create temporary table test_enqueue_results (
  fixture_name text primary key,
  result jsonb not null
) on commit drop;
grant select, insert, update, delete on test_enqueue_results to authenticated;

create or replace function pg_temp.try_enqueue(
  p_story_id text,
  p_chapter_number integer,
  p_generation_kind text,
  p_trigger_choice_id text
)
returns jsonb
language plpgsql
as $$
declare
  v_data jsonb;
  v_sqlstate text;
  v_message text;
begin
  execute
    'select public.enqueue_generation_job_v1($1, $2, $3, $4)'
    into v_data
    using p_story_id, p_chapter_number, p_generation_kind, p_trigger_choice_id;
  return jsonb_build_object('ok', true, 'data', v_data);
exception when others then
  get stacked diagnostics
    v_sqlstate = returned_sqlstate,
    v_message = message_text;
  return jsonb_build_object(
    'ok', false,
    'sqlstate', v_sqlstate,
    'message', v_message
  );
end;
$$;
grant execute on function pg_temp.try_enqueue(text, integer, text, text) to authenticated, anon;

create or replace function pg_temp.assert_invalid_enqueue_inputs()
returns void
language plpgsql
as $$
declare
  v_case record;
  v_result jsonb;
begin
  for v_case in
    select * from (values
      (null::text, 2, 'standard'::text, null::text, 'INVALID_STORY_ID'::text),
      (''::text, 2, 'standard'::text, null::text, 'INVALID_STORY_ID'::text),
      (' test:enqueue-standard-owned ', 2, 'standard', null, 'INVALID_STORY_ID'),
      (repeat('s', 201), 2, 'standard', null, 'INVALID_STORY_ID'),
      ('test:enqueue-standard-owned', null::integer, 'standard', null, 'INVALID_CHAPTER_NUMBER'),
      ('test:enqueue-standard-owned', 0, 'standard', null, 'INVALID_CHAPTER_NUMBER'),
      ('test:enqueue-standard-owned', 51, 'standard', null, 'INVALID_CHAPTER_NUMBER'),
      ('test:enqueue-standard-owned', 2, null::text, null, 'INVALID_GENERATION_KIND'),
      ('test:enqueue-standard-owned', 2, 'STANDARD', null, 'INVALID_GENERATION_KIND'),
      ('test:enqueue-standard-owned', 2, 'standard', '', 'INVALID_TRIGGER_CHOICE_ID'),
      ('test:enqueue-standard-owned', 2, 'standard', ' padded ', 'INVALID_TRIGGER_CHOICE_ID'),
      ('test:enqueue-standard-owned', 2, 'standard', repeat('t', 201), 'INVALID_TRIGGER_CHOICE_ID'),
      ('test:enqueue-standard-owned', 2, 'standard', E'choice\nsecret', 'INVALID_TRIGGER_CHOICE_ID')
    ) cases(story_id, chapter_number, generation_kind, trigger_choice_id, expected_message)
  loop
    v_result := pg_temp.try_enqueue(
      v_case.story_id,
      v_case.chapter_number,
      v_case.generation_kind,
      v_case.trigger_choice_id
    );
    if v_result->>'sqlstate' is distinct from '22023'
      or v_result->>'message' is distinct from v_case.expected_message then
      raise exception 'unexpected invalid-input result';
    end if;
  end loop;
end;
$$;
grant execute on function pg_temp.assert_invalid_enqueue_inputs() to authenticated;

-- Preload active rows that exercise exact trigger, kind, and owner conflicts.
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
  status, max_attempts, deadline_at, correlation_id, publication_idempotency_key
) values
  (
    '42000000-0000-4000-8000-000000000020',
    'test:enqueue-standard-owned', 20,
    '41000000-0000-4000-8000-000000000001', 'standard', 'Choice:Original/20',
    'QUEUED', 4, clock_timestamp() + interval '20 minutes',
    '43000000-0000-4000-8000-000000000020',
    'generation-job:42000000-0000-4000-8000-000000000020:publish:20'
  ),
  (
    '42000000-0000-4000-8000-000000000021',
    'test:enqueue-standard-owned', 21,
    '41000000-0000-4000-8000-000000000001', 'personalized', 'Choice:Original/21',
    'QUEUED', 4, clock_timestamp() + interval '20 minutes',
    '43000000-0000-4000-8000-000000000021',
    'generation-job:42000000-0000-4000-8000-000000000021:publish:21'
  ),
  (
    '42000000-0000-4000-8000-000000000022',
    'test:enqueue-standard-public', 22,
    '41000000-0000-4000-8000-000000000001', 'standard', 'Choice:Original/22',
    'QUEUED', 4, clock_timestamp() + interval '20 minutes',
    '43000000-0000-4000-8000-000000000022',
    'generation-job:42000000-0000-4000-8000-000000000022:publish:22'
  );

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '', true);
select is(
  pg_temp.try_enqueue('test:enqueue-standard-owned', 2, 'standard', null)->>'message',
  'AUTH_REQUIRED',
  'authenticated call without auth.uid rejects'
);

select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
insert into test_enqueue_results (fixture_name, result)
values (
  'standard-new',
  pg_temp.try_enqueue(
    'test:enqueue-standard-owned', 2, 'standard', 'Choice:Opaque/UPPER_42'
  )
);
select ok(
  (select (result->>'ok')::boolean
          and jsonb_typeof(result->'data') = 'object'
          and (result->'data'->>'alreadyComplete')::boolean is false
          and (result->'data'->>'jobId')::uuid is not null
          and (result->'data'->>'correlationId')::uuid is not null
          and result->'data'->>'status' = 'QUEUED'
   from test_enqueue_results where fixture_name = 'standard-new'),
  'new standard request returns queued UUID identities'
);
select is(
  (select count(*) from jsonb_object_keys(
    (select result->'data' from test_enqueue_results where fixture_name = 'standard-new')
  )),
  4::bigint,
  'new enqueue result contains only reader-safe keys'
);
reset role;
select is(
  (select row(
     j.id::text,
     j.correlation_id::text,
     j.user_id,
     j.generation_kind,
     j.trigger_choice_id,
     j.status,
     j.attempt_count,
     j.max_attempts
   )::text
   from public.generation_jobs j
   where j.id = (
     select (result->'data'->>'jobId')::uuid
     from test_enqueue_results where fixture_name = 'standard-new'
   )),
  (select row(
     result->'data'->>'jobId',
     result->'data'->>'correlationId',
     '41000000-0000-4000-8000-000000000001'::uuid,
     'standard',
     'Choice:Opaque/UPPER_42',
     'QUEUED',
     0,
     4
   )::text from test_enqueue_results where fixture_name = 'standard-new'),
  'new row preserves opaque trigger and fixed queue defaults'
);
select ok(
  (select j.deadline_at >= j.created_at + interval '19 minutes 59 seconds'
          and j.deadline_at <= j.created_at + interval '20 minutes 1 second'
   from public.generation_jobs j
   where j.id = (
     select (result->'data'->>'jobId')::uuid
     from test_enqueue_results where fixture_name = 'standard-new'
   )),
  'new job deadline is twenty minutes after creation'
);
select is(
  (select j.publication_idempotency_key
   from public.generation_jobs j
   where j.id = (
     select (result->'data'->>'jobId')::uuid
     from test_enqueue_results where fixture_name = 'standard-new'
   )),
  (select 'generation-job:' || (result->'data'->>'jobId') || ':publish:2'
   from test_enqueue_results where fixture_name = 'standard-new'),
  'new job stores deterministic publication key from pregenerated UUID'
);
set local role authenticated;
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-owned', 2, 'standard', 'Choice:Opaque/UPPER_42'
  )->'data',
  (select result->'data' from test_enqueue_results where fixture_name = 'standard-new'),
  'exact duplicate returns same job and correlation IDs'
);
reset role;
select is(
  (select count(*) from public.generation_jobs
   where story_id = 'test:enqueue-standard-owned' and chapter_number = 2),
  1::bigint,
  'exact duplicate leaves one active row'
);
set local role authenticated;

select ok(
  (pg_temp.try_enqueue(
    'test:enqueue-personalized-owned', 3, 'personalized', null
  )->'data') @> '{"alreadyComplete":false,"status":"QUEUED"}'::jsonb,
  'private personalized owner can enqueue personalized generation'
);
select ok(
  (pg_temp.try_enqueue(
    'test:enqueue-premium-owned', 4, 'personalized', 'premium:Choice/4'
  )->'data') @> '{"alreadyComplete":false,"status":"QUEUED"}'::jsonb,
  'private premium instance owner can enqueue personalized generation'
);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-personalized-owned', 6, 'standard', null
  )->>'message',
  'GENERATION_JOB_CONFLICT',
  'personalized story rejects standard generation kind'
);
reset role;
select is(
  (select count(*) from public.generation_jobs
   where story_id = 'test:enqueue-personalized-owned' and chapter_number = 6),
  0::bigint,
  'generation kind incompatibility creates no job'
);
set local role authenticated;
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-owned', 7, 'personalized', null
  )->>'message',
  'GENERATION_JOB_CONFLICT',
  'standard story rejects personalized generation kind'
);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-owned', 20, 'standard', 'Choice:Different/20'
  )->>'message',
  'GENERATION_JOB_CONFLICT',
  'different trigger conflicts with active job'
);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-owned', 21, 'standard', 'Choice:Original/21'
  )->>'message',
  'GENERATION_JOB_CONFLICT',
  'different generation kind conflicts with active job'
);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-owned', 10, 'standard', null
  )->'data',
  '{"alreadyComplete":true,"jobId":null,"correlationId":null,"status":"SUCCEEDED"}'::jsonb,
  'existing chapter returns completed fast path with null IDs'
);
reset role;
select is(
  (select count(*) from public.generation_jobs
   where story_id = 'test:enqueue-standard-owned' and chapter_number = 10),
  0::bigint,
  'completed fast path creates no synthetic job'
);
set local role authenticated;
select lives_ok(
  $$select pg_temp.assert_invalid_enqueue_inputs()$$,
  'story, chapter, kind, and trigger input bounds reject exactly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
select ok(
  (pg_temp.try_enqueue(
    'test:enqueue-standard-public', 5, 'standard', 'Public:Choice/5'
  )->'data') @> '{"alreadyComplete":false,"status":"QUEUED"}'::jsonb,
  'standard reader with own state and readable story can enqueue'
);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-private-other', 8, 'standard', null
  )->>'message',
  'STORY_NOT_FOUND',
  'other user private story appears not found'
);
select is(
  pg_temp.try_enqueue(
    'test:missing-private-shaped-id', 8, 'standard', null
  )->>'message',
  'STORY_NOT_FOUND',
  'missing story uses same not-found result as unauthorized private story'
);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-public', 22, 'standard', 'Choice:Original/22'
  )->>'message',
  'GENERATION_JOB_CONFLICT',
  'different authorized owner conflicts with active job'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000003', true);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-public-no-state', 9, 'standard', null
  )->>'message',
  'STORY_NOT_FOUND',
  'public standard story without own reader state appears not found'
);
reset role;
select is(
  (select count(*) from public.generation_jobs
   where story_id = 'test:enqueue-standard-public-no-state'),
  0::bigint,
  'unauthorized standard reader creates no job'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select is(
  pg_temp.try_enqueue(
    'test:enqueue-standard-public', 30, 'standard', null
  )->>'sqlstate',
  '42501',
  'anon invocation is denied by function ACL'
);
reset role;

select is(
  (select count(*) from public.generation_jobs
   where story_id like 'test:enqueue-%'
     and chapter_number in (2, 3, 4, 5, 6, 7, 8, 9, 10, 30)),
  4::bigint,
  'only four authorized new jobs exist after all rejection paths'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.generation_jobs',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) and not has_table_privilege(
    'authenticated', 'public.generation_job_attempts',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'enqueue RPC leaves direct authenticated table grants absent'
);

select * from finish();
rollback;
