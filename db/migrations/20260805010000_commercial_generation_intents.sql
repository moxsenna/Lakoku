-- 20260805010000_commercial_generation_intents.sql
-- Durable state machine for commercial generation intents & story creation requests.

-- 1. Extend story_creation_requests status check
alter table public.story_creation_requests
  drop constraint if exists story_creation_requests_status_check;

alter table public.story_creation_requests
  add constraint story_creation_requests_status_check
  check (status in ('RESERVED', 'READY', 'FAILED', 'WAITING_FOR_CREDITS'));

-- 2. Commercial generation intents table
create table if not exists public.commercial_generation_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  story_id text not null references public.stories(id) on delete cascade,
  chapter_number integer not null check (chapter_number >= 4),
  trigger_choice_id text not null,
  generation_job_id uuid null references public.generation_jobs(id) on delete set null,
  status text not null check (status in ('WAITING_FOR_CREDITS', 'AUTHORIZED', 'QUEUED', 'FULFILLED', 'FAILED')),
  quoted_credits integer not null,
  pricing_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, story_id, chapter_number)
);

create unique index if not exists commercial_gen_job_idx
  on public.commercial_generation_intents(generation_job_id)
  where generation_job_id is not null;

create index if not exists commercial_gen_user_story_idx
  on public.commercial_generation_intents(user_id, story_id, status);

alter table public.commercial_generation_intents enable row level security;
revoke all on table public.commercial_generation_intents from public, anon, authenticated;
grant all on table public.commercial_generation_intents to service_role;

-- 3. Ensure Intent RPC (Fail-Closed Validation & Atomicity)
create or replace function public.ensure_commercial_generation_intent_v1(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_trigger_choice_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_story public.stories%rowtype;
  v_quoted_credits integer;
  v_pricing_version text;
  v_is_active boolean;
  v_intent public.commercial_generation_intents%rowtype;
begin
  if p_user_id is null or p_story_id is null or p_chapter_number is null or p_trigger_choice_id is null then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  if p_chapter_number < 4 then
    raise exception using errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  end if;

  if length(trim(p_trigger_choice_id)) = 0 or length(p_trigger_choice_id) > 120 then
    raise exception using errcode = '22023', message = 'INVALID_TRIGGER_CHOICE';
  end if;

  select * into v_story from public.stories where id = p_story_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if v_story.owner_user_id <> p_user_id then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_OWNER';
  end if;

  if v_story.visibility not in ('private', 'unlisted') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_VISIBILITY';
  end if;

  if v_story.story_mode not in ('personalized_ai', 'premium_instance') then
    raise exception using errcode = 'P0001', message = 'INVALID_STORY_MODE';
  end if;

  if v_story.commercial_origin not in ('STARTER_FREE', 'PAID_START', 'LEGACY_GRANDFATHERED') then
    raise exception using errcode = 'P0001', message = 'INVALID_COMMERCIAL_ORIGIN';
  end if;

  -- Require active DB price config with zero fallbacks
  select credits_required, pricing_version, is_active
  into v_quoted_credits, v_pricing_version, v_is_active
  from public.feature_credit_costs
  where feature_key = 'chapter_unlock';

  if not found or v_is_active is not true or v_quoted_credits is null or v_quoted_credits <= 0 or v_pricing_version is null or v_pricing_version = '' then
    raise exception using errcode = 'P0001', message = 'CONFIG_ERROR';
  end if;

  select * into v_intent
  from public.commercial_generation_intents
  where user_id = p_user_id
    and story_id = p_story_id
    and chapter_number = p_chapter_number
  for update;

  if found then
    if v_intent.trigger_choice_id <> p_trigger_choice_id then
      raise exception using errcode = 'P0001', message = 'COMMERCIAL_INTENT_CONFLICT';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'status', v_intent.status);
  end if;

  insert into public.commercial_generation_intents (
    user_id, story_id, chapter_number, trigger_choice_id, status, quoted_credits, pricing_version
  ) values (
    p_user_id, p_story_id, p_chapter_number, p_trigger_choice_id, 'WAITING_FOR_CREDITS', v_quoted_credits, v_pricing_version
  );

  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'WAITING_FOR_CREDITS');
end;
$$;

