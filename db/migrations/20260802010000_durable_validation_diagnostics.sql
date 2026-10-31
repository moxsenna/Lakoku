-- Durable, controlled validation diagnostics for provider-call observability.
-- Expand-only: legacy v1 RPCs (recorder and admin ledger) are untouched so old
-- and new app versions coexist against the expanded schema.
-- No rejected text, prompts, provider payloads, or free-form error details are accepted.

create function private.canonical_generation_provider_validation_codes_v1(p_codes text[])
returns text[]
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(code order by code), array[]::text[])
  from (
    select distinct code
    from unnest(p_codes) as codes(code)
    where code in (
      'CHOICE_DRAFT_INVALID', 'CHOICE_RESPONSE_INVALID_JSON',
      'CHOICE_RESPONSE_NOT_JSON_OBJECT', 'CHOICE_NOT_ACTIONABLE',
      'CHOICE_GENERIC_OR_INTERNAL', 'INTERNAL_LANGUAGE_LEAK',
      'RUTE_NOT_ALLOWED', 'DUPLICATE_CHOICE_ID',
      'DUPLICATE_OUTCOME_CHOICE_ID', 'OUTCOME_CHOICE_ID_MISMATCH',
      'CHAPTER_49_OUTCOME_INVALID', 'ENDING_NOT_ALLOWED',
      'NEXT_CHAPTER_MISMATCH', 'UNKNOWN_VALIDATION_FAILURE'
    )
  ) as canonical
$$;

revoke all on function private.canonical_generation_provider_validation_codes_v1(text[]) from public, anon, authenticated, service_role;
grant execute on function private.canonical_generation_provider_validation_codes_v1(text[]) to service_role;

alter table public.generation_provider_calls
  add column validation_stage text,
  add column validation_codes text[];

-- NOT VALID: new rows are enforced immediately without scanning historical rows.
-- Existing rows are all NULL for both new columns, so they are trivially valid;
-- production VALIDATE runs as a separate later step once table size is known.
alter table public.generation_provider_calls
  add constraint generation_provider_calls_validation_stage_check check (
    validation_stage is null or validation_stage in ('PARSE_JSON', 'DRAFT_SCHEMA', 'FINAL_BRANCH_SCHEMA')
  ) not valid,
  add constraint generation_provider_calls_validation_codes_check check (
    validation_codes is null or (
      cardinality(validation_codes) between 1 and 8
      and validation_codes = private.canonical_generation_provider_validation_codes_v1(validation_codes)
    )
  ) not valid,
  add constraint generation_provider_calls_validation_shape_check check (
    (validation_stage is null) = (validation_codes is null)
  ) not valid,
  add constraint generation_provider_calls_validation_outcome_check check (
    validation_codes is null
    or (outcome = 'INVALID_RESPONSE' and error_code = 'PROVIDER_INVALID_RESPONSE')
  ) not valid;

