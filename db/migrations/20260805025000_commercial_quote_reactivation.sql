-- Migration 20260805025000_commercial_quote_reactivation.sql
-- Quote-preserving reactivation RPC for commercial generation jobs.
-- Reactivates EXPIRED / RELEASED chapter reservations at exact in-flight intent.quoted_credits
-- under uniform user advisory lock graph: U -> M (credit_reservations) -> I (commercial_generation_intents).

create or replace function public.reactivate_commercial_chapter_reservation_v1(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_generation_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_res public.credit_reservations%rowtype;
  v_intent public.commercial_generation_intents%rowtype;
  v_avail integer;
  v_canonical_ref text;
  c_ttl_seconds constant integer := 1800;
begin
  if p_user_id is null or p_story_id is null or p_chapter_number is null or p_generation_job_id is null then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENTS';
  end if;

  -- 1) U: Uniform Financial User Advisory Lock FIRST (prevents deadlocks)
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- 2) Exact generation job validation
  select * into v_job
  from public.generation_jobs
  where id = p_generation_job_id;

  if not found
    or v_job.user_id is distinct from p_user_id
    or v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number
  then
    return jsonb_build_object('ok', false, 'reason', 'JOB_MISMATCH');
  end if;

  -- 3) M: Canonical reservation lookup FOR UPDATE
  v_canonical_ref := 'chapter-reservation:' || p_user_id::text || ':' || p_story_id || ':' || p_chapter_number::text;

  select * into v_res
  from public.credit_reservations
  where ref = v_canonical_ref
    and user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
    and reservation_kind = 'CHAPTER_UNLOCK'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'RESERVATION_NOT_FOUND');
  end if;

  -- 4) I: Commercial generation intent lookup FOR UPDATE with trigger choice alignment
  select * into v_intent
  from public.commercial_generation_intents
  where user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
    and generation_job_id = p_generation_job_id
    and trigger_choice_id is not distinct from v_job.trigger_choice_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'INTENT_NOT_FOUND');
  end if;

  if v_intent.status <> 'QUEUED' or v_intent.quoted_credits is null or v_intent.quoted_credits <= 0 or v_intent.pricing_version is null or trim(v_intent.pricing_version) = '' then
    return jsonb_build_object('ok', false, 'reason', 'INTENT_NOT_ELIGIBLE_FOR_REACTIVATION', 'status', v_intent.status);
  end if;

  -- Check existing reservation status
  if v_res.status = 'ACTIVE' and v_res.expires_at > clock_timestamp() then
    if v_res.amount = v_intent.quoted_credits then
      return jsonb_build_object('ok', true, 'status', 'RESERVED', 'reactivated', false, 'amount', v_res.amount);
    else
      return jsonb_build_object('ok', false, 'reason', 'RESERVATION_AMOUNT_MISMATCH', 'reservation_amount', v_res.amount, 'intent_amount', v_intent.quoted_credits);
    end if;
  end if;

  if v_res.status = 'CAPTURED' then
    return jsonb_build_object('ok', false, 'reason', 'RESERVATION_ALREADY_CAPTURED', 'amount', v_res.amount);
  end if;

  if v_res.status not in ('EXPIRED', 'RELEASED') and not (v_res.status = 'ACTIVE' and v_res.expires_at <= clock_timestamp()) then
    return jsonb_build_object('ok', false, 'reason', 'RESERVATION_STATUS_NOT_REACTIVATABLE', 'status', v_res.status);
  end if;

  -- 5) Available credit balance check against exact intent.quoted_credits
  v_avail := public.available_credit_balance_v1(p_user_id);
  if v_avail < v_intent.quoted_credits then
    return jsonb_build_object('ok', false, 'reason', 'INSUFFICIENT_CREDITS', 'available', v_avail, 'required', v_intent.quoted_credits);
  end if;

  -- 6) Reactivate SAME reservation row preserving in-flight intent quote
  update public.credit_reservations
  set status = 'ACTIVE',
      amount = v_intent.quoted_credits,
      expires_at = clock_timestamp() + (c_ttl_seconds || ' seconds')::interval,
      updated_at = clock_timestamp()
  where id = v_res.id;

  return jsonb_build_object('ok', true, 'status', 'RESERVED', 'reactivated', true, 'amount', v_intent.quoted_credits);
end;
$$;

revoke all on function public.reactivate_commercial_chapter_reservation_v1(uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.reactivate_commercial_chapter_reservation_v1(uuid, text, integer, uuid) to service_role;
