begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using errcode = 'P0001', message = 'generation incident capture tests require local-cli';
  end if;
end
$$;

select has_table('private', 'generation_incident_captures', 'encrypted incident table exists');
select columns_are(
  'private', 'generation_incident_captures',
  array[
    'capture_id','correlation_id','incident_key','label_fingerprint','version','story_id',
    'chapter_number','choice_index','stage','code','ciphertext','nonce','auth_tag','created_at',
    'expires_at','consumed_at','claim_token','claimed_by','claimed_at','claim_expires_at'
  ],
  'incident table stores envelope, identity, and private claim state only'
);
select hasnt_column('private', 'generation_incident_captures', 'label', 'plaintext label absent');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where oid = 'private.generation_incident_captures'::regclass),
  'incident storage has forced RLS'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='private'
    and tablename in ('generation_incident_captures','generation_incident_access_audit')),
  'private tables expose no direct RLS policies'
);
select hasnt_function('public', 'consume_generation_incident_v1', array['uuid','uuid'], 'legacy consume RPC removed');
select has_function('public', 'claim_generation_incident_v1', array['uuid','uuid','uuid'], 'claim RPC exists');
select has_function('public', 'finalize_generation_incident_v1', array['uuid','uuid','uuid'], 'finalize RPC exists');
select has_function('public', 'release_generation_incident_claim_v1', array['uuid','uuid','uuid'], 'release RPC exists');
select has_function('public', 'cleanup_generation_incidents_scheduled_v1', array[]::text[], 'bounded cleanup wrapper exists');
select is(
  (select proconfig from pg_proc where oid=to_regprocedure('public.claim_generation_incident_v1(uuid,uuid,uuid)')),
  array['search_path=""']::text[], 'claim RPC fixes empty search path'
);
select ok(
  has_function_privilege('authenticated','public.claim_generation_incident_v1(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_generation_incident_v1(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.claim_generation_incident_v1(uuid,uuid,uuid)','EXECUTE'),
  'claim RPC execute belongs to authenticated only'
);
select ok(
  not has_function_privilege('authenticated','public.cleanup_generation_incidents_scheduled_v1()','EXECUTE')
  and not has_function_privilege('service_role','public.cleanup_generation_incidents_scheduled_v1()','EXECUTE'),
  'scheduled wrapper has no application role execute grant'
);

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('81000000-0000-4000-8000-000000000001','authenticated','authenticated','incident-owner@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp()),
('81000000-0000-4000-8000-000000000002','authenticated','authenticated','incident-owner-two@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp()),
('81000000-0000-4000-8000-000000000003','authenticated','authenticated','incident-admin@example.com','',clock_timestamp(),'{}','{}',clock_timestamp(),clock_timestamp())
on conflict (id) do nothing;
insert into public.admin_users(user_id,role) values
('81000000-0000-4000-8000-000000000001','owner'),
('81000000-0000-4000-8000-000000000002','owner'),
('81000000-0000-4000-8000-000000000003','admin')
on conflict(user_id) do update set role=excluded.role;

set local role service_role;
select is((select captured from public.capture_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',
  repeat('a',44),repeat('f',44),1,'story-claim',7,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE',
  'Y2lwaGVydGV4dA==','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',clock_timestamp()+interval '59 minutes'
)),true,'capture succeeds');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
select throws_ok(
  $$select * from public.claim_generation_incident_v1('82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001')$$,
  'P0001','OWNER_REQUIRED','non-owner cannot claim'
);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select is((select ciphertext from public.claim_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001'
)),'Y2lwaGVydGV4dA==','owner claims encrypted evidence');
reset role;
select is((select claim_expires_at-claimed_at from private.generation_incident_captures where capture_id='82000000-0000-4000-8000-000000000001'),interval '2 minutes','claim TTL exactly two minutes');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.claim_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002'
)),0::bigint,'second concurrent claimant cannot take active claim');
reset role;

update private.generation_incident_captures
set claimed_at=stale.expires_at-interval '2 minutes', claim_expires_at=stale.expires_at
from (select clock_timestamp()-interval '1 minute' as expires_at) as stale
where capture_id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.claim_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002'
)),1::bigint,'stale claim can be reclaimed');
select is(public.release_generation_incident_claim_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000099'
),false,'wrong decrypt-equivalent token cannot release');
reset role;
select is((select count(*) from private.generation_incident_access_audit where capture_id='82000000-0000-4000-8000-000000000001' and action='CONSUMED'),0::bigint,'failed release creates no consumed audit');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select is(public.release_generation_incident_claim_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002'
),true,'exact actor and token release claim');
select is((select count(*) from public.claim_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000003'
)),1::bigint,'released evidence can be claimed again');
select is(public.finalize_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000003'
),true,'exact owner finalizes claim once');
select is(public.finalize_generation_incident_v1(
  '82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000003'
),false,'finalize cannot consume twice');
reset role;
select is((select count(*) from private.generation_incident_access_audit where capture_id='82000000-0000-4000-8000-000000000001' and action='CONSUMED'),1::bigint,'finalize persists one consumed audit');
select ok((select claim_token is null and claimed_by is null and claimed_at is null and claim_expires_at is null from private.generation_incident_captures where capture_id='82000000-0000-4000-8000-000000000001'),'finalize clears claim state');

insert into private.generation_incident_captures(
 capture_id,correlation_id,incident_key,label_fingerprint,version,story_id,chapter_number,choice_index,stage,code,ciphertext,nonce,auth_tag,created_at,expires_at,claim_token,claimed_by,claimed_at,claim_expires_at
) values
('82000000-0000-4000-8000-000000000010','83000000-0000-4000-8000-000000000010',repeat('b',44),repeat('f',44),1,'story-active',8,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE','YWN0aXZl','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '30 minutes','84000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000001',date_trunc('second',clock_timestamp()-interval '3 minutes'),date_trunc('second',clock_timestamp()-interval '1 minute')),
('82000000-0000-4000-8000-000000000011','83000000-0000-4000-8000-000000000011',repeat('c',44),repeat('f',44),1,'story-expired',9,0,'FINAL_BRANCH_SCHEMA','CHOICE_NOT_ACTIONABLE','ZXhwaXJlZA==','bm9uY2UxMjM0NTY=','YXV0aHRhZzEyMzQ1Ng==',clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '1 minute',null,null,null,null);
set local role service_role;
select is((select deleted_count from public.cleanup_generation_incidents_v1(100)),2,'cleanup deletes consumed and expired rows');
reset role;
select is((select count(*) from private.generation_incident_captures where capture_id='82000000-0000-4000-8000-000000000010'),1::bigint,'cleanup preserves active unconsumed evidence');
select ok((select claim_token is null and claimed_by is null from private.generation_incident_captures where capture_id='82000000-0000-4000-8000-000000000010'),'cleanup clears stale active claim');
select is((select count(*) from private.generation_incident_access_audit where capture_id='82000000-0000-4000-8000-000000000001' and action in ('CONSUMED','PURGED')),2::bigint,'consumed and purge audits persist after deletion');
select is((select count(*) from private.generation_incident_access_audit where capture_id='82000000-0000-4000-8000-000000000011' and action='EXPIRED'),1::bigint,'expired deletion leaves persistent audit');
select is((select schedule from cron.job where jobname='generation-incident-cleanup-v1'),'*/15 * * * *','cleanup scheduled every 15 minutes');
select is((select command from cron.job where jobname='generation-incident-cleanup-v1'),'select public.cleanup_generation_incidents_scheduled_v1()','scheduler invokes bounded wrapper');

select * from finish();
rollback;
