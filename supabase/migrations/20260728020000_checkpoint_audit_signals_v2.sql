-- Checkpoint audit signals V2: plot-debt closure records in checkpoints.
--
-- Adds:
-- 1. is_valid_checkpoint_audit_signals_v2(jsonb) validator function
-- 2. V1-or-V2 checkpoint constraint (replaces V1-only)
-- 3. Upsert checkpoint RPC body update (reads contract version from locked job)
-- 4. Transition checkpoint RPC body update (accepts V2 audit signals)

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Validator function: exact V2 shape validation
-- ──────────────────────────────────────────────────────────────────────────────

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
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  -- Exact key set: opensNewThread, opensMajorMystery, opensNewConflict, closesPlotDebts
  if p - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' - 'closesPlotDebts' <> '{}'::jsonb then
    return false;
  end if;
  if not (p ?& array['opensNewThread','opensMajorMystery','opensNewConflict','closesPlotDebts']) then
    return false;
  end if;

  -- Three boolean audit flags
  if jsonb_typeof(p->'opensNewThread') <> 'boolean'
    or jsonb_typeof(p->'opensMajorMystery') <> 'boolean'
    or jsonb_typeof(p->'opensNewConflict') <> 'boolean'
  then
    return false;
  end if;

  -- closesPlotDebts: array, max 20, each item validated
  v_closures := p->'closesPlotDebts';
  if jsonb_typeof(v_closures) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(v_closures) > 20 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(v_closures) loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;

    -- Exact key set: closureForm, debtId
    v_keys := (select string_agg(k, ',' order by k) from jsonb_object_keys(v_item) k);
    if v_keys <> 'closureForm,debtId' then
      return false;
    end if;

    -- debtId: string, trimmed, 1..100
    v_debt_id := v_item->>'debtId';
    if v_debt_id is null
      or pg_catalog.char_length(v_debt_id) = 0
      or pg_catalog.char_length(v_debt_id) > 100
      or v_debt_id <> pg_catalog.btrim(v_debt_id)
    then
      return false;
    end if;

    -- closureForm: bounded enum (ABANDONED = Phase 0 rename)
    v_form := v_item->>'closureForm';
    if v_form is null
      or v_form not in ('RESOLVED','SUBVERTED','TRANSFORMED','ABANDONED')
    then
      return false;
    end if;

    -- Unique debtId after trim
    if v_debt_id = ANY(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_debt_id);
  end loop;

  return true;
end;
$$;

comment on function public.is_valid_checkpoint_audit_signals_v2(jsonb) is
  'Validates exact V2 audit signals shape: three booleans + closesPlotDebts array (max 20, unique debtIds).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Checkpoint constraint: V1-or-V2
-- ──────────────────────────────────────────────────────────────────────────────

alter table public.chapter_generation_checkpoints
  drop constraint if exists chapter_generation_checkpoints_audit_signals_v1_check;

