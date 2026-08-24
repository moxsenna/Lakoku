-- pgTAP evidence for immutable E5 ledgers and inaccessible legacy attestations.

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
  '{"provider":"email","providers":["email"]}', '{}',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
insert into public.admin_users (user_id, role)
values ('e5000000-0000-4000-8000-000000000002', 'owner');
insert into public.stories (id, title, owner_user_id)
values
  ('test:e5-audit', 'E5 audit', 'e5000000-0000-4000-8000-000000000002'),
  ('test:e5-audit-proof', 'E5 audit proof', 'e5000000-0000-4000-8000-000000000002');
insert into public.story_events (id, story_id, seq, type, payload)
overriding system value
values
  (9007199254740994, 'test:e5-audit', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254740995, 'test:e5-audit-proof', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}');
insert into public.chapter_blueprints (
  story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
  forbidden_reveals, allowed_state_delta, introduces_characters
) values (
  'test:e5-audit-proof', 3, 1, 'ACT_1', 'Immutable proof goal', '[]', '[]', '{}', '[]'
);
insert into public.blueprint_queue (
  story_id, status, chapter_numbers, act_boundary, findings, source_event_id
) values
  ('test:e5-audit', 'PENDING', array[2], 'ACT_1', '[]', 9007199254740994),
  ('test:e5-audit-proof', 'BLOCKED', array[3], 'ACT_1', '[]', 9007199254740995);

create temporary table e5_audit_attestation (envelope jsonb not null);
grant select, insert on e5_audit_attestation to service_role, authenticated;
set local role service_role;
insert into e5_audit_attestation
select public.e5_issue_validator_attestation(
  'test:e5-audit-proof', 9007199254740995,
  'e5000000-0000-4000-8000-000000000002', array[3],
  'E5_CANONICAL_VALIDATOR_V1', '[{"validator":"spine","passed":true}]',
  '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
  '[{"chapter":3,"expected_version":1}]'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select * from public.e5_record_disposition(
    'test:e5-audit', 'REJECT_BLOCK',
    'e5000000-0000-4000-8000-000000000002',
    'Permanent audited rejection', 9007199254740994, array[2], null::jsonb
  )$$,
  'normal RPC insert flow creates authoritative resolution and audit rows'
);
select lives_ok(
  $$select * from public.e5_record_disposition(
    'test:e5-audit-proof', 'UNBLOCK_PERMIT',
    'e5000000-0000-4000-8000-000000000002',
    'Permanent audited permit', 9007199254740995, array[3],
    (select envelope from e5_audit_attestation)
  )$$,
  'normal RPC insert flow creates authoritative validator proof'
);
reset role;

select is((select count(*) from public.blueprint_resolutions
           where story_id in ('test:e5-audit', 'test:e5-audit-proof')),
          2::bigint, 'normal RPC flow creates two resolution ledger rows');
select is((select count(*) from public.blueprint_audit_log
           where story_id in ('test:e5-audit', 'test:e5-audit-proof')),
          2::bigint, 'normal RPC flow creates two audit ledger rows');
select is((select count(*) from public.blueprint_validator_proofs
           where story_id = 'test:e5-audit-proof'),
          1::bigint, 'normal RPC flow creates one validator proof ledger row');
select is(
  (select br.id::text || ':' || ba.resolution_id::text
   from public.blueprint_resolutions br
   join public.blueprint_audit_log ba on ba.resolution_id = br.id
   where br.story_id = 'test:e5-audit'),
  (select br.id::text || ':' || br.id::text
   from public.blueprint_resolutions br where br.story_id = 'test:e5-audit'),
  'audit row binds exact authoritative resolution BIGINT ID'
);

select has_trigger('public', 'blueprint_resolutions', 'e5_reject_resolution_mutation',
                   'resolution ledger has row mutation rejection trigger');
select has_trigger('public', 'blueprint_resolutions', 'e5_reject_resolution_truncate',
                   'resolution ledger has statement truncate rejection trigger');
