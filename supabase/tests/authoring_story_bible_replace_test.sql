begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

do $$
begin
  if current_setting('lakoku.test_target', true) is distinct from 'local-cli' then
    raise exception using
      errcode = 'P0001',
      message = 'authoring story bible pgTAP tests require explicit local test target marker';
  end if;
end
$$;

select plan(44);

select has_function(
  'public',
  'replace_authoring_story_bible_v1',
  array['text', 'uuid', 'text', 'text', 'text', 'text', 'jsonb', 'integer', 'text', 'jsonb'],
  'transactional authoring story bible replacement RPC exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute replacement RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute replacement RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute replacement RPC'
);
select ok(
  not exists (
    select 1
    from aclexplode(coalesce(
      (select p.proacl from pg_proc p where p.oid = 'public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)'::regprocedure),
      acldefault('f', 0)
    )) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no replacement RPC grant'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
   'authoring-replace-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('b2000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated',
   'authoring-replace-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

create function pg_temp.canon_payload(p_story_id text, p_marker text)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
    'characters', jsonb_build_array(jsonb_build_object(
      'id', p_story_id || ':char:' || p_marker,
      'canonical_name', 'Character ' || p_marker,
      'role', 'Lead',
      'motivation', 'Protect snapshot ' || p_marker,
      'introduced_chapter', 1,
      'status', 'ALIVE'
    )),
    'character_aliases', jsonb_build_array(jsonb_build_object(
      'character_id', p_story_id || ':char:' || p_marker,
      'alias', 'Alias ' || p_marker,
      'alias_type', 'NICKNAME'
    )),
    'character_voice_sheets', jsonb_build_array(jsonb_build_object(
      'character_id', p_story_id || ':char:' || p_marker,
      'register', 'Register ' || p_marker,
      'speech_habits', jsonb_build_array('habit-' || p_marker),
      'forbidden_words', jsonb_build_array('forbidden-' || p_marker),
      'sample_lines', jsonb_build_array('sample-' || p_marker)
    )),
    'facts_ledger', jsonb_build_array(jsonb_build_object(
      'id', p_story_id || ':fact:' || p_marker,
      'statement', 'Canonical fact ' || p_marker,
      'subject_character_id', p_story_id || ':char:' || p_marker,
      'established_chapter', 1,
      'salience', 0.75,
      'load_bearing', true,
      'paid_off', false
    )),
    'knowledge_scopes', jsonb_build_array(jsonb_build_object(
      'character_id', p_story_id || ':char:' || p_marker,
      'fact_id', p_story_id || ':fact:' || p_marker,
      'known_from_chapter', 1
    )),
    'secrets_reveals', jsonb_build_array(jsonb_build_object(
      'id', p_story_id || ':secret:' || p_marker,
      'description', 'Canonical secret ' || p_marker,
      'reveal_gate_chapter', 12,
      'revealed', false
    )),
    'timeline_events', jsonb_build_array(jsonb_build_object(
      'chapter_number', 1,
      'ordinal', 0,
      'description', 'Event ' || p_marker,
      'is_flashback', false,
      'occurs_at', 1.5
    )),
    'story_threads', jsonb_build_array(jsonb_build_object(
      'id', p_story_id || ':thread:' || p_marker,
      'title', 'Thread ' || p_marker,
      'status', 'OPEN',
      'opened_chapter', 1,
      'last_touched_chapter', 1,
      'payoff_window', 20,
      'is_main_mystery', true,
      'stale', false,
      'stale_since_chapter', null
    )),
    'act_rollups', jsonb_build_array(jsonb_build_object(
      'act_number', 1,
      'summary', 'Rollup ' || p_marker,
      'state_delta', jsonb_build_object('marker', p_marker),
      'covers_from_chapter', 1,
      'covers_to_chapter', 10
    )),
    'chapter_blueprints', jsonb_build_array(jsonb_build_object(
      'chapter_number', 1,
      'version', 1,
      'phase', 'phase-' || p_marker,
      'chapter_goal', 'Goal ' || p_marker,
      'mandatory_beats', jsonb_build_array('beat-' || p_marker),
      'forbidden_reveals', jsonb_build_array(p_story_id || ':secret:' || p_marker),
      'allowed_state_delta', jsonb_build_object('marker', p_marker),
      'introduces_characters', jsonb_build_array(p_story_id || ':char:' || p_marker),
      'reconciled_from_version', null,
      'reconciliation_reason', null
    ))
  );
$fn$;

create function pg_temp.max_voice_payload(p_story_id text, p_marker text)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_set(
    pg_temp.canon_payload(p_story_id, p_marker),
    '{character_voice_sheets,0}',
    jsonb_build_object(
      'character_id', p_story_id || ':char:' || p_marker,
      'register', repeat('r', 140),
      'speech_habits', (select jsonb_agg(to_jsonb(repeat('h', 120))) from generate_series(1, 6)),
      'forbidden_words', (select jsonb_agg(to_jsonb(repeat('f', 40))) from generate_series(1, 10)),
      'sample_lines', (select jsonb_agg(to_jsonb(repeat('s', 200))) from generate_series(1, 4))
    )
  );
$fn$;

set local role service_role;
select is(
  public.replace_authoring_story_bible_v1(
    'test:authoring-max-voice', 'a1000000-0000-4000-8000-000000000011',
    'Max voice story', '/max-voice.svg', 'Max voice tagline', 'Max voice role',
    '["Voice bounds","Persistence"]'::jsonb, 50,
    'Max voice synopsis remains long enough while every enriched voice field reaches its application bound.',
    pg_temp.max_voice_payload('test:authoring-max-voice', 'MAX')
  ),
  '{"ok":true,"status":"REPLACED"}'::jsonb,
  'max-bound enriched opening voice replacement succeeds'
);
select is(
  (
    select row(
      char_length(register),
      jsonb_array_length(speech_habits),
      (select min(char_length(value #>> '{}')) from jsonb_array_elements(speech_habits)),
      jsonb_array_length(forbidden_words),
      (select min(char_length(value #>> '{}')) from jsonb_array_elements(forbidden_words)),
      jsonb_array_length(sample_lines),
      (select min(char_length(value #>> '{}')) from jsonb_array_elements(sample_lines))
    )::text
    from public.character_voice_sheets
    where story_id = 'test:authoring-max-voice'
  ),
  row(140, 6, 120, 10, 40, 4, 200)::text,
  'max-bound enriched opening voice content persists exactly'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-register-over', 'a1000000-0000-4000-8000-000000000011',
    'Register over story', '/register-over.svg', 'Register over tagline', 'Register over role',
    '["Voice bounds","Rejection"]',
    'Register over synopsis remains valid while only enriched voice register exceeds its application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-register-over', 'REG'), '{character_voice_sheets,0,register}', to_jsonb(repeat('r', 141)))::text
  ),
  '22023', null,
  'register rejects one character over application bound'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-habit-count-over', 'a1000000-0000-4000-8000-000000000011',
    'Habit count over story', '/habit-count-over.svg', 'Habit count tagline', 'Habit count role',
    '["Voice bounds","Rejection"]',
    'Habit count synopsis remains valid while only enriched voice habit count exceeds its application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-habit-count-over', 'HC'), '{character_voice_sheets,0,speech_habits}', (select jsonb_agg(to_jsonb(repeat('h', 120))) from generate_series(1, 7)))::text
  ),
  '22023', null,
  'speech habits reject one item over application count bound'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-habit-length-over', 'a1000000-0000-4000-8000-000000000011',
    'Habit length over story', '/habit-length-over.svg', 'Habit length tagline', 'Habit length role',
    '["Voice bounds","Rejection"]',
    'Habit length synopsis remains valid while only one enriched voice habit exceeds its application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-habit-length-over', 'HL'), '{character_voice_sheets,0,speech_habits,0}', to_jsonb(repeat('h', 121)))::text
  ),
  '22023', null,
  'speech habit rejects one character over application element bound'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-forbidden-count-over', 'a1000000-0000-4000-8000-000000000011',
    'Forbidden count over story', '/forbidden-count-over.svg', 'Forbidden count tagline', 'Forbidden count role',
    '["Voice bounds","Rejection"]',
    'Forbidden count synopsis remains valid while only enriched voice forbidden count exceeds its application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-forbidden-count-over', 'FC'), '{character_voice_sheets,0,forbidden_words}', (select jsonb_agg(to_jsonb(repeat('f', 40))) from generate_series(1, 11)))::text
  ),
  '22023', null,
  'forbidden words reject one item over application count bound'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-forbidden-length-over', 'a1000000-0000-4000-8000-000000000011',
    'Forbidden length over story', '/forbidden-length-over.svg', 'Forbidden length tagline', 'Forbidden length role',
    '["Voice bounds","Rejection"]',
    'Forbidden length synopsis remains valid while only one forbidden word exceeds its unchanged application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-forbidden-length-over', 'FL'), '{character_voice_sheets,0,forbidden_words,0}', to_jsonb(repeat('f', 41)))::text
  ),
  '22023', null,
  'forbidden word rejects one character over unchanged application element bound'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-sample-count-over', 'a1000000-0000-4000-8000-000000000011',
    'Sample count over story', '/sample-count-over.svg', 'Sample count tagline', 'Sample count role',
    '["Voice bounds","Rejection"]',
    'Sample count synopsis remains valid while only enriched voice sample count exceeds its application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-sample-count-over', 'SC'), '{character_voice_sheets,0,sample_lines}', (select jsonb_agg(to_jsonb(repeat('s', 200))) from generate_series(1, 5)))::text
  ),
  '22023', null,
  'sample lines reject one item over application count bound'
);
select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-sample-length-over', 'a1000000-0000-4000-8000-000000000011',
    'Sample length over story', '/sample-length-over.svg', 'Sample length tagline', 'Sample length role',
    '["Voice bounds","Rejection"]',
    'Sample length synopsis remains valid while only one enriched voice sample exceeds its application bound.',
    jsonb_set(pg_temp.max_voice_payload('test:authoring-sample-length-over', 'SL'), '{character_voice_sheets,0,sample_lines,0}', to_jsonb(repeat('s', 201)))::text
  ),
  '22023', null,
  'sample line rejects one character over application element bound'
);

