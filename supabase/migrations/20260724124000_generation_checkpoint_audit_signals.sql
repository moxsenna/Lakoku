-- Bind personalized prose checkpoints to exact plot-debt audit inputs.
-- Existing rows remain NULL and cannot resume personalized generation.

alter table public.chapter_generation_checkpoints
  add column if not exists audit_signals_json jsonb,
  add column if not exists audit_signals_version integer;

alter table public.chapter_generation_checkpoints
  drop constraint if exists chapter_generation_checkpoints_audit_signals_v1_check;
alter table public.chapter_generation_checkpoints
  add constraint chapter_generation_checkpoints_audit_signals_v1_check check (
    (audit_signals_json is null and audit_signals_version is null)
    or (
      audit_signals_json is not null
      and audit_signals_version is not null
      and audit_signals_version = 1
      and pg_catalog.jsonb_typeof(audit_signals_json) = 'object'
      and audit_signals_json - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' = '{}'::jsonb
      and audit_signals_json ?& array['opensNewThread','opensMajorMystery','opensNewConflict']
      and pg_catalog.jsonb_typeof(audit_signals_json->'opensNewThread') = 'boolean'
      and pg_catalog.jsonb_typeof(audit_signals_json->'opensMajorMystery') = 'boolean'
      and pg_catalog.jsonb_typeof(audit_signals_json->'opensNewConflict') = 'boolean'
    )
  );

drop function if exists public.upsert_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,bigint,bigint,text,text,integer,integer,integer
);

-- Lock order remains generation_jobs, generation_leases, chapter_generation_checkpoints.

create or replace function public.upsert_generation_checkpoint_fenced_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_prose_fingerprint text,
  p_audit_signals jsonb,
  p_audit_signals_version integer,
  p_canon_version bigint,
  p_blueprint_version bigint,
  p_direction_fingerprint text,
  p_generation_mode text,
  p_generation_policy_version integer,
  p_prompt_contract_version integer,
  p_prose_attempt_count integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_paragraph_count integer;
