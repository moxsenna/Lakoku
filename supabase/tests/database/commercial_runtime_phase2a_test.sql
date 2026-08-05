begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    perform set_config('lakoku.test_target', 'local-cli', true);
  end if;
end
$$;

select plan(20);

-- 1. Table existence & RLS
select has_table('commercial_generation_intents', 'commercial_generation_intents table should exist');
select ok(has_table_privilege('service_role', 'public.commercial_generation_intents', 'INSERT'), 'service_role can insert into commercial_generation_intents');
select ok(not has_table_privilege('authenticated', 'public.commercial_generation_intents', 'INSERT'), 'authenticated cannot insert into commercial_generation_intents');

-- 2. Check no default for quote fields
select col_hasnt_default('public', 'commercial_generation_intents', 'quoted_credits', 'quoted_credits has no default');
select col_hasnt_default('public', 'commercial_generation_intents', 'pricing_version', 'pricing_version has no default');

-- 3. Setup test user & story
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'phase2a@example.com',
  'secret',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
) on conflict (id) do nothing;

insert into public.stories (
  id, title, cover, tagline, role, tropes, total_chapters, status, current_chapter, jejak, owner_user_id, visibility, story_mode, generation_status
) values (
  'story-p2a-1', 'Test Story Phase 2A', '/c.webp', 'Tag', 'Role', '{}', 50, 'BARU', 3, '{}', '11111111-1111-1111-1111-111111111111', 'private', 'personalized_ai', 'ready'
) on conflict (id) do nothing;

insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, route_state, choice_history, updated_at
) values (
  '11111111-1111-1111-1111-111111111111', 'story-p2a-1', 'BERJALAN', 3, '[]'::jsonb, '{"truth": 1, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb, '[]'::jsonb, now()
) on conflict (user_id, story_id) do nothing;

insert into public.chapters (
  story_id, number, title, paragraphs, choice_prompt, choices
) values (
  'story-p2a-1', 3, 'Bab 3', jsonb_build_array('Paragraph 1'), 'Pilih:',
  jsonb_build_array(
    jsonb_build_object('id', 'choice-a', 'label', 'Pilihan A'),
    jsonb_build_object('id', 'choice-b', 'label', 'Pilihan B')
  )
) on conflict (story_id, number) do nothing;

insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending, effect_json, choice_kind
) values (
  'story-p2a-1', 3, 'choice-a', jsonb_build_array('Dampak A'), 4, false, '{"routeDeltas": {"truth": 1}, "trustDeltas": {}, "flagsSet": {"clue_found": true}, "evidenceAdded": [], "endingBiasDeltas": {}}'::jsonb, 'normal'
), (
  'story-p2a-1', 3, 'choice-b', jsonb_build_array('Dampak B'), 4, false, '{"routeDeltas": {}, "trustDeltas": {}, "flagsSet": {}, "evidenceAdded": [], "endingBiasDeltas": {}}'::jsonb, 'normal'
) on conflict (story_id, chapter_number, choice_id) do nothing;

-- 4. Test apply_personalized_choice_v2 (Bab 3 -> Bab 4 requires commercial intent)
select lives_ok(
  $$
  select public.apply_personalized_choice_v2(
    '11111111-1111-1111-1111-111111111111',
    'story-p2a-1',
    3,
    'choice-a',
    'k1',
    jsonb_build_object(
      'user_id', '11111111-1111-1111-1111-111111111111',
      'story_id', 'story-p2a-1',
      'status', 'BERJALAN',
      'current_chapter', 3,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth": 1, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', (select updated_at from public.reader_states where story_id = 'story-p2a-1')
    ),
    '{"truth": 2, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {"clue_found": true}, "endingBias": {}}'::jsonb,
    jsonb_build_object(
      'chapterNumber', 3,
      'choiceId', 'choice-a',
      'label', 'Pilihan A',
      'consequence', jsonb_build_array('Dampak A'),
      'effectSummary', '{"truth": 1, "flagsSet": ["clue_found"]}'::jsonb,
      'createdAt', now()
    ),
    jsonb_build_object(
      'chapter', 3,
      'decision', 'Pilihan A',
      'consequence', 'Dampak A'
    )
  );
  $$,
  'apply_personalized_choice_v2 succeeds and preserves full choice semantics'
);

-- Verify reader_states updated
select results_eq(
  $$ select current_chapter from public.reader_states where user_id = '11111111-1111-1111-1111-111111111111' and story_id = 'story-p2a-1'; $$,
  $$ select 4; $$,
  'reader_states.current_chapter updated to 4'
);

-- Verify intent created atomically with active feature_credit_costs pricing
select results_eq(
  $$ select status, trigger_choice_id, quoted_credits, pricing_version from public.commercial_generation_intents where user_id = '11111111-1111-1111-1111-111111111111' and story_id = 'story-p2a-1' and chapter_number = 4; $$,
  $$ select 'WAITING_FOR_CREDITS'::text, 'choice-a'::text, 8::integer, 'v1.1-202608'::text; $$,
  'commercial_generation_intent created atomically'
);

