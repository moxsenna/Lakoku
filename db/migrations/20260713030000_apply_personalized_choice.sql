-- Atomically apply owned personalized story choices with replay-safe public outcomes.

create table if not exists public.personalized_choice_applications (
  user_id uuid not null references auth.users(id) on delete cascade,
  story_id text not null references public.stories(id) on delete cascade,
  chapter_number integer not null check (chapter_number between 1 and 49),
  choice_id text not null,
  outcome_snapshot jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, story_id, chapter_number),
  constraint personalized_choice_applications_reader_state_fkey
    foreign key (user_id, story_id)
    references public.reader_states(user_id, story_id)
    on delete cascade
);

create table if not exists public.personalized_choice_idempotency_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 240),
  story_id text not null,
  chapter_number integer not null check (chapter_number between 1 and 49),
  choice_id text not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, idempotency_key),
  constraint personalized_choice_idempotency_keys_application_fkey
    foreign key (user_id, story_id, chapter_number)
    references public.personalized_choice_applications(user_id, story_id, chapter_number)
    on delete cascade
);

alter table public.personalized_choice_applications enable row level security;
alter table public.personalized_choice_idempotency_keys enable row level security;
revoke all on table public.personalized_choice_applications from public, anon, authenticated;
revoke all on table public.personalized_choice_idempotency_keys from public, anon, authenticated;
grant select, insert on table public.personalized_choice_applications to service_role;
grant select, insert on table public.personalized_choice_idempotency_keys to service_role;

