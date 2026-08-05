-- 20260805020000_publish_generation_job_chapter_v5.sql
-- Atomic chapter publication + commercial credit capture & intent resolution (V5).

create or replace function public.publish_generation_job_chapter_v5(
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
  v_v4_result jsonb;
  v_story public.stories%rowtype;
  v_job public.generation_jobs%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_canon_ref text;
  v_ledger_ref text;
begin
  -- 1. Lock exact Phase 1 user commercial financial advisory lock (U) to serialize all user financial operations
  select j.* into v_job from public.generation_jobs j where j.id = p_job_id;
  if found and v_job.user_id is not null then
    perform pg_advisory_xact_lock(hashtext(v_job.user_id::text));
  end if;

  -- 2. Execute V4 atomic publication (handles E -> R -> S -> J -> L -> checkpoint FOR UPDATE -> publication -> C debt closures)
  v_v4_result := public.publish_generation_job_chapter_v4(
    p_job_id, p_worker_id, p_claim_token, p_lease_id, p_story_id,
    p_chapter_number, p_title, p_paragraphs, p_choice_prompt, p_choices,
    p_outcomes, p_ending_key, p_ending_name, p_closures
  );

  -- 3. Check story mode for commercial capture
  select * into v_story from public.stories where id = p_story_id for update;

  if found and (v_story.story_mode = 'personalized_ai' or v_story.story_mode = 'premium_instance') then
    -- STARTER_FREE Bab 1-3 is included (no debit needed)
    if v_story.commercial_origin = 'STARTER_FREE' and p_chapter_number <= 3 then
      return v_v4_result;
    end if;

    -- STARTER_FREE / PAID_START Bab 4+: require ACTIVE CHAPTER_UNLOCK reservation
    if (v_story.commercial_origin in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED') and p_chapter_number >= 4) then
      v_canon_ref := 'chapter-reservation:' || v_job.user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;
      v_ledger_ref := 'unlock:' || p_story_id || ':' || p_chapter_number::text;

      select * into v_reservation
      from public.credit_reservations
      where ref = v_canon_ref
        and user_id = v_job.user_id
        and story_id = p_story_id
        and chapter_number = p_chapter_number
        and reservation_kind = 'CHAPTER_UNLOCK'
        and status = 'ACTIVE'
        and expires_at > clock_timestamp()
      for update;

      if not found then
        select * into v_reservation
        from public.credit_reservations
        where ref = v_canon_ref and status = 'CAPTURED';

        if not found then
          raise exception using errcode = 'P0001', message = 'COMMERCIAL_RESERVATION_REQUIRED';
        end if;
      else
        -- Update status to CAPTURED (Phase 1 enum)
        update public.credit_reservations
          set status = 'CAPTURED', updated_at = clock_timestamp()
          where id = v_reservation.id;

        insert into public.credit_ledger (
          user_id, feature_key, amount, ref, metadata
        ) values (
          v_job.user_id,
          'chapter_unlock',
          v_reservation.amount,
          v_ledger_ref,
          jsonb_build_object(
            'story_id', p_story_id,
            'chapter_number', p_chapter_number,
            'generation_job_id', p_job_id
          )
        ) on conflict (user_id, ref) do nothing;
      end if;

      -- Fulfill commercial intent for Bab 4+
      update public.commercial_generation_intents
        set status = 'FULFILLED', updated_at = clock_timestamp()
        where generation_job_id = p_job_id and status in ('QUEUED', 'RUNNING', 'AUTHORIZED');

      return v_v4_result;
    end if;

    -- PENDING_PAID_START Bab 1: require ACTIVE STORY_START reservation
    if v_story.commercial_origin = 'PENDING_PAID_START' and p_chapter_number = 1 then
      v_canon_ref := 'story-start:' || v_job.user_id::text || ':' || p_story_id;
      v_ledger_ref := 'story-start:' || v_job.user_id::text || ':' || p_story_id;

      select * into v_reservation
      from public.credit_reservations
      where ref = v_canon_ref
        and user_id = v_job.user_id
        and story_id = p_story_id
        and chapter_number = 1
        and reservation_kind = 'STORY_START'
        and status = 'ACTIVE'
        and expires_at > clock_timestamp()
      for update;

      if not found then
        select * into v_reservation
        from public.credit_reservations
        where ref = v_canon_ref and status = 'CAPTURED';

        if not found then
          raise exception using errcode = 'P0001', message = 'COMMERCIAL_RESERVATION_REQUIRED';
        end if;
      else
        -- Update status to CAPTURED (Phase 1 enum)
        update public.credit_reservations
          set status = 'CAPTURED', updated_at = clock_timestamp()
          where id = v_reservation.id;

        insert into public.credit_ledger (
          user_id, feature_key, amount, ref, metadata
        ) values (
          v_job.user_id,
          'story_start',
          v_reservation.amount,
          v_ledger_ref,
          jsonb_build_object(
            'story_id', p_story_id,
            'chapter_number', 1,
            'generation_job_id', p_job_id
          )
        ) on conflict (user_id, ref) do nothing;
      end if;

      -- Promote story to PAID_START
      update public.stories
        set commercial_origin = 'PAID_START', updated_at = clock_timestamp()
        where id = p_story_id;

      -- Update creation request to READY if present
      update public.story_creation_requests
        set status = 'READY', error_code = null, updated_at = clock_timestamp()
        where owner_user_id = v_job.user_id and story_id = p_story_id;

      return v_v4_result;
    end if;
  end if;

  return v_v4_result;
end;
$$;
