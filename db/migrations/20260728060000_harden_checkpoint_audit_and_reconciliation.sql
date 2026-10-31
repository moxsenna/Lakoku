-- Harden checkpoint audit pairing and terminal reconciliation.

create or replace function public.is_valid_checkpoint_audit_signals_v1(p jsonb)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p) = 'object'
    and p - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' = '{}'::jsonb
    and p ?& array['opensNewThread','opensMajorMystery','opensNewConflict']
    and pg_catalog.jsonb_typeof(p->'opensNewThread') = 'boolean'
    and pg_catalog.jsonb_typeof(p->'opensMajorMystery') = 'boolean'
    and pg_catalog.jsonb_typeof(p->'opensNewConflict') = 'boolean',
    false
  )
$$;

create or replace function public.is_valid_checkpoint_audit_signals_v2(p jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_closures jsonb;
  v_item jsonb;
  v_keys text;
  v_debt_id text;
  v_form text;
  v_seen text[] := array[]::text[];
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then return false; end if;
  if p - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' - 'closesPlotDebts' <> '{}'::jsonb
    or not (p ?& array['opensNewThread','opensMajorMystery','opensNewConflict','closesPlotDebts'])
    or pg_catalog.jsonb_typeof(p->'opensNewThread') <> 'boolean'
    or pg_catalog.jsonb_typeof(p->'opensMajorMystery') <> 'boolean'
    or pg_catalog.jsonb_typeof(p->'opensNewConflict') <> 'boolean' then return false; end if;
  v_closures := p->'closesPlotDebts';
  if pg_catalog.jsonb_typeof(v_closures) <> 'array' or pg_catalog.jsonb_array_length(v_closures) > 20 then return false; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_closures) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then return false; end if;
    v_keys := (select pg_catalog.string_agg(k, ',' order by k) from pg_catalog.jsonb_object_keys(v_item) k);
    if v_keys <> 'closureForm,debtId' then return false; end if;
    v_debt_id := v_item->>'debtId'; v_form := v_item->>'closureForm';
    if v_debt_id is null or pg_catalog.char_length(v_debt_id) = 0 or pg_catalog.char_length(v_debt_id) > 100
      or v_debt_id <> pg_catalog.btrim(v_debt_id)
      or v_form is null or v_form not in ('RESOLVED','SUBVERTED','TRANSFORMED','ABANDONED')
      or v_debt_id = any(v_seen) then return false; end if;
    v_seen := pg_catalog.array_append(v_seen, v_debt_id);
  end loop;
  return true;
end;
$$;

