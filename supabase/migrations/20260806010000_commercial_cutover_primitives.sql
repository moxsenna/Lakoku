-- 20260806010000_commercial_cutover_primitives.sql
-- Phase 2B Commercial Cutover primitives for personalized_ai story creation and choice generation.

-- 1. Choice Intent Authorization Primitive (Quote-Preserving)
create or replace function public.authorize_commercial_generation_intent_v1(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_story public.stories%rowtype;
  v_res public.credit_reservations%rowtype;
  v_intent public.commercial_generation_intents%rowtype;
  v_job public.generation_jobs%rowtype;
  v_canonical_ref text;
  v_available integer;
  c_ttl_seconds constant integer := 1800;
begin
  if p_user_id is null or p_story_id is null or p_chapter_number is null or p_chapter_number < 4 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- 1) Uniform Advisory User Lock
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- 2) Story ownership & mode checks
  select * into v_story from public.stories where id = p_story_id for share;
  if not found or v_story.owner_user_id <> p_user_id then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if v_story.story_mode <> 'personalized_ai' then
    raise exception using errcode = 'P0001', message = 'INVALID_STORY_MODE';
  end if;

  if v_story.visibility not in ('private', 'unlisted') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_VISIBILITY';
  end if;

  if v_story.commercial_origin not in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED') then
    raise exception using errcode = 'P0001', message = 'INVALID_COMMERCIAL_ORIGIN';
  end if;

  if v_story.commercial_origin = 'STARTER_FREE' then
    if not exists (
      select 1 from public.account_commercial_states
      where user_id = p_user_id and starter_story_id = p_story_id and starter_claimed_at is not null
    ) then
      raise exception using errcode = 'P0001', message = 'STARTER_IDENTITY_MISMATCH';
    end if;
  end if;

  -- 3) Lock canonical reservation FOR UPDATE
  v_canonical_ref := 'chapter-reservation:' || p_user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;

  select * into v_res
  from public.credit_reservations
  where ref = v_canonical_ref
    and user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
    and reservation_kind = 'CHAPTER_UNLOCK'
  for update;

  -- 4) Lock intent FOR UPDATE
  select * into v_intent
  from public.commercial_generation_intents
  where user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INTENT_NOT_FOUND';
  end if;

  -- Replacement fencing on existing bound job
  if v_intent.generation_job_id is not null then
    select * into v_job from public.generation_jobs where id = v_intent.generation_job_id;
    if found then
      if v_job.status in ('QUEUED', 'RUNNING', 'RETRY_WAIT') then
        if v_intent.status = 'QUEUED' then
          return jsonb_build_object('ok', true, 'status', 'QUEUED', 'replayed', true, 'amount', v_intent.quoted_credits);
        else
          raise exception using errcode = 'P0001', message = 'INTENT_JOB_CONFLICT';
        end if;
      elsif v_job.status = 'SUCCEEDED' then
        raise exception using errcode = 'P0001', message = 'SUCCEEDED_JOB_PRESENT';
      elsif v_job.status in ('FAILED', 'CANCELLED') then
        v_intent.generation_job_id := null;
      end if;
    end if;
  end if;

  if v_intent.status not in ('WAITING_FOR_CREDITS', 'AUTHORIZED') then
    if v_intent.status = 'FULFILLED' and v_res.status = 'CAPTURED' then
      return jsonb_build_object('ok', false, 'reason', 'RESERVATION_ALREADY_CAPTURED');
    end if;
    raise exception using errcode = 'P0001', message = 'INVALID_INTENT_STATUS';
  end if;

  -- 5) State Matrix Evaluation
  -- Case A: ACTIVE reservation already exists and is unexpired
  if v_res.id is not null and v_res.status = 'ACTIVE' and v_res.expires_at > clock_timestamp() then
    if v_res.amount <> v_intent.quoted_credits then
      return jsonb_build_object('ok', false, 'reason', 'RESERVATION_AMOUNT_MISMATCH', 'reservation_amount', v_res.amount, 'intent_amount', v_intent.quoted_credits);
    end if;

    if v_intent.status <> 'AUTHORIZED' or v_intent.generation_job_id is not null then
      update public.commercial_generation_intents
      set status = 'AUTHORIZED', generation_job_id = null, updated_at = clock_timestamp()
      where id = v_intent.id;
    end if;

    return jsonb_build_object('ok', true, 'status', 'AUTHORIZED', 'replayed', true, 'amount', v_res.amount);
  end if;

  -- Case B: Reservation is CAPTURED
  if v_res.id is not null and v_res.status = 'CAPTURED' then
    return jsonb_build_object('ok', false, 'reason', 'RESERVATION_ALREADY_CAPTURED', 'amount', v_res.amount);
  end if;

  -- Case C: Reservation missing, EXPIRED, or RELEASED -> Derives required cost ONLY from intent.quoted_credits
  v_available := public.available_credit_balance_v1(p_user_id);
  if v_available < v_intent.quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS', 'available', v_available, 'required', v_intent.quoted_credits);
  end if;

  -- Atomic creation or reactivation of canonical reservation
  if v_res.id is not null then
    update public.credit_reservations
    set status = 'ACTIVE',
        amount = v_intent.quoted_credits,
        expires_at = clock_timestamp() + (c_ttl_seconds || ' seconds')::interval,
        updated_at = clock_timestamp()
    where id = v_res.id;
  else
    insert into public.credit_reservations (
      user_id, story_id, chapter_number, reservation_kind, amount, ref, status, created_at, expires_at
    ) values (
      p_user_id, p_story_id, p_chapter_number, 'CHAPTER_UNLOCK', v_intent.quoted_credits, v_canonical_ref, 'ACTIVE', clock_timestamp(), clock_timestamp() + (c_ttl_seconds || ' seconds')::interval
    );
  end if;

  update public.commercial_generation_intents
  set status = 'AUTHORIZED', generation_job_id = null, updated_at = clock_timestamp()
  where id = v_intent.id;

  return jsonb_build_object('ok', true, 'status', 'AUTHORIZED', 'replayed', false, 'amount', v_intent.quoted_credits);
