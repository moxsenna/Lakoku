begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'admin generation observability RPC tests require local-cli';
  end if;
end
$$;

select has_table(
  'public', 'admin_generation_access_audit',
  'admin generation detail access audit table exists'
);
select columns_are(
  'public', 'admin_generation_access_audit',
  array[
    'id', 'actor_user_id', 'action', 'target_provider_call_id',
    'target_job_id', 'filter_fingerprint', 'created_at'
  ],
  'access audit stores bounded actor, action, targets, fingerprint, and time only'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class
   where oid = 'public.admin_generation_access_audit'::regclass),
  'access audit has forced RLS'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_generation_access_audit'
  ),
  'access audit exposes no direct policies'
);
select ok(
  not has_table_privilege(
    'anon', 'public.admin_generation_access_audit',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.admin_generation_access_audit',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'service_role', 'public.admin_generation_access_audit',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'application roles have no direct access-audit privileges'
);

select has_function(
  'private', 'require_generation_observability_reader_v1', array[]::text[],
  'private generation observability role helper exists'
);
select function_returns(
  'private', 'require_generation_observability_reader_v1', array[]::text[],
  'uuid', 'role helper returns authenticated actor UUID'
);
select has_function(
  'private', 'mask_email_v1', array['text'],
  'private DB email masker exists'
);
select function_returns(
  'private', 'mask_email_v1', array['text'],
  'text', 'email masker returns text'
);
select ok(
  not has_function_privilege(
    'public', 'private.require_generation_observability_reader_v1()', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'private.require_generation_observability_reader_v1()', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'private.require_generation_observability_reader_v1()', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'private.require_generation_observability_reader_v1()', 'EXECUTE'
  )
  and not has_function_privilege(
    'public', 'private.mask_email_v1(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'private.mask_email_v1(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'private.mask_email_v1(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'private.mask_email_v1(text)', 'EXECUTE'
  ),
  'private helpers have no direct application-role execution grants'
);

create temporary table observability_rpc_signatures (
  function_name text primary key,
  arguments text[] not null,
  identity text not null
) on commit drop;

insert into observability_rpc_signatures values
  (
    'admin_generation_overview_v1',
    array[
      'timestamp with time zone', 'timestamp with time zone',
      'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'uuid', 'text', 'text', 'uuid', 'uuid', 'integer'
    ],
    'public.admin_generation_overview_v1(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer)'
  ),
  (
    'admin_generation_timeseries_v1',
    array[
      'timestamp with time zone', 'timestamp with time zone',
      'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'uuid', 'text', 'text', 'uuid', 'uuid', 'integer'
    ],
    'public.admin_generation_timeseries_v1(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer)'
  ),
  (
    'admin_model_performance_v1',
    array[
      'timestamp with time zone', 'timestamp with time zone',
      'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'uuid', 'text', 'text', 'uuid', 'uuid', 'integer'
    ],
    'public.admin_model_performance_v1(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer)'
  ),
  (
    'admin_generation_provider_calls_v1',
    array[
      'timestamp with time zone', 'timestamp with time zone',
      'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'uuid', 'text', 'text', 'uuid', 'uuid', 'integer',
      'timestamp with time zone', 'uuid', 'integer'
    ],
    'public.admin_generation_provider_calls_v1(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer,timestamptz,uuid,integer)'
  ),
  (
    'admin_generation_job_detail_v1',
    array['uuid'],
    'public.admin_generation_job_detail_v1(uuid)'
  ),
  (
    'admin_generation_data_quality_v1',
    array['timestamp with time zone', 'timestamp with time zone'],
    'public.admin_generation_data_quality_v1(timestamptz,timestamptz)'
  ),
  (
    'admin_generation_error_distribution_v1',
    array[
      'timestamp with time zone', 'timestamp with time zone',
      'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'uuid', 'text', 'text', 'uuid', 'uuid', 'integer'
    ],
    'public.admin_generation_error_distribution_v1(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer)'
  ),
  (
    'admin_generation_cost_breakdown_v1',
    array[
      'timestamp with time zone', 'timestamp with time zone',
      'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'uuid', 'text', 'text', 'uuid', 'uuid', 'integer', 'integer'
    ],
    'public.admin_generation_cost_breakdown_v1(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer,integer)'
  );

select has_function(
  'public', function_name, arguments,
  function_name || ' has exact scalar signature'
)
from observability_rpc_signatures
order by function_name;

select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure(identity)), false),
  function_name || ' is SECURITY DEFINER'
)
from observability_rpc_signatures
order by function_name;

