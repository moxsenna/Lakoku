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
      message = 'personalized story pgTAP tests require explicit local test target marker';
  end if;
end
$$;

select plan(71);

-- Personalized story shape.
select has_column('public', 'stories', 'source_story_id', 'stories.source_story_id exists');
select has_column('public', 'stories', 'story_mode', 'stories.story_mode exists');
select has_column('public', 'stories', 'generation_status', 'stories.generation_status exists');
select has_column('public', 'stories', 'story_contract_version', 'stories.story_contract_version exists');
select has_column('public', 'reader_states', 'route_state', 'reader_states.route_state exists');
select has_column('public', 'reader_states', 'choice_history', 'reader_states.choice_history exists');
select has_column('public', 'reader_states', 'locked_ending_key', 'reader_states.locked_ending_key exists');
select has_column('public', 'choice_outcomes', 'effect_json', 'choice_outcomes.effect_json exists');
select has_column('public', 'choice_outcomes', 'choice_kind', 'choice_outcomes.choice_kind exists');

select has_table('public', 'story_generation_contracts', 'story_generation_contracts exists');
select has_table('public', 'story_creation_requests', 'story_creation_requests reserves strong-idempotency keys');
select has_column('public', 'story_creation_requests', 'owner_user_id', 'creation requests identify owner');
select has_column('public', 'story_creation_requests', 'request_kind', 'creation requests identify request kind');
select has_column('public', 'story_creation_requests', 'idempotency_key', 'creation requests store idempotency key');
select has_column('public', 'story_creation_requests', 'request_hash', 'creation requests bind key to request hash');
select has_column('public', 'story_creation_requests', 'story_id', 'creation requests reserve story id');
select has_column('public', 'story_creation_requests', 'status', 'creation requests track status');
select has_column('public', 'story_creation_requests', 'error_code', 'creation requests track failure code');
select has_column('public', 'story_creation_requests', 'created_at', 'creation requests track creation time');
select has_column('public', 'story_creation_requests', 'updated_at', 'creation requests track update time');

select has_index('public', 'stories', 'stories_source_story_idx', 'source story lookup index exists');
select has_index('public', 'stories', 'stories_owner_mode_idx', 'owner and story mode lookup index exists');
select has_index('public', 'choice_outcomes', 'choice_outcomes_effect_idx', 'outcome effect lookup index exists');

-- Constraints must encode contract, not rely on application validation.
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_story_mode_check'
      and pg_get_constraintdef(oid) like '%personalized_ai%'
      and pg_get_constraintdef(oid) like '%premium_template%'
      and pg_get_constraintdef(oid) like '%premium_instance%'
  ),
  'story_mode allows only approved modes'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_generation_status_check'
      and pg_get_constraintdef(oid) like '%creating_contract%'
      and pg_get_constraintdef(oid) like '%generating_chapter%'
      and pg_get_constraintdef(oid) like '%needs_review%'
  ),
  'generation_status allows only approved lifecycle states'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.story_generation_contracts')
      and pg_get_constraintdef(oid) like '%total_chapters = 50%'
  ),
  'generation contracts require exactly 50 chapters'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.story_generation_contracts')
      and pg_get_constraintdef(oid) like '%template_fallback%'
      and pg_get_constraintdef(oid) like '%llm_repaired%'
  ),
  'generation contracts constrain contract_source'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.story_creation_requests')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%request_kind%personalized%premium_clone%'
  ),
  'creation request kind allows only personalized and premium_clone'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.story_creation_requests')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%RESERVED%READY%FAILED%'
  ),
  'creation request status allows only RESERVED, READY, and FAILED'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.story_creation_requests')
      and contype = 'p'
      and pg_get_constraintdef(oid) like '%owner_user_id%request_kind%idempotency_key%'
  ),
  'creation request primary key provides owner-scoped strong idempotency'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.story_creation_requests')
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%story_id%'
  ),
  'creation request story_id is unique'
);

