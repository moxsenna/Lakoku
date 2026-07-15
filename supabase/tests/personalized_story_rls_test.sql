begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Local setup only: ALTER DATABASE postgres SET lakoku.test_target = 'local-cli'; then reconnect.
-- Never set this marker on linked, staging, or production databases.
do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'personalized story pgTAP tests require explicit local test target marker';
  end if;
end
$$;

select plan(108);

-- Fixed UUIDs and story IDs keep fixtures deterministic. Transaction rollback leaves no data.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'personalized-rls-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'personalized-rls-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

set local role service_role;
insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values
  ('test:personalized-private-a', 'Private personalized A', '10000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'),
  ('premium:test-public-template', 'Public premium template', null, 'public', 'premium_template');
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values
  ('test:personalized-private-a', 1, 'Private chapter', '["private"]'::jsonb, 'Choose', '[{"id":"private-choice","label":"Buka surat itu"},{"id":"other-choice","label":"Tinggalkan surat itu"},{"id":"third-choice","label":"Panggil Mira"}]'::jsonb),
  ('premium:test-public-template', 1, 'Public chapter', '["public"]'::jsonb, 'Choose', '[{"id":"public-choice"}]'::jsonb);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending,
  effect_json, choice_kind
)
values
  ('test:personalized-private-a', 1, 'private-choice', '["private consequence"]'::jsonb, 2, false,
   '{"routeDeltas":{"truth":2},"trustDeltas":{"mira":1},"flagsSet":{"clue_found":true},"evidenceAdded":["surat"],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,
   'normal'),
  ('premium:test-public-template', 1, 'public-choice', '["public consequence"]'::jsonb, 2, false,
   '{}'::jsonb, 'normal');
insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name,
  route_state, choice_history, locked_ending_key, updated_at
)
values
  ('10000000-0000-4000-8000-000000000001', 'test:personalized-private-a',
   'BERJALAN', 1, '[]'::jsonb, null,
   '{"truth":1,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":["surat"],"flags":{},"endingBias":{}}'::jsonb,
   '[]'::jsonb, null, '2026-07-14T00:00:00Z'::timestamptz),
  ('20000000-0000-4000-8000-000000000002', 'premium:test-public-template',
   'BERJALAN', 1, '[]'::jsonb, null, '{}'::jsonb, '[]'::jsonb, null,
   '2026-07-14T00:00:00Z'::timestamptz);
do $$
begin
  if to_regclass('public.story_generation_contracts') is not null then
    execute $insert$
      insert into public.story_generation_contracts (story_id, mode)
      values
        ('test:personalized-private-a', 'personalized_ai'),
        ('premium:test-public-template', 'premium_template')
    $insert$;
  end if;
end
$$;
reset role;

-- Dynamic helper lets missing planned tables report RED assertions instead of aborting file parsing.
create or replace function pg_temp.visible_story_rows(p_table regclass, p_story_id text)
returns bigint
language plpgsql
as $$
declare
  v_count bigint;
  v_sqlstate text;
  v_message text;
begin
  if p_table is null then
    raise notice '%', extensions.diag('SQLSTATE 42P01: required planned table does not exist');
    return -1;
  end if;
  execute format('select count(story_id) from %s where story_id = $1', p_table)
    into v_count using p_story_id;
  return v_count;
exception when insufficient_privilege then
  if current_user in ('anon', 'authenticated') then
    return 0;
  end if;
  raise;
when others then
  get stacked diagnostics
    v_sqlstate = returned_sqlstate,
    v_message = message_text;
  raise notice '%', extensions.diag(format('SQLSTATE %s: %s', v_sqlstate, v_message));
  return -1;
end
$$;

create or replace function pg_temp.try_exec(p_sql text)
returns boolean
language plpgsql
as $$
declare
  v_sqlstate text;
  v_message text;
begin
  execute p_sql;
  return true;
exception when others then
  get stacked diagnostics
    v_sqlstate = returned_sqlstate,
    v_message = message_text;
  raise notice '%', extensions.diag(format('SQLSTATE %s: %s', v_sqlstate, v_message));
  return false;
end
$$;