select is(
  public.replace_authoring_story_bible_v1(
    'test:authoring-replace', 'a1000000-0000-4000-8000-000000000011',
    'Snapshot A story', '/snapshot-a.svg', 'Snapshot A tagline', 'Snapshot A role',
    '["Atomic canon","Owner safety"]'::jsonb, 50,
    'Snapshot A synopsis is long enough to satisfy strict normalized authoring metadata bounds.',
    pg_temp.canon_payload('test:authoring-replace', 'A')
  ),
  '{"ok":true,"status":"REPLACED"}'::jsonb,
  'complete snapshot A replacement succeeds'
);
select is(
  (
    select row(
      (select count(*) from public.characters where story_id = s.id),
      (select count(*) from public.character_states cs join public.characters c on c.id = cs.character_id where c.story_id = s.id),
      (select count(*) from public.character_aliases where story_id = s.id),
      (select count(*) from public.character_voice_sheets where story_id = s.id),
      (select count(*) from public.facts_ledger where story_id = s.id),
      (select count(*) from public.knowledge_scopes where story_id = s.id),
      (select count(*) from public.secrets_reveals where story_id = s.id),
      (select count(*) from public.timeline_events where story_id = s.id),
      (select count(*) from public.story_threads where story_id = s.id),
      (select count(*) from public.act_rollups where story_id = s.id),
      (select count(*) from public.chapter_blueprints where story_id = s.id)
    )::text
    from public.stories s where s.id = 'test:authoring-replace'
  ),
  row(1::bigint,1::bigint,1::bigint,1::bigint,1::bigint,1::bigint,1::bigint,1::bigint,1::bigint,1::bigint,1::bigint)::text,
  'replacement writes every canon table managed by persistStoryBible'
);
select is(
  (
    select row(
      s.owner_user_id, s.title,
      c.canonical_name,
      cs.status, cs.as_of_chapter, cs.attributes,
      ca.alias, ca.alias_type,
      cvs.register, cvs.speech_habits, cvs.forbidden_words, cvs.sample_lines,
      f.statement,
      ks.character_id, ks.fact_id, ks.known_from_chapter,
      sr.description, sr.reveal_gate_chapter, sr.revealed,
      te.description, st.title, ar.summary, cb.phase
    )::text
    from public.stories s
    join public.characters c on c.story_id = s.id
    join public.character_states cs on cs.character_id = c.id
    join public.character_aliases ca on ca.story_id = s.id
    join public.character_voice_sheets cvs on cvs.story_id = s.id
    join public.facts_ledger f on f.story_id = s.id
    join public.knowledge_scopes ks on ks.story_id = s.id
    join public.secrets_reveals sr on sr.story_id = s.id
    join public.timeline_events te on te.story_id = s.id
    join public.story_threads st on st.story_id = s.id
    join public.act_rollups ar on ar.story_id = s.id
    join public.chapter_blueprints cb on cb.story_id = s.id
    where s.id = 'test:authoring-replace'
  ),
  row(
    'a1000000-0000-4000-8000-000000000011'::uuid,
    'Snapshot A story',
    'Character A',
    'ALIVE', 1, '{}'::jsonb,
    'Alias A', 'NICKNAME',
    'Register A', '["habit-A"]'::jsonb, '["forbidden-A"]'::jsonb, '["sample-A"]'::jsonb,
    'Canonical fact A',
    'test:authoring-replace:char:A', 'test:authoring-replace:fact:A', 1,
    'Canonical secret A', 12, false,
    'Event A', 'Thread A', 'Rollup A', 'phase-A'
  )::text,
  'snapshot A persists exact shell and every managed canon table content'
);

