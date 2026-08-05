-- pgTAP tests for M10-A1c.1 living-canon publication primitives:
--   closure ledger nullable provenance, commit expand (correlation + payload),
--   chapter_publication_payload_hash_v1 (byte-identical to V4 inline),
--   lookup_chapter_commit_replay_v1 (13-field exact machine),
--   apply_validated_chapter_state_v1 (shared single mutation owner),
--   V4 redefinition (capability gate LIVING_CANON_REQUIRES_V5 before R/J/L/C),
--   upsert_generation_checkpoint_sync_v1 (sync writer),
--   publish_chapter_state_v3 (sync publisher),
--   transition_checkpoint_published_atomic_v5 + publish_generation_job_chapter_v5
--     (worker publisher, checkpoint-authoritative).
--
-- Test groups (locked scope): LOCKING, REPLAY (13-field), ATOMICITY, LEASE,
-- PARITY, hash helper fixture exact equality vs V4 inline formula.

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

select plan(207);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Setup: owner auth user + shared fixtures
-- ═══════════════════════════════════════════════════════════════════════════════

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'a1c-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

create or replace function pg_temp.choices_fixture()
returns jsonb language sql as $$
  select '[{"id":"a","label":"Ambil jalan A"},{"id":"b","label":"Ambil jalan B"}]'::jsonb
$$;

-- V2 requires 8..120 chars for the choice prompt; keep one canonical value
-- across V3/V4/V5 calls (hash fixture keeps its own literals, see section 2).
create or replace function pg_temp.prompt_fixture()
returns text language sql as $$
  select 'Ke mana Raka melangkah sekarang?'
$$;

create or replace function pg_temp.outcomes_fixture(p_next integer)
returns jsonb language sql as $$
  select ('[{"choiceId":"a","consequence":["A"],"nextChapterNumber":' || p_next ||
          ',"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"},' ||
          '{"choiceId":"b","consequence":["B"],"nextChapterNumber":' || p_next ||
          ',"isEnding":false,"effect_json":{"routeDeltas":{},"trustDeltas":{},"flagsSet":{},"evidenceAdded":[],"endingBiasDeltas":{},"threadTouches":[]},"choice_kind":"normal"}]')::jsonb
$$;

-- Story + reader + contract (one ACTIVE lease per story: each fixture lives on
-- its own story). Default debt contract keeps ch2 closure checks green.
-- The contract carries the authoritative actPlan (R2-B1 source of truth):
-- 12 acts tiling 1..50 with boundaries at 5,10,15,20,25,30,35,40,44,45,48,50 —
-- 45/48/50 are the R2-mandated boundary chapters, every other publishing
-- chapter in this suite (2) is deliberately non-boundary.
create or replace function pg_temp.seed_story(
  p_story text, p_chapter integer, p_living integer default 1,
  p_revision integer default 0,
  p_debts jsonb default
    '[{"id":"main_mystery","question":"Q","introducedAt":1,"mustProgressBy":[12,32,45],"mustCloseBy":48,"status":"open"},{"id":"d1","question":"D1","introducedAt":1,"mustProgressBy":[2,12],"mustCloseBy":30,"status":"open"}]'::jsonb
) returns void language plpgsql as $$
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode,
                              living_canon_version, canon_state_revision, story_contract_version)
  values (p_story, 'A1c Fixture', '00000000-0000-0000-0000-000000000001', 'private',
          'personalized_ai', p_living, p_revision, 1);
  insert into public.reader_states (user_id, story_id, status, current_chapter)
  values ('00000000-0000-0000-0000-000000000001', p_story, 'BERJALAN', p_chapter);
  insert into public.story_generation_contracts (story_id, mode, total_chapters,
                                                 plot_debts_json, story_contract_version,
                                                 story_contract_json)
  values (p_story, 'personalized_ai', 50, p_debts, 1,
    ('{"actPlan":[' ||
    '{"actNumber":1,"fromChapter":1,"toChapter":5,"goal":"Membuka misteri gudang."},' ||
    '{"actNumber":2,"fromChapter":6,"toChapter":10,"goal":"Menyusuri jejak pertama."},' ||
    '{"actNumber":3,"fromChapter":11,"toChapter":15,"goal":"Menemukan kunci rahasia."},' ||
    '{"actNumber":4,"fromChapter":16,"toChapter":20,"goal":"Mengungkap konspirasi awal."},' ||
    '{"actNumber":5,"fromChapter":21,"toChapter":25,"goal":"Menghadapi pengkhianat."},' ||
    '{"actNumber":6,"fromChapter":26,"toChapter":30,"goal":"Kehilangan sekutu terdekat."},' ||
    '{"actNumber":7,"fromChapter":31,"toChapter":35,"goal":"Memasuki sarang musuh."},' ||
    '{"actNumber":8,"fromChapter":36,"toChapter":40,"goal":"Membuka rahasia keluarga."},' ||
    '{"actNumber":9,"fromChapter":41,"toChapter":44,"goal":"Menentukan pihak terakhir."},' ||
    '{"actNumber":10,"fromChapter":45,"toChapter":45,"goal":"Menghadapi titik balik utama."},' ||
    '{"actNumber":11,"fromChapter":46,"toChapter":48,"goal":"Menggenggam kebenaran penuh."},' ||
    '{"actNumber":12,"fromChapter":49,"toChapter":50,"goal":"Menyelesaikan takdir."}' ||
    ']}')::jsonb);
end
$$;

-- Story WITHOUT reader_states / contract — used to prove the capability gates
-- fire BEFORE the R (reader) / J (job) / L (lease) / C (checkpoint) locks.
create or replace function pg_temp.seed_bare_story(
  p_story text, p_living integer default 0, p_revision integer default 0
) returns void language plpgsql as $$
begin
  insert into public.stories (id, title, owner_user_id, visibility, story_mode,
                              living_canon_version, canon_state_revision, story_contract_version)
  values (p_story, 'Bare Gate Fixture', '00000000-0000-0000-0000-000000000001',
          'private', 'personalized_ai', p_living, p_revision, 1);
end
$$;

-- RUNNING job + ACTIVE lease (returns the claim token).
create or replace function pg_temp.seed_job(
  p_story text, p_chapter integer, p_job uuid, p_lease uuid
) returns uuid language plpgsql as $$
declare
  v_corr uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
begin
  insert into public.generation_jobs (
    id, story_id, chapter_number, user_id, generation_kind, status,
    attempt_count, max_attempts, available_at, deadline_at,
    correlation_id, publication_idempotency_key, story_contract_version
  ) values (
    p_job, p_story, p_chapter, '00000000-0000-0000-0000-000000000001',
    'personalized', 'QUEUED', 0, 4,
    clock_timestamp() - interval '1 minute', clock_timestamp() + interval '20 minutes',
    v_corr, 'generation-job:' || p_job::text || ':publish:' || p_chapter, 1
  );
  update public.generation_jobs
  set status = 'RUNNING', attempt_count = attempt_count + 1,
      worker_id = 'a1c-worker', claim_token = v_claim,
      claimed_at = clock_timestamp(), heartbeat_at = clock_timestamp()
  where id = p_job;
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (
    p_lease, p_story, p_chapter, 'ACTIVE', 'a1c-worker',
    clock_timestamp() + interval '10 minutes', p_job, v_claim
  );
  return v_claim;
end
$$;

-- Schema-3 worker checkpoint bound to the job (checkpoint-authoritative state).
-- Title/paragraphs/delta live IN the checkpoint row; V3 and V5 both read them
-- from the locked checkpoint, so PARITY seeds identical values on both paths.
create or replace function pg_temp.seed_v5_checkpoint(
  p_story text, p_chapter integer, p_job uuid, p_delta jsonb, p_base bigint,
  p_audit jsonb default
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
  p_paragraphs jsonb default '["Paragraf kanon."]'::jsonb
) returns void language plpgsql as $$
begin
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, audit_signals_json, audit_signals_version,
    canon_version, blueprint_version, direction_fingerprint, generation_mode,
    generation_policy_version, prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at,
    story_contract_version, state_delta_json, state_delta_schema_version,
    state_delta_hash, base_canon_revision
  ) values (
    p_story, p_chapter, p_job,
    (select correlation_id from public.generation_jobs where id = p_job),
    'PROSE_READY', 'Bab ' || p_chapter, p_paragraphs, 'fp-a1c',
    p_audit, 2, 5, 2, 'dir-a1c', 'personalized', 2, 2,
    p_job, 1, 3, 1, 0, clock_timestamp() + interval '24 hours',
    1, p_delta, 1, public.chapter_state_delta_hash_v1(p_delta), p_base
  );
end
$$;

-- Schema-2 legacy checkpoint (V4 path).
create or replace function pg_temp.seed_v4_checkpoint(
  p_story text, p_chapter integer, p_job uuid
) returns void language plpgsql as $$
begin
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint,
    audit_signals_json, audit_signals_version,
    canon_version, blueprint_version, direction_fingerprint,
    generation_mode, generation_policy_version, prompt_contract_version,
    job_id, job_attempt_number, checkpoint_schema_version,
    prose_attempt_count, choice_attempt_count, expires_at, story_contract_version
  ) values (
    p_story, p_chapter, p_job,
    (select correlation_id from public.generation_jobs where id = p_job),
    'PROSE_READY', 'Bab ' || p_chapter, '["Paragraf legasi."]'::jsonb, 'fp-v4',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir-v4', 'personalized', 2, 2,
    p_job, 1, 2, 1, 0, clock_timestamp() + interval '24 hours', 1
  );
end
$$;

-- ACTIVE sync lease (no generation job — A1d sync path).
create or replace function pg_temp.seed_sync_lease(
  p_story text, p_chapter integer, p_lease uuid
) returns void language plpgsql as $$
begin
  insert into public.generation_leases (
    id, story_id, chapter_number, status, holder, expires_at, job_id, claim_token
  ) values (
    p_lease, p_story, p_chapter, 'ACTIVE', 'sync-holder',
    clock_timestamp() + interval '10 minutes', null, null
  );
