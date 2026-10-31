-- Persist one validated personalized contract and its initial canon atomically.

alter table public.story_generation_contracts
  add column if not exists bootstrap_payload_hash text null;

drop function if exists public.bootstrap_personalized_story_v1(
  text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
);

create or replace function public.bootstrap_personalized_story_v1(
  p_story_id text,
  p_owner_user_id uuid,
  p_contract_source text,
  p_onboarding_json jsonb,
  p_story_contract_json jsonb,
  p_route_schema_json jsonb,
  p_plot_debts_json jsonb,
  p_ending_candidates_json jsonb,
  p_characters jsonb,
  p_character_aliases jsonb,
  p_voice_sheets jsonb,
  p_facts jsonb,
  p_knowledge jsonb,
  p_secrets jsonb,
  p_threads jsonb,
  p_blueprints jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_story public.stories%rowtype;
  v_payload_hash text;
  v_character_ids text[];
  v_fact_ids text[];
  v_secret_ids text[];
  v_thread_ids text[];
  v_expected_contract_keys constant text[] := array[
    'storyId','totalChapters','title','genre','tone','styleProfile','mainCharacter',
    'mainConflict','finalQuestion','corePromise','actPlan','chapterTargets',
    'revealRunway','closureRunway'
  ];
begin
  -- Bound full request before traversing nested JSON.
  if p_owner_user_id is null
    or p_story_id is null or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) not between 1 and 128
    or p_contract_source not in ('llm', 'llm_repaired', 'template_fallback')
    or pg_catalog.pg_column_size(pg_catalog.jsonb_build_object(
      'onboarding', p_onboarding_json, 'contract', p_story_contract_json,
      'route', p_route_schema_json, 'debts', p_plot_debts_json,
      'endings', p_ending_candidates_json, 'characters', p_characters,
      'aliases', p_character_aliases, 'voices', p_voice_sheets, 'facts', p_facts,
      'knowledge', p_knowledge, 'secrets', p_secrets, 'threads', p_threads,
      'blueprints', p_blueprints
    )) > 4 * 1024 * 1024
  then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_PAYLOAD';
  end if;

  -- Split contract payload keeps exact top-level shape and bounded scalar/array types.
  if pg_catalog.jsonb_typeof(p_onboarding_json) is distinct from 'object'
    or pg_catalog.pg_column_size(p_onboarding_json) > 64 * 1024
    or pg_catalog.jsonb_typeof(p_story_contract_json) is distinct from 'object'
    or not (p_story_contract_json ?& v_expected_contract_keys)
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_story_contract_json)) <> pg_catalog.cardinality(v_expected_contract_keys)
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_story_contract_json) k where not (k = any(v_expected_contract_keys)))
    or pg_catalog.jsonb_typeof(p_story_contract_json->'storyId') <> 'string'
    or p_story_contract_json->>'storyId' is distinct from p_story_id
    or pg_catalog.jsonb_typeof(p_story_contract_json->'totalChapters') <> 'number'
    or (p_story_contract_json->>'totalChapters')::numeric <> 50
    or pg_catalog.jsonb_typeof(p_story_contract_json->'title') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'title') not between 1 and 160
    or pg_catalog.jsonb_typeof(p_story_contract_json->'genre') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'genre') not between 1 and 80
    or pg_catalog.jsonb_typeof(p_story_contract_json->'tone') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'tone') not between 1 and 160
    or p_story_contract_json->>'styleProfile' is distinct from 'lakoku_mobile_drama_v1'
    or pg_catalog.jsonb_typeof(p_story_contract_json->'mainCharacter') <> 'object'
    or not (p_story_contract_json->'mainCharacter' ?& array['name','role','wound','desire'])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_story_contract_json->'mainCharacter')) <> 4
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_story_contract_json->'mainCharacter') k where not (k = any(array['name','role','wound','desire'])))
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,name}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,name}') not between 1 and 100
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,role}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,role}') not between 1 and 120
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,wound}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,wound}') not between 1 and 500
    or pg_catalog.jsonb_typeof(p_story_contract_json#>'{mainCharacter,desire}') <> 'string'
    or pg_catalog.char_length(p_story_contract_json#>>'{mainCharacter,desire}') not between 1 and 500
    or pg_catalog.jsonb_typeof(p_story_contract_json->'mainConflict') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'mainConflict') not between 1 and 800
    or pg_catalog.jsonb_typeof(p_story_contract_json->'finalQuestion') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'finalQuestion') not between 1 and 500
    or pg_catalog.jsonb_typeof(p_story_contract_json->'corePromise') <> 'string'
    or pg_catalog.char_length(p_story_contract_json->>'corePromise') not between 1 and 800
    or pg_catalog.jsonb_typeof(p_story_contract_json->'actPlan') <> 'array'
    or pg_catalog.jsonb_array_length(p_story_contract_json->'actPlan') not between 1 and 12
    or pg_catalog.jsonb_typeof(p_story_contract_json->'chapterTargets') <> 'array'
    or pg_catalog.jsonb_array_length(p_story_contract_json->'chapterTargets') <> 50
    or pg_catalog.jsonb_typeof(p_story_contract_json->'revealRunway') <> 'array'
    or pg_catalog.jsonb_array_length(p_story_contract_json->'revealRunway') not between 1 and 20
    or pg_catalog.jsonb_typeof(p_story_contract_json->'closureRunway') <> 'object'
    or p_story_contract_json ? 'plotDebts'
    or p_story_contract_json ? 'endingCandidates'
    or pg_catalog.jsonb_typeof(p_route_schema_json) is distinct from 'object'
    or pg_catalog.pg_column_size(p_route_schema_json) > 256 * 1024
    or pg_catalog.jsonb_typeof(p_plot_debts_json) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_plot_debts_json) not between 1 and 20
    or pg_catalog.jsonb_typeof(p_ending_candidates_json) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_ending_candidates_json) not between 2 and 8
  then
    raise exception using errcode = '22023', message = 'INVALID_CONTRACT';
  end if;

  -- Exact nested contract keys and scalar bounds.
  if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_story_contract_json->'actPlan') item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['actNumber','fromChapter','toChapter','goal'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 4
        or pg_catalog.jsonb_typeof(item->'actNumber') <> 'number'
        or (item->>'actNumber')::numeric <> pg_catalog.trunc((item->>'actNumber')::numeric)
        or (item->>'actNumber')::numeric not between 1 and 12
        or pg_catalog.jsonb_typeof(item->'fromChapter') <> 'number'
        or (item->>'fromChapter')::numeric <> pg_catalog.trunc((item->>'fromChapter')::numeric)
        or (item->>'fromChapter')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'toChapter') <> 'number'
        or (item->>'toChapter')::numeric <> pg_catalog.trunc((item->>'toChapter')::numeric)
        or (item->>'toChapter')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'goal') <> 'string'
        or pg_catalog.char_length(item->>'goal') not between 1 and 500
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_story_contract_json->'chapterTargets') item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['chapterNumber','phase','goal','mustInclude','mustNotReveal','emotionalTurn','expectedThreadMovement'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 7
        or pg_catalog.jsonb_typeof(item->'chapterNumber') <> 'number'
        or (item->>'chapterNumber')::numeric <> pg_catalog.trunc((item->>'chapterNumber')::numeric)
        or (item->>'chapterNumber')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'phase') <> 'string' or pg_catalog.char_length(item->>'phase') not between 1 and 80
        or pg_catalog.jsonb_typeof(item->'goal') <> 'string' or pg_catalog.char_length(item->>'goal') not between 1 and 700
        or pg_catalog.jsonb_typeof(item->'mustInclude') <> 'array' or pg_catalog.jsonb_array_length(item->'mustInclude') not between 1 and 8
        or pg_catalog.jsonb_typeof(item->'mustNotReveal') <> 'array' or pg_catalog.jsonb_array_length(item->'mustNotReveal') > 20
        or pg_catalog.jsonb_typeof(item->'emotionalTurn') <> 'string' or pg_catalog.char_length(item->>'emotionalTurn') not between 1 and 500
        or pg_catalog.jsonb_typeof(item->'expectedThreadMovement') <> 'array' or pg_catalog.jsonb_array_length(item->'expectedThreadMovement') not between 1 and 8
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'mustInclude') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 400)
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'mustNotReveal') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 160)
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'expectedThreadMovement') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 500)
    ) or (select pg_catalog.count(distinct (item->>'chapterNumber')::integer) from pg_catalog.jsonb_array_elements(p_story_contract_json->'chapterTargets') item) <> 50
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_plot_debts_json) item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['id','question','introducedAt','mustProgressBy','mustCloseBy','status'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 6
        or pg_catalog.jsonb_typeof(item->'id') <> 'string' or pg_catalog.char_length(item->>'id') not between 1 and 100
        or pg_catalog.jsonb_typeof(item->'question') <> 'string' or pg_catalog.char_length(item->>'question') not between 1 and 500
        or pg_catalog.jsonb_typeof(item->'introducedAt') <> 'number' or (item->>'introducedAt')::numeric not between 1 and 50
        or pg_catalog.jsonb_typeof(item->'mustProgressBy') <> 'array' or pg_catalog.jsonb_array_length(item->'mustProgressBy') not between 1 and 12
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'mustProgressBy') v where pg_catalog.jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<>pg_catalog.trunc((v#>>'{}')::numeric) or (v#>>'{}')::numeric not between 1 and 50)
        or pg_catalog.jsonb_typeof(item->'mustCloseBy') <> 'number' or (item->>'mustCloseBy')::numeric not between 1 and 50
        or item->>'status' not in ('open','progressing','closed')
    ) or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'id') from pg_catalog.jsonb_array_elements(p_plot_debts_json) item)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_ending_candidates_json) item
      where pg_catalog.jsonb_typeof(item) <> 'object'
        or not (item ?& array['key','name','condition','requiredClosure'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 4
        or pg_catalog.jsonb_typeof(item->'key') <> 'string' or pg_catalog.char_length(item->>'key') not between 1 and 80
        or pg_catalog.jsonb_typeof(item->'name') <> 'string' or pg_catalog.char_length(item->>'name') not between 1 and 160
        or pg_catalog.jsonb_typeof(item->'condition') <> 'string' or pg_catalog.char_length(item->>'condition') not between 1 and 500
        or pg_catalog.jsonb_typeof(item->'requiredClosure') <> 'array' or pg_catalog.jsonb_array_length(item->'requiredClosure') not between 1 and 8
        or exists(select 1 from pg_catalog.jsonb_array_elements(item->'requiredClosure') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 400)
    ) or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'key') from pg_catalog.jsonb_array_elements(p_ending_candidates_json) item)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_story_contract_json->'revealRunway') item
      where pg_catalog.jsonb_typeof(item)<>'object'
        or not(item?&array['secretId','revealGateChapter'])
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
        or pg_catalog.jsonb_typeof(item->'secretId')<>'string'
        or pg_catalog.char_length(item->>'secretId') not between 1 and 100
        or pg_catalog.jsonb_typeof(item->'revealGateChapter')<>'number'
        or (item->>'revealGateChapter')::numeric<>pg_catalog.trunc((item->>'revealGateChapter')::numeric)
        or (item->>'revealGateChapter')::numeric not between 1 and 50
    )
    or (select pg_catalog.count(*)<>pg_catalog.count(distinct item->>'secretId') from pg_catalog.jsonb_array_elements(p_story_contract_json->'revealRunway') item)
  then
    raise exception using errcode = '22023', message = 'INVALID_CONTRACT_ROW';
  end if;

  if pg_catalog.jsonb_typeof(p_characters) is distinct from 'array' or pg_catalog.jsonb_array_length(p_characters) not between 1 and 100
    or pg_catalog.jsonb_typeof(p_character_aliases) is distinct from 'array' or pg_catalog.jsonb_array_length(p_character_aliases) > 500
    or pg_catalog.jsonb_typeof(p_voice_sheets) is distinct from 'array' or pg_catalog.jsonb_array_length(p_voice_sheets) > 100
    or pg_catalog.jsonb_typeof(p_facts) is distinct from 'array' or pg_catalog.jsonb_array_length(p_facts) > 1000
    or pg_catalog.jsonb_typeof(p_knowledge) is distinct from 'array' or pg_catalog.jsonb_array_length(p_knowledge) > 5000
    or pg_catalog.jsonb_typeof(p_secrets) is distinct from 'array' or pg_catalog.jsonb_array_length(p_secrets) > 500
    or pg_catalog.jsonb_typeof(p_threads) is distinct from 'array' or pg_catalog.jsonb_array_length(p_threads) > 500
    or pg_catalog.jsonb_typeof(p_blueprints) is distinct from 'array' or pg_catalog.jsonb_array_length(p_blueprints) <> 50
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON';
  end if;

  -- Every canon row has exact keys, required JSON scalar types, and authoring bounds.
  -- Integer chapter/version fields require trunc(...)=value (reject 1.5); nullable numbers checked when present.
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_characters) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','canonical_name','role','motivation','introduced_chapter']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>6 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'canonical_name')<>'string' or pg_catalog.char_length(i->>'canonical_name') not between 2 and 60 or pg_catalog.jsonb_typeof(i->'role')<>'string' or pg_catalog.char_length(i->>'role') not between 2 and 60 or pg_catalog.jsonb_typeof(i->'motivation')<>'string' or pg_catalog.char_length(i->>'motivation') not between 10 and 240 or pg_catalog.jsonb_typeof(i->'introduced_chapter')<>'number' or (i->>'introduced_chapter')::numeric<>pg_catalog.trunc((i->>'introduced_chapter')::numeric) or (i->>'introduced_chapter')::numeric not between 1 and 50)
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_character_aliases) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','character_id','alias','alias_type']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>4 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'character_id')<>'string' or pg_catalog.char_length(i->>'character_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'alias')<>'string' or pg_catalog.char_length(i->>'alias') not between 1 and 60 or i->>'alias_type' not in ('NAME','NICKNAME','RELATION','TITLE'))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_voice_sheets) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','character_id','register','speech_habits','forbidden_words','sample_lines']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>6 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'character_id')<>'string' or pg_catalog.char_length(i->>'character_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'register')<>'string' or pg_catalog.char_length(i->>'register') not between 3 and 140 or pg_catalog.jsonb_typeof(i->'speech_habits')<>'array' or pg_catalog.jsonb_array_length(i->'speech_habits')>6 or pg_catalog.jsonb_typeof(i->'forbidden_words')<>'array' or pg_catalog.jsonb_array_length(i->'forbidden_words')>10 or pg_catalog.jsonb_typeof(i->'sample_lines')<>'array' or pg_catalog.jsonb_array_length(i->'sample_lines') not between 1 and 4 or exists(select 1 from pg_catalog.jsonb_array_elements(i->'speech_habits') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 2 and 120) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'forbidden_words') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 40) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'sample_lines') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 3 and 200))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_facts) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','statement','subject_character_id','established_chapter','salience','load_bearing','paid_off']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>8 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'statement')<>'string' or pg_catalog.char_length(i->>'statement') not between 8 and 240 or pg_catalog.jsonb_typeof(i->'subject_character_id') not in ('string','null') or (pg_catalog.jsonb_typeof(i->'subject_character_id')='string' and pg_catalog.char_length(i->>'subject_character_id') not between 1 and 256) or pg_catalog.jsonb_typeof(i->'established_chapter')<>'number' or (i->>'established_chapter')::numeric<>pg_catalog.trunc((i->>'established_chapter')::numeric) or (i->>'established_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'salience')<>'number' or (i->>'salience')::numeric not between 0 and 1 or pg_catalog.jsonb_typeof(i->'load_bearing')<>'boolean' or pg_catalog.jsonb_typeof(i->'paid_off')<>'boolean')
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_knowledge) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','character_id','fact_id','known_from_chapter']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>4 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'character_id')<>'string' or pg_catalog.char_length(i->>'character_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'fact_id')<>'string' or pg_catalog.char_length(i->>'fact_id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'known_from_chapter')<>'number' or (i->>'known_from_chapter')::numeric<>pg_catalog.trunc((i->>'known_from_chapter')::numeric) or (i->>'known_from_chapter')::numeric not between 1 and 50)
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_secrets) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','description','reveal_gate_chapter','revealed']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>5 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'description')<>'string' or pg_catalog.char_length(i->>'description') not between 15 and 300 or pg_catalog.jsonb_typeof(i->'reveal_gate_chapter')<>'number' or (i->>'reveal_gate_chapter')::numeric<>pg_catalog.trunc((i->>'reveal_gate_chapter')::numeric) or (i->>'reveal_gate_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'revealed')<>'boolean')
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_threads) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['id','story_id','title','status','opened_chapter','last_touched_chapter','payoff_window','is_main_mystery','stale','stale_since_chapter']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>10 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'id')<>'string' or pg_catalog.char_length(i->>'id') not between 1 and 256 or pg_catalog.jsonb_typeof(i->'title')<>'string' or pg_catalog.char_length(i->>'title') not between 5 and 120 or i->>'status' not in ('OPEN','DEVELOPING','PAYOFF_DUE','RESOLVED','ABANDONED_APPROVED') or pg_catalog.jsonb_typeof(i->'opened_chapter')<>'number' or (i->>'opened_chapter')::numeric<>pg_catalog.trunc((i->>'opened_chapter')::numeric) or (i->>'opened_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'last_touched_chapter')<>'number' or (i->>'last_touched_chapter')::numeric<>pg_catalog.trunc((i->>'last_touched_chapter')::numeric) or (i->>'last_touched_chapter')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'payoff_window') not in ('number','null') or (pg_catalog.jsonb_typeof(i->'payoff_window')='number' and ((i->>'payoff_window')::numeric<>pg_catalog.trunc((i->>'payoff_window')::numeric) or (i->>'payoff_window')::numeric not between 1 and 50)) or pg_catalog.jsonb_typeof(i->'is_main_mystery')<>'boolean' or pg_catalog.jsonb_typeof(i->'stale')<>'boolean' or pg_catalog.jsonb_typeof(i->'stale_since_chapter') not in ('number','null') or (pg_catalog.jsonb_typeof(i->'stale_since_chapter')='number' and ((i->>'stale_since_chapter')::numeric<>pg_catalog.trunc((i->>'stale_since_chapter')::numeric) or (i->>'stale_since_chapter')::numeric not between 1 and 50)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_blueprints) i where pg_catalog.jsonb_typeof(i)<>'object' or not(i?&array['story_id','chapter_number','version','phase','chapter_goal','mandatory_beats','forbidden_reveals','allowed_state_delta','introduces_characters','reconciled_from_version','reconciliation_reason']) or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(i))<>11 or i->>'story_id' is distinct from p_story_id or pg_catalog.jsonb_typeof(i->'chapter_number')<>'number' or (i->>'chapter_number')::numeric<>pg_catalog.trunc((i->>'chapter_number')::numeric) or (i->>'chapter_number')::numeric not between 1 and 50 or pg_catalog.jsonb_typeof(i->'version')<>'number' or (i->>'version')::numeric<>pg_catalog.trunc((i->>'version')::numeric) or (i->>'version')::numeric not between 1 and 1000 or pg_catalog.jsonb_typeof(i->'phase')<>'string' or pg_catalog.char_length(i->>'phase') not between 1 and 120 or pg_catalog.jsonb_typeof(i->'chapter_goal')<>'string' or pg_catalog.char_length(i->>'chapter_goal') not between 1 and 500 or pg_catalog.jsonb_typeof(i->'mandatory_beats')<>'array' or pg_catalog.jsonb_array_length(i->'mandatory_beats')>50 or pg_catalog.jsonb_typeof(i->'forbidden_reveals')<>'array' or pg_catalog.jsonb_array_length(i->'forbidden_reveals')>500 or pg_catalog.jsonb_typeof(i->'allowed_state_delta')<>'object' or i->'allowed_state_delta' <> '{}'::jsonb or pg_catalog.jsonb_typeof(i->'introduces_characters')<>'array' or pg_catalog.jsonb_array_length(i->'introduces_characters')>100 or pg_catalog.jsonb_typeof(i->'reconciled_from_version') not in ('number','null') or (pg_catalog.jsonb_typeof(i->'reconciled_from_version')='number' and ((i->>'reconciled_from_version')::numeric<>pg_catalog.trunc((i->>'reconciled_from_version')::numeric) or (i->>'reconciled_from_version')::numeric not between 1 and 1000)) or pg_catalog.jsonb_typeof(i->'reconciliation_reason') not in ('string','null') or (pg_catalog.jsonb_typeof(i->'reconciliation_reason')='string' and pg_catalog.char_length(i->>'reconciliation_reason') not between 1 and 500) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'mandatory_beats') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 500) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'forbidden_reveals') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 256) or exists(select 1 from pg_catalog.jsonb_array_elements(i->'introduces_characters') v where pg_catalog.jsonb_typeof(v)<>'string' or pg_catalog.char_length(v#>>'{}') not between 1 and 256))
  then
    raise exception using errcode = '22023', message = 'INVALID_CANON_ROW';
  end if;

  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_character_ids from pg_catalog.jsonb_array_elements(p_characters) item;
  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_fact_ids from pg_catalog.jsonb_array_elements(p_facts) item;
  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_secret_ids from pg_catalog.jsonb_array_elements(p_secrets) item;
  select pg_catalog.array_agg(item->>'id' order by item->>'id') into v_thread_ids from pg_catalog.jsonb_array_elements(p_threads) item;

  if (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_character_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct pg_catalog.lower(item->>'alias')) from pg_catalog.jsonb_array_elements(p_character_aliases) item)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'character_id') from pg_catalog.jsonb_array_elements(p_voice_sheets) item)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_fact_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct (item->>'character_id',item->>'fact_id')) from pg_catalog.jsonb_array_elements(p_knowledge) item)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_secret_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct id) from pg_catalog.unnest(v_thread_ids) id)
    or (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'chapter_number') from pg_catalog.jsonb_array_elements(p_blueprints) item)
  then
    raise exception using errcode = '22023', message = 'DUPLICATE_CANON_ROW';
  end if;

  if exists (select 1 from pg_catalog.jsonb_array_elements(p_character_aliases) i where not ((i->>'character_id')=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_voice_sheets) i where not ((i->>'character_id')=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_facts) i where pg_catalog.jsonb_typeof(i->'subject_character_id')='string' and not ((i->>'subject_character_id')=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_knowledge) i where not ((i->>'character_id')=any(v_character_ids)) or not ((i->>'fact_id')=any(v_fact_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_blueprints) i cross join lateral pg_catalog.jsonb_array_elements_text(i->'introduces_characters') ref where not(ref=any(v_character_ids)))
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_blueprints) i cross join lateral pg_catalog.jsonb_array_elements_text(i->'forbidden_reveals') ref where not(ref=any(v_secret_ids)))
  then
    raise exception using errcode = '22023', message = 'NONLOCAL_CANON_REFERENCE';
  end if;

  v_payload_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source',p_contract_source,'onboarding',p_onboarding_json,'contract',p_story_contract_json,
    'route',p_route_schema_json,'debts',p_plot_debts_json,'endings',p_ending_candidates_json,
    'characters',p_characters,'aliases',p_character_aliases,'voices',p_voice_sheets,
    'facts',p_facts,'knowledge',p_knowledge,'secrets',p_secrets,'threads',p_threads,
    'blueprints',p_blueprints
  )::text);

  -- Existing shell is mandatory. Row lock serializes first write and retries.
  select s.* into v_story from public.stories s where s.id=p_story_id for update;
  if not found then raise exception using errcode='P0001', message='STORY_SHELL_NOT_FOUND'; end if;
  if v_story.owner_user_id is null or v_story.owner_user_id is distinct from p_owner_user_id then raise exception using errcode='42501', message='STORY_OWNER_MISMATCH'; end if;
  if v_story.story_mode is distinct from 'personalized_ai' then raise exception using errcode='22023', message='INVALID_STORY_MODE'; end if;
  if v_story.visibility is distinct from 'private' then raise exception using errcode='22023', message='STORY_NOT_PRIVATE'; end if;
  if v_story.status is distinct from 'BARU' or v_story.current_chapter <> 0 or v_story.generation_status not in ('creating_contract','failed') then raise exception using errcode='55000', message='STORY_LIFECYCLE_STARTED'; end if;

  if exists(select 1 from public.chapters where story_id=p_story_id)
    or exists(select 1 from public.reader_states where story_id=p_story_id)
    or exists(select 1 from public.generation_leases where story_id=p_story_id)
    or exists(select 1 from public.story_events where story_id=p_story_id)
    or exists(select 1 from public.retrieval_logs where story_id=p_story_id)
  then
    raise exception using errcode='55000', message='STORY_GENERATION_STARTED';
  end if;

  if exists(select 1 from public.story_generation_contracts where story_id=p_story_id) then
    if (select bootstrap_payload_hash from public.story_generation_contracts where story_id=p_story_id) is distinct from v_payload_hash then
      raise exception using errcode='23000', message='BOOTSTRAP_PAYLOAD_MISMATCH';
    end if;
    return;
  end if;

  -- Reject globally keyed IDs owned by another story before first canon write.
  if exists(select 1 from public.characters c where c.id=any(v_character_ids))
    or exists(select 1 from public.facts_ledger f where f.id=any(v_fact_ids))
    or exists(select 1 from public.secrets_reveals s where s.id=any(v_secret_ids))
    or exists(select 1 from public.story_threads t where t.id=any(v_thread_ids))
  then raise exception using errcode='22023', message='CANON_ID_ALREADY_EXISTS'; end if;

  insert into public.story_generation_contracts(
    story_id,mode,total_chapters,contract_source,onboarding_json,story_contract_json,
    route_schema_json,plot_debts_json,ending_candidates_json,ending_lock_json,
    quality_profile,bootstrap_payload_hash
  ) values (
    p_story_id,'personalized_ai',50,p_contract_source,p_onboarding_json,p_story_contract_json,
    p_route_schema_json,p_plot_debts_json,p_ending_candidates_json,null,
    'lakoku_mobile_drama_v1',v_payload_hash
  );

  insert into public.characters(id,story_id,canonical_name,role,motivation,introduced_chapter)
  select x.id,x.story_id,x.canonical_name,x.role,x.motivation,x.introduced_chapter from pg_catalog.jsonb_to_recordset(p_characters) x(id text,story_id text,canonical_name text,role text,motivation text,introduced_chapter integer);
  insert into public.character_states(character_id,as_of_chapter,status,attributes)
  select x.id,x.introduced_chapter,'ALIVE','{}'::jsonb from pg_catalog.jsonb_to_recordset(p_characters) x(id text,introduced_chapter integer);
  insert into public.character_aliases(story_id,character_id,alias,alias_type)
  select x.story_id,x.character_id,x.alias,x.alias_type from pg_catalog.jsonb_to_recordset(p_character_aliases) x(story_id text,character_id text,alias text,alias_type text);
  insert into public.character_voice_sheets(story_id,character_id,register,speech_habits,forbidden_words,sample_lines)
  select x.story_id,x.character_id,x.register,x.speech_habits,x.forbidden_words,x.sample_lines from pg_catalog.jsonb_to_recordset(p_voice_sheets) x(story_id text,character_id text,register text,speech_habits jsonb,forbidden_words jsonb,sample_lines jsonb);
  insert into public.facts_ledger(id,story_id,statement,subject_character_id,established_chapter,salience,load_bearing,paid_off)
  select x.id,x.story_id,x.statement,x.subject_character_id,x.established_chapter,x.salience,x.load_bearing,x.paid_off from pg_catalog.jsonb_to_recordset(p_facts) x(id text,story_id text,statement text,subject_character_id text,established_chapter integer,salience real,load_bearing boolean,paid_off boolean);
  insert into public.knowledge_scopes(story_id,character_id,fact_id,known_from_chapter)
  select x.story_id,x.character_id,x.fact_id,x.known_from_chapter from pg_catalog.jsonb_to_recordset(p_knowledge) x(story_id text,character_id text,fact_id text,known_from_chapter integer);
  insert into public.secrets_reveals(id,story_id,description,reveal_gate_chapter,revealed)
  select x.id,x.story_id,x.description,x.reveal_gate_chapter,x.revealed from pg_catalog.jsonb_to_recordset(p_secrets) x(id text,story_id text,description text,reveal_gate_chapter integer,revealed boolean);
  insert into public.story_threads(id,story_id,title,status,opened_chapter,last_touched_chapter,payoff_window,is_main_mystery,stale,stale_since_chapter)
  select x.id,x.story_id,x.title,x.status,x.opened_chapter,x.last_touched_chapter,x.payoff_window,x.is_main_mystery,x.stale,x.stale_since_chapter from pg_catalog.jsonb_to_recordset(p_threads) x(id text,story_id text,title text,status text,opened_chapter integer,last_touched_chapter integer,payoff_window integer,is_main_mystery boolean,stale boolean,stale_since_chapter integer);
  insert into public.chapter_blueprints(story_id,chapter_number,version,phase,chapter_goal,mandatory_beats,forbidden_reveals,allowed_state_delta,introduces_characters,reconciled_from_version,reconciliation_reason)
  select x.story_id,x.chapter_number,x.version,x.phase,x.chapter_goal,x.mandatory_beats,x.forbidden_reveals,x.allowed_state_delta,x.introduces_characters,x.reconciled_from_version,x.reconciliation_reason from pg_catalog.jsonb_to_recordset(p_blueprints) x(story_id text,chapter_number integer,version integer,phase text,chapter_goal text,mandatory_beats jsonb,forbidden_reveals jsonb,allowed_state_delta jsonb,introduces_characters jsonb,reconciled_from_version integer,reconciliation_reason text);
end;
$$;

revoke all on function public.bootstrap_personalized_story_v1(
  text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.bootstrap_personalized_story_v1(
  text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

comment on function public.bootstrap_personalized_story_v1(
  text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) is 'Service-role-only atomic first bootstrap for a pre-created private personalized story shell. Idempotent for identical payloads; never creates, updates, or converts stories; creates exactly 50 blueprints and zero chapters.';