select is(
  public.replace_authoring_story_bible_v1(
    'test:authoring-replace', 'a1000000-0000-4000-8000-000000000011',
    'Snapshot B story', '/snapshot-b.svg', 'Snapshot B tagline', 'Snapshot B role',
    '["Serialized update","Complete snapshot"]'::jsonb, 50,
    'Snapshot B synopsis is long enough to satisfy strict normalized authoring metadata bounds.',
    pg_temp.canon_payload('test:authoring-replace', 'B')
  ),
  '{"ok":true,"status":"REPLACED"}'::jsonb,
  'same owner replaces complete snapshot'
);
select is(
  (
    select row(
      s.title,
      (select string_agg(canonical_name, ',') from public.characters where story_id = s.id),
      (select string_agg(statement, ',') from public.facts_ledger where story_id = s.id),
      (select string_agg(description, ',') from public.timeline_events where story_id = s.id),
      (select string_agg(phase, ',') from public.chapter_blueprints where story_id = s.id)
    )::text
    from public.stories s where s.id = 'test:authoring-replace'
  ),
  row('Snapshot B story', 'Character B', 'Canonical fact B', 'Event B', 'phase-B')::text,
  'replacement removes all prior A rows and leaves coherent B snapshot'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-replace', 'a1000000-0000-4000-8000-000000000011',
    'Broken story title', '/broken.svg', 'Broken story tagline', 'Broken story role',
    '["Broken child","Rollback test"]',
    'Broken replacement synopsis remains valid so malformed child FK forces transaction rollback.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-replace', 'BROKEN'),
      '{knowledge_scopes,0,fact_id}',
      '"test:authoring-replace:fact:missing"'::jsonb
    )::text
  ),
  '22023',
  null,
  'malformed child reference aborts replacement before writes'
);
select is(
  (select row(title, cover, tagline, role)::text from public.stories where id = 'test:authoring-replace'),
  row('Snapshot B story', '/snapshot-b.svg', 'Snapshot B tagline', 'Snapshot B role')::text,
  'malformed child insert rolls back shell metadata'
);
select is(
  (
    select row(
      (select string_agg(c.id || ':' || c.canonical_name, ',') from public.characters c where c.story_id = s.id),
      (select string_agg(cs.character_id || ':' || cs.status || ':' || cs.as_of_chapter, ',') from public.character_states cs join public.characters c on c.id = cs.character_id where c.story_id = s.id),
      (select string_agg(character_id || ':' || alias || ':' || alias_type, ',') from public.character_aliases where story_id = s.id),
      (select string_agg(character_id || ':' || register || ':' || speech_habits::text || ':' || forbidden_words::text || ':' || sample_lines::text, ',') from public.character_voice_sheets where story_id = s.id),
      (select string_agg(id || ':' || statement || ':' || coalesce(subject_character_id, ''), ',') from public.facts_ledger where story_id = s.id),
      (select string_agg(character_id || ':' || fact_id || ':' || known_from_chapter, ',') from public.knowledge_scopes where story_id = s.id),
      (select string_agg(id || ':' || description || ':' || reveal_gate_chapter || ':' || revealed, ',') from public.secrets_reveals where story_id = s.id),
      (select string_agg(description, ',') from public.timeline_events where story_id = s.id),
      (select string_agg(id || ':' || title || ':' || status, ',') from public.story_threads where story_id = s.id),
      (select string_agg(act_number || ':' || summary, ',') from public.act_rollups where story_id = s.id),
      (select string_agg(chapter_number || ':' || version || ':' || phase, ',') from public.chapter_blueprints where story_id = s.id)
    )::text
    from public.stories s where s.id = 'test:authoring-replace'
  ),
  row(
    'test:authoring-replace:char:B:Character B',
    'test:authoring-replace:char:B:ALIVE:1',
    'test:authoring-replace:char:B:Alias B:NICKNAME',
    'test:authoring-replace:char:B:Register B:["habit-B"]:["forbidden-B"]:["sample-B"]',
    'test:authoring-replace:fact:B:Canonical fact B:test:authoring-replace:char:B',
    'test:authoring-replace:char:B:test:authoring-replace:fact:B:1',
    'test:authoring-replace:secret:B:Canonical secret B:12:false',
    'Event B',
    'test:authoring-replace:thread:B:Thread B:OPEN',
    '1:Rollup B',
    '1:1:phase-B'
  )::text,
  'malformed child insert rolls back every managed canon table and preserves prior snapshot'
);

