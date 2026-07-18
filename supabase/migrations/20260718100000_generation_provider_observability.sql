create extension if not exists btree_gist with schema extensions;

create table public.generation_model_pricing_versions (
  id uuid default pg_catalog.gen_random_uuid(),
  provider_id text not null,
  model_id text not null,
  input_token_price numeric(20,8) not null,
  output_token_price numeric(20,8) not null,
  currency text not null,
  unit_size bigint not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint generation_model_pricing_versions_pkey primary key (id),
  constraint generation_model_pricing_versions_identity_from_key
    unique (provider_id, model_id, effective_from),
  constraint generation_model_pricing_versions_provider_id_check check (
    provider_id = pg_catalog.btrim(provider_id)
    and pg_catalog.length(provider_id) between 1 and 80
    and provider_id !~ '[[:cntrl:]]'
  ),
  constraint generation_model_pricing_versions_model_id_check check (
    model_id = pg_catalog.btrim(model_id)
    and pg_catalog.length(model_id) between 1 and 200
    and model_id !~ '[[:cntrl:]]'
  ),
  constraint generation_model_pricing_versions_input_price_check check (
    input_token_price >= 0
    and input_token_price <> 'NaN'::numeric
  ),
  constraint generation_model_pricing_versions_output_price_check check (
    output_token_price >= 0
    and output_token_price <> 'NaN'::numeric
  ),
  constraint generation_model_pricing_versions_currency_check check (
    currency ~ '^[A-Z]{3}$'
  ),
  constraint generation_model_pricing_versions_unit_size_check check (unit_size > 0),
  constraint generation_model_pricing_versions_effective_range_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint generation_model_pricing_versions_no_overlap exclude using gist (
    provider_id extensions.gist_text_ops with =,
    model_id extensions.gist_text_ops with =,
    pg_catalog.tstzrange(effective_from, effective_to, '[)') with &&
  )
);

alter table public.generation_model_pricing_versions enable row level security;
alter table public.generation_model_pricing_versions force row level security;

revoke all on table public.generation_model_pricing_versions
  from public, anon, authenticated, service_role;
grant select on table public.generation_model_pricing_versions to service_role;

