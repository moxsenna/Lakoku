begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Local setup only: ALTER DATABASE postgres SET lakoku.test_target = 'local-cli'; then reconnect.
-- Never set this marker on linked, staging, or production databases.
do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'premium story clone pgTAP tests require explicit local test target marker';
  end if;
end
$$;

select no_plan();

create or replace function pg_temp.seed_blueprints(p_story_id text, p_count integer)
returns void
language sql
as $$
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
    p_story_id,
    chapter_number,
    1,
    case when chapter_number <= 15 then 'ACT_1' when chapter_number <= 35 then 'ACT_2' else 'ACT_3' end,
    'Goal ' || chapter_number,
    jsonb_build_array('beat-' || chapter_number, 'char:hero'),
    jsonb_build_array('secret:key'),
    jsonb_build_object('thread', 'thread:main', 'fact', 'fact:clue'),
    jsonb_build_array('char:hero'),
    null,
    null,
    '2020-01-01 00:00:00+00'::timestamptz
  from generate_series(1, p_count) as chapter_number;
$$;

create or replace function pg_temp.seed_contract(p_story_id text)
returns void
language sql
as $$
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
  ) values (
    p_story_id,
    'premium_template',
    50,
    'llm_repaired',
    '{"hero":"char:hero","prose":"char:hero appears","char:hero":"char:hero"}'::jsonb,
    jsonb_build_object(
      'storyId', p_story_id,
      'nested', jsonb_build_array(
        'fact:clue',
        jsonb_build_object('secret', 'secret:key', 'thread', 'thread:main')
      )
    ),
    '{"focus":"char:hero","unknown":"not-an-id"}'::jsonb,
    '[{"fact":"fact:clue"}]'::jsonb,
    '[{"thread":"thread:main","secret":"secret:key"}]'::jsonb,
    '{"character":"char:hero"}'::jsonb,
    'lakoku_mobile_drama_v1',
    '2020-01-01 00:00:00+00'::timestamptz,
    '2020-01-02 00:00:00+00'::timestamptz
  );
$$;

create or replace function pg_temp.seed_template_case(
  p_story_id text,
  p_story_mode text,
  p_visibility text,
  p_blueprint_count integer,
  p_with_contract boolean
)
returns void
language plpgsql
as $$
begin
  insert into public.stories (
    id, title, cover, tagline, role, tropes, total_chapters, synopsis,
    status, current_chapter, jejak, ending_name, created_at, owner_user_id,
    visibility, source_story_id, story_mode, generation_status, story_contract_version
  ) values (
    p_story_id, 'Template ' || p_story_id, '/cover.webp', 'A premium template', 'Hero',
    '["mystery"]'::jsonb, 50, 'Template synopsis',
    'SELESAI', 50, '["source-history"]'::jsonb, 'Source ending',
    '2020-01-01 00:00:00+00'::timestamptz, null,
    p_visibility, null, p_story_mode, 'ready', 7
  );

  if p_with_contract then
    perform pg_temp.seed_contract(p_story_id);
  end if;

  perform pg_temp.seed_blueprints(p_story_id, p_blueprint_count);
end;
$$;

create or replace function pg_temp.remapped_id(p_target_story_id text, p_kind text, p_old_id text)
returns text
language sql
immutable
as $$
  select p_target_story_id || ':' || p_kind || ':' || md5(p_old_id);
$$;

create or replace function pg_temp.clone_result(
  p_template_story_id text,
  p_user_id uuid,
  p_new_story_id text
)
returns jsonb
language plpgsql
as $$
begin
  return public.clone_premium_story_instance(p_template_story_id, p_user_id, p_new_story_id);
exception
  when others then
    return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'premium-clone-owner@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'premium-clone-other@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

select pg_temp.seed_template_case('premium:clone-source', 'premium_template', 'public', 50, true);

insert into public.characters (
  id, story_id, canonical_name, role, motivation, introduced_chapter, created_at
) values
  ('char:hero', 'premium:clone-source', 'Raka', 'Hero', 'Find truth', 1, '2020-01-01 00:00:00+00'),
  ('char:ally', 'premium:clone-source', 'Sari', 'Ally', 'Protect Raka', 1, '2020-01-01 00:00:00+00');

insert into public.character_states (
  character_id, status, as_of_chapter, attributes, updated_at
) values
  ('char:hero', 'ALIVE', 1,
   '{"self":"char:hero","ally":"char:ally","fact":"fact:clue","prose":"char:hero appears"}'::jsonb,
   '2020-01-02 00:00:00+00'),
  ('char:ally', 'ALIVE', 2, '{"secret":"secret:key","thread":"thread:main"}'::jsonb,
   '2020-01-02 00:00:00+00');

insert into public.character_aliases (
  story_id, character_id, alias, alias_type, created_at
) values
  ('premium:clone-source', 'char:hero', 'Raka', 'NAME', '2020-01-01 00:00:00+00'),
  ('premium:clone-source', 'char:ally', 'Penjaga', 'TITLE', '2020-01-01 00:00:00+00');

insert into public.character_voice_sheets (
  character_id, story_id, register, speech_habits, forbidden_words, sample_lines, created_at
) values
  ('char:hero', 'premium:clone-source', 'direct', '["char:ally"]', '["secret:key"]', '["fact:clue","char:hero says hello"]', '2020-01-01 00:00:00+00'),
  ('char:ally', 'premium:clone-source', 'formal', '["thread:main"]', '[]', '["char:hero"]', '2020-01-01 00:00:00+00');

insert into public.facts_ledger (
  id, story_id, statement, subject_character_id, established_chapter,
  salience, load_bearing, paid_off, created_at
) values
  ('fact:clue', 'premium:clone-source', 'A hidden clue exists.', 'char:hero', 1, 0.9, true, false, '2020-01-01 00:00:00+00'),
  ('fact:ally', 'premium:clone-source', 'Sari knows the route.', 'char:ally', 2, 0.7, false, false, '2020-01-01 00:00:00+00');

insert into public.knowledge_scopes (
  story_id, character_id, fact_id, known_from_chapter, created_at
) values
  ('premium:clone-source', 'char:hero', 'fact:clue', 1, '2020-01-01 00:00:00+00'),
  ('premium:clone-source', 'char:ally', 'fact:ally', 2, '2020-01-01 00:00:00+00');