select is(
  (select proconfig from pg_proc where oid = to_regprocedure(identity)),
  array['search_path=""']::text[],
  function_name || ' fixes empty search_path'
)
from observability_rpc_signatures
order by function_name;

select ok(
  coalesce((select proretset from pg_proc where oid = to_regprocedure(identity)), false)
  and (select pg_get_function_result(to_regprocedure(identity))) ilike 'TABLE(%'
  and (select pg_get_function_result(to_regprocedure(identity))) not ilike '%json%'
  and (select pg_get_function_result(to_regprocedure(identity))) not ilike '%claim_token%'
  and (select pg_get_function_result(to_regprocedure(identity))) not ilike '%publication_result%',
  function_name || ' returns typed rows without raw JSON or secret fields'
)
from observability_rpc_signatures
order by function_name;

select ok(
  has_function_privilege('authenticated', identity, 'EXECUTE')
  and not has_function_privilege('anon', identity, 'EXECUTE')
  and not has_function_privilege('service_role', identity, 'EXECUTE')
  and not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure(identity)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  function_name || ' is callable only by authenticated role before internal RBAC'
)
from observability_rpc_signatures
order by function_name;

select ok(
  not has_table_privilege(
    'authenticated', 'public.generation_provider_calls',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.generation_jobs',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.generation_job_attempts',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'authenticated callers receive no direct observability source-table grants'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'alexander@example.com', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'bob@example.net', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  ),
  (
    '71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'civilian@example.org', '', pg_catalog.clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
on conflict (id) do nothing;

insert into public.admin_users (user_id, role) values
  ('71000000-0000-4000-8000-000000000001', 'owner'),
  ('71000000-0000-4000-8000-000000000002', 'admin')
on conflict (user_id) do update set role = excluded.role;

insert into public.stories (
  id, title, owner_user_id, visibility, story_mode
) values
  (
    'test:admin-observability-a', 'Admin observability A',
    '71000000-0000-4000-8000-000000000001', 'private', 'standard'
  ),
  (
    'test:admin-observability-b', 'Admin observability B',
    '71000000-0000-4000-8000-000000000002', 'private', 'personalized_ai'
  );

set local session_replication_role = replica;

insert into public.generation_model_pricing_versions (
  id, provider_id, model_id, input_token_price, output_token_price,
  currency, unit_size, effective_from, created_by
) values
  (
    '76000000-0000-4000-8000-000000000001', 'provider-a', 'model-a',
    1, 1, 'USD', 1000000, pg_catalog.clock_timestamp() - interval '30 days',
    '71000000-0000-4000-8000-000000000001'
  ),
  (
    '76000000-0000-4000-8000-000000000002', 'provider-b', 'model-b',
    1, 1, 'EUR', 1000000, pg_catalog.clock_timestamp() - interval '30 days',
    '71000000-0000-4000-8000-000000000001'
  );

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind, status,
  attempt_count, max_attempts, available_at, deadline_at, claimed_at,
  heartbeat_at, worker_id, claim_token, correlation_id, last_error_code,
  last_error_class, last_error_at, created_at, updated_at, completed_at,
  publication_idempotency_key, publication_result
) values
  (
    '72000000-0000-4000-8000-000000000001', 'test:admin-observability-a', 3,
    '71000000-0000-4000-8000-000000000001', 'standard', 'RUNNING',
    2, 4, pg_catalog.clock_timestamp() - interval '3 hours',
    pg_catalog.clock_timestamp() + interval '1 hour',
    pg_catalog.clock_timestamp() - interval '3 minutes',
    pg_catalog.clock_timestamp() - interval '2 minutes', 'worker-secret-name',
    '72000000-0000-4000-8000-000000000099',
    '73000000-0000-4000-8000-000000000001', 'PROVIDER_503', 'TRANSIENT',
    pg_catalog.clock_timestamp() - interval '2 minutes',
    pg_catalog.clock_timestamp() - interval '4 hours',
    pg_catalog.clock_timestamp() - interval '2 minutes', null,
    'generation-job:72000000-0000-4000-8000-000000000001:publish:3',
    '{"raw":"must never leave DB"}'::jsonb
  ),
  (
    '72000000-0000-4000-8000-000000000002', 'test:admin-observability-b', 4,
    '71000000-0000-4000-8000-000000000002', 'personalized', 'RETRY_WAIT',
    1, 4, pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() + interval '1 hour', null, null, null, null,
    '73000000-0000-4000-8000-000000000002', 'TIMEOUT', 'TRANSIENT',
    pg_catalog.clock_timestamp() - interval '30 minutes',
    pg_catalog.clock_timestamp() - interval '5 hours',
    pg_catalog.clock_timestamp() - interval '30 minutes', null,
    'generation-job:72000000-0000-4000-8000-000000000002:publish:4', null
  ),
  (
    '72000000-0000-4000-8000-000000000003', 'test:admin-observability-a', 5,
    '71000000-0000-4000-8000-000000000001', 'standard', 'FAILED',
    4, 4, pg_catalog.clock_timestamp() - interval '2 hours',
    pg_catalog.clock_timestamp() - interval '1 hour', null, null, null, null,
    '73000000-0000-4000-8000-000000000003', 'RETRY_EXHAUSTED', 'PERMANENT',
    pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() - interval '6 hours',
    pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() - interval '1 hour',
    'generation-job:72000000-0000-4000-8000-000000000003:publish:5', null
  ),
  (
    '72000000-0000-4000-8000-000000000004', 'test:admin-observability-a', 6,
    '71000000-0000-4000-8000-000000000001', 'standard', 'QUEUED',
    0, 4, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '1 hour',
    null, null, null, null, '73000000-0000-4000-8000-000000000004',
    null, null, null, pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() - interval '1 hour', null,
    'generation-job:72000000-0000-4000-8000-000000000004:publish:6', null
  );

insert into public.generation_job_attempts (
  id, job_id, correlation_id, story_id, chapter_number, attempt_number,
  workflow_phase, provider_id, model_id, started_at, ended_at, elapsed_ms,
  lease_age_ms, lease_remaining_ms, retry_decision, error_code, worker_id
) values
  (
    '74000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001',
    'test:admin-observability-a', 3, 2, 'CHAPTER_PROSE_RETRY',
    'provider-a', 'model-a', pg_catalog.clock_timestamp() - interval '2 hours',
    pg_catalog.clock_timestamp() - interval '119 minutes', 60000, 1000, 74000,
    'RETRY_BACKOFF', 'PROVIDER_503', 'worker-secret-name'
  ),
  (
    '74000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001',
    'test:admin-observability-a', 3, 1, 'CHAPTER_PROSE_INITIAL',
    'provider-a', 'model-a', pg_catalog.clock_timestamp() - interval '3 hours',
    pg_catalog.clock_timestamp() - interval '179 minutes', 60000, 1000, 74000,
    'RETRY', 'TIMEOUT', 'worker-secret-name'
  );

insert into public.generation_provider_calls (
  id, provider_call_id, user_id, story_id, chapter_number, generation_kind,
  job_id, correlation_id, attempt_number, use_case, workflow_phase,
  provider_id, model_id, route_version, fallback_index, actual_model_resolved,
  started_at, ended_at, elapsed_ms, outcome, error_code,
  input_token_count, output_token_count, total_token_count,
  cost_amount, cost_currency, cost_source, pricing_version_id, created_at
) values
  (
    '75000000-0000-4000-8000-000000000101', 'admin-observe-current-1',
    '71000000-0000-4000-8000-000000000001', 'test:admin-observability-a', 3,
    'standard', '72000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001', 1, 'chapter_generation',
    'CHAPTER_PROSE_INITIAL', 'provider-a', 'model-a', 'route-a', 0, true,
    pg_catalog.clock_timestamp() - interval '3 hours',
    pg_catalog.clock_timestamp() - interval '3 hours' + interval '10 milliseconds',
    10, 'SUCCEEDED', null, 100, 50, 150, 1.00000000, 'USD',
    'provider_actual', null, pg_catalog.clock_timestamp() - interval '3 hours'
  ),
  (
    '75000000-0000-4000-8000-000000000102', 'admin-observe-current-2',
    '71000000-0000-4000-8000-000000000001', 'test:admin-observability-a', 3,
    'standard', '72000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001', 2, 'chapter_generation',
    'CHAPTER_PROSE_RETRY', 'provider-a', 'model-a', 'route-a', 1, false,
    pg_catalog.clock_timestamp() - interval '2 hours',
    pg_catalog.clock_timestamp() - interval '2 hours' + interval '20 milliseconds',
    20, 'TIMEOUT', 'PROVIDER_TIMEOUT', null, null, null, null, null,
    'unavailable', null, pg_catalog.clock_timestamp() - interval '2 hours'
  ),
  (
    '75000000-0000-4000-8000-000000000103', 'admin-observe-current-3',
    '71000000-0000-4000-8000-000000000002', 'test:admin-observability-b', 4,
    'personalized', null, '73000000-0000-4000-8000-000000000005', null,
    'choice_generation', 'CHOICE_OPTIONS', 'provider-b', 'model-b', 'route-b',
    1, true, pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() - interval '1 hour' + interval '30 milliseconds',
    30, 'SUCCEEDED', null, 200, 100, 300, 2.00000000, 'EUR',
    'price_estimate', '76000000-0000-4000-8000-000000000002',
    pg_catalog.clock_timestamp() - interval '1 hour'
  ),
  (
    '75000000-0000-4000-8000-000000000104', 'admin-observe-current-4',
    '71000000-0000-4000-8000-000000000001', 'test:admin-observability-a', 7,
    'standard', null, '73000000-0000-4000-8000-000000000006', null,
    'chapter_generation', 'CHAPTER_REPAIR', 'provider-a', 'model-a', 'route-a',
    0, true, pg_catalog.clock_timestamp() - interval '30 minutes',
    pg_catalog.clock_timestamp() - interval '30 minutes' + interval '40 milliseconds',
    40, 'SUCCEEDED', null, 300, 150, 450, 3.00000000, 'USD',
    'price_estimate', '76000000-0000-4000-8000-000000000001',
    pg_catalog.clock_timestamp() - interval '30 minutes'
  ),
  (
    '75000000-0000-4000-8000-000000000105', 'admin-observe-previous-1',
    '71000000-0000-4000-8000-000000000001', 'test:admin-observability-a', 2,
    'standard', null, '73000000-0000-4000-8000-000000000007', null,
    'chapter_generation', 'CHAPTER_PROSE_INITIAL', 'provider-a', 'model-a',
    'route-a', 0, true, pg_catalog.clock_timestamp() - interval '25 hours',
    pg_catalog.clock_timestamp() - interval '25 hours' + interval '50 milliseconds',
    50, 'SUCCEEDED', null, 50, 25, 75, 4.00000000, 'USD',
    'provider_actual', null, pg_catalog.clock_timestamp() - interval '25 hours'
  );

set local session_replication_role = origin;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok(
  $$select * from public.admin_generation_overview_v1(
      clock_timestamp() - interval '1 day', clock_timestamp(),
      null,null,null,null,null,null,null,null,null,null,null,null,null
    )$$,
  '42501', null,
  'anonymous caller is denied at function ACL'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.admin_generation_overview_v1(
      clock_timestamp() - interval '1 day', clock_timestamp(),
      null,null,null,null,null,null,null,null,null,null,null,null,null
    )$$,
  'P0001', 'ADMIN_REQUIRED',
  'authenticated non-admin receives stable ADMIN_REQUIRED'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select * from public.admin_generation_overview_v1(
      clock_timestamp() - interval '1 day', clock_timestamp(),
      null,null,null,null,null,null,null,null,null,null,null,null,null
    )$$,
  'owner can read generation overview'
);
create temporary table admin_observe_overview as
select * from public.admin_generation_overview_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null
);
create temporary table admin_observe_page_one as
select * from public.admin_generation_provider_calls_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null,
  null,null,2
);
create temporary table admin_observe_page_two as
select * from public.admin_generation_provider_calls_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null,
  (select started_at from admin_observe_page_one order by started_at, id limit 1),
  (select id from admin_observe_page_one order by started_at, id limit 1),
  100
);
create temporary table admin_observe_filtered as
select * from public.admin_generation_provider_calls_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  'provider-b','model-b','choice_generation','CHOICE_OPTIONS','SUCCEEDED',null,
  'price_estimate','71000000-0000-4000-8000-000000000002',
  'test:admin-observability-b','personalized',null,
  '73000000-0000-4000-8000-000000000005',4,null,null,100
);
create temporary table admin_observe_timeseries as
select * from public.admin_generation_timeseries_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null
);
create temporary table admin_observe_models as
select * from public.admin_model_performance_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null
);
create temporary table admin_observe_distribution as
select * from public.admin_generation_error_distribution_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null
);
create temporary table admin_observe_cost_breakdown as
select * from public.admin_generation_cost_breakdown_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute',
  null,null,null,null,null,null,null,null,null,null,null,null,null,100
);
create temporary table admin_observe_quality as
select * from public.admin_generation_data_quality_v1(
  pg_catalog.clock_timestamp() - interval '24 hours',
  pg_catalog.clock_timestamp() + interval '1 minute'
);
reset role;