create table public.generation_provider_calls (
  id uuid default pg_catalog.gen_random_uuid(),
  provider_call_id text not null,
  user_id uuid not null,
  story_id text not null,
  chapter_number integer,
  generation_kind text,
  job_id uuid references public.generation_jobs(id) on delete restrict,
  correlation_id uuid not null,
  attempt_number integer,
  use_case text not null,
  workflow_phase text not null,
  provider_id text not null,
  model_id text not null,
  route_version text,
  fallback_index integer not null,
  actual_model_resolved boolean not null,
  started_at timestamptz not null,
  ended_at timestamptz not null default pg_catalog.clock_timestamp(),
  elapsed_ms bigint not null default 0,
  outcome text not null,
  error_code text,
  input_token_count bigint,
  output_token_count bigint,
  total_token_count bigint,
  cost_amount numeric(20,8),
  cost_currency text,
  cost_source text not null,
  pricing_version_id uuid references public.generation_model_pricing_versions(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint generation_provider_calls_pkey primary key (id),
  constraint generation_provider_calls_provider_call_id_key unique (provider_call_id),
  constraint generation_provider_calls_provider_call_id_check check (
    provider_call_id = pg_catalog.btrim(provider_call_id)
    and pg_catalog.length(provider_call_id) between 1 and 200
    and provider_call_id !~ '[[:cntrl:]]'
  ),
  constraint generation_provider_calls_story_id_check check (
    story_id = pg_catalog.btrim(story_id)
    and pg_catalog.length(story_id) between 1 and 200
    and story_id !~ '[[:cntrl:]]'
  ),
  constraint generation_provider_calls_chapter_number_check check (
    chapter_number is null or chapter_number between 1 and 50
  ),
  constraint generation_provider_calls_generation_kind_check check (
    generation_kind is null or generation_kind in ('standard', 'personalized')
  ),
  constraint generation_provider_calls_job_attempt_pair_check check (
    (job_id is null) = (attempt_number is null)
  ),
  constraint generation_provider_calls_attempt_number_check check (
    attempt_number is null or attempt_number between 1 and 20
  ),
  constraint generation_provider_calls_use_case_check check (
    use_case = pg_catalog.btrim(use_case)
    and pg_catalog.length(use_case) between 1 and 100
    and use_case !~ '[[:cntrl:]]'
  ),
  constraint generation_provider_calls_workflow_phase_check check (
    workflow_phase = pg_catalog.btrim(workflow_phase)
    and pg_catalog.length(workflow_phase) between 1 and 100
    and workflow_phase !~ '[[:cntrl:]]'
  ),
  constraint generation_provider_calls_provider_id_check check (
    provider_id = pg_catalog.btrim(provider_id)
    and pg_catalog.length(provider_id) between 1 and 80
    and provider_id !~ '[[:cntrl:]]'
  ),
  constraint generation_provider_calls_model_id_check check (
    model_id = pg_catalog.btrim(model_id)
    and pg_catalog.length(model_id) between 1 and 200
    and model_id !~ '[[:cntrl:]]'
  ),
  constraint generation_provider_calls_route_version_check check (
    route_version is null or (
      route_version = pg_catalog.btrim(route_version)
      and pg_catalog.length(route_version) between 1 and 100
      and route_version !~ '[[:cntrl:]]'
    )
  ),
  constraint generation_provider_calls_fallback_index_check check (
    fallback_index between 0 and 32
  ),
  constraint generation_provider_calls_time_check check (ended_at >= started_at),
  constraint generation_provider_calls_elapsed_ms_check check (elapsed_ms >= 0),
  constraint generation_provider_calls_outcome_check check (
    outcome in (
      'SUCCEEDED', 'PROVIDER_ERROR', 'TIMEOUT', 'ABORTED',
      'INVALID_RESPONSE', 'CONTENT_REJECTED'
    )
  ),
  constraint generation_provider_calls_error_code_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{1,100}$'
  ),
  constraint generation_provider_calls_error_outcome_check check (
    (outcome = 'SUCCEEDED') = (error_code is null)
  ),
  constraint generation_provider_calls_input_tokens_check check (
    input_token_count is null or input_token_count >= 0
  ),
  constraint generation_provider_calls_output_tokens_check check (
    output_token_count is null or output_token_count >= 0
  ),
  constraint generation_provider_calls_total_tokens_check check (
    total_token_count is null or total_token_count >= 0
  ),
  constraint generation_provider_calls_token_total_consistency_check check (
    input_token_count is null
    or output_token_count is null
    or total_token_count is null
    or input_token_count + output_token_count = total_token_count
  ),
  constraint generation_provider_calls_cost_amount_check check (
    cost_amount is null or cost_amount >= 0
  ),
  constraint generation_provider_calls_cost_currency_check check (
    cost_currency is null or cost_currency ~ '^[A-Z]{3}$'
  ),
  constraint generation_provider_calls_cost_source_check check (
    cost_source in ('provider_actual', 'price_estimate', 'unavailable')
  ),
  constraint generation_provider_calls_cost_shape_check check (
    (
      cost_source = 'unavailable'
      and cost_amount is null
      and cost_currency is null
      and pricing_version_id is null
    ) or (
      cost_source = 'provider_actual'
      and cost_amount is not null
      and cost_currency is not null
      and pricing_version_id is null
    ) or (
      cost_source = 'price_estimate'
      and cost_amount is not null
      and cost_currency is not null
      and pricing_version_id is not null
    )
  )
);

create index generation_provider_calls_started_idx
on public.generation_provider_calls(started_at desc, id desc);

create index generation_provider_calls_job_timeline_idx
on public.generation_provider_calls(job_id, attempt_number, started_at desc, id desc)
where job_id is not null;

create index generation_provider_calls_correlation_timeline_idx
on public.generation_provider_calls(correlation_id, started_at desc, id desc);

create index generation_provider_calls_provider_model_time_idx
on public.generation_provider_calls(provider_id, model_id, started_at desc, id desc);

create index generation_provider_calls_user_time_idx
on public.generation_provider_calls(user_id, started_at desc, id desc);

