-- 20260805020000_story_creation_request_job_binding.sql
-- Add generation_job_id to story_creation_requests for atomic Bab 1 job binding and enqueue policy alignment.

alter table public.story_creation_requests
  add column if not exists generation_job_id uuid null references public.generation_jobs(id) on delete set null;

create unique index if not exists story_creation_requests_job_idx
  on public.story_creation_requests(generation_job_id)
  where generation_job_id is not null;

-- Align enqueue_generation_job_v1 policy: allow private OR unlisted for commercial owned stories
-- Derived byte-for-byte from current main (20260728040000_enqueue_contract_provenance.sql)
create or replace function public.enqueue_generation_job_v1(
  p_story_id text,
  p_chapter_number integer,
  p_generation_kind text,
  p_trigger_choice_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_story public.stories%rowtype;
  v_active public.generation_jobs%rowtype;
  v_job_id uuid;
  v_correlation_id uuid;
  v_now timestamptz;
  v_contract_version integer;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if p_story_id is null
    or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200
    or p_story_id ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;

  if p_chapter_number is null
    or p_chapter_number < 1
    or p_chapter_number > 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  end if;

  if p_generation_kind is null
    or p_generation_kind not in ('standard', 'personalized') then
    raise exception using errcode = '22023', message = 'INVALID_GENERATION_KIND';
  end if;

  if p_trigger_choice_id is not null and (
    p_trigger_choice_id = ''
    or p_trigger_choice_id <> pg_catalog.btrim(p_trigger_choice_id)
    or pg_catalog.char_length(p_trigger_choice_id) > 200
    or p_trigger_choice_id ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_TRIGGER_CHOICE_ID';
  end if;

  -- Load story with access control.
  select s.*
  into v_story
  from public.stories as s
  where s.id = p_story_id
    and (
      s.owner_user_id = v_user_id
      or (
        p_generation_kind = 'standard'
        and s.visibility = 'public'
        and exists (
          select 1
          from public.reader_states as rs
          where rs.user_id = v_user_id
            and rs.story_id = s.id
        )
      )
    );

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if (
    p_generation_kind = 'standard'
    and v_story.story_mode is distinct from 'standard'
  ) or (
    p_generation_kind = 'personalized'
    and (
      v_story.owner_user_id is distinct from v_user_id
      or v_story.visibility not in ('private', 'unlisted')
      or v_story.story_mode not in ('personalized_ai', 'premium_instance')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_CONFLICT';
  end if;

  -- Story advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id, 120712)
  );

  -- Reauthorize after waiting.
  select s.*
  into v_story
  from public.stories as s
  where s.id = p_story_id
    and (
      s.owner_user_id = v_user_id
      or (
        p_generation_kind = 'standard'
        and s.visibility = 'public'
        and exists (
          select 1
          from public.reader_states as rs
          where rs.user_id = v_user_id
            and rs.story_id = s.id
        )
      )
    );

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if (
    p_generation_kind = 'standard'
    and v_story.story_mode is distinct from 'standard'
  ) or (
    p_generation_kind = 'personalized'
    and (
      v_story.owner_user_id is distinct from v_user_id
      or v_story.visibility not in ('private', 'unlisted')
      or v_story.story_mode not in ('personalized_ai', 'premium_instance')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_CONFLICT';
  end if;

  -- Snapshot contract version for personalized mode.
  if p_generation_kind = 'personalized' then
    v_contract_version := v_story.story_contract_version;
  else
    v_contract_version := null;
  end if;

  -- Already complete check.
  if exists (
    select 1
    from public.chapters as c
    where c.story_id = p_story_id
      and c.number = p_chapter_number
  ) then
    return pg_catalog.jsonb_build_object(
      'alreadyComplete', true,
      'jobId', null,
      'correlationId', null,
      'status', 'SUCCEEDED'
    );
  end if;

  -- Active job check.
  select j.*
  into v_active
  from public.generation_jobs as j
  where j.story_id = p_story_id
    and j.chapter_number = p_chapter_number
    and j.status in ('QUEUED', 'RUNNING', 'RETRY_WAIT')
  for update;

  if found then
    if v_active.user_id is distinct from v_user_id
      or v_active.generation_kind is distinct from p_generation_kind
      or v_active.trigger_choice_id is distinct from p_trigger_choice_id then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'alreadyComplete', false,
      'jobId', v_active.id,
      'correlationId', v_active.correlation_id,
      'status', v_active.status
    );
  end if;

  v_job_id := pg_catalog.gen_random_uuid();
  v_correlation_id := pg_catalog.gen_random_uuid();
  v_now := pg_catalog.clock_timestamp();

  insert into public.generation_jobs (
    id,
    story_id,
    chapter_number,
    user_id,
    generation_kind,
    trigger_choice_id,
    status,
    attempt_count,
    max_attempts,
    available_at,
    deadline_at,
    correlation_id,
    created_at,
    updated_at,
    publication_idempotency_key,
    story_contract_version
  ) values (
    v_job_id,
    p_story_id,
    p_chapter_number,
    v_user_id,
    p_generation_kind,
    p_trigger_choice_id,
    'QUEUED',
    0,
    4,
    v_now,
    v_now + interval '20 minutes',
    v_correlation_id,
    v_now,
    v_now,
    'generation-job:' || v_job_id::text || ':publish:' || p_chapter_number::text,
    v_contract_version
  );

  return pg_catalog.jsonb_build_object(
    'alreadyComplete', false,
    'jobId', v_job_id,
    'correlationId', v_correlation_id,
    'status', 'QUEUED'
  );
end;
$$;

revoke all on function public.enqueue_generation_job_v1(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_generation_job_v1(text, integer, text, text) to authenticated;

-- DB-authoritative binding primitive for Story Start Bab 1 (with controlled replacement & U -> M -> Q lock order)
create or replace function public.bind_story_creation_request_job_v1(
  p_owner_user_id uuid,
  p_story_id text,
  p_generation_job_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_story public.stories%rowtype;
  v_job public.generation_jobs%rowtype;
  v_old_job public.generation_jobs%rowtype;
  v_req public.story_creation_requests%rowtype;
  v_res public.credit_reservations%rowtype;
  v_req_count integer;
  v_expected_kind text;
  v_expected_ref text;
begin
  if p_owner_user_id is null or p_story_id is null or p_generation_job_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'INVALID_ARGUMENTS');
  end if;

  -- 1. Financial user lock U (Must be FIRST before any M or Q lock)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_owner_user_id::text));

  -- 2. Validate exact job identity (new job MUST be QUEUED)
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_generation_job_id;

  if not found
    or v_job.user_id is distinct from p_owner_user_id
    or v_job.story_id is distinct from p_story_id
    or v_job.chapter_number <> 1
    or v_job.generation_kind <> 'personalized'
    or v_job.trigger_choice_id is not null
    or v_job.status <> 'QUEUED'
  then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'JOB_PROVENANCE_MISMATCH');
  end if;

  -- 3. Validate story mode, origin, and visibility
  select s.* into v_story
  from public.stories s
  where s.id = p_story_id;

  if not found
    or v_story.owner_user_id is distinct from p_owner_user_id
    or v_story.story_mode not in ('personalized_ai', 'premium_instance')
    or v_story.commercial_origin is distinct from 'PENDING_PAID_START'
    or v_story.visibility not in ('private', 'unlisted')
  then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'STORY_NOT_ELIGIBLE');
  end if;

  v_expected_kind := case when v_story.story_mode = 'premium_instance' then 'premium_clone' else 'personalized' end;
  v_expected_ref := 'story-start:' || p_owner_user_id::text || ':' || p_story_id;

  -- 4. Lock & Validate M (STORY_START credit reservation must be ACTIVE, canonical, unexpired, amount > 0)
  select r.* into v_res
  from public.credit_reservations r
  where r.user_id = p_owner_user_id
    and r.story_id = p_story_id
    and r.chapter_number = 1
    and r.reservation_kind = 'STORY_START'
    and r.ref = v_expected_ref
    and r.status = 'ACTIVE'
    and r.expires_at > pg_catalog.clock_timestamp()
    and r.amount > 0
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'STORY_START_RESERVATION_NOT_ACTIVE');
  end if;

  -- 5. Lock & Validate Q (story_creation_request)
  select count(*) into v_req_count
  from public.story_creation_requests r
  where r.owner_user_id = p_owner_user_id
    and r.story_id = p_story_id
    and r.request_kind = v_expected_kind;

  if v_req_count <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_COUNT_MISMATCH');
  end if;

  select r.* into v_req
  from public.story_creation_requests r
  where r.owner_user_id = p_owner_user_id
    and r.story_id = p_story_id
    and r.request_kind = v_expected_kind
  for update;

  -- 6. Binding branch logic: Fresh (RESERVED) vs Replacement (WAITING_FOR_CREDITS)
  if v_req.status = 'RESERVED' then
    if v_req.generation_job_id is not null and v_req.generation_job_id <> p_generation_job_id then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_ALREADY_BOUND');
    end if;

    update public.story_creation_requests
      set generation_job_id = p_generation_job_id, updated_at = pg_catalog.clock_timestamp()
      where owner_user_id = v_req.owner_user_id
        and request_kind = v_req.request_kind
        and idempotency_key = v_req.idempotency_key;

    return pg_catalog.jsonb_build_object('ok', true, 'story_id', p_story_id, 'job_id', p_generation_job_id, 'mode', 'FRESH');

  elsif v_req.status = 'WAITING_FOR_CREDITS' then
    -- Controlled replacement requirement: old job must exist and be terminal (FAILED or CANCELLED)
    if v_req.generation_job_id is null then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'REPLACEMENT_PROVENANCE_MISSING');
    end if;

    select j.* into v_old_job
    from public.generation_jobs j
    where j.id = v_req.generation_job_id;

    if not found or v_old_job.status not in ('FAILED', 'CANCELLED') then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'PREVIOUS_JOB_NOT_TERMINAL');
    end if;

    -- Replacement approved: update job binding and transition request back to RESERVED
    update public.story_creation_requests
      set generation_job_id = p_generation_job_id,
          status = 'RESERVED',
          error_code = null,
          updated_at = pg_catalog.clock_timestamp()
      where owner_user_id = v_req.owner_user_id
        and request_kind = v_req.request_kind
        and idempotency_key = v_req.idempotency_key;

    return pg_catalog.jsonb_build_object('ok', true, 'story_id', p_story_id, 'job_id', p_generation_job_id, 'mode', 'REPLACEMENT');

  else
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_INVALID_STATE');
  end if;
