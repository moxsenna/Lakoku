begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'generation provider retention tests require local-cli';
  end if;
end
$$;

select plan(34);

select has_table(
  'public', 'generation_provider_call_daily',
  'identity-free daily aggregate table exists'
);
select columns_are(
  'public', 'generation_provider_call_daily',
  array[
    'day', 'provider_id', 'model_id', 'use_case', 'workflow_phase',
    'outcome', 'generation_kind', 'cost_source', 'cost_currency',
    'call_count', 'success_count', 'fallback_call_count',
    'input_token_count_sum', 'output_token_count_sum', 'total_token_count_sum',
    'priced_call_count', 'unavailable_cost_count', 'cost_amount_sum',
    'elapsed_ms_sum', 'elapsed_ms_max'
  ],
  'daily aggregate has exact dimensions and metric plan'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generation_provider_call_daily'
      and column_name in (
        'user_id', 'story_id', 'chapter_number', 'job_id', 'correlation_id',
        'attempt_number', 'provider_call_id', 'error_code', 'route_version'
      )
  ),
  'daily aggregate contains no identity or request linkage columns'
);
select ok(
  exists (
    select 1
    from pg_index
    where indrelid = 'public.generation_provider_call_daily'::regclass
      and indisunique
      and indnullsnotdistinct
  ),
  'aggregate dimensions use null-safe uniqueness'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.generation_provider_call_daily'::regclass),
  'aggregate RLS is enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.generation_provider_call_daily'::regclass),
  'aggregate RLS is forced'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'generation_provider_call_daily'
  ),
  'aggregate exposes no direct RLS policies'
);
select ok(
  not has_table_privilege(
    'anon', 'public.generation_provider_call_daily',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'authenticated', 'public.generation_provider_call_daily',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  )
  and not has_table_privilege(
    'service_role', 'public.generation_provider_call_daily',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ),
  'application and service roles have no direct aggregate privileges'
);

select has_function(
  'public', 'rollup_and_purge_generation_provider_calls_v1',
  array['integer', 'timestamp with time zone', 'date'],
  'retention RPC has exact bounded signature'
);
select function_returns(
  'public', 'rollup_and_purge_generation_provider_calls_v1',
  array['integer', 'timestamp with time zone', 'date'],
  'jsonb',
  'retention RPC returns count JSON'
);
select ok(
  (select prosecdef
   from pg_proc
   where oid = 'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)'::regprocedure),
  'retention RPC is SECURITY DEFINER'
);
select is(
  (select proconfig
   from pg_proc
   where oid = 'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)'::regprocedure),
  array['search_path=""']::text[],
  'retention RPC fixes empty search_path'
);
select ok(
  not has_function_privilege(
    'public',
    'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)',
    'EXECUTE'
  ),
  'PUBLIC, anon, and authenticated cannot execute retention RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)',
    'EXECUTE'
  ),
  'service_role can execute retention RPC'
);
select ok(
  pg_get_functiondef(
    'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)'::regprocedure
  ) ilike '%for update skip locked%',
  'retention RPC uses skip-locked detail batching'
);
select ok(
  pg_get_functiondef(
    'public.rollup_and_purge_generation_provider_calls_v1(integer,timestamptz,date)'::regprocedure
  ) ilike '%delete from public.generation_provider_calls%where calls.id = any(v_detail_ids)%',
  'retention RPC deletes exact selected detail IDs'
);

