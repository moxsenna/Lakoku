-- Clone a curated public premium template into a private user-owned story instance.

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
begin
  if p_value is null then
    return null;
  end if;

  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select coalesce(
        pg_catalog.jsonb_object_agg(entry.key, public.clone_premium_story_remap_jsonb(entry.value, p_old_ids, p_new_ids)),
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
    or v_text_id_count <> v_distinct_text_id_count then
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
    '{}'::jsonb,
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