-- Anonymous matrix.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select is(
  (select count(id) from public.stories where id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private personalized story'
);
select is(
  (select count(id) from public.stories where id = 'premium:test-public-template'),
  1::bigint,
  'anon can read public premium template'
);
select is(
  (select count(story_id) from public.chapters where story_id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private child chapter'
);
select is(
  (select count(story_id) from public.chapters where story_id = 'premium:test-public-template'),
  1::bigint,
  'anon can read public template chapter'
);
select is(
  (select count(story_id) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private child outcome'
);
select is(
  (select count(story_id) from public.choice_outcomes where story_id = 'premium:test-public-template'),
  1::bigint,
  'anon can read public template outcome'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private generation contract'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'premium:test-public-template'),
  0::bigint,
  'anon cannot read public template internal contract'
);
select is(
  (select count(story_id) from public.reader_states where story_id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read reader state'
);
reset role;

-- Authenticated user B cannot cross owner boundary.
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(id) from public.stories where id = 'test:personalized-private-a'),
  0::bigint,
  'authenticated user B cannot read A private story'
);
select is(
  (select count(id) from public.stories where id = 'premium:test-public-template'),
  1::bigint,
  'authenticated user B can read public premium template'
);
select is(
  (select count(story_id) from public.chapters where story_id = 'premium:test-public-template'),
  1::bigint,
  'authenticated user B can read public template chapter'
);
select is(
  (select count(story_id) from public.choice_outcomes where story_id = 'premium:test-public-template'),
  1::bigint,
  'authenticated user B can read public template outcome'
);
select is(
  (select count(story_id) from public.chapters where story_id = 'test:personalized-private-a'),
  0::bigint,
  'authenticated user B cannot read A private chapters'
);
select is(
  (select count(story_id) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  0::bigint,
  'authenticated user B cannot read A private outcomes'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'test:personalized-private-a'),
  0::bigint,
  'authenticated user B cannot read A private contract'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'premium:test-public-template'),
  0::bigint,
  'authenticated user B cannot read public template internal contract'
);
select is(
  (select count(story_id) from public.reader_states where user_id = '10000000-0000-4000-8000-000000000001'),
  0::bigint,
  'authenticated user B cannot read A reader state'
);
select is(
  (select count(story_id) from public.reader_states where user_id = '20000000-0000-4000-8000-000000000002'),
  1::bigint,
  'authenticated user B can read own reader state'
);
reset role;

-- Authenticated owner A can read parent and all protected children.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(id) from public.stories where id = 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private story'
);
select is(
  (select count(story_id) from public.chapters where story_id = 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private child chapter'
);
select is(
  (select count(story_id) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private child outcome'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'test:personalized-private-a'),
  0::bigint,
  'owner A has no direct table grant for private generation contract'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'premium:test-public-template'),
  0::bigint,
  'owner A cannot read public template internal contract without ownership'
);
select is(
  (select count(story_id) from public.reader_states where user_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'owner A can read own reader state'
);
select is(
  (select count(story_id) from public.reader_states where user_id = '20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'owner A cannot read B reader state'
);
reset role;

-- service_role bypasses RLS and can write/read engine internals.
set local role service_role;
select lives_ok(
  $$insert into public.stories (id, title, owner_user_id, visibility)
    values ('test:service-role-write', 'Service role write',
      '10000000-0000-4000-8000-000000000001', 'private')$$,
  'service_role can write personalized story parent'
);
select is(
  (select count(id) from public.stories where id in ('test:personalized-private-a', 'test:service-role-write')),
  2::bigint,
  'service_role can read private story internals'
);
select is(
  (select count(story_id) from public.chapters where story_id = 'test:personalized-private-a'),
  1::bigint,
  'service_role can read private chapter internals'
);
select is(
  (select count(story_id) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  1::bigint,
  'service_role can read private outcome internals'
);
select is(
  (select count(story_id) from public.reader_states where story_id = 'test:personalized-private-a'),
  1::bigint,
  'service_role can read reader state internals'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'test:personalized-private-a'),
  1::bigint,
  'service_role can read private generation contract internals'
);
select is(
  (select owner_user_id from public.stories where id = 'test:personalized-private-a'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'service_role can read internal story owner column'
);
select is(
  (select effect_json from public.choice_outcomes
   where story_id = 'test:personalized-private-a' and chapter_number = 1 and choice_id = 'private-choice'),
  '{"routeDeltas":{"truth":2},"trustDeltas":{"mira":1},"flagsSet":{"clue_found":true},"evidenceAdded":["surat"],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,
  'service_role can read internal outcome effect column'
);
select is(
  (select route_state from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  '{"truth":1,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":["surat"],"flags":{},"endingBias":{}}'::jsonb,
  'service_role can read internal reader-state route column'
);
select is(
  (select mode from public.story_generation_contracts
   where story_id = 'test:personalized-private-a'),
  'personalized_ai',
  'service_role can read internal generation contract mode'
);
select ok(
  pg_temp.try_exec($sql$
    insert into public.story_generation_contracts (story_id, mode)
    values ('test:service-role-write', 'personalized_ai')
  $sql$),
  'service_role can write generation contract internals'
);
select ok(
  pg_temp.try_exec($sql$
    insert into public.story_creation_requests
      (owner_user_id, request_kind, idempotency_key, request_hash, story_id, status)
    values
      ('10000000-0000-4000-8000-000000000001', 'personalized',
       'test-service-request', 'test-request-hash', 'test:service-role-write', 'RESERVED')
  $sql$),
  'service_role can write creation request internals'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_creation_requests'), 'test:service-role-write'),
  1::bigint,
  'service_role can read creation request internals'
);
reset role;

select ok(
  has_column_privilege('anon', 'public.stories', 'id', 'SELECT')
    and has_column_privilege('authenticated', 'public.stories', 'id', 'SELECT')
    and has_column_privilege('anon', 'public.chapters', 'story_id', 'SELECT')
    and has_column_privilege('authenticated', 'public.chapters', 'story_id', 'SELECT')
    and has_column_privilege('anon', 'public.choice_outcomes', 'story_id', 'SELECT')
    and has_column_privilege('authenticated', 'public.choice_outcomes', 'story_id', 'SELECT')
    and has_column_privilege('anon', 'public.reader_states', 'story_id', 'SELECT')
    and has_column_privilege('authenticated', 'public.reader_states', 'story_id', 'SELECT'),
  'reader roles have explicit safe-column SELECT privileges'
);
select ok(
  not has_column_privilege('anon', 'public.stories', 'owner_user_id', 'SELECT')
    and not has_column_privilege('authenticated', 'public.stories', 'owner_user_id', 'SELECT')
    and not has_column_privilege('anon', 'public.choice_outcomes', 'effect_json', 'SELECT')
    and not has_column_privilege('authenticated', 'public.choice_outcomes', 'effect_json', 'SELECT')
    and not has_column_privilege('anon', 'public.reader_states', 'route_state', 'SELECT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'route_state', 'SELECT'),
  'reader roles lack internal story, outcome, and state column privileges'
);
select ok(
  not has_table_privilege('public', 'public.story_generation_contracts', 'SELECT')
    and not has_table_privilege('anon', 'public.story_generation_contracts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.story_generation_contracts', 'SELECT'),
  'PUBLIC, anon, and authenticated have no generation contract SELECT privilege'
);
select ok(
  has_table_privilege('service_role', 'public.story_generation_contracts', 'SELECT'),
  'service_role has generation contract SELECT privilege'
);
select ok(
  has_column_privilege('service_role', 'public.stories', 'owner_user_id', 'SELECT')
    and has_column_privilege('service_role', 'public.choice_outcomes', 'effect_json', 'SELECT')
    and has_column_privilege('service_role', 'public.reader_states', 'route_state', 'SELECT'),
  'service_role has internal story, outcome, and state column privileges'
);
set local role service_role;
select is(
  (select count(id) from public.stories
   where visibility = 'public' and id like 'premium:%'
     and id = 'premium:test-public-template'),
  1::bigint,
  'service_role sees exact public premium fixture'
);
select is(
  (select count(story_id) from public.chapters
   where story_id = 'premium:test-public-template'),
  1::bigint,
  'service_role sees public premium chapter fixture'
);
select is(
  (select count(story_id) from public.choice_outcomes
   where story_id = 'premium:test-public-template'),
  1::bigint,
  'service_role sees public premium outcome fixture'
);
reset role;

select ok(
  not has_function_privilege(
    'anon',
    'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)',
    'EXECUTE'
  ),
  'anon and authenticated cannot execute publish_chapter_v2'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)',
    'EXECUTE'
  ),
  'service_role can execute publish_chapter_v2'
);
select ok(
  not has_function_privilege(
    'public',
    'public.publish_chapter_v2(text,integer,text,jsonb,text,jsonb,jsonb,uuid,text)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute publish_chapter_v2'
);

-- Task 19: service-role-only atomic personalized choice ledger and RPC.
select has_table(
  'public', 'personalized_choice_applications',
  'dedicated personalized choice application ledger exists'
);
select has_table(
  'public', 'personalized_choice_idempotency_keys',
  'dedicated personalized choice idempotency key ledger exists'
);
select col_is_pk(
  'public', 'personalized_choice_applications', array['user_id', 'story_id', 'chapter_number'],
  'canonical application primary key is user, story, and chapter'
);
select col_is_pk(
  'public', 'personalized_choice_idempotency_keys', array['user_id', 'idempotency_key'],
  'idempotency key binding primary key is user and key'
);
select has_function(
  'public',
  'apply_personalized_choice',
  array['uuid', 'text', 'integer', 'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'jsonb'],
  'apply_personalized_choice exact signature exists'
);
select function_lang_is(
  'public',
  'apply_personalized_choice',
  array['uuid', 'text', 'integer', 'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'jsonb'],
  'plpgsql',
  'apply_personalized_choice uses plpgsql'
);
select ok(
  (select p.prosecdef from pg_proc p where p.oid =
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure),
  'apply_personalized_choice is SECURITY DEFINER'
);
select is(
  (select p.proconfig from pg_proc p where p.oid =
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure),
  array['search_path=""']::text[],
  'apply_personalized_choice fixes empty search_path'
);
select ok(
  not has_function_privilege(
    'public',
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'PUBLIC, anon, and authenticated cannot execute apply_personalized_choice'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute apply_personalized_choice'
);
select ok(
  not has_table_privilege('public', 'public.personalized_choice_applications', 'SELECT')
    and not has_table_privilege('anon', 'public.personalized_choice_applications', 'SELECT')
    and not has_table_privilege('authenticated', 'public.personalized_choice_applications', 'SELECT'),
  'reader roles cannot read personalized choice ledger'
);
select ok(
  has_table_privilege('service_role', 'public.personalized_choice_applications', 'SELECT')
    and has_table_privilege('service_role', 'public.personalized_choice_applications', 'INSERT'),
  'service_role can use personalized choice application ledger'
);
select ok(
  not has_table_privilege('public', 'public.personalized_choice_idempotency_keys', 'SELECT')
    and not has_table_privilege('anon', 'public.personalized_choice_idempotency_keys', 'SELECT')
    and not has_table_privilege('authenticated', 'public.personalized_choice_idempotency_keys', 'SELECT'),
  'reader roles cannot read personalized choice idempotency key ledger'
);
select ok(
  has_table_privilege('service_role', 'public.personalized_choice_idempotency_keys', 'SELECT')
    and has_table_privilege('service_role', 'public.personalized_choice_idempotency_keys', 'INSERT'),
  'service_role can use personalized choice idempotency key ledger'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.personalized_choice_applications'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.reader_states'::regclass
      and c.confdeltype = 'c'
  ),
  'choice application ledger cascades with exact reader state lifecycle'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.personalized_choice_applications'::regclass
      and c.confrelid = 'public.reader_states'::regclass
      and c.contype = 'f'
      and (select array_agg(a.attname order by k.ordinality)
           from unnest(c.conkey) with ordinality k(attnum, ordinality)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['user_id', 'story_id']::name[]
      and (select array_agg(a.attname order by k.ordinality)
           from unnest(c.confkey) with ordinality k(attnum, ordinality)
           join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
          = array['user_id', 'story_id']::name[]
      and c.confdeltype = 'c'
  ),
  'choice application ledger has exact composite reader-state FK with ON DELETE CASCADE'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.personalized_choice_idempotency_keys'::regclass
      and c.confrelid = 'public.personalized_choice_applications'::regclass
      and c.contype = 'f'
      and (select array_agg(a.attname order by k.ordinality)
           from unnest(c.conkey) with ordinality k(attnum, ordinality)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = array['user_id', 'story_id', 'chapter_number']::name[]
      and (select array_agg(a.attname order by k.ordinality)
           from unnest(c.confkey) with ordinality k(attnum, ordinality)
           join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum)
          = array['user_id', 'story_id', 'chapter_number']::name[]
      and c.confdeltype = 'c'
  ),
  'idempotency key ledger references canonical application with ON DELETE CASCADE'
);
select ok(
  (select c.relrowsecurity
   from pg_class c
   where c.oid = 'public.personalized_choice_applications'::regclass)
  and (select c.relrowsecurity
       from pg_class c
       where c.oid = 'public.personalized_choice_idempotency_keys'::regclass),
  'both personalized choice ledgers enable RLS'
);
select ok(
  pg_get_functiondef(
    'public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) ~* 'from public\.stories s[[:space:][:print:]]*for share',
  'apply_personalized_choice takes a qualifying story row share lock'
);

set local role service_role;
select lives_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'private-choice', 'choice:test:personalized-private-a:1:private-choice',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-private-a',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":1,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":["surat"],"flags":{},"endingBias":{}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T00:00:00+00:00'
    ),
    '{"truth":3,"risk":0,"secrecy":0,"empathy":0,"trust":{"mira":1},"evidence":["surat"],"flags":{"clue_found":true},"endingBias":{}}'::jsonb,
    '{"chapterNumber":1,"choiceId":"private-choice","label":"Buka surat itu","consequence":["private consequence"],"effectSummary":{"truth":2,"flagsSet":["clue_found"]},"createdAt":"2026-07-14T00:01:00+00:00"}'::jsonb,
    '{"chapter":1,"decision":"Buka surat itu","consequence":"private consequence"}'::jsonb
  )$$,
  'valid personalized choice applies atomically'
);
select is(
  (select route_state from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  '{"truth":3,"risk":0,"secrecy":0,"empathy":0,"trust":{"mira":1},"evidence":["surat"],"flags":{"clue_found":true},"endingBias":{}}'::jsonb,
  'atomic choice applies trust, route, stable evidence dedup, and flags'
);
select is(
  (select jsonb_array_length(route_state->'evidence') from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  1,
  'duplicate fixture evidence appears once after merge'
);

select is(
  (select choice_history from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  '[{"chapterNumber":1,"choiceId":"private-choice","label":"Buka surat itu","consequence":["private consequence"],"effectSummary":{"truth":2,"flagsSet":["clue_found"]},"createdAt":"2026-07-14T00:01:00+00:00"}]'::jsonb,
  'atomic choice appends summarized history'
);
select is(
  (select jejak from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  '[{"chapter":1,"decision":"Buka surat itu","consequence":"private consequence"}]'::jsonb,
  'atomic choice appends reader-safe jejak'
);
select is(
  (select current_chapter from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  2,
  'normal chapter advances progress to outcome next chapter'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  1::bigint,
  'valid choice stores one dedicated ledger row'
);
select is(
  (select outcome_snapshot from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  '{"storyId":"test:personalized-private-a","chapterNumber":1,"choiceId":"private-choice","consequence":["private consequence"],"nextChapterNumber":2,"isEnding":false}'::jsonb,
  'ledger stores public outcome snapshot only'
);
select is(
  (select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'private-choice', 'choice:test:personalized-private-a:1:private-choice',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )),
  '{"outcome":{"storyId":"test:personalized-private-a","chapterNumber":1,"choiceId":"private-choice","consequence":["private consequence"],"nextChapterNumber":2,"isEnding":false},"nextChapterNumber":2,"replayed":true}'::jsonb,
  'same key and request returns exact full replay result before stale-state comparison'
);
select is(
  (select jsonb_array_length(choice_history) from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  1,
  'exact replay does not duplicate choice history'
);
select is(
  (select (public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'private-choice', 'choice:test:personalized-private-a:1:semantic-replay',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )->>'replayed')::boolean),
  true,
  'same chapter and choice replays across a different idempotency key'
);
select is(
  (select count(*)
   from public.personalized_choice_idempotency_keys
   where user_id = '10000000-0000-4000-8000-000000000001'
     and idempotency_key = 'choice:test:personalized-private-a:1:semantic-replay'
     and story_id = 'test:personalized-private-a'
     and chapter_number = 1
     and choice_id = 'private-choice'),
  1::bigint,
  'semantic replay reserves key B against canonical application'
);
select is(
  (select count(*)
   from public.personalized_choice_idempotency_keys
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'
     and chapter_number = 1),
  2::bigint,
  'canonical application can have both original and semantic replay key bindings'
);
reset role;
insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values (
  'test:personalized-key-collision-target', 'Key collision target',
  '10000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'
);
insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name,
  route_state, choice_history, locked_ending_key, updated_at
) values (
  '10000000-0000-4000-8000-000000000001', 'test:personalized-key-collision-target',
  'BERJALAN', 1, '[]'::jsonb, null,
  '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
  '[]'::jsonb, null, '2026-07-14T00:10:00Z'::timestamptz
);
create temporary table task19_key_collision_before as
select to_jsonb(rs.*) as snapshot
from public.reader_states rs
where rs.user_id = '10000000-0000-4000-8000-000000000001'
  and rs.story_id = 'test:personalized-key-collision-target';
grant select on task19_key_collision_before to service_role;
set local role service_role;
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-key-collision-target', 1, 'target-choice',
    'choice:test:personalized-private-a:1:semantic-replay',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_KEY_COLLISION',
  'reusing semantic replay key B for another story returns typed collision'
);
select is(
  (select to_jsonb(rs.*)
   from public.reader_states rs
   where rs.user_id = '10000000-0000-4000-8000-000000000001'
     and rs.story_id = 'test:personalized-key-collision-target'),
  (select snapshot from task19_key_collision_before),
  'reusing key B for another story leaves full target reader state unchanged'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-key-collision-target'),
  0::bigint,
  'reusing key B for another story creates no canonical application'
);
select is(
  (select count(*) from public.personalized_choice_idempotency_keys
   where user_id = '10000000-0000-4000-8000-000000000001'
     and idempotency_key = 'choice:test:personalized-private-a:1:semantic-replay'
     and story_id = 'test:personalized-private-a'
     and chapter_number = 1),
  1::bigint,
  'reusing key B for another story preserves original binding only'
);
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'other-choice', 'choice:test:personalized-private-a:1:private-choice',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_KEY_COLLISION',
  'same key with different request returns typed collision'
);
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'other-choice', 'choice:test:personalized-private-a:1:other-choice',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )$$,
  'P0001', 'CHOICE_CONFLICT',
  'same chapter with different choice returns typed conflict'
);
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 3, 'private-choice', 'choice:test:personalized-private-a:3:private-choice',
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )$$,
  'P0001', 'POSITION_CONFLICT',
  'chapter position mismatch returns typed conflict'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  1::bigint,
  'conflicts roll back without extra ledger rows'
);
create temporary table task19_state_before_stale as
select to_jsonb(rs.*) as snapshot
from public.reader_states rs
where rs.user_id = '10000000-0000-4000-8000-000000000001'
  and rs.story_id = 'test:personalized-private-a';

select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 2, 'missing-choice', 'choice:test:personalized-private-a:2:stale',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-private-a',
      'status', 'BERJALAN',
      'current_chapter', 2,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T00:00:00+00:00'
    ),
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  )$$,
  'P0001', 'STALE_READER_STATE',
  'direct PostgreSQL jsonb equality rejects stale expected state'
);
select is(
  (select to_jsonb(rs.*) from public.reader_states rs
   where rs.user_id = '10000000-0000-4000-8000-000000000001'
     and rs.story_id = 'test:personalized-private-a'),
  (select snapshot from task19_state_before_stale),
  'stale rejection leaves full reader state unchanged'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  1::bigint,
  'stale rejection leaves ledger unchanged'
);

update public.reader_states
set current_chapter = 1,
    updated_at = '2026-07-14T00:02:00+00:00'::timestamptz
where user_id = '10000000-0000-4000-8000-000000000001'
  and story_id = 'test:personalized-private-a';
reset role;
delete from public.personalized_choice_applications
where user_id = '10000000-0000-4000-8000-000000000001'
  and story_id = 'test:personalized-private-a';
set local role service_role;
create temporary table task19_state_before_extra as
select to_jsonb(rs.*) as snapshot
from public.reader_states rs
where rs.user_id = '10000000-0000-4000-8000-000000000001'
  and rs.story_id = 'test:personalized-private-a';

select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'private-choice', 'choice:test:personalized-private-a:1:extra-history',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-private-a',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[{"chapter":1,"decision":"Buka surat itu","consequence":"private consequence"}]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":3,"risk":0,"secrecy":0,"empathy":0,"trust":{"mira":1},"evidence":["surat"],"flags":{"clue_found":true},"endingBias":{}}'::jsonb,
      'choice_history', '[{"chapterNumber":1,"choiceId":"private-choice","label":"Buka surat itu","consequence":["private consequence"],"effectSummary":{"truth":2,"flagsSet":["clue_found"]},"createdAt":"2026-07-14T00:01:00+00:00"}]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T00:02:00+00:00'
    ),
    '{"truth":5,"risk":0,"secrecy":0,"empathy":0,"trust":{"mira":2},"evidence":["surat"],"flags":{"clue_found":true},"endingBias":{}}'::jsonb,
    '{"chapterNumber":1,"choiceId":"private-choice","label":"Buka surat itu","consequence":["private consequence"],"effectSummary":{"truth":2,"flagsSet":["clue_found"],"effect_json":{"secret":true}},"createdAt":"2026-07-14T00:03:00+00:00","internal":"secret"}'::jsonb,
    '{"chapter":1,"decision":"Buka surat itu","consequence":"private consequence"}'::jsonb
  )$$,
  '22023', 'INVALID_PERSONALIZED_CHOICE_SUMMARY',
  'history and effectSummary reject extra internal keys'
);
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 1, 'private-choice', 'choice:test:personalized-private-a:1:extra-jejak',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-private-a',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[{"chapter":1,"decision":"Buka surat itu","consequence":"private consequence"}]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":3,"risk":0,"secrecy":0,"empathy":0,"trust":{"mira":1},"evidence":["surat"],"flags":{"clue_found":true},"endingBias":{}}'::jsonb,
      'choice_history', '[{"chapterNumber":1,"choiceId":"private-choice","label":"Buka surat itu","consequence":["private consequence"],"effectSummary":{"truth":2,"flagsSet":["clue_found"]},"createdAt":"2026-07-14T00:01:00+00:00"}]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T00:02:00+00:00'
    ),
    '{"truth":5,"risk":0,"secrecy":0,"empathy":0,"trust":{"mira":2},"evidence":["surat"],"flags":{"clue_found":true},"endingBias":{}}'::jsonb,
    '{"chapterNumber":1,"choiceId":"private-choice","label":"Buka surat itu","consequence":["private consequence"],"effectSummary":{"truth":2,"flagsSet":["clue_found"]},"createdAt":"2026-07-14T00:03:00+00:00"}'::jsonb,
    '{"chapter":1,"decision":"Buka surat itu","consequence":"private consequence","effect_json":{"secret":true}}'::jsonb
  )$$,
  '22023', 'INVALID_PERSONALIZED_CHOICE_SUMMARY',
  'jejak rejects extra internal keys'
);
select is(
  (select to_jsonb(rs.*) from public.reader_states rs
   where rs.user_id = '10000000-0000-4000-8000-000000000001'
     and rs.story_id = 'test:personalized-private-a'),
  (select snapshot from task19_state_before_extra),
  'extra-key rejection leaves full reader state unchanged'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  0::bigint,
  'extra-key rejection rolls back ledger writes'
);