set local role service_role;
select throws_ok(
  $$select public.rollup_and_purge_generation_provider_calls_v1(
      0, clock_timestamp() - interval '90 days',
      (current_date - interval '13 months')::date
    )$$,
  'P0001', 'INVALID_RETENTION_BATCH_SIZE',
  'zero batch size rejects'
);
select throws_ok(
  $$select public.rollup_and_purge_generation_provider_calls_v1(
      5001, clock_timestamp() - interval '90 days',
      (current_date - interval '13 months')::date
    )$$,
  'P0001', 'INVALID_RETENTION_BATCH_SIZE',
  'batch size above 5000 rejects'
);
select throws_ok(
  $$select public.rollup_and_purge_generation_provider_calls_v1(
      1, clock_timestamp() - interval '89 days',
      (current_date - interval '13 months')::date
    )$$,
  'P0001', 'INVALID_RETENTION_CUTOFF',
  'detail cutoff newer than 90 days rejects'
);
select throws_ok(
  $$select public.rollup_and_purge_generation_provider_calls_v1(
      1, clock_timestamp() - interval '90 days',
      (current_date - interval '12 months')::date
    )$$,
  'P0001', 'INVALID_RETENTION_CUTOFF',
  'aggregate cutoff newer than 13 months rejects'
);
reset role;

create or replace function pg_temp.insert_retention_call(
  p_provider_call_id text,
  p_created_at timestamptz,
  p_started_at timestamptz,
  p_provider_id text default 'retention-provider',
  p_outcome text default 'SUCCEEDED',
  p_fallback_index integer default 0,
  p_cost_amount numeric default 1.25,
  p_cost_currency text default 'USD',
  p_cost_source text default 'provider_actual',
  p_input_tokens bigint default 100,
  p_output_tokens bigint default 200,
  p_total_tokens bigint default 300,
  p_elapsed_ms bigint default 1000
)
returns void
language sql
as $$
  insert into public.generation_provider_calls (
    provider_call_id, user_id, story_id, chapter_number, generation_kind,
    correlation_id, use_case, workflow_phase, provider_id, model_id,
    route_version, fallback_index, actual_model_resolved, started_at, ended_at,
    elapsed_ms, outcome, error_code, input_token_count, output_token_count,
    total_token_count, cost_amount, cost_currency, cost_source, created_at
  ) values (
    p_provider_call_id, '61000000-0000-4000-8000-000000000001',
    'test:generation-provider-retention', 4, 'standard',
    gen_random_uuid(), 'chapter_generation', 'CHAPTER_PROSE_INITIAL',
    p_provider_id, 'retention-model', 'retention-v1', p_fallback_index, true,
    p_started_at, p_started_at + (p_elapsed_ms * interval '1 millisecond'),
    p_elapsed_ms, p_outcome,
    case when p_outcome = 'SUCCEEDED' then null else 'PROVIDER_REQUEST_FAILED' end,
    p_input_tokens, p_output_tokens, p_total_tokens,
    p_cost_amount, p_cost_currency, p_cost_source, p_created_at
  )
$$;

select pg_temp.insert_retention_call(
  'retention-old-1', clock_timestamp() - interval '102 days',
  date_trunc('day', clock_timestamp() - interval '102 days') + interval '1 hour',
  p_fallback_index => 0, p_cost_amount => 1.25, p_elapsed_ms => 1000
);
select pg_temp.insert_retention_call(
  'retention-old-2', clock_timestamp() - interval '101 days',
  date_trunc('day', clock_timestamp() - interval '102 days') + interval '2 hours',
  p_fallback_index => 1, p_cost_amount => 2.50, p_elapsed_ms => 2000
);
select pg_temp.insert_retention_call(
  'retention-old-3', clock_timestamp() - interval '100 days',
  date_trunc('day', clock_timestamp() - interval '100 days') + interval '1 hour',
  p_outcome => 'TIMEOUT', p_fallback_index => 1,
  p_cost_amount => null, p_cost_currency => null, p_cost_source => 'unavailable',
  p_input_tokens => null, p_output_tokens => null, p_total_tokens => null,
  p_elapsed_ms => 3000
);
select pg_temp.insert_retention_call(
  'retention-new', clock_timestamp() - interval '89 days',
  date_trunc('day', clock_timestamp() - interval '89 days') + interval '1 hour'
);