create index generation_provider_calls_story_chapter_time_idx
on public.generation_provider_calls(story_id, chapter_number, started_at desc, id desc);

create index generation_provider_calls_outcome_error_time_idx
on public.generation_provider_calls(outcome, error_code, started_at desc, id desc);

create index generation_provider_calls_cost_source_time_idx
on public.generation_provider_calls(cost_source, started_at desc, id desc);

create index generation_provider_calls_retention_idx
on public.generation_provider_calls(created_at, id);

create function public.generation_provider_calls_enforce_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using
      errcode = 'P0001',
      message = 'GENERATION_PROVIDER_CALL_APPEND_ONLY';
  end if;

  if new.job_id is null then
    return new;
  end if;

  select j.*
  into v_job
  from public.generation_jobs j
  where j.id = new.job_id;

  if not found
    or new.user_id is distinct from v_job.user_id
    or new.story_id is distinct from v_job.story_id
    or new.chapter_number is distinct from v_job.chapter_number
    or new.generation_kind is distinct from v_job.generation_kind
    or new.correlation_id is distinct from v_job.correlation_id
    or new.attempt_number is null
    or new.attempt_number < 1
    or new.attempt_number > v_job.attempt_count then
    raise exception using
      errcode = 'P0001',
      message = 'GENERATION_PROVIDER_CALL_IDENTITY_MISMATCH';
  end if;

  return new;
end
$$;

create trigger generation_provider_calls_enforce_identity_v1_trigger
before insert or update or delete on public.generation_provider_calls
for each row execute function public.generation_provider_calls_enforce_identity_v1();

alter table public.generation_provider_calls enable row level security;
alter table public.generation_provider_calls force row level security;

revoke all on table public.generation_provider_calls from public, anon, authenticated, service_role;
grant select, insert on table public.generation_provider_calls to service_role;

revoke all on function public.generation_provider_calls_enforce_identity_v1() from public, anon, authenticated, service_role;
grant execute on function public.generation_provider_calls_enforce_identity_v1() to service_role;

