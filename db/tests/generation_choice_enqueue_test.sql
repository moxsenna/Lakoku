begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'generation choice enqueue tests require local-cli';
  end if;
end
$$;

select plan(65);

select has_function(
  'public', 'apply_personalized_choice_and_enqueue_generation_v1',
  array['text','integer','text','text','jsonb','jsonb','jsonb','jsonb'],
  'personalized combined RPC has exact signature'
);
select has_function(
  'public', 'apply_standard_choice_and_enqueue_generation_v1',
  array['text','integer','text','text'],
  'standard combined RPC has exact signature'
);
select has_function(
  'public', 'enqueue_generation_job_internal_v1',
  array['uuid','text','integer','text','text'],
  'private enqueue helper has exact signature'
);
select function_returns(
  'public', 'apply_personalized_choice_and_enqueue_generation_v1',
  array['text','integer','text','text','jsonb','jsonb','jsonb','jsonb'], 'jsonb',
  'personalized combined RPC returns jsonb'
);
select function_returns(
  'public', 'apply_standard_choice_and_enqueue_generation_v1',
  array['text','integer','text','text'], 'jsonb',
  'standard combined RPC returns jsonb'
);
select function_returns(
  'public', 'enqueue_generation_job_internal_v1',
  array['uuid','text','integer','text','text'], 'jsonb',
  'private enqueue helper returns jsonb'
);

create temporary table task8_functions (
  function_name text primary key,
  identity text not null
) on commit drop;
insert into task8_functions values
  ('apply_personalized_choice_and_enqueue_generation_v1',
   'public.apply_personalized_choice_and_enqueue_generation_v1(text,integer,text,text,jsonb,jsonb,jsonb,jsonb)'),
  ('apply_standard_choice_and_enqueue_generation_v1',
   'public.apply_standard_choice_and_enqueue_generation_v1(text,integer,text,text)'),
  ('enqueue_generation_job_internal_v1',
   'public.enqueue_generation_job_internal_v1(uuid,text,integer,text,text)');

select ok(
  coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure(identity)), false),
  function_name || ' is SECURITY DEFINER'
) from task8_functions order by function_name;
select is(
  (select p.proconfig from pg_proc p where p.oid = to_regprocedure(identity)),
  array['search_path=""']::text[], function_name || ' fixes empty search_path'
) from task8_functions order by function_name;
select ok(
  not has_function_privilege('anon', identity, 'EXECUTE')
    and not exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = to_regprocedure(identity)
        and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ),
  function_name || ' denies anon and PUBLIC execution'
) from task8_functions order by function_name;
select ok(
  case when function_name = 'enqueue_generation_job_internal_v1'
    then not has_function_privilege('authenticated', identity, 'EXECUTE')
    else has_function_privilege('authenticated', identity, 'EXECUTE')
  end,
  function_name || ' has exact authenticated execution boundary'
) from task8_functions order by function_name;

