-- pgTAP evidence for E5 append-only blueprint reconciliation.
-- Exercises migrated public tables and public.e5_record_disposition.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'e5-append-owner@example.invalid', '', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

insert into public.admin_users (user_id, role)
values ('e5000000-0000-4000-8000-000000000001', 'owner');

insert into public.stories (id, title, owner_user_id)
values (
  'test:e5-append-only', 'E5 append-only',
  'e5000000-0000-4000-8000-000000000001'
);

insert into public.story_events (id, story_id, seq, type, payload)
overriding system value
values (
  9007199254740993, 'test:e5-append-only', 1, 'BLUEPRINT_REVIEW_REQUIRED',
  '{"reason":"test"}'::jsonb
);

insert into public.chapter_blueprints (
  story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
  forbidden_reveals, allowed_state_delta, introduces_characters, created_at
) values
  (
    'test:e5-append-only', 4, 3, 'ACT_1', 'Goal four',
    '["beat-four"]'::jsonb, '["secret-four"]'::jsonb,
    '{"thread":"four"}'::jsonb, '["char-four"]'::jsonb,
    '2026-01-01 00:00:00+00'
  ),
  (
    'test:e5-append-only', 9, 7, 'ACT_1', 'Goal nine',
    '["beat-nine"]'::jsonb, '["secret-nine"]'::jsonb,
    '{"thread":"nine"}'::jsonb, '["char-nine"]'::jsonb,
    '2026-01-02 00:00:00+00'
  );

insert into public.blueprint_queue (
  story_id, status, chapter_numbers, act_boundary, findings, source_event_id
) values (
  'test:e5-append-only', 'BLOCKED', array[4, 9], 'ACT_1',
  '[{"code":"TEST_FINDING"}]'::jsonb, 9007199254740993
);

create temporary table append_attestation (id uuid not null);
grant select, insert on append_attestation to service_role, authenticated;
set local role service_role;
insert into append_attestation
select public.e5_issue_validator_attestation(
  'test:e5-append-only',
  9007199254740993,
  'e5000000-0000-4000-8000-000000000001',
  array[4, 9],
  'E5_CANONICAL_VALIDATOR_V1',
  '[{"validator":"spine","passed":true}]'::jsonb,
  '{"ending":"passed"}'::jsonb,
  '[{"chapter":4,"expected_version":3},{"chapter":9,"expected_version":7}]'::jsonb
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  format(
    'select * from public.e5_record_disposition(%L,%L,%L::uuid,%L,%s,%L::integer[],%L::uuid)',
    'test:e5-append-only',
    'UNBLOCK_PERMIT',
    'e5000000-0000-4000-8000-000000000001',
    'Validator rerun passed for append-only evidence',
    9007199254740993,
    array[4, 9],
    (select id from append_attestation)
  ),
  'owner can record successful E5 reconciliation through attested RPC'
);
reset role;

select is(
  (select array_agg(version order by version)
   from public.chapter_blueprints
   where story_id = 'test:e5-append-only' and chapter_number = 4),
  array[3, 4],
  'chapter 4 preserves N and appends exactly N+1'
);
select is(
  (select array_agg(version order by version)
   from public.chapter_blueprints
   where story_id = 'test:e5-append-only' and chapter_number = 9),
  array[7, 8],
  'chapter 9 preserves N and appends exactly N+1'
);
select is(
  (select count(*) from public.chapter_blueprints
   where story_id = 'test:e5-append-only'),
  4::bigint,
  'two source rows remain beside two appended rows'
);
select is(
  (select row(
      next.phase, next.chapter_goal, next.mandatory_beats,
      next.forbidden_reveals, next.allowed_state_delta,
      next.introduces_characters
    )::text
   from public.chapter_blueprints source
   join public.chapter_blueprints next
     on next.story_id = source.story_id
    and next.chapter_number = source.chapter_number
    and next.version = source.version + 1
   where source.story_id = 'test:e5-append-only'
     and source.chapter_number = 4 and source.version = 3),
  row(
    'ACT_1', 'Goal four', '["beat-four"]'::jsonb,
    '["secret-four"]'::jsonb, '{"thread":"four"}'::jsonb,
    '["char-four"]'::jsonb
  )::text,
  'N+1 is a lossless copy of narrative blueprint fields'
);
select is(
  (select reconciled_from_version from public.chapter_blueprints
   where story_id = 'test:e5-append-only'
     and chapter_number = 9 and version = 8),
  7,
  'appended row records exact source version'
);
select matches(
  (select reconciliation_reason from public.chapter_blueprints
   where story_id = 'test:e5-append-only'
     and chapter_number = 9 and version = 8),
  '^E5 UNBLOCK_PERMIT resolution at ',
  'appended row records E5 reconciliation reason'
);
select is(
  (select source_event_id::text from public.blueprint_resolutions
   where story_id = 'test:e5-append-only'),
  '9007199254740993',
  'resolution preserves source_event_id beyond lossless JavaScript integer range'
);
select is(
  (select result_chapter_version_pairs from public.blueprint_resolutions
   where story_id = 'test:e5-append-only'),
  '[{"chapter":4,"result_version":4,"source_version":3},{"chapter":9,"result_version":8,"source_version":7}]'::jsonb,
  'authoritative result persists every per-chapter N to N+1 pair'
);
select is(
  (select validator_version from public.blueprint_validator_proofs
   where story_id = 'test:e5-append-only'),
  'E5_CANONICAL_VALIDATOR_V1',
  'persisted proof uses exact canonical validator version from attestation'
);

select * from finish();
rollback;