select is(
  public.replace_authoring_story_bible_v1(
    'test:authoring-replace', 'b2000000-0000-4000-8000-000000000012',
    'Owner mismatch title', '/mismatch.svg', 'Owner mismatch tagline', 'Owner mismatch role',
    '["Wrong owner","Zero writes"]'::jsonb, 50,
    'Different owner synopsis remains valid but ownership must reject it before any database writes.',
    pg_temp.canon_payload('test:authoring-replace', 'WRONG')
  ),
  '{"ok":false,"status":"OWNER_MISMATCH"}'::jsonb,
  'different owner receives typed OWNER_MISMATCH'
);
select is(
  (
    select row(owner_user_id, title,
      (select string_agg(canonical_name, ',') from public.characters where story_id = s.id),
      (select string_agg(statement, ',') from public.facts_ledger where story_id = s.id)
    )::text from public.stories s where id = 'test:authoring-replace'
  ),
  row('a1000000-0000-4000-8000-000000000011'::uuid, 'Snapshot B story', 'Character B', 'Canonical fact B')::text,
  'different owner performs zero shell and canon writes'
);

insert into public.stories (id, title, owner_user_id, visibility, source_story_id)
values ('test:authoring-replace-null', 'Null owner original', null, 'private', 'legacy-source');
select is(
  public.replace_authoring_story_bible_v1(
    'test:authoring-replace-null', 'a1000000-0000-4000-8000-000000000011',
    'Null owner claim title', '/null.svg', 'Null owner claim tagline', 'Null owner role',
    '["Null owner","Zero writes"]'::jsonb, 50,
    'Null owner replacement synopsis remains valid but existing orphan shells cannot be claimed.',
    pg_temp.canon_payload('test:authoring-replace-null', 'NULL')
  ),
  '{"ok":false,"status":"OWNER_MISMATCH"}'::jsonb,
  'existing null owner receives typed OWNER_MISMATCH'
);
select is(
  (select row(owner_user_id, title, source_story_id)::text from public.stories where id = 'test:authoring-replace-null'),
  row(null::uuid, 'Null owner original', 'legacy-source')::text,
  'null-owner conflict performs zero shell writes'
);
select is(
  (select count(*) from public.characters where story_id = 'test:authoring-replace-null'),
  0::bigint,
  'null-owner conflict performs zero canon writes'
);

