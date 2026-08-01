begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation incident capture tests require local-cli';
  end if;
end
$$;

select has_table('private', 'generation_incident_captures', 'encrypted incident table exists');
select columns_are(
  'private', 'generation_incident_captures',
  array[
    'capture_id', 'correlation_id', 'incident_key', 'label_fingerprint', 'version', 'story_id',
    'chapter_number', 'choice_index', 'stage', 'code', 'ciphertext', 'nonce',
    'auth_tag', 'created_at',
    'expires_at', 'consumed_at'
  ],
  'incident table stores bounded envelope and identity fields only'
);
select hasnt_column('private', 'generation_incident_captures', 'label', 'plaintext label column absent');
select hasnt_column('private', 'generation_incident_captures', 'plaintext', 'plaintext column absent');
select hasnt_column('private', 'generation_incident_captures', 'payload', 'generic payload column absent');
select hasnt_column('private', 'generation_incident_captures', 'metadata', 'generic metadata column absent');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'private.generation_incident_captures'::regclass),
  'incident storage has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'private.generation_incident_access_audit'::regclass),
  'incident audit has forced RLS'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'private'
      and tablename in ('generation_incident_captures', 'generation_incident_access_audit')
  ),
  'private incident tables expose no direct RLS policies'
);
select ok(
  not has_table_privilege('anon', 'private.generation_incident_captures', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'private.generation_incident_captures', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'private.generation_incident_captures', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'private.generation_incident_access_audit', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'private.generation_incident_access_audit', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'private.generation_incident_access_audit', 'SELECT,INSERT,UPDATE,DELETE'),
  'application roles have no direct incident or audit grants'
);

select has_function(
  'public', 'capture_generation_incident_v1',
  array['uuid','uuid','text','text','integer','text','integer','integer','text','text','text','text','text','timestamp with time zone'],
  'capture RPC has exact scalar signature'
);
select has_function(
  'public', 'consume_generation_incident_v1', array['uuid','uuid'],
  'consume RPC has exact identity signature'
);
select has_function(
  'public', 'cleanup_generation_incidents_v1', array['integer'],
  'cleanup RPC exists'
);

