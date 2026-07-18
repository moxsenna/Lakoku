create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Fresh local databases may encounter the historical migration revision that only
-- contains admin_search_users_v1. Preserve the intended DB-backed role source.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public, anon, authenticated;
grant select on table public.admin_users to service_role;

create table public.admin_generation_access_audit (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (
    action in ('VIEW_CALL_DETAIL', 'VIEW_JOB_DETAIL', 'EXPORT_CALLS')
  ),
  target_provider_call_id uuid,
  target_job_id uuid,
  filter_fingerprint text check (
    filter_fingerprint is null or (
      filter_fingerprint = pg_catalog.btrim(filter_fingerprint)
      and pg_catalog.length(filter_fingerprint) between 1 and 128
      and filter_fingerprint !~ '[[:cntrl:]]'
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint admin_generation_access_audit_target_check check (
    (action = 'VIEW_CALL_DETAIL' and target_provider_call_id is not null and target_job_id is null)
    or (action = 'VIEW_JOB_DETAIL' and target_provider_call_id is null and target_job_id is not null)
    or (action = 'EXPORT_CALLS' and target_provider_call_id is null and target_job_id is null)
  )
);

create index admin_generation_access_audit_actor_time_idx
on public.admin_generation_access_audit(actor_user_id, created_at desc, id desc);

create index admin_generation_access_audit_job_time_idx
on public.admin_generation_access_audit(target_job_id, created_at desc, id desc)
where target_job_id is not null;

alter table public.admin_generation_access_audit enable row level security;
alter table public.admin_generation_access_audit force row level security;
revoke all on table public.admin_generation_access_audit
  from public, anon, authenticated, service_role;

create function private.require_generation_observability_reader_v1()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1
    from public.admin_users as admins
    where admins.user_id = v_actor
      and admins.role in ('owner', 'admin')
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  return v_actor;
end
$$;

create function private.mask_email_v1(p_email text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_email is null then null
    when pg_catalog.strpos(p_email, '@') <= 1 then '***'
    else pg_catalog.left(p_email, 1) || '***'
      || pg_catalog.substr(p_email, pg_catalog.strpos(p_email, '@'))
  end
$$;

create function private.validate_generation_observability_range_v1(
  p_from timestamptz,
  p_to timestamptz
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_from is null
    or p_to is null
    or p_from >= p_to
    or p_to - p_from > interval '90 days' then
    raise exception using errcode = 'P0001', message = 'INVALID_TIME_RANGE';
  end if;
end
$$;

create function private.validate_generation_observability_filters_v1(
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_story_id text,
  p_generation_kind text,
  p_chapter_number integer
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  foreach v_value in array array[
    p_provider_id, p_model_id, p_use_case, p_workflow_phase,
    p_error_code, p_story_id
  ] loop
    if v_value is not null and (
      v_value <> pg_catalog.btrim(v_value)
      or pg_catalog.length(v_value) < 1
      or pg_catalog.length(v_value) > 200
      or v_value ~ '[[:cntrl:]]'
    ) then
      raise exception using errcode = 'P0001', message = 'INVALID_FILTER';
    end if;
  end loop;

  if p_outcome is not null and p_outcome not in (
    'SUCCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'ABORTED',
    'INVALID_RESPONSE', 'CONTENT_REJECTED'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_FILTER';
  end if;

  if p_cost_source is not null
    and p_cost_source not in ('provider_actual', 'price_estimate', 'unavailable') then
    raise exception using errcode = 'P0001', message = 'INVALID_FILTER';
  end if;

  if p_generation_kind is not null
    and p_generation_kind not in ('standard', 'personalized') then
    raise exception using errcode = 'P0001', message = 'INVALID_FILTER';
  end if;

  if p_chapter_number is not null and p_chapter_number not between 1 and 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_FILTER';
  end if;
end
$$;

revoke all on function private.require_generation_observability_reader_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.mask_email_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_generation_observability_range_v1(timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_generation_observability_filters_v1(text,text,text,text,text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;

create function public.admin_generation_overview_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_user_id uuid,
  p_story_id text,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_chapter_number integer
)
returns table (
  period_name text,
  period_from timestamptz,
  period_to timestamptz,
  cost_currency text,
  call_count bigint,
  input_token_count numeric,
  output_token_count numeric,
  total_token_count numeric,
  success_count bigint,
  error_count bigint,
  fallback_call_count bigint,
  success_rate numeric,
  error_rate numeric,
  fallback_rate numeric,
  p50_elapsed_ms numeric,
  p95_elapsed_ms numeric,
  actual_cost_amount numeric,
  estimated_cost_amount numeric,
  unavailable_cost_count bigint,
  active_job_count bigint,
  failed_job_count bigint,
  retrying_job_count bigint,
  stale_job_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);
  perform private.validate_generation_observability_filters_v1(
    p_provider_id, p_model_id, p_use_case, p_workflow_phase, p_outcome,
    p_error_code, p_cost_source, p_story_id, p_generation_kind, p_chapter_number
  );

  return query
  with periods as (
    select 'current'::text as period_name, p_from as period_from, p_to as period_to
    union all
    select 'previous', p_from - (p_to - p_from), p_from
  ), filtered_calls as (
    select c.*
    from public.generation_provider_calls as c
    cross join periods as p
    where c.started_at >= p.period_from
      and c.started_at < p.period_to
      and (p_provider_id is null or c.provider_id = p_provider_id)
      and (p_model_id is null or c.model_id = p_model_id)
      and (p_use_case is null or c.use_case = p_use_case)
      and (p_workflow_phase is null or c.workflow_phase = p_workflow_phase)
      and (p_outcome is null or c.outcome = p_outcome)
      and (p_error_code is null or c.error_code = p_error_code)
      and (p_cost_source is null or c.cost_source = p_cost_source)
      and (p_user_id is null or c.user_id = p_user_id)
      and (p_story_id is null or c.story_id = p_story_id)
      and (p_generation_kind is null or c.generation_kind = p_generation_kind)
      and (p_job_id is null or c.job_id = p_job_id)
      and (p_correlation_id is null or c.correlation_id = p_correlation_id)
      and (p_chapter_number is null or c.chapter_number = p_chapter_number)
  ), call_metrics as (
    select
      p.period_name,
      pg_catalog.count(c.id)::bigint as call_count,
      coalesce(pg_catalog.sum(c.input_token_count), 0)::numeric as input_tokens,
      coalesce(pg_catalog.sum(c.output_token_count), 0)::numeric as output_tokens,
      coalesce(pg_catalog.sum(c.total_token_count), 0)::numeric as total_tokens,
      pg_catalog.count(c.id) filter (where c.outcome = 'SUCCEEDED')::bigint as successes,
      pg_catalog.count(c.id) filter (where c.outcome <> 'SUCCEEDED')::bigint as errors,
      pg_catalog.count(c.id) filter (where c.fallback_index > 0)::bigint as fallbacks,
      pg_catalog.percentile_cont(0.5) within group (order by c.elapsed_ms)::numeric as p50,
      pg_catalog.percentile_cont(0.95) within group (order by c.elapsed_ms)::numeric as p95,
      pg_catalog.count(c.id) filter (where c.cost_source = 'unavailable')::bigint as unavailable
    from periods as p
    left join filtered_calls as c
      on c.started_at >= p.period_from and c.started_at < p.period_to
    group by p.period_name
  ), currencies as (
    select p.period_name, c.cost_currency
    from periods as p
    join filtered_calls as c
      on c.started_at >= p.period_from and c.started_at < p.period_to
    where c.cost_currency is not null
    group by p.period_name, c.cost_currency
    union all
    select p.period_name, null::text
    from periods as p
    where not exists (
      select 1 from filtered_calls as c
      where c.started_at >= p.period_from
        and c.started_at < p.period_to
        and c.cost_currency is not null
    )
  ), costs as (
    select
      cur.period_name,
      cur.cost_currency,
      coalesce(pg_catalog.sum(c.cost_amount) filter (
        where c.cost_source = 'provider_actual'
      ), 0)::numeric as actual_cost,
      coalesce(pg_catalog.sum(c.cost_amount) filter (
        where c.cost_source = 'price_estimate'
      ), 0)::numeric as estimated_cost
    from currencies as cur
    join periods as p on p.period_name = cur.period_name
    left join filtered_calls as c
      on c.started_at >= p.period_from
     and c.started_at < p.period_to
     and c.cost_currency is not distinct from cur.cost_currency
    group by cur.period_name, cur.cost_currency
  ), job_metrics as (
    select
      p.period_name,
      pg_catalog.count(j.id) filter (
        where j.status in ('QUEUED', 'RUNNING')
      )::bigint as active_jobs,
      pg_catalog.count(j.id) filter (where j.status = 'FAILED')::bigint as failed_jobs,
      pg_catalog.count(j.id) filter (where j.status = 'RETRY_WAIT')::bigint as retrying_jobs,
      pg_catalog.count(j.id) filter (
        where j.status = 'RUNNING'
          and coalesce(j.heartbeat_at, j.claimed_at) < pg_catalog.clock_timestamp() - interval '75 seconds'
      )::bigint as stale_jobs
    from periods as p
    left join public.generation_jobs as j
      on j.created_at >= p.period_from and j.created_at < p.period_to
     and (p_user_id is null or j.user_id = p_user_id)
     and (p_story_id is null or j.story_id = p_story_id)
     and (p_generation_kind is null or j.generation_kind = p_generation_kind)
     and (p_job_id is null or j.id = p_job_id)
     and (p_correlation_id is null or j.correlation_id = p_correlation_id)
     and (p_chapter_number is null or j.chapter_number = p_chapter_number)
    group by p.period_name
  )
  select
    p.period_name,
    p.period_from,
    p.period_to,
    cost.cost_currency,
    metrics.call_count,
    metrics.input_tokens,
    metrics.output_tokens,
    metrics.total_tokens,
    metrics.successes,
    metrics.errors,
    metrics.fallbacks,
    case when metrics.call_count = 0 then 0::numeric
      else metrics.successes::numeric / metrics.call_count end,
    case when metrics.call_count = 0 then 0::numeric
      else metrics.errors::numeric / metrics.call_count end,
    case when metrics.call_count = 0 then 0::numeric
      else metrics.fallbacks::numeric / metrics.call_count end,
    metrics.p50,
    metrics.p95,
    cost.actual_cost,
    cost.estimated_cost,
    metrics.unavailable,
    jobs.active_jobs,
    jobs.failed_jobs,
    jobs.retrying_jobs,
    jobs.stale_jobs
  from periods as p
  join call_metrics as metrics using (period_name)
  join costs as cost using (period_name)
  join job_metrics as jobs using (period_name)
  order by
    case p.period_name when 'current' then 0 else 1 end,
    cost.cost_currency nulls last;
end
$$;

create function public.admin_generation_timeseries_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_user_id uuid,
  p_story_id text,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_chapter_number integer
)
returns table (
  bucket_start timestamptz,
  cost_currency text,
  call_count bigint,
  success_count bigint,
  error_count bigint,
  fallback_call_count bigint,
  input_token_count numeric,
  output_token_count numeric,
  total_token_count numeric,
  actual_cost_amount numeric,
  estimated_cost_amount numeric,
  unavailable_cost_count bigint,
  p50_elapsed_ms numeric,
  p95_elapsed_ms numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);
  perform private.validate_generation_observability_filters_v1(
    p_provider_id, p_model_id, p_use_case, p_workflow_phase, p_outcome,
    p_error_code, p_cost_source, p_story_id, p_generation_kind, p_chapter_number
  );

  return query
  select
    pg_catalog.date_trunc('day', c.started_at) as bucket_start,
    c.cost_currency,
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) filter (where c.outcome = 'SUCCEEDED')::bigint,
    pg_catalog.count(*) filter (where c.outcome <> 'SUCCEEDED')::bigint,
    pg_catalog.count(*) filter (where c.fallback_index > 0)::bigint,
    coalesce(pg_catalog.sum(c.input_token_count), 0)::numeric,
    coalesce(pg_catalog.sum(c.output_token_count), 0)::numeric,
    coalesce(pg_catalog.sum(c.total_token_count), 0)::numeric,
    coalesce(pg_catalog.sum(c.cost_amount) filter (
      where c.cost_source = 'provider_actual'
    ), 0)::numeric,
    coalesce(pg_catalog.sum(c.cost_amount) filter (
      where c.cost_source = 'price_estimate'
    ), 0)::numeric,
    pg_catalog.count(*) filter (where c.cost_source = 'unavailable')::bigint,
    pg_catalog.percentile_cont(0.5) within group (order by c.elapsed_ms)::numeric,
    pg_catalog.percentile_cont(0.95) within group (order by c.elapsed_ms)::numeric
  from public.generation_provider_calls as c
  where c.started_at >= p_from and c.started_at < p_to
    and (p_provider_id is null or c.provider_id = p_provider_id)
    and (p_model_id is null or c.model_id = p_model_id)
    and (p_use_case is null or c.use_case = p_use_case)
    and (p_workflow_phase is null or c.workflow_phase = p_workflow_phase)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_error_code is null or c.error_code = p_error_code)
    and (p_cost_source is null or c.cost_source = p_cost_source)
    and (p_user_id is null or c.user_id = p_user_id)
    and (p_story_id is null or c.story_id = p_story_id)
    and (p_generation_kind is null or c.generation_kind = p_generation_kind)
    and (p_job_id is null or c.job_id = p_job_id)
    and (p_correlation_id is null or c.correlation_id = p_correlation_id)
    and (p_chapter_number is null or c.chapter_number = p_chapter_number)
  group by pg_catalog.date_trunc('day', c.started_at), c.cost_currency
  order by bucket_start, c.cost_currency nulls last;
end
$$;

create function public.admin_model_performance_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_user_id uuid,
  p_story_id text,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_chapter_number integer
)
returns table (
  provider_id text,
  model_id text,
  cost_currency text,
  call_count bigint,
  success_count bigint,
  success_rate numeric,
  fallback_call_count bigint,
  fallback_rate numeric,
  p50_elapsed_ms numeric,
  p95_elapsed_ms numeric,
  input_token_count numeric,
  output_token_count numeric,
  total_token_count numeric,
  actual_cost_amount numeric,
  estimated_cost_amount numeric,
  unavailable_cost_count bigint,
  average_cost_per_success numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);
  perform private.validate_generation_observability_filters_v1(
    p_provider_id, p_model_id, p_use_case, p_workflow_phase, p_outcome,
    p_error_code, p_cost_source, p_story_id, p_generation_kind, p_chapter_number
  );

  return query
  with filtered_calls as (
    select c.*
    from public.generation_provider_calls as c
    where c.started_at >= p_from and c.started_at < p_to
      and (p_provider_id is null or c.provider_id = p_provider_id)
      and (p_model_id is null or c.model_id = p_model_id)
      and (p_use_case is null or c.use_case = p_use_case)
      and (p_workflow_phase is null or c.workflow_phase = p_workflow_phase)
      and (p_outcome is null or c.outcome = p_outcome)
      and (p_error_code is null or c.error_code = p_error_code)
      and (p_cost_source is null or c.cost_source = p_cost_source)
      and (p_user_id is null or c.user_id = p_user_id)
      and (p_story_id is null or c.story_id = p_story_id)
      and (p_generation_kind is null or c.generation_kind = p_generation_kind)
      and (p_job_id is null or c.job_id = p_job_id)
      and (p_correlation_id is null or c.correlation_id = p_correlation_id)
      and (p_chapter_number is null or c.chapter_number = p_chapter_number)
  ), model_metrics as (
    select
      c.provider_id,
      c.model_id,
      pg_catalog.count(*)::bigint as call_count,
      pg_catalog.count(*) filter (where c.outcome = 'SUCCEEDED')::bigint as success_count,
      pg_catalog.count(*) filter (where c.fallback_index > 0)::bigint as fallback_count,
      pg_catalog.percentile_cont(0.5) within group (order by c.elapsed_ms)::numeric as p50,
      pg_catalog.percentile_cont(0.95) within group (order by c.elapsed_ms)::numeric as p95,
      coalesce(pg_catalog.sum(c.input_token_count), 0)::numeric as input_tokens,
      coalesce(pg_catalog.sum(c.output_token_count), 0)::numeric as output_tokens,
      coalesce(pg_catalog.sum(c.total_token_count), 0)::numeric as total_tokens,
      pg_catalog.count(*) filter (where c.cost_source = 'unavailable')::bigint as unavailable_count
    from filtered_calls as c
    group by c.provider_id, c.model_id
  ), model_currencies as (
    select c.provider_id, c.model_id, c.cost_currency
    from filtered_calls as c
    where c.cost_currency is not null
    group by c.provider_id, c.model_id, c.cost_currency
    union all
    select m.provider_id, m.model_id, null::text
    from model_metrics as m
    where not exists (
      select 1
      from filtered_calls as c
      where c.provider_id = m.provider_id
        and c.model_id = m.model_id
        and c.cost_currency is not null
    )
  ), model_costs as (
    select
      cur.provider_id,
      cur.model_id,
      cur.cost_currency,
      coalesce(pg_catalog.sum(c.cost_amount) filter (
        where c.cost_source = 'provider_actual'
      ), 0)::numeric as actual_cost,
      coalesce(pg_catalog.sum(c.cost_amount) filter (
        where c.cost_source = 'price_estimate'
      ), 0)::numeric as estimated_cost,
      coalesce(pg_catalog.sum(c.cost_amount) filter (
        where c.outcome = 'SUCCEEDED'
      ), 0)::numeric as successful_cost
    from model_currencies as cur
    left join filtered_calls as c
      on c.provider_id = cur.provider_id
     and c.model_id = cur.model_id
     and c.cost_currency is not distinct from cur.cost_currency
    group by cur.provider_id, cur.model_id, cur.cost_currency
  )
  select
    m.provider_id,
    m.model_id,
    costs.cost_currency,
    m.call_count,
    m.success_count,
    m.success_count::numeric / m.call_count,
    m.fallback_count,
    m.fallback_count::numeric / m.call_count,
    m.p50,
    m.p95,
    m.input_tokens,
    m.output_tokens,
    m.total_tokens,
    costs.actual_cost,
    costs.estimated_cost,
    m.unavailable_count,
    case when m.success_count = 0 then null
      else costs.successful_cost / m.success_count end
  from model_metrics as m
  join model_costs as costs using (provider_id, model_id)
  order by m.call_count desc, m.provider_id, m.model_id,
    costs.cost_currency nulls last;
end
$$;

create function public.admin_generation_provider_calls_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_provider_id text,
  p_model_id text,
  p_use_case text,
  p_workflow_phase text,
  p_outcome text,
  p_error_code text,
  p_cost_source text,
  p_user_id uuid,
  p_story_id text,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_chapter_number integer,
  p_cursor_started_at timestamptz,
  p_cursor_id uuid,
  p_page_size integer
)
returns table (
  id uuid,
  provider_call_id text,
  started_at timestamptz,
  ended_at timestamptz,
  elapsed_ms bigint,
  user_id uuid,
  masked_user_email text,
  story_id text,
  story_title text,
  chapter_number integer,
  generation_kind text,
  job_id uuid,
  correlation_id uuid,
  attempt_number integer,
  use_case text,
  workflow_phase text,
  provider_id text,
  model_id text,
  route_version text,
  fallback_index integer,
  actual_model_resolved boolean,
  outcome text,
  error_code text,
  input_token_count bigint,
  output_token_count bigint,
  total_token_count bigint,
  cost_amount numeric,
  cost_currency text,
  cost_source text,
  pricing_version_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);
  perform private.validate_generation_observability_filters_v1(
    p_provider_id, p_model_id, p_use_case, p_workflow_phase, p_outcome,
    p_error_code, p_cost_source, p_story_id, p_generation_kind, p_chapter_number
  );

  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_PAGE_SIZE';
  end if;

  if (p_cursor_started_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = 'P0001', message = 'INVALID_CURSOR';
  end if;

  return query
  select
    c.id,
    c.provider_call_id,
    c.started_at,
    c.ended_at,
    c.elapsed_ms,
    c.user_id,
    private.mask_email_v1(u.email::text),
    c.story_id,
    s.title,
    c.chapter_number,
    c.generation_kind,
    c.job_id,
    c.correlation_id,
    c.attempt_number,
    c.use_case,
    c.workflow_phase,
    c.provider_id,
    c.model_id,
    c.route_version,
    c.fallback_index,
    c.actual_model_resolved,
    c.outcome,
    c.error_code,
    c.input_token_count,
    c.output_token_count,
    c.total_token_count,
    c.cost_amount,
    c.cost_currency,
    c.cost_source,
    c.pricing_version_id
  from public.generation_provider_calls as c
  left join auth.users as u on u.id = c.user_id
  left join public.stories as s on s.id = c.story_id
  where c.started_at >= p_from and c.started_at < p_to
    and (p_provider_id is null or c.provider_id = p_provider_id)
    and (p_model_id is null or c.model_id = p_model_id)
    and (p_use_case is null or c.use_case = p_use_case)
    and (p_workflow_phase is null or c.workflow_phase = p_workflow_phase)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_error_code is null or c.error_code = p_error_code)
    and (p_cost_source is null or c.cost_source = p_cost_source)
    and (p_user_id is null or c.user_id = p_user_id)
    and (p_story_id is null or c.story_id = p_story_id)
    and (p_generation_kind is null or c.generation_kind = p_generation_kind)
    and (p_job_id is null or c.job_id = p_job_id)
    and (p_correlation_id is null or c.correlation_id = p_correlation_id)
    and (p_chapter_number is null or c.chapter_number = p_chapter_number)
    and (
      p_cursor_started_at is null
      or (c.started_at, c.id) < (p_cursor_started_at, p_cursor_id)
    )
  order by c.started_at desc, c.id desc
  limit p_page_size;
end
$$;

create function public.admin_generation_job_detail_v1(p_job_id uuid)
returns table (
  row_kind text,
  sequence_number bigint,
  job_id uuid,
  job_status text,
  user_id uuid,
  masked_user_email text,
  story_id text,
  story_title text,
  chapter_number integer,
  generation_kind text,
  correlation_id uuid,
  job_attempt_count integer,
  max_attempts integer,
  available_at timestamptz,
  deadline_at timestamptz,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  worker_id text,
  job_error_code text,
  job_created_at timestamptz,
  job_updated_at timestamptz,
  completed_at timestamptz,
  attempt_id uuid,
  attempt_number integer,
  workflow_phase text,
  provider_id text,
  model_id text,
  started_at timestamptz,
  ended_at timestamptz,
  elapsed_ms bigint,
  lease_age_ms bigint,
  lease_remaining_ms bigint,
  retry_decision text,
  error_code text,
  provider_call_row_id uuid,
  provider_call_id text,
  use_case text,
  fallback_index integer,
  actual_model_resolved boolean,
  outcome text,
  input_token_count bigint,
  output_token_count bigint,
  total_token_count bigint,
  cost_amount numeric,
  cost_currency text,
  cost_source text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := private.require_generation_observability_reader_v1();

  if p_job_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_JOB_ID';
  end if;

  if not exists (select 1 from public.generation_jobs as j where j.id = p_job_id) then
    raise exception using errcode = 'P0001', message = 'JOB_NOT_FOUND';
  end if;

  insert into public.admin_generation_access_audit (
    actor_user_id, action, target_job_id, filter_fingerprint
  ) values (
    v_actor, 'VIEW_JOB_DETAIL', p_job_id,
    pg_catalog.md5('job:' || p_job_id::text)
  );

  return query
  with target as (
    select j.*, u.email::text as user_email, s.title as story_title
    from public.generation_jobs as j
    left join auth.users as u on u.id = j.user_id
    left join public.stories as s on s.id = j.story_id
    where j.id = p_job_id
  ), timeline as (
    select
      'JOB'::text as row_kind,
      0::bigint as sequence_number,
      j.id as job_id,
      j.status as job_status,
      j.user_id,
      private.mask_email_v1(j.user_email) as masked_user_email,
      j.story_id,
      j.story_title,
      j.chapter_number,
      j.generation_kind,
      j.correlation_id,
      j.attempt_count as job_attempt_count,
      j.max_attempts,
      j.available_at,
      j.deadline_at,
      j.claimed_at,
      j.heartbeat_at,
      j.worker_id,
      j.last_error_code as job_error_code,
      j.created_at as job_created_at,
      j.updated_at as job_updated_at,
      j.completed_at,
      null::uuid as attempt_id,
      null::integer as attempt_number,
      null::text as workflow_phase,
      null::text as provider_id,
      null::text as model_id,
      null::timestamptz as started_at,
      null::timestamptz as ended_at,
      null::bigint as elapsed_ms,
      null::bigint as lease_age_ms,
      null::bigint as lease_remaining_ms,
      null::text as retry_decision,
      null::text as error_code,
      null::uuid as provider_call_row_id,
      null::text as provider_call_id,
      null::text as use_case,
      null::integer as fallback_index,
      null::boolean as actual_model_resolved,
      null::text as outcome,
      null::bigint as input_token_count,
      null::bigint as output_token_count,
      null::bigint as total_token_count,
      null::numeric as cost_amount,
      null::text as cost_currency,
      null::text as cost_source
    from target as j

    union all

    select
      'ATTEMPT',
      100000::bigint + pg_catalog.row_number() over (
        order by a.attempt_number, a.started_at, a.id
      ),
      j.id,
      j.status,
      j.user_id,
      private.mask_email_v1(j.user_email),
      j.story_id,
      j.story_title,
      j.chapter_number,
      j.generation_kind,
      j.correlation_id,
      j.attempt_count,
      j.max_attempts,
      j.available_at,
      j.deadline_at,
      j.claimed_at,
      j.heartbeat_at,
      a.worker_id,
      j.last_error_code,
      j.created_at,
      j.updated_at,
      j.completed_at,
      a.id,
      a.attempt_number,
      a.workflow_phase,
      a.provider_id,
      a.model_id,
      a.started_at,
      a.ended_at,
      a.elapsed_ms,
      a.lease_age_ms,
      a.lease_remaining_ms,
      a.retry_decision,
      a.error_code,
      null::uuid,
      null::text,
      null::text,
      null::integer,
      null::boolean,
      null::text,
      null::bigint,
      null::bigint,
      null::bigint,
      null::numeric,
      null::text,
      null::text
    from target as j
    join public.generation_job_attempts as a on a.job_id = j.id

    union all

    select
      'CALL',
      200000::bigint + pg_catalog.row_number() over (
        order by c.started_at, c.id
      ),
      j.id,
      j.status,
      j.user_id,
      private.mask_email_v1(j.user_email),
      j.story_id,
      j.story_title,
      j.chapter_number,
      j.generation_kind,
      j.correlation_id,
      j.attempt_count,
      j.max_attempts,
      j.available_at,
      j.deadline_at,
      j.claimed_at,
      j.heartbeat_at,
      j.worker_id,
      j.last_error_code,
      j.created_at,
      j.updated_at,
      j.completed_at,
      null::uuid,
      c.attempt_number,
      c.workflow_phase,
      c.provider_id,
      c.model_id,
      c.started_at,
      c.ended_at,
      c.elapsed_ms,
      null::bigint,
      null::bigint,
      null::text,
      c.error_code,
      c.id,
      c.provider_call_id,
      c.use_case,
      c.fallback_index,
      c.actual_model_resolved,
      c.outcome,
      c.input_token_count,
      c.output_token_count,
      c.total_token_count,
      c.cost_amount,
      c.cost_currency,
      c.cost_source
    from target as j
    join public.generation_provider_calls as c on c.job_id = j.id
  )
  select * from timeline order by timeline.sequence_number;
end
$$;

create function public.admin_generation_data_quality_v1(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  metric_name text,
  issue_count bigint,
  oldest_issue_at timestamptz,
  newest_issue_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from, p_to);

  return query
  with calls as (
    select c.*
    from public.generation_provider_calls as c
    where c.started_at >= p_from and c.started_at < p_to
  ), terminal_shape as (
    select j.updated_at
    from public.generation_jobs as j
    where j.updated_at >= p_from and j.updated_at < p_to
      and j.status in ('SUCCEEDED', 'FAILED', 'CANCELLED')
      and (
        (j.status = 'SUCCEEDED' and j.publication_result is null)
        or (j.status <> 'SUCCEEDED' and j.publication_result is not null)
        or j.completed_at is null
        or j.worker_id is not null
        or j.claim_token is not null
        or j.claimed_at is not null
        or j.heartbeat_at is not null
      )
  ), metrics as (
    select
      'missing_usage'::text as metric_name,
      pg_catalog.count(*)::bigint as issue_count,
      pg_catalog.min(c.started_at) as oldest_issue_at,
      pg_catalog.max(c.started_at) as newest_issue_at
    from calls as c
    where c.input_token_count is null
      or c.output_token_count is null
      or c.total_token_count is null

    union all

    select
      'unavailable_pricing', pg_catalog.count(*)::bigint,
      pg_catalog.min(c.started_at), pg_catalog.max(c.started_at)
    from calls as c where c.cost_source = 'unavailable'

    union all

    select
      'unresolved_actual_model', pg_catalog.count(*)::bigint,
      pg_catalog.min(c.started_at), pg_catalog.max(c.started_at)
    from calls as c where not c.actual_model_resolved

    union all

    select
      'calls_lacking_durable_correlation', pg_catalog.count(*)::bigint,
      pg_catalog.min(c.started_at), pg_catalog.max(c.started_at)
    from calls as c where c.job_id is null

    union all

    select
      'terminal_job_shape_failures', pg_catalog.count(*)::bigint,
      pg_catalog.min(t.updated_at), pg_catalog.max(t.updated_at)
    from terminal_shape as t

    union all

    select
      'detail_approaching_retention_cutoff', pg_catalog.count(*)::bigint,
      pg_catalog.min(c.created_at), pg_catalog.max(c.created_at)
    from calls as c
    where c.created_at < pg_catalog.clock_timestamp() - interval '83 days'
  )
  select m.metric_name, m.issue_count, m.oldest_issue_at, m.newest_issue_at
  from metrics as m
  order by m.metric_name;
end
$$;

revoke all on function public.admin_generation_overview_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_generation_overview_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer
) to authenticated;

revoke all on function public.admin_generation_timeseries_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_generation_timeseries_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer
) to authenticated;

revoke all on function public.admin_model_performance_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_model_performance_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer
) to authenticated;

revoke all on function public.admin_generation_provider_calls_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer,timestamptz,uuid,integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_generation_provider_calls_v1(
  timestamptz,timestamptz,text,text,text,text,text,text,text,
  uuid,text,text,uuid,uuid,integer,timestamptz,uuid,integer
) to authenticated;

revoke all on function public.admin_generation_job_detail_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_generation_job_detail_v1(uuid)
  to authenticated;

revoke all on function public.admin_generation_data_quality_v1(timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_generation_data_quality_v1(timestamptz,timestamptz)
  to authenticated;