select ok(
  not has_table_privilege('authenticated', 'public.generation_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('authenticated', 'public.personalized_choice_applications', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('authenticated', 'public.personalized_choice_idempotency_keys', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'combined RPCs add no authenticated direct internal-table grants'
);
select has_function(
  'public', 'apply_personalized_choice',
  array['uuid','text','integer','text','text','jsonb','jsonb','jsonb','jsonb'],
  'old personalized choice RPC signature remains available'
);
select ok(
  has_function_privilege('service_role',
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated',
      'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE'),
  'old personalized choice RPC execution boundary remains unchanged'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task8-a@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
  ('81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task8-b@example.invalid', '', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp())
on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode) values
  ('test:t8:p-ok', 'P ok', '81000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('test:t8:p-conflict', 'P conflict', '81000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('test:t8:p-fail', 'P fail', '81000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('test:t8:p-ending', 'P ending', '81000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('test:t8:p-complete', 'P complete', '81000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('test:t8:s-public', 'S public', '81000000-0000-4000-8000-000000000001', 'public', 'standard'),
  ('test:t8:s-owner', 'S owner', '81000000-0000-4000-8000-000000000001', 'private', 'standard'),
  ('test:t8:s-ending', 'S ending', '81000000-0000-4000-8000-000000000001', 'public', 'standard'),
  ('test:t8:s-skip', 'S skip', '81000000-0000-4000-8000-000000000001', 'public', 'standard');

insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices) values
  ('test:t8:p-ok', 1, 'P1', '["p"]', 'Choose', '[{"id":"go","label":"Buka pintu"}]'),
  ('test:t8:p-conflict', 1, 'P1', '["p"]', 'Choose', '[{"id":"go","label":"Buka pintu"}]'),
  ('test:t8:p-fail', 1, 'P1', '["p"]', 'Choose', '[{"id":"real","label":"Pilihan nyata"}]'),
  ('test:t8:p-ending', 49, 'P49', '["p"]', 'Choose', '[{"id":"end","label":"Akhiri kisah"}]'),
  ('test:t8:p-complete', 1, 'P1', '["p"]', 'Choose', '[{"id":"go","label":"Buka pintu"}]'),
  ('test:t8:p-complete', 2, 'P2 ready', '["ready"]', null, null),
  ('test:t8:s-public', 3, 'S3', '["s"]', 'Choose', '[{"id":"left","label":"Belok kiri"},{"id":"right","label":"Belok kanan"}]'),
  ('test:t8:s-owner', 1, 'S1', '["s"]', 'Choose', '[{"id":"open","label":"Buka gerbang"}]'),
  ('test:t8:s-ending', 7, 'S7', '["s"]', 'Choose', '[{"id":"end","label":"Pulang"}]'),
  ('test:t8:s-skip', 1, 'S1', '["s"]', 'Choose', '[{"id":"one","label":"Langkah satu"},{"id":"one-alt","label":"Langkah lain"}]'),
  ('test:t8:s-skip', 2, 'S2', '["s"]', 'Choose', '[{"id":"two","label":"Langkah dua"}]'),
  ('test:t8:s-skip', 3, 'S3', '["s"]', 'Choose', '[{"id":"three","label":"Langkah tiga"}]');

insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending, effect_json, choice_kind
) values
  ('test:t8:p-ok', 1, 'go', '["Pintu terbuka"]', 2, false, '{"routeDeltas":{"truth":1},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}', 'normal'),
  ('test:t8:p-conflict', 1, 'go', '["Pintu terbuka"]', 2, false, '{"routeDeltas":{"truth":1},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}', 'normal'),
  ('test:t8:p-ending', 49, 'end', '["Akhir sunyi"]', null, true, '{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}', 'special_bad_ending'),
  ('test:t8:p-complete', 1, 'go', '["Pintu terbuka"]', 2, false, '{"routeDeltas":{"truth":1},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}', 'normal'),
  ('test:t8:s-public', 3, 'left', '["Jalan kiri dipilih"]', 4, false, '{}'::jsonb, 'normal'),
  ('test:t8:s-public', 3, 'right', '["Jalan kanan dipilih"]', 4, false, '{}'::jsonb, 'normal'),
  ('test:t8:s-owner', 1, 'open', '["Gerbang terbuka"]', 2, false, '{}'::jsonb, 'normal'),
  ('test:t8:s-ending', 7, 'end', '["Kembali ke rumah"]', null, true, '{}'::jsonb, 'normal'),
  ('test:t8:s-skip', 1, 'one', '["Bab satu dipilih"]', 2, false, '{}'::jsonb, 'normal'),
  ('test:t8:s-skip', 1, 'one-alt', '["Bab satu lain"]', 2, false, '{}'::jsonb, 'normal'),
  ('test:t8:s-skip', 2, 'two', '["Bab dua dipilih"]', 3, false, '{}'::jsonb, 'normal'),
  ('test:t8:s-skip', 3, 'three', '["Bab tiga dipilih"]', 4, false, '{}'::jsonb, 'normal');

insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name, route_state, choice_history, locked_ending_key, updated_at
) values
  ('81000000-0000-4000-8000-000000000001', 'test:t8:p-ok', 'BERJALAN', 1, '[]', null, '{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000001', 'test:t8:p-conflict', 'BERJALAN', 1, '[]', null, '{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000001', 'test:t8:p-fail', 'BERJALAN', 1, '[]', null, '{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000001', 'test:t8:p-ending', 'BERJALAN', 49, '[]', null, '{"trust":{},"evidence":[],"flags":{},"endingBias":{}}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000001', 'test:t8:p-complete', 'BERJALAN', 1, '[]', null, '{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000002', 'test:t8:s-public', 'BERJALAN', 3, '[{"chapter":1,"decision":"Lama","consequence":"lama"},{"chapter":3,"decision":"Usang","consequence":"usang"}]', null, '{}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000001', 'test:t8:s-owner', 'BARU', 1, '[]', null, '{}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000002', 'test:t8:s-ending', 'BERJALAN', 7, '[]', null, '{}', '[]', null, '2026-07-18T00:00:00Z'),
  ('81000000-0000-4000-8000-000000000002', 'test:t8:s-skip', 'BERJALAN', 1, '[]', null, '{}', '[]', null, '2026-07-18T00:00:00Z');

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id,
  status, max_attempts, deadline_at, correlation_id, publication_idempotency_key
) values (
  '82000000-0000-4000-8000-000000000001', 'test:t8:p-conflict', 2,
  '81000000-0000-4000-8000-000000000001', 'personalized', 'different-choice',
  'QUEUED', 4, clock_timestamp() + interval '20 minutes',
  '83000000-0000-4000-8000-000000000001',
  'generation-job:82000000-0000-4000-8000-000000000001:publish:2'
);