insert into public.secrets_reveals (
  id, story_id, description, reveal_gate_chapter, revealed, created_at
) values
  ('secret:key', 'premium:clone-source', 'The key opens the archive.', 20, false, '2020-01-01 00:00:00+00'),
  ('secret:ally', 'premium:clone-source', 'Sari hid the map.', 30, true, '2020-01-01 00:00:00+00');

insert into public.story_threads (
  id, story_id, title, status, opened_chapter, last_touched_chapter,
  payoff_window, is_main_mystery, created_at, stale, stale_since_chapter
) values
  ('thread:main', 'premium:clone-source', 'Find the archive', 'DEVELOPING', 1, 10, 40, true, '2020-01-01 00:00:00+00', false, null),
  ('thread:ally', 'premium:clone-source', 'Trust Sari', 'OPEN', 2, 8, 35, false, '2020-01-01 00:00:00+00', true, 9);

insert into public.timeline_events (
  story_id, chapter_number, ordinal, description, is_flashback, occurs_at, created_at
) values
  ('premium:clone-source', 1, 1, 'Raka finds the first clue.', false, 1.0, '2020-01-01 00:00:00+00'),
  ('premium:clone-source', 2, 1, 'Sari remembers the archive.', true, 0.5, '2020-01-01 00:00:00+00');

insert into public.act_rollups (
  story_id, act_number, summary, state_delta, covers_from_chapter, covers_to_chapter, created_at
) values
  ('premium:clone-source', 1, 'The search begins.', '{"hero":"char:hero","fact":"fact:clue"}', 1, 15, '2020-01-01 00:00:00+00'),
  ('premium:clone-source', 2, 'Trust fractures.', '{"secret":"secret:key","thread":"thread:main"}', 16, 35, '2020-01-01 00:00:00+00');

insert into public.chapters (
  story_id, number, title, paragraphs, choice_prompt, choices, created_at
) values (
  'premium:clone-source', 1, 'The Locked Archive',
  '["char:hero","char:hero enters prose","fact:clue"]'::jsonb,
  'What should Raka do?',
  '[{"id":"open-door","label":"Open the archive door"},{"id":"wait","label":"Guard the hallway"}]'::jsonb,
  '2020-01-01 00:00:00+00'
);

insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number,
  is_ending, created_at, effect_json, choice_kind
) values
  ('premium:clone-source', 1, 'open-door', '["fact:clue","secret:key"]', 2, false, '2020-01-01 00:00:00+00',
   '{"routeDeltas":{"truth":1},"trustDeltas":{"char:hero":2},"flagsSet":{"archiveOpened":true},"evidenceAdded":["fact:clue"],"endingBiasDeltas":{"truthEnding":5},"threadTouches":["thread:main"]}', 'normal'),
  ('premium:clone-source', 1, 'wait', '["char:ally"]', 2, false, '2020-01-01 00:00:00+00',
   '{"routeDeltas":{"risk":1},"trustDeltas":{"char:ally":1},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":["thread:ally"]}', 'normal');

insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, ending_name,
  updated_at, created_at, route_state, choice_history, locked_ending_key
) values (
  '20000000-0000-4000-8000-000000000002', 'premium:clone-source',
  'SELESAI', 50, '["source-choice"]', 'Source ending',
  '2020-01-02 00:00:00+00', '2020-01-01 00:00:00+00',
  '{"truth":99}', '[{"choice":"source"}]', 'source-ending'
);

-- Runtime/history fixtures must remain attached only to source.
insert into public.story_events (story_id, seq, type, payload)
values ('premium:clone-source', 1, 'SOURCE_EVENT', '{"character":"char:hero"}');
insert into public.generation_leases (story_id, chapter_number, status, holder, expires_at)
values ('premium:clone-source', 2, 'ACTIVE', 'source-holder', now() + interval '1 hour');
insert into public.idempotency_keys (key, story_id, scope, result)
values ('premium-clone-source-idem', 'premium:clone-source', 'source', '{"ok":true}');
insert into public.outbox (topic, payload)
values ('source.topic', '{"story_id":"premium:clone-source"}');
insert into public.retrieval_logs (story_id, target_chapter, included_ids, excluded_ids, budget_report)
values ('premium:clone-source', 2, '["fact:clue"]', '[]', '{}');
insert into public.shared_story_links (
  owner_user_id, source_story_id, share_slug, share_type, visibility,
  title, teaser_json, spoiler_level
) values (
  '20000000-0000-4000-8000-000000000002', 'premium:clone-source',
  'premium-clone-source-share', 'story_seed', 'unlisted',
  'Source share', '{}', 'none'
);
insert into public.shared_story_starts (shared_link_id, new_user_id, new_story_id)
select id, '20000000-0000-4000-8000-000000000002', 'premium:clone-source'
from public.shared_story_links where share_slug = 'premium-clone-source-share';
insert into public.story_creation_requests (
  owner_user_id, request_kind, idempotency_key, request_hash, story_id, status
) values (
  '20000000-0000-4000-8000-000000000002', 'premium_clone',
  'source-request', 'source-hash', 'premium:clone-source', 'READY'
);

select pg_temp.seed_template_case('premium:invalid-mode', 'standard', 'public', 50, true);
select pg_temp.seed_template_case('premium:invalid-private', 'premium_template', 'private', 50, true);
select pg_temp.seed_template_case('premium:missing-contract', 'premium_template', 'public', 50, false);
select pg_temp.seed_template_case('premium:wrong-blueprints', 'premium_template', 'public', 49, true);
select pg_temp.seed_template_case('premium:too-many-blueprints', 'premium_template', 'public', 51, true);
select pg_temp.seed_template_case('premium:malformed-blueprints', 'premium_template', 'public', 49, true);
insert into public.chapter_blueprints (
  story_id, chapter_number, version, phase, chapter_goal, mandatory_beats,
  forbidden_reveals, allowed_state_delta, introduces_characters,
  reconciled_from_version, reconciliation_reason, created_at
)
select
  'premium:malformed-blueprints', chapter_number, 2, phase, chapter_goal,
  mandatory_beats, forbidden_reveals, allowed_state_delta, introduces_characters,
  reconciled_from_version, reconciliation_reason, created_at