end;
$$;

revoke all on function public.bind_story_creation_request_job_v1(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.bind_story_creation_request_job_v1(uuid, text, uuid) to service_role;

-- DB-authoritative RPC for transitioning story_creation_requests to WAITING_FOR_CREDITS
create or replace function public.transition_story_creation_request_waiting_v1(
  p_owner_user_id uuid,
  p_story_id text,
  p_request_kind text,
  p_generation_job_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_req public.story_creation_requests%rowtype;
begin
  if p_owner_user_id is null or p_story_id is null or p_request_kind is null or p_generation_job_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'INVALID_ARGUMENTS');
  end if;

  -- 1. Financial user lock U
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_owner_user_id::text));

  -- 2. Lock and validate exact request Q
  select r.* into v_req
  from public.story_creation_requests r
  where r.owner_user_id = p_owner_user_id
    and r.story_id = p_story_id
    and r.request_kind = p_request_kind
    and r.generation_job_id = p_generation_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_NOT_FOUND');
  end if;

  if v_req.status <> 'RESERVED' then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_INVALID_STATUS');
  end if;

  -- 3. Transition to WAITING_FOR_CREDITS
  update public.story_creation_requests
    set status = 'WAITING_FOR_CREDITS',
        updated_at = pg_catalog.clock_timestamp()
    where owner_user_id = v_req.owner_user_id
      and request_kind = v_req.request_kind
      and idempotency_key = v_req.idempotency_key;

  return pg_catalog.jsonb_build_object('ok', true, 'status', 'WAITING_FOR_CREDITS', 'job_id', p_generation_job_id);
end;
$$;

revoke all on function public.transition_story_creation_request_waiting_v1(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.transition_story_creation_request_waiting_v1(uuid, text, text, uuid) to service_role;