select has_trigger('public', 'blueprint_audit_log', 'e5_reject_audit_mutation',
                   'audit ledger has row mutation rejection trigger');
select has_trigger('public', 'blueprint_audit_log', 'e5_reject_audit_truncate',
                   'audit ledger has statement truncate rejection trigger');
select has_trigger('public', 'blueprint_validator_proofs', 'e5_reject_proof_mutation',
                   'validator proof ledger has row mutation rejection trigger');
select has_trigger('public', 'blueprint_validator_proofs', 'e5_reject_proof_truncate',
                   'validator proof ledger has statement truncate rejection trigger');
select is(
  (select count(*)
   from pg_catalog.pg_trigger t
   join pg_catalog.pg_class c on c.oid = t.tgrelid
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   join pg_catalog.pg_proc p on p.oid = t.tgfoid
   join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
   where n.nspname = 'public'
     and c.relname in ('blueprint_resolutions', 'blueprint_audit_log', 'blueprint_validator_proofs')
     and t.tgname in (
       'e5_reject_resolution_mutation', 'e5_reject_resolution_truncate',
       'e5_reject_audit_mutation', 'e5_reject_audit_truncate',
       'e5_reject_proof_mutation', 'e5_reject_proof_truncate'
     )
     and pn.nspname = 'private'
     and p.proname = 'e5_reject_authoritative_history_mutation'
     and not t.tgisinternal),
  6::bigint, 'all authoritative ledger guards use immutable-history rejection function'
);

