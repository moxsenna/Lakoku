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

select plan(23);

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
      'statement', 'Fact ' || p_marker,
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
      'description', 'Secret ' || p_marker,
      'reveal_gate_chapter', 10,
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

set local role service_role;
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
    select row(s.owner_user_id, s.title, c.canonical_name, f.statement, te.description, st.title, ar.summary, cb.phase)::text
    from public.stories s
    join public.characters c on c.story_id = s.id
    join public.facts_ledger f on f.story_id = s.id
    join public.timeline_events te on te.story_id = s.id
    join public.story_threads st on st.story_id = s.id
    join public.act_rollups ar on ar.story_id = s.id
    join public.chapter_blueprints cb on cb.story_id = s.id
    where s.id = 'test:authoring-replace'
  ),
  row(
    'a1000000-0000-4000-8000-000000000011'::uuid,
    'Snapshot A story', 'Character A', 'Fact A', 'Event A', 'Thread A', 'Rollup A', 'phase-A'
  )::text,
  'snapshot A contents and shell metadata persist together'
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
  row('Snapshot B story', 'Character B', 'Fact B', 'Event B', 'phase-B')::text,
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
  '23503',
  null,
  'malformed child FK aborts replacement statement'
);
select is(
  (select row(title, cover, tagline, role)::text from public.stories where id = 'test:authoring-replace'),
  row('Snapshot B story', '/snapshot-b.svg', 'Snapshot B tagline', 'Snapshot B role')::text,
  'malformed child insert rolls back shell metadata'
);
select is(
  (
    select row(
      (select string_agg(canonical_name, ',') from public.characters where story_id = s.id),
      (select string_agg(statement, ',') from public.facts_ledger where story_id = s.id),
      (select string_agg(description, ',') from public.timeline_events where story_id = s.id),
      (select string_agg(phase, ',') from public.chapter_blueprints where story_id = s.id)
    )::text
    from public.stories s where s.id = 'test:authoring-replace'
  ),
  row('Character B', 'Fact B', 'Event B', 'phase-B')::text,
  'malformed child insert rolls back all canon and preserves prior snapshot'
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
  row('a1000000-0000-4000-8000-000000000011'::uuid, 'Snapshot B story', 'Character B', 'Fact B')::text,
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