select is(
  (select proconfig from pg_proc where oid = to_regprocedure(
    'public.capture_generation_incident_v1(uuid,uuid,text,text,integer,text,integer,integer,text,text,text,text,text,timestamptz)'
  )),
  array['search_path=""']::text[],
  'capture RPC fixes empty search path'
);
select is(
  (select proconfig from pg_proc where oid = to_regprocedure(
    'public.consume_generation_incident_v1(uuid,uuid)'
  )),
  array['search_path=""']::text[],
  'consume RPC fixes empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.capture_generation_incident_v1(uuid,uuid,text,text,integer,text,integer,integer,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.capture_generation_incident_v1(uuid,uuid,text,text,integer,text,integer,integer,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.capture_generation_incident_v1(uuid,uuid,text,text,integer,text,integer,integer,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'capture RPC execute belongs to service_role only'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.consume_generation_incident_v1(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'public.consume_generation_incident_v1(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.consume_generation_incident_v1(uuid,uuid)', 'EXECUTE'
  ),
  'consume RPC execute belongs to authenticated only'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'incident-owner@example.com', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'incident-admin@example.com', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'incident-user@example.com', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
on conflict (id) do nothing;

insert into public.admin_users (user_id, role) values
  ('81000000-0000-4000-8000-000000000001', 'owner'),
  ('81000000-0000-4000-8000-000000000002', 'admin')
on conflict (user_id) do update set role = excluded.role;

set local role service_role;

select is(
  (select captured from public.capture_generation_incident_v1(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    repeat('a', 44), repeat('f', 44), 1, 'story-incident-a', 7, 0,
    'FINAL_BRANCH_SCHEMA', 'CHOICE_NOT_ACTIONABLE', 'Y2lwaGVydGV4dA==',
    'bm9uY2UxMjM0NTY=', 'YXV0aHRhZzEyMzQ1Ng==',
    pg_catalog.clock_timestamp() + interval '59 minutes'
  )),
  true,
  'first incident identity captures ciphertext'
);
select is(
  (select captured from public.capture_generation_incident_v1(
    '82000000-0000-4000-8000-000000000002',
    '83000000-0000-4000-8000-000000000002',
    repeat('a', 44), repeat('f', 44), 1, 'story-incident-a', 7, 1,
    'FINAL_BRANCH_SCHEMA', 'CHOICE_NOT_ACTIONABLE', 'ZGlmZmVyZW50',
    'bm9uY2UxMjM0NTY=', 'YXV0aHRhZzEyMzQ1Ng==',
    pg_catalog.clock_timestamp() + interval '30 minutes'
  )),
  false,
  'duplicate deterministic key/version/story/chapter is first-wins'
);
select is(
  (select capture_id from public.capture_generation_incident_v1(
    '82000000-0000-4000-8000-000000000003',
    '83000000-0000-4000-8000-000000000003',
    repeat('a', 44), repeat('f', 44), 1, 'story-incident-a', 7, 2,
    'FINAL_BRANCH_SCHEMA', 'CHOICE_NOT_ACTIONABLE', 'dGhpcmQ=',
    'bm9uY2UxMjM0NTY=', 'YXV0aHRhZzEyMzQ1Ng==',
    pg_catalog.clock_timestamp() + interval '10 minutes'
  )),
  '82000000-0000-4000-8000-000000000001'::uuid,
  'first-wins duplicate returns original capture identity'
);
reset role;
select is(
  (select count(*) from private.generation_incident_captures
   where incident_key = repeat('a', 44) and version = 1
     and story_id = 'story-incident-a' and chapter_number = 7),
  1::bigint,
  'deterministic incident identity stores one row'
);
select cmp_ok(
  (select expires_at - created_at from private.generation_incident_captures
   where capture_id = '82000000-0000-4000-8000-000000000001'),
  '<=', interval '60 minutes',
  'DB bounds stored TTL to at most 60 minutes'
);
set local role service_role;
select throws_ok(
  $$select * from public.capture_generation_incident_v1(
    '82000000-0000-4000-8000-000000000004',
    '83000000-0000-4000-8000-000000000004',
    repeat('b', 44), repeat('f', 44), 1, 'story-incident-b', 8, 0,
    'FINAL_BRANCH_SCHEMA', 'CHOICE_NOT_ACTIONABLE', 'Y2lwaGVydGV4dA==',
    'bm9uY2UxMjM0NTY=', 'YXV0aHRhZzEyMzQ1Ng==',
    pg_catalog.clock_timestamp() + interval '61 minutes'
  )$$,
  'P0001', 'INVALID_INCIDENT_CAPTURE',
  'capture rejects TTL above 60 minutes'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select * from public.consume_generation_incident_v1(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'OWNER_REQUIRED',
  'admin role cannot consume owner-only incident'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.consume_generation_incident_v1(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'OWNER_REQUIRED',
  'ordinary authenticated user cannot consume incident'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.consume_generation_incident_v1(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000099'
  )),
  0::bigint,
  'captureId plus wrong correlationId consumes nothing'
);
select is(
  (select ciphertext from public.consume_generation_incident_v1(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001'
  )),
  'Y2lwaGVydGV4dA==',
  'exact owner atomically receives encrypted envelope once'
);
select is(
  (select count(*) from public.consume_generation_incident_v1(
    '82000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'second read returns no incident'
);

reset role;
select is(
  (select count(*) from private.generation_incident_access_audit
   where capture_id = '82000000-0000-4000-8000-000000000001'
     and actor_user_id = '81000000-0000-4000-8000-000000000001'
     and action = 'CONSUMED'),
  1::bigint,
  'successful consume persists one actor audit row'
);

set local role service_role;
select is(
  (select deleted_count from public.cleanup_generation_incidents_v1(100)),
  1,
  'cleanup deletes consumed incident'
);
reset role;
select is(
  (select count(*) from private.generation_incident_captures
   where capture_id = '82000000-0000-4000-8000-000000000001'),
  0::bigint,
  'consumed incident ciphertext is removed'
);
select is(
  (select count(*) from private.generation_incident_access_audit
   where capture_id = '82000000-0000-4000-8000-000000000001'
     and action = 'CONSUMED'),
  1::bigint,
  'consume audit remains after incident cleanup without cascade'
);
select is(
  (select count(*) from private.generation_incident_access_audit
   where capture_id = '82000000-0000-4000-8000-000000000001'
     and action = 'PURGED'),
  1::bigint,
  'cleanup adds persistent purge audit'
);

insert into private.generation_incident_captures (
  capture_id, correlation_id, incident_key, label_fingerprint, version, story_id,
  chapter_number, choice_index, stage, code, ciphertext, nonce, auth_tag,
  created_at, expires_at
) values (
  '82000000-0000-4000-8000-000000000010',
  '83000000-0000-4000-8000-000000000010', repeat('c', 44), repeat('f', 44), 1,
  'story-expired', 9, 0, 'FINAL_BRANCH_SCHEMA', 'CHOICE_NOT_ACTIONABLE',
  'ZXhwaXJlZA==', 'bm9uY2UxMjM0NTY=',
  'YXV0aHRhZzEyMzQ1Ng==', pg_catalog.clock_timestamp() - interval '30 minutes',
  pg_catalog.clock_timestamp() - interval '1 minute'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.consume_generation_incident_v1(
    '82000000-0000-4000-8000-000000000010',
    '83000000-0000-4000-8000-000000000010'
  )),
  0::bigint,
  'expired incident cannot be read'
);
reset role;

set local role service_role;
select is(
  (select deleted_count from public.cleanup_generation_incidents_v1(100)),
  1,
  'cleanup deletes expired incident'
);
reset role;
select is(
  (select count(*) from private.generation_incident_access_audit
   where capture_id = '82000000-0000-4000-8000-000000000010'
     and action = 'EXPIRED'),
  1::bigint,
  'expired incident leaves persistent audit row'
);

select * from finish();
rollback;