begin
  if p_job_id is null or p_worker_id is null or pg_catalog.btrim(p_worker_id) = ''
    or p_claim_token is null or p_lease_id is null or p_story_id is null
    or pg_catalog.btrim(p_story_id) = '' or p_chapter_number is null
    or p_chapter_number not between 1 and 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_IDENTITY';
  end if;

  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'OWNERSHIP_LOST');
  end if;

  if v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found or v_lease.job_id is distinct from v_job.id
    or v_lease.claim_token is distinct from v_job.claim_token
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or v_lease.holder is distinct from v_job.worker_id
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LEASE_INVALID');
  end if;

  if p_title is null or pg_catalog.btrim(p_title) = '' or pg_catalog.length(p_title) > 500
    or p_paragraphs is null or pg_catalog.jsonb_typeof(p_paragraphs) <> 'array'
    or p_prose_fingerprint is null or pg_catalog.btrim(p_prose_fingerprint) = ''
    or pg_catalog.length(p_prose_fingerprint) > 256
    or p_canon_version is null or p_canon_version < 0
    or p_blueprint_version is null or p_blueprint_version < 0
    or p_direction_fingerprint is null or pg_catalog.btrim(p_direction_fingerprint) = ''
    or pg_catalog.length(p_direction_fingerprint) > 256
    or p_generation_mode is null or p_generation_mode not in ('standard', 'personalized')
    or p_generation_mode is distinct from v_job.generation_kind
    or (p_generation_mode = 'standard' and (p_audit_signals is not null or p_audit_signals_version is not null))
    or (p_generation_mode = 'personalized' and not (
      p_audit_signals is not null
      and p_audit_signals_version is not null
      and p_audit_signals_version = 1
      and pg_catalog.jsonb_typeof(p_audit_signals) = 'object'
      and p_audit_signals - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' = '{}'::jsonb
      and p_audit_signals ?& array['opensNewThread','opensMajorMystery','opensNewConflict']
      and pg_catalog.jsonb_typeof(p_audit_signals->'opensNewThread') = 'boolean'
      and pg_catalog.jsonb_typeof(p_audit_signals->'opensMajorMystery') = 'boolean'
      and pg_catalog.jsonb_typeof(p_audit_signals->'opensNewConflict') = 'boolean'
    ))
    or p_generation_policy_version is null or p_generation_policy_version < 1
    or p_prompt_contract_version is null or p_prompt_contract_version < 1
    or p_prose_attempt_count is null or p_prose_attempt_count < 0 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  select pg_catalog.count(*)::integer into v_paragraph_count
  from pg_catalog.jsonb_array_elements(p_paragraphs) paragraph
  where pg_catalog.jsonb_typeof(paragraph) = 'string'
    and pg_catalog.btrim(paragraph #>> '{}') <> ''
    and pg_catalog.length(paragraph #>> '{}') <= 20000;
  if v_paragraph_count = 0
    or v_paragraph_count <> pg_catalog.jsonb_array_length(p_paragraphs)
    or pg_catalog.pg_column_size(p_paragraphs) > 1000000 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = v_job.id
  for update;

  if found then
    if v_checkpoint.job_attempt_number > v_job.attempt_count then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'ATTEMPT_AHEAD');
    end if;
    if v_checkpoint.status <> 'PROSE_READY' then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'INVALID_TRANSITION');
    end if;
    if v_checkpoint.checkpoint_schema_version <> 2
      or v_checkpoint.attempt_id is distinct from v_job.id
      or v_checkpoint.correlation_id is distinct from v_job.correlation_id
      or v_checkpoint.job_id is distinct from v_job.id
      or v_checkpoint.prose_fingerprint is distinct from p_prose_fingerprint
      or v_checkpoint.audit_signals_json is distinct from p_audit_signals
      or v_checkpoint.audit_signals_version is distinct from p_audit_signals_version
      or v_checkpoint.canon_version is distinct from p_canon_version
      or v_checkpoint.blueprint_version is distinct from p_blueprint_version
      or v_checkpoint.direction_fingerprint is distinct from p_direction_fingerprint
      or v_checkpoint.generation_mode is distinct from p_generation_mode
      or v_checkpoint.generation_policy_version is distinct from p_generation_policy_version
      or v_checkpoint.prompt_contract_version is distinct from p_prompt_contract_version then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
    end if;
  end if;

  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, audit_signals_json, audit_signals_version,
    canon_version, blueprint_version,
    direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at
  ) values (
    v_job.story_id, v_job.chapter_number, v_job.id, v_job.correlation_id,
    'PROSE_READY', p_title, p_paragraphs, p_prose_fingerprint,
    p_audit_signals, p_audit_signals_version, p_canon_version, p_blueprint_version, p_direction_fingerprint,
    p_generation_mode, p_generation_policy_version, p_prompt_contract_version,
    v_job.id, v_job.attempt_count, 2, p_prose_attempt_count, 0,
    pg_catalog.clock_timestamp() + interval '24 hours'
  )
  on conflict (story_id, chapter_number, attempt_id) do update
  set status = 'PROSE_READY',
      title = excluded.title,
      paragraphs_json = excluded.paragraphs_json,
      prose_fingerprint = excluded.prose_fingerprint,
      audit_signals_json = excluded.audit_signals_json,
      audit_signals_version = excluded.audit_signals_version,
      canon_version = excluded.canon_version,
      blueprint_version = excluded.blueprint_version,
      direction_fingerprint = excluded.direction_fingerprint,
      generation_mode = excluded.generation_mode,
      generation_policy_version = excluded.generation_policy_version,
      prompt_contract_version = excluded.prompt_contract_version,
      job_id = excluded.job_id,
      job_attempt_number = excluded.job_attempt_number,
      checkpoint_schema_version = 2,
      prose_attempt_count = excluded.prose_attempt_count,
      choice_attempt_count = 0,
      updated_at = pg_catalog.clock_timestamp(),
      expires_at = excluded.expires_at
  returning * into v_checkpoint;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'result', 'UPDATED', 'changed', true,
    'checkpoint', pg_catalog.to_jsonb(v_checkpoint)
  );
end;
$$;

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
set search_path = ''
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
        select 1 from public.chapters c
        where c.story_id = v_job.story_id and c.number = v_job.chapter_number
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
    or v_lease.claim_token is distinct from p_claim_token
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or v_lease.holder is distinct from p_worker_id
    or (v_is_publish and v_lease.status <> 'RELEASED')
    or (not v_is_publish and (
      v_lease.status <> 'ACTIVE' or v_lease.expires_at <= pg_catalog.clock_timestamp()
    )) then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LEASE_INVALID');
  end if;

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
    or (v_checkpoint.generation_mode = 'personalized' and not (
      v_checkpoint.audit_signals_json is not null
      and v_checkpoint.audit_signals_version is not null
      and v_checkpoint.audit_signals_version = 1
      and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json) = 'object'
      and v_checkpoint.audit_signals_json - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' = '{}'::jsonb
      and v_checkpoint.audit_signals_json ?& array['opensNewThread','opensMajorMystery','opensNewConflict']
      and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json->'opensNewThread') = 'boolean'
      and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json->'opensMajorMystery') = 'boolean'
      and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json->'opensNewConflict') = 'boolean'
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

revoke all on function public.upsert_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer
) from public, anon, authenticated;
grant execute on function public.upsert_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer
) to service_role;

revoke all on function public.transition_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,uuid,text
) from public, anon, authenticated;
grant execute on function public.transition_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,uuid,text
) to service_role;