from public.chapter_blueprints
where story_id = 'premium:malformed-blueprints' and chapter_number = 1 and version = 1;
select pg_temp.seed_template_case('premium:wrong-story-total', 'premium_template', 'public', 50, true);
update public.stories set total_chapters = 49 where id = 'premium:wrong-story-total';
select pg_temp.seed_template_case('premium:wrong-contract-mode', 'premium_template', 'public', 50, true);
update public.story_generation_contracts set mode = 'personalized_ai' where story_id = 'premium:wrong-contract-mode';
select pg_temp.seed_template_case('premium:wrong-contract-total', 'premium_template', 'public', 50, true);
alter table public.story_generation_contracts
  drop constraint story_generation_contracts_total_chapters_check;
update public.story_generation_contracts
set total_chapters = 49
where story_id = 'premium:wrong-contract-total';
alter table public.story_generation_contracts
  add constraint story_generation_contracts_total_chapters_check
  check (total_chapters = 50) not valid;
select pg_temp.seed_template_case('premium:array-contract', 'premium_template', 'public', 50, true);
update public.story_generation_contracts
set story_contract_json = '[{"storyId":"premium:array-contract"}]'::jsonb
where story_id = 'premium:array-contract';
select pg_temp.seed_template_case('premium:cross-kind-id', 'premium_template', 'public', 50, true);
insert into public.characters (
  id, story_id, canonical_name, role, motivation, introduced_chapter, created_at
) values (
  'shared:cross-kind', 'premium:cross-kind-id', 'Shared', 'Hero', 'Test collision', 1,
  '2020-01-01 00:00:00+00'
);
insert into public.facts_ledger (
  id, story_id, statement, subject_character_id, established_chapter,
  salience, load_bearing, paid_off, created_at
) values (
  'shared:cross-kind', 'premium:cross-kind-id', 'Cross-kind duplicate.', null, 1,
  0.5, false, false, '2020-01-01 00:00:00+00'
);
select pg_temp.seed_template_case('premium:no-chapter', 'premium_template', 'public', 50, true);
select pg_temp.seed_template_case('premium:malformed-effect', 'premium_template', 'public', 50, true);
insert into public.chapters (
  story_id, number, title, paragraphs, choice_prompt, choices, created_at
) values (
  'premium:malformed-effect', 1, 'Malformed Effect', '["A valid opening paragraph."]'::jsonb,
  'What should Raka do?',
  '[{"id":"open-door","label":"Open the archive door"},{"id":"wait","label":"Guard the hallway"}]'::jsonb,
  '2020-01-01 00:00:00+00'
);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number,
  is_ending, created_at, effect_json, choice_kind
) values
  ('premium:malformed-effect', 1, 'open-door', '["The archive opens."]', 2, false,
   '2020-01-01 00:00:00+00', '{"routeDeltas":{"truth":21}}', 'normal'),
  ('premium:malformed-effect', 1, 'wait', '["The hallway stays quiet."]', 2, false,
   '2020-01-01 00:00:00+00',
   '{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}',
   'normal');
select pg_temp.seed_template_case('premium:incoherent-outcome', 'premium_template', 'public', 50, true);
insert into public.chapters (
  story_id, number, title, paragraphs, choice_prompt, choices, created_at
) values (
  'premium:incoherent-outcome', 1, 'Incoherent Outcome', '["A valid opening paragraph."]'::jsonb,
  'What should Raka do?',
  '[{"id":"open-door","label":"Open the archive door"},{"id":"wait","label":"Guard the hallway"}]'::jsonb,
  '2020-01-01 00:00:00+00'
);
insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number,
  is_ending, created_at, effect_json, choice_kind
) values
  ('premium:incoherent-outcome', 1, 'open-door', '["The archive opens."]', 2, false,
   '2020-01-01 00:00:00+00',
   '{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}',
   'normal'),
  ('premium:incoherent-outcome', 1, 'unknown-choice', '["No matching choice exists."]', 2, false,
   '2020-01-01 00:00:00+00',
   '{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]}',
   'normal');

insert into public.stories (id, title, owner_user_id, visibility)
values ('premium:collision-target', 'Preserve this target', '20000000-0000-4000-8000-000000000002', 'private');

-- Exact function metadata and ACL.
select has_function(
  'public',
  'clone_premium_story_instance',
  array['text', 'uuid', 'text'],
  'clone_premium_story_instance exact signature exists'
);
select function_returns(
  'public',
  'clone_premium_story_instance',
  array['text', 'uuid', 'text'],
  'jsonb',
  'clone_premium_story_instance returns jsonb'
);
select function_lang_is(
  'public',
  'clone_premium_story_instance',
  array['text', 'uuid', 'text'],
  'plpgsql',
  'clone_premium_story_instance uses plpgsql'
);
select ok(
  (select p.prosecdef from pg_proc p where p.oid =
    'public.clone_premium_story_instance(text,uuid,text)'::regprocedure),
  'clone_premium_story_instance is SECURITY DEFINER'
);
select is(
  (select p.provolatile from pg_proc p where p.oid =
    'public.clone_premium_story_instance(text,uuid,text)'::regprocedure),
  'v'::"char",
  'clone_premium_story_instance is VOLATILE'
);
select is(
  (select p.proconfig from pg_proc p where p.oid =
    'public.clone_premium_story_instance(text,uuid,text)'::regprocedure),
  array['search_path=public, pg_temp']::text[],
  'clone_premium_story_instance fixes approved safe search_path'
);
select ok(
  not has_function_privilege('public', 'public.clone_premium_story_instance(text,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.clone_premium_story_instance(text,uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.clone_premium_story_instance(text,uuid,text)', 'EXECUTE'),
  'PUBLIC, anon, and authenticated cannot execute clone RPC'
);
select ok(
  has_function_privilege('service_role', 'public.clone_premium_story_instance(text,uuid,text)', 'EXECUTE'),
  'service_role can execute clone RPC'
);
select is(
  (
    select count(*)
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.clone_premium_story_instance(text,uuid,text)'::regprocedure
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee <> p.proowner
  ),
  1::bigint,
  'clone RPC ACL has exactly one non-owner EXECUTE grant'
);
select ok(
  exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.clone_premium_story_instance(text,uuid,text)'::regprocedure
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee = (select oid from pg_roles where rolname = 'service_role')
      and not acl.is_grantable
  ),
  'sole non-owner RPC EXECUTE grant is non-grantable service_role'
);
select ok(
  not has_function_privilege('public', 'public.clone_premium_story_remap_jsonb(jsonb,text[],text[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.clone_premium_story_remap_jsonb(jsonb,text[],text[])', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.clone_premium_story_remap_jsonb(jsonb,text[],text[])', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.clone_premium_story_remap_jsonb(jsonb,text[],text[])', 'EXECUTE'),
  'recursive JSON remap helper is internal to function owner'
);
select is(
  public.clone_premium_story_remap_jsonb(
    '{"char:hero":{"nested":"char:hero"},"unrelated":"keep"}'::jsonb,
    array['char:hero'],
    array['target:character:hero']
  ),
  '{"target:character:hero":{"nested":"target:character:hero"},"unrelated":"keep"}'::jsonb,
  'recursive JSON remap changes exact object keys and values but preserves unrelated keys'
);
select throws_ok(
  $$select public.clone_premium_story_remap_jsonb(
    '{"char:hero":1,"target:character:hero":2}'::jsonb,
    array['char:hero'],
    array['target:character:hero']
  )$$,
  '22023', 'JSON_REMAP_KEY_COLLISION',
  'recursive JSON remap fails closed when key remapping collides'
);

