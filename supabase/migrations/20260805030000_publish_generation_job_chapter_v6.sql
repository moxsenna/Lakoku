-- 20260805030000_publish_generation_job_chapter_v6.sql
-- Commercial Atomic Publisher V6
-- Wraps canonical narrative publication (V5 or V4) with PayCore credit capture, exact provenance proof, and user financial lock U.

create or replace function public.publish_generation_job_chapter_v6(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_ending_key text default null,
  p_ending_name text default null,
  p_closures jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_preflight_job public.generation_jobs%rowtype;
  v_preflight_story public.stories%rowtype;
  v_job public.generation_jobs%rowtype;
  v_story public.stories%rowtype;
  v_pub_result jsonb;
  v_reservation public.credit_reservations%rowtype;
  v_creation_req public.story_creation_requests%rowtype;
  v_intent public.commercial_generation_intents%rowtype;
  v_canon_ref text;
  v_ledger_ref text;
  v_req_count integer;
  v_active_price integer;
  v_existing_ledger public.credit_ledger%rowtype;
  v_starter_valid boolean;
  v_expected_req_kind text;
begin
  -- ═══════════════════════════════════════════════════════════════════════════
  -- 1. UNLOCKED PRE-READ: Derivation of lock keys and narrative routing only
  -- ═══════════════════════════════════════════════════════════════════════════
  select j.* into v_preflight_job
  from public.generation_jobs j
  where j.id = p_job_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  select s.* into v_preflight_story
  from public.stories s
  where s.id = p_story_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  -- User Financial Advisory Lock (U): hashtext(user_id::text)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_preflight_job.user_id::text));

  -- ═══════════════════════════════════════════════════════════════════════════
  -- 2. CANONICAL NARRATIVE PUBLICATION (V5 for Living Canon, V4 for legacy)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- Narrative lock graph (E1/E2 -> S -> STORY FOR UPDATE -> R -> J -> L -> Checkpoint)
  -- runs nested inside narrative publisher. We do NOT pre-lock stories FOR UPDATE before this call.
  if coalesce(v_preflight_story.living_canon_version, 0) = 1 then
    v_pub_result := public.publish_generation_job_chapter_v5(
      p_job_id, p_worker_id, p_claim_token, p_lease_id, p_story_id,
      p_chapter_number, p_choice_prompt, p_choices, p_outcomes,
      p_ending_key, p_ending_name
    );
  else
    v_pub_result := public.publish_generation_job_chapter_v4(
      p_job_id, p_worker_id, p_claim_token, p_lease_id, p_story_id,
      p_chapter_number, p_title, p_paragraphs, p_choice_prompt, p_choices,
      p_outcomes, p_ending_key, p_ending_name, p_closures
    );
  end if;

  -- REQUIREMENT A: Narrative Result Gate
  -- Financial finalization NEVER executes after a failed narrative publication.
  if v_pub_result is null or not (v_pub_result ? 'ok') or (v_pub_result->>'ok')::boolean is not true then
    raise exception using errcode = 'P0001', message = 'NARRATIVE_PUBLICATION_FAILED';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- 3. POST-PUBLISH AUTHORITATIVE RE-READ: Validate exact provenance
  -- ═══════════════════════════════════════════════════════════════════════════
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id;

  select s.* into v_story
  from public.stories s
  where s.id = p_story_id;

  if v_job.id is distinct from p_job_id
    or v_job.user_id is distinct from v_preflight_job.user_id
    or v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number
    or v_story.owner_user_id is distinct from v_job.user_id
  then
    raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
  end if;

  -- Non-commercial stories (standard mode or non-owner) stay outside commercial debit
  if v_story.story_mode is distinct from 'personalized_ai' and v_story.story_mode is distinct from 'premium_instance' then
    return v_pub_result;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- 4. COMMERCIAL MODE FINANCING & ROW LOCKING
  -- Commercial Lock Order: U -> Narrative Locks -> M (reservation) -> I/Q (intent/request)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Starter Free included Bab 1-3: requires exact Starter identity proof
  if v_story.commercial_origin = 'STARTER_FREE' and p_chapter_number <= 3 then
    select exists (
      select 1 from public.account_commercial_states acs
      where acs.user_id = v_job.user_id
        and acs.starter_story_id = p_story_id
        and acs.starter_claimed_at is not null
    ) into v_starter_valid;

    if not v_starter_valid then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
    end if;

    return v_pub_result;
  end if;

  -- Paid / Legacy included Bab 2-3
  if (v_story.commercial_origin = 'PAID_START' or v_story.commercial_origin = 'LEGACY_GRANDFATHERED') and p_chapter_number between 2 and 3 then
    return v_pub_result;
  end if;

  -- ---------------------------------------------------------------------------
  -- CASE A: Bab 4+ Commercial Chapter Unlock Capture (STARTER_FREE, PAID_START, LEGACY_GRANDFATHERED)
  -- ---------------------------------------------------------------------------
  if p_chapter_number >= 4 then
    if v_story.commercial_origin not in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED') then
      raise exception using errcode = 'P0001', message = 'STORY_START_PENDING';
    end if;

    -- If STARTER_FREE Bab4+, revalidate Starter account identity
    if v_story.commercial_origin = 'STARTER_FREE' then
      select exists (
        select 1 from public.account_commercial_states acs
        where acs.user_id = v_job.user_id
          and acs.starter_story_id = p_story_id
          and acs.starter_claimed_at is not null
      ) into v_starter_valid;

      if not v_starter_valid then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
      end if;
    end if;

    -- Fetch active price from DB
    select credits_required into v_active_price
    from public.feature_credit_costs
    where feature_key = 'chapter_unlock' and is_active = true;

    if v_active_price is null or v_active_price <= 0 then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_CONFIG_INVALID';
    end if;

    v_canon_ref := 'chapter-reservation:' || v_job.user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;
    v_ledger_ref := 'unlock:' || p_story_id || ':' || p_chapter_number::text;

    -- M: Lock credit_reservations FOR UPDATE
    select cr.* into v_reservation
    from public.credit_reservations cr
    where cr.ref = v_canon_ref
      and cr.user_id = v_job.user_id
      and cr.story_id = p_story_id
      and cr.chapter_number = p_chapter_number
      and cr.reservation_kind = 'CHAPTER_UNLOCK'
    for update;

    -- I: Lock commercial_generation_intents FOR UPDATE
    select i.* into v_intent
    from public.commercial_generation_intents i
    where i.story_id = p_story_id
      and i.chapter_number = p_chapter_number
      and i.generation_job_id = p_job_id
    for update;

    if v_reservation.id is null or v_intent.id is null then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_PROVENANCE_MISSING';
    end if;

    -- REQUIREMENT G: Pricing Snapshot Invariant
    if v_intent.quoted_credits <> v_reservation.amount or v_intent.pricing_version is null then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_PRICING_SNAPSHOT_MISMATCH';
    end if;

    if v_intent.trigger_choice_id is distinct from v_job.trigger_choice_id then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_TRIGGER_CHOICE_MISMATCH';
    end if;

    -- Fresh Capture Path: REQUIREment 9 — intent status MUST BE EXACT 'QUEUED'
    if v_reservation.status = 'ACTIVE' and v_intent.status = 'QUEUED' then
      if v_reservation.expires_at <= clock_timestamp() then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_RESERVATION_EXPIRED';
      end if;

      -- Update reservation status to CAPTURED
      update public.credit_reservations
        set status = 'CAPTURED', updated_at = clock_timestamp()
        where id = v_reservation.id;

      -- Write PayCore ledger
      insert into public.credit_ledger (
        user_id, delta, reason, ref
      ) values (
        v_job.user_id,
        -v_reservation.amount,
        'unlock_chapter',
        v_ledger_ref
      ) on conflict (ref) do nothing;

      -- REQUIREMENT H: Exact Ledger Proof Verification After Insert
      select cl.* into v_existing_ledger
      from public.credit_ledger cl
      where cl.ref = v_ledger_ref;

      if v_existing_ledger.id is null
        or v_existing_ledger.user_id is distinct from v_job.user_id
        or v_existing_ledger.delta is distinct from -v_reservation.amount
        or v_existing_ledger.reason is distinct from 'unlock_chapter'
      then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
      end if;

      -- Transition intent status to FULFILLED
      update public.commercial_generation_intents
        set status = 'FULFILLED', updated_at = clock_timestamp()
        where id = v_intent.id;

      return v_pub_result;

    -- Replay Capture Path
    elsif v_reservation.status = 'CAPTURED' and v_intent.status = 'FULFILLED' then
      -- REQUIREMENT 11: Exact CAPTURED Replay Proof
      select cl.* into v_existing_ledger
      from public.credit_ledger cl
      where cl.ref = v_ledger_ref;

      if v_existing_ledger.id is null
        or v_existing_ledger.user_id is distinct from v_job.user_id
        or v_existing_ledger.delta is distinct from -v_reservation.amount
        or v_existing_ledger.reason is distinct from 'unlock_chapter'
      then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
      end if;

      return v_pub_result;

    else
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- CASE B: Bab 1 Paid Creation Capture (PENDING_PAID_START -> PAID_START)
  -- ---------------------------------------------------------------------------
  if p_chapter_number = 1 then
    select credits_required into v_active_price
    from public.feature_credit_costs
    where feature_key = 'story_start' and is_active = true;

    if v_active_price is null or v_active_price <= 0 then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_CONFIG_INVALID';
    end if;

    v_canon_ref := 'story-start:' || v_job.user_id::text || ':' || p_story_id;
    v_ledger_ref := 'story-start:' || v_job.user_id::text || ':' || p_story_id;
    v_expected_req_kind := case when v_story.story_mode = 'premium_instance' then 'premium_clone' else 'personalized' end;

    -- M: Lock credit_reservations FOR UPDATE
    select cr.* into v_reservation
    from public.credit_reservations cr
    where cr.ref = v_canon_ref
      and cr.user_id = v_job.user_id
      and cr.story_id = p_story_id
      and cr.chapter_number = 1
      and cr.reservation_kind = 'STORY_START'
    for update;

    -- Q: Lock story_creation_requests FOR UPDATE
    select r.* into v_creation_req
    from public.story_creation_requests r
    where r.owner_user_id = v_job.user_id
      and r.story_id = p_story_id
      and r.request_kind = v_expected_req_kind
      and r.generation_job_id = p_job_id
    for update;

    if v_reservation.id is null or v_creation_req.owner_user_id is null then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_PROVENANCE_MISSING';
    end if;

    -- Fresh Paid Start Capture Path
    if v_story.commercial_origin = 'PENDING_PAID_START'
      and v_reservation.status = 'ACTIVE'
      and v_creation_req.status = 'RESERVED'
    then
      if v_reservation.expires_at <= clock_timestamp() then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_RESERVATION_EXPIRED';
      end if;

      -- Update reservation status to CAPTURED
      update public.credit_reservations
        set status = 'CAPTURED', updated_at = clock_timestamp()
        where id = v_reservation.id;

      -- Write PayCore ledger
      insert into public.credit_ledger (
        user_id, delta, reason, ref
      ) values (
        v_job.user_id,
        -v_reservation.amount,
        'story_start',
        v_ledger_ref
      ) on conflict (ref) do nothing;

      -- REQUIREMENT H: Exact Ledger Proof Verification After Insert
      select cl.* into v_existing_ledger
      from public.credit_ledger cl
      where cl.ref = v_ledger_ref;

      if v_existing_ledger.id is null
        or v_existing_ledger.user_id is distinct from v_job.user_id
        or v_existing_ledger.delta is distinct from -v_reservation.amount
        or v_existing_ledger.reason is distinct from 'story_start'
      then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
      end if;

      -- Promote story to PAID_START
      update public.stories
        set commercial_origin = 'PAID_START'
        where id = p_story_id;

      -- Promote creation request to READY
      update public.story_creation_requests
        set status = 'READY', error_code = null, updated_at = clock_timestamp()
        where owner_user_id = v_creation_req.owner_user_id
          and request_kind = v_creation_req.request_kind
          and idempotency_key = v_creation_req.idempotency_key;

      return v_pub_result;

    -- Replay Paid Start Path
    elsif v_story.commercial_origin = 'PAID_START'
      and v_reservation.status = 'CAPTURED'
      and v_creation_req.status = 'READY'
    then
      -- REQUIREMENT 8: Replay requires exact ledger proof
      select cl.* into v_existing_ledger
      from public.credit_ledger cl
      where cl.ref = v_ledger_ref;

      if v_existing_ledger.id is null
        or v_existing_ledger.user_id is distinct from v_job.user_id
        or v_existing_ledger.delta is distinct from -v_reservation.amount
        or v_existing_ledger.reason is distinct from 'story_start'
      then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
      end if;

      return v_pub_result;

    else
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
    end if;
  end if;

  return v_pub_result;
end;
$$;

-- REQUIREMENT 16: Keep V6 ACL as service_role only
revoke all on function public.publish_generation_job_chapter_v6(uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_generation_job_chapter_v6(uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb, text, text, jsonb) to service_role;
