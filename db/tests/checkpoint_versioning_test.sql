begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'checkpoint versioning tests require local-cli';
  end if;
end
$$;

select no_plan();

select has_column('public', 'chapter_generation_checkpoints', 'generation_mode', 'generation_mode column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'generation_mode', 'generation_mode remains nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'generation_policy_version', 'generation_policy_version column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'generation_policy_version', 'generation_policy_version remains nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'prompt_contract_version', 'prompt_contract_version column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'prompt_contract_version', 'prompt_contract_version remains nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'job_id', 'job_id provenance column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'job_id', 'job_id remains nullable for legacy rows');
select has_column('public', 'chapter_generation_checkpoints', 'job_attempt_number', 'job_attempt_number provenance column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'job_attempt_number', 'job_attempt_number remains nullable for legacy rows');

select has_column('public', 'chapter_generation_checkpoints', 'checkpoint_schema_version', 'checkpoint_schema_version column exists');
select col_not_null('public', 'chapter_generation_checkpoints', 'checkpoint_schema_version', 'checkpoint_schema_version is NOT NULL');
select col_default_is('public', 'chapter_generation_checkpoints', 'checkpoint_schema_version', '2', 'checkpoint_schema_version defaults to 2 for new rows');

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '53000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'checkpoint-version-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values ('test:checkpoint-version', 'Checkpoint Version', '53000000-0000-4000-8000-000000000001', 'private', 'standard');

insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status, title, paragraphs_json,
  prose_fingerprint, expires_at
) values (
  'test:checkpoint-version', 1, gen_random_uuid(), gen_random_uuid(), 'PROSE_READY',
  'T', '["p"]'::jsonb, 'fp-1', clock_timestamp() + interval '1 hour'
);

select is(
  (select checkpoint_schema_version from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-version' and chapter_number = 1),
  2, 'a fresh insert without explicit schema version defaults to 2'
);
select is(
  (select row(generation_mode, generation_policy_version, prompt_contract_version, job_id, job_attempt_number)::text
   from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-version' and chapter_number = 1),
  row(null::text, null::integer, null::integer, null::uuid, null::integer)::text,
  'new direct insert may retain nullable legacy-compatible provenance when omitted'
);

-- Reproduce pre-migration marker state, then replay exact migration algorithm.
alter table public.chapter_generation_checkpoints
  alter column checkpoint_schema_version drop not null,
  alter column checkpoint_schema_version drop default;

insert into public.chapter_generation_checkpoints (
  story_id, chapter_number, attempt_id, correlation_id, status,
  title, paragraphs_json, prose_fingerprint, expires_at,
  checkpoint_schema_version
) values (
  'test:checkpoint-version', 2, gen_random_uuid(), gen_random_uuid(),
  'PROSE_READY', 'Legacy', '["p"]'::jsonb, 'legacy-fp',
  clock_timestamp() + interval '1 hour', null
);

update public.chapter_generation_checkpoints
set checkpoint_schema_version = 1
where checkpoint_schema_version is null;

alter table public.chapter_generation_checkpoints
  alter column checkpoint_schema_version set default 2,
  alter column checkpoint_schema_version set not null;

select is(
  (select checkpoint_schema_version from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-version' and chapter_number = 2),
  1, 'migration backfills an existing null marker to schema version 1'
);
select is(
  (select row(generation_mode, generation_policy_version, prompt_contract_version, job_id, job_attempt_number)::text
   from public.chapter_generation_checkpoints where story_id = 'test:checkpoint-version' and chapter_number = 2),
  row(null::text, null::integer, null::integer, null::uuid, null::integer)::text,
  'backfill preserves every nullable legacy provenance field'
);
select col_not_null('public', 'chapter_generation_checkpoints', 'checkpoint_schema_version', 'replayed migration restores NOT NULL');
select col_default_is('public', 'chapter_generation_checkpoints', 'checkpoint_schema_version', '2', 'replayed migration restores default 2');

select * from finish();
rollback;
