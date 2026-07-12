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

select plan(36);

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
insert into public.stories (id, title, owner_user_id, visibility)
values
  ('test:personalized-private-a', 'Private personalized A', '10000000-0000-4000-8000-000000000001', 'private'),
  ('premium:test-public-template', 'Public premium template', null, 'public');
insert into public.chapters (story_id, number, title, paragraphs, choice_prompt, choices)
values
  ('test:personalized-private-a', 1, 'Private chapter', '["private"]'::jsonb, 'Choose', '[{"id":"private-choice"}]'::jsonb),
  ('premium:test-public-template', 1, 'Public chapter', '["public"]'::jsonb, 'Choose', '[{"id":"public-choice"}]'::jsonb);
insert into public.choice_outcomes (story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending)
values
  ('test:personalized-private-a', 1, 'private-choice', '["private consequence"]'::jsonb, 2, false),
  ('premium:test-public-template', 1, 'public-choice', '["public consequence"]'::jsonb, 2, false);
insert into public.reader_states (user_id, story_id)
values
  ('10000000-0000-4000-8000-000000000001', 'test:personalized-private-a'),
  ('20000000-0000-4000-8000-000000000002', 'premium:test-public-template');
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
  execute format('select count(*) from %s where story_id = $1', p_table)
    into v_count using p_story_id;
  return v_count;
exception when others then
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
  (select count(*) from public.stories where id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private personalized story'
);
select is(
  (select count(*) from public.stories where id = 'premium:test-public-template'),
  1::bigint,
  'anon can read public premium template'
);
select is(
  (select count(*) from public.chapters where story_id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private child chapter'
);
select is(
  (select count(*) from public.chapters where story_id = 'premium:test-public-template'),
  1::bigint,
  'anon can read public template chapter'
);
select is(
  (select count(*) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read private child outcome'
);
select is(
  (select count(*) from public.choice_outcomes where story_id = 'premium:test-public-template'),
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
  (select count(*) from public.reader_states where story_id = 'test:personalized-private-a'),
  0::bigint,
  'anon cannot read reader state'
);
reset role;

-- Authenticated user B cannot cross owner boundary.
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*) from public.stories where id = 'test:personalized-private-a'),
  0::bigint,
  'authenticated user B cannot read A private story'
);
select is(
  (select count(*) from public.stories where id = 'premium:test-public-template'),
  1::bigint,
  'authenticated user B can read public premium template'
);
select is(
  (select count(*) from public.chapters where story_id = 'premium:test-public-template'),
  1::bigint,
  'authenticated user B can read public template chapter'
);
select is(
  (select count(*) from public.choice_outcomes where story_id = 'premium:test-public-template'),
  1::bigint,
  'authenticated user B can read public template outcome'
);
select is(
  (select count(*) from public.chapters where story_id = 'test:personalized-private-a'),
  0::bigint,
  'authenticated user B cannot read A private chapters'
);
select is(
  (select count(*) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
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
  (select count(*) from public.reader_states where user_id = '10000000-0000-4000-8000-000000000001'),
  0::bigint,
  'authenticated user B cannot read A reader state'
);
select is(
  (select count(*) from public.reader_states where user_id = '20000000-0000-4000-8000-000000000002'),
  1::bigint,
  'authenticated user B can read own reader state'
);
reset role;

-- Authenticated owner A can read parent and all protected children.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*) from public.stories where id = 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private story'
);
select is(
  (select count(*) from public.chapters where story_id = 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private child chapter'
);
select is(
  (select count(*) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private child outcome'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'test:personalized-private-a'),
  1::bigint,
  'owner A can read private generation contract'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'premium:test-public-template'),
  0::bigint,
  'owner A cannot read public template internal contract without ownership'
);
select is(
  (select count(*) from public.reader_states where user_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint,
  'owner A can read own reader state'
);
select is(
  (select count(*) from public.reader_states where user_id = '20000000-0000-4000-8000-000000000002'),
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
  (select count(*) from public.stories where id in ('test:personalized-private-a', 'test:service-role-write')),
  2::bigint,
  'service_role can read private story internals'
);
select is(
  (select count(*) from public.chapters where story_id = 'test:personalized-private-a'),
  1::bigint,
  'service_role can read private chapter internals'
);
select is(
  (select count(*) from public.choice_outcomes where story_id = 'test:personalized-private-a'),
  1::bigint,
  'service_role can read private outcome internals'
);
select is(
  (select count(*) from public.reader_states where story_id = 'test:personalized-private-a'),
  1::bigint,
  'service_role can read reader state internals'
);
select is(
  pg_temp.visible_story_rows(to_regclass('public.story_generation_contracts'), 'test:personalized-private-a'),
  1::bigint,
  'service_role can read private generation contract internals'
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

select skip(
  'publish_chapter_v2 added after linked RPC derivation; Task 12 replaces skip with role EXECUTE assertions',
  1
);

select * from finish();
rollback;
