begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation provider calls schema tests require local-cli';
  end if;
end
$$;

select plan(54);

select has_table('public', 'generation_provider_calls', 'generation_provider_calls exists');
select has_pk('public', 'generation_provider_calls', 'generation_provider_calls has primary key');
select col_default_is(
  'public', 'generation_provider_calls', 'id', 'gen_random_uuid()',
  'id defaults to gen_random_uuid()'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.generation_provider_calls'::regclass
      and conname = 'generation_provider_calls_provider_call_id_key'
      and contype = 'u'
  ),
  'provider_call_id has named uniqueness'
);
select col_is_unique(
  'public', 'generation_model_pricing_versions',
  array['provider_id', 'model_id', 'effective_from'],
  'pricing effective start is unique per provider and model regardless of currency'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.generation_model_pricing_versions'::regclass
      and conname = 'generation_model_pricing_versions_no_overlap'
      and contype = 'x'
      and pg_get_constraintdef(oid) !~ '\mcurrency\M'
  ),
  'pricing overlap exclusion has no currency dimension'
);
select columns_are(
  'public', 'generation_provider_calls',
  array[
    'id', 'provider_call_id', 'user_id', 'story_id', 'chapter_number',
    'generation_kind', 'job_id', 'correlation_id', 'attempt_number', 'use_case',
    'workflow_phase', 'provider_id', 'model_id', 'route_version', 'fallback_index',
    'actual_model_resolved', 'started_at', 'ended_at', 'elapsed_ms', 'outcome',
    'error_code', 'input_token_count', 'output_token_count', 'total_token_count',
    'cost_amount', 'cost_currency', 'cost_source', 'pricing_version_id', 'created_at'
  ],
  'generation_provider_calls has exact sanitized columns'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generation_provider_calls'
      and column_name in (
        'prompt', 'system_prompt', 'request', 'response', 'response_body',
        'headers', 'credentials', 'api_key', 'metadata', 'payload', 'raw'
      )
  ),
  'forbidden payload and credential columns are absent'
);
select set_eq(
  $$select conname::text
    from pg_constraint
    where conrelid = 'public.generation_provider_calls'::regclass
      and contype = 'c'$$,
  $$values
    ('generation_provider_calls_provider_call_id_check'),
    ('generation_provider_calls_story_id_check'),
    ('generation_provider_calls_chapter_number_check'),
    ('generation_provider_calls_generation_kind_check'),
    ('generation_provider_calls_job_attempt_pair_check'),
    ('generation_provider_calls_attempt_number_check'),
    ('generation_provider_calls_use_case_check'),
    ('generation_provider_calls_workflow_phase_check'),
    ('generation_provider_calls_provider_id_check'),
    ('generation_provider_calls_model_id_check'),
    ('generation_provider_calls_route_version_check'),
    ('generation_provider_calls_fallback_index_check'),
    ('generation_provider_calls_time_check'),
    ('generation_provider_calls_elapsed_ms_check'),
    ('generation_provider_calls_outcome_check'),
    ('generation_provider_calls_error_code_check'),
    ('generation_provider_calls_error_outcome_check'),
    ('generation_provider_calls_input_tokens_check'),
    ('generation_provider_calls_output_tokens_check'),
    ('generation_provider_calls_total_tokens_check'),
    ('generation_provider_calls_token_total_consistency_check'),
    ('generation_provider_calls_cost_amount_check'),
    ('generation_provider_calls_cost_currency_check'),
    ('generation_provider_calls_cost_source_check'),
    ('generation_provider_calls_cost_shape_check')$$,
  'all validation checks have stable names'
);

select has_index('public', 'generation_provider_calls', 'generation_provider_calls_started_idx', 'started timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_job_timeline_idx', 'partial job timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_correlation_timeline_idx', 'correlation timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_provider_model_time_idx', 'provider model timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_user_time_idx', 'user timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_story_chapter_time_idx', 'story chapter timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_outcome_error_time_idx', 'outcome error timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_cost_source_time_idx', 'cost source timeline index exists');
select has_index('public', 'generation_provider_calls', 'generation_provider_calls_retention_idx', 'retention index exists');