-- Direct role boundary.
set local role anon;
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', 'premium:anon-denied')$$,
  '42501', null,
  'anon cannot execute clone RPC'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', 'premium:authenticated-denied')$$,
  '42501', null,
  'authenticated cannot execute clone RPC'
);
reset role;

-- Strict ID and owner validation.
select throws_ok(
  $$select public.clone_premium_story_instance(null, '10000000-0000-4000-8000-000000000001', 'premium:null-source')$$,
  '22023', 'INVALID_STORY_ID', 'null source story ID rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('', '10000000-0000-4000-8000-000000000001', 'premium:empty-source')$$,
  '22023', 'INVALID_STORY_ID', 'empty source story ID rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance(' premium:clone-source ', '10000000-0000-4000-8000-000000000001', 'premium:padded-source')$$,
  '22023', 'INVALID_STORY_ID', 'padded source story ID rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', null)$$,
  '22023', 'INVALID_STORY_ID', 'null target story ID rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', '')$$,
  '22023', 'INVALID_STORY_ID', 'empty target story ID rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', ' premium:padded-target ')$$,
  '22023', 'INVALID_STORY_ID', 'padded target story ID rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', 'premium:clone-source')$$,
  '22023', 'INVALID_STORY_ID', 'source and target story IDs must differ'
);
select throws_ok(
  $$select public.clone_premium_story_instance(repeat('s', 201), '10000000-0000-4000-8000-000000000001', 'premium:long-source')$$,
  '22023', 'INVALID_STORY_ID', 'source story ID over 200 characters rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', repeat('t', 129))$$,
  '22023', 'INVALID_STORY_ID', 'target story ID over 128 characters rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', null, 'premium:null-owner')$$,
  '22023', 'INVALID_OWNER', 'null owner rejects'
);
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '30000000-0000-4000-8000-000000000003', 'premium:missing-owner')$$,
  '22023', 'INVALID_OWNER', 'owner absent from auth.users rejects'
);