reset role;
insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values (
  'test:personalized-late-rollback', 'Late rollback fixture',
  '10000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'
);
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values (
  'test:personalized-late-rollback', 1, 'Late rollback chapter',
  '["rollback"]'::jsonb, 'Choose',
  '[{"id":"late-choice","label":"Picu kegagalan akhir"}]'::jsonb
);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending,
  effect_json, choice_kind
) values (
  'test:personalized-late-rollback', 1, 'late-choice', '["Kegagalan dipaksa"]'::jsonb, 2, false,
  '{"routeDeltas":{"truth":1},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,
  'normal'
);
insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name,
  route_state, choice_history, locked_ending_key, updated_at
) values (
  '10000000-0000-4000-8000-000000000001', 'test:personalized-late-rollback',
  'BERJALAN', 1, '[]'::jsonb, null,
  '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
  '[]'::jsonb, null, '2026-07-14T01:00:00Z'::timestamptz
);
create temporary table task19_late_rollback_before as
select
  to_jsonb(rs.*) as state_snapshot,
  (select count(*)
   from public.personalized_choice_applications a
   where a.user_id = rs.user_id and a.story_id = rs.story_id) as ledger_count
from public.reader_states rs
where rs.user_id = '10000000-0000-4000-8000-000000000001'
  and rs.story_id = 'test:personalized-late-rollback';