select throws_ok(
  $$select public.replace_authoring_story_bible_v1(
    'test:authoring-malformed', 'a1000000-0000-4000-8000-000000000011',
    'Malformed payload', '/malformed.svg', 'Malformed payload tagline', 'Malformed role',
    '["Malformed JSON","Safe failure"]'::jsonb, 50,
    'Malformed payload synopsis is valid so SQL canon shape validation must reject missing arrays.',
    '{"characters":[]}'::jsonb
  )$$,
  '22023',
  null,
  'incomplete canon object is rejected before writes'
);
select is(
  (select count(*) from public.stories where id = 'test:authoring-malformed'),
  0::bigint,
  'malformed canon rejection creates no shell'
);

select throws_ok(
  $$select public.replace_authoring_story_bible_v1(
    'test:authoring-bad-meta', 'a1000000-0000-4000-8000-000000000011',
    'ab', '/bad.svg', 'Bad metadata tagline', 'Bad metadata role',
    '["Bad metadata","Safe failure"]'::jsonb, 50,
    'Invalid metadata synopsis remains long but title violates strict normalized lower bounds.',
    pg_temp.canon_payload('test:authoring-bad-meta', 'BAD')
  )$$,
  '22023',
  null,
  'metadata outside strict claim bounds is rejected'
);
select is(
  (select count(*) from public.stories where id = 'test:authoring-bad-meta'),
  0::bigint,
  'invalid metadata creates no shell or canon'
);