end
$$;

-- Schema-3 sync checkpoint (attempt-run identity = correlation).
create or replace function pg_temp.seed_sync_checkpoint(
  p_story text, p_chapter integer, p_attempt uuid, p_corr uuid,
  p_delta jsonb, p_base bigint, p_title text,
  p_audit jsonb default
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb
) returns void language plpgsql as $$
begin
  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, audit_signals_json, audit_signals_version,
    canon_version, blueprint_version, direction_fingerprint, generation_mode,
    generation_policy_version, prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at,
    story_contract_version, state_delta_json, state_delta_schema_version,
    state_delta_hash, base_canon_revision
  ) values (
    p_story, p_chapter, p_attempt, p_corr, 'PROSE_READY',
    p_title, '["Paragraf sinkron."]'::jsonb, 'fp-sync',
    p_audit, 2, 5, 2, 'dir-sync', 'personalized', 2, 2,
    null, null, 3, 1, 0, clock_timestamp() + interval '24 hours',
    1, p_delta, 1, public.chapter_state_delta_hash_v1(p_delta), p_base
  );
end
$$;

-- Thread fixture used by every delta that touches threads.
create or replace function pg_temp.seed_thread(
  p_story text
) returns void language plpgsql as $$
begin
  -- story_threads PK is (id) globally, so 't1' can only exist for ONE story per
  -- transaction. Re-point it when a later fixture needs the same thread id.
  insert into public.story_threads (
    id, story_id, title, status, opened_chapter, last_touched_chapter,
    stale, stale_since_chapter, is_main_mystery
  ) values (
    't1', p_story, 'Misteri Gudang', 'OPEN', 1, 1, true, 1, true
  )
  on conflict (id) do update set story_id = excluded.story_id;
end
$$;

create or replace function pg_temp.touch_delta(p_story text, p_chapter integer)
returns jsonb language sql as $$
  select ('{"schemaVersion":1,"storyId":"' || p_story || '","chapterNumber":' || p_chapter ||
          ',"threads":{"touches":["t1"]}}')::jsonb
$$;

-- Delta carrying an actRollup descriptor (R2-B1 boundary tests). Every section
-- is present-but-empty so the ONLY canonical mutation is the rollup.
create or replace function pg_temp.act_delta(
  p_story text, p_chapter integer, p_act integer, p_from integer, p_to integer
) returns jsonb language sql as $$
  select ('{"schemaVersion":1,"storyId":"' || p_story || '","chapterNumber":' || p_chapter ||
          ',"facts":{"add":[],"markPaidOff":[]},"knowledge":{"grants":[]},' ||
          '"secrets":{"revealIds":[]},"timeline":{"append":[]},' ||
          '"characters":{"statusChanges":[]},"threads":{"touches":[],"transitions":[]},' ||
          '"actRollup":{"actNumber":' || p_act || ',"summary":"Ringkasan babak.","stateDelta":{},' ||
          '"coversFromChapter":' || p_from || ',"coversToChapter":' || p_to || '},' ||
          '"plotDebts":{"progress":[],"closures":[]}}')::jsonb
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. STRUCTURE — closure ledger, commit expand, functions, security
-- ═══════════════════════════════════════════════════════════════════════════════

select col_is_null('public', 'reader_plot_debt_closures', 'closed_by_job_id',
  'closed_by_job_id is nullable (sync closures have no generation job)');
select pg_temp.seed_story('test:closure-null', 2);
select lives_ok($$
  insert into public.reader_plot_debt_closures (
    user_id, story_id, debt_id, closure_form, closed_at_chapter, closed_by_job_id, closure_version
  ) values (
    '00000000-0000-0000-0000-000000000001', 'test:closure-null', 'd1', 'RESOLVED', 2, null, 1
  )
$$, 'NULL closed_by_job_id accepted (sync closure)');

select has_column('public', 'chapter_state_commits', 'correlation_id', 'commits have correlation_id');
select col_not_null('public', 'chapter_state_commits', 'correlation_id', 'correlation_id NOT NULL');
select has_column('public', 'chapter_state_commits', 'publication_payload_hash', 'commits have publication_payload_hash');
select col_not_null('public', 'chapter_state_commits', 'publication_payload_hash', 'publication_payload_hash NOT NULL');
select has_column('public', 'chapter_state_commits', 'publication_payload_schema_version', 'commits have publication_payload_schema_version');
select col_not_null('public', 'chapter_state_commits', 'publication_payload_schema_version', 'publication_payload_schema_version NOT NULL');
select col_default_is('public', 'chapter_state_commits', 'publication_payload_schema_version', '1', 'publication_payload_schema_version defaults to 1');
select has_column('public', 'chapter_state_commits', 'publication_result', 'commits have publication_result');
select col_not_null('public', 'chapter_state_commits', 'publication_result', 'publication_result NOT NULL');

-- commit CHECK behaviors (fail closed).
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, 'ZZ-not-hex', '{"ok":true,"chapter_number":1,"seq":1,"checkpoint_attempt_id":"11111111-1111-4111-8111-111111111111","committed_canon_revision":1}'::jsonb
  )
$$, '23514', null, 'non-hex publication_payload_hash rejected');
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    2, repeat('a', 64), '{"ok":true,"chapter_number":1,"seq":1,"checkpoint_attempt_id":"11111111-1111-4111-8111-111111111111","committed_canon_revision":1}'::jsonb
  )
$$, '23514', null, 'publication_payload_schema_version 2 rejected');
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, repeat('a', 64), '{"ok":false,"chapter_number":1,"seq":1,"checkpoint_attempt_id":"11111111-1111-4111-8111-111111111111","committed_canon_revision":1}'::jsonb
  )
$$, '23514', null, 'publication_result ok:false rejected');
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, repeat('a', 64), '{"ok":true,"chapter_number":2,"seq":1,"checkpoint_attempt_id":"11111111-1111-4111-8111-111111111111","committed_canon_revision":1}'::jsonb
  )
$$, '23514', null, 'publication_result chapter_number must bind to the row');
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, repeat('a', 64), '{"ok":true,"chapter_number":1,"seq":1,"committed_canon_revision":1}'::jsonb
  )
$$, '23514', null, 'publication_result must bind checkpoint_attempt_id');
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, repeat('a', 64), '{"ok":true,"chapter_number":1,"seq":1,"checkpoint_attempt_id":"11111111-1111-4111-8111-111111111111"}'::jsonb
  )
$$, '23514', null, 'publication_result missing committed_canon_revision rejected (no vacuous pass)');
select throws_ok($$
  insert into public.chapter_state_commits (
    story_id, chapter_number, base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, checkpoint_attempt_id,
    correlation_id, publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    'test:commit-checks', 1, 0, 1, '{"a":1}'::jsonb, 1, public.chapter_state_delta_hash_v1('{"a":1}'::jsonb),
    'personalized', '00000000-0000-0000-0000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, repeat('a', 64), '{"ok":"true","chapter_number":1,"seq":1,"checkpoint_attempt_id":"11111111-1111-4111-8111-111111111111","committed_canon_revision":1}'::jsonb
  )
$$, '23514', null, 'publication_result ok must be boolean true (string type rejected)');

-- hash helper: SQL, invoker, immutable, service_role-only.
select has_function('public', 'chapter_publication_payload_hash_v1',
  array['text','integer','text','jsonb','text','jsonb','jsonb','text','text'],
  'hash helper exists with 9-param signature');
select function_returns('public', 'chapter_publication_payload_hash_v1',
  array['text','integer','text','jsonb','text','jsonb','jsonb','text','text'],
  'text', 'hash helper returns text');