create or replace function pg_temp.force_task19_late_failure()
returns trigger
language plpgsql
as $$
begin
  if old.user_id = '10000000-0000-4000-8000-000000000001'
    and old.story_id = 'test:personalized-late-rollback'
  then
    raise exception using errcode = 'P0001', message = 'FORCED_LATE_FAILURE';
  end if;
  return new;
end
$$;
create trigger task19_force_late_failure
before update on public.reader_states
for each row
execute function pg_temp.force_task19_late_failure();

set local role service_role;
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-late-rollback', 1, 'late-choice',
    'choice:test:personalized-late-rollback:1:late-choice',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-late-rollback',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T01:00:00+00:00'
    ),
    '{"truth":1,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
    '{"chapterNumber":1,"choiceId":"late-choice","label":"Picu kegagalan akhir","consequence":["Kegagalan dipaksa"],"effectSummary":{"truth":1,"flagsSet":[]},"createdAt":"2026-07-14T01:01:00+00:00"}'::jsonb,
    '{"chapter":1,"decision":"Picu kegagalan akhir","consequence":"Kegagalan dipaksa"}'::jsonb
  )$$,
  'P0001', 'FORCED_LATE_FAILURE',
  'forced reader-state update failure occurs after ledger insert'
);
reset role;
drop trigger task19_force_late_failure on public.reader_states;
select is(
  (select to_jsonb(rs.*)
   from public.reader_states rs
   where rs.user_id = '10000000-0000-4000-8000-000000000001'
     and rs.story_id = 'test:personalized-late-rollback'),
  (select state_snapshot from task19_late_rollback_before),
  'late update failure rolls back full reader state'
);
select is(
  (select count(*)
   from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-late-rollback'),
  (select ledger_count from task19_late_rollback_before),
  'late update failure rolls back ledger insert'
);

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values (
  'test:personalized-evidence-cap', 'Evidence cap fixture',
  '10000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'
);
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values (
  'test:personalized-evidence-cap', 1, 'Evidence cap chapter',
  '["evidence"]'::jsonb, 'Choose',
  '[{"id":"evidence-choice","label":"Kumpulkan semua bukti"}]'::jsonb
);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending,
  effect_json, choice_kind
) values (
  'test:personalized-evidence-cap', 1, 'evidence-choice', '["Bukti terkumpul"]'::jsonb, 2, false,
  jsonb_build_object(
    'routeDeltas', '{}'::jsonb,
    'trustDeltas', '{}'::jsonb,
    'flagsSet', '{}'::jsonb,
    'evidenceAdded', (
      select jsonb_agg(format('evidence-%s', lpad(value::text, 2, '0')) order by value)
      from pg_catalog.generate_series(1, 40) as evidence(value)
    ),
    'endingBiasDeltas', '{}'::jsonb,
    'threadTouches', '[]'::jsonb
  ),
  'normal'
);
insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name,
  route_state, choice_history, locked_ending_key, updated_at
) values (
  '10000000-0000-4000-8000-000000000001', 'test:personalized-evidence-cap',
  'BERJALAN', 1, '[]'::jsonb, null,
  '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":["evidence-01","evidence-02","evidence-03","evidence-04","evidence-05","evidence-06","evidence-07","evidence-08"],"flags":{},"endingBias":{}}'::jsonb,
  '[]'::jsonb, null, '2026-07-14T02:00:00Z'::timestamptz
);