create or replace function public.apply_personalized_choice(
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
  v_state public.reader_states%rowtype;
  v_story_id public.stories.id%type;
  v_existing_key public.personalized_choice_idempotency_keys%rowtype;
  v_existing_application public.personalized_choice_applications%rowtype;
  v_outcome public.choice_outcomes%rowtype;
  v_label text;
  v_expected_state jsonb;
  v_supplied_expected_state jsonb;
  v_outcome_snapshot jsonb;
  v_calculated_route jsonb;
  v_expected_effect_summary jsonb;
  v_canonical_history_entry jsonb;
  v_canonical_jejak_entry jsonb;
  v_key text;
  v_value jsonb;
  v_progress integer;
  v_status text;
  v_ending_name text;
begin
  if p_user_id is null
    or p_story_id is null or pg_catalog.length(p_story_id) = 0
    or p_chapter_number not between 1 and 49
    or p_choice_id is null or pg_catalog.length(p_choice_id) = 0
    or p_idempotency_key is null or pg_catalog.length(p_idempotency_key) not between 1 and 240
    or pg_catalog.jsonb_typeof(p_expected_state) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_next_route_state) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_history_entry) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_jejak_entry) is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'INVALID_PERSONALIZED_CHOICE_INPUT';
  end if;

  select s.id
  into v_story_id
  from public.stories s
  where s.id = p_story_id
    and s.owner_user_id = p_user_id
    and s.visibility = 'private'
    and s.story_mode in ('personalized_ai', 'premium_instance')
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_idempotency_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_story_id || ':' || p_chapter_number::text,
      190713
    )
  );

  select rs.*
  into v_state
  from public.reader_states rs
  where rs.user_id = p_user_id
    and rs.story_id = p_story_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'READER_STATE_MISSING';
  end if;

  select k.*
  into v_existing_key
  from public.personalized_choice_idempotency_keys k
  where k.user_id = p_user_id
    and k.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_key.story_id = p_story_id
      and v_existing_key.chapter_number = p_chapter_number
      and v_existing_key.choice_id = p_choice_id
    then
      select a.*
      into strict v_existing_application
      from public.personalized_choice_applications a
      where a.user_id = v_existing_key.user_id
        and a.story_id = v_existing_key.story_id
        and a.chapter_number = v_existing_key.chapter_number;
      return pg_catalog.jsonb_build_object(
        'outcome', v_existing_application.outcome_snapshot,
        'nextChapterNumber', v_existing_application.outcome_snapshot->'nextChapterNumber',
        'replayed', true
      );
    end if;
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_COLLISION';
  end if;

  select a.*
  into v_existing_application
  from public.personalized_choice_applications a
  where a.user_id = p_user_id
    and a.story_id = p_story_id
    and a.chapter_number = p_chapter_number;

  if found then
    if v_existing_application.choice_id = p_choice_id then
      insert into public.personalized_choice_idempotency_keys (
        user_id, idempotency_key, story_id, chapter_number, choice_id
      ) values (
        p_user_id, p_idempotency_key, p_story_id, p_chapter_number, p_choice_id
      );
      return pg_catalog.jsonb_build_object(
        'outcome', v_existing_application.outcome_snapshot,
        'nextChapterNumber', v_existing_application.outcome_snapshot->'nextChapterNumber',
        'replayed', true
      );
    end if;
    raise exception using errcode = 'P0001', message = 'CHOICE_CONFLICT';
  end if;

  if v_state.current_chapter <> p_chapter_number then
    raise exception using errcode = 'P0001', message = 'POSITION_CONFLICT';
  end if;

  v_expected_state := pg_catalog.jsonb_build_object(
    'user_id', v_state.user_id,
    'story_id', v_state.story_id,
    'status', v_state.status,
    'current_chapter', v_state.current_chapter,
    'jejak', v_state.jejak,
    'ending_name', v_state.ending_name,
    'route_state', v_state.route_state,
    'choice_history', v_state.choice_history,
    'locked_ending_key', v_state.locked_ending_key,
    'updated_at', pg_catalog.to_jsonb(v_state.updated_at)
  );
  v_supplied_expected_state := pg_catalog.jsonb_build_object(
    'user_id', p_expected_state->'user_id',
    'story_id', p_expected_state->'story_id',
    'status', p_expected_state->'status',
    'current_chapter', p_expected_state->'current_chapter',
    'jejak', p_expected_state->'jejak',
    'ending_name', p_expected_state->'ending_name',
    'route_state', p_expected_state->'route_state',
    'choice_history', p_expected_state->'choice_history',
    'locked_ending_key', p_expected_state->'locked_ending_key',
    'updated_at', pg_catalog.to_jsonb((p_expected_state->>'updated_at')::timestamptz)
  );
  if v_expected_state is distinct from v_supplied_expected_state then
    raise exception using errcode = 'P0001', message = 'STALE_READER_STATE';
  end if;

  select o.*
  into v_outcome
  from public.choice_outcomes o
  where o.story_id = p_story_id
    and o.chapter_number = p_chapter_number
    and o.choice_id = p_choice_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'CHOICE_NOT_FOUND';
  end if;

  select choice->>'label'
  into v_label
  from public.chapters c
  cross join lateral pg_catalog.jsonb_array_elements(c.choices) choice
  where c.story_id = p_story_id
    and c.number = p_chapter_number
    and choice->>'id' = p_choice_id;
  if v_label is null then
    raise exception using errcode = 'P0001', message = 'CHOICE_NOT_FOUND';
  end if;

  v_calculated_route := v_state.route_state;
  if pg_catalog.jsonb_typeof(v_calculated_route) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.effect_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.effect_json->'routeDeltas') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.effect_json->'trustDeltas') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.effect_json->'flagsSet') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.effect_json->'evidenceAdded') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_outcome.effect_json->'endingBiasDeltas') is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'INVALID_PERSONALIZED_CHOICE_EFFECT';
  end if;

  for v_key, v_value in select key, value from pg_catalog.jsonb_each(v_outcome.effect_json->'routeDeltas') loop
    v_calculated_route := pg_catalog.jsonb_set(
      v_calculated_route,
      array[v_key],
      pg_catalog.to_jsonb(least(20, greatest(0, coalesce((v_calculated_route->>v_key)::integer, 0) + (v_value #>> '{}')::integer)))
    );
  end loop;
  for v_key, v_value in select key, value from pg_catalog.jsonb_each(v_outcome.effect_json->'trustDeltas') loop
    v_calculated_route := pg_catalog.jsonb_set(
      v_calculated_route,
      array['trust', v_key],
      pg_catalog.to_jsonb(least(10, greatest(-10, coalesce((v_calculated_route->'trust'->>v_key)::integer, 0) + (v_value #>> '{}')::integer))),
      true
    );
  end loop;
  for v_key, v_value in select key, value from pg_catalog.jsonb_each(v_outcome.effect_json->'flagsSet') loop
    v_calculated_route := pg_catalog.jsonb_set(v_calculated_route, array['flags', v_key], v_value, true);
  end loop;
  v_calculated_route := pg_catalog.jsonb_set(
    v_calculated_route,
    '{evidence}',
    coalesce((
      select pg_catalog.jsonb_agg(deduplicated.item order by deduplicated.first_position)
      from (
        select combined.item, min(combined.position) as first_position
        from (
          select current_item.value as item, current_item.ordinality as position
          from pg_catalog.jsonb_array_elements(coalesce(v_calculated_route->'evidence', '[]'::jsonb))
            with ordinality as current_item(value, ordinality)
          union all
          select added_item.value as item, 1000000 + added_item.ordinality as position
          from pg_catalog.jsonb_array_elements(coalesce(v_outcome.effect_json->'evidenceAdded', '[]'::jsonb))
            with ordinality as added_item(value, ordinality)
        ) as combined
        group by combined.item
        order by min(combined.position)
        limit 32
      ) as deduplicated
    ), '[]'::jsonb)
  );
  for v_key, v_value in select key, value from pg_catalog.jsonb_each(v_outcome.effect_json->'endingBiasDeltas') loop
    v_calculated_route := pg_catalog.jsonb_set(
      v_calculated_route,
      array['endingBias', v_key],
      pg_catalog.to_jsonb(least(100, greatest(-100, coalesce((v_calculated_route->'endingBias'->>v_key)::integer, 0) + (v_value #>> '{}')::integer))),
      true
    );
  end loop;

  v_expected_effect_summary := pg_catalog.jsonb_build_object(
    'flagsSet', coalesce((
      select pg_catalog.jsonb_agg(key order by key)
      from pg_catalog.jsonb_each(v_outcome.effect_json->'flagsSet')
      where value = 'true'::jsonb
    ), '[]'::jsonb)
  );
  for v_key, v_value in select key, value from pg_catalog.jsonb_each(v_outcome.effect_json->'routeDeltas') loop
    v_expected_effect_summary := v_expected_effect_summary || pg_catalog.jsonb_build_object(v_key, v_value);
  end loop;

  v_canonical_history_entry := pg_catalog.jsonb_build_object(
    'chapterNumber', p_chapter_number,
    'choiceId', p_choice_id,
    'label', v_label,
    'consequence', v_outcome.consequence,
    'effectSummary', v_expected_effect_summary,
    'createdAt', p_history_entry->'createdAt'
  );
  v_canonical_jejak_entry := pg_catalog.jsonb_build_object(
    'chapter', p_chapter_number,
    'decision', v_label,
    'consequence', v_outcome.consequence->>0
  );

  if p_next_route_state is distinct from v_calculated_route
    or pg_catalog.jsonb_typeof(p_history_entry->'effectSummary') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_history_entry->'consequence') is distinct from 'array'
    or p_history_entry->>'createdAt' is null
    or (p_history_entry->>'createdAt')::timestamptz is null
    or p_history_entry is distinct from v_canonical_history_entry
    or p_jejak_entry is distinct from v_canonical_jejak_entry
  then
    raise exception using errcode = '22023', message = 'INVALID_PERSONALIZED_CHOICE_SUMMARY';
  end if;

  v_outcome_snapshot := pg_catalog.jsonb_build_object(
    'storyId', v_outcome.story_id,
    'chapterNumber', v_outcome.chapter_number,
    'choiceId', v_outcome.choice_id,
    'consequence', v_outcome.consequence,
    'nextChapterNumber', v_outcome.next_chapter_number,
    'isEnding', v_outcome.is_ending
  );

  if v_outcome.choice_kind = 'special_bad_ending' then
    if p_chapter_number <> 49
      or not v_outcome.is_ending
      or v_outcome.next_chapter_number is not null
    then
      raise exception using errcode = '22023', message = 'INVALID_PERSONALIZED_CHOICE_OUTCOME';
    end if;
    v_progress := p_chapter_number;
    v_status := 'SELESAI';
    v_ending_name := coalesce(v_outcome.consequence->>0, v_state.ending_name);
  else
    if v_outcome.choice_kind <> 'normal'
      or v_outcome.is_ending
      or v_outcome.next_chapter_number is distinct from p_chapter_number + 1
    then
      raise exception using errcode = '22023', message = 'INVALID_PERSONALIZED_CHOICE_OUTCOME';
    end if;
    v_progress := greatest(v_state.current_chapter, v_outcome.next_chapter_number);
    v_status := case when v_state.status = 'SELESAI' then 'SELESAI' else 'BERJALAN' end;
    v_ending_name := v_state.ending_name;
  end if;

  insert into public.personalized_choice_applications (
    user_id, story_id, chapter_number, choice_id, outcome_snapshot
  ) values (
    p_user_id, p_story_id, p_chapter_number, p_choice_id, v_outcome_snapshot
  );
  insert into public.personalized_choice_idempotency_keys (
    user_id, idempotency_key, story_id, chapter_number, choice_id
  ) values (
    p_user_id, p_idempotency_key, p_story_id, p_chapter_number, p_choice_id
  );

  update public.reader_states
  set route_state = v_calculated_route,
      choice_history = v_state.choice_history || pg_catalog.jsonb_build_array(v_canonical_history_entry),
      jejak = v_state.jejak || pg_catalog.jsonb_build_array(v_canonical_jejak_entry),
      current_chapter = v_progress,
      status = v_status,
      ending_name = v_ending_name,
      updated_at = pg_catalog.now()
  where user_id = p_user_id
    and story_id = p_story_id;

  return pg_catalog.jsonb_build_object(
    'outcome', v_outcome_snapshot,
    'nextChapterNumber', v_outcome.next_chapter_number,
    'replayed', false
  );
end;
$$;

revoke all on function public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_personalized_choice(uuid,text,integer,text,text,jsonb,jsonb,jsonb,jsonb)
  to service_role;
