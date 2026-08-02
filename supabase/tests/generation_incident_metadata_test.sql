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
select is(
  (select string_agg(parameter_name || ':' || data_type, ',' order by ordinal_position)
   from information_schema.parameters
   where specific_schema='public' and specific_name like 'find_generation_incident_metadata_v1%'
     and parameter_mode='OUT'),
  'capture_id:uuid,correlation_id:uuid', 'metadata RPC returns IDs only'
);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('91000000-0000-4000-8000-000000000001','authenticated','authenticated','metadata-owner@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp()),
('91000000-0000-4000-8000-000000000002','authenticated','authenticated','metadata-admin@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp())
on conflict (id) do nothing;
insert into public.admin_users(user_id,role) values
('91000000-0000-4000-8000-000000000001','owner'),
('91000000-0000-4000-8000-000000000002','admin')
on conflict(user_id) do update set role=excluded.role;

insert into private.generation_incident_captures(
 capture_id,correlation_id,incident_key,label_fingerprint,version,story_id,chapter_number,choice_index,stage,code,ciphertext,nonce,auth_tag,created_at,expires_at
) values
('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',repeat('m',44),repeat('f',44),1,'story-metadata',1,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE','Y2lwaGVydGV4dA==','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',statement_timestamp(),statement_timestamp()+interval '30 minutes');

create temporary table metadata_before as
select capture_id,correlation_id,consumed_at,claim_token,claimed_by,claimed_at,claim_expires_at
from private.generation_incident_captures where capture_id='92000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 minute')$$,
  'P0001','OWNER_REQUIRED','admin cannot discover incident metadata'
);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select is(
  (select count(*) from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 minute')),
  1::bigint, 'owner finds exact target in bounded window'
);
select is(
  (select count(*) from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp()+interval '1 minute',statement_timestamp()+interval '2 minutes')),
  0::bigint, 'created-at upper/lower window excludes nonmatching capture'
);
select throws_ok(
  $$select * from public.find_generation_incident_metadata_v1('story-metadata',1,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '61 minutes')$$,
  'P0001','INVALID_INCIDENT_METADATA_LOOKUP','range over one hour is rejected'
);
reset role;

select results_eq(
  $$select capture_id,correlation_id,consumed_at,claim_token,claimed_by,claimed_at,claim_expires_at from private.generation_incident_captures where capture_id='92000000-0000-4000-8000-000000000001'$$,
  $$select capture_id,correlation_id,consumed_at,claim_token,claimed_by,claimed_at,claim_expires_at from metadata_before$$,
  'metadata discovery leaves private capture state unchanged'
);
select is((select count(*) from private.generation_incident_access_audit where capture_id='92000000-0000-4000-8000-000000000001'),0::bigint,'metadata discovery creates no audit rows');

select * from finish();
rollback;
