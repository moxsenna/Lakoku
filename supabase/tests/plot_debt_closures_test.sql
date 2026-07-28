-- pgTAP tests for plot-debt closure ledger + V2 audit signals + V4 publication.
-- Covers: table structure, constraints, privileges, validator, V4 RPCs.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Setup: stories + reader_states + generation_jobs (minimal fixtures)
-- ═══════════════════════════════════════════════════════════════════════════════

insert into public.stories (id, title, visibility, story_mode, owner_user_id)
values ('test:plot-debt', 'Plot Debt Test', 'private', 'personalized_ai', '00000000-0000-0000-0000-000000000001');

-- Minimal generation job for FK reference.
insert into public.generation_jobs (
  id, story_id, chapter_number, user_id, generation_kind,
  status, attempt_count, max_attempts, available_at, deadline_at,
  correlation_id, publication_idempotency_key
) values (
  '11111111-1111-1111-1111-111111111111',
  'test:plot-debt', 10, '00000000-0000-0000-0000-000000000001', 'personalized',
  'SUCCEEDED', 1, 4, now(), now() + interval '1 hour',
  gen_random_uuid(), 'generation-job:11111111-1111-1111-1111-111111111111:publish:10'
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Table structure
-- ═══════════════════════════════════════════════════════════════════════════════

select has_table('public', 'reader_plot_debt_closures', 'closure table exists');

select has_column('public', 'reader_plot_debt_closures', 'id', 'has id');
select has_column('public', 'reader_plot_debt_closures', 'user_id', 'has user_id');
select has_column('public', 'reader_plot_debt_closures', 'story_id', 'has story_id');
select has_column('public', 'reader_plot_debt_closures', 'debt_id', 'has debt_id');
select has_column('public', 'reader_plot_debt_closures', 'closure_form', 'has closure_form');
select has_column('public', 'reader_plot_debt_closures', 'closed_at_chapter', 'has closed_at_chapter');
select has_column('public', 'reader_plot_debt_closures', 'closed_by_job_id', 'has closed_by_job_id');
select has_column('public', 'reader_plot_debt_closures', 'closure_version', 'has closure_version');
select has_column('public', 'reader_plot_debt_closures', 'created_at', 'has created_at');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2-4. CHECK constraints
-- ═══════════════════════════════════════════════════════════════════════════════

-- closure_form CHECK
select throws_ok($$
  insert into public.reader_plot_debt_closures
  (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
  values ('00000000-0000-0000-0000-000000000001', 'test:plot-debt', 'd1', 'INVALID', 10, '11111111-1111-1111-1111-111111111111')
$$, '23514', null, 'closure_form CHECK rejects invalid');

-- debt_id trim check (whitespace-only)
select throws_ok($$
  insert into public.reader_plot_debt_closures
  (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
  values ('00000000-0000-0000-0000-000000000001', 'test:plot-debt', '   ', 'RESOLVED', 10, '11111111-1111-1111-1111-111111111111')
$$, '23514', null, 'debt_id whitespace-only rejected');

-- closed_at_chapter range
select throws_ok($$
  insert into public.reader_plot_debt_closures
  (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
  values ('00000000-0000-0000-0000-000000000001', 'test:plot-debt', 'd2', 'RESOLVED', 51, '11111111-1111-1111-1111-111111111111')
$$, '23514', null, 'closed_at_chapter range rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5-6. UNIQUE constraint
-- ═══════════════════════════════════════════════════════════════════════════════

select lives_ok($$
  insert into public.reader_plot_debt_closures
  (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
  values ('00000000-0000-0000-0000-000000000001', 'test:plot-debt', 'unique_debt', 'RESOLVED', 10, '11111111-1111-1111-1111-111111111111')
$$, 'first insert succeeds');

select throws_ok($$
  insert into public.reader_plot_debt_closures
  (user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id)
  values ('00000000-0000-0000-0000-000000000001', 'test:plot-debt', 'unique_debt', 'SUBVERTED', 11, '11111111-1111-1111-1111-111111111111')
$$, '23505', null, 'duplicate debt_id rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. UPDATE trigger rejected
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  update public.reader_plot_debt_closures
  set closure_form = 'SUBVERTED'
  where user_id = '00000000-0000-0000-0000-000000000001'
    and story_id = 'test:plot-debt' and debt_id = 'unique_debt'
$$, 'P0001', null, 'UPDATE trigger rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8-9. Table privileges (not RLS — RLS is not enabled)
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(not has_table_privilege('anon', 'public.reader_plot_debt_closures', 'INSERT'), 'anon INSERT denied');
select ok(not has_table_privilege('authenticated', 'public.reader_plot_debt_closures', 'INSERT'), 'authenticated INSERT denied');
select ok(has_table_privilege('service_role', 'public.reader_plot_debt_closures', 'SELECT'), 'service_role SELECT granted');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. V4 RPC privileges
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(has_function('public', 'publish_generation_job_chapter_v4',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb','text','text','jsonb']),
  'V4 function exists');
select ok(not has_function_privilege('anon', 'public.publish_generation_job_chapter_v4(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE'), 'anon V4 denied');
select ok(not has_function_privilege('authenticated', 'public.publish_generation_job_chapter_v4(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE'), 'authenticated V4 denied');
select ok(has_function_privilege('service_role', 'public.publish_generation_job_chapter_v4(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE'), 'service_role V4 granted');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. is_valid_checkpoint_audit_signals_v2
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(public.is_valid_checkpoint_audit_signals_v2('{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb), 'V2 valid empty closures');
select ok(public.is_valid_checkpoint_audit_signals_v2('{"opensNewThread":true,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"main_mystery","closureForm":"RESOLVED"}]}'::jsonb), 'V2 valid with closure');
select ok(not public.is_valid_checkpoint_audit_signals_v2(null), 'V2 null rejected');
select ok(not public.is_valid_checkpoint_audit_signals_v2('{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false}'::jsonb), 'V1 shape rejected by V2 validator');
select ok(not public.is_valid_checkpoint_audit_signals_v2('{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"d","closureForm":"INVALID"}]}'::jsonb), 'V2 invalid closure form rejected');
select ok(not public.is_valid_checkpoint_audit_signals_v2('{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"debtId":"d","closureForm":"RESOLVED"},{"debtId":"d","closureForm":"RESOLVED"}]}'::jsonb), 'V2 duplicate debtId rejected');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. generation_jobs columns exist
-- ═══════════════════════════════════════════════════════════════════════════════

select has_column('public', 'generation_jobs', 'story_contract_version', 'jobs has story_contract_version');
select has_column('public', 'generation_jobs', 'closure_payload_hash', 'jobs has closure_payload_hash');
select has_column('public', 'generation_jobs', 'publication_payload_hash', 'jobs has publication_payload_hash');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 13. Checkpoint has story_contract_version
-- ═══════════════════════════════════════════════════════════════════════════════

select has_column('public', 'chapter_generation_checkpoints', 'story_contract_version', 'checkpoints has story_contract_version');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 14. Old upsert checkpoint RPC no longer exists (16-param pre-audit overload)
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(not has_function('public', 'upsert_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','bigint','bigint','text','text','integer','integer','integer']),
  'old 16-param upsert overload removed');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 15. Upser t checkpoint RPC: 18-param is sole signature
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(has_function('public', 'upsert_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','integer','bigint','bigint','text','text','integer','integer','integer']),
  '18-param upsert exists');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 16. Transition checkpoint RPC: 8-param exists
-- ═══════════════════════════════════════════════════════════════════════════════

select ok(has_function('public', 'transition_generation_checkpoint_fenced_v1',
  array['uuid','text','uuid','uuid','text','integer','uuid','text']),
  '8-param transition exists');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 17. story_generation_contracts has story_contract_version
-- ═══════════════════════════════════════════════════════════════════════════════

select has_column('public', 'story_generation_contracts', 'story_contract_version', 'contracts has version column');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 18. generation_jobs hash constraints
-- ═══════════════════════════════════════════════════════════════════════════════

select throws_ok($$
  update public.generation_jobs
  set closure_payload_hash = 'not-a-hash'
  where id = '11111111-1111-1111-1111-111111111111'
$$, '23514', null, 'closure_payload_hash format rejected');

select throws_ok($$
  update public.generation_jobs
  set publication_payload_hash = 'not-a-hash'
  where id = '11111111-1111-1111-1111-111111111111'
$$, '23514', null, 'publication_payload_hash format rejected');

-- Valid hash accepted.
select lives_ok($$
  update public.generation_jobs
  set closure_payload_hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
  where id = '11111111-1111-1111-1111-111111111111'
$$, 'valid hex hash accepted');

select * from finish();
rollback;