alter table public.chapter_generation_checkpoints
  add constraint chapter_generation_checkpoints_audit_signals_check check (
    (audit_signals_json is null and audit_signals_version is null)
    or (
      audit_signals_version = 1
      and pg_catalog.jsonb_typeof(audit_signals_json) = 'object'
      and audit_signals_json - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' = '{}'::jsonb
      and audit_signals_json ?& array['opensNewThread','opensMajorMystery','opensNewConflict']
      and pg_catalog.jsonb_typeof(audit_signals_json->'opensNewThread') = 'boolean'
      and pg_catalog.jsonb_typeof(audit_signals_json->'opensMajorMystery') = 'boolean'
      and pg_catalog.jsonb_typeof(audit_signals_json->'opensNewConflict') = 'boolean'
    )
    or (
      audit_signals_version = 2
      and public.is_valid_checkpoint_audit_signals_v2(audit_signals_json)
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Upsert checkpoint RPC: body update (18-param signature unchanged)
-- ──────────────────────────────────────────────────────────────────────────────
-- Signature stays at 18 params. The body now reads story_contract_version
-- from the locked job row and copies it to the checkpoint.

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
set search_path = pg_catalog, public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_paragraph_count integer;
  v_story_contract_version integer;
begin
  if p_job_id is null or p_worker_id is null or pg_catalog.btrim(p_worker_id) = ''
    or p_claim_token is null or p_lease_id is null or p_story_id is null
    or pg_catalog.btrim(p_story_id) = '' or p_chapter_number is null
    or p_chapter_number not between 1 and 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_IDENTITY';
  end if;

  -- Lock job row and read authoritative contract provenance.
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

  -- Authoritative generation_kind from job, not from caller parameter.
  if p_generation_mode is distinct from v_job.generation_kind then
    raise exception using errcode = '22023', message = 'GENERATION_MODE_MISMATCH';
  end if;

  -- Authoritative contract version from locked job.
  v_story_contract_version := v_job.story_contract_version;

  -- Personalized without contract provenance is rejected.
  if v_job.generation_kind = 'personalized' and v_story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'CONTRACT_PROVENANCE_MISSING';
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

  -- Payload validation.
  if p_title is null or pg_catalog.btrim(p_title) = '' or pg_catalog.length(p_title) > 500
    or p_paragraphs is null or pg_catalog.jsonb_typeof(p_paragraphs) <> 'array'
    or p_prose_fingerprint is null or pg_catalog.btrim(p_prose_fingerprint) = ''
    or pg_catalog.length(p_prose_fingerprint) > 256
    or p_canon_version is null or p_canon_version < 0
    or p_blueprint_version is null or p_blueprint_version < 0
    or p_direction_fingerprint is null or pg_catalog.btrim(p_direction_fingerprint) = ''
    or pg_catalog.length(p_direction_fingerprint) > 256
    or p_generation_policy_version is null or p_generation_policy_version < 1
    or p_prompt_contract_version is null or p_prompt_contract_version < 1
    or p_prose_attempt_count is null or p_prose_attempt_count < 0 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Audit signals validation: standard must be null, personalized must be present.
  if p_generation_mode = 'standard' then
    if p_audit_signals is not null or p_audit_signals_version is not null then
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
  else
    -- personalized: require V1 or V2
    if p_audit_signals is null or p_audit_signals_version is null then
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
    if p_audit_signals_version = 1 then
      -- V1: exact three booleans, no closesPlotDebts
      if pg_catalog.jsonb_typeof(p_audit_signals) <> 'object'
        or p_audit_signals - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' <> '{}'::jsonb
        or not (p_audit_signals ?& array['opensNewThread','opensMajorMystery','opensNewConflict'])
        or pg_catalog.jsonb_typeof(p_audit_signals->'opensNewThread') <> 'boolean'
        or pg_catalog.jsonb_typeof(p_audit_signals->'opensMajorMystery') <> 'boolean'
        or pg_catalog.jsonb_typeof(p_audit_signals->'opensNewConflict') <> 'boolean'
      then
        raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
      end if;
    elsif p_audit_signals_version = 2 then
      if not public.is_valid_checkpoint_audit_signals_v2(p_audit_signals) then
        raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
      end if;
    else
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
  end if;

  -- Paragraph validation.
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

  -- Load existing checkpoint for this story+chapter+attempt.
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

  -- Upsert checkpoint with contract version from job.
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, audit_signals_json, audit_signals_version,
    canon_version, blueprint_version,
    direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at,
    story_contract_version
  ) values (
    v_job.story_id, v_job.chapter_number, v_job.id, v_job.correlation_id,
    'PROSE_READY', p_title, p_paragraphs, p_prose_fingerprint,
    p_audit_signals, p_audit_signals_version, p_canon_version, p_blueprint_version,
    p_direction_fingerprint, p_generation_mode, p_generation_policy_version,
    p_prompt_contract_version,
    v_job.id, v_job.attempt_count, 2, p_prose_attempt_count, 0,
    pg_catalog.clock_timestamp() + interval '24 hours',
    v_story_contract_version
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
      expires_at = excluded.expires_at,
      story_contract_version = excluded.story_contract_version
  returning * into v_checkpoint;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'result', 'UPDATED', 'changed', true,
    'checkpoint', pg_catalog.to_jsonb(v_checkpoint)
  );
end;
$$;

revoke all on function public.upsert_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer
) from public, anon, authenticated;
grant execute on function public.upsert_generation_checkpoint_fenced_v1(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,integer,bigint,bigint,text,text,integer,integer,integer
) to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Transition checkpoint RPC: body update (8-param signature unchanged)
-- ──────────────────────────────────────────────────────────────────────────────
-- Signature stays at 8 params. Body now accepts V2 audit signals via the
-- validator function instead of inline V1-only check.

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
    or v_lease.holder is distinct from v_job.worker_id
    or (v_is_publish and v_lease.status <> 'RELEASED')
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
          pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json) = 'object'
          and v_checkpoint.audit_signals_json - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' = '{}'::jsonb
          and v_checkpoint.audit_signals_json ?& array['opensNewThread','opensMajorMystery','opensNewConflict']
          and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json->'opensNewThread') = 'boolean'
          and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json->'opensMajorMystery') = 'boolean'
          and pg_catalog.jsonb_typeof(v_checkpoint.audit_signals_json->'opensNewConflict') = 'boolean'
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
