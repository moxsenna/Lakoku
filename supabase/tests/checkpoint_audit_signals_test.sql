begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into public.stories (id, title, visibility, story_mode) values
  ('test:audit:null', 'Audit Null', 'private', 'standard'),
  ('test:audit:v1', 'Audit V1', 'private', 'personalized_ai'),
  ('test:audit:unpaired-json', 'Audit Invalid', 'private', 'standard'),
  ('test:audit:unpaired-version', 'Audit Invalid', 'private', 'standard'),
  ('test:audit:version', 'Audit Invalid', 'private', 'personalized_ai'),
  ('test:audit:missing', 'Audit Invalid', 'private', 'personalized_ai'),
  ('test:audit:extra', 'Audit Invalid', 'private', 'personalized_ai'),
  ('test:audit:type', 'Audit Invalid', 'private', 'personalized_ai');

select has_column('public', 'chapter_generation_checkpoints', 'audit_signals_json', 'audit JSON column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'audit_signals_json', 'audit JSON remains nullable');
select has_column('public', 'chapter_generation_checkpoints', 'audit_signals_version', 'audit version column exists');
select col_is_null('public', 'chapter_generation_checkpoints', 'audit_signals_version', 'audit version remains nullable');
select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.chapter_generation_checkpoints'::regclass
    and conname = 'chapter_generation_checkpoints_audit_signals_check'
    and contype = 'c'
), 'strict paired audit check exists');
select has_function('public', 'is_valid_checkpoint_audit_signals_v1', array['jsonb'], 'canonical V1 validator exists');
select has_function('public', 'is_valid_checkpoint_audit_signals_v2', array['jsonb'], 'canonical V2 validator exists');
select has_function('public', 'upsert_generation_checkpoint_fenced_v1', array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','integer','bigint','bigint','text','text','integer','integer','integer'], 'new upsert signature exists');
select hasnt_function('public', 'upsert_generation_checkpoint_fenced_v1', array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','bigint','bigint','text','text','integer','integer','integer'], 'old overload removed');

select lives_ok($$
  insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,generation_mode,expires_at)
  values ('test:audit:null',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp',null,null,'standard',clock_timestamp()+interval '1 hour')
$$, 'paired null accepted');
select lives_ok($$
  insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,generation_mode,expires_at)
  values ('test:audit:v1',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp','{"opensNewThread":false,"opensMajorMystery":true,"opensNewConflict":false}',1,'personalized',clock_timestamp()+interval '1 hour')
$$, 'exact three-boolean V1 accepted');

select throws_ok($$insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,expires_at) values ('test:audit:unpaired-json',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp','{}',null,clock_timestamp()+interval '1 hour')$$, '23514', null, 'unpaired JSON rejected');
select throws_ok($$insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,expires_at) values ('test:audit:unpaired-version',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp',null,1,clock_timestamp()+interval '1 hour')$$, '23514', null, 'unpaired version rejected');
select throws_ok($$insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,expires_at) values ('test:audit:version',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp','{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}',2,clock_timestamp()+interval '1 hour')$$, '23514', null, 'non-V1 rejected');
select throws_ok($$insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,expires_at) values ('test:audit:missing',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp','{"opensNewThread":false,"opensMajorMystery":false}',1,clock_timestamp()+interval '1 hour')$$, '23514', null, 'missing key rejected');
select throws_ok($$insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,expires_at) values ('test:audit:extra',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp','{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"extra":false}',1,clock_timestamp()+interval '1 hour')$$, '23514', null, 'extra key rejected');
select throws_ok($$insert into public.chapter_generation_checkpoints (story_id,chapter_number,attempt_id,correlation_id,status,title,paragraphs_json,prose_fingerprint,audit_signals_json,audit_signals_version,expires_at) values ('test:audit:type',1,gen_random_uuid(),gen_random_uuid(),'PROSE_READY','T','["p"]','fp','{"opensNewThread":0,"opensMajorMystery":false,"opensNewConflict":false}',1,clock_timestamp()+interval '1 hour')$$, '23514', null, 'non-boolean rejected');
select ok(not public.is_valid_checkpoint_audit_signals_v2(null::jsonb), 'V2 validator is explicitly two-valued for SQL null');

select is((select audit_signals_json from public.chapter_generation_checkpoints where story_id='test:audit:null'), null::jsonb, 'standard JSON null');
select is((select audit_signals_version from public.chapter_generation_checkpoints where story_id='test:audit:null'), null::integer, 'standard version null');
select is((select audit_signals_json from public.chapter_generation_checkpoints where story_id='test:audit:v1'), '{"opensNewThread":false,"opensMajorMystery":true,"opensNewConflict":false}'::jsonb, 'personalized signals persist');
select is((select audit_signals_version from public.chapter_generation_checkpoints where story_id='test:audit:v1'), 1, 'personalized V1 persists');
select ok(not has_function_privilege('anon','public.upsert_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer)','EXECUTE'), 'anon denied');
select ok(not has_function_privilege('authenticated','public.upsert_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer)','EXECUTE'), 'authenticated denied');
select ok(has_function_privilege('service_role','public.upsert_generation_checkpoint_fenced_v1(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer)','EXECUTE'), 'service role granted');
select * from finish();
rollback;