-- Legacy recorder v1 stays exactly as defined in 20260718100000. New recorder v2
-- accepts diagnostics and keeps the same idempotency semantics, including the
-- diagnostics fields in the duplicate comparison.
create function public.record_generation_provider_call_v2(
  p_provider_call_id text, p_user_id uuid, p_story_id text, p_chapter_number integer,
  p_generation_kind text, p_job_id uuid, p_correlation_id uuid, p_attempt_number integer,
  p_use_case text, p_workflow_phase text, p_provider_id text, p_model_id text,
  p_route_version text, p_fallback_index integer, p_actual_model_resolved boolean,
  p_started_at timestamptz, p_ended_at timestamptz, p_elapsed_ms bigint, p_outcome text,
  p_error_code text, p_input_token_count bigint, p_output_token_count bigint,
  p_total_token_count bigint, p_provider_cost_amount numeric, p_provider_cost_currency text,
  p_validation_stage text default null, p_validation_codes text[] default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cost_amount numeric(20,8); v_cost_currency text; v_cost_source text := 'unavailable';
  v_pricing_version_id uuid; v_inserted integer; v_existing public.generation_provider_calls%rowtype;
begin
  if p_provider_cost_amount is not null and p_provider_cost_amount <> 'NaN'::numeric
    and p_provider_cost_amount >= 0 and p_provider_cost_amount <= 999999999999.99999999::numeric
    and p_provider_cost_amount = pg_catalog.trunc(p_provider_cost_amount, 8)
    and p_provider_cost_currency ~ '^[A-Z]{3}$' then
    v_cost_amount := p_provider_cost_amount; v_cost_currency := p_provider_cost_currency; v_cost_source := 'provider_actual';
  elsif p_input_token_count is not null and p_output_token_count is not null then
    select pricing.id, pricing.currency, ((p_input_token_count::numeric / pricing.unit_size) * pricing.input_token_price + (p_output_token_count::numeric / pricing.unit_size) * pricing.output_token_price)::numeric(20,8)
    into v_pricing_version_id, v_cost_currency, v_cost_amount
    from public.generation_model_pricing_versions as pricing
    where pricing.provider_id = p_provider_id and pricing.model_id = p_model_id
      and pricing.effective_from <= p_started_at and (pricing.effective_to is null or p_started_at < pricing.effective_to)
    order by pricing.effective_from desc, pricing.currency, pricing.id limit 1;
    if found then v_cost_source := 'price_estimate'; else v_cost_amount := null; v_cost_currency := null; v_pricing_version_id := null; end if;
  end if;
  insert into public.generation_provider_calls (
    provider_call_id,user_id,story_id,chapter_number,generation_kind,job_id,correlation_id,attempt_number,use_case,workflow_phase,provider_id,model_id,route_version,fallback_index,actual_model_resolved,started_at,ended_at,elapsed_ms,outcome,error_code,input_token_count,output_token_count,total_token_count,cost_amount,cost_currency,cost_source,pricing_version_id,validation_stage,validation_codes
  ) values (
    p_provider_call_id,p_user_id,p_story_id,p_chapter_number,p_generation_kind,p_job_id,p_correlation_id,p_attempt_number,p_use_case,p_workflow_phase,p_provider_id,p_model_id,p_route_version,p_fallback_index,p_actual_model_resolved,p_started_at,p_ended_at,p_elapsed_ms,p_outcome,p_error_code,p_input_token_count,p_output_token_count,p_total_token_count,v_cost_amount,v_cost_currency,v_cost_source,v_pricing_version_id,p_validation_stage,p_validation_codes
  ) on conflict (provider_call_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return pg_catalog.jsonb_build_object('recorded', true, 'duplicate', false); end if;
  select calls.* into strict v_existing from public.generation_provider_calls as calls where calls.provider_call_id = p_provider_call_id;
  if v_existing.user_id is not distinct from p_user_id and v_existing.story_id is not distinct from p_story_id and v_existing.chapter_number is not distinct from p_chapter_number and v_existing.generation_kind is not distinct from p_generation_kind and v_existing.job_id is not distinct from p_job_id and v_existing.correlation_id is not distinct from p_correlation_id and v_existing.attempt_number is not distinct from p_attempt_number and v_existing.use_case is not distinct from p_use_case and v_existing.workflow_phase is not distinct from p_workflow_phase and v_existing.provider_id is not distinct from p_provider_id and v_existing.model_id is not distinct from p_model_id and v_existing.route_version is not distinct from p_route_version and v_existing.fallback_index is not distinct from p_fallback_index and v_existing.actual_model_resolved is not distinct from p_actual_model_resolved and v_existing.started_at is not distinct from p_started_at and v_existing.ended_at is not distinct from p_ended_at and v_existing.elapsed_ms is not distinct from p_elapsed_ms and v_existing.outcome is not distinct from p_outcome and v_existing.error_code is not distinct from p_error_code and v_existing.input_token_count is not distinct from p_input_token_count and v_existing.output_token_count is not distinct from p_output_token_count and v_existing.total_token_count is not distinct from p_total_token_count and v_existing.cost_amount is not distinct from v_cost_amount and v_existing.cost_currency is not distinct from v_cost_currency and v_existing.cost_source is not distinct from v_cost_source and v_existing.pricing_version_id is not distinct from v_pricing_version_id and v_existing.validation_stage is not distinct from p_validation_stage and v_existing.validation_codes is not distinct from p_validation_codes then
    return pg_catalog.jsonb_build_object('recorded', false, 'duplicate', true);
  end if;
  raise exception using errcode = 'P0001', message = 'GENERATION_PROVIDER_CALL_IDEMPOTENCY_CONFLICT';
end $$;

revoke all on function public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.record_generation_provider_call_v2(text,uuid,text,integer,text,uuid,uuid,integer,text,text,text,text,text,integer,boolean,timestamptz,timestamptz,bigint,text,text,bigint,bigint,bigint,numeric,text,text,text[]) to service_role;

-- Legacy admin ledger v1 stays exactly as defined in 20260718110000. New v2
-- returns the same columns plus the two controlled diagnostics fields, with the
-- same filtering, cursor ordering, audit, masking, and internal owner/admin RBAC.
create function public.admin_generation_provider_calls_v2(
  p_from timestamptz,p_to timestamptz,p_provider_id text,p_model_id text,p_use_case text,p_workflow_phase text,p_outcome text,p_error_code text,p_cost_source text,p_user_id uuid,p_story_id text,p_generation_kind text,p_job_id uuid,p_correlation_id uuid,p_chapter_number integer,p_cursor_started_at timestamptz,p_cursor_id uuid,p_page_size integer
) returns table (
  id uuid,provider_call_id text,started_at timestamptz,ended_at timestamptz,elapsed_ms bigint,user_id uuid,masked_user_email text,story_id text,story_title text,chapter_number integer,generation_kind text,job_id uuid,correlation_id uuid,attempt_number integer,use_case text,workflow_phase text,provider_id text,model_id text,route_version text,fallback_index integer,actual_model_resolved boolean,outcome text,error_code text,input_token_count bigint,output_token_count bigint,total_token_count bigint,cost_amount numeric,cost_currency text,cost_source text,pricing_version_id uuid,validation_stage text,validation_codes text[]
) language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid; v_filter_fingerprint text;
begin
  v_actor := private.require_generation_observability_reader_v1();
  perform private.validate_generation_observability_range_v1(p_from,p_to);
  perform private.validate_generation_observability_filters_v1(p_provider_id,p_model_id,p_use_case,p_workflow_phase,p_outcome,p_error_code,p_cost_source,p_story_id,p_generation_kind,p_chapter_number);
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then raise exception using errcode = 'P0001', message = 'INVALID_PAGE_SIZE'; end if;
  if (p_cursor_started_at is null) <> (p_cursor_id is null) then raise exception using errcode = 'P0001', message = 'INVALID_CURSOR'; end if;
  v_filter_fingerprint := pg_catalog.md5(pg_catalog.concat_ws('|',p_from::text,p_to::text,coalesce(p_provider_id,''),coalesce(p_model_id,''),coalesce(p_use_case,''),coalesce(p_workflow_phase,''),coalesce(p_outcome,''),coalesce(p_error_code,''),coalesce(p_cost_source,''),coalesce(p_user_id::text,''),coalesce(p_story_id,''),coalesce(p_generation_kind,''),coalesce(p_job_id::text,''),coalesce(p_correlation_id::text,''),coalesce(p_chapter_number::text,''),coalesce(p_cursor_started_at::text,''),coalesce(p_cursor_id::text,''),p_page_size::text));
  insert into public.admin_generation_access_audit(actor_user_id,action,target_provider_call_id,filter_fingerprint) values (v_actor,'VIEW_CALL_DETAIL',null,v_filter_fingerprint);
  return query select c.id,c.provider_call_id,c.started_at,c.ended_at,c.elapsed_ms,c.user_id,private.mask_email_v1(u.email::text),c.story_id,s.title,c.chapter_number,c.generation_kind,c.job_id,c.correlation_id,c.attempt_number,c.use_case,c.workflow_phase,c.provider_id,c.model_id,c.route_version,c.fallback_index,c.actual_model_resolved,c.outcome,c.error_code,c.input_token_count,c.output_token_count,c.total_token_count,c.cost_amount,c.cost_currency,c.cost_source,c.pricing_version_id,c.validation_stage,c.validation_codes from public.generation_provider_calls c left join auth.users u on u.id=c.user_id left join public.stories s on s.id=c.story_id where c.started_at >= p_from and c.started_at < p_to and (p_provider_id is null or c.provider_id=p_provider_id) and (p_model_id is null or c.model_id=p_model_id) and (p_use_case is null or c.use_case=p_use_case) and (p_workflow_phase is null or c.workflow_phase=p_workflow_phase) and (p_outcome is null or c.outcome=p_outcome) and (p_error_code is null or c.error_code=p_error_code) and (p_cost_source is null or c.cost_source=p_cost_source) and (p_user_id is null or c.user_id=p_user_id) and (p_story_id is null or c.story_id=p_story_id) and (p_generation_kind is null or c.generation_kind=p_generation_kind) and (p_job_id is null or c.job_id=p_job_id) and (p_correlation_id is null or c.correlation_id=p_correlation_id) and (p_chapter_number is null or c.chapter_number=p_chapter_number) and (p_cursor_started_at is null or (c.started_at,c.id)<(p_cursor_started_at,p_cursor_id)) order by c.started_at desc,c.id desc limit p_page_size;
end $$;
revoke all on function public.admin_generation_provider_calls_v2(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer,timestamptz,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_generation_provider_calls_v2(timestamptz,timestamptz,text,text,text,text,text,text,text,uuid,text,text,uuid,uuid,integer,timestamptz,uuid,integer) to authenticated;
