-- Terminal Commercial Finalization - Forward Repair Migration
-- 
-- R4: Corrected Canonical Implementation (Forward Repair from Applied History)
--
-- PURPOSE: Install corrected finalizer/discovery implementations as forward repair
-- NOTE: Do NOT modify 00000/00001 in-place; this migration supersedes applied versions
--
-- KEY FIXES IN THIS REPAIR:
--   1. Exact job.id binding via story_creation_requests.generation_job_id FK
--   2. Proper U->S->M->BINDING->Q lock ordering (story FOR SHARE, not hash)
--   3. Reservation amount validation against canonical price / intent.quoted_credits
--   4. Explicit state outcomes (EXPIRED != ALREADY_RELEASED)
--   5. No catch-all exception handler (raise; surfaces DB errors normally)
--   6. Provenance conflict detection (XOR exactly one binding)
--   7. NO_COMMERCIAL_BINDING outcome for plain jobs without financial obligation

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
  
  -- Reservation existence flags (must capture FOUND state explicitly)
  v_story_reservation_found boolean;
  v_chapter_reservation_found boolean;
  
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
    
    -- Capture FOUND state BEFORE binding SELECT
    v_story_reservation_found := found;
    
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
    
    -- Check reservation existence AFTER both SELECTs complete
    if not v_story_reservation_found then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_MISSING',
        'ref', v_canonical_ref,
        'operation', 'STORY_START',
        'chapter_number', 1
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
    
    raise notice 'DEBUG Reservation found=%, status=%', found, v_reservation_record.status;
    
    -- Capture FOUND state BEFORE binding SELECT
    v_chapter_reservation_found := found;
    
    -- 4) Revalidate binding under lock with trigger_choice_id check (only if present)
    -- When v_trigger_choice_id is NULL (job has no trigger), match ANY intent trigger value
    select cgi.* into v_binding_record
    from public.commercial_generation_intents cgi
    where cgi.generation_job_id = v_job_id
      and cgi.user_id = v_user_id
      and cgi.story_id = v_story_id
      and cgi.chapter_number = v_chapter_number
      and (v_trigger_choice_id is null or cgi.trigger_choice_id = v_trigger_choice_id)
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
    
    -- Check reservation existence AFTER both SELECTs complete
    if not v_chapter_reservation_found then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_MISSING',
        'ref', v_canonical_ref,
        'operation', 'CHAPTER_UNLOCK',
        'chapter_number', v_chapter_number
      );
    end if;
  end if;
  
  -- ===========================================================================
  -- PHASE Q: Last-row lock + FULL REVALIDATION (MUST BE LAST BEFORE MUTATIONS)
  -- ===========================================================================
  declare
    v_q_story_id text;
    v_q_owner_user_id uuid;
  begin
    select s.id, s.owner_user_id 
    into v_q_story_id, v_q_owner_user_id
    from public.generation_jobs gj
    join public.stories s on s.id = gj.story_id and s.owner_user_id = gj.user_id
    where gj.id = v_job_id
    for update;
  
    if not found then
      return pg_catalog.jsonb_build_object('ok', false, 'reason', 'JOB_NOT_FOUND', 'operation', 'Q_LOCK');
    end if;
    
    -- Revalidate ownership and identity under Q lock
    if v_q_owner_user_id IS DISTINCT FROM v_user_id then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'REVALIDATION_USER_MISMATCH',
        'stored_user_id', v_q_owner_user_id::text,
        'expected_user_id', v_user_id::text
      );
    end if;
    
    if v_q_story_id IS DISTINCT FROM v_story_id then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'REVALIDATION_STORY_MISMATCH',
        'stored_story_id', v_q_story_id,
        'expected_story_id', v_story_id
      );
    end if;
  end;
  
  
  -- Check reservation existence FIRST before any amount/status operations
  
  if v_story_binding_exists and not v_story_reservation_found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'RESERVATION_MISSING',
      'ref', v_canonical_ref,
      'operation', 'STORY_START',
      'chapter_number', 1
    );
  elsif v_intent_binding_exists and not v_chapter_reservation_found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'reason', 'RESERVATION_MISSING',
      'ref', v_canonical_ref,
      'operation', 'CHAPTER_UNLOCK',
      'chapter_number', v_chapter_number
    );
  end if;
  
  -- Check reservation amount before processing
  if v_story_binding_exists and v_story_reservation_found then
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
  elsif v_intent_binding_exists and v_chapter_reservation_found then
    -- CHAPTER_UNLOCK: validate amount matches intent.quoted_credits
    -- Ensure quoted_credits is not NULL before comparison
    if v_binding_record.quoted_credits is null then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'reason', 'RESERVATION_AMOUNT_MISMATCH',
        'ref', v_canonical_ref,
        'operation', 'CHAPTER_UNLOCK',
        'chapter_number', v_chapter_number,
        'expected_amount', 'INTENT_QUOTES_NULL',
        'actual_amount', v_reservation_record.amount
      );
    end if;
    
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
  
  -- Verify reservation status exists before switching
  if v_reservation_record.status is null then
    raise exception 'reservation_record is NULL after validation';
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