create temporary table e5_resolution_snapshot as
select * from public.blueprint_resolutions
where story_id in ('test:e5-audit', 'test:e5-audit-proof');
create temporary table e5_audit_snapshot as
select * from public.blueprint_audit_log
where story_id in ('test:e5-audit', 'test:e5-audit-proof');
create temporary table e5_proof_snapshot as
select * from public.blueprint_validator_proofs
where story_id = 'test:e5-audit-proof';

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
  not has_table_privilege('public', 'public.blueprint_validator_attestations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.blueprint_validator_attestations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.blueprint_validator_attestations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.blueprint_validator_attestations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'legacy attestation table is read-inaccessible and mutation-inaccessible to application roles'
);
select ok(
  not has_table_privilege('public', 'private.e5_validator_attestation_key', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'private.e5_validator_attestation_key', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'private.e5_validator_attestation_key', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'private.e5_validator_attestation_key', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'signing key table exposes no privileges to application roles'
);
select ok(
  not has_sequence_privilege('public', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('anon', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('authenticated', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('service_role', 'public.blueprint_resolutions_id_seq', 'USAGE,SELECT,UPDATE'),
  'resolution identity sequence exposes no application-role access'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$update public.blueprint_audit_log set reason_text = 'tampered' where story_id = 'test:e5-audit'$$,
  '42501', null, 'owner direct audit UPDATE is denied'
);
select throws_ok(
  $$delete from public.blueprint_audit_log where story_id = 'test:e5-audit'$$,
  '42501', null, 'owner direct audit DELETE is denied'
);
select throws_ok(
  $$update public.blueprint_resolutions set reason_text = 'tampered' where story_id = 'test:e5-audit'$$,
  '42501', null, 'owner direct resolution UPDATE is denied'
);
select throws_ok(
  $$select count(*) from public.blueprint_validator_attestations$$,
  '42501', null, 'owner cannot read legacy attestation rows even when table is empty'
);
select throws_ok(
  $$select signing_key from private.e5_validator_attestation_key$$,
  '42501', null, 'owner cannot read signing key'
);
reset role;

set constraints all immediate;

select throws_ok(
  $$update public.blueprint_resolutions set reason_text = 'postgres tamper'
    where story_id = 'test:e5-audit'$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct resolution UPDATE is rejected by immutable-history trigger'
);
select throws_ok(
  $$delete from public.blueprint_resolutions where story_id = 'test:e5-audit'$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct resolution DELETE is rejected by immutable-history trigger'
);
select throws_ok(
  $$truncate table public.blueprint_resolutions$$,
  '0A000', null,
  'postgres direct resolution TRUNCATE is rejected before any ledger content changes'
);
select throws_ok(
  $$truncate table public.blueprint_resolutions cascade$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct resolution TRUNCATE CASCADE is rejected by immutable-history trigger'
);
select throws_ok(
  $$update public.blueprint_audit_log set reason_text = 'postgres tamper'
    where story_id = 'test:e5-audit'$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct audit UPDATE is rejected by immutable-history trigger'
);
select throws_ok(
  $$delete from public.blueprint_audit_log where story_id = 'test:e5-audit'$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct audit DELETE is rejected by immutable-history trigger'
);
select throws_ok(
  $$truncate table public.blueprint_audit_log$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct audit TRUNCATE is rejected by immutable-history trigger'
);
select throws_ok(
  $$truncate table public.blueprint_audit_log cascade$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct audit TRUNCATE CASCADE is rejected by immutable-history trigger'
);
select throws_ok(
  $$update public.blueprint_validator_proofs set reason_text = 'postgres tamper'
    where story_id = 'test:e5-audit-proof'$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct validator proof UPDATE is rejected by immutable-history trigger'
);
select throws_ok(
  $$delete from public.blueprint_validator_proofs where story_id = 'test:e5-audit-proof'$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct validator proof DELETE is rejected by immutable-history trigger'
);
select throws_ok(
  $$truncate table public.blueprint_validator_proofs$$,
  '0A000', null,
  'postgres direct validator proof TRUNCATE is rejected before any ledger content changes'
);
select throws_ok(
  $$truncate table public.blueprint_validator_proofs cascade$$,
  '55000', 'E5_AUTHORITATIVE_HISTORY_IMMUTABLE',
  'postgres direct validator proof TRUNCATE CASCADE is rejected by immutable-history trigger'
);

select is(
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
   from public.blueprint_resolutions r
   where r.story_id in ('test:e5-audit', 'test:e5-audit-proof')),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
   from e5_resolution_snapshot r),
  'failed owner and postgres mutations preserve resolution count and exact content'
);
select is(
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.id)
   from public.blueprint_audit_log a
   where a.story_id in ('test:e5-audit', 'test:e5-audit-proof')),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.id)
   from e5_audit_snapshot a),
  'failed owner and postgres mutations preserve audit count and exact content'
);
select is(
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
   from public.blueprint_validator_proofs p
   where p.story_id = 'test:e5-audit-proof'),
  (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
   from e5_proof_snapshot p),
  'failed postgres mutations preserve validator proof count and exact content'
);

select throws_ok(
  $$insert into public.blueprint_validator_attestations (
      story_id, source_event_id, reviewer_uid, chapter_numbers, validator_version,
      spine_reveal_findings, ending_results, expected_chapter_versions, attestation_hash
    ) values (
      'test:e5-audit', 9007199254740994,
      'e5000000-0000-4000-8000-000000000002', array[2],
      'E5_CANONICAL_VALIDATOR_V1', '[]', '{}', '[]', repeat('0', 64)
    )$$,
  '55000', 'LEGACY_VALIDATOR_ATTESTATIONS_IMMUTABLE',
  'legacy attestation trigger rejects mutation even by table owner'
);
select throws_ok(
  $$delete from public.blueprint_queue where story_id = 'test:e5-audit'$$,
  '23503', null, 'resolution and audit RESTRICT references prevent parent deletion'
);
select is(
  (select reason_text from public.blueprint_audit_log where story_id = 'test:e5-audit'),
  'Permanent audited rejection', 'failed mutation attempts leave audit evidence unchanged'
);
select is((select count(*) from public.blueprint_validator_attestations), 0::bigint,
          'legacy attestation ledger may remain empty without orphan evidence');

select * from finish();
rollback;
