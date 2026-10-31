begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'generation incident metadata tests require local-cli';
  end if;
end
$$;

select has_function('public', 'find_generation_incident_metadata_v1', array['text','integer','timestamp with time zone','timestamp with time zone'], 'metadata discovery RPC exists');
select ok(
  (select prosecdef from pg_proc where oid=to_regprocedure('public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)')),
  'metadata RPC is security definer'
);
select is(
  (select proconfig from pg_proc where oid=to_regprocedure('public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)')),
  array['search_path=""']::text[], 'metadata RPC fixes empty search path'
);
select is(
  (select provolatile from pg_proc where oid=to_regprocedure('public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)')),
  's'::"char", 'metadata RPC is stable'
);
select ok(
  has_function_privilege('authenticated','public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)','EXECUTE')
  and not has_function_privilege('service_role','public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)','EXECUTE'),
  'metadata RPC execute belongs to authenticated only'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_table_privilege('authenticated', 'private.generation_incident_captures', 'SELECT')
  and not has_table_privilege('authenticated', 'private.generation_incident_access_audit', 'SELECT'),
  'authenticated has no direct private incident access'
);
select is(
  (select string_agg(parameter_name || ':' || data_type, ',' order by ordinal_position)
   from information_schema.parameters
   where specific_schema='public' and specific_name like 'find_generation_incident_metadata_v1%'
     and parameter_mode='OUT'),
  'capture_id:uuid,correlation_id:uuid', 'metadata RPC returns IDs only'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'private.generation_incident_captures'::regclass
      and conname = 'generation_incident_captures_stage_check'
      and contype = 'c'
      and pg_get_constraintdef(oid, true) ~ $$^CHECK \(stage = 'FINAL_BRANCH_SCHEMA'$$
  ),
  'capture table restricts stage to FINAL_BRANCH_SCHEMA'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'private.generation_incident_captures'::regclass
      and conname = 'generation_incident_captures_code_check'
      and contype = 'c'
      and pg_get_constraintdef(oid, true) ~ $$^CHECK \(code = 'CHOICE_NOT_ACTIONABLE'$$
  ),
  'capture table restricts code to CHOICE_NOT_ACTIONABLE'
);
select ok(
  position('captures.stage = ''FINAL_BRANCH_SCHEMA''' in pg_get_functiondef('public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)'::regprocedure)) > 0
  and position('captures.code = ''CHOICE_NOT_ACTIONABLE''' in pg_get_functiondef('public.find_generation_incident_metadata_v1(text,integer,timestamptz,timestamptz)'::regprocedure)) > 0,
  'metadata RPC defensively filters exact stage and code'
);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('91000000-0000-4000-8000-000000000001','authenticated','authenticated','metadata-owner@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp()),
('91000000-0000-4000-8000-000000000002','authenticated','authenticated','metadata-admin@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp()),
('91000000-0000-4000-8000-000000000003','authenticated','authenticated','metadata-civilian@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp())
on conflict (id) do nothing;
insert into public.admin_users(user_id,role) values
('91000000-0000-4000-8000-000000000001','owner'),
('91000000-0000-4000-8000-000000000002','admin')
on conflict(user_id) do update set role=excluded.role;

create temporary table metadata_window as
select statement_timestamp() as window_start;

insert into private.generation_incident_captures(
 capture_id,correlation_id,incident_key,label_fingerprint,version,story_id,chapter_number,choice_index,stage,code,ciphertext,nonce,auth_tag,created_at,expires_at
) values
('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',repeat('m',44),repeat('f',44),1,'story-metadata',1,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE','Y2lwaGVydGV4dA==','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',(select window_start from metadata_window),(select window_start from metadata_window)+interval '30 minutes'),
('92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002',repeat('n',44),repeat('g',44),1,'story-boundary',1,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE','Y2lwaGVydGV4dA==','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',(select window_start from metadata_window),(select window_start from metadata_window)+interval '30 minutes'),
('92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003',repeat('o',44),repeat('h',44),1,'story-boundary',1,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE','Y2lwaGVydGV4dA==','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',(select window_start from metadata_window)+interval '1 minute',(select window_start from metadata_window)+interval '30 minutes');

create temporary table metadata_before as
select capture_id,correlation_id,consumed_at,claim_token,claimed_by,claimed_at,claim_expires_at
from private.generation_incident_captures
where capture_id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000003';
create temporary table metadata_audit_before as
select count(*) as count from private.generation_incident_access_audit;
grant select on metadata_window to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 minute')$$,
  'P0001','OWNER_REQUIRED','admin cannot discover incident metadata'
);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select throws_ok(
  $$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 minute')$$,
  'P0001','OWNER_REQUIRED','civilian cannot discover incident metadata'
);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select is(
  (select count(*) from public.find_generation_incident_metadata_v1('story-metadata',1,(select window_start from metadata_window),(select window_start from metadata_window)+interval '1 minute')),
  1::bigint, 'owner finds exact target in bounded window'
);
select is(
  (select count(*) from public.find_generation_incident_metadata_v1('story-boundary',1,(select window_start from metadata_window),(select window_start from metadata_window)+interval '1 minute')),
  1::bigint, 'window includes capture created at from and excludes capture created at to'
);
select is(
  (select count(*) from public.find_generation_incident_metadata_v1('story-metadata',1,(select window_start from metadata_window)+interval '1 minute',(select window_start from metadata_window)+interval '2 minutes')),
  0::bigint, 'no-match lookup returns no metadata'
);
select throws_ok($$select * from public.find_generation_incident_metadata_v1(' story-metadata',1,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','leading story whitespace is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata ',1,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','trailing story whitespace is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('   ',1,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','whitespace-only story is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story' || chr(1),1,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','control character story is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1(repeat('x',201),1,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','overlong story is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1(null::text,1,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','null story is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',0,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','chapter zero is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',50,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','chapter fifty is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',null::integer,statement_timestamp(),statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','null chapter is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',1,null::timestamptz,statement_timestamp()+interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','null from is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp(),null::timestamptz)$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','null to is rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp(),statement_timestamp())$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','equal bounds are rejected');
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp(),statement_timestamp()-interval '1 minute')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','inverted bounds are rejected');
select is(
  (select count(*) from public.find_generation_incident_metadata_v1('missing-story',1,statement_timestamp(),statement_timestamp()+interval '60 minutes')),
  0::bigint, 'exact sixty-minute window is accepted'
);
select throws_ok($$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp(),statement_timestamp()+interval '61 minutes')$$, 'P0001','INVALID_INCIDENT_METADATA_LOOKUP','range over one hour is rejected');
reset role;

select results_eq(
  $$select capture_id,correlation_id,consumed_at,claim_token,claimed_by,claimed_at,claim_expires_at from private.generation_incident_captures where capture_id between '92000000-0000-4000-8000-000000000001' and '92000000-0000-4000-8000-000000000003' order by capture_id$$,
  $$select capture_id,correlation_id,consumed_at,claim_token,claimed_by,claimed_at,claim_expires_at from metadata_before order by capture_id$$,
  'allowed, denied, malformed, and no-match discovery leave capture state unchanged'
);
select results_eq(
  $$select count(*) from private.generation_incident_access_audit$$,
  $$select count from metadata_audit_before$$,
  'allowed, denied, malformed, and no-match discovery create no audit rows'
);

select * from finish();
rollback;