select is(
  (select array_agg(id order by started_at desc, id desc)
   from admin_observe_page_one),
  array[
    '75000000-0000-4000-8000-000000000104'::uuid,
    '75000000-0000-4000-8000-000000000103'::uuid
  ],
  'provider ledger page orders by started_at DESC and id DESC'
);
select is(
  (select count(*) from admin_observe_page_one p1
   join admin_observe_page_two p2 using (id)),
  0::bigint,
  'cursor pages contain no duplicate IDs'
);
select is(
  (select count(*) from admin_observe_page_two),
  2::bigint,
  'cursor predicate returns remaining older rows without omission'
);
select is(
  (select count(*) from admin_observe_filtered),
  1::bigint,
  'provider ledger applies every explicit filter together'
);
select is(
  (select masked_user_email from admin_observe_page_two
   where user_id = '71000000-0000-4000-8000-000000000001'
   order by started_at desc limit 1),
  'a***@example.com',
  'provider ledger masks email inside DB output'
);
select ok(
  not exists (
    select 1 from admin_observe_page_one
    where masked_user_email in ('alexander@example.com', 'bob@example.net')
  ),
  'provider ledger never returns raw email'
);

select is(
  (select row(call_count, total_token_count, success_rate, error_rate,
              fallback_rate, p50_elapsed_ms, p95_elapsed_ms,
              active_job_count, failed_job_count, retrying_job_count,
              stale_job_count)::text
   from admin_observe_overview
   where period_name = 'current' and cost_currency = 'USD'),
  row(
    4::bigint, 900::numeric,
    (3::numeric / 4), (1::numeric / 4), (2::numeric / 4),
    25::numeric, 38.5::numeric,
    2::bigint, 1::bigint, 1::bigint, 1::bigint
  )::text,
  'overview reports calls, tokens, rates, P50/P95, and 75-second stale health'
);
select is(
  (select row(actual_cost_amount, estimated_cost_amount,
              unavailable_cost_count)::text
   from admin_observe_overview
   where period_name = 'current' and cost_currency = 'USD'),
  row(1.00000000::numeric, 3.00000000::numeric, 1::bigint)::text,
  'overview separates actual, estimated, and unavailable costs'
);
select is(
  (select estimated_cost_amount from admin_observe_overview
   where period_name = 'current' and cost_currency = 'EUR'),
  2.00000000::numeric,
  'overview preserves separate currency rows'
);
select is(
  (select row(call_count, actual_cost_amount)::text
   from admin_observe_overview
   where period_name = 'previous' and cost_currency = 'USD'),
  row(1::bigint, 4.00000000::numeric)::text,
  'overview includes preceding equal-period comparison'
);
select ok(
  exists (select 1 from admin_observe_timeseries where cost_currency = 'USD')
  and exists (select 1 from admin_observe_timeseries where cost_currency = 'EUR'),
  'timeseries keeps currencies separate'
);
select is(
  (select count(distinct call_count::text || ':' || total_token_count::text)
   from admin_observe_timeseries
   where bucket_start = (select min(bucket_start) from admin_observe_timeseries)),
  1::bigint,
  'same-date currency partitions repeat full call and token totals instead of splitting them'
);
select is(
  (select pg_catalog.sum(call_count) from admin_observe_distribution),
  4::numeric,
  'error distribution covers full filtered range, not provider ledger page'
);
select ok(
  exists (
    select 1 from admin_observe_distribution
    where outcome = 'TIMEOUT' and error_code = 'PROVIDER_TIMEOUT'
      and fallback_bucket = 'FALLBACK' and call_count = 1
  ),
  'error distribution includes outcome, controlled error, and fallback buckets'
);
select ok(
  exists (
    select 1 from admin_observe_cost_breakdown
    where use_case = 'chapter_generation'
      and masked_user_email = 'a***@example.com'
      and generation_kind = 'standard'
      and provider_id = 'provider-a'
      and model_id = 'model-a'
      and cost_currency = 'USD'
  )
  and exists (
    select 1 from admin_observe_cost_breakdown
    where use_case = 'choice_generation'
      and masked_user_email = 'b***@example.net'
      and generation_kind = 'personalized'
      and provider_id = 'provider-b'
      and model_id = 'model-b'
      and cost_currency = 'EUR'
  ),
  'cost breakdown includes bounded use case, DB-masked user, kind, provider, model, and currency dimensions'
);
select is(
  (select row(call_count, success_rate, fallback_rate, p95_elapsed_ms)::text
   from admin_observe_models
   where provider_id = 'provider-a' and model_id = 'model-a'
     and cost_currency = 'USD'),
  row(3::bigint, (2::numeric / 3), (1::numeric / 3), 38::numeric)::text,
  'model performance reports exact calls, rates, and P95'
);
select is(
  (select count(*) from public.admin_generation_access_audit),
  3::bigint,
  'successful provider ledger reads create one VIEW_CALL_DETAIL audit row each'
);
select is(
  (select count(distinct filter_fingerprint)
   from public.admin_generation_access_audit
   where action = 'VIEW_CALL_DETAIL'),
  3::bigint,
  'provider ledger audit stores stable non-sensitive filter fingerprints'
);
select ok(
  (select issue_count = 1 from admin_observe_quality
   where metric_name = 'missing_usage')
  and (select issue_count = 1 from admin_observe_quality
       where metric_name = 'unavailable_pricing')
  and (select issue_count = 1 from admin_observe_quality
       where metric_name = 'unresolved_actual_model')
  and (select issue_count = 2 from admin_observe_quality
       where metric_name = 'calls_lacking_durable_correlation'),
  'data quality reports explicit partial-data counters'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
create temporary table admin_observe_job_detail as
select * from public.admin_generation_job_detail_v1(
  '72000000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (select count(*) from public.admin_generation_access_audit
   where actor_user_id = '71000000-0000-4000-8000-000000000002'
     and action = 'VIEW_JOB_DETAIL'
     and target_job_id = '72000000-0000-4000-8000-000000000001'),
  1::bigint,
  'job detail writes exactly one VIEW_JOB_DETAIL audit row'
);
select is(
  (select array_agg(row_kind || ':' || coalesce(provider_call_id, attempt_number::text)
                    order by sequence_number)
   from admin_observe_job_detail where row_kind <> 'JOB'),
  array[
    'ATTEMPT:1',
    'CALL:admin-observe-current-1',
    'ATTEMPT:2',
    'CALL:admin-observe-current-2'
  ],
  'job timeline interleaves attempts and calls chronologically with stable kind/id tie-break'
);
select is(
  (select masked_user_email from admin_observe_job_detail
   where row_kind = 'JOB'),
  'a***@example.com',
  'job detail masks user email in DB output'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema like 'pg_temp%'
      and table_name = 'admin_observe_job_detail'
      and column_name in (
        'claim_token', 'publication_result', 'last_error_class', 'raw_error',
        'error_message'
      )
  ),
  'job detail omits claim token, publication payload, and raw errors'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.admin_generation_overview_v1(
      clock_timestamp() - interval '91 days', clock_timestamp(),
      null,null,null,null,null,null,null,null,null,null,null,null,null
    )$$,
  'P0001', 'INVALID_TIME_RANGE',
  'RPC rejects range above 90 days'
);
select throws_ok(
  $$select * from public.admin_generation_provider_calls_v1(
      clock_timestamp() - interval '1 day', clock_timestamp(),
      null,null,null,null,null,null,null,null,null,null,null,null,null,
      null,null,101
    )$$,
  'P0001', 'INVALID_PAGE_SIZE',
  'provider ledger rejects page size above 100'
);
select throws_ok(
  $$select * from public.admin_generation_provider_calls_v1(
      clock_timestamp() - interval '1 day', clock_timestamp(),
      null,null,null,null,null,null,null,null,null,null,null,null,null,
      clock_timestamp(),null,10
    )$$,
  'P0001', 'INVALID_CURSOR',
  'provider ledger requires complete deterministic cursor tuple'
);
select throws_ok(
  $$select * from public.admin_generation_provider_calls_v1(
      clock_timestamp() - interval '1 day', clock_timestamp(),
      null,null,null,null,'NOT_AN_OUTCOME',null,null,null,null,null,null,null,null,
      null,null,10
    )$$,
  'P0001', 'INVALID_FILTER',
  'provider ledger rejects unsupported controlled filters'
);
reset role;

select * from finish();
rollback;