select ok(
  not coalesce((select prosecdef from pg_proc
                where oid = to_regprocedure('public.chapter_publication_payload_hash_v1(text,integer,text,jsonb,text,jsonb,jsonb,text,text)')), true),
  'hash helper is SECURITY INVOKER'
);
select is(
  (select provolatile from pg_proc
   where oid = to_regprocedure('public.chapter_publication_payload_hash_v1(text,integer,text,jsonb,text,jsonb,jsonb,text,text)')),
  'i', 'hash helper is IMMUTABLE'
);
select ok(not has_function_privilege('anon', 'public.chapter_publication_payload_hash_v1(text,integer,text,jsonb,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'anon cannot execute hash helper');
select ok(not has_function_privilege('authenticated', 'public.chapter_publication_payload_hash_v1(text,integer,text,jsonb,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'authenticated cannot execute hash helper');
select ok(has_function_privilege('service_role', 'public.chapter_publication_payload_hash_v1(text,integer,text,jsonb,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'service_role can execute hash helper');

-- replay machine: definer, hard search_path, NO grants (internal only).
select has_function('public', 'lookup_chapter_commit_replay_v1',
  array['text','integer','uuid','uuid','bigint','smallint','text','smallint','text','text','uuid','uuid'],
  'replay machine exists with 12-param signature');
select ok(
  coalesce((select prosecdef from pg_proc
            where oid = to_regprocedure('public.lookup_chapter_commit_replay_v1(text,integer,uuid,uuid,bigint,smallint,text,smallint,text,text,uuid,uuid)')), false),
  'replay machine is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure('public.lookup_chapter_commit_replay_v1(text,integer,uuid,uuid,bigint,smallint,text,smallint,text,text,uuid,uuid)')),
  array['search_path=""']::text[], 'replay machine hardens empty search_path'
);
select ok(not has_function_privilege('anon', 'public.lookup_chapter_commit_replay_v1(text,integer,uuid,uuid,bigint,smallint,text,smallint,text,text,uuid,uuid)', 'EXECUTE'), 'anon cannot execute replay machine');
select ok(not has_function_privilege('service_role', 'public.lookup_chapter_commit_replay_v1(text,integer,uuid,uuid,bigint,smallint,text,smallint,text,text,uuid,uuid)', 'EXECUTE'), 'service_role cannot execute replay machine');

-- shared applier: definer, hard search_path, NO grants, returns void.
select has_function('public', 'apply_validated_chapter_state_v1',
  array['text','integer','bigint','uuid','uuid','jsonb'],
  'shared applier exists with 6-param signature');
select function_returns('public', 'apply_validated_chapter_state_v1',
  array['text','integer','bigint','uuid','uuid','jsonb'],
  'void', 'shared applier returns void');
select ok(
  coalesce((select prosecdef from pg_proc
            where oid = to_regprocedure('public.apply_validated_chapter_state_v1(text,integer,bigint,uuid,uuid,jsonb)')), false),
  'shared applier is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure('public.apply_validated_chapter_state_v1(text,integer,bigint,uuid,uuid,jsonb)')),
  array['search_path=""']::text[], 'shared applier hardens empty search_path'
);
select ok(not has_function_privilege('service_role', 'public.apply_validated_chapter_state_v1(text,integer,bigint,uuid,uuid,jsonb)', 'EXECUTE'), 'service_role cannot execute shared applier');

-- sync writer: definer, hard search_path, outer authority (service_role only).
select has_function('public', 'upsert_generation_checkpoint_sync_v1',
  array['text','integer','uuid','uuid','uuid','text','jsonb','text','jsonb','integer','bigint','bigint','text','integer','integer','jsonb','bigint'],
  'sync writer exists with 17-param signature (caller attempt + correlation)');
select ok(
  coalesce((select prosecdef from pg_proc
            where oid = to_regprocedure('public.upsert_generation_checkpoint_sync_v1(text,integer,uuid,uuid,uuid,text,jsonb,text,jsonb,integer,bigint,bigint,text,integer,integer,jsonb,bigint)')), false),
  'sync writer is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure('public.upsert_generation_checkpoint_sync_v1(text,integer,uuid,uuid,uuid,text,jsonb,text,jsonb,integer,bigint,bigint,text,integer,integer,jsonb,bigint)')),
  array['search_path=""']::text[], 'sync writer hardens empty search_path'
);
select ok(not has_function_privilege('anon', 'public.upsert_generation_checkpoint_sync_v1(text,integer,uuid,uuid,uuid,text,jsonb,text,jsonb,integer,bigint,bigint,text,integer,integer,jsonb,bigint)', 'EXECUTE'), 'anon cannot execute sync writer');
select ok(not has_function_privilege('authenticated', 'public.upsert_generation_checkpoint_sync_v1(text,integer,uuid,uuid,uuid,text,jsonb,text,jsonb,integer,bigint,bigint,text,integer,integer,jsonb,bigint)', 'EXECUTE'), 'authenticated cannot execute sync writer');
select ok(has_function_privilege('service_role', 'public.upsert_generation_checkpoint_sync_v1(text,integer,uuid,uuid,uuid,text,jsonb,text,jsonb,integer,bigint,bigint,text,integer,integer,jsonb,bigint)', 'EXECUTE'), 'service_role CAN execute sync writer (outer authority — A1d calls it directly)');

-- V3 sync publisher: definer, hard search_path, outer authority (service_role
-- only); checkpoint-authoritative — NO delta/title/paragraphs params.
select has_function('public', 'publish_chapter_state_v3',
  array['text','integer','uuid','uuid','uuid','text','jsonb','jsonb','text','text'],
  'V3 exists with 10-param signature (checkpoint-authoritative)');
select ok(
  coalesce((select prosecdef from pg_proc
            where oid = to_regprocedure('public.publish_chapter_state_v3(text,integer,uuid,uuid,uuid,text,jsonb,jsonb,text,text)')), false),
  'V3 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure('public.publish_chapter_state_v3(text,integer,uuid,uuid,uuid,text,jsonb,jsonb,text,text)')),
  array['search_path=""']::text[], 'V3 hardens empty search_path'
);
select ok(not has_function_privilege('anon', 'public.publish_chapter_state_v3(text,integer,uuid,uuid,uuid,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'anon cannot execute V3');
select ok(not has_function_privilege('authenticated', 'public.publish_chapter_state_v3(text,integer,uuid,uuid,uuid,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'authenticated cannot execute V3');
select ok(has_function_privilege('service_role', 'public.publish_chapter_state_v3(text,integer,uuid,uuid,uuid,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'service_role CAN execute V3 (outer authority — A1d calls it directly)');

-- V4 redefinition: same legacy signature + grants preserved.
select has_function('public', 'publish_generation_job_chapter_v4',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','text','jsonb','jsonb','text','text','jsonb'],
  'V4 exists with 14-param signature (unchanged)');
select ok(not has_function_privilege('anon', 'public.publish_generation_job_chapter_v4(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE'), 'anon cannot execute V4');
select ok(has_function_privilege('service_role', 'public.publish_generation_job_chapter_v4(uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE'), 'service_role can execute V4');

-- V5 atomic helper: definer, internal only (NO service_role).
select has_function('public', 'transition_checkpoint_published_atomic_v5',
  array['uuid','text','uuid','uuid','text','integer'],
  'V5 atomic helper exists with 6-param signature');
select ok(not has_function_privilege('service_role', 'public.transition_checkpoint_published_atomic_v5(uuid,text,uuid,uuid,text,integer)', 'EXECUTE'), 'service_role cannot execute V5 atomic helper');

select has_function('public', 'publish_generation_job_chapter_v5',
  array['uuid','text','uuid','uuid','text','integer','text','jsonb','jsonb','text','text'],
  'V5 exists with 11-param signature');
select ok(
  coalesce((select prosecdef from pg_proc
            where oid = to_regprocedure('public.publish_generation_job_chapter_v5(uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text)')), false),
  'V5 is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
   where oid = to_regprocedure('public.publish_generation_job_chapter_v5(uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text)')),
  array['search_path=""']::text[], 'V5 hardens empty search_path'
);
select ok(not has_function_privilege('anon', 'public.publish_generation_job_chapter_v5(uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'anon cannot execute V5');
select ok(not has_function_privilege('authenticated', 'public.publish_generation_job_chapter_v5(uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'authenticated cannot execute V5');
select ok(has_function_privilege('service_role', 'public.publish_generation_job_chapter_v5(uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text)', 'EXECUTE'), 'service_role CAN execute V5 (outer authority — A1d calls it directly)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. HASH HELPER — byte-identical to the V4 inline formula (fixture equality)
-- ═══════════════════════════════════════════════════════════════════════════════

select is(
  public.chapter_publication_payload_hash_v1(
    'test:hash-fixture', 3, 'Judul', '["P1","P2"]'::jsonb,
    pg_temp.prompt_fixture(), '[{"id":"a","label":"A"}]'::jsonb, '[{"choiceId":"a"}]'::jsonb,
    'ending:one', 'Ending Satu'
  ),
  pg_catalog.encode(
    extensions.digest(
      'generation-publication-v1' || pg_catalog.jsonb_build_object(
        'hashSchema', 'generation-publication-v1',
        'storyId', 'test:hash-fixture',
        'chapterNumber', 3,
        'title', 'Judul',
        'paragraphs', '["P1","P2"]'::jsonb,
        'choicePrompt', pg_temp.prompt_fixture(),
        'choices', '[{"id":"a","label":"A"}]'::jsonb,
        'outcomes', '[{"choiceId":"a"}]'::jsonb,
        'endingKey', 'ending:one',
        'endingName', 'Ending Satu'
      )::text,
      'sha256'
    ),
    'hex'
  ),
  'hash helper is byte-identical to the V4 inline formula (full payload)'
);

select is(
  public.chapter_publication_payload_hash_v1(
    'test:hash-null', 7, 'Tanpa Ending', '[]'::jsonb,
    null, null, null, null, null
  ),
  pg_catalog.encode(
    extensions.digest(
      'generation-publication-v1' || pg_catalog.jsonb_build_object(
        'hashSchema', 'generation-publication-v1',
        'storyId', 'test:hash-null',
        'chapterNumber', 7,
        'title', 'Tanpa Ending',
        'paragraphs', '[]'::jsonb,
        'choicePrompt', null,
        'choices', null,
        'outcomes', null,
        'endingKey', null,
        'endingName', null
      )::text,
      'sha256'
    ),
    'hex'
  ),
  'hash helper null fields hashed consistently (NULL vs missing-key both jsonb null)'
);

select isnt(
  public.chapter_publication_payload_hash_v1(
    'test:hash-fixture', 3, 'Judul', '["P1","P2"]'::jsonb,
    pg_temp.prompt_fixture(), '[{"id":"a","label":"A"}]'::jsonb, '[{"choiceId":"a"}]'::jsonb,
    'ending:one', 'Ending Satu'
  ),
  public.chapter_publication_payload_hash_v1(
    'test:hash-fixture', 3, 'Judul', '["P1","P2"]'::jsonb,
    pg_temp.prompt_fixture(), '[{"id":"a","label":"A"}]'::jsonb, '[{"choiceId":"a"}]'::jsonb,
    'ending:two', 'Ending Dua'
  ),
  'ending key/name participate in the hash'
);

select ok(
  public.chapter_publication_payload_hash_v1(
    'test:hash-fixture', 3, 'Judul', '["P1","P2"]'::jsonb,
    pg_temp.prompt_fixture(), '[{"id":"a","label":"A"}]'::jsonb, '[{"choiceId":"a"}]'::jsonb,
    'ending:one', 'Ending Satu'
  ) ~ '^[0-9a-f]{64}$',
  'hash is 64 lowercase hex'
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. SYNC WRITER — upsert_generation_checkpoint_sync_v1
-- ═══════════════════════════════════════════════════════════════════════════════

select pg_temp.seed_story('test:sync-writer', 2);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    'aaa33333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer', 2), 0
  )->>'result'),
  'UPDATED', 'sync writer happy path returns UPDATED'
);
select is(
  (select count(*)::integer from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  1, 'sync writer creates one checkpoint row'
);
select is(
  (select checkpoint_schema_version from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  3, 'sync writer writes schema 3'
);
select is(
  (select job_id from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  null, 'sync checkpoint has NULL job_id'
);
select is(
  (select correlation_id from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  '33333333-3333-4333-8333-333333333333'::uuid, 'sync checkpoint stores caller correlation'
);
select is(
  (select attempt_id from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  'aaa33333-0000-4000-8000-000000000001'::uuid, 'sync checkpoint stores CALLER attempt id (never DB-minted)'
);
select is(
  (select state_delta_hash from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  public.chapter_state_delta_hash_v1(pg_temp.touch_delta('test:sync-writer', 2)),
  'sync writer persists DB-computed hash'
);
select is(
  (select story_contract_version from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  1, 'sync writer inherits story contract version'
);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    'aaa33333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer', 2), 0
  )->>'changed'),
  'false', 'identical sync replay returns changed:false'
);
select is(
  (select count(*)::integer from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  1, 'sync replay keeps one checkpoint row'
);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    'aaa33333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    '{"schemaVersion":1,"storyId":"test:sync-writer","chapterNumber":2,"threads":{"touches":["t2"]}}'::jsonb, 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'same correlation with different delta is provenance conflict'
);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    '99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333',
    'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer', 2), 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'same correlation with a DIFFERENT attempt id is provenance conflict (attempt identity is caller-owned)'
);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    'aaa33333-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999998',
    'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer', 2), 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'same attempt with a DIFFERENT correlation is provenance conflict (pair binding is symmetric)'
);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    'bbb44444-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer', 2), 0
  )->>'changed'),
  'true', 'new correlation creates a new attempt-run checkpoint'
);
select is(
  (select count(*)::integer from public.chapter_generation_checkpoints
   where story_id = 'test:sync-writer'),
  2, 'two attempt-runs keep two checkpoint rows'
);
update public.chapter_generation_checkpoints
set status = 'PUBLISHED'
where story_id = 'test:sync-writer' and correlation_id = '33333333-3333-4333-8333-333333333333';
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer', 2, '00000000-0000-0000-0000-000000000001',
    'aaa33333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer', 2), 0
  )->>'result'),
  'INVALID_TRANSITION', 'PUBLISHED checkpoint replay is INVALID_TRANSITION'
);

-- Gates: capability, stale, ahead.
select pg_temp.seed_story('test:sync-writer-v0', 2, 0);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-v0', 2, '00000000-0000-0000-0000-000000000001',
    'ccc55555-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-v0', 2), 0
  )->>'result'),
  'LIVING_CANON_NOT_ACTIVE', 'legacy story (capability 0) rejected');