-- 5. Test ensure_commercial_generation_intent_v1 idempotency & conflict
select lives_ok(
  $$ select public.ensure_commercial_generation_intent_v1('11111111-1111-1111-1111-111111111111', 'story-p2a-1', 4, 'choice-a'); $$,
  'ensure_commercial_generation_intent_v1 replays idempotently for same choice'
);

select throws_ok(
  $$ select public.ensure_commercial_generation_intent_v1('11111111-1111-1111-1111-111111111111', 'story-p2a-1', 4, 'choice-b'); $$,
  'P0001',
  'COMMERCIAL_INTENT_CONFLICT',
  'ensure_commercial_generation_intent_v1 raises COMMERCIAL_INTENT_CONFLICT for different choice'
);

-- 6. Test intent transition state machine
select lives_ok(
  $$ select public.transition_commercial_generation_intent_v1('11111111-1111-1111-1111-111111111111', 'story-p2a-1', 4, 'AUTHORIZED'); $$,
  'transition WAITING_FOR_CREDITS -> AUTHORIZED succeeds'
);

select lives_ok(
  $$ select public.transition_commercial_generation_intent_v1('11111111-1111-1111-1111-111111111111', 'story-p2a-1', 4, 'QUEUED'); $$,
  'transition AUTHORIZED -> QUEUED succeeds'
);

select lives_ok(
  $$ select public.transition_commercial_generation_intent_v1('11111111-1111-1111-1111-111111111111', 'story-p2a-1', 4, 'FULFILLED'); $$,
  'transition QUEUED -> FULFILLED succeeds'
);

-- 7. Test illegal transition (FULFILLED -> WAITING_FOR_CREDITS raises exception)
select throws_ok(
  $$ select public.transition_commercial_generation_intent_v1('11111111-1111-1111-1111-111111111111', 'story-p2a-1', 4, 'WAITING_FOR_CREDITS'); $$,
  'P0001',
  'INVALID_INTENT_TRANSITION',
  'transition out of FULFILLED raises INVALID_INTENT_TRANSITION'
);

-- 8. Test story_creation_requests accepts WAITING_FOR_CREDITS
select lives_ok(
  $$ insert into public.story_creation_requests (owner_user_id, request_kind, idempotency_key, request_hash, story_id, status, error_code)
     values ('11111111-1111-1111-1111-111111111111', 'personalized', 'k-wait-1', 'hash1', 'story-wait-1', 'WAITING_FOR_CREDITS', 'INSUFFICIENT_CREDITS'); $$,
  'story_creation_requests accepts status WAITING_FOR_CREDITS'
);

select results_eq(
  $$ select status from public.story_creation_requests where story_id = 'story-wait-1'; $$,
  $$ select 'WAITING_FOR_CREDITS'::text; $$,
  'story_creation_requests status is WAITING_FOR_CREDITS'
);

-- 9. Test Ch 1-3 included does NOT create intent
insert into public.stories (
  id, title, cover, tagline, role, tropes, total_chapters, status, current_chapter, jejak, owner_user_id, visibility, story_mode, generation_status
) values (
  'story-p2a-ch1', 'Test Story Ch1', '/c.webp', 'Tag', 'Role', '{}', 50, 'BARU', 1, '{}', '11111111-1111-1111-1111-111111111111', 'private', 'personalized_ai', 'ready'
) on conflict (id) do nothing;

insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, route_state, choice_history, updated_at
) values (
  '11111111-1111-1111-1111-111111111111', 'story-p2a-ch1', 'BERJALAN', 1, '[]'::jsonb, '{"truth": 0, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb, '[]'::jsonb, now()
) on conflict (user_id, story_id) do nothing;

insert into public.chapters (
  story_id, number, title, paragraphs, choice_prompt, choices
) values (
  'story-p2a-ch1', 1, 'Bab 1', jsonb_build_array('Paragraph 1'), 'Pilih:',
  jsonb_build_array(jsonb_build_object('id', 'choice-c1', 'label', 'Pilihan C1'))
) on conflict (story_id, number) do nothing;

insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending, effect_json, choice_kind
) values (
  'story-p2a-ch1', 1, 'choice-c1', jsonb_build_array('Dampak C1'), 2, false, '{"routeDeltas": {}, "trustDeltas": {}, "flagsSet": {}, "evidenceAdded": [], "endingBiasDeltas": {}}'::jsonb, 'normal'
) on conflict (story_id, chapter_number, choice_id) do nothing;