-- RLS must cover every reader-visible or internal personalized table.
select ok(coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.stories')), false), 'stories RLS enabled');
select ok(coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.chapters')), false), 'chapters RLS enabled');
select ok(coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.choice_outcomes')), false), 'choice_outcomes RLS enabled');
select ok(coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.reader_states')), false), 'reader_states RLS enabled');
select ok(coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.story_generation_contracts')), false), 'story_generation_contracts RLS enabled');
select ok(coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.story_creation_requests')), false), 'story_creation_requests RLS enabled');

-- Policy shape and grants complement behavior tests in personalized_story_rls_test.sql.
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stories'
      and policyname = 'stories_public_read'
      and cmd = 'SELECT'
      and roles @> array['anon','authenticated']::name[]
      and qual like '%visibility%public%'
      and qual not in ('true', '(true)')
  ),
  'public story policy filters visibility instead of USING (true)'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stories'
      and policyname = 'stories_owner_read'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%owner_user_id%auth.uid%'
  ),
  'authenticated owners can read their stories'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chapters'
      and policyname = 'chapters_public_read'
      and qual like '%story_is_public%story_id%'
      and qual not in ('true', '(true)')
  ),
  'chapter public policy follows parent visibility'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'choice_outcomes'
      and policyname = 'choice_outcomes_public_read'
      and qual like '%story_is_public%story_id%'
      and qual not in ('true', '(true)')
  ),
  'outcome public policy follows parent visibility'
);
select policies_are(
  'public',
  'stories',
  array['stories_owner_read', 'stories_public_read'],
  'stories have exact owner and public SELECT policy set'
);
select policies_are(
  'public',
  'chapters',
  array['chapters_owner_read', 'chapters_public_read'],
  'chapters have exact parent-scoped SELECT policy set'
);
select policies_are(
  'public',
  'choice_outcomes',
  array['choice_outcomes_owner_read', 'choice_outcomes_public_read'],
  'choice_outcomes have exact parent-scoped SELECT policy set'
);
select policies_are(
  'public',
  'reader_states',
  array['reader_states_owner'],
  'reader_states have exact owner-only policy set'
);
select policies_are(
  'public',
  'story_generation_contracts',
  array['sgc_owner_read'],
  'story_generation_contracts have exact owner-only policy set'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('stories', 'chapters', 'choice_outcomes', 'story_generation_contracts', 'story_creation_requests')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (roles && array['anon','authenticated']::name[] or roles = array['public']::name[])
  ),
  'anon and authenticated have no personalized internal write policy'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'story_creation_requests'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'creation requests expose no direct anon or authenticated table privileges'
);
select ok(
  has_table_privilege('service_role', 'public.stories', 'INSERT')
    and has_table_privilege('service_role', 'public.chapters', 'INSERT')
    and has_table_privilege('service_role', 'public.choice_outcomes', 'INSERT'),
  'service_role can write personalized story core tables'
);