select has_function('public', 'generation_provider_calls_enforce_identity_v1', array[]::text[], 'identity trigger function exists');
select has_trigger('public', 'generation_provider_calls', 'generation_provider_calls_enforce_identity_v1_trigger', 'append-only identity trigger exists');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_provider_calls'::regclass), 'RLS is enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.generation_provider_calls'::regclass), 'RLS is forced');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'generation_provider_calls'
  ),
  'table exposes no direct policies'
);
select ok(
  not exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'public.generation_provider_calls'::regclass and acl.grantee = 0
  ),
  'PUBLIC has no table privileges'
);
select ok(
  not has_table_privilege('anon', 'public.generation_provider_calls', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon has no table privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.generation_provider_calls', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated has no table privileges'
);
select ok(has_table_privilege('service_role', 'public.generation_provider_calls', 'SELECT'), 'service_role can select');
select ok(has_table_privilege('service_role', 'public.generation_provider_calls', 'INSERT'), 'service_role can insert');
select ok(
  not has_table_privilege('service_role', 'public.generation_provider_calls', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'service_role has no extra table privileges'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.generation_provider_calls_enforce_identity_v1()'::regprocedure),
  'trigger function is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc where oid = 'public.generation_provider_calls_enforce_identity_v1()'::regprocedure),
  array['search_path=""']::text[],
  'trigger function fixes empty search_path'
);
select ok(
  not has_function_privilege('public', 'public.generation_provider_calls_enforce_identity_v1()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.generation_provider_calls_enforce_identity_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.generation_provider_calls_enforce_identity_v1()', 'EXECUTE'),
  'PUBLIC, anon, and authenticated cannot execute trigger function'
);
select ok(
  has_function_privilege('service_role', 'public.generation_provider_calls_enforce_identity_v1()', 'EXECUTE'),
  'service_role can execute trigger function'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_provider_calls'::regclass
      and contype = 'f' and confrelid = 'public.generation_jobs'::regclass
      and confdeltype = 'r'
  ),
  'job reference uses ON DELETE RESTRICT'
);
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_provider_calls'::regclass
      and contype = 'f' and confrelid = 'auth.users'::regclass
  ),
  'user_id is a snapshot without auth FK'
);
select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'public.generation_provider_calls'::regclass
      and contype = 'f' and confrelid = 'public.stories'::regclass
  ),
  'story_id is a snapshot without stories FK'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.generation_provider_calls'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.generation_model_pricing_versions'::regclass
      and c.confdeltype = 'r'
      and a.attname = 'pricing_version_id'
  ),
  'pricing_version_id references Task 3 pricing with ON DELETE RESTRICT'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('41000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'provider-call-owner@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp()),
  ('41000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'provider-call-other@example.invalid', '', clock_timestamp(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   clock_timestamp(), clock_timestamp())
on conflict (id) do nothing;

insert into public.stories (id, title)
values
  ('test:generation-provider-call', 'Provider Call Fixture'),
  ('test:generation-provider-call-other', 'Provider Call Other Fixture')
on conflict (id) do nothing;

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind, status,
  deadline_at, correlation_id, publication_idempotency_key
) values (
  '42000000-0000-4000-8000-000000000001',
  'test:generation-provider-call', 7,
  '41000000-0000-4000-8000-000000000001', 'standard', 'QUEUED',
  clock_timestamp() + interval '20 minutes',
  '43000000-0000-4000-8000-000000000001',
  'generation-job:42000000-0000-4000-8000-000000000001:publish:7'
);
update public.generation_jobs
set status = 'RUNNING', attempt_count = 1, worker_id = 'provider-call-worker',
    claim_token = '44000000-0000-4000-8000-000000000001',
    claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
where id = '42000000-0000-4000-8000-000000000001';

