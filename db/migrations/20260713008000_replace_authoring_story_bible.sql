-- Replace an authoring story shell and its complete managed canon in one transaction.

create or replace function public.replace_authoring_story_bible_v1(
  p_story_id text,
  p_owner_user_id uuid,
  p_title text,
  p_cover text,
  p_tagline text,
  p_role text,
  p_tropes jsonb,
  p_total_chapters integer,
  p_synopsis text,
  p_canon jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_story_id text;
  v_title text;
  v_cover text;
  v_tagline text;
  v_role text;
  v_synopsis text;
  v_tropes jsonb;
  v_existing_owner uuid;
  v_expected_keys constant text[] := array[
    'characters',
    'character_aliases',
    'character_voice_sheets',
    'facts_ledger',
    'knowledge_scopes',
    'secrets_reveals',
    'timeline_events',
    'story_threads',
    'act_rollups',
    'chapter_blueprints'
  ];
  v_key text;
begin
  -- Keep raw and normalized metadata bounds identical to the latest claim RPC.
  if p_owner_user_id is null
    or p_story_id is null
    or char_length(p_story_id) > 128
    or char_length(btrim(p_story_id)) < 1
    or p_cover is null
    or char_length(p_cover) > 2048
    or char_length(btrim(p_cover)) < 1
    or p_title is null
    or char_length(p_title) > 80
    or char_length(btrim(p_title)) < 3
    or p_tagline is null
    or char_length(p_tagline) > 160
    or char_length(btrim(p_tagline)) < 10
    or p_role is null
    or char_length(p_role) > 80
    or char_length(btrim(p_role)) < 3
    or p_synopsis is null
    or char_length(p_synopsis) > 700
    or char_length(btrim(p_synopsis)) < 60
    or p_total_chapters is distinct from 50
    or jsonb_typeof(p_tropes) is distinct from 'array'
    or jsonb_array_length(p_tropes) not between 2 and 5
    or exists (
      select 1
      from jsonb_array_elements(p_tropes) as trope(value)
      where jsonb_typeof(trope.value) <> 'string'
        or char_length(trope.value #>> '{}') > 40
        or char_length(btrim(trope.value #>> '{}')) not between 2 and 40
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end if;

  v_story_id := btrim(p_story_id);
  v_title := btrim(p_title);
  v_cover := btrim(p_cover);
  v_tagline := btrim(p_tagline);
  v_role := btrim(p_role);
  v_synopsis := btrim(p_synopsis);
  select jsonb_agg(to_jsonb(btrim(trope.value #>> '{}')) order by trope.ordinality)
    into v_tropes
  from jsonb_array_elements(p_tropes) with ordinality as trope(value, ordinality);

  -- Service-only does not mean trusted input. Require one bounded, complete canon object.
  if jsonb_typeof(p_canon) is distinct from 'object'
    or pg_column_size(p_canon) > 4 * 1024 * 1024
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON';
  end if;

  foreach v_key in array v_expected_keys loop
    if jsonb_typeof(p_canon -> v_key) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'INVALID_CANON';
    end if;
  end loop;

  if exists (
      select 1 from jsonb_object_keys(p_canon) as supplied(key)
      where not (supplied.key = any(v_expected_keys))
    )
    or (select count(*) from jsonb_object_keys(p_canon)) <> cardinality(v_expected_keys)
    or jsonb_array_length(p_canon -> 'characters') > 100
    or jsonb_array_length(p_canon -> 'character_aliases') > 500
    or jsonb_array_length(p_canon -> 'character_voice_sheets') > 100
    or jsonb_array_length(p_canon -> 'facts_ledger') > 1000
    or jsonb_array_length(p_canon -> 'knowledge_scopes') > 5000
    or jsonb_array_length(p_canon -> 'secrets_reveals') > 500
    or jsonb_array_length(p_canon -> 'timeline_events') > 5000
    or jsonb_array_length(p_canon -> 'story_threads') > 500
    or jsonb_array_length(p_canon -> 'act_rollups') > 10
    or jsonb_array_length(p_canon -> 'chapter_blueprints') > 500
    or exists (
      select 1
      from unnest(v_expected_keys) as expected(key)
      cross join lateral jsonb_array_elements(p_canon -> expected.key) as item(value)
      where jsonb_typeof(item.value) <> 'object'
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON';
  end if;

  -- hashtextextended consumes full ID. Collisions only add serialization; row PK/lock remains arbiter.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_story_id, 0));

  select s.owner_user_id
    into v_existing_owner
  from public.stories as s
  where s.id = v_story_id
  for update;

  if found and v_existing_owner is distinct from p_owner_user_id then
    return jsonb_build_object('ok', false, 'status', 'OWNER_MISMATCH');
  end if;

  insert into public.stories (
    id, title, cover, tagline, role, tropes, total_chapters, synopsis,
    status, current_chapter, jejak, ending_name, owner_user_id, visibility
  ) values (
    v_story_id, v_title, v_cover, v_tagline, v_role, v_tropes, p_total_chapters, v_synopsis,
    'BARU', 0, '[]'::jsonb, null, p_owner_user_id, 'private'
  )
  on conflict (id) do update
  set title = excluded.title,
      cover = excluded.cover,
      tagline = excluded.tagline,
      role = excluded.role,
      tropes = excluded.tropes,
      total_chapters = excluded.total_chapters,
      synopsis = excluded.synopsis
  where public.stories.owner_user_id = p_owner_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'OWNER_MISMATCH');
  end if;

  -- Delete dependents before parents. Every statement remains in this function transaction.
  delete from public.chapter_blueprints where story_id = v_story_id;
  delete from public.act_rollups where story_id = v_story_id;
  delete from public.story_threads where story_id = v_story_id;
  delete from public.timeline_events where story_id = v_story_id;
  delete from public.secrets_reveals where story_id = v_story_id;
  delete from public.knowledge_scopes where story_id = v_story_id;
  delete from public.facts_ledger where story_id = v_story_id;
  delete from public.character_aliases where story_id = v_story_id;
  delete from public.character_voice_sheets where story_id = v_story_id;
  delete from public.character_states as cs
  using public.characters as c
  where cs.character_id = c.id and c.story_id = v_story_id;
  delete from public.characters where story_id = v_story_id;

  with rows as (
    select *
    from jsonb_to_recordset(p_canon -> 'characters') as x(
      id text,
      canonical_name text,
      role text,
      motivation text,
      introduced_chapter integer,
      status text
    )
  )
  insert into public.characters (id, story_id, canonical_name, role, motivation, introduced_chapter)
  select id, v_story_id, canonical_name, role, motivation, introduced_chapter from rows;

  with rows as (
    select *
    from jsonb_to_recordset(p_canon -> 'characters') as x(
      id text,
      introduced_chapter integer,
      status text
    )
  )
  insert into public.character_states (character_id, as_of_chapter, status, attributes)
  select id, introduced_chapter, status, '{}'::jsonb from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'character_aliases') as x(
      character_id text, alias text, alias_type text
    )
  )
  insert into public.character_aliases (story_id, character_id, alias, alias_type)
  select v_story_id, character_id, alias, alias_type from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'character_voice_sheets') as x(
      character_id text,
      register text,
      speech_habits jsonb,
      forbidden_words jsonb,
      sample_lines jsonb
    )
  )
  insert into public.character_voice_sheets (
    story_id, character_id, register, speech_habits, forbidden_words, sample_lines
  )
  select v_story_id, character_id, register, speech_habits, forbidden_words, sample_lines from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'facts_ledger') as x(
      id text,
      statement text,
      subject_character_id text,
      established_chapter integer,
      salience real,
      load_bearing boolean,
      paid_off boolean
    )
  )
  insert into public.facts_ledger (
    id, story_id, statement, subject_character_id, established_chapter,
    salience, load_bearing, paid_off
  )
  select id, v_story_id, statement, subject_character_id, established_chapter,
         salience, load_bearing, paid_off
  from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'knowledge_scopes') as x(
      character_id text, fact_id text, known_from_chapter integer
    )
  )
  insert into public.knowledge_scopes (story_id, character_id, fact_id, known_from_chapter)
  select v_story_id, character_id, fact_id, known_from_chapter from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'secrets_reveals') as x(
      id text, description text, reveal_gate_chapter integer, revealed boolean
    )
  )
  insert into public.secrets_reveals (id, story_id, description, reveal_gate_chapter, revealed)
  select id, v_story_id, description, reveal_gate_chapter, revealed from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'timeline_events') as x(
      chapter_number integer,
      ordinal integer,
      description text,
      is_flashback boolean,
      occurs_at real
    )
  )
  insert into public.timeline_events (
    story_id, chapter_number, ordinal, description, is_flashback, occurs_at
  )
  select v_story_id, chapter_number, ordinal, description, is_flashback, occurs_at from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'story_threads') as x(
      id text,
      title text,
      status text,
      opened_chapter integer,
      last_touched_chapter integer,
      payoff_window integer,
      is_main_mystery boolean,
      stale boolean,
      stale_since_chapter integer
    )
  )
  insert into public.story_threads (
    id, story_id, title, status, opened_chapter, last_touched_chapter,
    payoff_window, is_main_mystery, stale, stale_since_chapter
  )
  select id, v_story_id, title, status, opened_chapter, last_touched_chapter,
         payoff_window, is_main_mystery, stale, stale_since_chapter
  from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'act_rollups') as x(
      act_number integer,
      summary text,
      state_delta jsonb,
      covers_from_chapter integer,
      covers_to_chapter integer
    )
  )
  insert into public.act_rollups (
    story_id, act_number, summary, state_delta, covers_from_chapter, covers_to_chapter
  )
  select v_story_id, act_number, summary, state_delta, covers_from_chapter, covers_to_chapter from rows;

  with rows as (
    select * from jsonb_to_recordset(p_canon -> 'chapter_blueprints') as x(
      chapter_number integer,
      version integer,
      phase text,
      chapter_goal text,
      mandatory_beats jsonb,
      forbidden_reveals jsonb,
      allowed_state_delta jsonb,
      introduces_characters jsonb,
      reconciled_from_version integer,
      reconciliation_reason text
    )
  )
  insert into public.chapter_blueprints (
    story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
    forbidden_reveals, allowed_state_delta, introduces_characters,
    reconciled_from_version, reconciliation_reason
  )
  select v_story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
         forbidden_reveals, allowed_state_delta, introduces_characters,
         reconciled_from_version, reconciliation_reason
  from rows;

  return jsonb_build_object('ok', true, 'status', 'REPLACED');
end;
$$;

revoke all on function public.replace_authoring_story_bible_v1(
  text, uuid, text, text, text, text, jsonb, integer, text, jsonb
) from public;
revoke all on function public.replace_authoring_story_bible_v1(
  text, uuid, text, text, text, text, jsonb, integer, text, jsonb
) from anon;
revoke all on function public.replace_authoring_story_bible_v1(
  text, uuid, text, text, text, text, jsonb, integer, text, jsonb
) from authenticated;
grant execute on function public.replace_authoring_story_bible_v1(
  text, uuid, text, text, text, text, jsonb, integer, text, jsonb
) to service_role;

comment on function public.replace_authoring_story_bible_v1(
  text, uuid, text, text, text, text, jsonb, integer, text, jsonb
) is 'Service-only transactional replacement of authoring shell metadata and complete managed canon.';