set local role service_role;
create temporary table first_retention_result as
select public.rollup_and_purge_generation_provider_calls_v1(
  2,
  clock_timestamp() - interval '90 days',
  (current_date - interval '13 months')::date
) as result;
reset role;

select is(
  (select result from first_retention_result),
  '{"rolledUp":2,"deletedDetails":2,"deletedAggregates":0,"hasMore":true}'::jsonb,
  'first bounded batch rolls up and deletes exactly two details'
);
select is(
  (select count(*) from public.generation_provider_calls
   where provider_call_id in ('retention-old-1', 'retention-old-2')),
  0::bigint,
  'selected old details delete after rollup'
);
select is(
  (select count(*) from public.generation_provider_calls
   where provider_call_id = 'retention-new'),
  1::bigint,
  'detail newer than 90-day cutoff remains'
);
select is(
  (
    select row(
      call_count, success_count, fallback_call_count,
      input_token_count_sum, output_token_count_sum, total_token_count_sum,
      priced_call_count, unavailable_cost_count, cost_amount_sum,
      elapsed_ms_sum, elapsed_ms_max
    )::text
    from public.generation_provider_call_daily
    where day = (clock_timestamp() - interval '102 days')::date
      and provider_id = 'retention-provider'
      and outcome = 'SUCCEEDED'
      and cost_source = 'provider_actual'
      and cost_currency = 'USD'
  ),
  row(
    2::bigint, 2::bigint, 1::bigint,
    200::numeric, 400::numeric, 600::numeric,
    2::bigint, 0::bigint, 3.75000000::numeric(28,8),
    3000::numeric, 2000::bigint
  )::text,
  'daily rollup records exact count, token, cost, fallback, and latency metrics'
);

set local role service_role;
create temporary table second_retention_result as
select public.rollup_and_purge_generation_provider_calls_v1(
  2,
  clock_timestamp() - interval '90 days',
  (current_date - interval '13 months')::date
) as result;
create temporary table repeated_retention_result as
select public.rollup_and_purge_generation_provider_calls_v1(
  2,
  clock_timestamp() - interval '90 days',
  (current_date - interval '13 months')::date
) as result;
reset role;

select is(
  (select result from second_retention_result),
  '{"rolledUp":1,"deletedDetails":1,"deletedAggregates":0,"hasMore":false}'::jsonb,
  'second batch consumes remaining old detail'
);
select is(
  (select result from repeated_retention_result),
  '{"rolledUp":0,"deletedDetails":0,"deletedAggregates":0,"hasMore":false}'::jsonb,
  'repeated run reports no retained detail work'
);
select is(
  (select call_count
   from public.generation_provider_call_daily
   where day = (clock_timestamp() - interval '102 days')::date
     and provider_id = 'retention-provider'
     and outcome = 'SUCCEEDED'
     and cost_source = 'provider_actual'
     and cost_currency = 'USD'),
  2::bigint,
  'repeated run does not double-count prior aggregate'
);
select is(
  (select row(
      call_count, success_count, fallback_call_count,
      input_token_count_sum, output_token_count_sum, total_token_count_sum,
      priced_call_count, unavailable_cost_count, cost_amount_sum,
      elapsed_ms_sum, elapsed_ms_max
    )::text
   from public.generation_provider_call_daily
   where day = (clock_timestamp() - interval '100 days')::date
     and provider_id = 'retention-provider'
     and outcome = 'TIMEOUT'
     and cost_source = 'unavailable'
     and cost_currency is null),
  row(
    1::bigint, 0::bigint, 1::bigint,
    0::numeric, 0::numeric, 0::numeric,
    0::bigint, 1::bigint, 0.00000000::numeric(28,8),
    3000::numeric, 3000::bigint
  )::text,
  'unavailable cost and tokens remain explicit in aggregate metrics'
);