set local role service_role;
select lives_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-evidence-cap', 1, 'evidence-choice',
    'choice:test:personalized-evidence-cap:1:evidence-choice',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-evidence-cap',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":["evidence-01","evidence-02","evidence-03","evidence-04","evidence-05","evidence-06","evidence-07","evidence-08"],"flags":{},"endingBias":{}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T02:00:00+00:00'
    ),
    jsonb_build_object(
      'truth', 0, 'risk', 0, 'secrecy', 0, 'empathy', 0,
      'trust', '{}'::jsonb,
      'evidence', (
        select jsonb_agg(format('evidence-%s', lpad(value::text, 2, '0')) order by value)
        from pg_catalog.generate_series(1, 32) as evidence(value)
      ),
      'flags', '{}'::jsonb,
      'endingBias', '{}'::jsonb
    ),
    '{"chapterNumber":1,"choiceId":"evidence-choice","label":"Kumpulkan semua bukti","consequence":["Bukti terkumpul"],"effectSummary":{"flagsSet":[]},"createdAt":"2026-07-14T02:01:00+00:00"}'::jsonb,
    '{"chapter":1,"decision":"Kumpulkan semua bukti","consequence":"Bukti terkumpul"}'::jsonb
  )$$,
  'valid evidence-heavy choice applies'
);
select is(
  (select jsonb_array_length(route_state->'evidence')
   from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-evidence-cap'),
  32,
  'evidence route state is capped at 32 values'
);
select is(
  (select route_state->'evidence'->>0
   from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-evidence-cap'),
  'evidence-01',
  'evidence cap retains first value in stable order'
);
select is(
  (select route_state->'evidence'->>31
   from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-evidence-cap'),
  'evidence-32',
  'evidence cap retains thirty-second value in stable order'
);
select ok(
  not exists (
    select 1
    from public.reader_states rs
    cross join lateral jsonb_array_elements_text(rs.route_state->'evidence') as retained(value)
    where rs.user_id = '10000000-0000-4000-8000-000000000001'
      and rs.story_id = 'test:personalized-evidence-cap'
      and retained.value in ('evidence-33', 'evidence-40')
  ),
  'evidence cap omits later values'
);

insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values (
  'test:personalized-private-a', 49, 'Special ending', '["ending"]'::jsonb,
  'Choose', '[{"id":"special-ending","label":"Terima akhir buruk"}]'::jsonb
);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending,
  effect_json, choice_kind
) values (
  'test:personalized-private-a', 49, 'special-ending', '["Akhir buruk khusus"]'::jsonb, null, true,
  '{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,
  'special_bad_ending'
);
update public.reader_states
set status = 'BERJALAN',
    current_chapter = 49,
    jejak = '[]'::jsonb,
    ending_name = null,
    route_state = '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
    choice_history = '[]'::jsonb,
    updated_at = '2026-07-14T00:49:00+00:00'::timestamptz
where user_id = '10000000-0000-4000-8000-000000000001'
  and story_id = 'test:personalized-private-a';
select is(
  (select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-private-a', 49, 'special-ending', 'choice:test:personalized-private-a:49:special-ending',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-private-a',
      'status', 'BERJALAN',
      'current_chapter', 49,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T00:49:00+00:00'
    ),
    '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
    '{"chapterNumber":49,"choiceId":"special-ending","label":"Terima akhir buruk","consequence":["Akhir buruk khusus"],"effectSummary":{"flagsSet":[]},"createdAt":"2026-07-14T00:50:00+00:00"}'::jsonb,
    '{"chapter":49,"decision":"Terima akhir buruk","consequence":"Akhir buruk khusus"}'::jsonb
  )),
  '{"outcome":{"storyId":"test:personalized-private-a","chapterNumber":49,"choiceId":"special-ending","consequence":["Akhir buruk khusus"],"nextChapterNumber":null,"isEnding":true},"nextChapterNumber":null,"replayed":false}'::jsonb,
  'chapter 49 special ending returns exact public outcome'
);
select is(
  (select status from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  'SELESAI',
  'chapter 49 special ending marks reader state complete'
);
select is(
  (select current_chapter from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  49,
  'chapter 49 special ending retains ending chapter progress'
);
select is(
  (select ending_name from public.reader_states
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'),
  'Akhir buruk khusus',
  'chapter 49 special ending stores ending name'
);

reset role;
insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values (
  'test:personalized-invalid-special', 'Invalid special ending fixture',
  '10000000-0000-4000-8000-000000000001', 'private', 'personalized_ai'
);
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values (
  'test:personalized-invalid-special', 1, 'Invalid special ending', '["ending"]'::jsonb,
  'Choose', '[{"id":"early-special","label":"Akhiri terlalu cepat"}]'::jsonb
);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending,
  effect_json, choice_kind
) values (
  'test:personalized-invalid-special', 1, 'early-special', '["Akhir ilegal"]'::jsonb, null, true,
  '{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}'::jsonb,
  'special_bad_ending'
);
insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name,
  route_state, choice_history, locked_ending_key, updated_at
) values (
  '10000000-0000-4000-8000-000000000001', 'test:personalized-invalid-special',
  'BERJALAN', 1, '[]'::jsonb, null,
  '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
  '[]'::jsonb, null, '2026-07-14T01:49:00Z'::timestamptz
);
create temporary table task19_invalid_special_before as
select to_jsonb(rs.*) as snapshot
from public.reader_states rs
where rs.user_id = '10000000-0000-4000-8000-000000000001'
  and rs.story_id = 'test:personalized-invalid-special';
grant select on task19_invalid_special_before to service_role;
set local role service_role;
select throws_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'test:personalized-invalid-special', 1, 'early-special',
    'choice:test:personalized-invalid-special:1:early-special',
    jsonb_build_object(
      'user_id', '10000000-0000-4000-8000-000000000001',
      'story_id', 'test:personalized-invalid-special',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', '2026-07-14T01:49:00+00:00'
    ),
    '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
    '{"chapterNumber":1,"choiceId":"early-special","label":"Akhiri terlalu cepat","consequence":["Akhir ilegal"],"effectSummary":{"flagsSet":[]},"createdAt":"2026-07-14T01:50:00+00:00"}'::jsonb,
    '{"chapter":1,"decision":"Akhiri terlalu cepat","consequence":"Akhir ilegal"}'::jsonb
  )$$,
  '22023', 'INVALID_PERSONALIZED_CHOICE_OUTCOME',
  'special_bad_ending before chapter 49 is rejected'
);
select is(
  (select to_jsonb(rs.*)
   from public.reader_states rs
   where rs.user_id = '10000000-0000-4000-8000-000000000001'
     and rs.story_id = 'test:personalized-invalid-special'),
  (select snapshot from task19_invalid_special_before),
  'invalid early special ending leaves full reader state unchanged'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-invalid-special'),
  0::bigint,
  'invalid early special ending leaves canonical application ledger unchanged'
);
select is(
  (select count(*) from public.personalized_choice_idempotency_keys
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-invalid-special'),
  0::bigint,
  'invalid early special ending leaves idempotency key ledger unchanged'
);
select is(
  (select count(*) from public.personalized_choice_applications
   where user_id = '10000000-0000-4000-8000-000000000001'
     and story_id = 'test:personalized-private-a'
     and chapter_number = 49),
  1::bigint,
  'chapter 49 special ending stores one ledger row'
);
reset role;

select * from finish();
rollback;