create or replace function pg_temp.insert_sync_call(
  p_provider_call_id text,
  p_cost_source text default 'unavailable',
  p_cost_amount numeric default null,
  p_cost_currency text default null,
  p_pricing_version_id uuid default null
)
returns void
language sql
as $$
  insert into public.generation_provider_calls (
    provider_call_id, user_id, story_id, chapter_number, generation_kind,
    correlation_id, use_case, workflow_phase, provider_id, model_id,
    route_version, fallback_index, actual_model_resolved, started_at, ended_at,
    elapsed_ms, outcome, error_code, input_token_count, output_token_count,
    total_token_count, cost_amount, cost_currency, cost_source, pricing_version_id
  ) values (
    p_provider_call_id, '41000000-0000-4000-8000-000000000001',
    'test:generation-provider-call', 7, 'standard', gen_random_uuid(),
    'chapter_generation', 'provider_call', 'openrouter', 'model-v1',
    'chapter-v1', 0, true, clock_timestamp() - interval '1 second', clock_timestamp(),
    1000, 'SUCCEEDED', null, 10, 20, 30,
    p_cost_amount, p_cost_currency, p_cost_source, p_pricing_version_id
  )
$$;

create or replace function pg_temp.assert_invalid_identifier_checks()
returns void
language plpgsql
as $$
declare
  v_case text;
  v_column text;
  v_value text;
  v_counter integer := 0;
begin
  foreach v_case in array array[
    'provider_call_id|' || ' whitespace ',
    'provider_call_id|' || repeat('c', 201),
    'provider_call_id|' || E'call\nsecret',
    'story_id|' || ' story ',
    'story_id|' || repeat('s', 201),
    'story_id|' || E'story\tsecret',
    'use_case|' || ' use_case ',
    'use_case|' || repeat('u', 101),
    'use_case|' || E'use\nsecret',
    'workflow_phase|' || ' phase ',
    'workflow_phase|' || repeat('w', 101),
    'workflow_phase|' || E'phase\rsecret',
    'provider_id|' || ' provider ',
    'provider_id|' || repeat('p', 81),
    'provider_id|' || E'provider\tsecret',
    'model_id|' || ' model ',
    'model_id|' || repeat('m', 201),
    'model_id|' || E'model\nsecret',
    'route_version|' || ' route ',
    'route_version|' || repeat('r', 101),
    'route_version|' || E'route\nsecret'
  ] loop
    v_counter := v_counter + 1;
    v_column := split_part(v_case, '|', 1);
    v_value := split_part(v_case, '|', 2);
    begin
      insert into public.generation_provider_calls (
        provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
        provider_id,model_id,route_version,fallback_index,actual_model_resolved,
        started_at,ended_at,elapsed_ms,outcome,cost_source
      ) values (
        case when v_column = 'provider_call_id' then v_value else 'invalid-text-' || v_counter end,
        '41000000-0000-4000-8000-000000000001',
        case when v_column = 'story_id' then v_value else 'test:generation-provider-call' end,
        gen_random_uuid(),
        case when v_column = 'use_case' then v_value else 'chapter_generation' end,
        case when v_column = 'workflow_phase' then v_value else 'provider_call' end,
        case when v_column = 'provider_id' then v_value else 'openrouter' end,
        case when v_column = 'model_id' then v_value else 'model-v1' end,
        case when v_column = 'route_version' then v_value else 'chapter-v1' end,
        0, true, clock_timestamp(), clock_timestamp(), 0, 'SUCCEEDED', 'unavailable'
      );
      raise exception 'invalid identifier unexpectedly succeeded';
    exception when check_violation then null;
    end;
  end loop;
end
$$;

create or replace function pg_temp.assert_invalid_ranges()
returns void
language plpgsql
as $$
declare
  v_case text;
  v_column text;
  v_value text;
  v_counter integer := 0;