-- Discovery RPC - Candidate finder for recovery tick
create or replace function public.list_terminal_commercial_finalization_candidates_v1(
  p_batch_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results jsonb := '[]'::jsonb;
  
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 200 then
    return pg_catalog.jsonb_build_object('candidates', v_results, 'count', 0);
  end if;
  
  -- Discover terminal jobs with matching ACTIVE reservations
  -- Uses SKIP LOCKED for safe concurrent discovery
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'job_id', candidates.job_id,
      'user_id', candidates.user_id,
      'story_id', candidates.story_id,
      'chapter_number', candidates.chapter_number,
      'generation_kind', candidates.generation_kind,
      'trigger_choice_id', candidates.trigger_choice_id,
      'updated_at', candidates.updated_at
    )
  ) into v_results
  from (
    select gj.id AS job_id, gj.user_id AS user_id, gj.story_id AS story_id,
           gj.chapter_number AS chapter_number, gj.generation_kind AS generation_kind,
           gj.trigger_choice_id AS trigger_choice_id, gj.updated_at AS updated_at
    from public.generation_jobs gj
    where gj.status in ('FAILED', 'CANCELLED')
      and gj.attempt_count >= gj.max_attempts
      and exists (
        select 1 from public.credit_reservations r
        where r.user_id = gj.user_id
          and r.story_id = gj.story_id
          and r.chapter_number = gj.chapter_number
          and r.status = 'ACTIVE'
          and (
            -- STORY_START pattern: chapter=1, ref format, requires SCR binding
            (r.reservation_kind = 'STORY_START'
              and r.chapter_number = 1
              and r.ref like 'story-start:%%'
              and gj.chapter_number = 1
              and exists (
                select 1 from public.story_creation_requests scr
                where scr.generation_job_id = gj.id
                  and scr.owner_user_id = gj.user_id
                  and scr.story_id = gj.story_id
                  and scr.request_kind = 'personalized'
              )
            )
            or
            -- CHAPTER_UNLOCK pattern requires exact binding validation
            (r.reservation_kind = 'CHAPTER_UNLOCK'
              and r.chapter_number = gj.chapter_number
              and exists (
                select 1 from public.commercial_generation_intents cgi
                where cgi.generation_job_id = gj.id
                  and cgi.user_id = gj.user_id
                  and cgi.story_id = gj.story_id
                  and cgi.chapter_number = gj.chapter_number
              )
            )
          )
        )
    ) candidates
    order by gj.updated_at asc
    limit p_batch_size
    for update skip locked;
  
  return pg_catalog.jsonb_build_object(
    'candidates', coalesce(v_results, '[]'::jsonb),
    'count', coalesce(pg_catalog.jsonb_array_length(v_results), 0)
  );
end;
$$;

-- Grant execute to service_role only
revoke all on function public.list_terminal_commercial_finalization_candidates_v1(integer) from public, anon, authenticated;
grant execute on function public.list_terminal_commercial_finalization_candidates_v1(integer) to service_role;

-- Note: Migration history tracking uses supabase db push automatic tracking
-- The forward repair supersedes migrations 00000/00001 via CREATE OR REPLACE FUNCTION