select pg_temp.seed_story('test:sync-writer-rev', 2, 1, 5);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-rev', 2, '00000000-0000-0000-0000-000000000001',
    'ddd55555-0000-4000-8000-000000000004', '55555555-5555-4555-8555-555555555556', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-rev', 2), 3
  )->>'result'),
  'STALE_CANON_REVISION', 'stale base rejected');
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-rev', 2, '00000000-0000-0000-0000-000000000001',
    'eee55555-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555557', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-rev', 2), 7
  )->>'result'),
  'BASE_CANON_AHEAD', 'ahead base rejected');

-- Actor binding: foreign owner, missing reader_state, non-private visibility.
-- A second auth user for the foreign-owner bindings (stories.owner_user_id FK).
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000099', 'authenticated', 'authenticated',
  'foreign-owner@example.invalid', '', clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
) on conflict (id) do nothing;

select pg_temp.seed_story('test:sync-writer-foreign', 2);
update public.stories
set owner_user_id = '00000000-0000-0000-0000-000000000099'
where id = 'test:sync-writer-foreign';
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-foreign', 2, '00000000-0000-0000-0000-000000000001',
    'aaa99999-0000-4000-8000-000000000010', '55555555-5555-4555-8555-555555555570',
    'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-foreign', 2), 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'story owned by another user rejected (owner binding)');
select pg_temp.seed_bare_story('test:sync-writer-noreader', 1);
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-noreader', 2, '00000000-0000-0000-0000-000000000001',
    'aaa99999-0000-4000-8000-000000000011', '55555555-5555-4555-8555-555555555571',
    'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-noreader', 2), 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'missing reader_state rejected (actor binding)');
select pg_temp.seed_story('test:sync-writer-public', 2);
update public.stories
set visibility = 'public'
where id = 'test:sync-writer-public';
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-public', 2, '00000000-0000-0000-0000-000000000001',
    'aaa99999-0000-4000-8000-000000000012', '55555555-5555-4555-8555-555555555572',
    'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-public', 2), 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'non-private story rejected (sync path is private/personalized only)');
select pg_temp.seed_story('test:sync-writer-standard', 2);
update public.stories
set story_mode = 'standard'
where id = 'test:sync-writer-standard';
select is(
  (select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-standard', 2, '00000000-0000-0000-0000-000000000001',
    'ccc55555-0000-4000-8000-000000000013', '55555555-5555-4555-8555-555555555573',
    'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-standard', 2), 0
  )->>'result'),
  'PROVENANCE_CONFLICT', 'private-but-standard story rejected (sync path is private AND personalized_ai only)');

-- Payload raises (22023).
select throws_ok($$
  select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-rev', 2, '00000000-0000-0000-0000-000000000001',
    'fff55558-0000-4000-8000-000000000006', '55555555-5555-4555-8555-555555555558', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    '[1,2]'::jsonb, 0
  )
$$, '22023', null, 'non-object delta rejected (22023)');
select throws_ok($$
  select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-rev', 2, '00000000-0000-0000-0000-000000000001',
    'fff55559-0000-4000-8000-000000000007', '55555555-5555-4555-8555-555555555559', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    1, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-rev', 2), 5
  )
$$, '22023', null, 'v1 audit signals must be exact-key shape (22023)');
select throws_ok($$
  select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-rev', 2, '00000000-0000-0000-0000-000000000001',
    'fff55560-0000-4000-8000-000000000008', '55555555-5555-4555-8555-555555555560', 'Bab Sinkron', '["P1"]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"closureForm":"RESOLVED","debtId":"d1"},{"closureForm":"RESOLVED","debtId":"d1"}]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-rev', 2), 5
  )
$$, '22023', null, 'v2 duplicate closesPlotDebts rejected (22023)');
select throws_ok($$
  select public.upsert_generation_checkpoint_sync_v1(
    'test:sync-writer-rev', 2, '00000000-0000-0000-0000-000000000001',
    'fff55561-0000-4000-8000-000000000009', '55555555-5555-4555-8555-555555555561', 'Bab Sinkron', '[]'::jsonb, 'fp1',
    '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[]}'::jsonb,
    2, 5, 2, 'dir1', 2, 2,
    pg_temp.touch_delta('test:sync-writer-rev', 2), 5
  )
$$, '22023', null, 'empty paragraphs rejected (22023)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. LOCKING — V4/V5 capability disjointness, gates before R/J/L/C
-- ═══════════════════════════════════════════════════════════════════════════════

-- 4a. V4 on a legacy v0 story still publishes (legacy behavior intact) and
--     NEVER touches the living-canon surface (no commits, no revision).
select pg_temp.seed_story('test:locking-v4-v0', 2, 0);
select pg_temp.seed_job('test:locking-v4-v0', 2, 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001');
select pg_temp.seed_v4_checkpoint('test:locking-v4-v0', 2, 'a1000000-0000-4000-8000-000000000001');
select lives_ok($$
  select public.publish_generation_job_chapter_v4(
    'a1000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'a1000000-0000-4000-8000-000000000001'),
    'a2000000-0000-4000-8000-000000000001',
    'test:locking-v4-v0', 2, 'Bab Dua', '["Paragraf V4."]'::jsonb, pg_temp.prompt_fixture(),
    pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null, '[]'::jsonb
  )
$$, 'V4 publishes on legacy v0 story (gate open)');
select is((select count(*)::integer from public.chapters where story_id = 'test:locking-v4-v0'), 1,
  'V4 creates the chapter');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:locking-v4-v0'),
  'PUBLISHED', 'V4 checkpoint PUBLISHED');
select is((select status from public.generation_jobs where id = 'a1000000-0000-4000-8000-000000000001'),
  'SUCCEEDED', 'V4 job SUCCEEDED');
select is((select status from public.generation_leases where id = 'a2000000-0000-4000-8000-000000000001'),
  'RELEASED', 'V4 lease RELEASED');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:locking-v4-v0'),
  0, 'V4 never writes commit ledger rows (legacy surface)');
select is((select canon_state_revision from public.stories where id = 'test:locking-v4-v0'),
  0::bigint, 'V4 never increments canon revision (legacy surface)');

-- 4b. V4 on a v1 story: LIVING_CANON_REQUIRES_V5 fires BEFORE R/J/L/C —
--     the fixture has NO reader_states, NO lease, NO checkpoint, so any other
--     error would prove the gate moved too late.
select pg_temp.seed_bare_story('test:locking-v4-v1', 1, 0);
select pg_temp.seed_job('test:locking-v4-v1', 2, 'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001');
select throws_ok($$
  select public.publish_generation_job_chapter_v4(
    'a3000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'a3000000-0000-4000-8000-000000000001'),
    'a4000000-0000-4000-8000-000000000001',
    'test:locking-v4-v1', 2, 'Bab Dua', '["Paragraf."]'::jsonb, pg_temp.prompt_fixture(),
    pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null, '[]'::jsonb
  )
$$, 'P0001', 'LIVING_CANON_REQUIRES_V5', 'V4 rejects v1 story BEFORE R/J/L/C (no reader/lease/checkpoint in fixture)');
select is((select count(*)::integer from public.chapters where story_id = 'test:locking-v4-v1'), 0,
  'V4 gate rejection causes no chapter mutation');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:locking-v4-v1'), 0,
  'V4 gate rejection causes no commit mutation');
select is((select status from public.generation_jobs where id = 'a3000000-0000-4000-8000-000000000001'),
  'RUNNING', 'V4 gate rejection leaves job RUNNING');