insert into public.stories (id, title, owner_user_id, visibility)
values ('test:authoring-foreign', 'Foreign canon owner', 'b2000000-0000-4000-8000-000000000012', 'private');
insert into public.characters (id, story_id, canonical_name, role, motivation, introduced_chapter)
values ('test:authoring-foreign:char:X', 'test:authoring-foreign', 'Foreign X', 'Lead', 'Remain foreign forever', 1);
insert into public.character_states (character_id, status, as_of_chapter, attributes)
values ('test:authoring-foreign:char:X', 'ALIVE', 1, '{}'::jsonb);
insert into public.facts_ledger (
  id, story_id, statement, subject_character_id, established_chapter, salience, load_bearing, paid_off
) values (
  'test:authoring-foreign:fact:X', 'test:authoring-foreign', 'Foreign fact X',
  'test:authoring-foreign:char:X', 1, 0.5, false, false
);
insert into public.secrets_reveals (id, story_id, description, reveal_gate_chapter, revealed)
values ('test:authoring-foreign:secret:X', 'test:authoring-foreign', 'Foreign secret X', 10, false);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-unknown-row-key', 'a1000000-0000-4000-8000-000000000011',
    'Unknown row key', '/unknown.svg', 'Unknown row key tagline', 'Unknown row role',
    '["Unknown field","Strict rows"]',
    'Unknown row key synopsis remains valid but exact allowed keys must reject the child object.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-unknown-row-key', 'UNKNOWN'),
      '{characters,0,unexpected}', 'true'::jsonb
    )::text
  ),
  '22023', null,
  'unknown child row key is rejected before writes'
);
select is(
  (select count(*) from public.stories where id = 'test:authoring-unknown-row-key'),
  0::bigint,
  'unknown child row key performs zero shell writes'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-invalid-row', 'a1000000-0000-4000-8000-000000000011',
    'Invalid child row', '/invalid-row.svg', 'Invalid child row tagline', 'Invalid child role',
    '["Invalid scalar","Strict rows"]',
    'Invalid row synopsis remains valid but out of range chapter values must fail before writes.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-invalid-row', 'INVALID'),
      '{characters,0,introduced_chapter}', '51'::jsonb
    )::text
  ),
  '22023', null,
  'invalid child scalar bounds are rejected before writes'
);
select is(
  (select count(*) from public.stories where id = 'test:authoring-invalid-row'),
  0::bigint,
  'invalid child scalar performs zero shell writes'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-global-collision', 'a1000000-0000-4000-8000-000000000011',
    'Global ID collision', '/collision.svg', 'Global ID collision tagline', 'Collision role',
    '["Global IDs","Cross story"]',
    'Global ID collision synopsis remains valid but a foreign story character ID must be rejected early.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-global-collision', 'COLLISION'),
      '{characters,0,id}', '"test:authoring-foreign:char:X"'::jsonb
    )::text
  ),
  '22023', null,
  'globally unique character ID owned by another story is rejected before writes'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-replace', 'a1000000-0000-4000-8000-000000000011',
    'Cross story alias', '/cross-alias.svg', 'Cross story alias tagline', 'Cross alias role',
    '["Cross reference","Local canon"]',
    'Cross story alias synopsis remains valid but foreign character references must never satisfy global FKs.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-replace', 'CROSS'),
      '{character_aliases,0,character_id}', '"test:authoring-foreign:char:X"'::jsonb
    )::text
  ),
  '22023', null,
  'alias cannot reference character from another story'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-replace', 'a1000000-0000-4000-8000-000000000011',
    'Cross story knowledge', '/cross-knowledge.svg', 'Cross knowledge tagline', 'Cross knowledge role',
    '["Cross fact","Local canon"]',
    'Cross story knowledge synopsis remains valid but foreign facts must never satisfy global fact FKs.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-replace', 'CROSS'),
      '{knowledge_scopes,0,fact_id}', '"test:authoring-foreign:fact:X"'::jsonb
    )::text
  ),
  '22023', null,
  'knowledge cannot reference fact from another story'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-wrong-story-field', 'a1000000-0000-4000-8000-000000000011',
    'Wrong story field', '/wrong-story.svg', 'Wrong story field tagline', 'Wrong story role',
    '["Story locality","Strict fields"]',
    'Wrong story field synopsis remains valid but supplied mismatched story IDs must be rejected safely.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-wrong-story-field', 'WRONG'),
      '{characters,0,story_id}', '"test:authoring-foreign"'::jsonb
    )::text
  ),
  '22023', null,
  'mismatched child story_id is rejected rather than ignored'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-replace', 'a1000000-0000-4000-8000-000000000011',
    'Cross blueprint refs', '/cross-blueprint.svg', 'Cross blueprint tagline', 'Cross blueprint role',
    '["Blueprint refs","Local canon"]',
    'Cross blueprint synopsis remains valid but character and secret arrays must reference local payload IDs.',
    jsonb_set(
      jsonb_set(
        pg_temp.canon_payload('test:authoring-replace', 'CROSS'),
        '{chapter_blueprints,0,introduces_characters}', '["test:authoring-foreign:char:X"]'::jsonb
      ),
      '{chapter_blueprints,0,forbidden_reveals}', '["test:authoring-foreign:secret:X"]'::jsonb
    )::text
  ),
  '22023', null,
  'blueprint character and secret references must be local payload IDs'
);

