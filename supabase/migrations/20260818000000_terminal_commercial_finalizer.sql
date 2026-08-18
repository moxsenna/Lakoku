-- Terminal Commercial Finalization
-- 
-- PURPOSE: Release ACTIVE credit_reservations when generation jobs reach terminal FAILED/CANCELLED state
-- 
-- This fixes PRODUCT P0 gap where finish_generation_job_attempt_v1 releases
-- generation_leases but NOT credit_reservations on terminal failure.
--
-- SUPPORTS: STORY_START (personalized story creation) + CHAPTER_UNLOCK (chapter generation)
-- IDEMPOTENT: Yes - can be called multiple times safely
-- CONCURRENCY SAFE: Uses FOR UPDATE / SKIP LOCKED pattern
-- NO DEBIT: Never creates ledger entries, only releases reservations

create or replace function public.finalize_terminal_commercial_generation_v1(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reservation_record record;
  v_canonical_ref text;
begin
  -- Load job with exclusive lock
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'JOB_NOT_FOUND');
  end if;

  -- Validate terminal state (only FAILED or CANCELLED trigger release)
  if v_job.status not in ('FAILED', 'CANCELLED') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'NON_TERMINAL_STATE',
      'status', v_job.status
    );
  end if;

  -- Attempt to identify and release STORY_START reservation
  if v_job.request_kind = 'personalized' and v_job.chapter_number is null then
    -- Derive canonical ref from job provenance (not client input)
    v_canonical_ref := 'story-start:' || v_job.owner_user_id::text || ':' || v_job.story_id;
    
    select * into v_reservation_record
    from public.credit_reservations
    where ref = v_canonical_ref
    for update skip locked;
    
    if found then
      -- Only release ACTIVE reservations; CAPTURED is terminal already
      if v_reservation_record.status = 'ACTIVE' then
        update public.credit_reservations
        set status = 'RELEASED',
            released_at = v_now,
            release_reason = case when v_job.last_error_code in ('MAX_ATTEMPTS_EXCEEDED', 'GENERATION_RETRY_EXHAUSTED', 'CHOICE_GENERATION_FAILED')
              then 'TERMINAL_FAILURE' else 'CANCELLED' end
        where id = v_reservation_record.id;
        
        return pg_catalog.jsonb_build_object(
          'ok', true,
          'operation', 'STORY_START',
          'ref', v_canonical_ref,
          'previous_status', v_reservation_record.status,
          'new_status', 'RELEASED'
        );
      elsif v_reservation_record.status = 'RELEASED' then
        -- Idempotent: already released
        return pg_catalog.jsonb_build_object(
          'ok', true,
          'operation', 'STORY_START',
          'ref', v_canonical_ref,
          'already_released', true
        );
      else
        -- CAPTURED or EXPIRED: invariant violation
        return pg_catalog.jsonb_build_object(
          'ok', false,
          'reason', 'CAPTURED_INARIANT_VIOLATION',
          'ref', v_canonical_ref,
          'status', v_reservation_record.status
        );
      end if;
    else
      -- Reservation never created or already removed
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'operation', 'STORY_START',
        'ref', v_canonical_ref,
        'reservation_not_found', true
      );
    end if;

  -- Handle CHAPTER_UNLOCK reservation
  elsif v_job.request_kind = 'choice' and v_job.chapter_number is not null then
    v_canonical_ref := 'chapter-reservation:' || v_job.owner_user_id::text || ':' || v_job.story_id || ':' || v_job.chapter_number::text;
    
    select * into v_reservation_record
    from public.credit_reservations
    where ref = v_canonical_ref
    for update skip locked;
    
    if found then
      if v_reservation_record.status = 'ACTIVE' then
        update public.credit_reservations
        set status = 'RELEASED',
            released_at = v_now,
            release_reason = case when v_job.last_error_code in ('MAX_ATTEMPTS_EXCEEDED', 'GENERATION_RETRY_EXHAUSTED', 'CHOICE_GENERATION_FAILED')
              then 'TERMINAL_FAILURE' else 'CANCELLED' end
        where id = v_reservation_record.id;
        
        return pg_catalog.jsonb_build_object(
          'ok', true,
          'operation', 'CHAPTER_UNLOCK',
          'ref', v_canonical_ref,
          'chapter_number', v_job.chapter_number,
          'previous_status', v_reservation_record.status,
          'new_status', 'RELEASED'
        );
      elsif v_reservation_record.status = 'RELEASED' then
        -- Idempotent: already released
        return pg_catalog.jsonb_build_object(
          'ok', true,
          'operation', 'CHAPTER_UNLOCK',
          'ref', v_canonical_ref,
          'chapter_number', v_job.chapter_number,
          'already_released', true
        );
      else
        -- CAPTURED or EXPIRED
        return pg_catalog.jsonb_build_object(
          'ok', false,
          'reason', 'CAPTURED_INARIANT_VIOLATION',
          'ref', v_canonical_ref,
          'status', v_reservation_record.status
        );
      end if;
    else
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'operation', 'CHAPTER_UNLOCK',
        'ref', v_canonical_ref,
        'chapter_number', v_job.chapter_number,
        'reservation_not_found', true
      );
    end if;

  else
    -- Unsupported request kind or chapter configuration
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'reason', 'NO_CANONICAL_RESERVATION',
      'request_kind', v_job.request_kind,
      'chapter_number', v_job.chapter_number
    );
  end if;
