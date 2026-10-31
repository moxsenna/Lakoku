-- Deep-validate the complete authoring canon before replacing any shell or canon row.

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
    'characters', 'character_aliases', 'character_voice_sheets', 'facts_ledger',
    'knowledge_scopes', 'secrets_reveals', 'timeline_events', 'story_threads',
    'act_rollups', 'chapter_blueprints'
  ];
  v_key text;
begin
  if p_owner_user_id is null
    or p_story_id is null or char_length(p_story_id) > 128 or char_length(btrim(p_story_id)) < 1
    or p_cover is null or char_length(p_cover) > 2048 or char_length(btrim(p_cover)) < 1
    or p_title is null or char_length(p_title) > 80 or char_length(btrim(p_title)) < 3
    or p_tagline is null or char_length(p_tagline) > 160 or char_length(btrim(p_tagline)) < 10
    or p_role is null or char_length(p_role) > 80 or char_length(btrim(p_role)) < 3
    or p_synopsis is null or char_length(p_synopsis) > 700 or char_length(btrim(p_synopsis)) < 60
    or p_total_chapters is distinct from 50
    or jsonb_typeof(p_tropes) is distinct from 'array'
    or jsonb_array_length(p_tropes) not between 2 and 5
    or exists (
      select 1 from jsonb_array_elements(p_tropes) as trope(value)
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
      select 1 from unnest(v_expected_keys) as expected(key)
      cross join lateral jsonb_array_elements(p_canon -> expected.key) as item(value)
      where jsonb_typeof(item.value) <> 'object'
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON';
  end if;

  -- Every row has exact keys, scalar types, app bounds, and optional matching story_id.
  if exists (
    select 1 from jsonb_array_elements(p_canon -> 'characters') item
    where not (item ?& array['id','canonical_name','role','motivation','introduced_chapter','status'])
      or (item - array['id','canonical_name','role','motivation','introduced_chapter','status','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'id') <> 'string' or char_length(item->>'id') not between 1 and 256
      or jsonb_typeof(item->'canonical_name') <> 'string' or char_length(item->>'canonical_name') not between 2 and 60
      or jsonb_typeof(item->'role') <> 'string' or char_length(item->>'role') not between 2 and 60
      or jsonb_typeof(item->'motivation') <> 'string' or char_length(item->>'motivation') not between 10 and 240
      or jsonb_typeof(item->'introduced_chapter') <> 'number'
      or (item->>'introduced_chapter')::numeric <> trunc((item->>'introduced_chapter')::numeric)
      or (item->>'introduced_chapter')::numeric not between 1 and 50
      or jsonb_typeof(item->'status') <> 'string' or item->>'status' not in ('ALIVE','DEAD','INACTIVE')
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'character_aliases') item
    where not (item ?& array['character_id','alias','alias_type'])
      or (item - array['character_id','alias','alias_type','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'character_id') <> 'string' or char_length(item->>'character_id') not between 1 and 256
      or jsonb_typeof(item->'alias') <> 'string' or char_length(item->>'alias') not between 1 and 60
      or jsonb_typeof(item->'alias_type') <> 'string' or item->>'alias_type' not in ('NAME','NICKNAME','RELATION','TITLE')
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'character_voice_sheets') item
    where not (item ?& array['character_id','register','speech_habits','forbidden_words','sample_lines'])
      or (item - array['character_id','register','speech_habits','forbidden_words','sample_lines','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'character_id') <> 'string' or char_length(item->>'character_id') not between 1 and 256
      or jsonb_typeof(item->'register') <> 'string' or char_length(item->>'register') not between 3 and 80
      or jsonb_typeof(item->'speech_habits') <> 'array' or jsonb_array_length(item->'speech_habits') > 5
      or jsonb_typeof(item->'forbidden_words') <> 'array' or jsonb_array_length(item->'forbidden_words') > 8
      or jsonb_typeof(item->'sample_lines') <> 'array' or jsonb_array_length(item->'sample_lines') not between 1 and 3
      or exists (select 1 from jsonb_array_elements(item->'speech_habits') v where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 2 and 80)
      or exists (select 1 from jsonb_array_elements(item->'forbidden_words') v where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 40)
      or exists (select 1 from jsonb_array_elements(item->'sample_lines') v where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 3 and 160)
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'facts_ledger') item
    where not (item ?& array['id','statement','subject_character_id','established_chapter','salience','load_bearing','paid_off'])
      or (item - array['id','statement','subject_character_id','established_chapter','salience','load_bearing','paid_off','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'id') <> 'string' or char_length(item->>'id') not between 1 and 256
      or jsonb_typeof(item->'statement') <> 'string' or char_length(item->>'statement') not between 8 and 240
      or jsonb_typeof(item->'subject_character_id') not in ('string','null')
      or (jsonb_typeof(item->'subject_character_id') = 'string' and char_length(item->>'subject_character_id') not between 1 and 256)
      or jsonb_typeof(item->'established_chapter') <> 'number'
      or (item->>'established_chapter')::numeric <> trunc((item->>'established_chapter')::numeric)
      or (item->>'established_chapter')::numeric not between 1 and 50
      or jsonb_typeof(item->'salience') <> 'number' or (item->>'salience')::numeric not between 0 and 1
      or jsonb_typeof(item->'load_bearing') <> 'boolean' or jsonb_typeof(item->'paid_off') <> 'boolean'
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'knowledge_scopes') item
    where not (item ?& array['character_id','fact_id','known_from_chapter'])
      or (item - array['character_id','fact_id','known_from_chapter','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'character_id') <> 'string' or char_length(item->>'character_id') not between 1 and 256
      or jsonb_typeof(item->'fact_id') <> 'string' or char_length(item->>'fact_id') not between 1 and 256
      or jsonb_typeof(item->'known_from_chapter') <> 'number'
      or (item->>'known_from_chapter')::numeric <> trunc((item->>'known_from_chapter')::numeric)
      or (item->>'known_from_chapter')::numeric not between 1 and 50
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'secrets_reveals') item
    where not (item ?& array['id','description','reveal_gate_chapter','revealed'])
      or (item - array['id','description','reveal_gate_chapter','revealed','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'id') <> 'string' or char_length(item->>'id') not between 1 and 256
      or jsonb_typeof(item->'description') <> 'string' or char_length(item->>'description') not between 15 and 300
      or jsonb_typeof(item->'reveal_gate_chapter') <> 'number'
      or (item->>'reveal_gate_chapter')::numeric <> trunc((item->>'reveal_gate_chapter')::numeric)
      or (item->>'reveal_gate_chapter')::numeric not in (12,20,32,45)
      or jsonb_typeof(item->'revealed') <> 'boolean'
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'timeline_events') item
    where not (item ?& array['chapter_number','ordinal','description','is_flashback','occurs_at'])
      or (item - array['chapter_number','ordinal','description','is_flashback','occurs_at','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'chapter_number') <> 'number'
      or (item->>'chapter_number')::numeric <> trunc((item->>'chapter_number')::numeric)
      or (item->>'chapter_number')::numeric not between 1 and 50
      or jsonb_typeof(item->'ordinal') <> 'number' or (item->>'ordinal')::numeric <> trunc((item->>'ordinal')::numeric)
      or (item->>'ordinal')::numeric not between 0 and 1000
      or jsonb_typeof(item->'description') <> 'string' or char_length(item->>'description') not between 1 and 500
      or jsonb_typeof(item->'is_flashback') <> 'boolean' or jsonb_typeof(item->'occurs_at') not in ('number','null')
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'story_threads') item
    where not (item ?& array['id','title','status','opened_chapter','last_touched_chapter','payoff_window','is_main_mystery','stale','stale_since_chapter'])
      or (item - array['id','title','status','opened_chapter','last_touched_chapter','payoff_window','is_main_mystery','stale','stale_since_chapter','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'id') <> 'string' or char_length(item->>'id') not between 1 and 256
      or jsonb_typeof(item->'title') <> 'string' or char_length(item->>'title') not between 5 and 120
      or jsonb_typeof(item->'status') <> 'string' or item->>'status' not in ('OPEN','DEVELOPING','PAYOFF_DUE','RESOLVED','ABANDONED_APPROVED')
      or jsonb_typeof(item->'opened_chapter') <> 'number' or (item->>'opened_chapter')::numeric <> trunc((item->>'opened_chapter')::numeric) or (item->>'opened_chapter')::numeric not between 1 and 50
      or jsonb_typeof(item->'last_touched_chapter') <> 'number' or (item->>'last_touched_chapter')::numeric <> trunc((item->>'last_touched_chapter')::numeric) or (item->>'last_touched_chapter')::numeric not between 1 and 50
      or jsonb_typeof(item->'payoff_window') not in ('number','null')
      or (jsonb_typeof(item->'payoff_window') = 'number' and ((item->>'payoff_window')::numeric <> trunc((item->>'payoff_window')::numeric) or (item->>'payoff_window')::numeric not between 1 and 50))
      or jsonb_typeof(item->'is_main_mystery') <> 'boolean' or jsonb_typeof(item->'stale') <> 'boolean'
      or jsonb_typeof(item->'stale_since_chapter') not in ('number','null')
      or (jsonb_typeof(item->'stale_since_chapter') = 'number' and ((item->>'stale_since_chapter')::numeric <> trunc((item->>'stale_since_chapter')::numeric) or (item->>'stale_since_chapter')::numeric not between 1 and 50))
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'act_rollups') item
    where not (item ?& array['act_number','summary','state_delta','covers_from_chapter','covers_to_chapter'])
      or (item - array['act_number','summary','state_delta','covers_from_chapter','covers_to_chapter','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'act_number') <> 'number' or (item->>'act_number')::numeric <> trunc((item->>'act_number')::numeric) or (item->>'act_number')::numeric not between 1 and 8
      or jsonb_typeof(item->'summary') <> 'string' or char_length(item->>'summary') not between 1 and 2000
      or jsonb_typeof(item->'state_delta') <> 'object'
      or jsonb_typeof(item->'covers_from_chapter') <> 'number' or (item->>'covers_from_chapter')::numeric <> trunc((item->>'covers_from_chapter')::numeric) or (item->>'covers_from_chapter')::numeric not between 1 and 50
      or jsonb_typeof(item->'covers_to_chapter') <> 'number' or (item->>'covers_to_chapter')::numeric <> trunc((item->>'covers_to_chapter')::numeric) or (item->>'covers_to_chapter')::numeric not between 1 and 50
      or (item->>'covers_from_chapter')::numeric > (item->>'covers_to_chapter')::numeric
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) or exists (
    select 1 from jsonb_array_elements(p_canon -> 'chapter_blueprints') item
    where not (item ?& array['chapter_number','version','phase','chapter_goal','mandatory_beats','forbidden_reveals','allowed_state_delta','introduces_characters','reconciled_from_version','reconciliation_reason'])
      or (item - array['chapter_number','version','phase','chapter_goal','mandatory_beats','forbidden_reveals','allowed_state_delta','introduces_characters','reconciled_from_version','reconciliation_reason','story_id']) <> '{}'::jsonb
      or jsonb_typeof(item->'chapter_number') <> 'number' or (item->>'chapter_number')::numeric <> trunc((item->>'chapter_number')::numeric) or (item->>'chapter_number')::numeric not between 1 and 50
      or jsonb_typeof(item->'version') <> 'number' or (item->>'version')::numeric <> trunc((item->>'version')::numeric) or (item->>'version')::numeric not between 1 and 1000
      or jsonb_typeof(item->'phase') <> 'string' or char_length(item->>'phase') not between 1 and 120
      or jsonb_typeof(item->'chapter_goal') <> 'string' or char_length(item->>'chapter_goal') not between 1 and 500
      or jsonb_typeof(item->'mandatory_beats') <> 'array' or jsonb_array_length(item->'mandatory_beats') > 50
      or jsonb_typeof(item->'forbidden_reveals') <> 'array' or jsonb_array_length(item->'forbidden_reveals') > 500
      or jsonb_typeof(item->'allowed_state_delta') <> 'object'
      or jsonb_typeof(item->'introduces_characters') <> 'array' or jsonb_array_length(item->'introduces_characters') > 100
      or exists (select 1 from jsonb_array_elements(item->'mandatory_beats') v where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 500)
      or exists (select 1 from jsonb_array_elements(item->'forbidden_reveals') v where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 256)
      or exists (select 1 from jsonb_array_elements(item->'introduces_characters') v where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 256)
      or jsonb_typeof(item->'reconciled_from_version') not in ('number','null')
      or (jsonb_typeof(item->'reconciled_from_version') = 'number' and ((item->>'reconciled_from_version')::numeric <> trunc((item->>'reconciled_from_version')::numeric) or (item->>'reconciled_from_version')::numeric not between 1 and 1000))
      or jsonb_typeof(item->'reconciliation_reason') not in ('string','null')
      or (jsonb_typeof(item->'reconciliation_reason') = 'string' and char_length(item->>'reconciliation_reason') not between 1 and 500)
      or (item ? 'story_id' and (jsonb_typeof(item->'story_id') <> 'string' or btrim(item->>'story_id') <> v_story_id))
  ) then
    raise exception using errcode = '22023', message = 'INVALID_CANON_ROW';
  end if;

  -- Reject duplicates that would violate global or story-local unique constraints.
  if (select count(*) <> count(distinct item->>'id') from jsonb_array_elements(p_canon->'characters') item)
    or (select count(*) <> count(distinct lower(item->>'alias')) from jsonb_array_elements(p_canon->'character_aliases') item)
    or (select count(*) <> count(distinct item->>'character_id') from jsonb_array_elements(p_canon->'character_voice_sheets') item)
    or (select count(*) <> count(distinct item->>'id') from jsonb_array_elements(p_canon->'facts_ledger') item)
    or (select count(*) <> count(distinct (item->>'character_id', item->>'fact_id')) from jsonb_array_elements(p_canon->'knowledge_scopes') item)
    or (select count(*) <> count(distinct item->>'id') from jsonb_array_elements(p_canon->'secrets_reveals') item)
    or (select count(*) <> count(distinct item->>'id') from jsonb_array_elements(p_canon->'story_threads') item)
    or (select count(*) <> count(distinct item->>'act_number') from jsonb_array_elements(p_canon->'act_rollups') item)
    or (select count(*) <> count(distinct (item->>'chapter_number', item->>'version')) from jsonb_array_elements(p_canon->'chapter_blueprints') item)
  then
    raise exception using errcode = '22023', message = 'DUPLICATE_CANON_ROW';
  end if;

  -- Every intra-canon reference must resolve inside this payload, never through a global FK.
  if exists (
      select 1 from jsonb_array_elements(p_canon->'character_aliases') item
      where not exists (select 1 from jsonb_array_elements(p_canon->'characters') c where c->>'id' = item->>'character_id')
    ) or exists (
      select 1 from jsonb_array_elements(p_canon->'character_voice_sheets') item
      where not exists (select 1 from jsonb_array_elements(p_canon->'characters') c where c->>'id' = item->>'character_id')
    ) or exists (
      select 1 from jsonb_array_elements(p_canon->'facts_ledger') item
      where jsonb_typeof(item->'subject_character_id') = 'string'
        and not exists (select 1 from jsonb_array_elements(p_canon->'characters') c where c->>'id' = item->>'subject_character_id')
    ) or exists (
      select 1 from jsonb_array_elements(p_canon->'knowledge_scopes') item
      where not exists (select 1 from jsonb_array_elements(p_canon->'characters') c where c->>'id' = item->>'character_id')
         or not exists (select 1 from jsonb_array_elements(p_canon->'facts_ledger') f where f->>'id' = item->>'fact_id')
    ) or exists (
      select 1 from jsonb_array_elements(p_canon->'chapter_blueprints') item
      cross join lateral jsonb_array_elements_text(item->'introduces_characters') ref
      where not exists (select 1 from jsonb_array_elements(p_canon->'characters') c where c->>'id' = ref)
    ) or exists (
      select 1 from jsonb_array_elements(p_canon->'chapter_blueprints') item
      cross join lateral jsonb_array_elements_text(item->'forbidden_reveals') ref
      where not exists (select 1 from jsonb_array_elements(p_canon->'secrets_reveals') s where s->>'id' = ref)
    )
  then
    raise exception using errcode = '22023', message = 'NONLOCAL_CANON_REFERENCE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_story_id, 0));

  select s.owner_user_id into v_existing_owner
  from public.stories s where s.id = v_story_id for update;
  if found and v_existing_owner is distinct from p_owner_user_id then
    return jsonb_build_object('ok', false, 'status', 'OWNER_MISMATCH');
  end if;

  -- Global IDs may be reused only by the story being atomically replaced.
  if exists (
      select 1 from public.characters existing
      join jsonb_array_elements(p_canon->'characters') item on item->>'id' = existing.id
      where existing.story_id <> v_story_id
    ) or exists (
      select 1 from public.facts_ledger existing
      join jsonb_array_elements(p_canon->'facts_ledger') item on item->>'id' = existing.id
      where existing.story_id <> v_story_id
    ) or exists (
      select 1 from public.secrets_reveals existing
      join jsonb_array_elements(p_canon->'secrets_reveals') item on item->>'id' = existing.id
      where existing.story_id <> v_story_id
    ) or exists (
      select 1 from public.story_threads existing
      join jsonb_array_elements(p_canon->'story_threads') item on item->>'id' = existing.id
      where existing.story_id <> v_story_id
    )
  then
    raise exception using errcode = '22023', message = 'CROSS_STORY_CANON_ID';
  end if;

  insert into public.stories (
    id, title, cover, tagline, role, tropes, total_chapters, synopsis,
    status, current_chapter, jejak, ending_name, owner_user_id, visibility
  ) values (
    v_story_id, v_title, v_cover, v_tagline, v_role, v_tropes, p_total_chapters, v_synopsis,
    'BARU', 0, '[]'::jsonb, null, p_owner_user_id, 'private'
  )
  on conflict (id) do update set
    title=excluded.title, cover=excluded.cover, tagline=excluded.tagline, role=excluded.role,
    tropes=excluded.tropes, total_chapters=excluded.total_chapters, synopsis=excluded.synopsis
  where public.stories.owner_user_id = p_owner_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'OWNER_MISMATCH');
  end if;

  delete from public.chapter_blueprints where story_id=v_story_id;
  delete from public.act_rollups where story_id=v_story_id;
  delete from public.story_threads where story_id=v_story_id;
  delete from public.timeline_events where story_id=v_story_id;
  delete from public.secrets_reveals where story_id=v_story_id;
  delete from public.knowledge_scopes where story_id=v_story_id;
  delete from public.facts_ledger where story_id=v_story_id;
  delete from public.character_aliases where story_id=v_story_id;
  delete from public.character_voice_sheets where story_id=v_story_id;
  delete from public.character_states cs using public.characters c
    where cs.character_id=c.id and c.story_id=v_story_id;
  delete from public.characters where story_id=v_story_id;

  insert into public.characters (id,story_id,canonical_name,role,motivation,introduced_chapter)
  select x.id,v_story_id,x.canonical_name,x.role,x.motivation,x.introduced_chapter
  from jsonb_to_recordset(p_canon->'characters') x(id text,canonical_name text,role text,motivation text,introduced_chapter integer,status text);
  insert into public.character_states (character_id,as_of_chapter,status,attributes)
  select x.id,x.introduced_chapter,x.status,'{}'::jsonb
  from jsonb_to_recordset(p_canon->'characters') x(id text,introduced_chapter integer,status text);
  insert into public.character_aliases (story_id,character_id,alias,alias_type)
  select v_story_id,x.character_id,x.alias,x.alias_type
  from jsonb_to_recordset(p_canon->'character_aliases') x(character_id text,alias text,alias_type text);
  insert into public.character_voice_sheets (story_id,character_id,register,speech_habits,forbidden_words,sample_lines)
  select v_story_id,x.character_id,x.register,x.speech_habits,x.forbidden_words,x.sample_lines
  from jsonb_to_recordset(p_canon->'character_voice_sheets') x(character_id text,register text,speech_habits jsonb,forbidden_words jsonb,sample_lines jsonb);
  insert into public.facts_ledger (id,story_id,statement,subject_character_id,established_chapter,salience,load_bearing,paid_off)
  select x.id,v_story_id,x.statement,x.subject_character_id,x.established_chapter,x.salience,x.load_bearing,x.paid_off
  from jsonb_to_recordset(p_canon->'facts_ledger') x(id text,statement text,subject_character_id text,established_chapter integer,salience real,load_bearing boolean,paid_off boolean);
  insert into public.knowledge_scopes (story_id,character_id,fact_id,known_from_chapter)
  select v_story_id,x.character_id,x.fact_id,x.known_from_chapter
  from jsonb_to_recordset(p_canon->'knowledge_scopes') x(character_id text,fact_id text,known_from_chapter integer);
  insert into public.secrets_reveals (id,story_id,description,reveal_gate_chapter,revealed)
  select x.id,v_story_id,x.description,x.reveal_gate_chapter,x.revealed
  from jsonb_to_recordset(p_canon->'secrets_reveals') x(id text,description text,reveal_gate_chapter integer,revealed boolean);
  insert into public.timeline_events (story_id,chapter_number,ordinal,description,is_flashback,occurs_at)
  select v_story_id,x.chapter_number,x.ordinal,x.description,x.is_flashback,x.occurs_at
  from jsonb_to_recordset(p_canon->'timeline_events') x(chapter_number integer,ordinal integer,description text,is_flashback boolean,occurs_at real);
  insert into public.story_threads (id,story_id,title,status,opened_chapter,last_touched_chapter,payoff_window,is_main_mystery,stale,stale_since_chapter)
  select x.id,v_story_id,x.title,x.status,x.opened_chapter,x.last_touched_chapter,x.payoff_window,x.is_main_mystery,x.stale,x.stale_since_chapter
  from jsonb_to_recordset(p_canon->'story_threads') x(id text,title text,status text,opened_chapter integer,last_touched_chapter integer,payoff_window integer,is_main_mystery boolean,stale boolean,stale_since_chapter integer);
  insert into public.act_rollups (story_id,act_number,summary,state_delta,covers_from_chapter,covers_to_chapter)
  select v_story_id,x.act_number,x.summary,x.state_delta,x.covers_from_chapter,x.covers_to_chapter
  from jsonb_to_recordset(p_canon->'act_rollups') x(act_number integer,summary text,state_delta jsonb,covers_from_chapter integer,covers_to_chapter integer);
  insert into public.chapter_blueprints (story_id,chapter_number,version,phase,chapter_goal,mandatory_beats,forbidden_reveals,allowed_state_delta,introduces_characters,reconciled_from_version,reconciliation_reason)
  select v_story_id,x.chapter_number,x.version,x.phase,x.chapter_goal,x.mandatory_beats,x.forbidden_reveals,x.allowed_state_delta,x.introduces_characters,x.reconciled_from_version,x.reconciliation_reason
  from jsonb_to_recordset(p_canon->'chapter_blueprints') x(chapter_number integer,version integer,phase text,chapter_goal text,mandatory_beats jsonb,forbidden_reveals jsonb,allowed_state_delta jsonb,introduces_characters jsonb,reconciled_from_version integer,reconciliation_reason text);

  return jsonb_build_object('ok',true,'status','REPLACED');
end;
$$;

revoke all on function public.replace_authoring_story_bible_v1(
  text,uuid,text,text,text,text,jsonb,integer,text,jsonb
) from public, anon, authenticated;
grant execute on function public.replace_authoring_story_bible_v1(
  text,uuid,text,text,text,text,jsonb,integer,text,jsonb
) to service_role;

comment on function public.replace_authoring_story_bible_v1(
  text,uuid,text,text,text,text,jsonb,integer,text,jsonb
) is 'Service-only transactional authoring replacement with deep row, locality, uniqueness, and reference validation before writes.';