select throws_ok(
  format(
    'select public.replace_authoring_story_bible_v1(%L,%L::uuid,%L,%L,%L,%L,%L::jsonb,50,%L,%L::jsonb)',
    'test:authoring-duplicate-id', 'a1000000-0000-4000-8000-000000000011',
    'Duplicate canon ID', '/duplicate.svg', 'Duplicate canon ID tagline', 'Duplicate role',
    '["Duplicate IDs","Strict payload"]',
    'Duplicate ID synopsis remains valid but duplicate globally unique payload IDs must fail before writes.',
    jsonb_set(
      pg_temp.canon_payload('test:authoring-duplicate-id', 'DUP'),
      '{characters}',
      (pg_temp.canon_payload('test:authoring-duplicate-id', 'DUP') -> 'characters') ||
      (pg_temp.canon_payload('test:authoring-duplicate-id', 'DUP') -> 'characters')
    )::text
  ),
  '22023', null,
  'duplicate payload character IDs are rejected before writes'
);

select is(
  (select row(title, cover, tagline, role)::text from public.stories where id = 'test:authoring-replace'),
  row('Snapshot B story', '/snapshot-b.svg', 'Snapshot B tagline', 'Snapshot B role')::text,
  'malicious payload attempts perform zero target shell mutation'
);
select is(
  (
    select row(
      (select string_agg(c.id || ':' || c.canonical_name, ',') from public.characters c where c.story_id = s.id),
      (select string_agg(cs.character_id || ':' || cs.status || ':' || cs.as_of_chapter, ',') from public.character_states cs join public.characters c on c.id = cs.character_id where c.story_id = s.id),
      (select string_agg(character_id || ':' || alias, ',') from public.character_aliases where story_id = s.id),
      (select string_agg(character_id || ':' || register, ',') from public.character_voice_sheets where story_id = s.id),
      (select string_agg(id || ':' || statement, ',') from public.facts_ledger where story_id = s.id),
      (select string_agg(character_id || ':' || fact_id || ':' || known_from_chapter, ',') from public.knowledge_scopes where story_id = s.id),
      (select string_agg(id || ':' || description, ',') from public.secrets_reveals where story_id = s.id),
      (select string_agg(description, ',') from public.timeline_events where story_id = s.id),
      (select string_agg(id || ':' || title, ',') from public.story_threads where story_id = s.id),
      (select string_agg(act_number || ':' || summary, ',') from public.act_rollups where story_id = s.id),
      (select string_agg(chapter_number || ':' || version || ':' || phase, ',') from public.chapter_blueprints where story_id = s.id)
    )::text
    from public.stories s where s.id = 'test:authoring-replace'
  ),
  row(
    'test:authoring-replace:char:B:Character B',
    'test:authoring-replace:char:B:ALIVE:1',
    'test:authoring-replace:char:B:Alias B',
    'test:authoring-replace:char:B:Register B',
    'test:authoring-replace:fact:B:Canonical fact B',
    'test:authoring-replace:char:B:test:authoring-replace:fact:B:1',
    'test:authoring-replace:secret:B:Canonical secret B',
    'Event B',
    'test:authoring-replace:thread:B:Thread B',
    '1:Rollup B',
    '1:1:phase-B'
  )::text,
  'malicious payload attempts perform zero mutation across every managed canon table'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)'::regprocedure)
  and pg_get_functiondef('public.replace_authoring_story_bible_v1(text,uuid,text,text,text,text,jsonb,integer,text,jsonb)'::regprocedure)
    ~* 'pg_advisory_xact_lock',
  'RPC is SECURITY INVOKER with empty search path and transactional advisory lock'
);
reset role;

select * from finish();
rollback;