end;
$$;

revoke all on function public.authorize_commercial_generation_intent_v1(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.authorize_commercial_generation_intent_v1(uuid, text, integer) to service_role;


-- 2. Atomic Choice Job Creation & Intent Binding Primitive
create or replace function public.queue_authorized_commercial_generation_v1(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_story public.stories%rowtype;
  v_contract public.story_generation_contracts%rowtype;
  v_res public.credit_reservations%rowtype;
  v_intent public.commercial_generation_intents%rowtype;
  v_existing_job public.generation_jobs%rowtype;
  v_job_id uuid;
  v_corr uuid;
  v_pub_key text;
  v_canonical_ref text;
begin
  if p_user_id is null or p_story_id is null or p_chapter_number is null or p_chapter_number < 4 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- Lock U -> S -> M -> I
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select * into v_story from public.stories where id = p_story_id for share;
  if not found or v_story.owner_user_id <> p_user_id then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if v_story.story_mode <> 'personalized_ai' then
    raise exception using errcode = 'P0001', message = 'INVALID_STORY_MODE';
  end if;

  if v_story.visibility not in ('private', 'unlisted') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_VISIBILITY';
  end if;

  if v_story.story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'STORY_CONTRACT_VERSION_MISSING';
  end if;

  select * into v_contract from public.story_generation_contracts where story_id = p_story_id;
  if not found or v_contract.story_contract_version is null or v_contract.story_contract_version <> v_story.story_contract_version then
    raise exception using errcode = 'P0001', message = 'STORY_CONTRACT_VERSION_MISMATCH';
  end if;

  v_canonical_ref := 'chapter-reservation:' || p_user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;
  select * into v_res
  from public.credit_reservations
  where ref = v_canonical_ref
    and user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
    and reservation_kind = 'CHAPTER_UNLOCK'
  for update;

  if not found or v_res.status <> 'ACTIVE' or v_res.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_RESERVATION_MISSING';
  end if;

  select * into v_intent
  from public.commercial_generation_intents
  where user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INTENT_NOT_FOUND';
  end if;

  if v_intent.status not in ('AUTHORIZED', 'QUEUED') then
    raise exception using errcode = 'P0001', message = 'INTENT_NOT_AUTHORIZED';
  end if;

  if v_res.amount <> v_intent.quoted_credits then
    raise exception using errcode = 'P0001', message = 'RESERVATION_AMOUNT_MISMATCH';
  end if;

  if v_intent.trigger_choice_id is null or trim(v_intent.trigger_choice_id) = '' then
    raise exception using errcode = 'P0001', message = 'TRIGGER_CHOICE_MISSING';
  end if;

  -- Chapter already published check before creating job
  if exists (
    select 1 from public.chapters
    where story_id = p_story_id and number = p_chapter_number
  ) then
    if v_intent.status = 'FULFILLED' and v_res.status = 'CAPTURED' then
      return jsonb_build_object(
        'ok', true,
        'status', 'COMPLETED',
        'replayed', true,
        'alreadyComplete', true,
        'job_id', coalesce(v_intent.generation_job_id, gen_random_uuid()),
        'correlation_id', gen_random_uuid()
      );
    else
      raise exception using errcode = 'P0001', message = 'CHAPTER_EXISTS_UNFULFILLED_INTENT';
    end if;
  end if;

  -- Active job check (Strict Provenance: intent.generation_job_id must match exact active job)
  select * into v_existing_job
  from public.generation_jobs
  where story_id = p_story_id
    and chapter_number = p_chapter_number
    and status in ('QUEUED', 'RUNNING', 'RETRY_WAIT')
  for update;

  if found then
    if v_intent.generation_job_id is not null and v_intent.generation_job_id = v_existing_job.id then
      if v_existing_job.user_id <> p_user_id
         or v_existing_job.trigger_choice_id <> v_intent.trigger_choice_id
         or v_existing_job.story_contract_version <> v_story.story_contract_version then
        raise exception using errcode = 'P0001', message = 'PROVENANCE_MISMATCH';
      end if;

      update public.commercial_generation_intents
      set status = 'QUEUED', updated_at = clock_timestamp()
      where id = v_intent.id;

      return jsonb_build_object('ok', true, 'status', 'QUEUED', 'replayed', true, 'job_id', v_existing_job.id, 'correlation_id', v_existing_job.correlation_id);
    else
      raise exception using errcode = 'P0001', message = 'INTENT_JOB_CONFLICT';
    end if;
  end if;

  -- Create exact canonical job
  v_job_id := gen_random_uuid();
  v_corr := gen_random_uuid();
  v_pub_key := 'generation-job:' || v_job_id::text || ':publish:' || p_chapter_number::text;

  insert into public.generation_jobs (
    id, correlation_id, user_id, story_id, chapter_number, generation_kind, trigger_choice_id,
    status, attempt_count, max_attempts, available_at, deadline_at, publication_idempotency_key, story_contract_version
  ) values (
    v_job_id, v_corr, p_user_id, p_story_id, p_chapter_number, 'personalized', v_intent.trigger_choice_id,
    'QUEUED', 0, 4, clock_timestamp(), clock_timestamp() + interval '20 minutes', v_pub_key, v_story.story_contract_version
  );

  update public.commercial_generation_intents
  set generation_job_id = v_job_id, status = 'QUEUED', updated_at = clock_timestamp()
  where id = v_intent.id;

  return jsonb_build_object('ok', true, 'status', 'QUEUED', 'replayed', false, 'job_id', v_job_id, 'correlation_id', v_corr);
end;
$$;

revoke all on function public.queue_authorized_commercial_generation_v1(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.queue_authorized_commercial_generation_v1(uuid, text, integer) to service_role;


-- 3. Atomic Paid Story #2+ Job Creation & Request Binding Primitive
create or replace function public.queue_paid_story_start_generation_v1(
  p_owner_user_id uuid,
  p_story_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_story public.stories%rowtype;
  v_contract public.story_generation_contracts%rowtype;
  v_res public.credit_reservations%rowtype;
  v_req public.story_creation_requests%rowtype;
  v_existing_job public.generation_jobs%rowtype;
  v_job_id uuid;
  v_corr uuid;
  v_pub_key text;
  v_canonical_ref text;
  v_active_price integer;
  v_req_count integer;
begin
  if p_owner_user_id is null or p_story_id is null then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- Lock U -> S -> M -> Q
  perform pg_advisory_xact_lock(hashtext(p_owner_user_id::text));

  select * into v_story from public.stories where id = p_story_id for share;
  if not found or v_story.owner_user_id <> p_owner_user_id then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if v_story.story_mode <> 'personalized_ai' then
    raise exception using errcode = 'P0001', message = 'INVALID_STORY_MODE';
  end if;

  if v_story.visibility not in ('private', 'unlisted') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_VISIBILITY';
  end if;

  if v_story.commercial_origin <> 'PENDING_PAID_START' then
    raise exception using errcode = 'P0001', message = 'COMMERCIAL_STATE_INVALID';
  end if;

  if v_story.story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'STORY_CONTRACT_VERSION_MISSING';
  end if;

  select * into v_contract from public.story_generation_contracts where story_id = p_story_id;
  if not found or v_contract.story_contract_version is null or v_contract.story_contract_version <> v_story.story_contract_version then
    raise exception using errcode = 'P0001', message = 'STORY_CONTRACT_VERSION_MISMATCH';
  end if;

  if not exists (select 1 from public.reader_states where user_id = p_owner_user_id and story_id = p_story_id) then
    raise exception using errcode = 'P0001', message = 'READER_STATE_MISSING';
  end if;

  v_canonical_ref := 'story-start:' || p_owner_user_id::text || ':' || p_story_id;
  select * into v_res
  from public.credit_reservations
  where ref = v_canonical_ref
    and user_id = p_owner_user_id
    and story_id = p_story_id
    and reservation_kind = 'STORY_START'
  for update;

  if not found or v_res.status <> 'ACTIVE' or v_res.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_RESERVATION_MISSING';
  end if;

  select credits_required into v_active_price
  from public.feature_credit_costs
  where feature_key = 'story_start' and is_active = true;

  if not found or v_active_price is null or v_res.amount <> v_active_price then
    raise exception using errcode = 'P0001', message = 'RESERVATION_AMOUNT_MISMATCH';
  end if;

  -- Require EXACTLY ONE creation request matching (owner, story, personalized)
  select count(*) into v_req_count
  from public.story_creation_requests
  where owner_user_id = p_owner_user_id
    and story_id = p_story_id
    and request_kind = 'personalized';

  if v_req_count <> 1 then
    raise exception using errcode = 'P0001', message = 'CREATION_REQUEST_COUNT_INVALID';
  end if;

  select * into v_req
  from public.story_creation_requests
  where owner_user_id = p_owner_user_id
    and story_id = p_story_id
    and request_kind = 'personalized'
  for update;

  if v_req.status not in ('RESERVED', 'WAITING_FOR_CREDITS') then
    raise exception using errcode = 'P0001', message = 'CREATION_REQUEST_INVALID_STATUS';
  end if;

  -- Active job check
  select * into v_existing_job
  from public.generation_jobs
  where user_id = p_owner_user_id
    and story_id = p_story_id
    and chapter_number = 1
    and status in ('QUEUED', 'RUNNING', 'RETRY_WAIT')
  for update;

  if found then
    if v_req.status = 'RESERVED' and v_req.generation_job_id = v_existing_job.id then
      return jsonb_build_object('ok', true, 'status', 'QUEUED', 'replayed', true, 'job_id', v_existing_job.id, 'correlation_id', v_existing_job.correlation_id);
    else
      raise exception using errcode = 'P0001', message = 'CREATION_JOB_CONFLICT';
    end if;
  end if;

  -- Replacement check: if old bound job exists, require terminal FAILED or CANCELLED (never SUCCEEDED)
  if v_req.generation_job_id is not null then
    select * into v_existing_job from public.generation_jobs where id = v_req.generation_job_id;
    if found and v_existing_job.status not in ('FAILED', 'CANCELLED') then
      raise exception using errcode = 'P0001', message = 'OLD_JOB_NOT_TERMINAL';
    end if;
  end if;

  -- Create exact canonical Bab 1 job
  v_job_id := gen_random_uuid();
  v_corr := gen_random_uuid();
  v_pub_key := 'generation-job:' || v_job_id::text || ':publish:1';

  insert into public.generation_jobs (
    id, correlation_id, user_id, story_id, chapter_number, generation_kind, trigger_choice_id,
    status, attempt_count, max_attempts, available_at, deadline_at, publication_idempotency_key, story_contract_version
  ) values (
    v_job_id, v_corr, p_owner_user_id, p_story_id, 1, 'personalized', null,
    'QUEUED', 0, 4, clock_timestamp(), clock_timestamp() + interval '20 minutes', v_pub_key, v_story.story_contract_version
  );

  update public.story_creation_requests
  set generation_job_id = v_job_id, status = 'RESERVED', error_code = null, updated_at = clock_timestamp()
  where story_id = p_story_id;

  return jsonb_build_object('ok', true, 'status', 'QUEUED', 'replayed', false, 'job_id', v_job_id, 'correlation_id', v_corr);
end;
$$;

revoke all on function public.queue_paid_story_start_generation_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.queue_paid_story_start_generation_v1(uuid, text) to service_role;


-- 4. Paid Creation Ready Metadata Trigger
create or replace function public.trg_personalized_creation_request_ready()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.request_kind = 'personalized'
    and new.status = 'READY'
    and (old.status is distinct from 'READY')
    and new.generation_job_id is not null
  then
    update public.stories
    set generation_status = 'ready'
    where id = new.story_id
      and owner_user_id = new.owner_user_id
      and story_mode = 'personalized_ai'
      and commercial_origin = 'PAID_START';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_personalized_creation_request_ready on public.story_creation_requests;
create trigger trg_personalized_creation_request_ready
  after update of status on public.story_creation_requests
  for each row execute function public.trg_personalized_creation_request_ready();

-- Helper function to trigger PostgREST schema cache reload in test environments
create or replace function public.reload_schema_cache_v1()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke all on function public.reload_schema_cache_v1() from public, anon, authenticated;
grant execute on function public.reload_schema_cache_v1() to service_role;

-- Helper function to insert test auth user directly in DB
create or replace function public.create_test_auth_user_v1(
  p_user_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
  values (
    p_user_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    clock_timestamp(),
    clock_timestamp(),
    'authenticated',
    'authenticated'
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.create_test_auth_user_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.create_test_auth_user_v1(uuid, text) to service_role;