-- Invalid source cases return same narrow result without existence leakage.
select is(
  public.clone_premium_story_instance('premium:invalid-mode', '10000000-0000-4000-8000-000000000001', 'premium:reject-mode'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'public non-template source rejects'
);
select is(
  public.clone_premium_story_instance('premium:invalid-private', '10000000-0000-4000-8000-000000000001', 'premium:reject-private'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'private premium template rejects'
);
select is(
  public.clone_premium_story_instance('premium:missing-contract', '10000000-0000-4000-8000-000000000001', 'premium:reject-contract'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template missing generation contract rejects'
);
select is(
  public.clone_premium_story_instance('premium:wrong-blueprints', '10000000-0000-4000-8000-000000000001', 'premium:reject-blueprints'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template without exactly 50 blueprints rejects'
);
select is(
  public.clone_premium_story_instance('premium:too-many-blueprints', '10000000-0000-4000-8000-000000000001', 'premium:reject-too-many-blueprints'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template with 51 blueprints rejects'
);
select is(
  public.clone_premium_story_instance('premium:malformed-blueprints', '10000000-0000-4000-8000-000000000001', 'premium:reject-malformed-blueprints'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template must have exactly one blueprint for every chapter 1 through 50'
);
select is(
  public.clone_premium_story_instance('premium:wrong-story-total', '10000000-0000-4000-8000-000000000001', 'premium:reject-story-total'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template story total_chapters must equal 50'
);
select is(
  public.clone_premium_story_instance('premium:wrong-contract-mode', '10000000-0000-4000-8000-000000000001', 'premium:reject-contract-mode'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template contract mode must equal premium_template'
);
select is(
  pg_temp.clone_result('premium:wrong-contract-total', '10000000-0000-4000-8000-000000000001', 'premium:reject-contract-total'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template contract total_chapters must equal 50'
);
select is(
  public.clone_premium_story_instance('premium:array-contract', '10000000-0000-4000-8000-000000000001', 'premium:reject-array-contract'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'template story_contract_json must be an object'
);
select is(
  (select count(*) from public.stories where id = 'premium:reject-array-contract'),
  0::bigint,
  'array contract rejection creates no target'
);
select is(
  public.clone_premium_story_instance('premium:cross-kind-id', '10000000-0000-4000-8000-000000000001', 'premium:reject-cross-kind-id'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'duplicate text ID across remapped kinds rejects before target insert'
);
select is(
  public.clone_premium_story_instance('premium:not-found', '10000000-0000-4000-8000-000000000001', 'premium:reject-missing'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'nonexistent source returns same invalid-template result'
);
select is(
  public.clone_premium_story_instance('premium:malformed-effect', '10000000-0000-4000-8000-000000000001', 'premium:reject-malformed-effect'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'malformed curated V2 effect rejects before target persistence'
);
select is(
  public.clone_premium_story_instance('premium:incoherent-outcome', '10000000-0000-4000-8000-000000000001', 'premium:reject-incoherent-outcome'),
  '{"ok":false,"reason":"INVALID_TEMPLATE"}'::jsonb,
  'curated outcome IDs must exactly match Chapter 1 choice IDs'
);
select is(
  (select row(
    (select count(*) from public.stories where id = 'premium:reject-malformed-effect'),
    (select count(*) from public.chapters where story_id = 'premium:reject-malformed-effect'),
    (select count(*) from public.choice_outcomes where story_id = 'premium:reject-malformed-effect'),
    (select count(*) from public.reader_states where story_id = 'premium:reject-malformed-effect')
  )::text),
  row(0::bigint, 0::bigint, 0::bigint, 0::bigint)::text,
  'malformed curated effect leaves no target rows'
);
select is(
  (select count(*) from public.stories where id like 'premium:reject-%'),
  0::bigint,
  'invalid source cases create no target shells'
);

-- Stable existing target exercises deterministic target-insert collision handling sequentially.
select throws_ok(
  $$select public.clone_premium_story_instance('premium:clone-source', '10000000-0000-4000-8000-000000000001', 'premium:collision-target')$$,
  '23505', 'TARGET_STORY_EXISTS',
  'target insert path translates stable primary-key collision deterministically'
);
select is(
  (select row(title, owner_user_id, visibility)::text from public.stories where id = 'premium:collision-target'),
  row('Preserve this target'::text, '20000000-0000-4000-8000-000000000002'::uuid, 'private'::text)::text,
  'target collision preserves existing target row'
);

-- Valid curated clone.
set local role service_role;
select is(
  public.clone_premium_story_instance(
    'premium:clone-source',
    '10000000-0000-4000-8000-000000000001',
    'premium:clone-target'
  ),
  '{"ok":true,"story_id":"premium:clone-target"}'::jsonb,
  'service_role clones valid premium template'
);
reset role;

select is(
  (
    select row(
      title, cover, tagline, role, tropes, total_chapters, synopsis,
      status, current_chapter, jejak, ending_name, owner_user_id,
      visibility, source_story_id, story_mode, generation_status,
      story_contract_version
    )::text
    from public.stories where id = 'premium:clone-target'
  ),
  row(
    'Template premium:clone-source'::text, '/cover.webp'::text,
    'A premium template'::text, 'Hero'::text, '["mystery"]'::jsonb,
    50, 'Template synopsis'::text, 'BARU'::text, 1, '[]'::jsonb,
    null::text, '10000000-0000-4000-8000-000000000001'::uuid,
    'private'::text, 'premium:clone-source'::text, 'premium_instance'::text,
    'ready'::text, 7
  )::text,
  'target shell copies definition fields and resets lifecycle fields'
);
select ok(
  (select created_at > '2020-01-02 00:00:00+00'::timestamptz from public.stories where id = 'premium:clone-target'),
  'target story receives fresh timestamp'
);
select is(
  (
    select row(
      mode, total_chapters, contract_source, onboarding_json,
      story_contract_json, route_schema_json, plot_debts_json,
      ending_candidates_json, ending_lock_json, quality_profile
    )::text
    from public.story_generation_contracts where story_id = 'premium:clone-target'
  ),
  row(
    'premium_instance'::text, 50, 'llm_repaired'::text,
    jsonb_build_object(
      'hero', pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'),
      'prose', 'char:hero appears',
      pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'),
        pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero')
    ),
    jsonb_build_object(
      'storyId', 'premium:clone-target',
      'nested', jsonb_build_array(
        pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue'),
        jsonb_build_object(
          'secret', pg_temp.remapped_id('premium:clone-target', 'secret', 'secret:key'),
          'thread', pg_temp.remapped_id('premium:clone-target', 'thread', 'thread:main')
        )
      )
    ),
    jsonb_build_object(
      'focus', pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'),
      'unknown', 'not-an-id'
    ),
    jsonb_build_array(jsonb_build_object(
      'fact', pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue')
    )),
    jsonb_build_array(jsonb_build_object(
      'thread', pg_temp.remapped_id('premium:clone-target', 'thread', 'thread:main'),
      'secret', pg_temp.remapped_id('premium:clone-target', 'secret', 'secret:key')
    )),
    jsonb_build_object(
      'character', pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero')
    ),
    'lakoku_mobile_drama_v1'::text
  )::text,
  'contract copies exact fields, changes mode, and recursively remaps scalar ID strings only'
);
select ok(
  (select created_at > '2020-01-02 00:00:00+00'::timestamptz
   and updated_at > '2020-01-02 00:00:00+00'::timestamptz
   from public.story_generation_contracts where story_id = 'premium:clone-target'),
  'target contract receives fresh timestamps'
);

select is((select count(*) from public.characters where story_id = 'premium:clone-target'), 2::bigint, 'all characters clone');
select is((select count(*) from public.character_states where character_id like 'premium:clone-target:character:%'), 2::bigint, 'all character states clone');
select is((select count(*) from public.character_aliases where story_id = 'premium:clone-target'), 2::bigint, 'all character aliases clone');
select is((select count(*) from public.character_voice_sheets where story_id = 'premium:clone-target'), 2::bigint, 'all character voice sheets clone');
select is((select count(*) from public.facts_ledger where story_id = 'premium:clone-target'), 2::bigint, 'all facts clone');
select is((select count(*) from public.knowledge_scopes where story_id = 'premium:clone-target'), 2::bigint, 'all knowledge scopes clone');
select is((select count(*) from public.secrets_reveals where story_id = 'premium:clone-target'), 2::bigint, 'all secrets clone');
select is((select count(*) from public.story_threads where story_id = 'premium:clone-target'), 2::bigint, 'all threads clone');
select is((select count(*) from public.timeline_events where story_id = 'premium:clone-target'), 2::bigint, 'all timeline events clone');
select is((select count(*) from public.act_rollups where story_id = 'premium:clone-target'), 2::bigint, 'all act rollups clone');
select is((select count(*) from public.chapter_blueprints where story_id = 'premium:clone-target'), 50::bigint, 'exactly 50 chapter blueprints clone');
select is((select count(distinct chapter_number) from public.chapter_blueprints where story_id = 'premium:clone-target'), 50::bigint, 'cloned blueprints cover 50 distinct chapters');
select is((select count(*) from public.chapters where story_id = 'premium:clone-target'), 1::bigint, 'optional curated Chapter 1 clones');
select is((select count(*) from public.choice_outcomes where story_id = 'premium:clone-target'), 2::bigint, 'all curated Chapter 1 outcomes clone');
select is((select count(*) from public.reader_states where story_id = 'premium:clone-target'), 1::bigint, 'one fresh reader state is created');

select is(
  (select jsonb_agg(id order by id) from public.characters where story_id = 'premium:clone-target'),
  (
    select jsonb_agg(remapped order by remapped)
    from (values
      (pg_temp.remapped_id('premium:clone-target', 'character', 'char:ally')),
      (pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'))
    ) as expected(remapped)
  ),
  'character IDs use deterministic target-local remap'
);
select is(
  (select jsonb_agg(id order by id) from public.facts_ledger where story_id = 'premium:clone-target'),
  (
    select jsonb_agg(remapped order by remapped)
    from (values
      (pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:ally')),
      (pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue'))
    ) as expected(remapped)
  ),
  'fact IDs use deterministic target-local remap'
);
select is(
  (select jsonb_agg(id order by id) from public.secrets_reveals where story_id = 'premium:clone-target'),
  (
    select jsonb_agg(remapped order by remapped)
    from (values
      (pg_temp.remapped_id('premium:clone-target', 'secret', 'secret:ally')),
      (pg_temp.remapped_id('premium:clone-target', 'secret', 'secret:key'))
    ) as expected(remapped)
  ),
  'secret IDs use deterministic target-local remap'
);
select is(
  (select jsonb_agg(id order by id) from public.story_threads where story_id = 'premium:clone-target'),
  (
    select jsonb_agg(remapped order by remapped)
    from (values
      (pg_temp.remapped_id('premium:clone-target', 'thread', 'thread:ally')),
      (pg_temp.remapped_id('premium:clone-target', 'thread', 'thread:main'))
    ) as expected(remapped)
  ),
  'thread IDs use deterministic target-local remap'
);
select ok(
  not exists (
    select 1 from public.facts_ledger f
    left join public.characters c on c.id = f.subject_character_id and c.story_id = f.story_id
    where f.story_id = 'premium:clone-target' and f.subject_character_id is not null and c.id is null
  ),
  'fact subject FKs remain target-local'
);
select ok(
  not exists (
    select 1 from public.knowledge_scopes k
    left join public.characters c on c.id = k.character_id and c.story_id = k.story_id
    left join public.facts_ledger f on f.id = k.fact_id and f.story_id = k.story_id
    where k.story_id = 'premium:clone-target' and (c.id is null or f.id is null)
  ),
  'knowledge scope FKs remain target-local'
);
select ok(
  not exists (
    select 1 from public.character_aliases a
    left join public.characters c on c.id = a.character_id and c.story_id = a.story_id
    where a.story_id = 'premium:clone-target' and c.id is null
  )
  and not exists (
    select 1 from public.character_voice_sheets v
    left join public.characters c on c.id = v.character_id and c.story_id = v.story_id
    where v.story_id = 'premium:clone-target' and c.id is null
  ),
  'alias and voice FKs remain target-local'
);
select ok(
  not exists (
    select 1 from public.character_states s
    where s.character_id like 'premium:clone-target:character:%'
      and not exists (
        select 1 from public.characters c
        where c.id = s.character_id and c.story_id = 'premium:clone-target'
      )
  ),
  'character-state FKs remain target-local'
);
select ok(
  not exists (
    select 1
    from public.character_aliases source
    join public.character_aliases target
      on target.story_id = 'premium:clone-target' and target.alias = source.alias
    where source.story_id = 'premium:clone-source' and source.id = target.id
  )
  and not exists (
    select 1
    from public.timeline_events source
    join public.timeline_events target
      on target.story_id = 'premium:clone-target'
      and target.chapter_number = source.chapter_number and target.ordinal = source.ordinal
    where source.story_id = 'premium:clone-source' and source.id = target.id
  )
  and not exists (
    select 1
    from public.chapter_blueprints source
    join public.chapter_blueprints target
      on target.story_id = 'premium:clone-target'
      and target.chapter_number = source.chapter_number and target.version = source.version
    where source.story_id = 'premium:clone-source' and source.id = target.id
  ),
  'identity-backed linked rows receive fresh DB-generated IDs'
);

select is(
  (select attributes from public.character_states where character_id = pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero')),
  jsonb_build_object(
    'self', pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'),
    'ally', pg_temp.remapped_id('premium:clone-target', 'character', 'char:ally'),
    'fact', pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue'),
    'prose', 'char:hero appears'
  ),
  'nested character-state JSON remaps exact scalar IDs without substring changes'
);
select is(
  (select mandatory_beats from public.chapter_blueprints where story_id = 'premium:clone-target' and chapter_number = 1),
  jsonb_build_array('beat-1', pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero')),
  'blueprint JSON remaps linked IDs'
);
select is(
  (select paragraphs from public.chapters where story_id = 'premium:clone-target' and number = 1),
  jsonb_build_array(
    pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'),
    'char:hero enters prose',
    pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue')
  ),
  'curated chapter JSON remaps exact IDs but preserves prose substrings'
);
select is(
  (
    select jsonb_agg(jsonb_build_object(
      'choice_id', choice_id,
      'consequence', consequence,
      'next_chapter_number', next_chapter_number,
      'is_ending', is_ending,
      'effect_json', effect_json,
      'choice_kind', choice_kind
    ) order by choice_id)
    from public.choice_outcomes where story_id = 'premium:clone-target'
  ),
  jsonb_build_array(
    jsonb_build_object(
      'choice_id', 'open-door',
      'consequence', jsonb_build_array(
        pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue'),
        pg_temp.remapped_id('premium:clone-target', 'secret', 'secret:key')
      ),
      'next_chapter_number', 2,
      'is_ending', false,
      'effect_json', jsonb_build_object(
        'routeDeltas', jsonb_build_object('truth', 1),
        'trustDeltas', jsonb_build_object(
          pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'), 2
        ),
        'flagsSet', jsonb_build_object('archiveOpened', true),
        'evidenceAdded', jsonb_build_array(
          pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue')
        ),
        'endingBiasDeltas', jsonb_build_object('truthEnding', 5),
        'threadTouches', jsonb_build_array(
          pg_temp.remapped_id('premium:clone-target', 'thread', 'thread:main')
        )
      ),
      'choice_kind', 'normal'
    ),
    jsonb_build_object(
      'choice_id', 'wait',
      'consequence', jsonb_build_array(
        pg_temp.remapped_id('premium:clone-target', 'character', 'char:ally')
      ),
      'next_chapter_number', 2,
      'is_ending', false,
      'effect_json', jsonb_build_object(
        'routeDeltas', jsonb_build_object('risk', 1),
        'trustDeltas', jsonb_build_object(
          pg_temp.remapped_id('premium:clone-target', 'character', 'char:ally'), 1
        ),
        'flagsSet', '{}'::jsonb,
        'evidenceAdded', '[]'::jsonb,
        'endingBiasDeltas', '{}'::jsonb,
        'threadTouches', jsonb_build_array(
          pg_temp.remapped_id('premium:clone-target', 'thread', 'thread:ally')
        )
      ),
      'choice_kind', 'normal'
    )
  ),
  'curated outcomes preserve V2 columns and recursively remap JSON IDs'
);
select is(
  (
    select row(
      user_id, status, current_chapter, jejak, ending_name,
      route_state, choice_history, locked_ending_key
    )::text
    from public.reader_states where story_id = 'premium:clone-target'
  ),
  row(
    '10000000-0000-4000-8000-000000000001'::uuid,
    'BERJALAN'::text, 1, '[]'::jsonb, null::text,
    '{"truth":0,"risk":0,"secrecy":0,"empathy":0,"trust":{},"evidence":[],"flags":{},"endingBias":{}}'::jsonb,
    '[]'::jsonb, null::text
  )::text,
  'fresh reader state uses exact canonical RouteStateSchema defaults'
);
select ok(
  (select created_at > '2020-01-02 00:00:00+00'::timestamptz
   and updated_at > '2020-01-02 00:00:00+00'::timestamptz
   from public.reader_states where story_id = 'premium:clone-target'),
  'fresh reader state receives new timestamps'
);
select lives_ok(
  $$select public.apply_personalized_choice(
    '10000000-0000-4000-8000-000000000001',
    'premium:clone-target',
    1,
    'open-door',
    'premium-clone-first-choice',
    jsonb_build_object(
      'user_id', state.user_id,
      'story_id', state.story_id,
      'status', state.status,
      'current_chapter', state.current_chapter,
      'jejak', state.jejak,
      'ending_name', state.ending_name,
      'route_state', state.route_state,
      'choice_history', state.choice_history,
      'locked_ending_key', state.locked_ending_key,
      'updated_at', to_jsonb(state.updated_at)
    ),
    jsonb_build_object(
      'truth', 1,
      'risk', 0,
      'secrecy', 0,
      'empathy', 0,
      'trust', jsonb_build_object(
        pg_temp.remapped_id('premium:clone-target', 'character', 'char:hero'), 2
      ),
      'evidence', jsonb_build_array(
        pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue')
      ),
      'flags', jsonb_build_object('archiveOpened', true),
      'endingBias', jsonb_build_object('truthEnding', 5)
    ),
    jsonb_build_object(
      'chapterNumber', 1,
      'choiceId', 'open-door',
      'label', 'Open the archive door',
      'consequence', jsonb_build_array(
        pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue'),
        pg_temp.remapped_id('premium:clone-target', 'secret', 'secret:key')
      ),
      'effectSummary', '{"flagsSet":["archiveOpened"],"truth":1}'::jsonb,
      'createdAt', '2026-07-15T00:00:00.000Z'
    ),
    jsonb_build_object(
      'chapter', 1,
      'decision', 'Open the archive door',
      'consequence', pg_temp.remapped_id('premium:clone-target', 'fact', 'fact:clue')
    )
  )
  from public.reader_states as state
  where state.user_id = '10000000-0000-4000-8000-000000000001'
    and state.story_id = 'premium:clone-target'$$,
  'first choice succeeds against cloned canonical reader state'
);

select is(
  (select row(
    (select count(*) from public.story_events where story_id = 'premium:clone-target'),
    (select count(*) from public.generation_leases where story_id = 'premium:clone-target'),
    (select count(*) from public.idempotency_keys where story_id = 'premium:clone-target'),
    (select count(*) from public.outbox where payload @> '{"story_id":"premium:clone-target"}'),
    (select count(*) from public.retrieval_logs where story_id = 'premium:clone-target'),
    (select count(*) from public.shared_story_links where source_story_id = 'premium:clone-target'),
    (select count(*) from public.shared_story_starts where new_story_id = 'premium:clone-target'),
    (select count(*) from public.story_creation_requests where story_id = 'premium:clone-target')
  )::text),
  row(0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint)::text,
  'runtime history, requests, logs, and shares are not cloned or synthesized'
);

select is(
  (select row(
    (select count(*) from public.characters where story_id = 'premium:clone-source'),
    (select count(*) from public.facts_ledger where story_id = 'premium:clone-source'),
    (select count(*) from public.secrets_reveals where story_id = 'premium:clone-source'),
    (select count(*) from public.story_threads where story_id = 'premium:clone-source'),
    (select count(*) from public.timeline_events where story_id = 'premium:clone-source'),
    (select count(*) from public.chapter_blueprints where story_id = 'premium:clone-source'),
    (select count(*) from public.chapters where story_id = 'premium:clone-source'),
    (select count(*) from public.choice_outcomes where story_id = 'premium:clone-source'),
    (select count(*) from public.reader_states where story_id = 'premium:clone-source')
  )::text),
  row(2::bigint,2::bigint,2::bigint,2::bigint,2::bigint,50::bigint,1::bigint,2::bigint,1::bigint)::text,
  'source linked rows remain unchanged after clone'
);
select is(
  (
    select row(onboarding_json, story_contract_json)::text
    from public.story_generation_contracts
    where story_id = 'premium:clone-source'
  ),
  row(
    '{"hero":"char:hero","prose":"char:hero appears","char:hero":"char:hero"}'::jsonb,
    '{"storyId":"premium:clone-source","nested":["fact:clue",{"secret":"secret:key","thread":"thread:main"}]}'::jsonb
  )::text,
  'source JSON including source storyId remains unchanged after recursive target remap'
);

-- Independent second clone receives separate deterministic global IDs.
select is(
  public.clone_premium_story_instance(
    'premium:clone-source',
    '10000000-0000-4000-8000-000000000001',
    'premium:clone-target-two'
  ),
  '{"ok":true,"story_id":"premium:clone-target-two"}'::jsonb,
  'same source can clone independently to second target'
);
select is((select count(*) from public.characters where story_id = 'premium:clone-target-two'), 2::bigint, 'second clone has complete characters');
select is((select count(*) from public.timeline_events where story_id = 'premium:clone-target-two'), 2::bigint, 'second clone has complete timeline');
select is((select count(*) from public.chapter_blueprints where story_id = 'premium:clone-target-two'), 50::bigint, 'second clone has complete blueprints');
select ok(
  not exists (
    select 1
    from public.characters one
    join public.characters two on two.id = one.id
    where one.story_id = 'premium:clone-target' and two.story_id = 'premium:clone-target-two'
  )
  and not exists (
    select 1
    from public.facts_ledger one
    join public.facts_ledger two on two.id = one.id
    where one.story_id = 'premium:clone-target' and two.story_id = 'premium:clone-target-two'
  ),
  'independent clones use disjoint globally unique IDs'
);

-- Valid template without curated Chapter 1 stays generation-ready with fresh state.
select is(
  public.clone_premium_story_instance(
    'premium:no-chapter',
    '10000000-0000-4000-8000-000000000001',
    'premium:no-chapter-target'
  ),
  '{"ok":true,"story_id":"premium:no-chapter-target"}'::jsonb,
  'valid template without curated Chapter 1 clones'
);
select is(
  (select row(
    (select count(*) from public.chapters where story_id = 'premium:no-chapter-target'),
    (select count(*) from public.choice_outcomes where story_id = 'premium:no-chapter-target'),
    (select count(*) from public.chapter_blueprints where story_id = 'premium:no-chapter-target'),
    (select count(*) from public.reader_states where story_id = 'premium:no-chapter-target')
  )::text),
  row(0::bigint,0::bigint,50::bigint,1::bigint)::text,
  'absent curated Chapter 1 creates no chapter/outcomes but complete blueprint/state rows'
);
select is(
  (
    select row(story_id, story_contract_json ->> 'storyId')::text
    from public.story_generation_contracts
    where story_id = 'premium:no-chapter-target'
  ),
  row('premium:no-chapter-target'::text, 'premium:no-chapter-target'::text)::text,
  'no-curated target relational story_id equals JSON storyId'
);

-- User B cannot read user A target under RLS; owner A can.
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(id) from public.stories where id = 'premium:clone-target'),
  0::bigint,
  'other authenticated user cannot read private clone'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(id) from public.stories where id = 'premium:clone-target'),
  1::bigint,
  'clone owner can read private clone'
);
reset role;

-- Controlled final reader-state FK failure proves whole function remains atomic.
select ok(
  not exists (
    select 1
    from auth.users
    where id = '30000000-0000-4000-8000-000000000003'
  ),
  'injected reader-state owner is absent from auth.users'
);
create or replace function pg_temp.inject_premium_clone_reader_state_fk_failure()
returns trigger
language plpgsql
as $$
begin
  if current_setting('lakoku.test_target', true) = 'local-cli'
    and new.story_id = 'premium:late-failure-target' then
    new.user_id := '30000000-0000-4000-8000-000000000003';
  end if;
  return new;
end;
$$;
create trigger task23_test_late_failure
before insert on public.reader_states
for each row execute function pg_temp.inject_premium_clone_reader_state_fk_failure();
select throws_ok(
  $$select public.clone_premium_story_instance(
    'premium:clone-source',
    '10000000-0000-4000-8000-000000000001',
    'premium:late-failure-target'
  )$$,
  '23503', null,
  'late reader-state FK failure aborts clone'
);
select is(
  (select row(
    (select count(*) from public.stories where id = 'premium:late-failure-target'),
    (select count(*) from public.story_generation_contracts where story_id = 'premium:late-failure-target'),
    (select count(*) from public.characters where story_id = 'premium:late-failure-target'),
    (select count(*) from public.character_aliases where story_id = 'premium:late-failure-target'),
    (select count(*) from public.character_voice_sheets where story_id = 'premium:late-failure-target'),
    (select count(*) from public.facts_ledger where story_id = 'premium:late-failure-target'),
    (select count(*) from public.knowledge_scopes where story_id = 'premium:late-failure-target'),
    (select count(*) from public.secrets_reveals where story_id = 'premium:late-failure-target'),
    (select count(*) from public.story_threads where story_id = 'premium:late-failure-target'),
    (select count(*) from public.timeline_events where story_id = 'premium:late-failure-target'),
    (select count(*) from public.act_rollups where story_id = 'premium:late-failure-target'),
    (select count(*) from public.chapter_blueprints where story_id = 'premium:late-failure-target'),
    (select count(*) from public.chapters where story_id = 'premium:late-failure-target'),
    (select count(*) from public.choice_outcomes where story_id = 'premium:late-failure-target'),
    (select count(*) from public.reader_states where story_id = 'premium:late-failure-target')
  )::text),
  row(0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint)::text,
  'late failure rolls back every target row'
);
select is(
  (select count(*) from public.character_states where character_id like 'premium:late-failure-target:character:%'),
  0::bigint,
  'late failure rolls back target character states'
);
drop trigger task23_test_late_failure on public.reader_states;
select is(
  public.clone_premium_story_instance(
    'premium:clone-source',
    '10000000-0000-4000-8000-000000000001',
    'premium:late-failure-target'
  ),
  '{"ok":true,"story_id":"premium:late-failure-target"}'::jsonb,
  'successful retry works after late failure rollback'
);
select is(
  (select row(
    (select count(*) from public.stories where id = 'premium:late-failure-target'),
    (select count(*) from public.characters where story_id = 'premium:late-failure-target'),
    (select count(*) from public.chapter_blueprints where story_id = 'premium:late-failure-target'),
    (select count(*) from public.reader_states where story_id = 'premium:late-failure-target')
  )::text),
  row(1::bigint,2::bigint,50::bigint,1::bigint)::text,
  'retry commits one complete target'
);

select * from finish();
rollback;