create temporary table task8_results (fixture text primary key, result jsonb not null) on commit drop;
grant select, insert, update, delete on task8_results to authenticated;

create or replace function pg_temp.try_personalized(
  p_story text, p_chapter integer, p_choice text, p_key text,
  p_expected jsonb, p_next jsonb, p_history jsonb, p_jejak jsonb
) returns jsonb language plpgsql as $$
declare v jsonb; v_state text; v_message text;
begin
  execute 'select public.apply_personalized_choice_and_enqueue_generation_v1($1,$2,$3,$4,$5,$6,$7,$8)'
    into v using p_story,p_chapter,p_choice,p_key,p_expected,p_next,p_history,p_jejak;
  return jsonb_build_object('ok',true,'data',v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  return jsonb_build_object('ok',false,'sqlstate',v_state,'message',v_message);
end $$;
grant execute on function pg_temp.try_personalized(text,integer,text,text,jsonb,jsonb,jsonb,jsonb) to authenticated, anon;

create or replace function pg_temp.try_standard(p_story text, p_chapter integer, p_choice text, p_key text)
returns jsonb language plpgsql as $$
declare v jsonb; v_state text; v_message text;
begin
  execute 'select public.apply_standard_choice_and_enqueue_generation_v1($1,$2,$3,$4)'
    into v using p_story,p_chapter,p_choice,p_key;
  return jsonb_build_object('ok',true,'data',v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  return jsonb_build_object('ok',false,'sqlstate',v_state,'message',v_message);
end $$;
grant execute on function pg_temp.try_standard(text,integer,text,text) to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into task8_results values (
  'p-ok', pg_temp.try_personalized(
    'test:t8:p-ok',1,'go','t8:p-ok:1',
    '{"user_id":"81000000-0000-4000-8000-000000000001","story_id":"test:t8:p-ok","status":"BERJALAN","current_chapter":1,"jejak":[],"ending_name":null,"route_state":{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}},"choice_history":[],"locked_ending_key":null,"updated_at":"2026-07-18T00:00:00+00:00"}',
    '{"truth":1,"trust":{},"evidence":[],"flags":{},"endingBias":{}}',
    '{"chapterNumber":1,"choiceId":"go","label":"Buka pintu","consequence":["Pintu terbuka"],"effectSummary":{"truth":1,"flagsSet":[]},"createdAt":"2026-07-18T00:01:00Z"}',
    '{"chapter":1,"decision":"Buka pintu","consequence":"Pintu terbuka"}'
  )
);
select ok(
  (select (result->>'ok')::boolean
    and result->'data'->'outcome'->>'choiceId' = 'go'
    and result->'data'->'generationJob' @> '{"alreadyComplete":false,"status":"QUEUED"}'::jsonb
   from task8_results where fixture = 'p-ok'),
  'personalized choice and next generation job commit together'
);
reset role;
select is((select current_chapter from public.reader_states where user_id='81000000-0000-4000-8000-000000000001' and story_id='test:t8:p-ok'), 2, 'personalized choice advances reader state');
select is((select count(*) from public.generation_jobs where story_id='test:t8:p-ok' and chapter_number=2), 1::bigint, 'personalized non-ending choice creates one next job');

set local role authenticated;
insert into task8_results values (
  'p-replay', pg_temp.try_personalized('test:t8:p-ok',1,'go','t8:p-ok:1','{}','{}','{}','{}')
);
select is(
  (select result->'data'->'generationJob' from task8_results where fixture='p-replay'),
  (select result->'data'->'generationJob' from task8_results where fixture='p-ok'),
  'personalized exact replay returns same job identity'
);
select is((select result->'data'->>'replayed' from task8_results where fixture='p-replay'), 'true', 'personalized exact replay returns replayed choice');
reset role;
select is((select jsonb_array_length(choice_history) from public.reader_states where user_id='81000000-0000-4000-8000-000000000001' and story_id='test:t8:p-ok'), 1, 'personalized replay does not duplicate history');

set local role authenticated;
select is(
  pg_temp.try_personalized(
    'test:t8:p-conflict',1,'go','t8:p-conflict:1',
    '{"user_id":"81000000-0000-4000-8000-000000000001","story_id":"test:t8:p-conflict","status":"BERJALAN","current_chapter":1,"jejak":[],"ending_name":null,"route_state":{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}},"choice_history":[],"locked_ending_key":null,"updated_at":"2026-07-18T00:00:00+00:00"}',
    '{"truth":1,"trust":{},"evidence":[],"flags":{},"endingBias":{}}',
    '{"chapterNumber":1,"choiceId":"go","label":"Buka pintu","consequence":["Pintu terbuka"],"effectSummary":{"truth":1,"flagsSet":[]},"createdAt":"2026-07-18T00:01:00Z"}',
    '{"chapter":1,"decision":"Buka pintu","consequence":"Pintu terbuka"}'
  )->>'message', 'GENERATION_JOB_CONFLICT', 'enqueue conflict rejects combined personalized mutation'
);
reset role;
select is((select current_chapter from public.reader_states where user_id='81000000-0000-4000-8000-000000000001' and story_id='test:t8:p-conflict'), 1, 'enqueue conflict rolls personalized choice back');
select is((select count(*) from public.personalized_choice_applications where story_id='test:t8:p-conflict'), 0::bigint, 'enqueue conflict rolls personalized ledger back');

set local role authenticated;
select is(
  pg_temp.try_personalized('test:t8:p-fail',1,'missing','t8:p-fail:1','{}','{}','{}','{}')->>'message',
  'CHOICE_NOT_FOUND', 'personalized choice failure rejects before enqueue'
);
reset role;
select is((select count(*) from public.generation_jobs where story_id='test:t8:p-fail'), 0::bigint, 'personalized choice failure creates no job');

set local role authenticated;
insert into task8_results values (
  'p-ending', pg_temp.try_personalized(
    'test:t8:p-ending',49,'end','t8:p-ending:49',
    '{"user_id":"81000000-0000-4000-8000-000000000001","story_id":"test:t8:p-ending","status":"BERJALAN","current_chapter":49,"jejak":[],"ending_name":null,"route_state":{"trust":{},"evidence":[],"flags":{},"endingBias":{}},"choice_history":[],"locked_ending_key":null,"updated_at":"2026-07-18T00:00:00+00:00"}',
    '{"trust":{},"evidence":[],"flags":{},"endingBias":{}}',
    '{"chapterNumber":49,"choiceId":"end","label":"Akhiri kisah","consequence":["Akhir sunyi"],"effectSummary":{"flagsSet":[]},"createdAt":"2026-07-18T00:01:00Z"}',
    '{"chapter":49,"decision":"Akhiri kisah","consequence":"Akhir sunyi"}'
  )
);
select is((select result->'data'->'generationJob' from task8_results where fixture='p-ending'), null, 'personalized ending returns no generation job');
reset role;
select is((select count(*) from public.generation_jobs where story_id='test:t8:p-ending'), 0::bigint, 'personalized ending creates no job');

set local role authenticated;
insert into task8_results values (
  'p-complete', pg_temp.try_personalized(
    'test:t8:p-complete',1,'go','t8:p-complete:1',
    '{"user_id":"81000000-0000-4000-8000-000000000001","story_id":"test:t8:p-complete","status":"BERJALAN","current_chapter":1,"jejak":[],"ending_name":null,"route_state":{"truth":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}},"choice_history":[],"locked_ending_key":null,"updated_at":"2026-07-18T00:00:00+00:00"}',
    '{"truth":1,"trust":{},"evidence":[],"flags":{},"endingBias":{}}',
    '{"chapterNumber":1,"choiceId":"go","label":"Buka pintu","consequence":["Pintu terbuka"],"effectSummary":{"truth":1,"flagsSet":[]},"createdAt":"2026-07-18T00:01:00Z"}',
    '{"chapter":1,"decision":"Buka pintu","consequence":"Pintu terbuka"}'
  )
);
select is((select result->'data'->'generationJob' from task8_results where fixture='p-complete'), '{"alreadyComplete":true,"jobId":null,"correlationId":null,"status":"SUCCEEDED"}'::jsonb, 'personalized existing next chapter uses completed fast path');
reset role;
select is((select count(*) from public.generation_jobs where story_id='test:t8:p-complete'), 0::bigint, 'personalized completed fast path creates no job');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select is(
  pg_temp.try_personalized('test:t8:p-ok',1,'go','t8:foreign','{}','{}','{}','{}')->>'message',
  'STORY_NOT_FOUND', 'other user sees personalized story as not found'
);
reset role;
select is((select count(*) from public.personalized_choice_applications where story_id='test:t8:p-ok'), 1::bigint, 'other user causes no personalized mutation or leaked ledger row');

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select is(pg_temp.try_standard('test:t8:s-public',3,'left','t8:guest')->>'sqlstate', '42501', 'guest cannot invoke standard combined RPC');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
insert into task8_results values ('s-public', pg_temp.try_standard('test:t8:s-public',3,'left','t8:s-public:3'));
select ok(
  (select (result->>'ok')::boolean
    and result->'data'->'outcome' = '{"storyId":"test:t8:s-public","chapterNumber":3,"choiceId":"left","consequence":["Jalan kiri dipilih"],"nextChapterNumber":4,"isEnding":false}'::jsonb
    and result->'data'->'generationJob' @> '{"alreadyComplete":false,"status":"QUEUED"}'::jsonb
   from task8_results where fixture='s-public'),
  'read-entitled user receives canonical DB outcome and queued job'
);
reset role;
select is(
  (select row(status,current_chapter,ending_name)::text from public.reader_states where user_id='81000000-0000-4000-8000-000000000002' and story_id='test:t8:s-public'),
  row('BERJALAN',4,null)::text,
  'standard mutation advances exact current chapter'
);
select is(
  (select jejak from public.reader_states where user_id='81000000-0000-4000-8000-000000000002' and story_id='test:t8:s-public'),
  '[{"chapter":1,"decision":"Lama","consequence":"lama"},{"chapter":3,"decision":"Belok kiri","consequence":"Jalan kiri dipilih"}]'::jsonb,
  'standard mutation canonically replaces and sorts jejak by chapter'
);
select is((select count(*) from public.generation_jobs where story_id='test:t8:s-public' and chapter_number=4), 1::bigint, 'standard state mutation and enqueue commit atomically');

set local role authenticated;
insert into task8_results values ('s-replay', pg_temp.try_standard('test:t8:s-public',3,'left','t8:s-public:3'));
select is((select result->'data' from task8_results where fixture='s-replay'), (select result->'data' from task8_results where fixture='s-public'), 'standard duplicate tap is idempotent with same outcome and job');
reset role;
select is((select count(*) from public.generation_jobs where story_id='test:t8:s-public' and chapter_number=4), 1::bigint, 'standard duplicate leaves one job');
select is(
  (select result->'safeResult' from public.idempotency_keys where key='t8:s-public:3'),
  (select result->'data' from task8_results where fixture='s-public'),
  'standard ledger stores exact safe result atomically'
);

set local role authenticated;
select is(
  pg_temp.try_standard('test:t8:s-public',3,'right','t8:s-public:3')->>'message',
  'IDEMPOTENCY_CONFLICT',
  'same standard key with different choice conflicts'
);
insert into task8_results values (
  's-other-story-conflict',
  pg_temp.try_standard('test:t8:s-ending',7,'end','t8:s-public:3')
);
select is(
  (select result->>'message' from task8_results where fixture='s-other-story-conflict'),
  'IDEMPOTENCY_CONFLICT',
  'same standard key with different story conflicts without replay leak'
);
select ok(
  not ((select result from task8_results where fixture='s-other-story-conflict')::text like '%test:t8:s-public%'),
  'different-story conflict leaks no stored story result'
);
select is(
  pg_temp.try_standard('test:t8:s-public',2,'left','t8:s-public:3')->>'message',
  'IDEMPOTENCY_CONFLICT',
  'same standard key with different chapter conflicts'
);
insert into task8_results values ('s-natural-replay', pg_temp.try_standard('test:t8:s-public',3,'left','t8:s-public:3:second'));
select is(
  (select result->'data' from task8_results where fixture='s-natural-replay'),
  (select result->'data' from task8_results where fixture='s-public'),
  'same standard choice with different key returns original exact result'
);
reset role;
select is(
  (select count(*) from public.idempotency_keys where key in ('t8:s-public:3','t8:s-public:3:second')),
  2::bigint,
  'natural duplicate binds second key without duplicate choice mutation'
);
select is(
  (select jsonb_array_length(jejak) from public.reader_states where user_id='81000000-0000-4000-8000-000000000002' and story_id='test:t8:s-public'),
  2,
  'standard key conflicts and natural replay do not duplicate choice mutation'
);

delete from public.generation_jobs where story_id='test:t8:s-public' and chapter_number=4;
set local role authenticated;
insert into task8_results values ('s-absent-job-replay', pg_temp.try_standard('test:t8:s-public',3,'left','t8:s-public:3'));
select is(
  (select result->'data' from task8_results where fixture='s-absent-job-replay'),
  (select result->'data' from task8_results where fixture='s-public'),
  'exact replay after job absence returns stored original safe result'
);
reset role;

set local role authenticated;
select is(
  pg_temp.try_standard('test:t8:s-skip',3,'three','t8:s-skip:future')->>'message',
  'POSITION_CONFLICT',
  'standard future chapter skip is rejected'
);
reset role;
select is(
  (select current_chapter from public.reader_states where user_id='81000000-0000-4000-8000-000000000002' and story_id='test:t8:s-skip'),
  1,
  'future chapter rejection leaves reader state unchanged'
);
set local role authenticated;
insert into task8_results values ('s-skip-first', pg_temp.try_standard('test:t8:s-skip',1,'one','t8:s-skip:1'));
select is(
  pg_temp.try_standard('test:t8:s-skip',1,'one-alt','t8:s-skip:stale')->>'message',
  'POSITION_CONFLICT',
  'stale standard request without exact replay ledger is rejected'
);
select is(
  pg_temp.try_standard('test:t8:s-skip',1,'one','t8:s-skip:1')->'data',
  (select result->'data' from task8_results where fixture='s-skip-first'),
  'stale standard exact key replay returns stored result'
);
reset role;
select is(
  (select current_chapter from public.reader_states where user_id='81000000-0000-4000-8000-000000000002' and story_id='test:t8:s-skip'),
  2,
  'stale replay paths preserve progressed reader state'
);

insert into public.idempotency_keys (key, story_id, scope, result) values (
  't8:publisher:key', 'test:t8:s-owner', 'publish_chapter_v2:1', '{"ok":true,"chapter_number":1,"seq":99}'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is(
  pg_temp.try_standard('test:t8:s-owner',1,'open','t8:publisher:key')->>'message',
  'IDEMPOTENCY_CONFLICT',
  'standard function never replays publisher ledger result'
);
reset role;
select is(
  (select scope from public.idempotency_keys where key='t8:publisher:key'),
  'publish_chapter_v2:1',
  'standard scope conflict preserves publisher ledger'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select ok(pg_temp.try_standard('test:t8:s-owner',1,'open','t8:s-owner:1')->'data'->'generationJob' @> '{"status":"QUEUED"}'::jsonb, 'standard story owner with own state is accepted');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
insert into task8_results values ('s-ending', pg_temp.try_standard('test:t8:s-ending',7,'end','t8:s-ending:7'));
select is((select result->'data'->'generationJob' from task8_results where fixture='s-ending'), null, 'standard ending returns no generation job');
reset role;
select is((select count(*) from public.generation_jobs where story_id='test:t8:s-ending'), 0::bigint, 'standard ending creates no job');
select is((select row(status,current_chapter,ending_name)::text from public.reader_states where user_id='81000000-0000-4000-8000-000000000002' and story_id='test:t8:s-ending'), row('SELESAI',7,'Kembali ke rumah')::text, 'standard ending stores canonical completed state');

select * from finish();
rollback;
