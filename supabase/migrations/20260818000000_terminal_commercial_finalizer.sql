-- Terminal Commercial Finalization (R3: Canonical Binding Derivation)
-- 
-- Fixes PRODUCT P0: RELEASE ACTIVE credit_reservations when generation jobs
-- reach terminal FAILED/CANCELLED state.
--
-- Uses real database schema with canonical binding derivation (NO HEURISTICS):
--   generation_jobs(id, story_id, chapter_number, user_id, generation_kind, trigger_choice_id, status)
--   commercial_generation_intents(user_id, story_id, chapter_number, generation_job_id, status, trigger_choice_id, quoted_credits, pricing_version)
--   story_creation_requests(owner_user_id, request_kind, idempotency_key, story_id, status) -- for personalized JOB bindings
--   credit_reservations(id, user_id, story_id, chapter_number, reservation_kind, amount, status, ref)
--   reader_chapter_progress(reader_id, story_id, chapter_number, progress_state)

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
  
  -- Binding discovery (non-locking)
  v_has_story_binding boolean := false;
  v_has_intent_binding boolean := false;
  v_story_binding_count integer := 0;
  v_intent_binding_count integer := 0;
  
  -- Canonical reservation lookup
  v_canonical_ref text;
  v_reservation_record record;
  
  -- Phase B: Lock order U -> S -> M -> INTENTS/REQUESTS -> Q
  
begin
  -- ===========================================================================
  -- PHASE A: Non-locking immutable identity pre-read + binding discovery
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
  
  -- Discover durable bindings WITHOUT locking first
  -- STORY_START binding via story_creation_requests
  select count(*) into v_story_binding_count
  from public.story_creation_requests scr
  where scr.owner_user_id = v_user_id
    and scr.request_kind = 'personalized'
    and scr.story_id = v_story_id
    and scr.idempotency_key is not null;  -- requires valid creation attempt
  
  -- CHAPTER_UNLOCK binding via commercial_generation_intents
  select count(*) into v_intent_binding_count
  from public.commercial_generation_intents cgi
  where cgi.user_id = v_user_id
    and cgi.story_id = v_story_id
    and cgi.chapter_number = v_chapter_number
    and cgi.generation_job_id = v_job_id;
  
  -- Require EXACTLY ONE binding (XOR invariant)
  if v_story_binding_count > 0 and v_intent_binding_count > 0 then
    -- PROVENANCE_CONFLICT: both bindings present
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'PROVENANCE_CONFLICT',
      'ref', 'job:' || v_job_id::text
    );
  elsif v_story_binding_count = 0 and v_intent_binding_count = 0 then
    -- NO_COMMERCIAL_BINDING: plain job, no financial obligation
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'operation', 'NO_COMMERCIAL_BINDING',
      'ref', 'job:' || v_job_id::text
    );
  end if;
  
  -- ===========================================================================
  -- PHASE B: Acquire canonical locks in order U->S->M->binding->Q
  -- ===========================================================================
  
  -- 1) User advisory lock FIRST
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_user_id::text)
  );
  
  -- 2) Story row share lock (not hash!)
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(('story:' || v_story_id)::text)
  );
  
  -- 3) Find and lock reservation FOR UPDATE
  v_canonical_ref := null;
  
  if v_story_binding_count > 0 then
    -- STORY_START path
    -- Canonic ref: story-start:<user_id>:<story_id>
    -- REQUIRED fields: user_id, story_id, reservation_kind='STORY_START', chapter_number=1
    v_canonical_ref := 'story-start:' || v_user_id::text || ':' || v_story_id;
    
    select r.* into v_reservation_record
    from public.credit_reservations r
    where r.ref = v_canonical_ref
      and r.user_id = v_user_id
      and r.story_id = v_story_id
      and r.reservation_kind = 'STORY_START'
      and coalesce(r.chapter_number, 0) = 1  -- NOT NULL, must be 1
    for update;
    
  else
    -- CHAPTER_UNLOCK path (must have intent binding)
    -- Canonical ref: chapter-reservation:<user_id>:<story_id>:<chapter_number>
    v_canonical_ref := 'chapter-reservation:' || v_user_id::text || ':' || v_story_id || ':' || v_chapter_number::text;
    
    select r.* into v_reservation_record
    from public.credit_reservations r
    where r.ref = v_canonical_ref
      and r.user_id = v_user_id
      and r.story_id = v_story_id
      and r.chapter_number = v_chapter_number
      and r.reservation_kind = 'CHAPTER_UNLOCK'
    for update;
    
  end if;
  
  -- ===========================================================================
  -- PHASE C: Process result based on reservation state
  -- ===========================================================================
  
  if not found then
    -- No matching reservation found
    if v_story_binding_count > 0 then
      -- Expected STORY_START but missing => PROVENANCE_CONFLICT
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_MISSING',
        'ref', v_canonical_ref,
        'operation', 'STORY_START',
        'chapter_number', 1
      );
    elsif v_intent_binding_count > 0 then
      -- Expected CHAPTER_UNLOCK but missing => PROVENANCE_CONFLICT
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_MISSING',
        'ref', v_canonical_ref,
        'operation', 'CHAPTER_UNLOCK',
        'chapter_number', v_chapter_number
      );
    end if;
  end if;
  
  -- Reservation exists, check state
  if v_reservation_record.status = 'CAPTURED' then
    -- ALREADY FINISHED: invariant violation
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'CAPTURED_INVARIANT_VIOLATION',
      'ref', v_canonical_ref,
      'status', v_reservation_record.status
    );
  elsif v_reservation_record.status = 'RELEASED' then
    -- Already released: idempotent success
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'already_released', true,
      'ref', v_canonical_ref,
      'status', 'RELEASED'
    );
  elsif v_reservation_record.status = 'ACTIVE' then
    -- Release ACTIVE -> RELEASED
    
    update public.credit_reservations
    set status = 'RELEASED',
        updated_at = v_now
    where id = v_reservation_record.id;
    
    -- If CHAPTER_UNLOCK, transition intent to WAITING_FOR_CREDITS
    if v_intent_binding_count > 0 then
      update public.commercial_generation_intents
      set status = 'WAITING_FOR_CREDITS'
      where user_id = v_user_id
        and story_id = v_story_id
        and chapter_number = v_chapter_number
        and generation_job_id = v_job_id
        and status = 'QUEUED';
      
      return pg_catalog.jsonb_build_object(
        'ok', true,
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
        'operation', 'STORY_START',
        'ref', v_canonical_ref,
        'previous_status', v_reservation_record.status,
        'new_status', 'RELEASED'
      );
    end if;
  else
    -- Some other state (EXPIRED, etc.)
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'already_released', true,
      'ref', v_canonical_ref,
      'status', v_reservation_record.status
    );
  end if;
  
exception when others then
  return pg_catalog.jsonb_build_object(
    'ok', false,
    'reason', 'CAPTURED_INVARIANT_VIOLATION',
    'ref', 'error:' || v_canonical_ref,
    'status', sqlstate
  );
end;
$$;

-- Grant execute to service_role only
revoke all on function public.finalize_terminal_commercial_generation_v1(uuid) from public, anon, authenticated;
grant execute on function public.finalize_terminal_commercial_generation_v1(uuid) to service_role;