-- 4c. V5 on a v0 story: LIVING_CANON_NOT_ACTIVE fires at STORY FOR UPDATE,
--     before R/J/L/C (fixture has no reader/lease/checkpoint).
select pg_temp.seed_bare_story('test:locking-v5-v0', 0, 0);
select pg_temp.seed_job('test:locking-v5-v0', 2, 'a5000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001');
select throws_ok($$
  select public.publish_generation_job_chapter_v5(
    'a5000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'a5000000-0000-4000-8000-000000000001'),
    'a6000000-0000-4000-8000-000000000001',
    'test:locking-v5-v0', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'LIVING_CANON_NOT_ACTIVE', 'V5 rejects v0 story BEFORE R/J/L/C (no reader/lease/checkpoint in fixture)');
select is((select count(*)::integer from public.chapters where story_id = 'test:locking-v5-v0'), 0,
  'V5 gate rejection causes no chapter mutation');
select is((select status from public.generation_jobs where id = 'a5000000-0000-4000-8000-000000000001'),
  'RUNNING', 'V5 gate rejection leaves job RUNNING');

-- 4d. V5 on a v1 story: full happy publication (gate open). Also the base for
--     the ATOMICITY retry tests.
select pg_temp.seed_story('test:v5-happy', 2);
select pg_temp.seed_thread('test:v5-happy');
select pg_temp.seed_job('test:v5-happy', 2, 'a7000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001');
select pg_temp.seed_v5_checkpoint('test:v5-happy', 2, 'a7000000-0000-4000-8000-000000000001',
  pg_temp.touch_delta('test:v5-happy', 2), 0);
select is(
  (select public.publish_generation_job_chapter_v5(
    'a7000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'a7000000-0000-4000-8000-000000000001'),
    'a8000000-0000-4000-8000-000000000001',
    'test:v5-happy', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )->>'committed_canon_revision'),
  '1', 'V5 publishes on v1 story, committed revision 1');
select is((select count(*)::integer from public.chapters where story_id = 'test:v5-happy'), 1,
  'V5 creates the chapter');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:v5-happy'),
  'PUBLISHED', 'V5 checkpoint PUBLISHED');
select is((select status from public.generation_jobs where id = 'a7000000-0000-4000-8000-000000000001'),
  'SUCCEEDED', 'V5 job SUCCEEDED');
select is((select status from public.generation_leases where id = 'a8000000-0000-4000-8000-000000000001'),
  'RELEASED', 'V5 lease RELEASED');
select is((select canon_state_revision from public.stories where id = 'test:v5-happy'),
  1::bigint, 'V5 increments canon revision exactly once');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:v5-happy'),
  1, 'V5 writes one commit ledger row');
select is(
  (select source_job_id from public.chapter_state_commits where story_id = 'test:v5-happy'),
  'a7000000-0000-4000-8000-000000000001'::uuid, 'V5 commit provenance = job id');
select is(
  (select (publication_result->>'checkpoint_attempt_id')::uuid from public.chapter_state_commits
   where story_id = 'test:v5-happy'),
  'a7000000-0000-4000-8000-000000000001'::uuid, 'V5 publication_result binds checkpoint attempt (job id)');
select is(
  (select last_touched_chapter from public.story_threads where id = 't1' and story_id = 'test:v5-happy'),
  2, 'V5 applies canonical state (thread touched)');
select is(
  (select stale from public.story_threads where id = 't1' and story_id = 'test:v5-happy'),
  false, 'V5 applies canonical state (thread un-staled)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. REPLAY — 13-field exact machine + key-independent publisher replay
-- ═══════════════════════════════════════════════════════════════════════════════

-- 5a. Machine-level: NO_COMMIT → EXACT_REPLAY → CONFLICT per field.
select pg_temp.seed_story('test:replay-machine', 1);
insert into public.chapter_state_commits (
  story_id, chapter_number, base_canon_revision, committed_canon_revision,
  state_delta_json, state_delta_schema_version, state_delta_hash,
  generation_mode, actor_user_id, source_job_id,
  checkpoint_attempt_id, correlation_id,
  publication_payload_schema_version, publication_payload_hash, publication_result
) values (
  'test:replay-machine', 1, 0, 1,
  '{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb, 1,
  public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
  'personalized', '00000000-0000-0000-0000-000000000001', null,
  'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
  1, repeat('c', 64),
  '{"ok":true,"chapter_number":1,"seq":7,"checkpoint_attempt_id":"b1000000-0000-4000-8000-000000000001","committed_canon_revision":1}'::jsonb
);
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 2, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    repeat('c', 64), 1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'NO_COMMIT', 'no commit row → NO_COMMIT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'EXACT_REPLAY', 'exact 13-field match → EXACT_REPLAY');
select is(
  (select (public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->'result'->>'seq')),
  '7', 'EXACT_REPLAY returns the stored result');

select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'deadbeef-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'checkpoint_attempt_id mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'deadbeef-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'correlation_id mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 1::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'base_canon_revision mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 2::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'state_delta_schema_version mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'state_delta_hash mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    2::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'publication_payload_schema_version mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'personalized', '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'publication_payload_hash mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'standard',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'CONFLICT', 'generation_mode mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    'deadbeef-0000-4000-8000-000000000001', null
  )->>'state'),
  'CONFLICT', 'actor_user_id mismatch → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', 'deadbeef-0000-4000-8000-000000000001'
  )->>'state'),
  'CONFLICT', 'source_job_id mismatch (NULL vs job) → CONFLICT');
select is(
  (select public.lookup_chapter_commit_replay_v1(
    'test:replay-machine', 1, 'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0::bigint, 1::smallint,
    public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:replay-machine","chapterNumber":1}'::jsonb),
    1::smallint, repeat('c', 64), 'personalized',
    '00000000-0000-0000-0000-000000000001', null
  )->>'state'),
  'EXACT_REPLAY', 'NULL source_job_id (sync provenance) still replays exactly');

-- 5b. V3 publisher replay is idempotency-key-INDEPENDENT: after a successful
--     sync publication, delete the V2 idempotency key (as if a retry carried a
--     different key) — the 13-field commit replay short-circuits BEFORE V2.
select pg_temp.seed_story('test:replay-v3-key', 2);
select pg_temp.seed_thread('test:replay-v3-key');
select pg_temp.seed_sync_lease('test:replay-v3-key', 2, 'b3000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:replay-v3-key', 2, 'b4000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:replay-v3-key', 2), 0, 'Bab 2');
select lives_ok($$
  select public.publish_chapter_state_v3(
    'test:replay-v3-key', 2, '00000000-0000-0000-0000-000000000001',
    'b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'V3 sync publication succeeds (first attempt)');
select is((select count(*)::integer from public.chapters where story_id = 'test:replay-v3-key'), 1,
  'V3 created the chapter');
delete from public.idempotency_keys
where key = 'sync:test:replay-v3-key:publish:2';
select is(
  (select public.publish_chapter_state_v3(
    'test:replay-v3-key', 2, '00000000-0000-0000-0000-000000000001',
    'b3000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )->>'committed_canon_revision'),
  '1', 'V3 replay returns stored result with the idempotency key GONE (key-independent)');
select is((select count(*)::integer from public.chapters where story_id = 'test:replay-v3-key'), 1,
  'key-independent replay never re-publishes the chapter');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:replay-v3-key'), 1,
  'key-independent replay never re-inserts the commit');

-- 5c. V3 with commit ABSENT + chapter already exists (foreign state):
--     replay NO_COMMIT → V2 CHAPTER_EXISTS ok:false → PUBLICATION_CONFLICT raise.
select pg_temp.seed_story('test:replay-ch-exists', 2);
select pg_temp.seed_thread('test:replay-ch-exists');
select pg_temp.seed_sync_lease('test:replay-ch-exists', 2, 'b6000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:replay-ch-exists', 2, 'b7000000-0000-4000-8000-000000000001',
  'b8000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:replay-ch-exists', 2), 0, 'Bab 2');
select lives_ok($$
  select public.publish_chapter_v2(
    'test:replay-ch-exists', 2, 'Bab 2', '["Paragraf sinkron."]'::jsonb,
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    'b6000000-0000-4000-8000-000000000001', 'foreign:key:publish:2'
  )
$$, 'foreign chapter exists (direct V2 with a different key)');
select pg_temp.seed_sync_lease('test:replay-ch-exists', 2, 'b9000000-0000-4000-8000-000000000001');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:replay-ch-exists', 2, '00000000-0000-0000-0000-000000000001',
    'b9000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'PUBLICATION_CONFLICT', 'commit absent + CHAPTER_EXISTS → PUBLICATION_CONFLICT');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:replay-ch-exists'), 0,
  'PUBLICATION_CONFLICT rolls back the commit insert');
select is((select count(*)::integer from public.chapters where story_id = 'test:replay-ch-exists'), 1,
  'PUBLICATION_CONFLICT leaves only the foreign chapter');
select is((select canon_state_revision from public.stories where id = 'test:replay-ch-exists'),
  0::bigint, 'PUBLICATION_CONFLICT never increments revision');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:replay-ch-exists'),
  'PROSE_READY', 'PUBLICATION_CONFLICT leaves checkpoint PROSE_READY');

-- 5d. R1 authority gates — actor/lease/reader fences (fail closed).
-- V3 foreign owner: locked story.owner_user_id <> p_user_id →
-- PROVENANCE_CONFLICT (R1-7; same binding the sync writer enforces).
select pg_temp.seed_story('test:v3-foreign-owner', 2);
update public.stories
set owner_user_id = '00000000-0000-0000-0000-000000000099'
where id = 'test:v3-foreign-owner';
select pg_temp.seed_sync_lease('test:v3-foreign-owner', 2, 'f1000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:v3-foreign-owner', 2, 'f2000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:v3-foreign-owner', 2), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:v3-foreign-owner', 2, '00000000-0000-0000-0000-000000000001',
    'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'PROVENANCE_CONFLICT', 'V3 rejects a story owned by another user (owner binding)');
select is((select count(*)::integer from public.chapters where story_id = 'test:v3-foreign-owner'), 0,
  'V3 owner fence never publishes');

