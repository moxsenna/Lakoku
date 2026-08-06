-- 20260805030000_publish_generation_job_chapter_v6.sql
-- Commercial Atomic Chapter Publisher (V6).
-- Wraps canonical narrative publication (V5 for Living Canon, V4 for legacy) in outer transaction with financial capture.

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
  p_ending_key text,
  p_ending_name text,
  p_closures jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pub_result jsonb;
  v_story public.stories%rowtype;
  v_job public.generation_jobs%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_creation_req public.story_creation_requests%rowtype;
  v_intent public.commercial_generation_intents%rowtype;
  v_canon_ref text;
  v_ledger_ref text;
  v_req_count integer;
  v_intent_count integer;
  v_active_price integer;
  v_existing_ledger record;
begin
  -- 1. Read job identity for user financial advisory lock (U)
  select j.* into v_job from public.generation_jobs j where j.id = p_job_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  -- Lock user financial advisory lock (U) byte-for-byte matching Phase 1 financial primitives
  perform pg_advisory_xact_lock(hashtext(v_job.user_id::text));

  -- 2. Execute underlying narrative publication
  -- If story is Living Canon (schema 3), call canonical V5; otherwise call V4
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.chapter_generation_checkpoints c
    where c.job_id = p_job_id and c.checkpoint_schema_version = 3
  ) then
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

  -- 3. Commercial story mode checks
  if v_story.story_mode = 'personalized_ai' or v_story.story_mode = 'premium_instance' then
    -- STARTER_FREE Bab 1-3 is included (no debit needed)
    if v_story.commercial_origin = 'STARTER_FREE' and p_chapter_number <= 3 then
      return v_pub_result;
    end if;

    -- PAID_START / LEGACY_GRANDFATHERED Bab 1-3 included
    if (v_story.commercial_origin = 'PAID_START' or v_story.commercial_origin = 'LEGACY_GRANDFATHERED') and p_chapter_number <= 3 then
      return v_pub_result;
    end if;

    -- STARTER_FREE / PAID_START / LEGACY_GRANDFATHERED Bab 4+: require ACTIVE CHAPTER_UNLOCK reservation & exact intent
    if (v_story.commercial_origin in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED') and p_chapter_number >= 4) then
      -- Validate active price from DB
      select credits_required into v_active_price
      from public.feature_credit_costs
      where feature_key = 'chapter_unlock' and is_active = true;

      if v_active_price is null or v_active_price <= 0 then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_CONFIG_INVALID';
      end if;

      v_canon_ref := 'chapter-reservation:' || v_job.user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;
      v_ledger_ref := 'unlock:' || p_story_id || ':' || p_chapter_number::text;

      -- Validate intent: MUST match exactly one intent bound to this job
      select count(*) into v_intent_count
      from public.commercial_generation_intents
      where user_id = v_job.user_id
        and story_id = p_story_id
        and chapter_number = p_chapter_number
        and generation_job_id = p_job_id;

      if v_intent_count <> 1 then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_INTENT_PROVENANCE_MISMATCH';
      end if;

      select * into v_intent
      from public.commercial_generation_intents
      where user_id = v_job.user_id
        and story_id = p_story_id
        and chapter_number = p_chapter_number
        and generation_job_id = p_job_id
      for update;

      select * into v_reservation
      from public.credit_reservations
      where ref = v_canon_ref
        and user_id = v_job.user_id
        and story_id = p_story_id
        and chapter_number = p_chapter_number
        and reservation_kind = 'CHAPTER_UNLOCK'
        and status = 'ACTIVE'
        and amount = v_active_price
        and expires_at > clock_timestamp()
      for update;

      if not found then
        -- Exact financial replay check
        select * into v_reservation
        from public.credit_reservations
        where ref = v_canon_ref and user_id = v_job.user_id and status = 'CAPTURED';

        select * into v_existing_ledger
        from public.credit_ledger
        where ref = v_ledger_ref and user_id = v_job.user_id and delta = -v_active_price and reason = 'unlock_chapter';

        if v_reservation.id is null or v_existing_ledger.id is null then
          raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
        end if;
      else
        -- Atomically capture reservation & write PayCore ledger
        update public.credit_reservations
          set status = 'CAPTURED', updated_at = clock_timestamp()
          where id = v_reservation.id;

        insert into public.credit_ledger (
          user_id, delta, reason, ref
        ) values (
          v_job.user_id,
          -v_reservation.amount,
          'unlock_chapter',
          v_ledger_ref
        ) on conflict (ref) do nothing;
      end if;

      -- Fulfill intent
      update public.commercial_generation_intents
        set status = 'FULFILLED', updated_at = clock_timestamp()
        where id = v_intent.id;

      return v_pub_result;
    end if;

    -- PENDING_PAID_START Bab 1: require ACTIVE STORY_START reservation & bound creation request
    if v_story.commercial_origin = 'PENDING_PAID_START' and p_chapter_number = 1 then
      select credits_required into v_active_price
      from public.feature_credit_costs
      where feature_key = 'story_start' and is_active = true;

      if v_active_price is null or v_active_price <= 0 then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_CONFIG_INVALID';
      end if;

      v_canon_ref := 'story-start:' || v_job.user_id::text || ':' || p_story_id;
      v_ledger_ref := 'story-start:' || v_job.user_id::text || ':' || p_story_id;

      -- Require exactly one story creation request bound to this job
      select count(*) into v_req_count
      from public.story_creation_requests
      where owner_user_id = v_job.user_id
        and story_id = p_story_id
        and generation_job_id = p_job_id;

      if v_req_count <> 1 then
        raise exception using errcode = 'P0001', message = 'CREATION_REQUEST_PROVENANCE_MISMATCH';
      end if;

      select * into v_creation_req
      from public.story_creation_requests
      where owner_user_id = v_job.user_id
        and story_id = p_story_id
        and generation_job_id = p_job_id
      for update;

      select * into v_reservation
      from public.credit_reservations
      where ref = v_canon_ref
        and user_id = v_job.user_id
        and story_id = p_story_id
        and chapter_number = 1
        and reservation_kind = 'STORY_START'
        and status = 'ACTIVE'
        and amount = v_active_price
        and expires_at > clock_timestamp()
      for update;

      if not found then
        -- Exact financial replay check
        select * into v_reservation
        from public.credit_reservations
        where ref = v_canon_ref and user_id = v_job.user_id and status = 'CAPTURED';

        select * into v_existing_ledger
        from public.credit_ledger
        where ref = v_ledger_ref and user_id = v_job.user_id and delta = -v_active_price and reason = 'story_start';

        if v_reservation.id is null or v_existing_ledger.id is null then
          raise exception using errcode = 'P0001', message = 'COMMERCIAL_FINALIZATION_CONFLICT';
        end if;
      else
        -- Atomically capture reservation & write PayCore ledger
        update public.credit_reservations
          set status = 'CAPTURED', updated_at = clock_timestamp()
          where id = v_reservation.id;

        insert into public.credit_ledger (
          user_id, delta, reason, ref
        ) values (
          v_job.user_id,
          -v_reservation.amount,
          'story_start',
          v_ledger_ref
        ) on conflict (ref) do nothing;
      end if;

      -- Promote story to PAID_START
      update public.stories
        set commercial_origin = 'PAID_START'
        where id = p_story_id;

      -- Promote creation request to READY
      update public.story_creation_requests
        set status = 'READY', error_code = null, updated_at = clock_timestamp()
        where owner_user_id = v_job.user_id and story_id = p_story_id and generation_job_id = p_job_id;

      return v_pub_result;
    end if;

    -- Exhaustive check: Bab 2+ for PENDING_PAID_START is DENIED
    raise exception using errcode = 'P0001', message = 'STORY_START_PENDING';
  end if;

  return v_pub_result;
end;
$$;

revoke all on function public.publish_generation_job_chapter_v6(
  uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.publish_generation_job_chapter_v6(
  uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb, text, text, jsonb
) to service_role;
