-- pgTAP evidence for immutable E5 resolution, audit, and validator ledgers.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'e5-audit-owner@example.invalid', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
insert into public.admin_users (user_id, role)
values ('e5000000-0000-4000-8000-000000000002', 'owner');
insert into public.stories (id, title, owner_user_id)
values ('test:e5-audit', 'E5 audit', 'e5000000-0000-4000-8000-000000000002');
insert into public.story_events (id, story_id, seq, type, payload)
overriding system value
values (9007199254740994, 'test:e5-audit', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}');
insert into public.blueprint_queue (
  story_id, status, chapter_numbers, act_boundary, findings, source_event_id
) values (
  'test:e5-audit', 'PENDING', array[2], 'ACT_1', '[]'::jsonb,
  9007199254740994
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select * from public.e5_record_disposition(
    'test:e5-audit', 'REJECT_BLOCK',
    'e5000000-0000-4000-8000-000000000002',
    'Permanent audited rejection',
    9007199254740994,
    array[2]
  )$$,
  'RPC creates authoritative resolution and audit rows'
);
reset role;

select is(
  (select count(*) from public.blueprint_resolutions where story_id = 'test:e5-audit'),
  1::bigint,
  'one resolution ledger row exists'
);
select is(
  (select count(*) from public.blueprint_audit_log where story_id = 'test:e5-audit'),
  1::bigint,
  'one audit ledger row exists'
);
select is(
  (select br.id::text || ':' || ba.resolution_id::text
   from public.blueprint_resolutions br
   join public.blueprint_audit_log ba on ba.resolution_id = br.id
   where br.story_id = 'test:e5-audit'),
  (select br.id::text || ':' || br.id::text
   from public.blueprint_resolutions br where br.story_id = 'test:e5-audit'),
  'audit row binds exact authoritative resolution BIGINT ID'
);

select ok(
  not has_table_privilege('public', 'public.blueprint_resolutions', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.blueprint_resolutions', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.blueprint_resolutions', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.blueprint_resolutions', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'resolution ledger denies direct mutation to every application role'
);
select ok(
  not has_table_privilege('public', 'public.blueprint_audit_log', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.blueprint_audit_log', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.blueprint_audit_log', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.blueprint_audit_log', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'audit ledger denies direct mutation to every application role'
);
select ok(
  not has_table_privilege('public', 'public.blueprint_validator_proofs', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.blueprint_validator_proofs', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.blueprint_validator_proofs', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.blueprint_validator_proofs', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'validator proof ledger denies direct mutation to every application role'
);
select ok(
  not has_table_privilege('public', 'public.blueprint_validator_attestations', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.blueprint_validator_attestations', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.blueprint_validator_attestations', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.blueprint_validator_attestations', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'validator attestation ledger denies direct mutation to every application role'
);
select ok(
  not has_sequence_privilege('public', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('anon', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('authenticated', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('service_role', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE'),
  'resolution identity sequence exposes no direct application-role access'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$update public.blueprint_audit_log
    set reason_text = 'tampered'
    where story_id = 'test:e5-audit'$$,
  '42501', null,
  'owner direct audit UPDATE is denied'
);
select throws_ok(
  $$delete from public.blueprint_audit_log where story_id = 'test:e5-audit'$$,
  '42501', null,
  'owner direct audit DELETE is denied'
);
select throws_ok(
  $$update public.blueprint_resolutions
    set reason_text = 'tampered'
    where story_id = 'test:e5-audit'$$,
  '42501', null,
  'owner direct resolution UPDATE is denied'
);
reset role;

select throws_ok(
  $$delete from public.blueprint_queue where story_id = 'test:e5-audit'$$,
  '23503', null,
  'resolution and audit RESTRICT references prevent parent deletion'
);
select is(
  (select reason_text from public.blueprint_audit_log where story_id = 'test:e5-audit'),
  'Permanent audited rejection',
  'failed mutation attempts leave original audit evidence unchanged'
);

select * from finish();
rollback;
