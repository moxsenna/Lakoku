-- Terminal Commercial Finalization (R4: Corrected Canonical Implementation)
-- 
-- Fixes PRODUCT P0: RELEASE ACTIVE credit_reservations when generation jobs
-- reach terminal FAILED/CANCELLED state.
--
-- CORRECTED implementation with:
--   Exact job.id binding via story_creation_requests.generation_job_id
--   Proper U->S->M->BINDING->Q lock ordering (story FOR SHARE, not hash)
--   Reservation amount validation against canonical price / intent.quoted_credits
--   Explicit state outcomes (EXPIRED != ALREADY_RELEASED)
--   No catch-all exception handler

create or replace function public.finalize_terminal_commercial_generation_v1(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid := p_job_id;
  v_now timestamptz := pg_catalog.clock_timestamp();
  
  -- Phase A: Non-locking identity pre-read
  v_story_id text;
  v_chapter_number integer;
  v_user_id uuid;
  v_generation_kind text;
  v_trigger_choice_id text;
  v_current_status text;
  
  -- Binding validation (exact job.id matching)
  v_story_binding_exists boolean := false;
  v_intent_binding_exists boolean := false;
  
  -- Lock acquisition variables
  v_story_record record;
  v_binding_record record;
  v_reservation_record record;
  v_canonical_ref text;
  
  -- Amount validation constants (canonical prices)
  constant_story_start_amount integer := 24;
  
begin
  -- ===========================================================================
  -- PHASE A: Non-locking identity pre-read + exact binding discovery
  -- ===========================================================================
  
  select gj.story_id, gj.chapter_number, gj.user_id, gj.generation_kind, 
         gj.trigger_choice_id, gj.status
  into v_story_id, v_chapter_number, v_user_id, v_generation_kind, 
       v_trigger_choice_id, v_current_status
  from public.generation_jobs gj
  where gj.id = v_job_id;
  
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'JOB_NOT_FOUND');
  end if;
  
  -- Validate terminal state
  if v_current_status not in ('FAILED', 'CANCELLED') then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'NON_TERMINAL_STATE',
      'status', v_current_status
    );
  end if;
  
  -- Discover exact bindings by generation_job_id
  -- STORY_START: requires story_creation_requests.generation_job_id = job.id
  select exists(
    select 1 from public.story_creation_requests scr
    where scr.generation_job_id = v_job_id
      and scr.owner_user_id = v_user_id
      and scr.story_id = v_story_id
      and scr.request_kind = 'personalized'
  ) into v_story_binding_exists;
  
  -- CHAPTER_UNLOCK: requires commercial_generation_intents.generation_job_id = job.id
  select exists(
    select 1 from public.commercial_generation_intents cgi
    where cgi.generation_job_id = v_job_id
      and cgi.user_id = v_user_id
      and cgi.story_id = v_story_id
      and cgi.chapter_number = v_chapter_number
  ) into v_intent_binding_exists;
  
  -- Require exactly one binding (XOR invariant)
  if v_story_binding_exists and v_intent_binding_exists then
    -- PROVENANCE_CONFLICT: both bindings present
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'PROVENANCE_CONFLICT',
      'job_id', v_job_id::text
    );
  elsif not v_story_binding_exists and not v_intent_binding_exists then
    -- NO_COMMERCIAL_BINDING: plain job, no financial obligation
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'outcome', 'NO_COMMERCIAL_BINDING',
      'job_id', v_job_id::text
    );
  end if;
  
  -- ===========================================================================
  -- PHASE B: Acquire canonical locks in order U->S->M->BINDING->Q
  -- ===========================================================================
  
  -- 1) User advisory lock FIRST
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_user_id::text)
  );
  
  -- 2) Story row share lock (FOR SHARE on real table, NOT advisory hash)
  select s.* into v_story_record
  from public.stories s
  where s.id = v_story_id
    and s.owner_user_id = v_user_id
  for share;
  
  if not found then
    -- Story doesn't exist or ownership mismatch after lock acquired
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'PROVENANCE_CONFLICT',
      'job_id', v_job_id::text,
      'story_id', v_story_id
    );
  end if;
  
  -- Determine path and canonical ref
  v_canonical_ref := null;
  
  if v_story_binding_exists then
    -- STORY_START path
    v_canonical_ref := 'story-start:' || v_user_id::text || ':' || v_story_id;
    
    -- 3) Lock reservation FOR UPDATE
    select r.* into v_reservation_record
    from public.credit_reservations r
    where r.ref = v_canonical_ref
      and r.user_id = v_user_id
      and r.story_id = v_story_id
      and r.reservation_kind = 'STORY_START'
      and coalesce(r.chapter_number, 0) = 1
    for update;
    
    -- 4) Revalidate binding under lock
    select scr.* into v_binding_record
    from public.story_creation_requests scr
    where scr.generation_job_id = v_job_id
      and scr.owner_user_id = v_user_id
      and scr.story_id = v_story_id
      and scr.request_kind = 'personalized'
    for update;
    
    if not found then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'PROVENANCE_CONFLICT',
        'job_id', v_job_id::text,
        'operation', 'STORY_START'
      );
    end if;
    
  else
    -- CHAPTER_UNLOCK path
    v_canonical_ref := 'chapter-reservation:' || v_user_id::text || ':' || v_story_id || ':' || v_chapter_number::text;
    
    -- 3) Lock reservation FOR UPDATE
    select r.* into v_reservation_record
    from public.credit_reservations r
    where r.ref = v_canonical_ref
      and r.user_id = v_user_id
      and r.story_id = v_story_id
      and r.chapter_number = v_chapter_number
      and r.reservation_kind = 'CHAPTER_UNLOCK'
    for update;
    
    -- 4) Revalidate binding under lock with trigger_choice_id check
    select cgi.* into v_binding_record
    from public.commercial_generation_intents cgi
    where cgi.generation_job_id = v_job_id
      and cgi.user_id = v_user_id
      and cgi.story_id = v_story_id
      and cgi.chapter_number = v_chapter_number
      and cgi.trigger_choice_id = v_trigger_choice_id
    for update;
    
    if not found then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'PROVENANCE_CONFLICT',
        'job_id', v_job_id::text,
        'operation', 'CHAPTER_UNLOCK',
        'chapter_number', v_chapter_number
      );
    end if;
  end if;
  
  -- ===========================================================================
  -- PHASE C: Process result based on reservation state
  -- ===========================================================================
  
  if not found then
    -- No matching reservation found => reservation missing for bound job
    if v_story_binding_exists then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_MISSING',
        'ref', v_canonical_ref,
        'operation', 'STORY_START',
        'chapter_number', 1
      );
    else
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_MISSING',
        'ref', v_canonical_ref,
        'operation', 'CHAPTER_UNLOCK',
        'chapter_number', v_chapter_number
      );
    end if;
  end if;
  
  -- Check reservation amount before processing
  if v_story_binding_exists then
    -- STORY_START: validate amount matches canonical price
    if coalesce(v_reservation_record.amount, 0) != constant_story_start_amount then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_AMOUNT_MISMATCH',
        'ref', v_canonical_ref,
        'operation', 'STORY_START',
        'expected_amount', constant_story_start_amount,
        'actual_amount', v_reservation_record.amount
      );
    end if;
  elsif v_intent_binding_exists then
    -- CHAPTER_UNLOCK: validate amount matches intent.quoted_credits
    if coalesce(v_reservation_record.amount, 0) != v_binding_record.quoted_credits then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_AMOUNT_MISMATCH',
        'ref', v_canonical_ref,
        'operation', 'CHAPTER_UNLOCK',
        'chapter_number', v_chapter_number,
        'expected_amount', v_binding_record.quoted_credits,
        'actual_amount', v_reservation_record.amount
      );
    end if;
  end if;
  
  -- Check reservation status
  case v_reservation_record.status
    when 'ACTIVE' then
      -- Release ACTIVE -> RELEASED
      
      update public.credit_reservations
      set status = 'RELEASED',
          updated_at = v_now
      where id = v_reservation_record.id;
      
      -- If CHAPTER_UNLOCK, transition intent to WAITING_FOR_CREDITS
      if v_intent_binding_exists then
        update public.commercial_generation_intents
        set status = 'WAITING_FOR_CREDITS'
        where user_id = v_user_id
          and story_id = v_story_id
          and chapter_number = v_chapter_number
          and generation_job_id = v_job_id
          and status = 'QUEUED';
        
        return pg_catalog.jsonb_build_object(
          'ok', true,
          'outcome', 'RELEASED',
          'operation', 'CHAPTER_UNLOCK',
          'ref', v_canonical_ref,
          'chapter_number', v_chapter_number,
          'intent_reset', 'WAITING_FOR_CREDITS',
          'previous_status', v_reservation_record.status,
          'new_status', 'RELEASED'
        );
      else
        return pg_catalog.jsonb_build_object(
          'ok', true,
          'outcome', 'RELEASED',
          'operation', 'STORY_START',
          'ref', v_canonical_ref,
          'previous_status', v_reservation_record.status,
          'new_status', 'RELEASED'
        );
      end if;
      
    when 'RELEASED' then
      -- Already released: idempotent success
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'outcome', 'ALREADY_RELEASED',
        'ref', v_canonical_ref,
        'status', 'RELEASED'
      );
      
    when 'EXPIRED' then
      -- Expired: not a release, just report non-active state
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'outcome', 'ALREADY_NON_ACTIVE',
        'ref', v_canonical_ref,
        'status', 'EXPIRED'
      );
      
    when 'CAPTURED' then
      -- ALREADY FINISHED: invariant violation
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'CAPTURED_INVARIANT_VIOLATION',
        'ref', v_canonical_ref,
        'status', 'CAPTURED'
      );
      
    else
      -- Unknown/other state: fail closed
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'UNKNOWN_RESERVATION_STATE',
        'ref', v_canonical_ref,
        'status', v_reservation_record.status
      );
  end case;
  
exception when others then
  -- Let unexpected DB errors surface normally (no catch-all rewriting)
  raise;
end;
$$;

-- Grant execute to service_role only
revoke all on function public.finalize_terminal_commercial_generation_v1(uuid) from public, anon, authenticated;
grant execute on function public.finalize_terminal_commercial_generation_v1(uuid) to service_role;