insert into public.generation_provider_call_daily (
  day, provider_id, model_id, use_case, workflow_phase, outcome,
  generation_kind, cost_source, cost_currency, call_count, success_count,
  fallback_call_count, input_token_count_sum, output_token_count_sum,
  total_token_count_sum, priced_call_count, unavailable_cost_count,
  cost_amount_sum, elapsed_ms_sum, elapsed_ms_max
) values
  (
    (current_date - interval '14 months')::date, 'aggregate-old-1', 'model',
    'chapter_generation', 'CHAPTER_PROSE_INITIAL', 'SUCCEEDED', 'standard',
    'provider_actual', 'USD', 1, 1, 0, 1, 1, 2, 1, 0, 1, 1, 1
  ),
  (
    (current_date - interval '14 months')::date, 'aggregate-old-2', 'model',
    'chapter_generation', 'CHAPTER_PROSE_INITIAL', 'SUCCEEDED', 'standard',
    'provider_actual', 'USD', 1, 1, 0, 1, 1, 2, 1, 0, 1, 1, 1
  ),
  (
    (current_date - interval '12 months')::date, 'aggregate-new', 'model',
    'chapter_generation', 'CHAPTER_PROSE_INITIAL', 'SUCCEEDED', 'standard',
    'provider_actual', 'USD', 1, 1, 0, 1, 1, 2, 1, 0, 1, 1, 1
  );

set local role service_role;
create temporary table aggregate_purge_first as
select public.rollup_and_purge_generation_provider_calls_v1(
  1,
  clock_timestamp() - interval '90 days',
  (current_date - interval '13 months')::date
) as result;
create temporary table aggregate_purge_second as
select public.rollup_and_purge_generation_provider_calls_v1(
  1,
  clock_timestamp() - interval '90 days',
  (current_date - interval '13 months')::date
) as result;
reset role;

select is(
  (select result from aggregate_purge_first),
  '{"rolledUp":0,"deletedDetails":0,"deletedAggregates":1,"hasMore":true}'::jsonb,
  'aggregate purge deletes at most one row per requested batch'
);
select is(
  (select result from aggregate_purge_second),
  '{"rolledUp":0,"deletedDetails":0,"deletedAggregates":1,"hasMore":false}'::jsonb,
  'next aggregate purge batch finishes old rows'
);
select is(
  (select count(*) from public.generation_provider_call_daily
   where provider_id = 'aggregate-new'),
  1::bigint,
  'aggregate newer than 13-month cutoff remains'
);

create function pg_temp.reject_failed_retention_rollup()
returns trigger
language plpgsql
as $$
begin
  if new.provider_id = 'retention-fail-provider' then
    raise exception using errcode = 'P0001', message = 'TEST_RETENTION_ROLLBACK';
  end if;
  return new;
end
$$;
create trigger reject_failed_retention_rollup
before insert or update on public.generation_provider_call_daily
for each row execute function pg_temp.reject_failed_retention_rollup();

select pg_temp.insert_retention_call(
  'retention-failed-transaction', clock_timestamp() - interval '100 days',
  date_trunc('day', clock_timestamp() - interval '100 days') + interval '3 hours',
  p_provider_id => 'retention-fail-provider'
);
set local role service_role;
select throws_ok(
  $$select public.rollup_and_purge_generation_provider_calls_v1(
      1, clock_timestamp() - interval '90 days',
      (current_date - interval '13 months')::date
    )$$,
  'P0001', 'TEST_RETENTION_ROLLBACK',
  'rollup failure aborts cleanup statement'
);
reset role;
select is(
  (select count(*) from public.generation_provider_calls
   where provider_call_id = 'retention-failed-transaction'),
  1::bigint,
  'failed transaction leaves selected detail intact'
);
select is(
  (select count(*) from public.generation_provider_call_daily
   where provider_id = 'retention-fail-provider'),
  0::bigint,
  'failed transaction leaves no partial aggregate'
);

select * from finish();
rollback;