-- V3 worker-owned lease: a lease bound to a generation job (job_id/claim_token
-- NOT NULL) is NEVER publishable by the sync path → GENERATION_JOB_LEASE_INVALID
-- (R1-3; the sync lease contract is job_id IS NULL AND claim_token IS NULL).
select pg_temp.seed_story('test:v3-worker-lease', 2);
select pg_temp.seed_thread('test:v3-worker-lease');
select pg_temp.seed_job('test:v3-worker-lease', 2, 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:v3-worker-lease', 2, 'f6000000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:v3-worker-lease', 2), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:v3-worker-lease', 2, '00000000-0000-0000-0000-000000000001',
    'f5000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'GENERATION_JOB_LEASE_INVALID', 'V3 rejects a worker-owned lease (sync path never publishes job-bound leases)');
select is((select status from public.generation_leases where id = 'f5000000-0000-4000-8000-000000000001'),
  'ACTIVE', 'V3 lease fence leaves the worker lease ACTIVE');

-- V5 reader fence: valid v1 story + RUNNING job + schema-3 checkpoint but NO
-- reader_state → READER_STATE_MISSING (P0002) at the R lock (R1-4, fail closed).
select pg_temp.seed_bare_story('test:v5-noreader', 1);
select pg_temp.seed_job('test:v5-noreader', 2, 'f8000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-000000000001');
select pg_temp.seed_v5_checkpoint('test:v5-noreader', 2, 'f8000000-0000-4000-8000-000000000001',
  pg_temp.touch_delta('test:v5-noreader', 2), 0);
select throws_ok($$
  select public.publish_generation_job_chapter_v5(
    'f8000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'f8000000-0000-4000-8000-000000000001'),
    'f9000000-0000-4000-8000-000000000001',
    'test:v5-noreader', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0002', 'READER_STATE_MISSING', 'V5 without a reader_state fails closed (READER_STATE_MISSING)');
select is((select status from public.generation_jobs where id = 'f8000000-0000-4000-8000-000000000001'),
  'RUNNING', 'V5 reader fence leaves the job RUNNING');
select is((select status from public.generation_leases where id = 'f9000000-0000-4000-8000-000000000001'),
  'ACTIVE', 'V5 reader fence leaves the lease ACTIVE');

-- 5e. R2-H2 — V3 actor binding is the FULL sync contract: owner + private +
-- personalized_ai + reader_state (symmetric to the sync writer).
select pg_temp.seed_story('test:v3-private-std', 2);
update public.stories
set story_mode = 'standard'
where id = 'test:v3-private-std';
select pg_temp.seed_sync_lease('test:v3-private-std', 2, 'a9000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:v3-private-std', 2, 'a9000001-0000-4000-8000-000000000001',
  'a9000002-0000-4000-8000-000000000001', pg_temp.touch_delta('test:v3-private-std', 2), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:v3-private-std', 2, '00000000-0000-0000-0000-000000000001',
    'a9000000-0000-4000-8000-000000000001', 'a9000001-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'PROVENANCE_CONFLICT', 'V3 rejects private-but-standard story (sync path is private AND personalized_ai only)');
select is((select count(*)::integer from public.chapters where story_id = 'test:v3-private-std'), 0,
  'V3 story_mode fence never publishes');

select pg_temp.seed_story('test:v3-public-per', 2);
update public.stories
set visibility = 'public'
where id = 'test:v3-public-per';
select pg_temp.seed_sync_lease('test:v3-public-per', 2, 'a9000003-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:v3-public-per', 2, 'a9000004-0000-4000-8000-000000000001',
  'a9000005-0000-4000-8000-000000000001', pg_temp.touch_delta('test:v3-public-per', 2), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:v3-public-per', 2, '00000000-0000-0000-0000-000000000001',
    'a9000003-0000-4000-8000-000000000001', 'a9000004-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'PROVENANCE_CONFLICT', 'V3 rejects public-personalized story (sync path publishes private stories only)');
select is((select count(*)::integer from public.chapters where story_id = 'test:v3-public-per'), 0,
  'V3 visibility fence never publishes');

-- 5f. R2-B2 — V3 must NEVER publish a worker-bound checkpoint (domain
-- separation, symmetric to V5's exact job binding): sync-owned lease + schema-3
-- checkpoint bound to a generation job → PROVENANCE_CONFLICT, no chapter, no
-- commit, no revision.
select pg_temp.seed_story('test:v3-worker-checkpoint', 2);
select pg_temp.seed_thread('test:v3-worker-checkpoint');
select pg_temp.seed_job('test:v3-worker-checkpoint', 2, 'a9000006-0000-4000-8000-000000000001', 'a9000007-0000-4000-8000-000000000001');
select pg_temp.seed_v5_checkpoint('test:v3-worker-checkpoint', 2, 'a9000006-0000-4000-8000-000000000001',
  pg_temp.touch_delta('test:v3-worker-checkpoint', 2), 0);
-- No sync lease here: the job-bound checkpoint fence (pre-read, R2-B2) fires
-- BEFORE the lease lock, so the worker lease from seed_job is the only lease.
-- (generation_leases_one_active forbids a second ACTIVE lease on the story.)
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:v3-worker-checkpoint', 2, '00000000-0000-0000-0000-000000000001',
    'a9000008-0000-4000-8000-000000000001', 'a9000006-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'PROVENANCE_CONFLICT', 'V3 rejects a job-bound checkpoint (sync path never publishes worker-owned checkpoints)');
select is((select count(*)::integer from public.chapters where story_id = 'test:v3-worker-checkpoint'), 0,
  'worker-checkpoint fence publishes no chapter');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:v3-worker-checkpoint'), 0,
  'worker-checkpoint fence writes no commit');
select is((select canon_state_revision from public.stories where id = 'test:v3-worker-checkpoint'),
  0::bigint, 'worker-checkpoint fence never increments revision');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. ATOMICITY — any failure after V2 rolls back the WHOLE publication
-- ═══════════════════════════════════════════════════════════════════════════════

-- 6a. V5: applier failure after V2 published the chapter → full rollback.
select pg_temp.seed_story('test:atomic-v5-apply', 2);
select pg_temp.seed_job('test:atomic-v5-apply', 2, 'c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001');
select pg_temp.seed_v5_checkpoint('test:atomic-v5-apply', 2, 'c1000000-0000-4000-8000-000000000001',
  '{"schemaVersion":1,"storyId":"test:atomic-v5-apply","chapterNumber":2,"threads":{"touches":["ghost-thread"]}}'::jsonb,
  0);
select throws_ok($$
  select public.publish_generation_job_chapter_v5(
    'c1000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'c1000000-0000-4000-8000-000000000001'),
    'c2000000-0000-4000-8000-000000000001',
    'test:atomic-v5-apply', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'STATE_THREAD_CONFLICT: ghost-thread', 'applier failure after V2 raises STATE_THREAD_CONFLICT');
select is((select count(*)::integer from public.chapters where story_id = 'test:atomic-v5-apply'), 0,
  'applier failure rolls back the chapter');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:atomic-v5-apply'), 0,
  'applier failure rolls back the commit');
select is((select count(*)::integer from public.idempotency_keys where story_id = 'test:atomic-v5-apply'), 0,
  'applier failure rolls back the idempotency key');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:atomic-v5-apply'),
  'PROSE_READY', 'applier failure leaves checkpoint PROSE_READY');
select is((select status from public.generation_jobs where id = 'c1000000-0000-4000-8000-000000000001'),
  'RUNNING', 'applier failure leaves job RUNNING');
select is((select status from public.generation_leases where id = 'c2000000-0000-4000-8000-000000000001'),
  'ACTIVE', 'applier failure restores lease ACTIVE (V2 release rolled back)');
select is((select canon_state_revision from public.stories where id = 'test:atomic-v5-apply'),
  0::bigint, 'applier failure never increments revision');

-- 6b. V3: commit-insert failure (unique revision collision) → full rollback.
select pg_temp.seed_story('test:atomic-v3-commit', 2);
select pg_temp.seed_thread('test:atomic-v3-commit');
insert into public.chapter_state_commits (
  story_id, chapter_number, base_canon_revision, committed_canon_revision,
  state_delta_json, state_delta_schema_version, state_delta_hash,
  generation_mode, actor_user_id, source_job_id,
  checkpoint_attempt_id, correlation_id,
  publication_payload_schema_version, publication_payload_hash, publication_result
) values (
  'test:atomic-v3-commit', 1, 0, 1,
  '{"schemaVersion":1,"storyId":"test:atomic-v3-commit","chapterNumber":1}'::jsonb, 1,
  public.chapter_state_delta_hash_v1('{"schemaVersion":1,"storyId":"test:atomic-v3-commit","chapterNumber":1}'::jsonb),
  'personalized', '00000000-0000-0000-0000-000000000001', null,
  'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
  1, repeat('d', 64),
  '{"ok":true,"chapter_number":1,"seq":1,"checkpoint_attempt_id":"c3000000-0000-4000-8000-000000000001","committed_canon_revision":1}'::jsonb
);
select pg_temp.seed_sync_lease('test:atomic-v3-commit', 2, 'c5000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:atomic-v3-commit', 2, 'c6000000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:atomic-v3-commit', 2), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:atomic-v3-commit', 2, '00000000-0000-0000-0000-000000000001',
    'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, '23505', null, 'commit-insert unique violation rolls back the publication');
select is((select count(*)::integer from public.chapters where story_id = 'test:atomic-v3-commit'), 0,
  'commit-insert failure rolls back the chapter');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:atomic-v3-commit'), 1,
  'commit-insert failure keeps only the pre-existing commit (rolled-back insert gone)');
select is((select canon_state_revision from public.stories where id = 'test:atomic-v3-commit'),
  0::bigint, 'commit-insert failure never increments revision');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:atomic-v3-commit'),
  'PROSE_READY', 'commit-insert failure leaves checkpoint PROSE_READY');

-- 6c. V5: job finalization failure (injected) → full rollback.
create or replace function pg_temp.fail_job_finalize() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'INJECTED_FINALIZATION_FAILURE';
end
$$;
create trigger a1c_fail_job_finalize_before
before update on public.generation_jobs
for each row
when (old.status is distinct from 'SUCCEEDED' and new.status = 'SUCCEEDED'
      and old.story_id = 'test:atomic-v5-final')
execute function pg_temp.fail_job_finalize();

select pg_temp.seed_story('test:atomic-v5-final', 2);
select pg_temp.seed_thread('test:atomic-v5-final');
select pg_temp.seed_job('test:atomic-v5-final', 2, 'c8000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001');
select pg_temp.seed_v5_checkpoint('test:atomic-v5-final', 2, 'c8000000-0000-4000-8000-000000000001',
  pg_temp.touch_delta('test:atomic-v5-final', 2), 0);
select throws_ok($$
  select public.publish_generation_job_chapter_v5(
    'c8000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'c8000000-0000-4000-8000-000000000001'),
    'c9000000-0000-4000-8000-000000000001',
    'test:atomic-v5-final', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'INJECTED_FINALIZATION_FAILURE', 'job finalization failure raises');
select is((select count(*)::integer from public.chapters where story_id = 'test:atomic-v5-final'), 0,
  'finalization failure rolls back the chapter');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:atomic-v5-final'), 0,
  'finalization failure rolls back the commit');
select is((select status from public.chapter_generation_checkpoints where story_id = 'test:atomic-v5-final'),
  'PROSE_READY', 'finalization failure leaves checkpoint PROSE_READY (PUBLISHED rolled back)');
select is((select status from public.generation_leases where id = 'c9000000-0000-4000-8000-000000000001'),
  'ACTIVE', 'finalization failure restores lease ACTIVE');
select is((select status from public.generation_jobs where id = 'c8000000-0000-4000-8000-000000000001'),
  'RUNNING', 'finalization failure leaves job RUNNING');
select is((select canon_state_revision from public.stories where id = 'test:atomic-v5-final'),
  0::bigint, 'finalization failure never increments revision');

-- 6d. V5 retry: identical retry returns the same result; NO duplicate rows;
--     payload drift raises IDEMPOTENCY_CONFLICT.
select is(
  (select public.publish_generation_job_chapter_v5(
    'a7000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'a7000000-0000-4000-8000-000000000001'),
    'a8000000-0000-4000-8000-000000000001',
    'test:v5-happy', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )->>'committed_canon_revision'),
  '1', 'V5 identical retry returns the stored result');
select is((select count(*)::integer from public.chapters where story_id = 'test:v5-happy'), 1,
  'V5 retry keeps one chapter');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:v5-happy'), 1,
  'V5 retry keeps one commit');
select is(
  (select count(*)::integer from public.generation_job_attempts
   where job_id = 'a7000000-0000-4000-8000-000000000001'),
  1, 'V5 retry does not duplicate the PUBLICATION_SUCCEEDED attempt');
select throws_ok($$
  select public.publish_generation_job_chapter_v5(
    'a7000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'a7000000-0000-4000-8000-000000000001'),
    'a8000000-0000-4000-8000-000000000001',
    'test:v5-happy', 2, 'DIFFERENT PROMPT', pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'IDEMPOTENCY_CONFLICT', 'V5 payload drift on retry raises IDEMPOTENCY_CONFLICT');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. LEASE — V2 releases the lease inside V3/V5; finalization never requires a
--    second ACTIVE→RELEASED transition (success here is the proof).
-- ═══════════════════════════════════════════════════════════════════════════════

select pg_temp.seed_story('test:lease-v3', 2);
select pg_temp.seed_thread('test:lease-v3');
select pg_temp.seed_sync_lease('test:lease-v3', 2, 'd1000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:lease-v3', 2, 'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:lease-v3', 2), 0, 'Bab 2');
select lives_ok($$
  select public.publish_chapter_state_v3(
    'test:lease-v3', 2, '00000000-0000-0000-0000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'V3 publication succeeds with an ACTIVE lease (V2 releases it inside)');
select is((select status from public.generation_leases where id = 'd1000000-0000-4000-8000-000000000001'),
  'RELEASED', 'V3 final lease state is RELEASED — no second ACTIVE→RELEASED update was required');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:lease-v3'), 1,
  'V3 lease release coincides with exactly one commit');

-- V5 lease path already asserted in 4d (a8000000... → RELEASED) and 6a/6c
-- (rollback restores ACTIVE). Explicit re-assert for the report:
select is((select status from public.generation_leases where id = 'a8000000-0000-4000-8000-000000000001'),
  'RELEASED', 'V5 final lease state is RELEASED (worker path)');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. ACT-ROLLUP BOUNDARY — A1a invariant gate in the shared applier (R2-B1),
--    derived from the authoritative actPlan (story_contract_json->'actPlan',
--    seeded by seed_story with boundaries at 45/48/50). Four-way semantics:
--    non-boundary + rollup → reject; boundary + no rollup → reject; boundary +
--    wrong descriptor → reject; boundary + exact descriptor → accept.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Boundary 45 (act 10: 45-45) + exact descriptor → accept.
select pg_temp.seed_story('test:act-b45', 45);
select pg_temp.seed_sync_lease('test:act-b45', 45, '91000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:act-b45', 45, '92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001', pg_temp.act_delta('test:act-b45', 45, 10, 45, 45), 0, 'Bab 45');
select is(
  (select public.publish_chapter_state_v3(
    'test:act-b45', 45, '00000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(46),
    null, null
  )->>'ok'),
  'true', 'boundary ch45 with exact rollup publishes');
select is(
  (select row(act_number, covers_from_chapter, covers_to_chapter)::text
   from public.act_rollups where story_id = 'test:act-b45'),
  '(10,45,45)', 'ch45 boundary stores the exact descriptor (act 10, covers 45-45)');

-- Boundary 48 (act 11: 46-48) + exact descriptor → accept.
select pg_temp.seed_story('test:act-b48', 48);
select pg_temp.seed_sync_lease('test:act-b48', 48, '94000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:act-b48', 48, '95000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001', pg_temp.act_delta('test:act-b48', 48, 11, 46, 48), 0, 'Bab 48');
select is(
  (select public.publish_chapter_state_v3(
    'test:act-b48', 48, '00000000-0000-0000-0000-000000000001',
    '94000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(49),
    null, null
  )->>'ok'),
  'true', 'boundary ch48 with exact rollup publishes');
select is(
  (select row(act_number, covers_from_chapter, covers_to_chapter)::text
   from public.act_rollups where story_id = 'test:act-b48'),
  '(11,46,48)', 'ch48 boundary stores the exact descriptor (act 11, covers 46-48)');

-- Boundary 50 (act 12: 49-50) + exact descriptor → accept.
select pg_temp.seed_story('test:act-b50', 50);
select pg_temp.seed_sync_lease('test:act-b50', 50, '97000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:act-b50', 50, '98000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001', pg_temp.act_delta('test:act-b50', 50, 12, 49, 50), 0, 'Bab 50');
select is(
  (select public.publish_chapter_state_v3(
    'test:act-b50', 50, '00000000-0000-0000-0000-000000000001',
    '97000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001',
    null, '[]'::jsonb, '[]'::jsonb,
    null, null
  )->>'ok'),
  'true', 'boundary ch50 with exact rollup publishes');
select is(
  (select row(act_number, covers_from_chapter, covers_to_chapter)::text
   from public.act_rollups where story_id = 'test:act-b50'),
  '(12,49,50)', 'ch50 boundary stores the exact descriptor (act 12, covers 49-50)');

-- Non-boundary ch2 + rollup → STATE_ACT_ROLLUP_OUTSIDE_ACT (whole publication
-- rolls back: no chapter, no commit).
select pg_temp.seed_story('test:act-nonbound', 2);
select pg_temp.seed_sync_lease('test:act-nonbound', 2, '9a000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:act-nonbound', 2, '9b000000-0000-4000-8000-000000000001',
  '9c000000-0000-4000-8000-000000000001', pg_temp.act_delta('test:act-nonbound', 2, 1, 1, 5), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:act-nonbound', 2, '00000000-0000-0000-0000-000000000001',
    '9a000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'STATE_ACT_ROLLUP_OUTSIDE_ACT: 2', 'non-boundary chapter with actRollup rejected');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:act-nonbound'), 0,
  'outside-act rejection writes no commit');

-- Boundary 45 + NO rollup → STATE_ACT_ROLLUP_MISSING.
select pg_temp.seed_story('test:act-missing', 45);
select pg_temp.seed_thread('test:act-missing');
select pg_temp.seed_sync_lease('test:act-missing', 45, '9d000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:act-missing', 45, '9e000000-0000-4000-8000-000000000001',
  '9f000000-0000-4000-8000-000000000001', pg_temp.touch_delta('test:act-missing', 45), 0, 'Bab 45');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:act-missing', 45, '00000000-0000-0000-0000-000000000001',
    '9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(46),
    null, null
  )