-- Column grants keep PostgREST reader contracts usable without exposing engine state.
select ok(
  has_column_privilege('anon', 'public.stories', 'id', 'SELECT')
    and has_column_privilege('authenticated', 'public.stories', 'title', 'SELECT'),
  'readers can select safe story columns'
);
select ok(
  not has_column_privilege('anon', 'public.stories', 'owner_user_id', 'SELECT')
    and not has_column_privilege('authenticated', 'public.stories', 'visibility', 'SELECT'),
  'readers cannot select story ownership or visibility internals'
);
select ok(
  not has_column_privilege('anon', 'public.stories', 'source_story_id', 'SELECT')
    and not has_column_privilege('authenticated', 'public.stories', 'story_mode', 'SELECT'),
  'readers cannot select story source or mode internals'
);
select ok(
  not has_column_privilege('anon', 'public.stories', 'generation_status', 'SELECT')
    and not has_column_privilege('authenticated', 'public.stories', 'story_contract_version', 'SELECT'),
  'readers cannot select story generation internals'
);
select ok(
  has_column_privilege('anon', 'public.chapters', 'paragraphs', 'SELECT')
    and has_column_privilege('authenticated', 'public.chapters', 'choices', 'SELECT'),
  'readers can select safe chapter columns'
);
select ok(
  not has_column_privilege('anon', 'public.chapters', 'created_at', 'SELECT')
    and not has_column_privilege('authenticated', 'public.chapters', 'created_at', 'SELECT'),
  'readers cannot select chapter metadata outside reader contract'
);
select ok(
  has_column_privilege('anon', 'public.choice_outcomes', 'consequence', 'SELECT')
    and has_column_privilege('authenticated', 'public.choice_outcomes', 'is_ending', 'SELECT'),
  'readers can select safe outcome columns'
);
select ok(
  not has_column_privilege('anon', 'public.choice_outcomes', 'effect_json', 'SELECT')
    and not has_column_privilege('authenticated', 'public.choice_outcomes', 'effect_json', 'SELECT'),
  'readers cannot select outcome effects'
);
select ok(
  not has_column_privilege('anon', 'public.choice_outcomes', 'choice_kind', 'SELECT')
    and not has_column_privilege('authenticated', 'public.choice_outcomes', 'choice_kind', 'SELECT'),
  'readers cannot select internal choice kind'
);
select ok(
  has_column_privilege('anon', 'public.reader_states', 'story_id', 'SELECT')
    and has_column_privilege('authenticated', 'public.reader_states', 'current_chapter', 'SELECT'),
  'reader-state safe progress columns remain selectable'
);
select ok(
  not has_column_privilege('anon', 'public.reader_states', 'route_state', 'SELECT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'route_state', 'SELECT'),
  'readers cannot select route state'
);
select ok(
  not has_column_privilege('anon', 'public.reader_states', 'choice_history', 'SELECT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'choice_history', 'SELECT'),
  'readers cannot select choice history'
);
select ok(
  not has_column_privilege('anon', 'public.reader_states', 'locked_ending_key', 'SELECT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'locked_ending_key', 'SELECT'),
  'readers cannot select locked ending key'
);
select ok(
  has_column_privilege('authenticated', 'public.reader_states', 'user_id', 'INSERT')
    and has_column_privilege('authenticated', 'public.reader_states', 'status', 'UPDATE')
    and has_column_privilege('authenticated', 'public.reader_states', 'updated_at', 'UPDATE'),
  'authenticated reader-state upsert keeps safe progress writes'
);
select ok(
  not has_column_privilege('authenticated', 'public.reader_states', 'route_state', 'INSERT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'route_state', 'UPDATE'),
  'authenticated clients cannot write route state'
);
select ok(
  not has_column_privilege('authenticated', 'public.reader_states', 'choice_history', 'INSERT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'choice_history', 'UPDATE'),
  'authenticated clients cannot write choice history'
);
select ok(
  not has_column_privilege('authenticated', 'public.reader_states', 'locked_ending_key', 'INSERT')
    and not has_column_privilege('authenticated', 'public.reader_states', 'locked_ending_key', 'UPDATE'),
  'authenticated clients cannot write locked ending key'
);
select ok(
  not has_table_privilege('anon', 'public.story_generation_contracts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.story_generation_contracts', 'SELECT'),
  'generation contracts have no direct reader table grant'
);
select ok(
  not has_column_privilege('anon', 'public.story_generation_contracts', 'story_contract_json', 'SELECT')
    and not has_column_privilege('authenticated', 'public.story_generation_contracts', 'story_contract_json', 'SELECT'),
  'generation contract payload is not directly selectable'
);
select ok(
  not exists (
    select 1
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in ('stories', 'chapters', 'choice_outcomes', 'reader_states')
      and grantee = 'PUBLIC'
      and privilege_type = 'SELECT'
  ),
  'PUBLIC has no table-wide reader SELECT grants'
);
select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and grantee = 'PUBLIC'
      and privilege_type = 'SELECT'
      and (table_name, column_name) in (
        ('stories', 'story_mode'),
        ('choice_outcomes', 'effect_json'),
        ('reader_states', 'route_state')
      )
  ),
  'PUBLIC cannot select personalized internal columns'
);
select ok(
  has_table_privilege('service_role', 'public.reader_states', 'SELECT')
    and has_column_privilege('service_role', 'public.reader_states', 'route_state', 'UPDATE')
    and has_table_privilege('service_role', 'public.story_generation_contracts', 'SELECT'),
  'service_role retains full personalized internal privileges'
);

select * from finish();
rollback;
