-- pgTAP evidence for E5 auth.uid() + admin_users owner/admin authorization.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e5000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
    'e5-rls-owner@example.invalid', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}', '{}',
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    'e5000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated',
    'e5-rls-admin@example.invalid', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}', '{}',
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    'e5000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated',
    'e5-rls-user@example.invalid', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}', '{}',
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );
insert into public.admin_users (user_id, role) values
  ('e5000000-0000-4000-8000-000000000011', 'owner'),
  ('e5000000-0000-4000-8000-000000000012', 'admin');
insert into public.stories (id, title, owner_user_id) values
  ('test:e5-rls-owner', 'E5 RLS owner', 'e5000000-0000-4000-8000-000000000011'),
  ('test:e5-rls-admin', 'E5 RLS admin', 'e5000000-0000-4000-8000-000000000012');
insert into public.story_events (id, story_id, seq, type, payload)
overriding system value
values
  (9007199254741011, 'test:e5-rls-owner', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741012, 'test:e5-rls-admin', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}');
insert into public.blueprint_queue (
  story_id, status, chapter_numbers, act_boundary, findings, source_event_id
)
select story_id, 'PENDING', array[1], 'ACT_1', '[]'::jsonb, id
from public.story_events where story_id like 'test:e5-rls-%';

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.blueprint_queue'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class
       where oid = 'public.blueprint_resolutions'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class
       where oid = 'public.blueprint_audit_log'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class
       where oid = 'public.blueprint_validator_proofs'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class
       where oid = 'public.blueprint_validator_attestations'::regclass),
  'RLS enabled on queue and every E5 evidence ledger'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.e5_record_disposition(text,text,uuid,text,bigint,integer[],uuid)',
    'EXECUTE'
  ),
  'only authenticated role receives seven-argument disposition RPC execute before owner/admin RBAC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.e5_issue_validator_attestation(text,bigint,uuid,integer[],text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'only service_role can execute canonical validator attestation issuer'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok(
  $$select count(*) from public.blueprint_queue$$,
  '42501', null,
  'anon has no queue SELECT privilege'
);
select throws_ok(
  $$select * from public.e5_record_disposition(
    'test:e5-rls-owner', 'REJECT_BLOCK',
    'e5000000-0000-4000-8000-000000000011', 'anon attempt',
    1, array[1]
  )$$,
  '42501', null,
  'anon has no E5 RPC execute privilege'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000013', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*) from public.blueprint_queue), 0::bigint,
  'authenticated non-admin sees no queue rows through RLS'
);
select is(
  (select count(*) from public.vw_blueprint_review_authority), 0::bigint,
  'authenticated non-admin sees no review authority rows'
);
select throws_ok(
  $$select public.e5_issue_validator_attestation(
    'test:e5-rls-owner', 9007199254741011,
    'e5000000-0000-4000-8000-000000000013', array[1],
    'E5_CANONICAL_VALIDATOR_V1', '[]'::jsonb, '{}'::jsonb,
    '[{"chapter":1,"expected_version":1}]'::jsonb
  )$$,
  '42501', null,
  'authenticated user cannot issue validator attestation'
);
select is(
  (select success from public.e5_record_disposition(
    'test:e5-rls-owner', 'REJECT_BLOCK',
    'e5000000-0000-4000-8000-000000000013', 'non-admin attempt',
    9007199254741011, array[1]
  )),
  false,
  'authenticated non-admin RPC call fails owner/admin authorization'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000011', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*) from public.blueprint_queue
   where story_id in ('test:e5-rls-owner', 'test:e5-rls-admin')),
  2::bigint, 'owner sees all E5 RLS fixture queue rows'
);
select is(
  (select count(*) from public.vw_blueprint_pending_review_items
   where story_id in ('test:e5-rls-owner', 'test:e5-rls-admin')),
  2::bigint, 'owner sees all E5 RLS fixture pending dashboard rows'
);
select is(
  (select success from public.e5_record_disposition(
    'test:e5-rls-owner', 'REJECT_BLOCK',
    'e5000000-0000-4000-8000-000000000011', 'owner decision',
    9007199254741011, array[1]
  )),
  true,
  'owner can execute disposition RPC'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000012', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*) from public.blueprint_queue
   where story_id in ('test:e5-rls-owner', 'test:e5-rls-admin')),
  2::bigint, 'admin sees all E5 RLS fixture queue rows'
);
select is(
  (select count(*) from public.blueprint_resolutions
   where story_id = 'test:e5-rls-owner'),
  1::bigint, 'admin can read fixture resolution evidence'
);
select is(
  (select count(*) from public.blueprint_audit_log
   where story_id = 'test:e5-rls-owner'),
  1::bigint, 'admin can read fixture audit evidence'
);
select is(
  (select success from public.e5_record_disposition(
    'test:e5-rls-admin', 'RETRY_ALLOW',
    'e5000000-0000-4000-8000-000000000012', 'admin decision',
    9007199254741012, array[1]
  )),
  true,
  'admin can execute disposition RPC'
);
reset role;

select * from finish();
rollback;