$$, 'P0001', 'STATE_ACT_ROLLUP_MISSING: 45', 'boundary chapter without actRollup rejected');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:act-missing'), 0,
  'missing-rollup rejection writes no commit');

-- Boundary 45 + wrong descriptor (coversTo 44 instead of 45) →
-- STATE_ACT_ROLLUP_DESCRIPTOR_MISMATCH.
select pg_temp.seed_story('test:act-descriptor', 45);
select pg_temp.seed_sync_lease('test:act-descriptor', 45, '91000000-0000-4000-8000-000000000010');
select pg_temp.seed_sync_checkpoint('test:act-descriptor', 45, '92000000-0000-4000-8000-000000000010',
  '93000000-0000-4000-8000-000000000010', pg_temp.act_delta('test:act-descriptor', 45, 10, 45, 44), 0, 'Bab 45');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:act-descriptor', 45, '00000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000010', '92000000-0000-4000-8000-000000000010',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(46),
    null, null
  )
$$, 'P0001', 'STATE_ACT_ROLLUP_DESCRIPTOR_MISMATCH: 45', 'boundary chapter with wrong descriptor rejected');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:act-descriptor'), 0,
  'descriptor-mismatch rejection writes no commit');

-- Missing authoritative actPlan → fail closed (ACT_PLAN_NOT_FOUND), never a
-- silent skip of the boundary gate.
select pg_temp.seed_story('test:act-noplan', 2);
select pg_temp.seed_thread('test:act-noplan');
update public.story_generation_contracts
set story_contract_json = '{}'::jsonb
where story_id = 'test:act-noplan';
select pg_temp.seed_sync_lease('test:act-noplan', 2, '91000000-0000-4000-8000-000000000011');
select pg_temp.seed_sync_checkpoint('test:act-noplan', 2, '92000000-0000-4000-8000-000000000011',
  '93000000-0000-4000-8000-000000000011', pg_temp.touch_delta('test:act-noplan', 2), 0, 'Bab 2');