create function public.record_generation_provider_call_v1(
  p_provider_call_id text,
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_generation_kind text,
  p_job_id uuid,
  p_correlation_id uuid,
  p_attempt_number integer,
  p_use_case text,
  p_workflow_phase text,
  p_provider_id text,
  p_model_id text,
  p_route_version text,
  p_fallback_index integer,
  p_actual_model_resolved boolean,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_elapsed_ms bigint,
  p_outcome text,
  p_error_code text,
  p_input_token_count bigint,
  p_output_token_count bigint,
  p_total_token_count bigint,
  p_provider_cost_amount numeric,
  p_provider_cost_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost_amount numeric(20,8);
  v_cost_currency text;
  v_cost_source text := 'unavailable';
  v_pricing_version_id uuid;
  v_inserted integer;
  v_existing public.generation_provider_calls%rowtype;
begin
  if p_provider_cost_amount is not null
    and p_provider_cost_amount <> 'NaN'::numeric
    and p_provider_cost_amount >= 0
    and p_provider_cost_amount <= 999999999999.99999999::numeric
    and p_provider_cost_amount = pg_catalog.trunc(p_provider_cost_amount, 8)
    and p_provider_cost_currency ~ '^[A-Z]{3}$' then
    v_cost_amount := p_provider_cost_amount;
    v_cost_currency := p_provider_cost_currency;
    v_cost_source := 'provider_actual';
  elsif p_input_token_count is not null
    and p_output_token_count is not null then
    select
      pricing.id,
      pricing.currency,
      (
        (p_input_token_count::numeric / pricing.unit_size) * pricing.input_token_price
        + (p_output_token_count::numeric / pricing.unit_size) * pricing.output_token_price
      )::numeric(20,8)
    into v_pricing_version_id, v_cost_currency, v_cost_amount
    from public.generation_model_pricing_versions as pricing
    where pricing.provider_id = p_provider_id
      and pricing.model_id = p_model_id
      and pricing.effective_from <= p_started_at
      and (
        pricing.effective_to is null
        or p_started_at < pricing.effective_to
      )
    order by pricing.effective_from desc, pricing.currency, pricing.id
    limit 1;

    if found then
      v_cost_source := 'price_estimate';
    else
      v_cost_amount := null;
      v_cost_currency := null;
      v_pricing_version_id := null;
    end if;
  end if;

  insert into public.generation_provider_calls (
    provider_call_id,
    user_id,
    story_id,
    chapter_number,
    generation_kind,
    job_id,
    correlation_id,
    attempt_number,
    use_case,
    workflow_phase,
    provider_id,
    model_id,
    route_version,
    fallback_index,
    actual_model_resolved,
    started_at,
    ended_at,
    elapsed_ms,
    outcome,
    error_code,
    input_token_count,
    output_token_count,
    total_token_count,
    cost_amount,
    cost_currency,
    cost_source,
    pricing_version_id
  ) values (
    p_provider_call_id,
    p_user_id,
    p_story_id,
    p_chapter_number,
    p_generation_kind,
    p_job_id,
    p_correlation_id,
    p_attempt_number,
    p_use_case,
    p_workflow_phase,
    p_provider_id,
    p_model_id,
    p_route_version,
    p_fallback_index,
    p_actual_model_resolved,
    p_started_at,
    p_ended_at,
    p_elapsed_ms,
    p_outcome,
    p_error_code,
    p_input_token_count,
    p_output_token_count,
    p_total_token_count,
    v_cost_amount,
    v_cost_currency,
    v_cost_source,
    v_pricing_version_id
  )
  on conflict (provider_call_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    return pg_catalog.jsonb_build_object(
      'recorded', true,
      'duplicate', false
    );
  end if;

  select calls.*
  into strict v_existing
  from public.generation_provider_calls as calls
  where calls.provider_call_id = p_provider_call_id;

  if v_existing.user_id is not distinct from p_user_id
    and v_existing.story_id is not distinct from p_story_id
    and v_existing.chapter_number is not distinct from p_chapter_number
    and v_existing.generation_kind is not distinct from p_generation_kind
    and v_existing.job_id is not distinct from p_job_id
    and v_existing.correlation_id is not distinct from p_correlation_id
    and v_existing.attempt_number is not distinct from p_attempt_number
    and v_existing.use_case is not distinct from p_use_case
    and v_existing.workflow_phase is not distinct from p_workflow_phase
    and v_existing.provider_id is not distinct from p_provider_id
    and v_existing.model_id is not distinct from p_model_id
    and v_existing.route_version is not distinct from p_route_version
    and v_existing.fallback_index is not distinct from p_fallback_index
    and v_existing.actual_model_resolved is not distinct from p_actual_model_resolved
    and v_existing.started_at is not distinct from p_started_at
    and v_existing.ended_at is not distinct from p_ended_at
    and v_existing.elapsed_ms is not distinct from p_elapsed_ms
    and v_existing.outcome is not distinct from p_outcome
    and v_existing.error_code is not distinct from p_error_code
    and v_existing.input_token_count is not distinct from p_input_token_count
    and v_existing.output_token_count is not distinct from p_output_token_count
    and v_existing.total_token_count is not distinct from p_total_token_count
    and v_existing.cost_amount is not distinct from v_cost_amount
    and v_existing.cost_currency is not distinct from v_cost_currency
    and v_existing.cost_source is not distinct from v_cost_source
    and v_existing.pricing_version_id is not distinct from v_pricing_version_id then
    return pg_catalog.jsonb_build_object(
      'recorded', false,
      'duplicate', true
    );
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'GENERATION_PROVIDER_CALL_IDEMPOTENCY_CONFLICT';
end
$$;

revoke all on function public.record_generation_provider_call_v1(
  text, uuid, text, integer, text, uuid, uuid, integer,
  text, text, text, text, text, integer, boolean,
  timestamptz, timestamptz, bigint, text, text,
  bigint, bigint, bigint, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_generation_provider_call_v1(
  text, uuid, text, integer, text, uuid, uuid, integer,
  text, text, text, text, text, integer, boolean,
  timestamptz, timestamptz, bigint, text, text,
  bigint, bigint, bigint, numeric, text
) to service_role;