begin
  foreach v_case in array array[
    'chapter_number|0', 'chapter_number|51',
    'attempt_number|0', 'attempt_number|21',
    'input_token_count|-1', 'output_token_count|-1',
    'total_token_count|-1', 'cost_amount|-0.00000001'
  ] loop
    v_counter := v_counter + 1;
    v_column := split_part(v_case, '|', 1);
    v_value := split_part(v_case, '|', 2);
    begin
      execute format(
        'insert into public.generation_provider_calls (provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,ended_at,elapsed_ms,outcome,error_code,cost_source,%I) values (%L,%L,%L,gen_random_uuid(),%L,%L,%L,%L,0,true,clock_timestamp(),clock_timestamp(),0,%L,null,%L,%s)',
        v_column, 'invalid-range-' || v_counter,
        '41000000-0000-4000-8000-000000000001', 'test:generation-provider-call',
        'chapter_generation', 'provider_call', 'openrouter', 'model-v1',
        'SUCCEEDED', 'unavailable', v_value
      );
      raise exception 'invalid range unexpectedly succeeded';
    exception when check_violation then null;
    end;
  end loop;

  foreach v_value in array array['-1', '33'] loop
    begin
      execute format(
        'insert into public.generation_provider_calls (provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,ended_at,elapsed_ms,outcome,error_code,cost_source) values (%L,%L,%L,gen_random_uuid(),%L,%L,%L,%L,%s,true,clock_timestamp(),clock_timestamp(),0,%L,null,%L)',
        'invalid-fallback-' || v_value,
        '41000000-0000-4000-8000-000000000001', 'test:generation-provider-call',
        'chapter_generation', 'provider_call', 'openrouter', 'model-v1', v_value,
        'SUCCEEDED', 'unavailable'
      );
      raise exception 'invalid fallback index unexpectedly succeeded';
    exception when check_violation then null;
    end;
  end loop;

  begin
    insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
      provider_id,model_id,fallback_index,actual_model_resolved,started_at,ended_at,
      elapsed_ms,outcome,error_code,cost_source
    ) values (
      'invalid-elapsed','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),clock_timestamp(),-1,'SUCCEEDED',null,'unavailable'
    );
    raise exception 'invalid elapsed unexpectedly succeeded';
  exception when check_violation then null;
  end;
end
$$;

create or replace function pg_temp.assert_invalid_error_shapes()
returns void
language plpgsql
as $$
declare
  v_error_code text;
begin
  begin
    insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
      provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,error_code,cost_source
    ) values (
      'invalid-error-success','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),'SUCCEEDED','FAILED','unavailable'
    );
    raise exception 'success with error unexpectedly succeeded';
  exception when check_violation then null;
  end;
  begin
    insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
      provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,error_code,cost_source
    ) values (
      'invalid-error-missing','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),'TIMEOUT',null,'unavailable'
    );
    raise exception 'failure without error unexpectedly succeeded';
  exception when check_violation then null;
  end;
  foreach v_error_code in array array[
    'lowercase-error', ' ERROR_CODE ', E'ERROR\nCODE', repeat('E', 101)
  ] loop
    begin
      insert into public.generation_provider_calls (
        provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
        provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,error_code,cost_source
      ) values (
        'invalid-error-format-' || md5(v_error_code),
        '41000000-0000-4000-8000-000000000001','test:generation-provider-call',
        gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
        clock_timestamp(),'TIMEOUT',v_error_code,'unavailable'
      );
      raise exception 'invalid error code unexpectedly succeeded';
    exception when check_violation then null;
    end;
  end loop;
end
$$;