select throws_ok($$
  select public.publish_chapter_state_v3(
    'test:act-noplan', 2, '00000000-0000-0000-0000-000000000001',
    '91000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000011',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )
$$, 'P0001', 'ACT_PLAN_NOT_FOUND', 'story without actPlan fails closed in the applier');
select is((select count(*)::integer from public.chapter_state_commits where story_id = 'test:act-noplan'), 0,
  'missing-actPlan rejection writes no commit');

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. PARITY — identical validated delta via V3 (sync) and V5 (worker) produces
--    identical canonical tables + identical revision semantics
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.parity_delta(p_story text, p_chapter integer)
returns jsonb language sql as $$
  select ('{"schemaVersion":1,"storyId":"' || p_story || '","chapterNumber":' || p_chapter || ',"facts":{"add":[{"id":"f1-' || p_story || '","statement":"Kunci gudang ditemukan.","subjectCharacterId":"ch-raka-' || p_story || '","salience":1}]},' ||
          '"timeline":{"append":[{"ordinal":1,"description":"Raka membuka gudang.","isFlashback":false,"occursAt":1}]},' ||
          '"characters":{"statusChanges":[{"characterId":"ch-raka-' || p_story || '","from":"ALIVE","to":"INACTIVE"}]},' ||
          '"threads":{"touches":["t1-' || p_story || '"],"transitions":[{"threadId":"t1-' || p_story || '","from":"OPEN","to":"DEVELOPING"}]},' ||
          '"plotDebts":{"progress":[{"debtId":"d1","milestoneChapter":2}],' ||
          '"closures":[{"closureForm":"RESOLVED","debtId":"d1"},{"closureForm":"RESOLVED","debtId":"main_mystery"}]}}')::jsonb
$$;

create or replace function pg_temp.seed_parity_canon(p_story text)
returns void language plpgsql as $$
begin
  -- ids are STORY-SCOPED (characters/story_threads PKs are GLOBAL): parity
  -- needs identical canon on both stories SIMULTANEOUSLY, and earlier
  -- fixtures already own the bare 't1'/'ch-raka' ids.
  insert into public.characters (id, story_id, canonical_name, role, introduced_chapter)
  values ('ch-raka-' || p_story, p_story, 'Raka', 'protagonist', 1);
  insert into public.character_states (character_id, as_of_chapter, status, attributes)
  values ('ch-raka-' || p_story, 1, 'ALIVE', '{}'::jsonb);
  insert into public.story_threads (
    id, story_id, title, status, opened_chapter, last_touched_chapter,
    stale, stale_since_chapter, is_main_mystery
  ) values (
    't1-' || p_story, p_story, 'Misteri Gudang', 'OPEN', 1, 1, true, 1, true
  );
end
$$;

-- Normalized canonical snapshot: story_id stripped, job provenance coalesced,
-- story-scoped ids normalized back to their bare form so the two parity
-- stories produce byte-identical strings.
create or replace function pg_temp.canon_state(p_story text)
returns text language sql stable as $$
  select replace(replace(replace(
    'F:' || coalesce((select string_agg(row(f.id, f.statement, coalesce(f.subject_character_id, ''), f.established_chapter, f.salience, f.load_bearing, f.paid_off)::text, '|' order by f.id)
                      from public.facts_ledger f where f.story_id = p_story), '') ||
    ';T:' || coalesce((select string_agg(row(t.chapter_number, t.ordinal, t.description, t.is_flashback, coalesce(t.occurs_at, -1))::text, '|' order by t.ordinal)
                       from public.timeline_events t where t.story_id = p_story), '') ||
    ';CS:' || coalesce((select string_agg(row(cs.character_id, cs.as_of_chapter, cs.status)::text, '|' order by cs.character_id, cs.as_of_chapter)
                        from public.character_states cs
                        where cs.character_id in (select id from public.characters where story_id = p_story)), '') ||
    ';TH:' || coalesce((select string_agg(row(t.id, t.status, t.last_touched_chapter, t.stale, coalesce(t.stale_since_chapter, -1))::text, '|' order by t.id)
                        from public.story_threads t where t.story_id = p_story), '') ||
    ';AR:' || coalesce((select string_agg(row(a.act_number, a.summary, a.covers_from_chapter, a.covers_to_chapter)::text, '|' order by a.act_number)
                        from public.act_rollups a where a.story_id = p_story), '') ||
    ';PR:' || coalesce((select string_agg(row(p.debt_id, p.milestone_chapter,
                        'PROV')::text, '|' order by p.debt_id)
                        from public.reader_plot_debt_progress p where p.story_id = p_story), '') ||
    ';CL:' || coalesce((select string_agg(row(c.debt_id, c.closure_form, c.closed_at_chapter,
                        'PROV')::text, '|' order by c.debt_id)
                        from public.reader_plot_debt_closures c where c.story_id = p_story), ''),
    'f1-' || p_story, 'f1'), 't1-' || p_story, 't1'), 'ch-raka-' || p_story, 'ch-raka')
$$;

-- V3 (sync) side.
select pg_temp.seed_story('test:parity:v3', 2);
select pg_temp.seed_parity_canon('test:parity:v3');
select pg_temp.seed_sync_lease('test:parity:v3', 2, 'e1000000-0000-4000-8000-000000000001');
select pg_temp.seed_sync_checkpoint('test:parity:v3', 2, 'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001', pg_temp.parity_delta('test:parity:v3', 2), 0, 'Bab 2',
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"closureForm":"RESOLVED","debtId":"d1"},{"closureForm":"RESOLVED","debtId":"main_mystery"}]}'::jsonb);
select is(
  (select public.publish_chapter_state_v3(
    'test:parity:v3', 2, '00000000-0000-0000-0000-000000000001',
    'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
    pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )->>'ok'),
  'true', 'V3 parity publication succeeds');

-- V5 (worker) side — same contract, same canonical seeds, same delta.
-- ids are story-scoped (see seed_parity_canon), so both sides coexist and
-- canon_state normalizes them back for the byte-identical comparison.
select pg_temp.seed_story('test:parity:v5', 2);
select pg_temp.seed_parity_canon('test:parity:v5');
select pg_temp.seed_job('test:parity:v5', 2, 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001');
select pg_temp.seed_v5_checkpoint('test:parity:v5', 2, 'e4000000-0000-4000-8000-000000000001',
  pg_temp.parity_delta('test:parity:v5', 2), 0,
  '{"opensNewThread":false,"opensMajorMystery":false,"opensNewConflict":false,"closesPlotDebts":[{"closureForm":"RESOLVED","debtId":"d1"},{"closureForm":"RESOLVED","debtId":"main_mystery"}]}'::jsonb,
  '["Paragraf sinkron."]'::jsonb);
select is(
  (select public.publish_generation_job_chapter_v5(
    'e4000000-0000-4000-8000-000000000001', 'a1c-worker',
    (select claim_token from public.generation_jobs where id = 'e4000000-0000-4000-8000-000000000001'),
    'e5000000-0000-4000-8000-000000000001',
    'test:parity:v5', 2, pg_temp.prompt_fixture(), pg_temp.choices_fixture(), pg_temp.outcomes_fixture(3),
    null, null
  )->>'ok'),
  'true', 'V5 parity publication succeeds');

select is(
  pg_temp.canon_state('test:parity:v3'),
  pg_temp.canon_state('test:parity:v5'),
  'PARITY: identical delta via V3/V5 → identical canonical tables (facts, timeline, character_states, threads, progress, closures)'
);
select is(
  (select row(base_canon_revision, committed_canon_revision, state_delta_schema_version,
              publication_payload_schema_version,
              generation_mode, actor_user_id)::text
   from public.chapter_state_commits where story_id = 'test:parity:v3'),
  (select row(base_canon_revision, committed_canon_revision, state_delta_schema_version,
              publication_payload_schema_version,
              generation_mode, actor_user_id)::text
   from public.chapter_state_commits where story_id = 'test:parity:v5'),
  'PARITY: commit ledger semantics identical (revision, schema versions, mode, actor; state/payload hashes are story-scoped by design)'
);
select is(
  (select source_job_id from public.chapter_state_commits where story_id = 'test:parity:v3'),
  null, 'PARITY: sync commit has NULL source_job_id');
select is(
  (select source_job_id from public.chapter_state_commits where story_id = 'test:parity:v5'),
  'e4000000-0000-4000-8000-000000000001'::uuid, 'PARITY: worker commit has job source_job_id');
select is((select canon_state_revision from public.stories where id = 'test:parity:v3'),
  1::bigint, 'PARITY: V3 revision semantics base+1');
select is((select canon_state_revision from public.stories where id = 'test:parity:v5'),
  1::bigint, 'PARITY: V5 revision semantics base+1');
select is(
  (select (publication_result->>'seq')::integer from public.chapter_state_commits where story_id = 'test:parity:v3'),
  (select (publication_result->>'seq')::integer from public.chapter_state_commits where story_id = 'test:parity:v5'),
  'PARITY: V2 seq identical across paths');
select is(
  (select count(*)::integer from public.chapter_state_commits where story_id = 'test:parity:v3'),
  (select count(*)::integer from public.chapter_state_commits where story_id = 'test:parity:v5'),
  'PARITY: exactly one commit per path');

select * from finish();
rollback;