select lives_ok(
  $$
  select public.apply_personalized_choice_v2(
    '11111111-1111-1111-1111-111111111111',
    'story-p2a-ch1',
    1,
    'choice-c1',
    'k-c1',
    jsonb_build_object(
      'user_id', '11111111-1111-1111-1111-111111111111',
      'story_id', 'story-p2a-ch1',
      'status', 'BERJALAN',
      'current_chapter', 1,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth": 0, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', (select updated_at from public.reader_states where story_id = 'story-p2a-ch1')
    ),
    '{"truth": 0, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb,
    jsonb_build_object(
      'chapterNumber', 1,
      'choiceId', 'choice-c1',
      'label', 'Pilihan C1',
      'consequence', jsonb_build_array('Dampak C1'),
      'effectSummary', '{"flagsSet": []}'::jsonb,
      'createdAt', now()
    ),
    jsonb_build_object(
      'chapter', 1,
      'decision', 'Pilihan C1',
      'consequence', 'Dampak C1'
    )
  );
  $$,
  'apply_personalized_choice_v2 on Bab 1 -> Bab 2 succeeds'
);

select results_eq(
  $$ select count(*)::integer from public.commercial_generation_intents where story_id = 'story-p2a-ch1'; $$,
  $$ select 0::integer; $$,
  'Bab 1 -> Bab 2 does not create a paid intent'
);

-- 10. Test CONFIG_ERROR rollback on missing/inactive pricing config
update public.feature_credit_costs set is_active = false where feature_key = 'chapter_unlock';

insert into public.stories (
  id, title, cover, tagline, role, tropes, total_chapters, status, current_chapter, jejak, owner_user_id, visibility, story_mode, generation_status
) values (
  'story-p2a-cfg', 'Test Story Cfg', '/c.webp', 'Tag', 'Role', '{}', 50, 'BARU', 3, '{}', '11111111-1111-1111-1111-111111111111', 'private', 'personalized_ai', 'ready'
) on conflict (id) do nothing;

insert into public.reader_states (
  user_id, story_id, status, current_chapter, jejak, route_state, choice_history, updated_at
) values (
  '11111111-1111-1111-1111-111111111111', 'story-p2a-cfg', 'BERJALAN', 3, '[]'::jsonb, '{"truth": 0, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb, '[]'::jsonb, now()
) on conflict (user_id, story_id) do nothing;

insert into public.chapters (
  story_id, number, title, paragraphs, choice_prompt, choices
) values (
  'story-p2a-cfg', 3, 'Bab 3', jsonb_build_array('Paragraph 1'), 'Pilih:',
  jsonb_build_array(jsonb_build_object('id', 'choice-cfg', 'label', 'Pilihan Cfg'))
) on conflict (story_id, number) do nothing;

insert into public.choice_outcomes (
  story_id, chapter_number, choice_id, consequence, next_chapter_number, is_ending, effect_json, choice_kind
) values (
  'story-p2a-cfg', 3, 'choice-cfg', jsonb_build_array('Dampak Cfg'), 4, false, '{"routeDeltas": {}, "trustDeltas": {}, "flagsSet": {}, "evidenceAdded": [], "endingBiasDeltas": {}}'::jsonb, 'normal'
) on conflict (story_id, chapter_number, choice_id) do nothing;

select throws_ok(
  $$
  select public.apply_personalized_choice_v2(
    '11111111-1111-1111-1111-111111111111',
    'story-p2a-cfg',
    3,
    'choice-cfg',
    'k-cfg',
    jsonb_build_object(
      'user_id', '11111111-1111-1111-1111-111111111111',
      'story_id', 'story-p2a-cfg',
      'status', 'BERJALAN',
      'current_chapter', 3,
      'jejak', '[]'::jsonb,
      'ending_name', null,
      'route_state', '{"truth": 0, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb,
      'choice_history', '[]'::jsonb,
      'locked_ending_key', null,
      'updated_at', (select updated_at from public.reader_states where story_id = 'story-p2a-cfg')
    ),
    '{"truth": 0, "risk": 0, "secrecy": 0, "empathy": 0, "trust": {}, "evidence": [], "flags": {}, "endingBias": {}}'::jsonb,
    jsonb_build_object(
      'chapterNumber', 3,
      'choiceId', 'choice-cfg',
      'label', 'Pilihan Cfg',
      'consequence', jsonb_build_array('Dampak Cfg'),
      'effectSummary', '{"flagsSet": []}'::jsonb,
      'createdAt', now()
    ),
    jsonb_build_object(
      'chapter', 3,
      'decision', 'Pilihan Cfg',
      'consequence', 'Dampak Cfg'
    )
  );
  $$,
  'P0001',
  'CONFIG_ERROR',
  'choice transaction rolls back when pricing config is inactive'
);

select results_eq(
  $$ select current_chapter from public.reader_states where user_id = '11111111-1111-1111-1111-111111111111' and story_id = 'story-p2a-cfg'; $$,
  $$ select 3; $$,
  'reader_states remains unchanged after rolled-back choice transaction'
);

select * from finish();
rollback;