create or replace function pg_temp.assert_invalid_cost_shapes()
returns void
language plpgsql
as $function$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    $$select pg_temp.insert_sync_call('cost-unavailable-amount','unavailable',1,'USD',null)$$,
    $$select pg_temp.insert_sync_call('cost-unavailable-currency','unavailable',null,'USD',null)$$,
    $$select pg_temp.insert_sync_call('cost-unavailable-pricing','unavailable',null,null,'45000000-0000-4000-8000-000000000001')$$,
    $$select pg_temp.insert_sync_call('cost-actual-missing-amount','provider_actual',null,'USD',null)$$,
    $$select pg_temp.insert_sync_call('cost-actual-missing-currency','provider_actual',1,null,null)$$,
    $$select pg_temp.insert_sync_call('cost-actual-pricing','provider_actual',1,'USD','45000000-0000-4000-8000-000000000001')$$,
    $$select pg_temp.insert_sync_call('cost-estimate-missing-amount','price_estimate',null,'USD','45000000-0000-4000-8000-000000000001')$$,
    $$select pg_temp.insert_sync_call('cost-estimate-missing-currency','price_estimate',1,null,'45000000-0000-4000-8000-000000000001')$$,
    $$select pg_temp.insert_sync_call('cost-estimate-missing-pricing','price_estimate',1,'USD',null)$$,
    $$select pg_temp.insert_sync_call('cost-lower-currency','provider_actual',1,'usd',null)$$
  ] loop
    begin
      execute v_sql;
      raise exception 'invalid cost shape unexpectedly succeeded';
    exception when check_violation then null;
    end;
  end loop;
end
$function$;

create or replace function pg_temp.assert_forged_job_identity()
returns void
language plpgsql
as $function$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    $$insert into public.generation_provider_calls (provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source) values ('forged-user','41000000-0000-4000-8000-000000000002','test:generation-provider-call',7,'standard','42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',1,'chapter_generation','provider_call','openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable')$$,
    $$insert into public.generation_provider_calls (provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source) values ('forged-story','41000000-0000-4000-8000-000000000001','test:generation-provider-call-other',7,'standard','42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',1,'chapter_generation','provider_call','openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable')$$,
    $$insert into public.generation_provider_calls (provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source) values ('forged-chapter','41000000-0000-4000-8000-000000000001','test:generation-provider-call',8,'standard','42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',1,'chapter_generation','provider_call','openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable')$$,
    $$insert into public.generation_provider_calls (provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source) values ('forged-kind','41000000-0000-4000-8000-000000000001','test:generation-provider-call',7,'personalized','42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',1,'chapter_generation','provider_call','openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable')$$,
    $$insert into public.generation_provider_calls (provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source) values ('forged-correlation','41000000-0000-4000-8000-000000000001','test:generation-provider-call',7,'standard','42000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'chapter_generation','provider_call','openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable')$$,
    $$insert into public.generation_provider_calls (provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source) values ('forged-attempt','41000000-0000-4000-8000-000000000001','test:generation-provider-call',7,'standard','42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',2,'chapter_generation','provider_call','openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable')$$
  ] loop
    begin
      execute v_sql;
      raise exception 'forged job identity unexpectedly succeeded';
    exception when sqlstate 'P0001' then
      if sqlerrm is distinct from 'GENERATION_PROVIDER_CALL_IDENTITY_MISMATCH' then raise; end if;
    end;
  end loop;
end
$function$;