revoke all on function public.ensure_commercial_generation_intent_v1(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.ensure_commercial_generation_intent_v1(uuid, text, integer, text) to service_role;

-- 4. Transition RPC for Intent State Machine
create or replace function public.transition_commercial_generation_intent_v1(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_target_status text,
  p_generation_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_intent public.commercial_generation_intents%rowtype;
  v_job public.generation_jobs%rowtype;
  v_valid_transition boolean := false;
  v_new_job_id uuid;
begin
  if p_target_status not in ('WAITING_FOR_CREDITS', 'AUTHORIZED', 'QUEUED', 'FULFILLED', 'FAILED') then
    raise exception using errcode = '22023', message = 'INVALID_TARGET_STATUS';
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

  -- Idempotent same-state check
  if v_intent.status = p_target_status then
    if p_target_status = 'QUEUED' then
      if p_generation_job_id is null or v_intent.generation_job_id is null or v_intent.generation_job_id <> p_generation_job_id then
        raise exception using errcode = 'P0001', message = 'INTENT_JOB_CONFLICT';
      end if;
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'status', v_intent.status);
  end if;

  -- Enforce job binding rules per transition
  if v_intent.status = 'WAITING_FOR_CREDITS' and p_target_status = 'AUTHORIZED' then
    if p_generation_job_id is not null then
      raise exception using errcode = 'P0001', message = 'INVALID_INTENT_TRANSITION';
    end if;
    v_valid_transition := true;
    v_new_job_id := null;

  elsif v_intent.status = 'AUTHORIZED' and p_target_status = 'QUEUED' then
    if p_generation_job_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INTENT_TRANSITION';
    end if;

    select * into v_job from public.generation_jobs where id = p_generation_job_id;
    if not found or v_job.user_id <> p_user_id or v_job.story_id <> p_story_id or v_job.chapter_number <> p_chapter_number or v_job.trigger_choice_id <> v_intent.trigger_choice_id then
      raise exception using errcode = 'P0001', message = 'INTENT_JOB_MISMATCH';
    end if;

    v_valid_transition := true;
    v_new_job_id := p_generation_job_id;

  elsif v_intent.status = 'AUTHORIZED' and p_target_status = 'WAITING_FOR_CREDITS' then
    if p_generation_job_id is not null then
      raise exception using errcode = 'P0001', message = 'INVALID_INTENT_TRANSITION';
    end if;
    v_valid_transition := true;
    v_new_job_id := null;

  elsif v_intent.status = 'WAITING_FOR_CREDITS' and p_target_status = 'FAILED' then
    if p_generation_job_id is not null then
      raise exception using errcode = 'P0001', message = 'INVALID_INTENT_TRANSITION';
    end if;
    v_valid_transition := true;
    v_new_job_id := null;

  elsif v_intent.status = 'QUEUED' and p_target_status in ('FULFILLED', 'WAITING_FOR_CREDITS', 'FAILED') then
    if p_generation_job_id is not null and p_generation_job_id <> v_intent.generation_job_id then
      raise exception using errcode = 'P0001', message = 'INTENT_JOB_CONFLICT';
    end if;
    v_valid_transition := true;
    v_new_job_id := v_intent.generation_job_id;
  end if;

  if not v_valid_transition then
    raise exception using errcode = 'P0001', message = 'INVALID_INTENT_TRANSITION';
  end if;

  update public.commercial_generation_intents
  set status = p_target_status,
      generation_job_id = v_new_job_id,
      updated_at = clock_timestamp()
  where id = v_intent.id;

  return jsonb_build_object('ok', true, 'replayed', false, 'status', p_target_status);
end;
$$;

revoke all on function public.transition_commercial_generation_intent_v1(uuid, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.transition_commercial_generation_intent_v1(uuid, text, integer, text, uuid) to service_role;

-- 5. Additive apply_personalized_choice_v2 RPC
create or replace function public.apply_personalized_choice_v2(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_choice_id text,
  p_idempotency_key text,
  p_expected_state jsonb,
  p_next_route_state jsonb,
  p_history_entry jsonb,
  p_jejak_entry jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
  v_story public.stories%rowtype;
  v_next_chapter integer;
  v_is_ending boolean := false;
  v_is_commercial_mode boolean := false;
begin
  -- 1. Delegate to exact existing choice logic for full semantic preservation
  v_res := public.apply_personalized_choice(
    p_user_id,
    p_story_id,
    p_chapter_number,
    p_choice_id,
    p_idempotency_key,
    p_expected_state,
    p_next_route_state,
    p_history_entry,
    p_jejak_entry
  );

  v_next_chapter := (v_res->'outcome'->>'nextChapterNumber')::integer;
  v_is_ending := coalesce((v_res->'outcome'->>'isEnding')::boolean, false);

  -- 2. Lock story to check commercial mode
  select * into v_story
  from public.stories
  where id = p_story_id;

  v_is_commercial_mode := v_story.story_mode in ('personalized_ai', 'premium_instance')
                       and v_story.owner_user_id = p_user_id;

  -- 3. If target chapter >= 4 and commercial mode, atomically create/verify intent
  if v_is_commercial_mode and v_next_chapter is not null and v_next_chapter >= 4 and not v_is_ending then
    perform public.ensure_commercial_generation_intent_v1(
      p_user_id,
      p_story_id,
      v_next_chapter,
      p_choice_id
    );
  end if;

  return v_res;
end;
$$;

revoke all on function public.apply_personalized_choice_v2(uuid, text, integer, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_personalized_choice_v2(uuid, text, integer, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
