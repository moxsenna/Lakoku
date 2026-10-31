-- pgTAP evidence for fail-closed signed JSONB unblock and atomic rollback.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e5000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'e5-fail-closed-owner@example.invalid', '', pg_catalog.clock_timestamp(),
   '{"provider":"email","providers":["email"]}', '{}', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('e5000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'e5-binding-reviewer@example.invalid', '', pg_catalog.clock_timestamp(),
   '{"provider":"email","providers":["email"]}', '{}', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
insert into public.admin_users (user_id, role)
values ('e5000000-0000-4000-8000-000000000004', 'owner');
insert into public.stories (id, title, owner_user_id) values
  ('test:e5-missing', 'E5 missing', 'e5000000-0000-4000-8000-000000000004'),
  ('test:e5-binding', 'E5 binding', 'e5000000-0000-4000-8000-000000000004'),
  ('test:e5-other', 'E5 other', 'e5000000-0000-4000-8000-000000000004'),
  ('test:e5-stale', 'E5 stale', 'e5000000-0000-4000-8000-000000000004'),
  ('test:e5-non-unblock', 'E5 non-unblock', 'e5000000-0000-4000-8000-000000000004'),
  ('test:e5-late-fail', 'E5 late fail', 'e5000000-0000-4000-8000-000000000004');
insert into public.story_events (id, story_id, seq, type, payload)
overriding system value
values
  (9007199254741020, 'test:e5-missing', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741021, 'test:e5-binding', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741022, 'test:e5-binding', 2, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741023, 'test:e5-other', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741024, 'test:e5-stale', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741025, 'test:e5-non-unblock', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}'),
  (9007199254741026, 'test:e5-late-fail', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}');
insert into public.chapter_blueprints (
  story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
  forbidden_reveals, allowed_state_delta, introduces_characters
) values
  ('test:e5-missing', 5, 1, 'ACT_1', 'Missing goal', '[]', '[]', '{}', '[]'),
  ('test:e5-binding', 6, 2, 'ACT_1', 'Binding goal', '[]', '[]', '{}', '[]'),
  ('test:e5-binding', 7, 3, 'ACT_1', 'Other chapter goal', '[]', '[]', '{}', '[]'),
  ('test:e5-other', 6, 2, 'ACT_1', 'Other story goal', '[]', '[]', '{}', '[]'),
  ('test:e5-stale', 8, 4, 'ACT_1', 'Stale goal', '[]', '[]', '{}', '[]'),
  ('test:e5-non-unblock', 9, 5, 'ACT_1', 'Reject goal', '[]', '[]', '{}', '[]'),
  ('test:e5-late-fail', 10, 9, 'ACT_1', 'Late goal', '[]', '[]', '{}', '[]');
insert into public.blueprint_queue (
  story_id, status, chapter_numbers, act_boundary, findings, source_event_id
) values
  ('test:e5-missing', 'BLOCKED', array[5], 'ACT_1', '[]', 9007199254741020),
  ('test:e5-binding', 'BLOCKED', array[6], 'ACT_1', '[]', 9007199254741021),
  ('test:e5-other', 'BLOCKED', array[6], 'ACT_1', '[]', 9007199254741023),
  ('test:e5-stale', 'BLOCKED', array[8], 'ACT_1', '[]', 9007199254741024),
  ('test:e5-non-unblock', 'BLOCKED', array[9], 'ACT_1', '[]', 9007199254741025),
  ('test:e5-late-fail', 'BLOCKED', array[10], 'ACT_1', '[]', 9007199254741026);

create temporary table e5_attestations (kind text primary key, envelope jsonb not null);
grant select, insert on e5_attestations to service_role, authenticated;
set local role service_role;
select throws_ok(
  $$select public.e5_issue_validator_attestation(
    'test:e5-binding', 9007199254741021,
    'e5000000-0000-4000-8000-000000000004', array[6],
    'E5_CANONICAL_VALIDATOR_V0', '[]',
    '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":6,"expected_version":2}]'
  )$$,
  '22023', 'INVALID_VALIDATOR_ATTESTATION',
  'issuer rejects non-canonical validator version'
);
insert into e5_attestations values
  ('correct', public.e5_issue_validator_attestation(
    'test:e5-binding', 9007199254741021, 'e5000000-0000-4000-8000-000000000004', array[6],
    'E5_CANONICAL_VALIDATOR_V1', '[{"validator":"spine","passed":true}]',
    '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":6,"expected_version":2}]')),
  ('wrong_story', public.e5_issue_validator_attestation(
    'test:e5-other', 9007199254741023, 'e5000000-0000-4000-8000-000000000004', array[6],
    'E5_CANONICAL_VALIDATOR_V1', '[]', '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":6,"expected_version":2}]')),
  ('wrong_event', public.e5_issue_validator_attestation(
    'test:e5-binding', 9007199254741022, 'e5000000-0000-4000-8000-000000000004', array[6],
    'E5_CANONICAL_VALIDATOR_V1', '[]', '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":6,"expected_version":2}]')),
  ('wrong_reviewer', public.e5_issue_validator_attestation(
    'test:e5-binding', 9007199254741021, 'e5000000-0000-4000-8000-000000000005', array[6],
    'E5_CANONICAL_VALIDATOR_V1', '[]', '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":6,"expected_version":2}]')),
  ('wrong_chapters', public.e5_issue_validator_attestation(
    'test:e5-binding', 9007199254741021, 'e5000000-0000-4000-8000-000000000004', array[7],
    'E5_CANONICAL_VALIDATOR_V1', '[]', '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":7,"expected_version":3}]')),
  ('stale', public.e5_issue_validator_attestation(
    'test:e5-stale', 9007199254741024, 'e5000000-0000-4000-8000-000000000004', array[8],
    'E5_CANONICAL_VALIDATOR_V1', '[]', '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":8,"expected_version":3}]')),
  ('non_unblock', public.e5_issue_validator_attestation(
    'test:e5-non-unblock', 9007199254741025, 'e5000000-0000-4000-8000-000000000004', array[9],
    'E5_CANONICAL_VALIDATOR_V1', '[]', '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":9,"expected_version":5}]')),
  ('late_fail', public.e5_issue_validator_attestation(
    'test:e5-late-fail', 9007199254741026, 'e5000000-0000-4000-8000-000000000004', array[10],
    'E5_CANONICAL_VALIDATOR_V1', '[{"validator":"spine","passed":true}]',
    '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
    '[{"chapter":10,"expected_version":9}]'));
reset role;

insert into e5_attestations values
  ('forged', jsonb_build_object(
    'payload', (select envelope -> 'payload' from e5_attestations where kind = 'correct'),
    'signature', repeat('0', 64))),
  ('mutated', jsonb_set(
    (select envelope from e5_attestations where kind = 'correct'),
    '{payload,spine_reveal_findings}', '[{"validator":"spine","passed":false}]'));

select is((select count(*) from public.blueprint_validator_attestations), 0::bigint,
          'all issuer calls are stateless and write no legacy rows');

create temporary table fail_results (
  kind text primary key, success boolean, unblock_proof text, error_message text,
  persisted_proof_id uuid, validator_results jsonb
);
grant select, insert on fail_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into fail_results
select 'missing', r.* from public.e5_record_disposition(
  'test:e5-missing', 'UNBLOCK_PERMIT', 'e5000000-0000-4000-8000-000000000004',
  'Missing attestation', 9007199254741020, array[5], null::jsonb) r;
insert into fail_results
select a.kind, r.*
from e5_attestations a
cross join lateral public.e5_record_disposition(
  'test:e5-binding', 'UNBLOCK_PERMIT', 'e5000000-0000-4000-8000-000000000004',
  'Invalid signed attestation', 9007199254741021, array[6], a.envelope) r
where a.kind in ('forged', 'mutated', 'wrong_story', 'wrong_event', 'wrong_reviewer', 'wrong_chapters');
insert into fail_results
select 'stale', r.* from public.e5_record_disposition(
  'test:e5-stale', 'UNBLOCK_PERMIT', 'e5000000-0000-4000-8000-000000000004',
  'Stale attestation version', 9007199254741024, array[8],
  (select envelope from e5_attestations where kind = 'stale')) r;
insert into fail_results
select 'non_unblock', r.* from public.e5_record_disposition(
  'test:e5-non-unblock', 'REJECT_BLOCK', 'e5000000-0000-4000-8000-000000000004',
  'Reject must not carry attestation', 9007199254741025, array[9],
  (select envelope from e5_attestations where kind = 'non_unblock')) r;
reset role;

select is((select success from fail_results where kind = 'missing'), false,
          'UNBLOCK without signed envelope fails closed');
select matches((select error_message from fail_results where kind = 'missing'),
               '^INVALID_VALIDATOR_ATTESTATION_SHAPE \[22023\]$',
               'missing envelope returns controlled shape error');
select is((select count(*) from fail_results
           where kind in ('forged', 'mutated') and not success
             and error_message = 'VALIDATOR_ATTESTATION_BINDING_MISMATCH [23514]'),
          2::bigint, 'forged and mutated signed envelopes fail closed');
select is((select count(*) from fail_results
           where kind in ('wrong_story', 'wrong_event', 'wrong_reviewer', 'wrong_chapters')
             and not success and error_message = 'VALIDATOR_ATTESTATION_BINDING_MISMATCH [23514]'),
          4::bigint, 'wrong story, event, reviewer, and chapter bindings fail closed');
select is((select success from fail_results where kind = 'stale'), false,
          'stale expected version returns unsuccessful result');
select matches((select error_message from fail_results where kind = 'stale'),
               '^STALE_BLUEPRINT_VERSION \[40001\]$',
               'stale envelope returns optimistic-lock error');
select is((select success from fail_results where kind = 'non_unblock'), false,
          'non-UNBLOCK disposition rejects signed envelope');
select matches((select error_message from fail_results where kind = 'non_unblock'),
               '^ATTESTATION_ONLY_FOR_UNBLOCK \[22023\]$',
               'non-UNBLOCK envelope returns controlled error');
select is(
  (select row(
    (select count(*) from public.blueprint_resolutions where story_id in
      ('test:e5-missing','test:e5-binding','test:e5-stale','test:e5-non-unblock')),
    (select count(*) from public.blueprint_audit_log where story_id in
      ('test:e5-missing','test:e5-binding','test:e5-stale','test:e5-non-unblock')),
    (select count(*) from public.blueprint_validator_proofs where story_id in
      ('test:e5-missing','test:e5-binding','test:e5-stale','test:e5-non-unblock')),
    (select count(*) from public.chapter_blueprints where story_id = 'test:e5-stale' and version > 4)
  )::text), row(0::bigint,0::bigint,0::bigint,0::bigint)::text,
  'rejected and stale paths leave zero resolution, audit, proof, and append side effects'
);

update public.stories
set generation_status = 'needs_review'
where id = 'test:e5-binding';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table valid_result as
select * from public.e5_record_disposition(
  'test:e5-binding', 'UNBLOCK_PERMIT', 'e5000000-0000-4000-8000-000000000004',
  'Valid signed success', 9007199254741021, array[6],
  (select envelope from e5_attestations where kind = 'correct'));
reset role;
select ok((select success from valid_result), 'valid signed envelope succeeds');
select is(
  (select generation_status from public.stories where id = 'test:e5-binding'),
  'ready',
  'successful UNBLOCK_PERMIT clears needs_review admission latch'
);
select is(
  (select status from public.blueprint_queue where story_id = 'test:e5-binding'),
  'RESOLVED',
  'successful UNBLOCK_PERMIT closes active review incident'
);
select is((select validator_attestation from public.blueprint_validator_proofs
           where story_id = 'test:e5-binding'),
          (select envelope from e5_attestations where kind = 'correct'),
          'valid success persists full signed envelope');
select is((select validator_attestation_hash from public.blueprint_validator_proofs
           where story_id = 'test:e5-binding'),
          (select encode(extensions.digest(envelope::text, 'sha256'), 'hex')
           from e5_attestations where kind = 'correct'),
          'valid success persists full-envelope hash');

create or replace function pg_temp.fail_e5_proof_insert()
returns trigger language plpgsql as $$
begin
  if new.story_id = 'test:e5-late-fail' then
    raise exception using errcode = 'P0001', message = 'TEST_E5_PROOF_INSERT_FAILURE';
  end if;
  return new;
end
$$;
create trigger e5_test_proof_insert_failure
before insert on public.blueprint_validator_proofs
for each row execute function pg_temp.fail_e5_proof_insert();
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table late_fail_result as
select * from public.e5_record_disposition(
  'test:e5-late-fail', 'UNBLOCK_PERMIT', 'e5000000-0000-4000-8000-000000000004',
  'Injected late failure', 9007199254741026, array[10],
  (select envelope from e5_attestations where kind = 'late_fail'));
reset role;
drop trigger e5_test_proof_insert_failure on public.blueprint_validator_proofs;
select is((select success from late_fail_result), false,
          'late proof insert failure returns unsuccessful result');
select matches((select error_message from late_fail_result),
               '^TEST_E5_PROOF_INSERT_FAILURE \[P0001\]$',
               'late failure surfaces controlled error');
select is(
  (select row(
    (select status from public.blueprint_queue where story_id = 'test:e5-late-fail'),
    (select count(*) from public.chapter_blueprints where story_id = 'test:e5-late-fail'),
    (select count(*) from public.blueprint_resolutions where story_id = 'test:e5-late-fail'),
    (select count(*) from public.blueprint_audit_log where story_id = 'test:e5-late-fail'),
    (select count(*) from public.blueprint_validator_proofs where story_id = 'test:e5-late-fail')
  )::text), row('BLOCKED',1::bigint,0::bigint,0::bigint,0::bigint)::text,
  'late failure rolls back blueprint, resolution, audit, proof, and queue changes'
);
select is((select count(*) from public.blueprint_validator_attestations), 0::bigint,
          'all failure and success paths leave no legacy orphan');

select * from finish();
rollback;