select lives_ok(
  $$select pg_temp.insert_sync_call('sync-valid')$$,
  'valid synchronous row with null job and attempt is accepted'
);
select lives_ok(
  $$select pg_temp.assert_invalid_identifier_checks()$$,
  'whitespace, control characters, and oversized identifiers reject'
);
select lives_ok(
  $$select pg_temp.assert_invalid_ranges()$$,
  'negative and out-of-range numbers reject'
);
select throws_ok(
  $$insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
      provider_id,model_id,fallback_index,actual_model_resolved,started_at,ended_at,outcome,cost_source
    ) values (
      'bad-time','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),clock_timestamp()-interval '1 second','SUCCEEDED','unavailable'
    )$$,
  '23514', null, 'end before start rejects'
);
select throws_ok(
  $$insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
      provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,cost_source
    ) values (
      'bad-outcome','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),'UNKNOWN','unavailable'
    )$$,
  '23514', null, 'unsupported outcome rejects'
);
select throws_ok(
  $$select pg_temp.insert_sync_call('bad-source','unknown')$$,
  '23514', null, 'unsupported cost source rejects'
);
select lives_ok(
  $$select pg_temp.assert_invalid_error_shapes()$$,
  'invalid error code and outcome shapes reject'
);
select lives_ok(
  $$select pg_temp.assert_invalid_cost_shapes()$$,
  'invalid generic pre-pricing cost shapes reject'
);
select throws_ok(
  $$insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,use_case,workflow_phase,
      provider_id,model_id,fallback_index,actual_model_resolved,started_at,outcome,
      input_token_count,output_token_count,total_token_count,cost_source
    ) values (
      'bad-total','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),'SUCCEEDED',10,20,31,'unavailable'
    )$$,
  '23514', null, 'inconsistent known token total rejects'
);
select lives_ok(
  $$insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,
      correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,
      fallback_index,actual_model_resolved,started_at,outcome,cost_source
    ) values (
      'job-valid','41000000-0000-4000-8000-000000000001','test:generation-provider-call',7,
      'standard','42000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000001',1,'chapter_generation','provider_call',
      'openrouter','model-v1',0,true,clock_timestamp(),'SUCCEEDED','unavailable'
    )$$,
  'correct job identity is accepted'
);
select lives_ok(
  $$select pg_temp.assert_forged_job_identity()$$,
  'forged job user, story, chapter, kind, correlation, and attempt reject'
);
select throws_ok(
  $$insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,job_id,correlation_id,attempt_number,
      use_case,workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,
      started_at,outcome,cost_source
    ) values (
      'missing-job','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      '42000000-0000-4000-8000-000000000099',gen_random_uuid(),1,
      'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),'SUCCEEDED','unavailable'
    )$$,
  'P0001', 'GENERATION_PROVIDER_CALL_IDENTITY_MISMATCH', 'missing job rejects with stable token'
);
select throws_ok(
  $$insert into public.generation_provider_calls (
      provider_call_id,user_id,story_id,correlation_id,attempt_number,use_case,
      workflow_phase,provider_id,model_id,fallback_index,actual_model_resolved,
      started_at,outcome,cost_source
    ) values (
      'sync-attempt','41000000-0000-4000-8000-000000000001','test:generation-provider-call',
      gen_random_uuid(),1,'chapter_generation','provider_call','openrouter','model-v1',0,true,
      clock_timestamp(),'SUCCEEDED','unavailable'
    )$$,
  '23514', null, 'synchronous row cannot carry attempt'
);
select throws_ok(
  $$update public.generation_provider_calls set outcome = 'ABORTED' where provider_call_id = 'sync-valid'$$,
  'P0001', 'GENERATION_PROVIDER_CALL_APPEND_ONLY', 'UPDATE rejects with append-only token'
);
select throws_ok(
  $$delete from public.generation_provider_calls where provider_call_id = 'sync-valid'$$,
  'P0001', 'GENERATION_PROVIDER_CALL_APPEND_ONLY', 'DELETE rejects with append-only token'
);
select throws_ok(
  $$select pg_temp.insert_sync_call('sync-valid')$$,
  '23505', null, 'provider_call_id is unique'
);
insert into public.generation_model_pricing_versions (
  id, provider_id, model_id, input_token_price, output_token_price,
  currency, unit_size, effective_from, created_by
) values (
  '45000000-0000-4000-8000-000000000001', 'openrouter', 'model-v1',
  1, 1, 'USD', 1000000, clock_timestamp() - interval '1 day',
  '41000000-0000-4000-8000-000000000001'
);
select lives_ok(
  $$select pg_temp.insert_sync_call('cost-unavailable-valid','unavailable',null,null,null);
    select pg_temp.insert_sync_call('cost-actual-valid','provider_actual',1.25,'USD',null);
    select pg_temp.insert_sync_call('cost-estimate-valid','price_estimate',1.25,'USD','45000000-0000-4000-8000-000000000001')$$,
  'all valid generic pre-pricing cost shapes are accepted'
);

select * from finish();
rollback;
