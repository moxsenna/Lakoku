-- 20260805000000_commercial_generation_intents.sql
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
  chapter_number integer not null check (chapter_number > 0),
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

-- 3. Transition RPC for Intent State Machine
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
  v_valid_transition boolean := false;
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
    return jsonb_build_object('ok', true, 'replayed', true, 'status', v_intent.status);
  end if;

  -- Enforce transition matrix
  if v_intent.status = 'WAITING_FOR_CREDITS' and p_target_status in ('AUTHORIZED', 'FAILED') then
    v_valid_transition := true;
  elsif v_intent.status = 'AUTHORIZED' and p_target_status in ('QUEUED', 'WAITING_FOR_CREDITS') then
    v_valid_transition := true;
  elsif v_intent.status = 'QUEUED' and p_target_status in ('FULFILLED', 'WAITING_FOR_CREDITS', 'FAILED') then
    v_valid_transition := true;
  end if;

  if not v_valid_transition then
    raise exception using errcode = 'P0001', message = 'INVALID_INTENT_TRANSITION';
  end if;

  update public.commercial_generation_intents
  set status = p_target_status,
      generation_job_id = coalesce(p_generation_job_id, generation_job_id),
      updated_at = clock_timestamp()
  where id = v_intent.id;

  return jsonb_build_object('ok', true, 'replayed', false, 'status', p_target_status);
end;
$$;

revoke all on function public.transition_commercial_generation_intent_v1(uuid, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.transition_commercial_generation_intent_v1(uuid, text, integer, text, uuid) to service_role;

-- 4. apply_personalized_choice_v2 RPC
create or replace function public.apply_personalized_choice_v2(
  p_user_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_choice_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_story public.stories%rowtype;
  v_reader public.reader_states%rowtype;
  v_outcome jsonb;
  v_next_chapter integer;
  v_choice_label text := p_choice_id;
  v_new_history jsonb;
  v_existing_intent public.commercial_generation_intents%rowtype;
  v_quoted_credits integer;
  v_pricing_version text;
  v_requires_commercial boolean := false;
  v_is_commercial_mode boolean := false;
  v_outcome_row record;
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_USER';
  end if;
  if p_story_id is null or p_story_id = '' then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;
  if p_chapter_number is null or p_chapter_number < 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_CHAPTER';
  end if;
  if p_choice_id is null or p_choice_id = '' then
    raise exception using errcode = 'P0001', message = 'CHOICE_NOT_FOUND';
  end if;
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception using errcode = 'P0001', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- Lock story & reader state
  select * into v_story from public.stories where id = p_story_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  select * into v_reader
  from public.reader_states
  where user_id = p_user_id and story_id = p_story_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'READER_STATE_MISSING';
  end if;

  -- Verify chapter position
  if v_reader.current_chapter <> p_chapter_number then
    -- Check idempotency replay on existing history
    if v_reader.current_chapter > p_chapter_number then
      select elem->'outcome' into v_outcome
      from jsonb_array_elements(v_reader.choice_history) elem
      where (elem->>'chapterNumber')::integer = p_chapter_number
        and elem->>'choiceId' = p_choice_id;
      if v_outcome is not null then
        return jsonb_build_object(
          'ok', true,
          'replayed', true,
          'outcome', v_outcome,
          'nextChapterNumber', v_reader.current_chapter
        );
      end if;
    end if;
    raise exception using errcode = 'P0001', message = 'POSITION_CONFLICT';
  end if;

  -- Resolve outcome from choice_outcomes table
  select consequence, next_chapter_number, is_ending, effect_json, choice_kind
  into v_outcome_row
  from public.choice_outcomes
  where story_id = p_story_id
    and chapter_number = p_chapter_number
    and choice_id = p_choice_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'CHOICE_NOT_FOUND';
  end if;

  v_outcome := jsonb_build_object(
    'consequence', v_outcome_row.consequence,
    'nextChapterNumber', v_outcome_row.next_chapter_number,
    'isEnding', v_outcome_row.is_ending,
    'effect', v_outcome_row.effect_json,
    'choiceKind', v_outcome_row.choice_kind
  );
  v_next_chapter := v_outcome_row.next_chapter_number;

  -- Read choice label if available
  select label into v_choice_label
  from (
    select elem->>'id' as id, elem->>'label' as label
    from public.chapters c,
         jsonb_array_elements(c.choices) elem
    where c.story_id = p_story_id and c.number = p_chapter_number
  ) choices_sub
  where id = p_choice_id;

  if v_choice_label is null then
    v_choice_label := p_choice_id;
  end if;

  -- Apply choice state to reader_states
  v_new_history := coalesce(v_reader.choice_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'chapterNumber', p_chapter_number,
      'choiceId', p_choice_id,
      'decision', v_choice_label,
      'outcome', v_outcome,
      'submittedAt', clock_timestamp()
    )
  );

  update public.reader_states
  set current_chapter = coalesce(v_next_chapter, current_chapter),
      choice_history = v_new_history,
      status = case when v_outcome_row.is_ending then 'SELESAI' else status end,
      updated_at = clock_timestamp()
  where user_id = p_user_id and story_id = p_story_id;

  -- Determine commercial authorization requirement for target next chapter
  v_is_commercial_mode := v_story.story_mode in ('personalized_ai', 'premium_instance')
                       and v_story.owner_user_id = p_user_id;

  if v_is_commercial_mode and v_next_chapter is not null and v_next_chapter >= 4 and not v_outcome_row.is_ending then
    v_requires_commercial := true;
  end if;

  -- Handle commercial generation intent for Bab 4+
  if v_requires_commercial then
    select credits_required, pricing_version
    into v_quoted_credits, v_pricing_version
    from public.feature_credit_costs
    where feature_key = 'chapter_unlock';

    v_quoted_credits := coalesce(v_quoted_credits, 8);
    v_pricing_version := coalesce(v_pricing_version, 'v1.1-202608');

    select * into v_existing_intent
    from public.commercial_generation_intents
    where user_id = p_user_id
      and story_id = p_story_id
      and chapter_number = v_next_chapter
    for update;

    if found then
      if v_existing_intent.trigger_choice_id <> p_choice_id then
        raise exception using errcode = 'P0001', message = 'COMMERCIAL_INTENT_CONFLICT';
      end if;
    else
      insert into public.commercial_generation_intents (
        user_id,
        story_id,
        chapter_number,
        trigger_choice_id,
        status,
        quoted_credits,
        pricing_version
      ) values (
        p_user_id,
        p_story_id,
        v_next_chapter,
        p_choice_id,
        'WAITING_FOR_CREDITS',
        v_quoted_credits,
        v_pricing_version
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'outcome', v_outcome,
    'nextChapterNumber', v_next_chapter
  );
end;
$$;

revoke all on function public.apply_personalized_choice_v2(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.apply_personalized_choice_v2(uuid, text, integer, text, text) to service_role;
