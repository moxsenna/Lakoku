-- pgTAP evidence for exact replay of signed JSONB E5 disposition.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e5000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
  'e5-replay-admin@example.invalid', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}', '{}',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
insert into public.admin_users (user_id, role)
values ('e5000000-0000-4000-8000-000000000003', 'admin');
insert into public.stories (id, title, owner_user_id)
values ('test:e5-replay', 'E5 replay', 'e5000000-0000-4000-8000-000000000003');
insert into public.story_events (id, story_id, seq, type, payload)
overriding system value
values (9007199254740995, 'test:e5-replay', 1, 'BLUEPRINT_REVIEW_REQUIRED', '{}');
insert into public.chapter_blueprints (
  story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
  forbidden_reveals, allowed_state_delta, introduces_characters
) values ('test:e5-replay', 12, 5, 'ACT_1', 'Replay goal', '["beat"]',
          '["secret"]', '{"thread":"main"}', '["hero"]');
insert into public.blueprint_queue (
  story_id, status, chapter_numbers, act_boundary, findings, source_event_id
) values ('test:e5-replay', 'BLOCKED', array[12], 'ACT_1', '[]', 9007199254740995);

create temporary table replay_attestation (envelope jsonb not null);
create temporary table first_e5_result as
select false::boolean as success, null::text as unblock_proof,
       null::text as error_message, null::uuid as persisted_proof_id,
       null::jsonb as validator_results
with no data;
create temporary table replay_e5_result (like first_e5_result);
grant select, insert on replay_attestation to service_role, authenticated;
grant select, insert on first_e5_result, replay_e5_result to authenticated;

set local role service_role;
insert into replay_attestation
select public.e5_issue_validator_attestation(
  'test:e5-replay', 9007199254740995,
  'e5000000-0000-4000-8000-000000000003', array[12],
  'E5_CANONICAL_VALIDATOR_V1',
  '[{"validator":"spine","passed":true}]',
  '{"mainEndingReachable":true,"secretEndingsReachable":[]}',
  '[{"chapter":12,"expected_version":5}]'
);
reset role;

select is((select count(*) from public.blueprint_validator_attestations), 0::bigint,
          'issuer remains write-free before replay');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into first_e5_result
select * from public.e5_record_disposition(
  'test:e5-replay', 'UNBLOCK_PERMIT',
  'e5000000-0000-4000-8000-000000000003',
  'Replay exactly once evidence', 9007199254740995, array[12],
  (select envelope from replay_attestation)
);
insert into replay_e5_result
select * from public.e5_record_disposition(
  'test:e5-replay', 'UNBLOCK_PERMIT',
  'e5000000-0000-4000-8000-000000000003',
  'Replay exactly once evidence', 9007199254740995, array[12],
  (select envelope from replay_attestation)
);
reset role;

select ok((select success from first_e5_result) and (select success from replay_e5_result),
          'initial request and exact signed replay both return success');
select is(
  (select row(unblock_proof, persisted_proof_id, validator_results)::text from replay_e5_result),
  (select row(unblock_proof, persisted_proof_id, validator_results)::text from first_e5_result),
  'replay returns exact same proof ID, proof value, and validator payload'
);
select is((select count(*) from public.blueprint_resolutions where story_id = 'test:e5-replay'),
          1::bigint, 'exact replay creates one resolution row');
select is((select count(*) from public.blueprint_audit_log where story_id = 'test:e5-replay'),
          1::bigint, 'exact replay creates one audit row');
select is((select count(*) from public.blueprint_validator_proofs where story_id = 'test:e5-replay'),
          1::bigint, 'exact replay creates one validator proof row');
select is((select count(*) from public.blueprint_validator_attestations),
          0::bigint, 'exact replay creates no legacy attestation orphan');
select is(
  (select validator_attestation from public.blueprint_validator_proofs
   where story_id = 'test:e5-replay'),
  (select envelope from replay_attestation),
  'authoritative proof persists exact replayed signed envelope'
);
select is(
  (select validator_attestation_hash from public.blueprint_validator_proofs
   where story_id = 'test:e5-replay'),
  (select encode(extensions.digest(envelope::text, 'sha256'), 'hex') from replay_attestation),
  'authoritative proof persists exact envelope hash'
);
select is(
  (select array_agg(version order by version) from public.chapter_blueprints
   where story_id = 'test:e5-replay' and chapter_number = 12),
  array[5, 6], 'exact replay appends N+1 only once'
);
select is(
  (select source_event_id::text from public.blueprint_resolutions where story_id = 'test:e5-replay'),
  '9007199254740995', 'replay identity preserves lossless BIGINT source event'
);
select is((select status from public.blueprint_queue where story_id = 'test:e5-replay'),
          'PENDING', 'replay does not advance queue state twice');
select is(
  (select count(distinct request_fingerprint) from public.blueprint_resolutions
   where story_id = 'test:e5-replay'),
  1::bigint, 'one request fingerprint remains authoritative'
);

select * from finish();
rollback;