end;
$$;

-- Reconciliation RPC: catches orphaned ACTIVE reservations after terminal jobs
-- Used by recovery tick or background reconciliation process
create or replace function public.reconcile_terminal_commercial_reservations_v1(
  p_batch_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reconciled_count integer := 0;
  v_reconciled_refs text[];
  v_canonical_ref text;
  v_reservation_record record;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
    return pg_catalog.jsonb_build_object('reconciled_count', 0);
  end if;

  -- Find all terminal jobs that may have unreleased commercial reservations
  -- Use batch processing to avoid lock contention
  for v_job in
    select j.*
    from public.generation_jobs j
    where j.status in ('FAILED', 'CANCELLED')
    order by j.updated_at asc
    limit p_batch_size
    for update of j skip locked
  loop
    v_reconciled_refs := array_append(coalesce(v_reconciled_refs, '{}'::text[]), v_job.id::text);
    v_reconciled_count := v_reconciled_count + 1;
    
    -- Try STORY_START path
    if v_job.request_kind = 'personalized' and v_job.chapter_number is null then
      v_canonical_ref := 'story-start:' || v_job.owner_user_id::text || ':' || v_job.story_id;
      
      select r.* into v_reservation_record
      from public.credit_reservations r
      where r.ref = v_canonical_ref
      and r.status = 'ACTIVE'
      for update skip locked;
      
      if found and v_reservation_record.status = 'ACTIVE' then
        update public.credit_reservations
        set status = 'RELEASED',
            released_at = v_now,
            release_reason = 'RECONCILIATION'
        where id = v_reservation_record.id;
        
        continue;
      end if;
    end if;
    
    -- Try CHAPTER_UNLOCK path
    if v_job.request_kind = 'choice' and v_job.chapter_number is not null then
      v_canonical_ref := 'chapter-reservation:' || v_job.owner_user_id::text || ':' || v_job.story_id || ':' || v_job.chapter_number::text;
      
      select r.* into v_reservation_record
      from public.credit_reservations r
      where r.ref = v_canonical_ref
      and r.status = 'ACTIVE'
      for update skip locked;
      
      if found and v_reservation_record.status = 'ACTIVE' then
        update public.credit_reservations
        set status = 'RELEASED',
            released_at = v_now,
            release_reason = 'RECONCILIATION'
        where id = v_reservation_record.id;
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'reconciled_count', v_reconciled_count,
    'refs_reconciled', v_reconciled_refs
  );
end;
$$;

-- Grant execute to service_role only
revoke all on function public.finalize_terminal_commercial_generation_v1(uuid) from public, anon, authenticated;
grant execute on function public.finalize_terminal_commercial_generation_v1(uuid) to service_role;

revoke all on function public.reconcile_terminal_commercial_reservations_v1(integer) from public, anon, authenticated;
grant execute on function public.reconcile_terminal_commercial_reservations_v1(integer) to service_role;