revoke all on function public.is_valid_checkpoint_audit_signals_v1(jsonb) from public, anon, authenticated;
revoke all on function public.is_valid_checkpoint_audit_signals_v2(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_checkpoint_audit_signals_v1(jsonb) to service_role;
grant execute on function public.is_valid_checkpoint_audit_signals_v2(jsonb) to service_role;

alter table public.chapter_generation_checkpoints drop constraint if exists chapter_generation_checkpoints_audit_signals_check;
alter table public.chapter_generation_checkpoints add constraint chapter_generation_checkpoints_audit_signals_check check (
  case audit_signals_version
    when 1 then audit_signals_json is not null and public.is_valid_checkpoint_audit_signals_v1(audit_signals_json)
    when 2 then audit_signals_json is not null and public.is_valid_checkpoint_audit_signals_v2(audit_signals_json)
    else audit_signals_version is null and audit_signals_json is null
  end
);

create or replace function public.transition_generation_checkpoint_fenced_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_checkpoint_attempt_id uuid,
  p_new_status text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_is_publish boolean := p_new_status = 'PUBLISHED';
  v_transition_valid boolean := false;
  v_now timestamptz;
begin
  if p_job_id is null or p_worker_id is null or pg_catalog.btrim(p_worker_id) = ''
    or p_claim_token is null or p_lease_id is null or p_story_id is null
    or pg_catalog.btrim(p_story_id) = '' or p_chapter_number is null
    or p_chapter_number not between 1 and 50 or p_checkpoint_attempt_id is null
    or p_new_status is null or p_new_status not in (
      'PROSE_READY', 'QUEUED_CHOICES', 'RUNNING_CHOICES', 'CHOICES_RETRY_WAIT',
      'READY_TO_PUBLISH', 'PUBLISHED', 'EXPIRED', 'FAILED'
    ) then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_TRANSITION_INPUT';
  end if;

  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'OWNERSHIP_LOST');
  end if;
  if v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number
    or p_checkpoint_attempt_id is distinct from v_job.id then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  if v_is_publish then
    if v_job.status <> 'SUCCEEDED'
      or v_job.publication_result is null
      or pg_catalog.jsonb_typeof(v_job.publication_result) <> 'object'
      or v_job.publication_result @> '{"ok":true}'::jsonb is not true
      or v_job.publication_result->>'jobId' is distinct from v_job.id::text
      or (v_job.publication_result->>'chapter_number')::integer is distinct from v_job.chapter_number
      or not exists (
        select 1
        from public.chapters c
        join public.idempotency_keys i
          on i.key = v_job.publication_idempotency_key
         and i.story_id = v_job.story_id
         and i.scope = 'publish_chapter_v2:' || v_job.chapter_number::text
        where c.story_id = v_job.story_id
          and c.number = v_job.chapter_number
          and pg_catalog.jsonb_typeof(i.result) = 'object'
          and i.result @> '{"ok":true}'::jsonb
          and i.result->>'jobId' is not distinct from v_job.id::text
          and case when pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
            then (i.result->>'chapter_number')::integer = v_job.chapter_number else false end
          and i.result is not distinct from v_job.publication_result
      ) then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'INVALID_TRANSITION');
    end if;
  elsif v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'OWNERSHIP_LOST');
  end if;

  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found or v_lease.job_id is distinct from v_job.id
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or (v_is_publish and v_lease.status <> 'RELEASED')
    or (not v_is_publish and v_lease.claim_token is distinct from p_claim_token)
    or (not v_is_publish and v_lease.holder is distinct from v_job.worker_id)
    or (not v_is_publish and (
      v_lease.status <> 'ACTIVE' or v_lease.expires_at <= pg_catalog.clock_timestamp()
    )) then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LEASE_INVALID');
  end if;

  -- Load checkpoint for this story+chapter+attempt.
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = p_checkpoint_attempt_id
  for update;

  if not found or v_checkpoint.checkpoint_schema_version <> 2
    or v_checkpoint.job_id is distinct from v_job.id
    or v_checkpoint.correlation_id is distinct from v_job.correlation_id
    or v_checkpoint.generation_mode is distinct from v_job.generation_kind
    or (v_checkpoint.generation_mode = 'standard' and (
      v_checkpoint.audit_signals_json is not null or v_checkpoint.audit_signals_version is not null
    ))
    or (v_checkpoint.generation_mode = 'personalized' and (
      v_checkpoint.audit_signals_json is null
      or v_checkpoint.audit_signals_version is null
      or (
        v_checkpoint.audit_signals_version = 1
        and not (
          public.is_valid_checkpoint_audit_signals_v1(v_checkpoint.audit_signals_json)
        )
      )
      or (
        v_checkpoint.audit_signals_version = 2
        and not public.is_valid_checkpoint_audit_signals_v2(v_checkpoint.audit_signals_json)
      )
    ))
    or v_checkpoint.canon_version is null
    or v_checkpoint.blueprint_version is null
    or v_checkpoint.direction_fingerprint is null
    or v_checkpoint.generation_policy_version is null
    or v_checkpoint.prompt_contract_version is null
    or v_checkpoint.job_attempt_number is null then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;
  if v_checkpoint.job_attempt_number > v_job.attempt_count then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'ATTEMPT_AHEAD');
  end if;

  if v_checkpoint.status = p_new_status then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'result', 'UPDATED', 'changed', false,
      'checkpoint', pg_catalog.to_jsonb(v_checkpoint)
    );
  end if;

  v_transition_valid :=
    (v_checkpoint.status = 'PROSE_READY' and p_new_status in (
      'QUEUED_CHOICES', 'RUNNING_CHOICES', 'CHOICES_RETRY_WAIT',
      'READY_TO_PUBLISH', 'PUBLISHED', 'EXPIRED', 'FAILED'
    ))
    or (v_checkpoint.status = 'QUEUED_CHOICES' and p_new_status in (
      'RUNNING_CHOICES', 'CHOICES_RETRY_WAIT', 'EXPIRED', 'FAILED'
    ))
    or (v_checkpoint.status = 'RUNNING_CHOICES' and p_new_status in (
      'CHOICES_RETRY_WAIT', 'READY_TO_PUBLISH', 'PUBLISHED', 'EXPIRED', 'FAILED'
    ))
    or (v_checkpoint.status = 'CHOICES_RETRY_WAIT' and p_new_status in (
      'QUEUED_CHOICES', 'RUNNING_CHOICES', 'EXPIRED', 'FAILED'
    ))
    or (v_checkpoint.status = 'READY_TO_PUBLISH' and p_new_status in (
      'PUBLISHED', 'CHOICES_RETRY_WAIT', 'EXPIRED', 'FAILED'
    ));

  if not v_transition_valid then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'INVALID_TRANSITION');
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.chapter_generation_checkpoints
  set status = p_new_status,
      choice_attempt_count = choice_attempt_count
        + case when p_new_status = 'RUNNING_CHOICES' then 1 else 0 end,
      updated_at = v_now,
      expires_at = case
        when p_new_status in ('PUBLISHED', 'EXPIRED') then v_now + interval '1 hour'
        else expires_at
      end
  where story_id = v_checkpoint.story_id
    and chapter_number = v_checkpoint.chapter_number
    and attempt_id = v_checkpoint.attempt_id
  returning * into v_checkpoint;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'result', 'UPDATED', 'changed', true,
    'checkpoint', pg_catalog.to_jsonb(v_checkpoint)
  );
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PUBLICATION_PROOF';
end;
$$;

revoke all on function public.transition_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,uuid,text
) from public, anon, authenticated;
grant execute on function public.transition_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,uuid,text
) to service_role;
