-- pgTAP tests for reader_plot_debt_progress: append-only per-milestone ledger.
-- Row per (reader, story, debt, milestone_chapter) — unique-key idempotency
-- instead of mutable-array read-modify-write. Zero direct mutation for every
-- role including service_role; INSERT only via the A1c security-definer
-- publisher. No RLS owner policies (protection is revoke + security-definer).

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

select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════════
-- Setup: owner auth user + story + reader_states + generation job
-- ═══════════════════════════════════════════════════════════════════════════════

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '57000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'plot-debt-progress-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

insert into public.stories (id, title, owner_user_id, visibility, story_mode)
values ('test:plot-debt-progress', 'Progress Test',
        '57000000-0000-4000-8000-000000000001', 'private', 'personalized_ai');

insert into public.reader_states (user_id, story_id, status, current_chapter)
values ('57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress', 'BERJALAN', 46);

insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  '77777777-7777-4777-8777-777777777777',
  'test:plot-debt-progress', 46, '57000000-0000-4000-8000-000000000001', 'personalized',
  'QUEUED', 0, 4, clock_timestamp(), clock_timestamp() + interval '1 hour',
  gen_random_uuid(), 'generation-job:77777777-7777-4777-8777-777777777777:publish:46'
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Table structure
-- ═══════════════════════════════════════════════════════════════════════════════

select has_table('public', 'reader_plot_debt_progress', 'progress ledger exists');

select has_column('public', 'reader_plot_debt_progress', 'user_id', 'has user_id');
select has_column('public', 'reader_plot_debt_progress', 'story_id', 'has story_id');
select has_column('public', 'reader_plot_debt_progress', 'debt_id', 'has debt_id');
select has_column('public', 'reader_plot_debt_progress', 'milestone_chapter', 'has milestone_chapter');
select has_column('public', 'reader_plot_debt_progress', 'progressed_at_chapter', 'has progressed_at_chapter');
select has_column('public', 'reader_plot_debt_progress', 'source_job_id', 'has source_job_id');
select has_column('public', 'reader_plot_debt_progress', 'progress_version', 'has progress_version');
select has_column('public', 'reader_plot_debt_progress', 'created_at', 'has created_at');

select col_is_null('public', 'reader_plot_debt_progress', 'source_job_id', 'source_job_id nullable (sync path)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Inserts: sync (NULL source) and worker (job provenance) paths
-- ═══════════════════════════════════════════════════════════════════════════════

select lives_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter, source_job_id
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'main_mystery', 45, 46, NULL
  )
$$, 'sync-path milestone accepted (NULL source_job_id)');

select lives_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter, source_job_id
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'floodgate', 40, 46, '77777777-7777-4777-8777-777777777777'
  )
$$, 'worker-path milestone accepted');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Unique milestone: two retries paying milestone 45 collide, no dup rows
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter, source_job_id
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'main_mystery', 45, 46, NULL
  )
$$, '23505', null, 'duplicate milestone rejected (idempotency via unique key)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Domain constraints
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'd_out_of_range', 0, 1
  )
$$, '23514', null, 'milestone_chapter below 1 rejected');

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'd_out_of_range', 51, 1
  )
$$, '23514', null, 'milestone_chapter above 50 rejected');

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'd_bad_progress', 1, 0
  )
$$, '23514', null, 'progressed_at_chapter below 1 rejected');

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'd_bad_progress', 1, 51
  )
$$, '23514', null, 'progressed_at_chapter above 50 rejected');

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    '   ', 1, 1
  )
$$, '23514', null, 'whitespace-only debt_id rejected');

select throws_ok($$
  insert into public.reader_plot_debt_progress (
    user_id, story_id, debt_id, milestone_chapter, progressed_at_chapter, progress_version
  ) values (
    '57000000-0000-4000-8000-000000000001', 'test:plot-debt-progress',
    'd_version', 1, 1, 2
  )
$$, '23514', null, 'progress_version 2 rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Immutability + privileges (closure-ledger posture)
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  update public.reader_plot_debt_progress
  set progressed_at_chapter = 47
  where user_id = '57000000-0000-4000-8000-000000000001'
    and story_id = 'test:plot-debt-progress' and debt_id = 'main_mystery'
$$, 'P0001', null, 'UPDATE rejected (PLOT_DEBT_PROGRESS_IMMUTABLE trigger)');

select ok(not has_table_privilege('public', 'public.reader_plot_debt_progress', 'INSERT'), 'public INSERT denied');
select ok(not has_table_privilege('anon', 'public.reader_plot_debt_progress', 'INSERT'), 'anon INSERT denied');
select ok(not has_table_privilege('authenticated', 'public.reader_plot_debt_progress', 'INSERT'), 'authenticated INSERT denied');
select ok(not has_table_privilege('service_role', 'public.reader_plot_debt_progress', 'INSERT'), 'service_role direct INSERT denied');
select ok(not has_table_privilege('service_role', 'public.reader_plot_debt_progress', 'UPDATE'), 'service_role direct UPDATE denied');
select ok(not has_table_privilege('service_role', 'public.reader_plot_debt_progress', 'DELETE'), 'service_role direct DELETE denied');
select ok(has_table_privilege('service_role', 'public.reader_plot_debt_progress', 'SELECT'), 'service_role SELECT granted');

-- No owner RLS policies: readers have no reason to mutate plot-debt state.
select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'reader_plot_debt_progress'),
  0::bigint, 'no RLS policies on progress ledger');

select * from finish();
rollback;
