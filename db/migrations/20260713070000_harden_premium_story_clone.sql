-- Harden deployed premium cloning with canonical state, complete JSON remapping, and V2 validation.

create or replace function public.clone_premium_story_remap_jsonb(
  p_value jsonb,
  p_old_ids text[],
  p_new_ids text[]
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_position integer;
  v_key_count bigint;
  v_distinct_key_count bigint;
begin
  if p_value is null then
    return null;
  end if;

  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select pg_catalog.count(*), pg_catalog.count(distinct remapped.key)
      into v_key_count, v_distinct_key_count
      from (
        select case
          when pg_catalog.array_position(p_old_ids, entry.key) is null then entry.key
          else p_new_ids[pg_catalog.array_position(p_old_ids, entry.key)]
        end as key
        from pg_catalog.jsonb_each(p_value) as entry
      ) as remapped;

      if v_key_count <> v_distinct_key_count then
        raise exception using errcode = '22023', message = 'JSON_REMAP_KEY_COLLISION';
      end if;

      select coalesce(
        pg_catalog.jsonb_object_agg(
          case
            when pg_catalog.array_position(p_old_ids, entry.key) is null then entry.key
            else p_new_ids[pg_catalog.array_position(p_old_ids, entry.key)]
          end,
          public.clone_premium_story_remap_jsonb(entry.value, p_old_ids, p_new_ids)
        ),
        '{}'::jsonb
      )
      into v_result
      from pg_catalog.jsonb_each(p_value) as entry;

      return v_result;
    when 'array' then
      select coalesce(
        pg_catalog.jsonb_agg(
          public.clone_premium_story_remap_jsonb(element.value, p_old_ids, p_new_ids)
          order by element.ordinality
        ),
        '[]'::jsonb
      )
      into v_result
      from pg_catalog.jsonb_array_elements(p_value) with ordinality as element(value, ordinality);

      return v_result;
    when 'string' then
      v_position := pg_catalog.array_position(p_old_ids, p_value #>> '{}');
      if v_position is not null then
        return pg_catalog.to_jsonb(p_new_ids[v_position]);
      end if;

      return p_value;
    else
      return p_value;
  end case;
end;
$$;

revoke all on function public.clone_premium_story_remap_jsonb(jsonb, text[], text[])
  from public, anon, authenticated, service_role;

create or replace function public.clone_premium_story_curated_chapter_is_valid(
  p_story_id text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_chapter public.chapters%rowtype;
  v_chapter_found boolean;
  v_choice jsonb;
  v_outcome public.choice_outcomes%rowtype;
  v_effect jsonb;
  v_record jsonb;
  v_key text;
  v_choice_ids text[] := array[]::text[];
  v_outcome_ids text[] := array[]::text[];
  v_outcome_count bigint;
  v_count bigint;
  v_distinct_count bigint;
  v_total_length bigint;
begin
  select chapter.*
  into v_chapter
  from public.chapters as chapter
  where chapter.story_id = p_story_id
    and chapter.number = 1;
  v_chapter_found := found;

  select pg_catalog.count(*)
  into v_outcome_count
  from public.choice_outcomes as outcome
  where outcome.story_id = p_story_id
    and outcome.chapter_number = 1;

  if not v_chapter_found then
    return v_outcome_count = 0;
  end if;

  if v_chapter.title is null
    or v_chapter.title = ''
    or v_chapter.title <> pg_catalog.btrim(v_chapter.title)
    or pg_catalog.char_length(v_chapter.title) > 200
    or pg_catalog.jsonb_typeof(v_chapter.paragraphs) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_chapter.paragraphs) < 1
    or pg_catalog.jsonb_array_length(v_chapter.paragraphs) > 100
    or v_chapter.choice_prompt is null
    or v_chapter.choice_prompt <> pg_catalog.btrim(v_chapter.choice_prompt)
    or pg_catalog.char_length(v_chapter.choice_prompt) < 8
    or pg_catalog.char_length(v_chapter.choice_prompt) > 120
    or pg_catalog.jsonb_typeof(v_chapter.choices) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_chapter.choices) < 2
    or pg_catalog.jsonb_array_length(v_chapter.choices) > 3
    or v_outcome_count < 2
    or v_outcome_count > 3 then
    return false;
  end if;

  select coalesce(pg_catalog.sum(pg_catalog.char_length(value #>> '{}')), 0::bigint)
  into v_total_length
  from pg_catalog.jsonb_array_elements(v_chapter.paragraphs) as paragraph(value);
  if v_total_length > 100000 or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_chapter.paragraphs) as paragraph(value)
    where pg_catalog.jsonb_typeof(value) <> 'string'
      or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
      or pg_catalog.char_length(value #>> '{}') < 1
      or pg_catalog.char_length(value #>> '{}') > 5000
  ) then
    return false;
  end if;

  for v_choice in
    select value from pg_catalog.jsonb_array_elements(v_chapter.choices)
  loop
    if pg_catalog.jsonb_typeof(v_choice) <> 'object'
      or not (v_choice ?& array['id', 'label'])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_choice) as choice_key(name)
        where name not in ('id', 'label', 'hint')
      )
      or pg_catalog.jsonb_typeof(v_choice->'id') <> 'string'
      or pg_catalog.jsonb_typeof(v_choice->'label') <> 'string'
      or ((v_choice ? 'hint') and pg_catalog.jsonb_typeof(v_choice->'hint') <> 'string') then
      return false;
    end if;

    v_key := v_choice->>'id';
    if v_key <> pg_catalog.btrim(v_key)
      or v_key <> pg_catalog.lower(v_key)
      or pg_catalog.char_length(v_key) < 1
      or pg_catalog.char_length(v_key) > 50
      or v_key !~ '^[a-z0-9]+([-_][a-z0-9]+)*$'
      or v_key = any(v_choice_ids)
      or v_choice->>'label' <> pg_catalog.btrim(v_choice->>'label')
      or pg_catalog.char_length(v_choice->>'label') < 8
      or pg_catalog.char_length(v_choice->>'label') > 90
      or ((v_choice ? 'hint') and (
        v_choice->>'hint' <> pg_catalog.btrim(v_choice->>'hint')
        or pg_catalog.char_length(v_choice->>'hint') < 8
        or pg_catalog.char_length(v_choice->>'hint') > 140
      )) then
      return false;
    end if;
    v_choice_ids := pg_catalog.array_append(v_choice_ids, v_key);
  end loop;

  for v_outcome in
    select outcome.*
    from public.choice_outcomes as outcome
    where outcome.story_id = p_story_id
      and outcome.chapter_number = 1
  loop
    if v_outcome.choice_id is null
      or v_outcome.choice_id <> pg_catalog.btrim(v_outcome.choice_id)
      or v_outcome.choice_id <> pg_catalog.lower(v_outcome.choice_id)
      or pg_catalog.char_length(v_outcome.choice_id) < 1
      or pg_catalog.char_length(v_outcome.choice_id) > 50
      or v_outcome.choice_id !~ '^[a-z0-9]+([-_][a-z0-9]+)*$'
      or v_outcome.choice_id = any(v_outcome_ids)
      or pg_catalog.jsonb_typeof(v_outcome.consequence) is distinct from 'array'
      or pg_catalog.jsonb_array_length(v_outcome.consequence) < 1
      or pg_catalog.jsonb_array_length(v_outcome.consequence) > 2
      or v_outcome.next_chapter_number is distinct from 2
      or v_outcome.is_ending is distinct from false
      or v_outcome.choice_kind is distinct from 'normal'
      or pg_catalog.jsonb_typeof(v_outcome.effect_json) is distinct from 'object' then
      return false;
    end if;
    v_outcome_ids := pg_catalog.array_append(v_outcome_ids, v_outcome.choice_id);

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_outcome.consequence) as consequence(value)
      where pg_catalog.jsonb_typeof(value) <> 'string'
        or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
        or pg_catalog.char_length(value #>> '{}') < 1
        or pg_catalog.char_length(value #>> '{}') > 160
    ) then
      return false;
    end if;

    v_effect := v_outcome.effect_json;
    if not (v_effect ?& array[
      'routeDeltas', 'trustDeltas', 'flagsSet', 'evidenceAdded', 'endingBiasDeltas', 'threadTouches'
    ]) or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_effect) as effect_key(name)
      where name not in (
        'routeDeltas', 'trustDeltas', 'flagsSet', 'evidenceAdded', 'endingBiasDeltas', 'threadTouches'
      )
    ) or pg_catalog.jsonb_typeof(v_effect->'routeDeltas') <> 'object'
      or pg_catalog.jsonb_typeof(v_effect->'trustDeltas') <> 'object'
      or pg_catalog.jsonb_typeof(v_effect->'flagsSet') <> 'object'
      or pg_catalog.jsonb_typeof(v_effect->'evidenceAdded') <> 'array'
      or pg_catalog.jsonb_typeof(v_effect->'endingBiasDeltas') <> 'object'
      or pg_catalog.jsonb_typeof(v_effect->'threadTouches') <> 'array' then
      return false;
    end if;

    if exists (
      select 1 from pg_catalog.jsonb_object_keys(v_effect->'routeDeltas') as route_key(name)
      where name not in ('truth', 'risk', 'secrecy', 'empathy')
    ) or exists (
      select 1 from pg_catalog.jsonb_each(v_effect->'routeDeltas') as delta(key, value)
      where pg_catalog.jsonb_typeof(value) <> 'number'
        or (value #>> '{}')::numeric <> pg_catalog.trunc((value #>> '{}')::numeric)
        or (value #>> '{}')::numeric < -20
        or (value #>> '{}')::numeric > 20
    ) then
      return false;
    end if;

    foreach v_key in array array['trustDeltas', 'flagsSet', 'endingBiasDeltas']
    loop
      v_record := v_effect->v_key;
      select pg_catalog.count(*), pg_catalog.count(distinct pg_catalog.btrim(record_key.key))
      into v_count, v_distinct_count
      from pg_catalog.jsonb_object_keys(v_record) as record_key(key);
      if v_count > 32 or v_count <> v_distinct_count or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_record) as record_key(key)
        where key <> pg_catalog.btrim(key)
          or pg_catalog.char_length(key) < 1
          or pg_catalog.char_length(key) > 80
          or key in ('__proto__', 'prototype', 'constructor')
      ) then
        return false;
      end if;
      if v_key = 'flagsSet' and exists (
        select 1 from pg_catalog.jsonb_each(v_record) as entry(key, value)
        where pg_catalog.jsonb_typeof(value) <> 'boolean'
      ) then
        return false;
      end if;
      if v_key = 'trustDeltas' and exists (
        select 1 from pg_catalog.jsonb_each(v_record) as entry(key, value)
        where pg_catalog.jsonb_typeof(value) <> 'number'
          or (value #>> '{}')::numeric <> pg_catalog.trunc((value #>> '{}')::numeric)
          or (value #>> '{}')::numeric < -10
          or (value #>> '{}')::numeric > 10
      ) then
        return false;
      end if;
      if v_key = 'endingBiasDeltas' and exists (
        select 1 from pg_catalog.jsonb_each(v_record) as entry(key, value)
        where pg_catalog.jsonb_typeof(value) <> 'number'
          or (value #>> '{}')::numeric <> pg_catalog.trunc((value #>> '{}')::numeric)
          or (value #>> '{}')::numeric < -100
          or (value #>> '{}')::numeric > 100
      ) then
        return false;
      end if;
    end loop;

    if pg_catalog.jsonb_array_length(v_effect->'evidenceAdded') > 32 or exists (
      select 1 from pg_catalog.jsonb_array_elements(v_effect->'evidenceAdded') as item(value)
      where pg_catalog.jsonb_typeof(value) <> 'string'
        or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
        or pg_catalog.char_length(value #>> '{}') < 1
        or pg_catalog.char_length(value #>> '{}') > 240
    ) or pg_catalog.jsonb_array_length(v_effect->'threadTouches') > 24 or exists (
      select 1 from pg_catalog.jsonb_array_elements(v_effect->'threadTouches') as item(value)
      where pg_catalog.jsonb_typeof(value) <> 'string'
        or value #>> '{}' <> pg_catalog.btrim(value #>> '{}')
        or pg_catalog.char_length(value #>> '{}') < 1
        or pg_catalog.char_length(value #>> '{}') > 120
    ) then
      return false;
    end if;
  end loop;

  return pg_catalog.cardinality(v_choice_ids) = pg_catalog.cardinality(v_outcome_ids)
    and v_choice_ids @> v_outcome_ids
    and v_outcome_ids @> v_choice_ids;
exception
  when data_exception or invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

revoke all on function public.clone_premium_story_curated_chapter_is_valid(text)
  from public, anon, authenticated, service_role;

create or replace function public.clone_premium_story_instance(
  p_template_story_id text,
  p_user_id uuid,
  p_new_story_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.stories%rowtype;
  v_source_found boolean;
  v_blueprint_count bigint;
  v_blueprint_distinct_count bigint;
  v_blueprint_min_chapter integer;
  v_blueprint_max_chapter integer;
  v_text_id_count bigint;
  v_distinct_text_id_count bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_character_old_ids text[];
  v_character_new_ids text[];
  v_fact_old_ids text[];
  v_fact_new_ids text[];
  v_secret_old_ids text[];
  v_secret_new_ids text[];
  v_thread_old_ids text[];
  v_thread_new_ids text[];
  v_old_ids text[];
  v_new_ids text[];
begin
  if p_template_story_id is null
    or p_template_story_id = ''
    or p_template_story_id <> pg_catalog.btrim(p_template_story_id)
    or p_new_story_id is null
    or p_new_story_id = ''
    or p_new_story_id <> pg_catalog.btrim(p_new_story_id)
    or pg_catalog.char_length(p_template_story_id) > 200
    or pg_catalog.char_length(p_new_story_id) > 128
    or p_template_story_id = p_new_story_id then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;

  if p_user_id is null
    or not exists (
      select 1
      from auth.users as users
      where users.id = p_user_id
    ) then
    raise exception using errcode = '22023', message = 'INVALID_OWNER';
  end if;

  -- Lock source before target. Source uses authoring RPC namespace; target uses clone namespace.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_template_story_id, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clone_premium_story_instance:' || p_new_story_id, 0)
  );

  select source.*
  into v_source
  from public.stories as source
  where source.id = p_template_story_id
  for share;
  v_source_found := found;

  select
    pg_catalog.count(*),
    pg_catalog.count(distinct blueprint.chapter_number),
    pg_catalog.min(blueprint.chapter_number),
    pg_catalog.max(blueprint.chapter_number)
  into
    v_blueprint_count,
    v_blueprint_distinct_count,
    v_blueprint_min_chapter,
    v_blueprint_max_chapter
  from public.chapter_blueprints as blueprint
  where blueprint.story_id = p_template_story_id;

  select pg_catalog.count(*), pg_catalog.count(distinct source_id)
  into v_text_id_count, v_distinct_text_id_count
  from (
    select character.id as source_id
    from public.characters as character
    where character.story_id = p_template_story_id
    union all
    select fact.id
    from public.facts_ledger as fact
    where fact.story_id = p_template_story_id
    union all
    select secret.id
    from public.secrets_reveals as secret
    where secret.story_id = p_template_story_id
    union all
    select thread.id
    from public.story_threads as thread
    where thread.story_id = p_template_story_id
  ) as remapped_source_ids;

  if not v_source_found
    or v_source.story_mode is distinct from 'premium_template'
    or v_source.visibility is distinct from 'public'
    or v_source.total_chapters is distinct from 50
    or not exists (
      select 1
      from public.story_generation_contracts as contract
      where contract.story_id = p_template_story_id
        and contract.mode = 'premium_template'
        and contract.total_chapters = 50
        and pg_catalog.jsonb_typeof(contract.story_contract_json) = 'object'
    )
    or v_blueprint_count <> 50
    or v_blueprint_distinct_count <> 50
    or v_blueprint_min_chapter <> 1
    or v_blueprint_max_chapter <> 50
    or v_text_id_count <> v_distinct_text_id_count
    or not public.clone_premium_story_curated_chapter_is_valid(p_template_story_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'INVALID_TEMPLATE');
  end if;

  select
    coalesce(
      pg_catalog.array_agg(character.id order by character.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':character:' || pg_catalog.md5(character.id)
        order by character.id
      ),
      array[]::text[]
    )
  into v_character_old_ids, v_character_new_ids
  from public.characters as character
  where character.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(fact.id order by fact.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':fact:' || pg_catalog.md5(fact.id)
        order by fact.id
      ),
      array[]::text[]
    )
  into v_fact_old_ids, v_fact_new_ids
  from public.facts_ledger as fact
  where fact.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(secret.id order by secret.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':secret:' || pg_catalog.md5(secret.id)
        order by secret.id
      ),
      array[]::text[]
    )
  into v_secret_old_ids, v_secret_new_ids
  from public.secrets_reveals as secret
  where secret.story_id = p_template_story_id;

  select
    coalesce(
      pg_catalog.array_agg(thread.id order by thread.id),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.array_agg(
        p_new_story_id || ':thread:' || pg_catalog.md5(thread.id)
        order by thread.id
      ),
      array[]::text[]
    )
  into v_thread_old_ids, v_thread_new_ids
  from public.story_threads as thread
  where thread.story_id = p_template_story_id;

  v_old_ids := v_character_old_ids || v_fact_old_ids || v_secret_old_ids || v_thread_old_ids;
  v_new_ids := v_character_new_ids || v_fact_new_ids || v_secret_new_ids || v_thread_new_ids;

  insert into public.stories (
    id,
    title,
    cover,
    tagline,
    role,
    tropes,
    total_chapters,
    synopsis,
    status,
    current_chapter,
    jejak,
    ending_name,
    created_at,
    owner_user_id,
    visibility,
    source_story_id,
    story_mode,
    generation_status,
    story_contract_version
  ) values (
    p_new_story_id,
    v_source.title,
    v_source.cover,
    v_source.tagline,
    v_source.role,
    v_source.tropes,
    v_source.total_chapters,
    v_source.synopsis,
    'BARU',
    1,
    '[]'::jsonb,
    null,
    v_now,
    p_user_id,
    'private',
    p_template_story_id,
    'premium_instance',
    'ready',
    v_source.story_contract_version
  )
  on conflict (id) do nothing;

  if not found then
    raise exception using errcode = '23505', message = 'TARGET_STORY_EXISTS';
  end if;

  insert into public.story_generation_contracts (
    story_id,
    mode,
    total_chapters,
    contract_source,
    onboarding_json,
    story_contract_json,
    route_schema_json,
    plot_debts_json,
    ending_candidates_json,
    ending_lock_json,
    quality_profile,
    created_at,
    updated_at
  )
  select
    p_new_story_id,
    'premium_instance',
    contract.total_chapters,
    contract.contract_source,
    public.clone_premium_story_remap_jsonb(contract.onboarding_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.story_contract_json, v_old_ids, v_new_ids)
      || pg_catalog.jsonb_build_object('storyId', p_new_story_id),
    public.clone_premium_story_remap_jsonb(contract.route_schema_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.plot_debts_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.ending_candidates_json, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(contract.ending_lock_json, v_old_ids, v_new_ids),
    contract.quality_profile,
    v_now,
    v_now
  from public.story_generation_contracts as contract
  where contract.story_id = p_template_story_id;

  insert into public.characters (
    id,
    story_id,
    canonical_name,
    role,
    motivation,
    introduced_chapter,
    created_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(character.id),
    p_new_story_id,
    character.canonical_name,
    character.role,
    character.motivation,
    character.introduced_chapter,
    v_now
  from public.characters as character
  where character.story_id = p_template_story_id;

  insert into public.character_states (
    character_id,
    status,
    as_of_chapter,
    attributes,
    updated_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(state.character_id),
    state.status,
    state.as_of_chapter,
    public.clone_premium_story_remap_jsonb(state.attributes, v_old_ids, v_new_ids),
    v_now
  from public.character_states as state
  join public.characters as character
    on character.id = state.character_id
  where character.story_id = p_template_story_id;

  insert into public.character_aliases (
    story_id,
    character_id,
    alias,
    alias_type,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(alias.character_id),
    alias.alias,
    alias.alias_type,
    v_now
  from public.character_aliases as alias
  where alias.story_id = p_template_story_id;

  insert into public.character_voice_sheets (
    character_id,
    story_id,
    register,
    speech_habits,
    forbidden_words,
    sample_lines,
    created_at
  )
  select
    p_new_story_id || ':character:' || pg_catalog.md5(voice.character_id),
    p_new_story_id,
    voice.register,
    public.clone_premium_story_remap_jsonb(voice.speech_habits, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(voice.forbidden_words, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(voice.sample_lines, v_old_ids, v_new_ids),
    v_now
  from public.character_voice_sheets as voice
  where voice.story_id = p_template_story_id;

  insert into public.facts_ledger (
    id,
    story_id,
    statement,
    subject_character_id,
    established_chapter,
    salience,
    load_bearing,
    paid_off,
    created_at
  )
  select
    p_new_story_id || ':fact:' || pg_catalog.md5(fact.id),
    p_new_story_id,
    fact.statement,
    case
      when fact.subject_character_id is null then null
      else p_new_story_id || ':character:' || pg_catalog.md5(fact.subject_character_id)
    end,
    fact.established_chapter,
    fact.salience,
    fact.load_bearing,
    fact.paid_off,
    v_now
  from public.facts_ledger as fact
  where fact.story_id = p_template_story_id;

  insert into public.knowledge_scopes (
    story_id,
    character_id,
    fact_id,
    known_from_chapter,
    created_at
  )
  select
    p_new_story_id,
    p_new_story_id || ':character:' || pg_catalog.md5(scope.character_id),
    p_new_story_id || ':fact:' || pg_catalog.md5(scope.fact_id),
    scope.known_from_chapter,
    v_now
  from public.knowledge_scopes as scope
  where scope.story_id = p_template_story_id;

  insert into public.secrets_reveals (
    id,
    story_id,
    description,
    reveal_gate_chapter,
    revealed,
    created_at
  )
  select
    p_new_story_id || ':secret:' || pg_catalog.md5(secret.id),
    p_new_story_id,
    secret.description,
    secret.reveal_gate_chapter,
    secret.revealed,
    v_now
  from public.secrets_reveals as secret
  where secret.story_id = p_template_story_id;

  insert into public.story_threads (
    id,
    story_id,
    title,
    status,
    opened_chapter,
    last_touched_chapter,
    payoff_window,
    is_main_mystery,
    created_at,
    stale,
    stale_since_chapter
  )
  select
    p_new_story_id || ':thread:' || pg_catalog.md5(thread.id),
    p_new_story_id,
    thread.title,
    thread.status,
    thread.opened_chapter,
    thread.last_touched_chapter,
    thread.payoff_window,
    thread.is_main_mystery,
    v_now,
    thread.stale,
    thread.stale_since_chapter
  from public.story_threads as thread
  where thread.story_id = p_template_story_id;

  insert into public.timeline_events (
    story_id,
    chapter_number,
    ordinal,
    description,
    is_flashback,
    occurs_at,
    created_at
  )
  select
    p_new_story_id,
    event.chapter_number,
    event.ordinal,
    event.description,
    event.is_flashback,
    event.occurs_at,
    v_now
  from public.timeline_events as event
  where event.story_id = p_template_story_id;

  insert into public.act_rollups (
    story_id,
    act_number,
    summary,
    state_delta,
    covers_from_chapter,
    covers_to_chapter,
    created_at
  )
  select
    p_new_story_id,
    rollup.act_number,
    rollup.summary,
    public.clone_premium_story_remap_jsonb(rollup.state_delta, v_old_ids, v_new_ids),
    rollup.covers_from_chapter,
    rollup.covers_to_chapter,
    v_now
  from public.act_rollups as rollup
  where rollup.story_id = p_template_story_id;

  insert into public.chapter_blueprints (
    story_id,
    chapter_number,
    version,
    phase,
    chapter_goal,
    mandatory_beats,
    forbidden_reveals,
    allowed_state_delta,
    introduces_characters,
    reconciled_from_version,
    reconciliation_reason,
    created_at
  )
  select
    p_new_story_id,
    blueprint.chapter_number,
    blueprint.version,
    blueprint.phase,
    blueprint.chapter_goal,
    public.clone_premium_story_remap_jsonb(blueprint.mandatory_beats, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.forbidden_reveals, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.allowed_state_delta, v_old_ids, v_new_ids),
    public.clone_premium_story_remap_jsonb(blueprint.introduces_characters, v_old_ids, v_new_ids),
    blueprint.reconciled_from_version,
    blueprint.reconciliation_reason,
    v_now
  from public.chapter_blueprints as blueprint
  where blueprint.story_id = p_template_story_id;

  insert into public.chapters (
    story_id,
    number,
    title,
    paragraphs,
    choice_prompt,
    choices,
    created_at
  )
  select
    p_new_story_id,
    chapter.number,
    chapter.title,
    public.clone_premium_story_remap_jsonb(chapter.paragraphs, v_old_ids, v_new_ids),
    chapter.choice_prompt,
    public.clone_premium_story_remap_jsonb(chapter.choices, v_old_ids, v_new_ids),
    v_now
  from public.chapters as chapter
  where chapter.story_id = p_template_story_id
    and chapter.number = 1;

  insert into public.choice_outcomes (
    story_id,
    chapter_number,
    choice_id,
    consequence,
    next_chapter_number,
    is_ending,
    created_at,
    effect_json,
    choice_kind
  )
  select
    p_new_story_id,
    outcome.chapter_number,
    outcome.choice_id,
    public.clone_premium_story_remap_jsonb(outcome.consequence, v_old_ids, v_new_ids),
    outcome.next_chapter_number,
    outcome.is_ending,
    v_now,
    public.clone_premium_story_remap_jsonb(outcome.effect_json, v_old_ids, v_new_ids),
    outcome.choice_kind
  from public.choice_outcomes as outcome
  where outcome.story_id = p_template_story_id
    and outcome.chapter_number = 1;

  insert into public.reader_states (
    user_id,
    story_id,
    status,
    current_chapter,
    jejak,
    ending_name,
    updated_at,
    created_at,
    route_state,
    choice_history,
    locked_ending_key
  ) values (
    p_user_id,
    p_new_story_id,
    'BERJALAN',
    1,
    '[]'::jsonb,
    null,
    v_now,
    v_now,
    jsonb_build_object(
      'truth', 0,
      'risk', 0,
      'secrecy', 0,
      'empathy', 0,
      'trust', '{}'::jsonb,
      'evidence', '[]'::jsonb,
      'flags', '{}'::jsonb,
      'endingBias', '{}'::jsonb
    ),
    '[]'::jsonb,
    null
  );

  return pg_catalog.jsonb_build_object('ok', true, 'story_id', p_new_story_id);
end;
$$;

revoke all on function public.clone_premium_story_instance(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.clone_premium_story_instance(text, uuid, text)
  to service_role;
