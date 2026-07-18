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
  pricing_version_id uuid,
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
