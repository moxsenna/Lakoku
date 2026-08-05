-- Living Canon publication primitives (M10-A1c.1). ZERO runtime activation:
-- no caller wiring, no living_canon_version activation, no story bootstrap.
-- Wiring of these primitives happens in A1d.
--
-- Surface:
-- 1. reader_plot_debt_closures: closed_by_job_id nullable (sync path writes
--    closures via the shared applier with NULL job provenance)
-- 2. chapter_state_commits:     + correlation_id, + publication_payload_hash,
--    + publication_payload_schema_version, + publication_result (expand
--    pattern: add nullable → fail-closed empty check → SET NOT NULL)
-- 3. chapter_publication_payload_hash_v1(): DB-owned publication payload hash,
--    byte-identical to the V4 inline formula (sha256 of
--    'generation-publication-v1' || jsonb_build_object(...)::text)
-- 4. lookup_chapter_commit_replay_v1(): shared 13-field exact-replay machine
--    (the ONLY replay evaluator; V3 and V5 both call it)
-- 5. apply_validated_chapter_state_v1(): shared atomic state applier —
--    SINGLE mutation owner for all canonical tables (facts, knowledge,
--    secrets, timeline, characters, threads, act rollups) AND the plot-debt
--    ledgers (reader_plot_debt_progress, reader_plot_debt_closures). V3/V5 do
--    ZERO canonical-state DML themselves.
-- 6. publish_generation_job_chapter_v4: forward redefinition — corrected lock
--    order (S → STORY SHARE → capability gate → R → J → L → C) + DB-enforced
--    V4/V5 disjointness (living_canon_version <> 0 → LIVING_CANON_REQUIRES_V5
--    BEFORE any R/J/L/C lock). Legacy v0 behavior identical.
-- 7. upsert_generation_checkpoint_sync_v1(): narrow server-only sync
--    checkpoint writer (attempt-scoped UUID + correlation from caller,
--    REJECT UUIDv5 deterministic ids, schema 3, DB-computed hash)
-- 8. publish_chapter_state_v3(): sync publisher (existing ACTIVE lease from
--    caller, ordered locks, checkpoint-bound delta, 13-field replay,
--    shared applier, commit insert, canon revision increment)
-- 9. publish_generation_job_chapter_v5(): worker publisher (V4 fencing +
--    living canon gate, title/paragraphs/delta/closures ALL from locked
--    checkpoint — caller supplies none of them, shared applier, commit
--    insert, canon revision increment, mirror V4 terminalization; replay
--    authority = the immutable commit ledger via lookup_chapter_commit_replay_v1
--    evaluated under the LOCKED J — no dual-hash fast path, R3)
--
-- Lock order (final, both publishers):
--   V5: E1 → E2 → S(120712) → STORY FOR UPDATE → R → J → [checkpoint pre-read
--       + commit replay eval — pure SELECT, the ONLY replay authority, R3] →
--       L → C FOR UPDATE (same-row hash re-verify) → CONTRACT → writes
--   V3: E1 → E2 → S(120712) → STORY FOR UPDATE → R → [checkpoint pre-read +
--       commit replay eval — pure SELECT] → L → C → CONTRACT → writes
--   V4 (redefined): E1 → E2 → S(120712) → STORY FOR SHARE → gate → R → J → L → C
-- Invariants: S before STORY, STORY before R, STORY before L, J before L,
-- L before C, C before writes. The commit ledger is evaluated by the shared
-- 13-field replay machine as a pure SELECT BEFORE L/C (no FOR UPDATE — the
-- ledger is immutable once written); serialization for NEW commits is the
-- story row + advisory S + the unique (story_id, chapter_number).

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. reader_plot_debt_closures.closed_by_job_id → nullable
-- ──────────────────────────────────────────────────────────────────────────────
-- The shared applier writes closures for BOTH paths: worker (job id) and sync
-- (NULL — no generation job exists). The legacy NOT NULL from
-- 20260728010000 forbids sync-path closure persistence.

alter table public.reader_plot_debt_closures
  alter column closed_by_job_id drop not null;

comment on column public.reader_plot_debt_closures.closed_by_job_id is
  'Worker provenance; NULL when the closure was recorded by the sync path (no generation job).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. chapter_state_commits: correlation + publication payload expansion
-- ──────────────────────────────────────────────────────────────────────────────
-- correlation_id: attempt-run correlation (authoritative source is the locked
-- checkpoint row; publishers never accept it from callers). publication_*:
-- durable replay proof — the commit ledger is the canonical cross-path replay
-- result (idempotency_keys.result is not enough: a retry can carry a
-- different key).
-- Expand pattern: add nullable → fail-closed empty check → SET NOT NULL.

alter table public.chapter_state_commits
  add column if not exists correlation_id uuid,
  add column if not exists publication_payload_hash text,
  add column if not exists publication_payload_schema_version smallint,
  add column if not exists publication_result jsonb;

do $expand_guard$
begin
  if exists (select 1 from public.chapter_state_commits) then
    raise exception using errcode = 'P0001',
      message = 'PUBLICATION_COLUMNS_BACKFILL_UNSUPPORTED';
  end if;
end
$expand_guard$;

alter table public.chapter_state_commits
  alter column correlation_id set not null;
alter table public.chapter_state_commits
  alter column publication_payload_hash set not null;
alter table public.chapter_state_commits
  alter column publication_payload_schema_version set default 1;
alter table public.chapter_state_commits
  alter column publication_payload_schema_version set not null;
alter table public.chapter_state_commits
  alter column publication_result set not null;

alter table public.chapter_state_commits
  add constraint chapter_state_commits_publication_payload_hash_check
  check (publication_payload_hash ~ '^[0-9a-f]{64}$');

alter table public.chapter_state_commits
  add constraint chapter_state_commits_publication_payload_schema_version_check
  check (publication_payload_schema_version = 1);

-- publication_result is a small bounded object that must bind its metadata
-- back to the row it lives on (chapter, attempt, committed revision).
-- Fail-closed shape (R2-B3): every required key must EXIST and carry the exact
-- jsonb type BEFORE any cast — a missing key made the old `->>` expression
-- evaluate NULL and the comparison vacuously pass. Key presence is pinned with
-- ?&, types with jsonb_typeof, and only then are the values cast and compared.
alter table public.chapter_state_commits
  add constraint chapter_state_commits_publication_result_check
  check (
    pg_catalog.jsonb_typeof(publication_result) = 'object'
    and publication_result ?& '{ok,chapter_number,checkpoint_attempt_id,committed_canon_revision}'::pg_catalog.text[]
    and pg_catalog.jsonb_typeof(publication_result->'ok') = 'boolean'
    and (publication_result->>'ok')::boolean is true
    and pg_catalog.jsonb_typeof(publication_result->'chapter_number') = 'number'
    and (publication_result->>'chapter_number')::numeric = chapter_number
    and pg_catalog.jsonb_typeof(publication_result->'checkpoint_attempt_id') = 'string'
    and (publication_result->>'checkpoint_attempt_id')::uuid = checkpoint_attempt_id
    and pg_catalog.jsonb_typeof(publication_result->'committed_canon_revision') = 'number'
    and (publication_result->>'committed_canon_revision')::bigint = committed_canon_revision
    and pg_catalog.pg_column_size(publication_result) <= 8192
  );

comment on column public.chapter_state_commits.correlation_id is
  'Attempt-run correlation, read from the locked checkpoint at publication. Never caller-supplied.';
comment on column public.chapter_state_commits.publication_payload_hash is
  'DB-computed publication payload hash (chapter_publication_payload_hash_v1). Durable replay proof.';
comment on column public.chapter_state_commits.publication_payload_schema_version is
  'Publication payload contract version. 1 = current.';
comment on column public.chapter_state_commits.publication_result is
  'Canonical cross-path replay result. Stored once in the commit transaction; exact replay returns it.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. chapter_publication_payload_hash_v1() — DB-owned publication payload hash
-- ──────────────────────────────────────────────────────────────────────────────
-- Byte-identical to the V4 inline formula (20260728050000 lines 294-312):
--   sha256('generation-publication-v1' || jsonb_build_object(
--     'hashSchema','generation-publication-v1','storyId','chapterNumber','title',
--     'paragraphs','choicePrompt','choices','outcomes','endingKey','endingName')::text)
-- jsonb_build_object preserves key insertion order, so the fixed argument
-- order produces identical ::text bytes. sha256 is PG17 pg_catalog (same as
-- chapter_state_delta_hash_v1). SECURITY INVOKER (pure hashing, no protected
-- reads).

create or replace function public.chapter_publication_payload_hash_v1(
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_ending_key text,
  p_ending_name text
) returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        'generation-publication-v1' || pg_catalog.jsonb_build_object(
          'hashSchema', 'generation-publication-v1',
          'storyId', p_story_id,
          'chapterNumber', p_chapter_number,
          'title', p_title,
          'paragraphs', p_paragraphs,
          'choicePrompt', p_choice_prompt,
          'choices', p_choices,
          'outcomes', p_outcomes,
          'endingKey', p_ending_key,
          'endingName', p_ending_name
        )::text,
        'UTF8'
      )
    ),
    'hex'
  )
$$;

revoke all on function public.chapter_publication_payload_hash_v1(
  text, integer, text, jsonb, text, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.chapter_publication_payload_hash_v1(
  text, integer, text, jsonb, text, jsonb, jsonb, text, text
) to service_role;

comment on function public.chapter_publication_payload_hash_v1(
  text, integer, text, jsonb, text, jsonb, jsonb, text, text
) is
  'SHA-256 hex of "generation-publication-v1" + canonical jsonb_build_object text. Byte-identical to V4 inline.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. lookup_chapter_commit_replay_v1() — shared exact-replay machine
-- ──────────────────────────────────────────────────────────────────────────────
-- The ONLY replay evaluator in the living-canon surface. Pure SELECT — NO
-- row lock: serialization authority is the story row + advisory S (held by
-- every caller), and the unique (story_id, chapter_number) commit row is the
-- final database guard. 13-field exact comparison; NULL==NULL via IS
-- DISTINCT FROM.
-- Internal only: no grants, revoke ALL including service_role. Called from
-- the DEFINER publishers in the same transaction.

create or replace function public.lookup_chapter_commit_replay_v1(
  p_story_id text,
  p_chapter_number integer,
  p_checkpoint_attempt_id uuid,
  p_correlation_id uuid,
  p_base_canon_revision bigint,
  p_state_delta_schema_version smallint,
  p_state_delta_hash text,
  p_publication_payload_schema_version smallint,
  p_publication_payload_hash text,
  p_generation_mode text,
  p_actor_user_id uuid,
  p_source_job_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_commit public.chapter_state_commits%rowtype;
begin
  if p_story_id is null or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200
    or p_chapter_number is null or p_chapter_number not between 1 and 50 then
    raise exception using errcode = '22023', message = 'INVALID_REPLAY_IDENTITY';
  end if;

  select c.* into v_commit
  from public.chapter_state_commits c
  where c.story_id = p_story_id
    and c.chapter_number = p_chapter_number;

  if not found then
    return pg_catalog.jsonb_build_object('state', 'NO_COMMIT');
  end if;

  -- 13-field exact provenance comparison. Any difference (including
  -- NULL-vs-value for sync/worker provenance) is a conflict, never a replay.
  if v_commit.checkpoint_attempt_id is distinct from p_checkpoint_attempt_id
    or v_commit.correlation_id is distinct from p_correlation_id
    or v_commit.base_canon_revision is distinct from p_base_canon_revision
    or v_commit.committed_canon_revision is distinct from p_base_canon_revision + 1
    or v_commit.state_delta_schema_version is distinct from p_state_delta_schema_version
    or v_commit.state_delta_hash is distinct from p_state_delta_hash
    or v_commit.publication_payload_schema_version is distinct from p_publication_payload_schema_version
    or v_commit.publication_payload_hash is distinct from p_publication_payload_hash
    or v_commit.generation_mode is distinct from p_generation_mode
    or v_commit.actor_user_id is distinct from p_actor_user_id
    or v_commit.source_job_id is distinct from p_source_job_id
  then
    return pg_catalog.jsonb_build_object('state', 'CONFLICT');
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'EXACT_REPLAY',
    'result', v_commit.publication_result
  );
end;
$$;

revoke all on function public.lookup_chapter_commit_replay_v1(
  text, integer, uuid, uuid, bigint, smallint, text, smallint, text, text, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function public.lookup_chapter_commit_replay_v1(
  text, integer, uuid, uuid, bigint, smallint, text, smallint, text, text, uuid, uuid
) is
  'Internal shared 13-field exact-replay evaluator. Returns NO_COMMIT | CONFLICT | EXACT_REPLAY(result). No grants (DEFINER publishers only).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. apply_validated_chapter_state_v1() — shared atomic state applier
-- ──────────────────────────────────────────────────────────────────────────────
-- SINGLE mutation owner for canonical state: facts_ledger, character_states,
-- knowledge_scopes, secrets_reveals, timeline_events, story_threads,
-- act_rollups, reader_plot_debt_progress, reader_plot_debt_closures.
-- V3/V5 perform ZERO canonical-state DML themselves. Semantics mirror
-- applyChapterStateDeltaToSnapshot() (lib/narrative/chapter-state-apply.ts)
-- and canTransition() (lib/narrative/threads.ts) — the parity tests prove
-- SQL == TS.
-- committed_canon_revision is DERIVED (base + 1), never caller-supplied.
-- All conflicts raise P0001 STATE_*_CONFLICT (fail-closed, whole
-- transaction rolls back). Internal only: revoke ALL including service_role.

create or replace function public.apply_validated_chapter_state_v1(
  p_story_id text,
  p_chapter_number integer,
  p_base_canon_revision bigint,
  p_user_id uuid,
  p_source_job_id uuid,
  p_state_delta_json jsonb
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delta jsonb := p_state_delta_json;
  v_item jsonb;
  v_fact_id text;
  v_char_id text;
  v_thread_id text;
  v_cur_status text;
  v_cur_thread_status text;
  v_gate_chapter integer;
  v_from text;
  v_to text;
  v_legal boolean := false;
  v_act_plan jsonb;
  v_act_item jsonb;
  v_act_boundary jsonb;
  v_is_act_boundary boolean := false;
  v_act_number integer;
  v_act_from_chapter integer;
  v_act_to_chapter integer;
begin
  -- Identity + delta shape (fail closed before any mutation).
  if p_story_id is null or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;
  if p_chapter_number is null or p_chapter_number not between 1 and 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  end if;
  if p_base_canon_revision is null or p_base_canon_revision < 0 then
    raise exception using errcode = '22023', message = 'INVALID_BASE_CANON_REVISION';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER_ID';
  end if;
  if v_delta is null or pg_catalog.jsonb_typeof(v_delta) <> 'object'
    or pg_catalog.pg_column_size(v_delta) > 1000000 then
    raise exception using errcode = '22023', message = 'INVALID_STATE_DELTA';
  end if;
  if (v_delta->>'schemaVersion') is distinct from '1'
    or (v_delta->>'storyId') is distinct from p_story_id
    or (v_delta->>'chapterNumber')::integer is distinct from p_chapter_number then
    raise exception using errcode = 'P0001', message = 'STATE_DELTA_INVALID';
  end if;

  -- ── facts.add: every added fact must be new (no last-write-wins).
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'facts'->'add', '[]'::jsonb)
                     )
  loop
    begin
      insert into public.facts_ledger (
        id, story_id, statement, subject_character_id,
        established_chapter, salience, load_bearing, paid_off
      ) values (
        v_item->>'id', p_story_id, v_item->>'statement',
        v_item->>'subjectCharacterId', p_chapter_number,
        (v_item->>'salience')::real, false, false
      );
    exception
      when unique_violation then
        raise exception using errcode = 'P0001',
          message = 'STATE_FACT_CONFLICT: ' || v_item->>'id';
    end;
  end loop;

  -- ── facts.markPaidOff: must reference existing facts, never facts added in
  -- the same delta.
  for v_fact_id in select value
                   from pg_catalog.jsonb_array_elements_text(
                          coalesce(v_delta->'facts'->'markPaidOff', '[]'::jsonb)
                        )
  loop
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
             coalesce(v_delta->'facts'->'add', '[]'::jsonb)
           ) as added(value)
      where added.value->>'id' = v_fact_id
    ) then
      raise exception using errcode = 'P0001',
        message = 'STATE_FACT_CONFLICT: ' || v_fact_id;
    end if;
    update public.facts_ledger
    set paid_off = true
    where id = v_fact_id and story_id = p_story_id;
    if not found then
      raise exception using errcode = 'P0001',
        message = 'STATE_FACT_CONFLICT: ' || v_fact_id;
    end if;
  end loop;

  -- ── knowledge.grants: fact and character must exist; no duplicate grants.
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'knowledge'->'grants', '[]'::jsonb)
                     )
  loop
    v_char_id := v_item->>'characterId';
    v_fact_id := v_item->>'factId';
    if not exists (
      select 1 from public.facts_ledger f
      where f.id = v_fact_id and f.story_id = p_story_id
    ) or not exists (
      select 1 from public.characters c
      where c.id = v_char_id and c.story_id = p_story_id
    ) then
      raise exception using errcode = 'P0001',
        message = 'STATE_KNOWLEDGE_CONFLICT: ' || v_char_id || ' knows ' || v_fact_id;
    end if;
    begin
      insert into public.knowledge_scopes (
        story_id, character_id, fact_id, known_from_chapter
      ) values (
        p_story_id, v_char_id, v_fact_id, p_chapter_number
      );
    exception
      when unique_violation then
        raise exception using errcode = 'P0001',
          message = 'STATE_KNOWLEDGE_CONFLICT: ' || v_char_id || ' knows ' || v_fact_id;
    end;
  end loop;

  -- ── secrets.revealIds: secret must exist and gate must be open.
  for v_fact_id in select value
                   from pg_catalog.jsonb_array_elements_text(
                          coalesce(v_delta->'secrets'->'revealIds', '[]'::jsonb)
                        )
  loop
    select s.reveal_gate_chapter into v_gate_chapter
    from public.secrets_reveals s
    where s.id = v_fact_id and s.story_id = p_story_id;
    if not found then
      raise exception using errcode = 'P0001',
        message = 'STATE_SECRET_CONFLICT: ' || v_fact_id;
    end if;
    if v_gate_chapter > p_chapter_number then
      raise exception using errcode = 'P0001',
        message = 'STATE_SECRET_CONFLICT: ' || v_fact_id;
    end if;
    update public.secrets_reveals
    set revealed = true
    where id = v_fact_id and story_id = p_story_id;
  end loop;

  -- ── timeline.append.
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'timeline'->'append', '[]'::jsonb)
                     )
  loop
    insert into public.timeline_events (
      story_id, chapter_number, ordinal, description, is_flashback, occurs_at
    ) values (
      p_story_id, p_chapter_number,
      (v_item->>'ordinal')::integer, v_item->>'description',
      (v_item->>'isFlashback')::boolean, (v_item->>'occursAt')::real
    );
  end loop;

  -- ── characters.statusChanges: from must match current state; transition
  -- must be legal (LEGAL_CHARACTER_TRANSITIONS: ALIVE→[INACTIVE,DEAD],
  -- INACTIVE→[ALIVE,DEAD], DEAD→[]; self-transition illegal).
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'characters'->'statusChanges', '[]'::jsonb)
                     )
  loop
    v_char_id := v_item->>'characterId';
    v_from := v_item->>'from';
    v_to := v_item->>'to';
    select cs.status into v_cur_status
    from public.character_states cs
    where cs.character_id = v_char_id
    order by cs.as_of_chapter desc
    limit 1;
    if not found or v_cur_status is distinct from v_from then
      raise exception using errcode = 'P0001',
        message = 'STATE_CHARACTER_CONFLICT: ' || v_char_id;
    end if;
    v_legal := case v_from
      when 'ALIVE' then v_to in ('INACTIVE', 'DEAD')
      when 'INACTIVE' then v_to in ('ALIVE', 'DEAD')
      when 'DEAD' then false
      else false
    end;
    if not v_legal or v_from = v_to then
      raise exception using errcode = 'P0001',
        message = 'STATE_CHARACTER_CONFLICT: ' || v_char_id;
    end if;
    insert into public.character_states (
      character_id, as_of_chapter, status, attributes
    ) values (
      v_char_id, p_chapter_number, v_to, '{}'::jsonb
    );
  end loop;

  -- ── threads.touches: reset staleness, advance lastTouched.
  for v_thread_id in select value
                     from pg_catalog.jsonb_array_elements_text(
                            coalesce(v_delta->'threads'->'touches', '[]'::jsonb)
                          )
  loop
    update public.story_threads
    set last_touched_chapter = greatest(last_touched_chapter, p_chapter_number),
        stale = false,
        stale_since_chapter = null
    where id = v_thread_id and story_id = p_story_id;
    if not found then
      raise exception using errcode = 'P0001',
        message = 'STATE_THREAD_CONFLICT: ' || v_thread_id;
    end if;
  end loop;

  -- ── threads.transitions: from must match current; legal transition
  -- (LEGAL_TRANSITIONS: OPEN→[DEVELOPING,PAYOFF_DUE,ABANDONED_APPROVED],
  -- DEVELOPING→[PAYOFF_DUE,RESOLVED,ABANDONED_APPROVED],
  -- PAYOFF_DUE→[RESOLVED,ABANDONED_APPROVED], RESOLVED/ABANDONED_APPROVED→[];
  -- self-transition legal). Every transition also touches the thread.
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'threads'->'transitions', '[]'::jsonb)
                     )
  loop
    v_thread_id := v_item->>'threadId';
    v_from := v_item->>'from';
    v_to := v_item->>'to';
    select t.status into v_cur_thread_status
    from public.story_threads t
    where t.id = v_thread_id and t.story_id = p_story_id;
    if not found or v_cur_thread_status is distinct from v_from then
      raise exception using errcode = 'P0001',
        message = 'STATE_THREAD_CONFLICT: ' || v_thread_id;
    end if;
    v_legal := case v_from
      when 'OPEN' then v_to in ('DEVELOPING', 'PAYOFF_DUE', 'ABANDONED_APPROVED')
      when 'DEVELOPING' then v_to in ('PAYOFF_DUE', 'RESOLVED', 'ABANDONED_APPROVED')
      when 'PAYOFF_DUE' then v_to in ('RESOLVED', 'ABANDONED_APPROVED')
      when 'RESOLVED' then false
      when 'ABANDONED_APPROVED' then false
      else false
    end;
    if not (v_legal or v_from = v_to) then
      raise exception using errcode = 'P0001',
        message = 'STATE_THREAD_CONFLICT: ' || v_thread_id;
    end if;
    update public.story_threads
    set status = v_to,
        last_touched_chapter = greatest(last_touched_chapter, p_chapter_number),
        stale = false,
        stale_since_chapter = null
    where id = v_thread_id and story_id = p_story_id;
  end loop;

  -- ── actRollup: boundary gate (R2-B1, A1a invariant). The authoritative
  -- boundary source is the story's actPlan (story_generation_contracts.
  -- story_contract_json->'actPlan' — the SAME source the ASI bootstrap and
  -- plot-debt ledger validate), never a second hardcoded plan. A chapter is an
  -- act boundary iff some actPlan item has toChapter = p_chapter_number.
  --
  -- Four-way semantics (all fail closed with P0001):
  --   non-boundary + actRollup      → STATE_ACT_ROLLUP_OUTSIDE_ACT
  --   boundary + no actRollup       → STATE_ACT_ROLLUP_MISSING
  --   boundary + wrong descriptor   → STATE_ACT_ROLLUP_DESCRIPTOR_MISMATCH
  --   boundary + exact descriptor   → INSERT (actNumber/coversFromChapter/
  --     coversToChapter must equal the actPlan item exactly)
  --
  -- actPlan is REQUIRED for every personalized contract (bootstrap
  -- validation); a publishing story without it is broken state → fail closed
  -- rather than silently skipping the gate.
  select sgc.story_contract_json->'actPlan' into v_act_plan
  from public.story_generation_contracts sgc
  where sgc.story_id = p_story_id;

  if v_act_plan is null or pg_catalog.jsonb_typeof(v_act_plan) <> 'array' then
    raise exception using errcode = 'P0001', message = 'ACT_PLAN_NOT_FOUND';
  end if;
  for v_act_item in select value
                    from pg_catalog.jsonb_array_elements(v_act_plan)
  loop
    if (v_act_item->>'toChapter')::integer = p_chapter_number then
      v_act_boundary := v_act_item;
      v_is_act_boundary := true;
      v_act_number := (v_act_item->>'actNumber')::integer;
      v_act_from_chapter := (v_act_item->>'fromChapter')::integer;
      v_act_to_chapter := (v_act_item->>'toChapter')::integer;
      exit;
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(v_delta->'actRollup') = 'object' then
    v_item := v_delta->'actRollup';
    if not v_is_act_boundary then
      raise exception using errcode = 'P0001',
        message = 'STATE_ACT_ROLLUP_OUTSIDE_ACT: ' || p_chapter_number::text;
    end if;
    if (v_item->>'actNumber')::integer is distinct from v_act_number
      or (v_item->>'coversFromChapter')::integer is distinct from v_act_from_chapter
      or (v_item->>'coversToChapter')::integer is distinct from v_act_to_chapter
    then
      raise exception using errcode = 'P0001',
        message = 'STATE_ACT_ROLLUP_DESCRIPTOR_MISMATCH: ' || p_chapter_number::text;
    end if;
    begin
      insert into public.act_rollups (
        story_id, act_number, summary, state_delta,
        covers_from_chapter, covers_to_chapter
      ) values (
        p_story_id, (v_item->>'actNumber')::integer, v_item->>'summary',
        v_item->'stateDelta',
        (v_item->>'coversFromChapter')::integer, (v_item->>'coversToChapter')::integer
      );
    exception
      when unique_violation then
        raise exception using errcode = 'P0001',
          message = 'STATE_ACT_ROLLUP_CONFLICT: ' || (v_item->>'actNumber')::text;
    end;
  elsif v_is_act_boundary then
    raise exception using errcode = 'P0001',
      message = 'STATE_ACT_ROLLUP_MISSING: ' || p_chapter_number::text;
  end if;

  -- ── plotDebts.progress: append-only milestone ledger (single mutation
  -- owner). Duplicate milestone = double-advance → conflict (no DO NOTHING).
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'plotDebts'->'progress', '[]'::jsonb)
                     )
  loop
    begin
      insert into public.reader_plot_debt_progress (
        user_id, story_id, debt_id, milestone_chapter,
        progressed_at_chapter, source_job_id, progress_version
      ) values (
        p_user_id, p_story_id, v_item->>'debtId',
        (v_item->>'milestoneChapter')::integer, (v_item->>'milestoneChapter')::integer,
        p_source_job_id, 1
      );
    exception
      when unique_violation then
        raise exception using errcode = 'P0001',
          message = 'STATE_PROGRESS_CONFLICT: ' || v_item->>'debtId';
    end;
  end loop;

  -- ── plotDebts.closures: append-only closure ledger (single mutation
  -- owner). Duplicate closure = conflict (no DO NOTHING).
  for v_item in select value
                from pg_catalog.jsonb_array_elements(
                       coalesce(v_delta->'plotDebts'->'closures', '[]'::jsonb)
                     )
  loop
    begin
      insert into public.reader_plot_debt_closures (
        user_id, story_id, debt_id, closure_form,
        closed_at_chapter, closed_by_job_id, closure_version
      ) values (
        p_user_id, p_story_id, v_item->>'debtId', v_item->>'closureForm',
        p_chapter_number, p_source_job_id, 1
      );
    exception
      when unique_violation then
        raise exception using errcode = 'P0001',
          message = 'STATE_CLOSURE_CONFLICT: ' || v_item->>'debtId';
    end;
  end loop;
end;
$$;

revoke all on function public.apply_validated_chapter_state_v1(
  text, integer, bigint, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

comment on function public.apply_validated_chapter_state_v1(
  text, integer, bigint, uuid, uuid, jsonb
) is
  'Shared atomic state applier. SINGLE mutation owner for canonical tables + plot-debt ledgers. committed revision derived (base+1). No grants (DEFINER publishers only).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. publish_generation_job_chapter_v4 — forward redefinition
-- ──────────────────────────────────────────────────────────────────────────────
-- Two changes ONLY (v0 behavior otherwise identical):
-- 1. Corrected Phase-B lock order: S advisory → STORY FOR SHARE → capability
--    gate → R → J. Previously R was acquired BEFORE S (violating the global
--    "S before R / S before STORY" invariant) — the shared V5/V3 writers need
--    STORY before R so the canon revision read is serialized.
-- 2. DB-enforced V4/V5 disjointness: the STORY row is read FOR SHARE and the
--    capability gate runs BEFORE any R/J/L/C lock or mutation. Once a story
--    activates living canon (living_canon_version = 1), V4 fails fast with
--    LIVING_CANON_REQUIRES_V5 instead of half-publishing on a v1 story.
-- Everything else (closure canonicalization, dual-hash idempotency, contract
-- provenance, Phase F/G terminalization, inline hashing for byte-parity with
-- v0 history) is unchanged.

create or replace function public.publish_generation_job_chapter_v4(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_title text,
  p_paragraphs jsonb,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_ending_key text,
  p_ending_name text,
  p_closures jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_preflight public.generation_jobs%rowtype;
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_contract_row record;
  v_story_contract_version integer;
  v_expected_key text;
  v_expected_scope text;
  v_publisher_result jsonb;
  v_proof_result jsonb;
  v_proof_valid boolean := false;
  v_checkpoint_publish_result jsonb;
  v_result jsonb;
  v_replay_result jsonb;
  v_now timestamptz;
  v_started_at timestamptz;
  v_elapsed_ms bigint;
  v_has_ending_lock boolean;

  -- Closure canonicalization
  v_canonical_closures jsonb := '[]'::jsonb;
  v_closure_hash text;
  v_closure_item jsonb;
  v_sorted_debt_ids text[];
  v_seen_debt_ids text[];
  v_debt_id text;
  v_form text;
  v_pub_payload jsonb;
  v_pub_hash text;

  -- Closure validation
  v_debts jsonb;
  v_debt_obj jsonb;
  v_ledger_debts text[];
  v_effective_closed text[];
  v_ledger record;
  v_any_open boolean;
  v_main_mystery_closed boolean;
  v_conflict_detail text;

  v_is_personalized boolean;
begin
  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE A — Pre-read (unlocked, for lock key determination only)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- Reads job identity + generation_kind WITHOUT lock.
  -- Values are UNTRUSTED until re-verified under J lock in Phase C.

  -- Full row: fast path reads status, publication_result, and both hashes.
  select j.*
  into v_preflight
  from public.generation_jobs j
  where j.id = p_job_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  v_expected_key := 'generation-job:' || v_preflight.id::text || ':publish:' || v_preflight.chapter_number::text;
  if v_preflight.publication_idempotency_key is distinct from v_expected_key then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

  -- Canonicalize p_closures (deterministic). Must happen before fast path hash check.
  -- NULL is allowed (means "no closures"). Any non-null non-array is a payload error,
  -- never silently coerced to empty.
  if p_closures is null then
    v_canonical_closures := '[]'::jsonb;
  elsif jsonb_typeof(p_closures) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
  elsif jsonb_array_length(p_closures) = 0 then
    v_canonical_closures := '[]'::jsonb;
  else
    if jsonb_array_length(p_closures) > 20 then
      raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
    end if;

    v_sorted_debt_ids := array[]::text[];
    v_seen_debt_ids := array[]::text[];

    for v_closure_item in select value from jsonb_array_elements(p_closures) loop
      if jsonb_typeof(v_closure_item) <> 'object' then
        raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
      end if;
      -- Check exact keys
      if (select string_agg(k, ',' order by k) from jsonb_object_keys(v_closure_item) k) <> 'closureForm,debtId' then
        raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
      end if;
      v_debt_id := v_closure_item->>'debtId';
      v_form := v_closure_item->>'closureForm';
      if v_debt_id is null or pg_catalog.btrim(v_debt_id) = '' or pg_catalog.char_length(v_debt_id) > 100
        or v_debt_id <> pg_catalog.btrim(v_debt_id) then
        raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
      end if;
      if v_form is null or v_form not in ('RESOLVED','SUBVERTED','TRANSFORMED','ABANDONED') then
        raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
      end if;
      if v_debt_id = ANY(v_seen_debt_ids) then
        raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
      end if;
      v_seen_debt_ids := array_append(v_seen_debt_ids, v_debt_id);
      v_sorted_debt_ids := array_append(v_sorted_debt_ids, v_debt_id);
    end loop;

    -- Sort by debtId ascending.
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'closureForm', item.closureForm,
        'closedAtChapter', p_chapter_number,
        'debtId', item.debtId
      ) order by item.debtId
    ), '[]'::jsonb)
    into v_canonical_closures
    from (
      select
        (elem->>'debtId') as debtId,
        (elem->>'closureForm') as closureForm
      from jsonb_array_elements(p_closures) elem
      order by (elem->>'debtId')
    ) item;
  end if;

  -- Compute closure hash with domain prefix.
  v_closure_hash := encode(
    extensions.digest(
      'generation-plot-debt-closures-v1' || v_canonical_closures::text,
      'sha256'
    ),
    'hex'
  );

  -- Compute publication hash with full payload (domain prefix + all fields).
  v_pub_payload := pg_catalog.jsonb_build_object(
    'hashSchema', 'generation-publication-v1',
    'storyId', p_story_id,
    'chapterNumber', p_chapter_number,
    'title', p_title,
    'paragraphs', p_paragraphs,
    'choicePrompt', p_choice_prompt,
    'choices', p_choices,
    'outcomes', p_outcomes,
    'endingKey', p_ending_key,
    'endingName', p_ending_name
  );
  v_pub_hash := encode(
    extensions.digest(
      'generation-publication-v1' || v_pub_payload::text,
      'sha256'
    ),
    'hex'
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Idempotent success fast path (unlocked, with dual-hash verification).
  -- Hashes are now computed. If job already SUCCEEDED, verify hashes match.
  -- Match → cached success. Mismatch → IDEMPOTENCY_CONFLICT.
  -- NOTE: this is an optimization. Phase C rechecks under J FOR UPDATE.
  if v_preflight.status = 'SUCCEEDED' and v_preflight.publication_result is not null then
    if v_preflight.publication_payload_hash = v_pub_hash
      and v_preflight.closure_payload_hash = v_closure_hash
    then
      return v_preflight.publication_result;
    else
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE B — Lock acquisition (canonical global order, A1c.1 corrected)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- Pre-read gives us generation_kind, user_id, story_id (UNTRUSTED).
  -- Lock order (all modes):
  --   E1 → E2 (ending only) → S → STORY FOR SHARE → GATE → R (personalized)
  --   → J → L → C → CONTRACT (personalized) → COMMIT lookup → writes
  --
  -- E1 = ending advisory lock key 120713 (v4-specific ending serialization)
  -- E2 = ending advisory lock key 130600 (persist_ending_lock_v1 internal key)
  --      Acquired here (before L) so persist_ending_lock_v1 re-enters reentrantly.
  -- S  = story advisory lock (hashtextextended(story_id, 120712)) — BEFORE the
  --      story row lock, so V3/V5 (which lock the story row FOR UPDATE) never
  --      see a half-incremented revision from a concurrent publisher.
  -- STORY FOR SHARE = capability gate source (stable against v0→v1 activation).
  -- R  = reader_states SELECT ... FOR UPDATE (personalized only)
  -- J  = generation_jobs SELECT ... FOR UPDATE
  -- L  = generation_leases SELECT ... FOR UPDATE
  --
  -- publish_chapter_v2 does NOT touch reader_states → R skipped for standard.
  -- persist_ending_lock_v1 is called in Phase F (after all fencing).
  -- It re-enters E2 (key 130600) reentrantly — no new lock acquisition.

  if (p_ending_key is null) is distinct from (p_ending_name is null) then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_PAYLOAD';
  end if;

  v_has_ending_lock := p_ending_key is not null;
  if v_has_ending_lock then
    if p_ending_key = ''
      or p_ending_key <> pg_catalog.btrim(p_ending_key)
      or pg_catalog.char_length(p_ending_key) > 80
      or p_ending_key ~ '[[:cntrl:]]'
      or p_ending_name = ''
      or p_ending_name <> pg_catalog.btrim(p_ending_name)
      or pg_catalog.char_length(p_ending_name) > 160
      or p_ending_name ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_PAYLOAD';
    end if;
    if v_preflight.generation_kind is distinct from 'personalized'
      or v_preflight.chapter_number is distinct from 45 then
      raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_TARGET';
    end if;
  end if;

  if v_preflight.generation_kind = 'personalized' then
    if v_has_ending_lock then
      -- E1: ending advisory lock (v4-specific, key 120713).
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_preflight.story_id || ':ending:' || v_preflight.user_id::text, 120713)
      );
      -- E2: ending advisory lock (persist_ending_lock_v1 internal key 130600).
      -- Acquired here so persist_ending_lock_v1 re-enters reentrantly (same tx).
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_preflight.story_id || ':' || v_preflight.user_id::text, 130600)
      );
    end if;
  end if;

  -- S: story advisory lock (all modes) — BEFORE the story row lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_preflight.story_id, 120712)
  );

  -- STORY FOR SHARE + living-canon capability gate (before R/J/L/C).
  -- V4 is the LEGACY v0 publisher: once a story activates living canon
  -- (living_canon_version = 1) the V4 path fails fast here, BEFORE any
  -- R/J/L/C row lock or mutation — V5 owns that story from that point on.
  declare
    v_gate_story_id text;
    v_gate_living_canon_version smallint;
  begin
    select s.id, s.living_canon_version
      into v_gate_story_id, v_gate_living_canon_version
    from public.stories s
    where s.id = v_preflight.story_id
    for share;

    if not found then
      raise exception using errcode = '23503', message = 'STORY_NOT_FOUND';
    end if;
    if v_gate_living_canon_version <> 0 then
      raise exception using errcode = 'P0001', message = 'LIVING_CANON_REQUIRES_V5';
    end if;
  end;

  if v_preflight.generation_kind = 'personalized' then
    -- R: reader_states SELECT ... FOR UPDATE (serialized, all personalized paths).
    -- Acquired AFTER S + STORY (global invariant: STORY before R).
    perform 1 from public.reader_states rs
    where rs.user_id = v_preflight.user_id
      and rs.story_id = v_preflight.story_id
    for update;
  end if;

  -- J: generation_jobs FOR UPDATE (all modes).
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE C — Locked recheck + idempotency (ALL modes)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Identity recheck (pre-read was UNTRUSTED).
  v_expected_key := 'generation-job:' || v_job.id::text || ':publish:' || v_job.chapter_number::text;
  if v_job.publication_idempotency_key is distinct from v_expected_key then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;
  if v_job.generation_kind is distinct from v_preflight.generation_kind then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_TARGET_MISMATCH';
  end if;

  -- SUCCEEDED recheck (idempotent replay via dual hash).
  if v_job.status = 'SUCCEEDED' and v_job.publication_result is not null then
    if v_job.publication_payload_hash = v_pub_hash
      and v_job.closure_payload_hash = v_closure_hash
    then
      return v_job.publication_result;
    else
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  -- Ownership + runtime validation.
  if v_job.status <> 'RUNNING' then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_RUNNING';
  end if;
  if v_job.story_id is distinct from v_preflight.story_id
    or v_job.user_id is distinct from v_preflight.user_id
    or v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_TARGET_MISMATCH';
  end if;
  if v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_OWNERSHIP_LOST';
  end if;
  if v_job.deadline_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_DEADLINE_EXCEEDED';
  end if;
  if v_has_ending_lock and (
    v_job.generation_kind is distinct from 'personalized'
    or v_job.chapter_number is distinct from 45
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_TARGET';
  end if;

  -- L: lease lock.
  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found
    or v_lease.job_id is distinct from v_job.id
    or v_lease.claim_token is distinct from v_job.claim_token
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or v_lease.holder is distinct from v_job.worker_id
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  v_is_personalized := v_job.generation_kind = 'personalized';

  -- Bind every worker mode to the exact schema-V2 checkpoint.
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = v_job.id
    and c.job_id = v_job.id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_checkpoint.checkpoint_schema_version <> 2
    or v_checkpoint.correlation_id is distinct from v_job.correlation_id
    or v_checkpoint.generation_mode is distinct from v_job.generation_kind
    or v_checkpoint.status not in ('PROSE_READY','RUNNING_CHOICES','READY_TO_PUBLISH','PUBLISHED')
  then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_checkpoint.job_attempt_number > v_job.attempt_count then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Standard branch: closures forbidden, no contract/closure validation.
  -- plpgsql has no GOTO; personalized validation is guarded by v_is_personalized
  -- and Phase F/G runs for both modes below.
  -- ═══════════════════════════════════════════════════════════════════════════

  if not v_is_personalized then
    if v_checkpoint.audit_signals_json is not null
      or v_checkpoint.audit_signals_version is not null then
      raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
    end if;
    if jsonb_array_length(v_canonical_closures) > 0 then
      raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
    end if;
  else
  -- ═══════════════════════════════════════════════════════════════════════════
  -- Personalized branch: contract provenance + closure validation
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Contract provenance: job must have version.
  if v_job.story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'CONTRACT_PROVENANCE_MISSING';
  end if;

  -- Common checkpoint binding above established exact identity and provenance.
  if v_checkpoint.status not in ('PROSE_READY','RUNNING_CHOICES','READY_TO_PUBLISH','PUBLISHED') then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;
  if v_checkpoint.audit_signals_version is distinct from 2
    or not public.is_valid_checkpoint_audit_signals_v2(v_checkpoint.audit_signals_json) then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;

  -- Version provenance: job = checkpoint = story.
  if v_checkpoint.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  select s.story_contract_version into v_story_contract_version
  from public.stories s
  where s.id = v_job.story_id;

  if v_story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  -- Closure payload must match checkpoint audit signals EXACTLY, including the
  -- empty case (an empty caller set must not publish a checkpoint that carries
  -- closures, and vice versa). Both sides are canonicalized to the identical
  -- {closureForm,debtId} shape sorted by debtId; closedAtChapter (present only on
  -- the ledger-facing canonical set) is stripped before comparison.
  declare
    v_caller_closure_shape jsonb;
    v_checkpoint_closure_shape jsonb;
  begin
    select coalesce(jsonb_agg(
      jsonb_build_object('closureForm', item.closureForm, 'debtId', item.debtId)
      order by item.debtId
    ), '[]'::jsonb)
    into v_caller_closure_shape
    from (
      select elem->>'debtId' as debtId, elem->>'closureForm' as closureForm
      from jsonb_array_elements(v_canonical_closures) elem
    ) item;

    select coalesce(jsonb_agg(
      jsonb_build_object('closureForm', item.closureForm, 'debtId', item.debtId)
      order by item.debtId
    ), '[]'::jsonb)
    into v_checkpoint_closure_shape
    from (
      select elem->>'debtId' as debtId, elem->>'closureForm' as closureForm
      from jsonb_array_elements(
        coalesce(v_checkpoint.audit_signals_json->'closesPlotDebts', '[]'::jsonb)
      ) elem
    ) item;

    if v_caller_closure_shape is distinct from v_checkpoint_closure_shape then
      raise exception using errcode = 'P0001', message = 'CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH';
    end if;
  end;

  -- Load contract (single mutable row per story).
  select plot_debts_json, story_contract_version
  into v_contract_row
  from public.story_generation_contracts
  where story_id = v_job.story_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEBT_CONTRACT_NOT_FOUND';
  end if;

  if v_contract_row.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  if v_contract_row.plot_debts_json is null
    or jsonb_typeof(v_contract_row.plot_debts_json) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'DEBT_CONTRACT_INVALID';
  end if;

  -- Load existing ledger.
  select coalesce(array_agg(debt_id), array[]::text[]) into v_ledger_debts
  from public.reader_plot_debt_closures
  where user_id = v_job.user_id and story_id = v_job.story_id;

  -- Validate each closure in canonical set.
  for v_closure_item in select value from jsonb_array_elements(v_canonical_closures) loop
    v_debt_id := v_closure_item->>'debtId';
    v_form := v_closure_item->>'closureForm';

    -- Debt exists in contract.
    select elem into v_debt_obj
    from jsonb_array_elements(v_contract_row.plot_debts_json) elem
    where elem->>'id' = v_debt_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_UNKNOWN_DEBT';
    end if;

    -- Chapter >= introducedAt (eligible by chapter).
    if p_chapter_number < (v_debt_obj->>'introducedAt')::integer then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_NOT_INTRODUCED';
    end if;

    -- ABANDONED not allowed for main_mystery.
    if v_debt_id = 'main_mystery' and v_form = 'ABANDONED' then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_ABANDONED_MAIN_MYSTERY';
    end if;

    -- Chapter <= mustCloseBy (proposal deadline).
    if p_chapter_number > (v_debt_obj->>'mustCloseBy')::integer then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_DEADLINE_VIOLATION';
    end if;

    -- Not already closed in ledger.
    if v_debt_id = ANY(v_ledger_debts) then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_CONFLICT';
    end if;
  end loop;

  -- Validate closure omission (effective closed = ledger + proposed).
  v_effective_closed := v_ledger_debts;
  for v_closure_item in select value from jsonb_array_elements(v_canonical_closures) loop
    v_effective_closed := array_append(v_effective_closed, v_closure_item->>'debtId');
  end loop;

  -- Omission checks (precedence: ch50 > ch48 > deadline).
  if p_chapter_number = 50 then
    v_any_open := false;
    for v_debt_obj in select value from jsonb_array_elements(v_contract_row.plot_debts_json) loop
      if not (v_debt_obj->>'id') = ANY(v_effective_closed) then
        v_any_open := true;
        exit;
      end if;
    end loop;
    if v_any_open then
      raise exception using errcode = 'P0001', message = 'OPEN_DEBT_AT_END';
    end if;
  end if;

  if p_chapter_number >= 48 then
    v_main_mystery_closed := false;
    for v_debt_obj in select value from jsonb_array_elements(v_contract_row.plot_debts_json) loop
      if v_debt_obj->>'id' = 'main_mystery' and (v_debt_obj->>'id') = ANY(v_effective_closed) then
        v_main_mystery_closed := true;
        exit;
      end if;
    end loop;
    if not v_main_mystery_closed then
      raise exception using errcode = 'P0001', message = 'MAIN_MYSTERY_UNRESOLVED';
    end if;
  end if;

  -- Deadline omission: any debt where mustCloseBy <= chapter and not closed.
  for v_debt_obj in select value from jsonb_array_elements(v_contract_row.plot_debts_json) loop
    if p_chapter_number >= (v_debt_obj->>'mustCloseBy')::integer
      and not (v_debt_obj->>'id') = ANY(v_effective_closed)
    then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_DEADLINE_VIOLATION';
    end if;
  end loop;

  end if;  -- end personalized validation branch

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE F — Publication (after all fencing validated)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- E1 (key 120713) + E2 (key 130600) + R were acquired in Phase B.
  -- persist_ending_lock_v1 re-enters E2 (key 130600) REENTRANTLY:
  --   - Uses pg_advisory_xact_lock (transaction-scoped, not session).
  --   - Key 130600 is byte-for-byte identical to E2 acquired in Phase B.
  --   - Same transaction and same PostgreSQL connection.
  --   - PostgreSQL increments lock count (no blocking, no new lock).
  --   - persist_ending_lock_v1 does NOT acquire advisory/row locks beyond E2.
  -- All mutations (ending lock, chapter, closures) rollback if later fails.

  if v_has_ending_lock then
    perform public.persist_ending_lock_v1(
      v_job.user_id, v_job.story_id, p_ending_key, p_ending_name, v_job.chapter_number
    );
  end if;

  -- Chapter publication (V2, idempotent via idempotency_key).
  v_publisher_result := public.publish_chapter_v2(
    v_job.story_id, v_job.chapter_number,
    p_title, p_paragraphs, p_choice_prompt, p_choices, p_outcomes,
    p_lease_id, v_job.publication_idempotency_key
  );

  -- Verify publication proof.
  v_expected_scope := 'publish_chapter_v2:' || v_job.chapter_number::text;
  select i.result,
         pg_catalog.jsonb_typeof(i.result) = 'object'
           and i.result @> '{"ok":true}'::jsonb
           and case
                 when pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
                 then (i.result->>'chapter_number')::numeric = v_job.chapter_number
                 else false
               end
  into v_proof_result, v_proof_valid
  from public.idempotency_keys i
  where i.key = v_job.publication_idempotency_key
    and i.story_id = v_job.story_id
    and i.scope = v_expected_scope;

  if not coalesce(v_proof_valid, false)
    or v_publisher_result is distinct from v_proof_result
    or not exists (
      select 1 from public.chapters c
      where c.story_id = v_job.story_id and c.number = v_job.chapter_number
    )
  then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE G — Ledger + terminalize (still under fencing)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Insert closure records (only for personalized mode with closures).
  if v_is_personalized and jsonb_array_length(v_canonical_closures) > 0 then
    for v_closure_item in select value from jsonb_array_elements(v_canonical_closures) loop
      insert into public.reader_plot_debt_closures (
        user_id, story_id, debt_id, closure_form,
        closed_at_chapter, closed_by_job_id
      ) values (
        v_job.user_id, v_job.story_id,
        v_closure_item->>'debtId', v_closure_item->>'closureForm',
        p_chapter_number, v_job.id
      )
      on conflict (user_id, story_id, debt_id) do nothing;
    end loop;
  end if;

  -- publish_chapter_v2 releases its lease after inserting publication rows. Restore
  -- ACTIVE under the already-held lease lock so checkpoint terminalization requires
  -- live fencing; final RELEASED remains the last terminal tuple mutation below.
  update public.generation_leases l
  set status = 'ACTIVE'
  where l.id = p_lease_id
    and l.job_id = v_job.id
    and l.claim_token = v_job.claim_token
    and l.story_id = v_job.story_id
    and l.chapter_number = v_job.chapter_number
    and l.holder = v_job.worker_id
    and l.status = 'RELEASED';

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  -- Checkpoint → PUBLISHED while job is RUNNING and lease is ACTIVE.
  v_checkpoint_publish_result := public.transition_checkpoint_published_atomic_v4(
      v_job.id, v_job.worker_id, v_job.claim_token, p_lease_id,
      v_job.story_id, v_job.chapter_number
    );
  if v_checkpoint_publish_result->>'ok' is distinct from 'true'
    or v_checkpoint_publish_result->>'result' is distinct from 'UPDATED' then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_PUBLISH_FAILED: ' || v_checkpoint_publish_result::text;
  end if;

  -- Job → SUCCEEDED + publication_result + both hashes.
  v_now := pg_catalog.clock_timestamp();
  v_started_at := coalesce(v_job.claimed_at, v_now);
  v_elapsed_ms := greatest(
    0,
    pg_catalog.floor(extract(epoch from (v_now - v_started_at)) * 1000)::bigint
  );
  v_result := v_publisher_result || pg_catalog.jsonb_build_object('jobId', v_job.id);

  update public.generation_jobs
  set status = 'SUCCEEDED',
      publication_result = v_result,
      publication_payload_hash = v_pub_hash,
      closure_payload_hash = v_closure_hash,
      last_error_code = null,
      last_error_class = null,
      last_error_at = null
  where id = v_job.id;

  insert into public.generation_job_attempts (
    job_id, correlation_id, story_id, chapter_number, attempt_number,
    workflow_phase, started_at, ended_at, elapsed_ms, retry_decision,
    error_code, worker_id
  ) values (
    v_job.id, v_job.correlation_id, v_job.story_id, v_job.chapter_number,
    v_job.attempt_count, 'PUBLICATION_SUCCEEDED', v_started_at, v_now,
    v_elapsed_ms, null, null, v_job.worker_id
  );

  -- Lease → RELEASED (after checkpoint and job terminalized).
  update public.generation_leases l
  set status = 'RELEASED'
  where l.id = p_lease_id
    and l.job_id = v_job.id
    and l.claim_token = v_job.claim_token
    and l.story_id = v_job.story_id
    and l.chapter_number = v_job.chapter_number
    and l.holder = v_job.worker_id
    and l.status = 'ACTIVE';

  if not exists (
    select 1 from public.generation_leases l
    where l.id = p_lease_id
      and l.job_id = v_job.id
      and l.claim_token = v_job.claim_token
      and l.story_id = v_job.story_id
      and l.chapter_number = v_job.chapter_number
      and l.holder = v_job.worker_id
      and l.status = 'RELEASED'
  ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_generation_job_chapter_v4(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.publish_generation_job_chapter_v4(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb
) to service_role;

comment on function public.publish_generation_job_chapter_v4(
  uuid,text,uuid,uuid,text,integer,text,jsonb,text,jsonb,jsonb,text,text,jsonb
) is
  'V0 worker publisher (A1c.1 redefinition). Corrected lock order S→STORY SHARE→gate→R→J; LIVING_CANON_REQUIRES_V5 gate before R/J/L/C on v1 stories. V0 behavior otherwise identical.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. upsert_generation_checkpoint_sync_v1() — sync (server-only) checkpoint
--    writer
-- ──────────────────────────────────────────────────────────────────────────────
-- Counterpart of upsert_generation_checkpoint_fenced_v2 for the SYNC path
-- (living canon published by the runtime itself, no generation job, no lease).
-- Differences from the fenced V2 writer:
--   * attempt_id comes from the CALLER (p_checkpoint_attempt_id), created ONCE
--     by the sync generation attempt and reused for retries of that attempt —
--     the DB never mints attempt identity.
--   * correlation_id comes from the CALLER too; (attempt, correlation) is the
--     sync replay identity: the same attempt-run with the same correlation id
--     replays the same checkpoint row; a different attempt id for the same
--     correlation is provenance breaking.
--   * job_id/job_attempt_number stay NULL (no job exists).
--   * no lease, no claim token.
-- Actor binding: the writer requires the locked story to be owned by
-- p_user_id with an existing reader_state for (user, story) — the sync path
-- is private/personalized only.
-- Locks: S advisory (120712) + STORY FOR SHARE — the revision gate reads
-- stories.canon_state_revision consistently and blocks no publisher.
-- Gates mirror the fenced writer: LIVING_CANON_NOT_ACTIVE (v0 story),
-- STALE_CANON_REVISION, BASE_CANON_AHEAD; DB-computed delta hash; audit
-- signals validated (v1/v2 shape, constraint chapter_generation_checkpoints_
-- audit_signals_check re-derives it at insert).

create or replace function public.upsert_generation_checkpoint_sync_v1(
  p_story_id text,
  p_chapter_number integer,
  p_user_id uuid,
  p_checkpoint_attempt_id uuid,
  p_correlation_id uuid,
  p_title text,
  p_paragraphs jsonb,
  p_prose_fingerprint text,
  p_audit_signals jsonb,
  p_audit_signals_version integer,
  p_canon_version bigint,
  p_blueprint_version bigint,
  p_direction_fingerprint text,
  p_generation_policy_version integer,
  p_prompt_contract_version integer,
  p_state_delta_json jsonb,
  p_base_canon_revision bigint
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_story_id text;
  v_living_canon_version smallint;
  v_canon_state_revision bigint;
  v_story_contract_version integer;
  v_story_owner_user_id uuid;
  v_story_visibility text;
  v_story_mode text;
  v_state_delta_hash text;
  v_attempt_id uuid;
  v_existing public.chapter_generation_checkpoints%rowtype;
  v_paragraph_count integer;
begin
  -- Identity must be canonical before it participates in locks or lookups.
  -- The attempt id is caller-produced ONCE per sync attempt-run (never minted
  -- here) and is the replay identity alongside the correlation id.
  if p_story_id is null or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200
    or p_chapter_number is null or p_chapter_number not between 1 and 50
    or p_user_id is null
    or p_checkpoint_attempt_id is null
    or p_correlation_id is null then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_IDENTITY';
  end if;

  -- State delta payload validation (format errors raise before state checks).
  if p_state_delta_json is null
    or pg_catalog.jsonb_typeof(p_state_delta_json) <> 'object'
    or pg_catalog.pg_column_size(p_state_delta_json) > 1000000
    or p_base_canon_revision is null or p_base_canon_revision < 0 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Hash is computed by the database; callers can never supply it.
  v_state_delta_hash := public.chapter_state_delta_hash_v1(p_state_delta_json);

  -- S: story advisory lock (reentrant with the V3 publisher and V2 writers).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id, 120712)
  );

  -- STORY FOR SHARE: capability + exact base revision + owner binding, read
  -- consistently.
  select s.id, s.living_canon_version, s.canon_state_revision, s.story_contract_version,
         s.owner_user_id, s.visibility, s.story_mode
    into v_story_id, v_living_canon_version, v_canon_state_revision, v_story_contract_version,
         v_story_owner_user_id, v_story_visibility, v_story_mode
  from public.stories s
  where s.id = p_story_id
  for share;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;
  if v_living_canon_version <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LIVING_CANON_NOT_ACTIVE');
  end if;

  -- Actor binding (sync path is private/personalized_ai only — R2-H2): the
  -- locked story must be owned by p_user_id, private, personalized, and have
  -- an existing reader_state for (user, story). Any mismatch is provenance
  -- conflict — the writer never writes checkpoints for foreign, non-private,
  -- or non-personalized stories.
  if v_story_owner_user_id is distinct from p_user_id
    or v_story_visibility is distinct from 'private'
    or v_story_mode is distinct from 'personalized_ai' then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;
  perform 1 from public.reader_states rs
  where rs.user_id = p_user_id
    and rs.story_id = p_story_id;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  if p_base_canon_revision < v_canon_state_revision then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'STALE_CANON_REVISION');
  end if;
  if p_base_canon_revision > v_canon_state_revision then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'BASE_CANON_AHEAD');
  end if;

  -- Payload validation (mirror of the fenced V2 writer, minus job/lease).
  if p_title is null or pg_catalog.btrim(p_title) = '' or pg_catalog.length(p_title) > 500
    or p_paragraphs is null or pg_catalog.jsonb_typeof(p_paragraphs) <> 'array'
    or p_prose_fingerprint is null or pg_catalog.btrim(p_prose_fingerprint) = ''
    or pg_catalog.length(p_prose_fingerprint) > 256
    or p_canon_version is null or p_canon_version < 0
    or p_blueprint_version is null or p_blueprint_version < 0
    or p_direction_fingerprint is null or pg_catalog.btrim(p_direction_fingerprint) = ''
    or pg_catalog.length(p_direction_fingerprint) > 256
    or p_generation_policy_version is null or p_generation_policy_version < 1
    or p_prompt_contract_version is null or p_prompt_contract_version < 1 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Audit signals: sync checkpoints must carry valid signals (the table
  -- constraint re-derives validity at insert; validating here keeps the
  -- return contract {ok:false,result} instead of an exception).
  if p_audit_signals is null or p_audit_signals_version is null then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;
  if p_audit_signals_version = 1 then
    if pg_catalog.jsonb_typeof(p_audit_signals) <> 'object'
      or p_audit_signals - 'opensNewThread' - 'opensMajorMystery' - 'opensNewConflict' <> '{}'::jsonb
      or not (p_audit_signals ?& array['opensNewThread','opensMajorMystery','opensNewConflict'])
      or pg_catalog.jsonb_typeof(p_audit_signals->'opensNewThread') <> 'boolean'
      or pg_catalog.jsonb_typeof(p_audit_signals->'opensMajorMystery') <> 'boolean'
      or pg_catalog.jsonb_typeof(p_audit_signals->'opensNewConflict') <> 'boolean'
    then
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
  elsif p_audit_signals_version = 2 then
    if not public.is_valid_checkpoint_audit_signals_v2(p_audit_signals) then
      raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
    end if;
  else
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Paragraph validation.
  select pg_catalog.count(*)::integer into v_paragraph_count
  from pg_catalog.jsonb_array_elements(p_paragraphs) paragraph
  where pg_catalog.jsonb_typeof(paragraph) = 'string'
    and pg_catalog.btrim(paragraph #>> '{}') <> ''
    and pg_catalog.length(paragraph #>> '{}') <= 20000;
  if v_paragraph_count = 0
    or v_paragraph_count <> pg_catalog.jsonb_array_length(p_paragraphs)
    or pg_catalog.pg_column_size(p_paragraphs) > 1000000 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- Replay identity: a retry of the same sync attempt-run (same attempt id +
  -- same correlation id) must bind to the SAME checkpoint row. The pair
  -- (story, chapter, attempt_id) is the row identity and the correlation the
  -- attempt-run identity — replay requires BOTH to match (R2-H1, symmetric):
  -- a row found under exactly one of them is provenance confusion and must
  -- never be reused or silently duplicated.
  select c.* into v_existing
  from public.chapter_generation_checkpoints c
  where c.story_id = p_story_id
    and c.chapter_number = p_chapter_number
    and c.attempt_id = p_checkpoint_attempt_id
    and c.correlation_id = p_correlation_id
  for update;

  if found then
    if v_existing.attempt_id is distinct from p_checkpoint_attempt_id
      or v_existing.checkpoint_schema_version <> 3
      or v_existing.correlation_id is distinct from p_correlation_id
      or v_existing.prose_fingerprint is distinct from p_prose_fingerprint
      or v_existing.audit_signals_json is distinct from p_audit_signals
      or v_existing.audit_signals_version is distinct from p_audit_signals_version
      or v_existing.canon_version is distinct from p_canon_version
      or v_existing.blueprint_version is distinct from p_blueprint_version
      or v_existing.direction_fingerprint is distinct from p_direction_fingerprint
      or v_existing.generation_mode is distinct from 'personalized'
      or v_existing.generation_policy_version is distinct from p_generation_policy_version
      or v_existing.prompt_contract_version is distinct from p_prompt_contract_version
      -- Delta provenance binds json + base revision: same JSON with a
      -- different base is NOT an identical replay.
      or v_existing.state_delta_json is distinct from p_state_delta_json
      or v_existing.state_delta_schema_version is distinct from 1
      or v_existing.base_canon_revision is distinct from p_base_canon_revision then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
    end if;
    if v_existing.status <> 'PROSE_READY' then
      return pg_catalog.jsonb_build_object('ok', false, 'result', 'INVALID_TRANSITION');
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true, 'result', 'UPDATED', 'changed', false,
      'checkpoint_attempt_id', v_existing.attempt_id,
      'checkpoint', pg_catalog.to_jsonb(v_existing)
    );
  end if;

  -- Symmetric provenance fence: an existing row under the SAME attempt with a
  -- DIFFERENT correlation (or under the SAME correlation with a DIFFERENT
  -- attempt) is provenance confusion — the caller is reusing one half of a
  -- foreign identity. Fail closed instead of surfacing a raw PK violation.
  if exists (
    select 1 from public.chapter_generation_checkpoints c
    where c.story_id = p_story_id
      and c.chapter_number = p_chapter_number
      and c.attempt_id = p_checkpoint_attempt_id
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;
  if exists (
    select 1 from public.chapter_generation_checkpoints c
    where c.story_id = p_story_id
      and c.chapter_number = p_chapter_number
      and c.correlation_id = p_correlation_id
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  -- Caller-produced attempt id (never minted by the DB — the sync generation
  -- attempt owns its identity and reuses it for retries).
  v_attempt_id := p_checkpoint_attempt_id;

  insert into public.chapter_generation_checkpoints (
    story_id, chapter_number, attempt_id, correlation_id, status,
    title, paragraphs_json, prose_fingerprint, audit_signals_json, audit_signals_version,
    canon_version, blueprint_version,
    direction_fingerprint, generation_mode, generation_policy_version,
    prompt_contract_version, job_id, job_attempt_number,
    checkpoint_schema_version, prose_attempt_count, choice_attempt_count, expires_at,
    story_contract_version,
    state_delta_json, state_delta_schema_version, state_delta_hash, base_canon_revision
  ) values (
    p_story_id, p_chapter_number, v_attempt_id, p_correlation_id,
    'PROSE_READY', p_title, p_paragraphs, p_prose_fingerprint,
    p_audit_signals, p_audit_signals_version, p_canon_version, p_blueprint_version,
    p_direction_fingerprint, 'personalized', p_generation_policy_version,
    p_prompt_contract_version,
    null, null, 3, 0, 0,
    pg_catalog.clock_timestamp() + interval '24 hours',
    v_story_contract_version,
    p_state_delta_json, 1, v_state_delta_hash, p_base_canon_revision
  )
  returning * into v_existing;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'result', 'UPDATED', 'changed', true,
    'checkpoint_attempt_id', v_existing.attempt_id,
    'checkpoint', pg_catalog.to_jsonb(v_existing)
  );
end;
$$;

revoke all on function public.upsert_generation_checkpoint_sync_v1(
  text, integer, uuid, uuid, uuid, text, jsonb, text, jsonb, integer, bigint, bigint, text, integer, integer, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.upsert_generation_checkpoint_sync_v1(
  text, integer, uuid, uuid, uuid, text, jsonb, text, jsonb, integer, bigint, bigint, text, integer, integer, jsonb, bigint
) to service_role;

comment on function public.upsert_generation_checkpoint_sync_v1(
  text, integer, uuid, uuid, uuid, text, jsonb, text, jsonb, integer, bigint, bigint, text, integer, integer, jsonb, bigint
) is
  'Sync living-canon checkpoint writer (outer authority — service_role only). Caller mints attempt + correlation once per attempt-run; DB validates exact provenance. No job/lease. Owner+reader bound.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. publish_chapter_state_v3() — sync publisher
-- ──────────────────────────────────────────────────────────────────────────────
-- Sync-path atomic living-canon publication. The runtime (A1d) already holds
-- an ACTIVE sync lease it acquired itself; V3 NEVER creates a lease and ONLY
-- accepts a sync lease (job_id IS NULL AND claim_token IS NULL) — a
-- worker-owned lease is fenced with GENERATION_JOB_LEASE_INVALID.
-- Lock order (final):
--   E1 → E2 (ending only) → S(120712) → STORY FOR UPDATE → R → replay fast
--   path (read-only) → L → C → CONTRACT (FOR SHARE) → writes
-- Invariants: S before STORY, STORY before R, STORY before L, L before C.
--
-- CHECKPOINT AUTHORITY: canonical state + prose come from the locked
-- checkpoint ONLY — the caller supplies no state_delta_json/title/paragraphs
-- (invariant: publisher never chooses/compares caller A vs checkpoint B).
-- Replay hashes are computed FROM the checkpoint, first from an unlocked
-- pre-read (after R, before L) so the 13-field replay short-circuits before
-- the lease gate; after C locks the row, everything is re-derived from the
-- LOCKED checkpoint and the pre-read is re-verified.
-- Serialization is the story row + advisory S (every writer/publisher passes
-- through both), so the pre-read cannot drift under us.
--
-- Replay state machine (shared evaluator lookup_chapter_commit_replay_v1):
--   NO_COMMIT     → require exact base → validate → publish → apply → commit
--   EXACT_REPLAY  → return stored publication_result, no re-apply
--   CONFLICT      → raise PUBLICATION_CONFLICT
-- A CHAPTER_EXISTS return from publish_chapter_v2 (chapter exists without a
-- commit) is ALSO a PUBLICATION_CONFLICT: V2 returns ok:false instead of
-- raising, and the outer publisher must NOT continue into applier/commit/
-- revision increment.
--
-- Actor binding: locked story owner_user_id must equal p_user_id and the
-- reader_state for (user, story) must exist (private personalized sync path).
--
-- Commit provenance: actor_user_id = p_user_id, source_job_id = NULL (sync
-- has no generation job), correlation from the locked checkpoint, publication
-- payload hash DB-computed via chapter_publication_payload_hash_v1.
-- Closure/progress ledger rows are written ONLY by the shared applier.
-- After publish_chapter_v2 releases the lease (RELEASED) the lease stays
-- RELEASED — no second ACTIVE→RELEASED transition is required or attempted.

create or replace function public.publish_chapter_state_v3(
  p_story_id text,
  p_chapter_number integer,
  p_user_id uuid,
  p_lease_id uuid,
  p_checkpoint_attempt_id uuid,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_ending_key text,
  p_ending_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_story public.stories%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_pre_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_contract_row record;
  v_base_canon_revision bigint;
  v_committed_canon_revision bigint;
  v_state_delta_hash text;
  v_pub_hash text;
  v_replay_base bigint;
  v_has_ending_lock boolean;
  v_sync_key text;
  v_publisher_result jsonb;
  v_proof_result jsonb;
  v_proof_valid boolean := false;
  v_expected_scope text;
  v_replay jsonb;
  v_seq integer;
  v_result jsonb;
begin
  -- Identity must be canonical before it participates in locks or key lookup.
  if p_story_id is null or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200
    or p_chapter_number is null or p_chapter_number not between 1 and 50
    or p_user_id is null
    or p_lease_id is null
    or p_checkpoint_attempt_id is null then
    raise exception using errcode = '22023', message = 'INVALID_PUBLICATION_IDENTITY';
  end if;

  -- Ending lock payload: both or neither; sync endings exist only on ch45.
  if (p_ending_key is null) is distinct from (p_ending_name is null) then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_PAYLOAD';
  end if;
  v_has_ending_lock := p_ending_key is not null;
  if v_has_ending_lock then
    if p_ending_key = ''
      or p_ending_key <> pg_catalog.btrim(p_ending_key)
      or pg_catalog.char_length(p_ending_key) > 80
      or p_ending_key ~ '[[:cntrl:]]'
      or p_ending_name = ''
      or p_ending_name <> pg_catalog.btrim(p_ending_name)
      or pg_catalog.char_length(p_ending_name) > 160
      or p_ending_name ~ '[[:cntrl:]]'
      or p_chapter_number is distinct from 45 then
      raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_TARGET';
    end if;
    -- E1: sync ending advisory lock (key 120713, same domain as worker path).
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_story_id || ':ending:' || p_user_id::text, 120713)
    );
    -- E2: ending advisory lock (persist_ending_lock_v1 internal key 130600).
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_story_id || ':' || p_user_id::text, 130600)
    );
  end if;

  -- S: story advisory lock — BEFORE the story row lock (all publishers).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id, 120712)
  );

  -- STORY FOR UPDATE: capability + canonical revision + owner binding
  -- (serialized).
  select s.* into v_story
  from public.stories s
  where s.id = p_story_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'STORY_NOT_FOUND';
  end if;
  if v_story.living_canon_version <> 1 then
    raise exception using errcode = 'P0001', message = 'LIVING_CANON_NOT_ACTIVE';
  end if;
  -- Actor binding (R2-H2, symmetric to the sync writer): the sync publisher
  -- serves only stories owned by p_user_id AND private AND personalized_ai.
  if v_story.owner_user_id is distinct from p_user_id
    or v_story.visibility is distinct from 'private'
    or v_story.story_mode is distinct from 'personalized_ai' then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  v_base_canon_revision := v_story.canon_state_revision;

  -- R: reader_states FOR UPDATE. The actor must be a real reader of this
  -- story; the locked row is the serialization point for the reader.
  perform 1 from public.reader_states rs
  where rs.user_id = p_user_id
    and rs.story_id = p_story_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'READER_STATE_MISSING';
  end if;

  -- PRE-READ checkpoint by exact attempt (NO row lock — the STORY FOR UPDATE
  -- held above serializes every checkpoint writer: all of them pass through
  -- the S advisory + the STORY row first). The checkpoint is the ONLY source
  -- of canonical state and prose; the caller supplies nothing here.
  select c.* into v_pre_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = p_story_id
    and c.chapter_number = p_chapter_number
    and c.attempt_id = p_checkpoint_attempt_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_pre_checkpoint.checkpoint_schema_version <> 3
    or v_pre_checkpoint.correlation_id is null
    or v_pre_checkpoint.generation_mode is distinct from 'personalized'
    or v_pre_checkpoint.state_delta_json is null
    or v_pre_checkpoint.state_delta_schema_version is distinct from 1
    or v_pre_checkpoint.title is null
    or v_pre_checkpoint.paragraphs_json is null
    or v_pre_checkpoint.status not in ('PROSE_READY','RUNNING_CHOICES','READY_TO_PUBLISH','PUBLISHED')
    -- Domain separation (R2-B2): the sync path publishes ONLY sync checkpoints
    -- (job_id IS NULL AND job_attempt_number IS NULL) — symmetric to V5's
    -- exact job binding. A worker-owned checkpoint is never publishable by V3.
    or v_pre_checkpoint.job_id is not null
    or v_pre_checkpoint.job_attempt_number is not null
  then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  -- NOTE: base_canon_revision is deliberately NOT checked here — on a retry the
  -- story revision has already advanced past the checkpoint's base. The replay
  -- fast path below decides via the commit's own base; a fresh publication
  -- (NO_COMMIT) gets the base guard at the C-lock re-verify.

  -- Replay hashes FROM THE CHECKPOINT (DB-computed; caller supplies only the
  -- choice/ending UI payload, never canonical state or prose).
  v_state_delta_hash := public.chapter_state_delta_hash_v1(v_pre_checkpoint.state_delta_json);
  v_pub_hash := public.chapter_publication_payload_hash_v1(
    p_story_id, p_chapter_number,
    v_pre_checkpoint.title, v_pre_checkpoint.paragraphs_json,
    p_choice_prompt, p_choices, p_outcomes, p_ending_key, p_ending_name
  );

  -- Replay fast path BEFORE the lease gate: a retry whose 13-field commit
  -- already exists returns EXACT_REPLAY. The lease was released by the first
  -- publication (invariant b), so the lease gate must never fence a
  -- legitimate retry — the commit row is the idempotency proof, and
  -- serialization remains the story row + advisory S (read-only lookup, no
  -- row lock, so the canonical lock order is untouched).
  --
  -- The base revision is pre-read FROM THE COMMIT (if one exists), not from
  -- the story: a retry always arrives with the canon already advanced by the
  -- first publication, so only the commit's own base can satisfy the 13-field
  -- exact machine. A fresh publication has no commit → base is NULL → the
  -- machine returns NO_COMMIT and the full lock/provenance path runs below.
  select c.base_canon_revision into v_replay_base
  from public.chapter_state_commits c
  where c.story_id = p_story_id
    and c.chapter_number = p_chapter_number;

  v_replay := public.lookup_chapter_commit_replay_v1(
    p_story_id, p_chapter_number,
    p_checkpoint_attempt_id, v_pre_checkpoint.correlation_id,
    v_replay_base, 1::smallint, v_state_delta_hash,
    1::smallint, v_pub_hash,
    'personalized'::text, p_user_id, null
  );

  if v_replay->>'state' = 'EXACT_REPLAY' then
    return v_replay->'result';
  end if;
  if v_replay->>'state' = 'CONFLICT' then
    raise exception using errcode = 'P0001', message = 'PUBLICATION_CONFLICT';
  end if;

  -- L: lease lock. The sync caller holds this lease (A1d acquired it); V3
  -- never creates a lease. Sync-ownership contract: the lease must NOT be
  -- bound to a generation job (job_id/claim_token NULL) — a worker-owned
  -- lease is never publishable by the sync path. After publish_chapter_v2
  -- releases the lease, it stays RELEASED — no second ACTIVE→RELEASED
  -- transition is attempted.
  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found
    or v_lease.story_id is distinct from p_story_id
    or v_lease.chapter_number is distinct from p_chapter_number
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= pg_catalog.clock_timestamp()
    or v_lease.job_id is not null
    or v_lease.claim_token is not null
  then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  -- C: checkpoint lock. The publication binds to the exact checkpoint row
  -- produced by the sync writer (same story/chapter/attempt + correlation).
  -- The locked row is authoritative: re-verify the pre-read and re-derive
  -- every canonical value from C (a writer cannot have changed the row under
  -- our STORY lock, but the check is the belt).
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = p_story_id
    and c.chapter_number = p_chapter_number
    and c.attempt_id = p_checkpoint_attempt_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_checkpoint.checkpoint_schema_version <> 3
    or v_checkpoint.correlation_id is distinct from v_pre_checkpoint.correlation_id
    or v_checkpoint.generation_mode is distinct from 'personalized'
    or v_checkpoint.status not in ('PROSE_READY','RUNNING_CHOICES','READY_TO_PUBLISH','PUBLISHED')
    or v_checkpoint.state_delta_json is distinct from v_pre_checkpoint.state_delta_json
    or v_checkpoint.state_delta_schema_version is distinct from 1
    or v_checkpoint.base_canon_revision is distinct from v_base_canon_revision
    or v_checkpoint.title is distinct from v_pre_checkpoint.title
    or v_checkpoint.paragraphs_json is distinct from v_pre_checkpoint.paragraphs_json
    -- Domain separation (R2-B2): sync publications bind sync checkpoints only;
    -- the locked row must stay job-unbound exactly as the pre-read saw it.
    or v_checkpoint.job_id is not null
    or v_checkpoint.job_attempt_number is not null
  then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;

  -- Re-derive from the LOCKED checkpoint (all downstream values come from C).
  v_state_delta_hash := public.chapter_state_delta_hash_v1(v_checkpoint.state_delta_json);
  v_pub_hash := public.chapter_publication_payload_hash_v1(
    p_story_id, p_chapter_number,
    v_checkpoint.title, v_checkpoint.paragraphs_json,
    p_choice_prompt, p_choices, p_outcomes, p_ending_key, p_ending_name
  );

  -- CONTRACT FOR SHARE (personalized sync always has a contract).
  select plot_debts_json, story_contract_version
  into v_contract_row
  from public.story_generation_contracts
  where story_id = p_story_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEBT_CONTRACT_NOT_FOUND';
  end if;
  if v_contract_row.story_contract_version is distinct from v_story.story_contract_version
    or v_contract_row.story_contract_version is distinct from v_checkpoint.story_contract_version
  then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  -- Sync idempotency key: deterministic per (story, chapter). Must stay
  -- within the 200-char V2 limit — a story id long enough to overflow it
  -- fails closed here with a clear error instead of V2's generic
  -- INVALID_IDEMPOTENCY_KEY.
  v_sync_key := 'sync:' || p_story_id || ':publish:' || p_chapter_number::text;
  if pg_catalog.char_length(v_sync_key) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_SYNC_IDEMPOTENCY_KEY';
  end if;

  -- Ending lock (re-enters E2 reentrantly) before chapter publication.
  if v_has_ending_lock then
    perform public.persist_ending_lock_v1(
      p_user_id, p_story_id, p_ending_key, p_ending_name, p_chapter_number
    );
  end if;

  -- Chapter publication (V2), with the CHECKPOINT's title/paragraphs (never
  -- caller-supplied). CHAPTER_EXISTS returns {ok:false} WITHOUT an exception
  -- — that is still a hard conflict for the living-canon path (a chapter
  -- without a commit is foreign state): raise and roll back.
  v_publisher_result := public.publish_chapter_v2(
    p_story_id, p_chapter_number,
    v_checkpoint.title, v_checkpoint.paragraphs_json,
    p_choice_prompt, p_choices, p_outcomes,
    p_lease_id, v_sync_key
  );

  if (v_publisher_result->>'ok')::boolean is distinct from true then
    raise exception using errcode = 'P0001', message = 'PUBLICATION_CONFLICT';
  end if;

  -- Verify publication proof (idempotency_keys + chapters row).
  v_expected_scope := 'publish_chapter_v2:' || p_chapter_number::text;
  select i.result,
         pg_catalog.jsonb_typeof(i.result) = 'object'
           and i.result @> '{"ok":true}'::jsonb
           and case
                 when pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
                 then (i.result->>'chapter_number')::numeric = p_chapter_number
                 else false
               end
  into v_proof_result, v_proof_valid
  from public.idempotency_keys i
  where i.key = v_sync_key
    and i.story_id = p_story_id
    and i.scope = v_expected_scope;

  if not coalesce(v_proof_valid, false)
    or v_publisher_result is distinct from v_proof_result
    or not exists (
      select 1 from public.chapters c
      where c.story_id = p_story_id and c.number = p_chapter_number
    )
  then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

  v_seq := (v_proof_result->>'seq')::integer;

  -- Shared atomic state applier (canonical tables + progress/closure ledgers;
  -- closures/progress provenance: source_job_id NULL for sync). The delta
  -- comes from the LOCKED checkpoint — never from the caller.
  perform public.apply_validated_chapter_state_v1(
    p_story_id, p_chapter_number,
    v_base_canon_revision, p_user_id, null, v_checkpoint.state_delta_json
  );

  -- Commit ledger insert (canonical replay proof) + revision increment.
  v_committed_canon_revision := v_base_canon_revision + 1;
  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'chapter_number', p_chapter_number,
    'seq', v_seq,
    'checkpoint_attempt_id', p_checkpoint_attempt_id,
    'committed_canon_revision', v_committed_canon_revision
  );

  insert into public.chapter_state_commits (
    story_id, chapter_number,
    base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, source_job_id,
    checkpoint_attempt_id,
    correlation_id,
    publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    p_story_id, p_chapter_number,
    v_base_canon_revision, v_committed_canon_revision,
    v_checkpoint.state_delta_json, 1, v_state_delta_hash,
    'personalized', p_user_id, null,
    p_checkpoint_attempt_id,
    v_checkpoint.correlation_id,
    1, v_pub_hash,
    v_result
  );

  -- Checkpoint → PUBLISHED (terminal for this attempt).
  update public.chapter_generation_checkpoints
  set status = 'PUBLISHED',
      updated_at = pg_catalog.clock_timestamp(),
      expires_at = pg_catalog.clock_timestamp() + interval '1 hour'
  where story_id = p_story_id
    and chapter_number = p_chapter_number
    and attempt_id = p_checkpoint_attempt_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_PUBLISH_FAILED';
  end if;

  -- Canon revision increment (last mutation; everything above rolls back on
  -- any failure — the increment and the commit are one atomic unit).
  update public.stories
  set canon_state_revision = v_committed_canon_revision
  where id = p_story_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_REVISION_INCREMENT_FAILED';
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_chapter_state_v3(
  text, integer, uuid, uuid, uuid, text, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.publish_chapter_state_v3(
  text, integer, uuid, uuid, uuid, text, jsonb, jsonb, text, text
) to service_role;

comment on function public.publish_chapter_state_v3(
  text, integer, uuid, uuid, uuid, text, jsonb, jsonb, text, text
) is
  'Sync living-canon publisher (outer authority — service_role only). Checkpoint-authoritative state/prose; sync lease only (job_id/claim_token NULL); ordered locks; 13-field replay; shared applier; commit insert + revision increment. CHAPTER_EXISTS → PUBLICATION_CONFLICT.';


-- ──────────────────────────────────────────────────────────────────────────────
-- 9. publish_generation_job_chapter_v5() — living-canon worker publisher
-- ──────────────────────────────────────────────────────────────────────────────
-- V5 is the V1-story counterpart of V4 (V4 = legacy v0, V5 = living canon v1).
-- Disjointness is DB-enforced on BOTH sides: V4 raises LIVING_CANON_REQUIRES_V5
-- on v1 stories (section 6); V5 raises LIVING_CANON_NOT_ACTIVE on v0 stories.
--
-- Differences from V4 (everything else mirrors V4 fencing/terminalization):
--   * canonical state comes from the LOCKED checkpoint — title/paragraphs/
--     state delta/closures are never caller-supplied; the caller only supplies
--     the choice UI payload (choice_prompt/choices/outcomes — the checkpoint
--     schema stores no choice columns) and the ending lock payload.
--   * STORY FOR UPDATE (not FOR SHARE) captures the exact base revision; the
--     checkpoint's base_canon_revision must equal it (STALE_CANON_REVISION
--     fails closed when the canon advanced between writer and publisher).
--   * 13-field commit replay (shared evaluator) replaces the V4 idempotency-
--     key-only replay.
--   * the shared applier (apply_validated_chapter_state_v1) is the ONLY
--     mutation owner of canonical tables + progress/closure ledgers.
--   * checkpoint → PUBLISHED via the schema-3-aware atomic helper (V4's
--     helper is schema-2-only).
--   * commit ledger row + canon_state_revision increment (V4 has neither).
--
-- Lock order (final): E1 → E2 (ending only) → S(120712) → STORY FOR UPDATE
--   (gate) → R → J → L → C → CONTRACT FOR SHARE → COMMIT lookup FOR UPDATE
--   → writes. Invariants: S before STORY, STORY before R, STORY before L,
--   J before L, L before C, C before COMMIT lookup.
--
-- Phase G terminalization (mirror V4): restore lease ACTIVE under lease lock
-- → shared applier → commit insert → checkpoint PUBLISHED (job still RUNNING)
-- → job SUCCEEDED + publication_result + attempts → lease RELEASED (final)
-- → stories.canon_state_revision increment (last mutation).

-- Internal: atomic checkpoint → PUBLISHED for V5 in-transaction publication.
-- Mirror of transition_checkpoint_published_atomic_v4 with the schema-3
-- (living canon) provenance contract:
--   * checkpoint_schema_version = 3, state_delta_json NOT NULL
--   * attempt_id = job id, job_id = job id, correlation = job correlation
--   * generation_mode = job generation_kind (personalized — V5 stories are
--     living canon; the fenced V2 writer enforces personalized-only)
-- Same idempotence (PUBLISHED → no-op) and same defense-in-depth proof
-- (chapter row + idempotency key ok:true) as the V4 helper. Revoked from
-- every role (DEFINER publishers only) like its V4 counterpart.
create or replace function public.transition_checkpoint_published_atomic_v5(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_now timestamptz;
begin
  -- Job must be locked, RUNNING, owned by this worker/claim.
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'OWNERSHIP_LOST');
  end if;
  if v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  -- Lease must remain ACTIVE, unexpired, and exact through checkpoint
  -- terminalization (the V5 publisher restores ACTIVE after V2 releases it).
  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found or v_lease.job_id is distinct from v_job.id
    or v_lease.claim_token is distinct from p_claim_token
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or v_lease.holder is distinct from v_job.worker_id
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'LEASE_INVALID');
  end if;

  -- Checkpoint provenance (schema-3 living canon only).
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = v_job.id
    and c.job_id = v_job.id
  for update;

  if not found or v_checkpoint.checkpoint_schema_version <> 3
    or v_checkpoint.job_id is distinct from v_job.id
    or v_checkpoint.correlation_id is distinct from v_job.correlation_id
    or v_checkpoint.generation_mode is distinct from v_job.generation_kind
    or v_checkpoint.state_delta_json is null
    or v_checkpoint.base_canon_revision is null then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;
  if v_checkpoint.job_attempt_number > v_job.attempt_count then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'ATTEMPT_AHEAD');
  end if;

  -- Idempotent: already PUBLISHED for this same attempt is a no-op success.
  if v_checkpoint.status = 'PUBLISHED' then
    return pg_catalog.jsonb_build_object('ok', true, 'result', 'UPDATED', 'changed', false);
  end if;
  if v_checkpoint.status not in ('PROSE_READY', 'RUNNING_CHOICES', 'READY_TO_PUBLISH') then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'INVALID_TRANSITION');
  end if;

  -- Defense-in-depth: verify the chapter has been published in this
  -- transaction (chapter row + idempotency key proof), mirroring V4.
  if not exists (
    select 1 from public.chapters c
    where c.story_id = v_job.story_id and c.number = v_job.chapter_number
  ) or not exists (
    select 1 from public.idempotency_keys i
    where i.key = v_job.publication_idempotency_key
      and i.story_id = v_job.story_id
      and i.scope = 'publish_chapter_v2:' || v_job.chapter_number::text
      and pg_catalog.jsonb_typeof(i.result) = 'object'
      and i.result @> '{"ok":true}'::jsonb
      and case
            when pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
            then (i.result->>'chapter_number')::numeric = v_job.chapter_number
            else false
          end
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'result', 'PROVENANCE_CONFLICT');
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.chapter_generation_checkpoints
  set status = 'PUBLISHED',
      updated_at = v_now,
      expires_at = v_now + interval '1 hour'
  where story_id = v_checkpoint.story_id
    and chapter_number = v_checkpoint.chapter_number
    and attempt_id = v_checkpoint.attempt_id
  returning * into v_checkpoint;

  return pg_catalog.jsonb_build_object('ok', true, 'result', 'UPDATED', 'changed', true);
end;
$$;

revoke all on function public.transition_checkpoint_published_atomic_v5(
  uuid,text,uuid,uuid,text,integer
) from public, anon, authenticated, service_role;

comment on function public.transition_checkpoint_published_atomic_v5(
  uuid,text,uuid,uuid,text,integer
) is
  'Schema-3-aware atomic checkpoint → PUBLISHED for the V5 in-transaction publication. Mirror of the V4 atomic helper; revoked from every role (DEFINER publishers only).';

create or replace function public.publish_generation_job_chapter_v5(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_story_id text,
  p_chapter_number integer,
  p_choice_prompt text,
  p_choices jsonb,
  p_outcomes jsonb,
  p_ending_key text,
  p_ending_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_preflight public.generation_jobs%rowtype;
  v_preflight_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_pre_checkpoint_found boolean;
  v_job public.generation_jobs%rowtype;
  v_story public.stories%rowtype;
  v_base_canon_revision bigint;
  v_committed_canon_revision bigint;
  v_lease public.generation_leases%rowtype;
  v_checkpoint public.chapter_generation_checkpoints%rowtype;
  v_contract_row record;
  v_expected_key text;
  v_expected_scope text;
  v_publisher_result jsonb;
  v_proof_result jsonb;
  v_proof_valid boolean := false;
  v_checkpoint_publish_result jsonb;
    v_result jsonb;
  v_replay jsonb;
  -- Commit's OWN base revision (R3): a successful retry arrives with the canon
  -- already advanced by the first publication, so only the commit's own base
  -- can satisfy the 13-field exact machine (mirror of V3).
  v_replay_base bigint;
  v_now timestamptz;
  v_started_at timestamptz;
  v_elapsed_ms bigint;
  v_has_ending_lock boolean;

  -- Closure canonicalization (source: locked checkpoint audit signals)
  v_canonical_closures jsonb := '[]'::jsonb;
  v_closure_hash text;
  v_pub_hash text;
  v_state_delta_hash text;
  -- C-lock re-derivation (R3): the locked row must hash-identically match the
  -- J-pre-read values the replay evaluation used.
  v_locked_closure_hash text;
  v_locked_pub_hash text;
  v_locked_delta_hash text;
  v_debt_id text;
  v_debt_obj jsonb;
  v_ledger_debts text[];
  v_effective_closed text[];
  v_any_open boolean;
  v_main_mystery_closed boolean;
begin
  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE A — Pre-read (unlocked, for LOCK KEYS only; NO successful return)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- The job row is pre-read WITHOUT lock to derive the lock keys (story,
  -- chapter, user, ending lock targets). Values are UNTRUSTED until
  -- re-verified under J. Replay authority is the immutable commit ledger
  -- (lookup_chapter_commit_replay_v1), evaluated under the LOCKED J in Phase C
  -- — the legacy SUCCEEDED dual-hash fast path is GONE (R3): publication +
  -- closure hashes do not prove exact living-canon replay (they miss the
  -- state_delta, correlation, base revision, schema, and actor/source
  -- provenance).

  select j.* into v_preflight
  from public.generation_jobs j
  where j.id = p_job_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  v_expected_key := 'generation-job:' || v_preflight.id::text || ':publish:' || v_preflight.chapter_number::text;
  if v_preflight.publication_idempotency_key is distinct from v_expected_key then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

  -- Ending lock payload: both or neither; V5 endings exist only on ch45.
  if (p_ending_key is null) is distinct from (p_ending_name is null) then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_PAYLOAD';
  end if;
  v_has_ending_lock := p_ending_key is not null;
  if v_has_ending_lock then
    if p_ending_key = ''
      or p_ending_key <> pg_catalog.btrim(p_ending_key)
      or pg_catalog.char_length(p_ending_key) > 80
      or p_ending_key ~ '[[:cntrl:]]'
      or p_ending_name = ''
      or p_ending_name <> pg_catalog.btrim(p_ending_name)
      or pg_catalog.char_length(p_ending_name) > 160
      or p_ending_name ~ '[[:cntrl:]]'
      or v_preflight.generation_kind is distinct from 'personalized'
      or v_preflight.chapter_number is distinct from 45 then
      raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_TARGET';
    end if;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE B — Lock acquisition (canonical global order)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- E1 → E2 (ending only) → S(120712) → STORY FOR UPDATE (gate) → R → J → L
  --
  -- E1 = ending advisory lock key 120713 (same domain as the V4 path)
  -- E2 = ending advisory lock key 130600 (persist_ending_lock_v1 internal key)
  -- S  = story advisory lock (hashtextextended(story_id, 120712)) — BEFORE the
  --      story row lock, so no publisher ever sees a half-incremented revision.
  -- STORY FOR UPDATE = capability gate + exact base revision capture.
  -- R  = reader_states FOR UPDATE (personalized)
  -- J  = generation_jobs FOR UPDATE
  -- L  = generation_leases FOR UPDATE

  if v_has_ending_lock then
    -- E1: ending advisory lock (key 120713, v4-compatible domain).
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_preflight.story_id || ':ending:' || v_preflight.user_id::text, 120713)
    );
    -- E2: ending advisory lock (persist_ending_lock_v1 internal key 130600).
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_preflight.story_id || ':' || v_preflight.user_id::text, 130600)
    );
  end if;

  -- S: story advisory lock (all modes).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_preflight.story_id, 120712)
  );

  -- STORY FOR UPDATE + living-canon capability gate. V5 owns v1 stories only;
  -- the capability check runs BEFORE any R/J/L/C lock or mutation.
  select s.* into v_story
  from public.stories s
  where s.id = v_preflight.story_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'STORY_NOT_FOUND';
  end if;
  if v_story.living_canon_version <> 1 then
    raise exception using errcode = 'P0001', message = 'LIVING_CANON_NOT_ACTIVE';
  end if;
  v_base_canon_revision := v_story.canon_state_revision;

  -- R: reader_states FOR UPDATE (personalized always). The canonical actor
  -- row MUST exist — a job without its reader state is broken state and must
  -- never publish (fail closed).
  perform 1 from public.reader_states rs
  where rs.user_id = v_preflight.user_id
    and rs.story_id = v_preflight.story_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'READER_STATE_MISSING';
  end if;

  -- J: generation_jobs FOR UPDATE.
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE C — Locked recheck + idempotency + provenance + replay
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Identity recheck (pre-read was UNTRUSTED).
  v_expected_key := 'generation-job:' || v_job.id::text || ':publish:' || v_job.chapter_number::text;
  if v_job.publication_idempotency_key is distinct from v_expected_key then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;
  if v_job.generation_kind is distinct from v_preflight.generation_kind then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_TARGET_MISMATCH';
  end if;

  -- V5 is the living-canon worker publisher: personalized only (mirror of the
  -- fenced V2 writer's mode gate).
  if v_job.generation_kind <> 'personalized' then
    raise exception using errcode = '22023', message = 'INVALID_CHECKPOINT_PAYLOAD';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE C — Checkpoint pre-read + canonical replay evaluation (under J)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- The worker checkpoint is read HERE without a row lock, but under the held
  -- J FOR UPDATE: the A1b worker checkpoint writer claims J FOR UPDATE before
  -- it writes lease/checkpoint state, so no legitimate writer can mutate this
  -- row behind us. Global lock order stays J → L → C. The checkpoint is the
  -- ONLY canonical source of state/prose/closures — the caller supplies
  -- nothing; the hashes are re-derived from the LOCKED row after C and must
  -- hash-identically match (fence below).
  select c.* into v_preflight_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = v_job.id
    and c.job_id = v_job.id;
  v_pre_checkpoint_found := found;

  if not v_pre_checkpoint_found then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_preflight_checkpoint.checkpoint_schema_version <> 3
    or v_preflight_checkpoint.correlation_id is distinct from v_job.correlation_id
    or v_preflight_checkpoint.generation_mode is distinct from v_job.generation_kind
    or v_preflight_checkpoint.status not in ('PROSE_READY','RUNNING_CHOICES','READY_TO_PUBLISH','PUBLISHED')
    or v_preflight_checkpoint.state_delta_json is null
    or v_preflight_checkpoint.state_delta_schema_version is distinct from 1
  then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;

  -- Canonical closure set (with closedAtChapter) — same shape V4 hashes.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'closureForm', item.closureForm,
      'closedAtChapter', v_job.chapter_number,
      'debtId', item.debtId
    ) order by item.debtId
  ), '[]'::jsonb)
  into v_canonical_closures
  from (
    select elem->>'debtId' as debtId, elem->>'closureForm' as closureForm
    from pg_catalog.jsonb_array_elements(
      coalesce(v_preflight_checkpoint.audit_signals_json->'closesPlotDebts', '[]'::jsonb)
    ) elem
    order by (elem->>'debtId')
  ) item;

  v_closure_hash := pg_catalog.encode(
    extensions.digest(
      'generation-plot-debt-closures-v1' || v_canonical_closures::text,
      'sha256'
    ),
    'hex'
  );
  v_pub_hash := public.chapter_publication_payload_hash_v1(
    v_job.story_id, v_job.chapter_number,
    v_preflight_checkpoint.title, v_preflight_checkpoint.paragraphs_json,
    p_choice_prompt, p_choices, p_outcomes, p_ending_key, p_ending_name
  );
  v_state_delta_hash := public.chapter_state_delta_hash_v1(v_preflight_checkpoint.state_delta_json);

  -- Replay authority = the immutable commit ledger (the SAME 13-field machine
  -- V3 uses — R3 unifies V5 replay with it). The base revision is pre-read
  -- FROM THE COMMIT, not the story: a successful retry always arrives with the
  -- canon already advanced by the first publication, so only the commit's own
  -- base can satisfy the exact machine (mirror of V3). A fresh publication has
  -- no commit → base NULL → NO_COMMIT → the full lock/provenance path runs.
  select c.base_canon_revision into v_replay_base
  from public.chapter_state_commits c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number;

  v_replay := public.lookup_chapter_commit_replay_v1(
    v_job.story_id, v_job.chapter_number,
    v_job.id, v_preflight_checkpoint.correlation_id,
    v_replay_base, 1::smallint, v_state_delta_hash,
    1::smallint, v_pub_hash,
    'personalized'::text, v_job.user_id, v_job.id
  );

  -- EXACT_REPLAY → the SAME living-canon publication already exists in the
  -- ledger: return the stored result (no lease, no fresh base needed — the
  -- commit is the idempotency proof). CONFLICT → the checkpoint diverged from
  -- what was committed: a SUCCEEDED job with a mismatched checkpoint is broken
  -- provenance (R3 tests 2-3); a still-RUNNING job lost a publication race
  -- (e.g. the V3/V5 cross-path race) → publication-level conflict.
  if v_replay->>'state' = 'EXACT_REPLAY' then
    return v_replay->'result';
  end if;
  if v_replay->>'state' = 'CONFLICT' then
    if v_job.status = 'SUCCEEDED' and v_job.publication_result is not null then
      raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
    end if;
    raise exception using errcode = 'P0001', message = 'PUBLICATION_CONFLICT';
  end if;
  -- NO_COMMIT: only a RUNNING job legitimately continues into L/C. A SUCCEEDED
  -- job claiming success WITHOUT a ledger row is broken state → never SUCCESS.
  if v_job.status = 'SUCCEEDED' and v_job.publication_result is not null then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;

  -- L: lease lock.
  select l.* into v_lease
  from public.generation_leases l
  where l.id = p_lease_id
  for update;

  if not found
    or v_lease.job_id is distinct from v_job.id
    or v_lease.claim_token is distinct from v_job.claim_token
    or v_lease.story_id is distinct from v_job.story_id
    or v_lease.chapter_number is distinct from v_job.chapter_number
    or v_lease.holder is distinct from v_job.worker_id
    or v_lease.status <> 'ACTIVE'
    or v_lease.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  -- C: checkpoint lock (schema-3 living canon, exact provenance).
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.attempt_id = v_job.id
    and c.job_id = v_job.id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_checkpoint.checkpoint_schema_version <> 3
    or v_checkpoint.correlation_id is distinct from v_job.correlation_id
    or v_checkpoint.generation_mode is distinct from v_job.generation_kind
    or v_checkpoint.status not in ('PROSE_READY','RUNNING_CHOICES','READY_TO_PUBLISH','PUBLISHED')
    or v_checkpoint.state_delta_json is null
    or v_checkpoint.state_delta_schema_version is distinct from 1
  then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;
  if v_checkpoint.job_attempt_number > v_job.attempt_count then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;

  -- R3 fence — the LOCKED row must hash-identically match the J-pre-read
  -- checkpoint the replay evaluation used. Re-derives every canonical value
  -- from the locked row; divergence between the J-pre-read and the C lock
  -- means the checkpoint mutated behind the publication → broken state.
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'closureForm', item.closureForm,
      'closedAtChapter', v_job.chapter_number,
      'debtId', item.debtId
    ) order by item.debtId
  ), '[]'::jsonb)
  into v_canonical_closures
  from (
    select elem->>'debtId' as debtId, elem->>'closureForm' as closureForm
    from pg_catalog.jsonb_array_elements(
      coalesce(v_checkpoint.audit_signals_json->'closesPlotDebts', '[]'::jsonb)
    ) elem
    order by (elem->>'debtId')
  ) item;

  v_locked_closure_hash := pg_catalog.encode(
    extensions.digest(
      'generation-plot-debt-closures-v1' || v_canonical_closures::text,
      'sha256'
    ),
    'hex'
  );
  v_locked_pub_hash := public.chapter_publication_payload_hash_v1(
    v_job.story_id, v_job.chapter_number,
    v_checkpoint.title, v_checkpoint.paragraphs_json,
    p_choice_prompt, p_choices, p_outcomes, p_ending_key, p_ending_name
  );
  v_locked_delta_hash := public.chapter_state_delta_hash_v1(v_checkpoint.state_delta_json);

  if v_locked_closure_hash is distinct from v_closure_hash
    or v_locked_pub_hash is distinct from v_pub_hash
    or v_locked_delta_hash is distinct from v_state_delta_hash
  then
    raise exception using errcode = 'P0001', message = 'PROVENANCE_CONFLICT';
  end if;

  -- Adopt the LOCKED-row hashes as authoritative for the commit ledger below.
  v_closure_hash := v_locked_closure_hash;
  v_pub_hash := v_locked_pub_hash;
  v_state_delta_hash := v_locked_delta_hash;

  -- Canon revision binding — ONLY the fresh-publication path reaches this point
  -- (EXACT_REPLAY/CONFLICT/broken-SUCCEEDED already returned in Phase C). The
  -- delta was computed against the exact revision captured under the STORY
  -- lock; if the canon advanced in between, the delta is stale — fail closed.
  if v_checkpoint.base_canon_revision is distinct from v_base_canon_revision then
    raise exception using errcode = 'P0001', message = 'STALE_CANON_REVISION';
  end if;

  -- Ownership + runtime validation.
  if v_job.status <> 'RUNNING' then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_RUNNING';
  end if;
  if v_job.story_id is distinct from v_preflight.story_id
    or v_job.user_id is distinct from v_preflight.user_id
    or v_job.story_id is distinct from p_story_id
    or v_job.chapter_number is distinct from p_chapter_number then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_TARGET_MISMATCH';
  end if;
  if v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_OWNERSHIP_LOST';
  end if;
  if v_job.deadline_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_DEADLINE_EXCEEDED';
  end if;
  if v_has_ending_lock and (
    v_job.generation_kind is distinct from 'personalized'
    or v_job.chapter_number is distinct from 45
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ENDING_LOCK_TARGET';
  end if;

  -- Checkpoint audit signals: V5 checkpoints must carry valid v2 signals
  -- (the writer + table constraint already enforce this; belt here too).
  if v_checkpoint.audit_signals_version is distinct from 2
    or not public.is_valid_checkpoint_audit_signals_v2(v_checkpoint.audit_signals_json) then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;

  -- Contract provenance chain: job = checkpoint = story.
  if v_job.story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'CONTRACT_PROVENANCE_MISSING';
  end if;
  if v_checkpoint.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;
  if v_story.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  -- Closure binding: the delta's plotDebts.closures MUST equal the checkpoint
  -- audit closesPlotDebts EXACTLY (both canonicalized to {closureForm,debtId}
  -- sorted by debtId; closedAtChapter stripped). The shared applier derives
  -- ledger rows from the delta, so a mismatch would publish a state the
  -- checkpoint never recorded.
  if (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('closureForm', item.closureForm, 'debtId', item.debtId)
      order by item.debtId
    ), '[]'::jsonb)
    from (
      select elem->>'debtId' as debtId, elem->>'closureForm' as closureForm
      from pg_catalog.jsonb_array_elements(
        coalesce(v_checkpoint.state_delta_json->'plotDebts'->'closures', '[]'::jsonb)
      ) elem
    ) item
  ) is distinct from (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('closureForm', item.closureForm, 'debtId', item.debtId)
      order by item.debtId
    ), '[]'::jsonb)
    from (
      select elem->>'debtId' as debtId, elem->>'closureForm' as closureForm
      from pg_catalog.jsonb_array_elements(
        coalesce(v_checkpoint.audit_signals_json->'closesPlotDebts', '[]'::jsonb)
      ) elem
    ) item
  ) then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH';
  end if;

  -- CONTRACT FOR SHARE: single mutable row per story.
  select plot_debts_json, story_contract_version
  into v_contract_row
  from public.story_generation_contracts
  where story_id = v_job.story_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'DEBT_CONTRACT_NOT_FOUND';
  end if;
  if v_contract_row.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;
  if v_contract_row.plot_debts_json is null
    or pg_catalog.jsonb_typeof(v_contract_row.plot_debts_json) <> 'array'
  then
    raise exception using errcode = 'P0001', message = 'DEBT_CONTRACT_INVALID';
  end if;

  -- Existing ledger state.
  select coalesce(pg_catalog.array_agg(debt_id), '{}'::text[])
  into v_ledger_debts
  from public.reader_plot_debt_closures
  where user_id = v_job.user_id and story_id = v_job.story_id;

  -- Per-closure contract validation (mirror V4 personalized branch).
  for v_debt_id in select value->>'debtId'
                   from pg_catalog.jsonb_array_elements(v_canonical_closures)
  loop
    v_debt_obj := null;
    select elem into v_debt_obj
    from pg_catalog.jsonb_array_elements(v_contract_row.plot_debts_json) elem
    where elem->>'id' = v_debt_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_UNKNOWN_DEBT: ' || v_debt_id;
    end if;
    if v_job.chapter_number < (v_debt_obj->>'introducedAt')::integer then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_NOT_INTRODUCED: ' || v_debt_id;
    end if;
    if v_job.chapter_number > (v_debt_obj->>'mustCloseBy')::integer then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_DEADLINE_VIOLATION: ' || v_debt_id;
    end if;
    if v_debt_id = any(v_ledger_debts) then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_CONFLICT: ' || v_debt_id;
    end if;
  end loop;

  -- ABANDONED main_mystery is forbidden (mirror V4).
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_canonical_closures) elem
    where elem->>'debtId' = 'main_mystery' and elem->>'closureForm' = 'ABANDONED'
  ) then
    raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_ABANDONED_MAIN_MYSTERY';
  end if;

  -- Closure omission checks (effective closed = ledger + proposed).
  v_effective_closed := v_ledger_debts;
  for v_debt_id in select value->>'debtId'
                   from pg_catalog.jsonb_array_elements(v_canonical_closures)
  loop
    v_effective_closed := pg_catalog.array_append(v_effective_closed, v_debt_id);
  end loop;

  if v_job.chapter_number = 50 then
    v_any_open := false;
    for v_debt_obj in select value from pg_catalog.jsonb_array_elements(v_contract_row.plot_debts_json) loop
      if not ((v_debt_obj->>'id') = any(v_effective_closed)) then
        v_any_open := true;
        exit;
      end if;
    end loop;
    if v_any_open then
      raise exception using errcode = 'P0001', message = 'OPEN_DEBT_AT_END';
    end if;
  end if;

  if v_job.chapter_number >= 48 then
    v_main_mystery_closed := false;
    for v_debt_obj in select value from pg_catalog.jsonb_array_elements(v_contract_row.plot_debts_json) loop
      if v_debt_obj->>'id' = 'main_mystery' and (v_debt_obj->>'id') = any(v_effective_closed) then
        v_main_mystery_closed := true;
        exit;
      end if;
    end loop;
    if not v_main_mystery_closed then
      raise exception using errcode = 'P0001', message = 'MAIN_MYSTERY_UNRESOLVED';
    end if;
  end if;

  for v_debt_obj in select value from pg_catalog.jsonb_array_elements(v_contract_row.plot_debts_json) loop
    if v_job.chapter_number >= (v_debt_obj->>'mustCloseBy')::integer
      and not ((v_debt_obj->>'id') = any(v_effective_closed))
    then
      raise exception using errcode = 'P0001', message = 'DEBT_CLOSURE_DEADLINE_VIOLATION: ' || (v_debt_obj->>'id');
    end if;
  end loop;

  -- The 13-field replay evaluation already ran in Phase C under the LOCKED J
  -- (before L); this path is strictly fresh publication — the L/C-reverified
  -- checkpoint is the exact base the commit records below.

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE F — Publication (after all fencing validated)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- persist_ending_lock_v1 re-enters E2 (key 130600) reentrantly (mirror V4).
  -- Chapter publication uses the job's deterministic idempotency key and the
  -- CHECKPOINT's title/paragraphs (never caller-supplied). CHAPTER_EXISTS
  -- returns {ok:false} WITHOUT an exception — still a hard conflict for the
  -- living-canon path (a chapter without a commit is foreign state): raise
  -- and roll back.

  if v_has_ending_lock then
    perform public.persist_ending_lock_v1(
      v_job.user_id, v_job.story_id, p_ending_key, p_ending_name, v_job.chapter_number
    );
  end if;

  v_publisher_result := public.publish_chapter_v2(
    v_job.story_id, v_job.chapter_number,
    v_checkpoint.title, v_checkpoint.paragraphs_json,
    p_choice_prompt, p_choices, p_outcomes,
    p_lease_id, v_job.publication_idempotency_key
  );

  if (v_publisher_result->>'ok')::boolean is distinct from true then
    raise exception using errcode = 'P0001', message = 'PUBLICATION_CONFLICT';
  end if;

  -- Verify publication proof (idempotency_keys + chapters row).
  v_expected_scope := 'publish_chapter_v2:' || v_job.chapter_number::text;
  select i.result,
         pg_catalog.jsonb_typeof(i.result) = 'object'
           and i.result @> '{"ok":true}'::jsonb
           and case
                 when pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
                 then (i.result->>'chapter_number')::numeric = v_job.chapter_number
                 else false
               end
  into v_proof_result, v_proof_valid
  from public.idempotency_keys i
  where i.key = v_job.publication_idempotency_key
    and i.story_id = v_job.story_id
    and i.scope = v_expected_scope;

  if not coalesce(v_proof_valid, false)
    or v_publisher_result is distinct from v_proof_result
    or not exists (
      select 1 from public.chapters c
      where c.story_id = v_job.story_id and c.number = v_job.chapter_number
    )
  then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PHASE G — State apply + ledger + terminalize (still under fencing)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- publish_chapter_v2 releases its lease after inserting publication rows.
  -- Restore ACTIVE under the already-held lease lock so checkpoint
  -- terminalization requires live fencing; final RELEASED remains the last
  -- terminal tuple mutation below (exact V4 semantics).
  update public.generation_leases l
  set status = 'ACTIVE'
  where l.id = p_lease_id
    and l.job_id = v_job.id
    and l.claim_token = v_job.claim_token
    and l.story_id = v_job.story_id
    and l.chapter_number = v_job.chapter_number
    and l.holder = v_job.worker_id
    and l.status = 'RELEASED';

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  -- Shared atomic state applier (canonical tables + progress/closure ledgers;
  -- closures/progress provenance: source_job_id = job id).
  perform public.apply_validated_chapter_state_v1(
    v_job.story_id, v_job.chapter_number,
    v_base_canon_revision, v_job.user_id, v_job.id, v_checkpoint.state_delta_json
  );

  -- Commit ledger insert (canonical replay proof) — binds the SAME result
  -- object the job will carry (checkpoint_attempt_id + committed revision).
  v_committed_canon_revision := v_base_canon_revision + 1;
  v_result := v_publisher_result || pg_catalog.jsonb_build_object(
    'checkpoint_attempt_id', v_job.id,
    'committed_canon_revision', v_committed_canon_revision,
    'jobId', v_job.id
  );

  insert into public.chapter_state_commits (
    story_id, chapter_number,
    base_canon_revision, committed_canon_revision,
    state_delta_json, state_delta_schema_version, state_delta_hash,
    generation_mode, actor_user_id, source_job_id,
    checkpoint_attempt_id,
    correlation_id,
    publication_payload_schema_version, publication_payload_hash,
    publication_result
  ) values (
    v_job.story_id, v_job.chapter_number,
    v_base_canon_revision, v_committed_canon_revision,
    v_checkpoint.state_delta_json, 1, v_state_delta_hash,
    'personalized', v_job.user_id, v_job.id,
    v_job.id,
    v_checkpoint.correlation_id,
    1, v_pub_hash,
    v_result
  );

  -- Checkpoint → PUBLISHED while job is RUNNING and lease is ACTIVE
  -- (schema-3 atomic helper).
  v_checkpoint_publish_result := public.transition_checkpoint_published_atomic_v5(
      v_job.id, v_job.worker_id, v_job.claim_token, p_lease_id,
      v_job.story_id, v_job.chapter_number
    );
  if v_checkpoint_publish_result->>'ok' is distinct from 'true'
    or v_checkpoint_publish_result->>'result' is distinct from 'UPDATED' then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_PUBLISH_FAILED: ' || v_checkpoint_publish_result::text;
  end if;

  -- Job → SUCCEEDED + publication_result + both hashes.
  v_now := pg_catalog.clock_timestamp();
  v_started_at := coalesce(v_job.claimed_at, v_now);
  v_elapsed_ms := greatest(
    0,
    pg_catalog.floor(extract(epoch from (v_now - v_started_at)) * 1000)::bigint
  );

  update public.generation_jobs
  set status = 'SUCCEEDED',
      publication_result = v_result,
      publication_payload_hash = v_pub_hash,
      closure_payload_hash = v_closure_hash,
      last_error_code = null,
      last_error_class = null,
      last_error_at = null
  where id = v_job.id;

  insert into public.generation_job_attempts (
    job_id, correlation_id, story_id, chapter_number, attempt_number,
    workflow_phase, started_at, ended_at, elapsed_ms, retry_decision,
    error_code, worker_id
  ) values (
    v_job.id, v_job.correlation_id, v_job.story_id, v_job.chapter_number,
    v_job.attempt_count, 'PUBLICATION_SUCCEEDED', v_started_at, v_now,
    v_elapsed_ms, null, null, v_job.worker_id
  );

  -- Lease → RELEASED (after checkpoint and job terminalized), exact V4 form.
  update public.generation_leases l
  set status = 'RELEASED'
  where l.id = p_lease_id
    and l.job_id = v_job.id
    and l.claim_token = v_job.claim_token
    and l.story_id = v_job.story_id
    and l.chapter_number = v_job.chapter_number
    and l.holder = v_job.worker_id
    and l.status = 'ACTIVE';

  if not exists (
    select 1 from public.generation_leases l
    where l.id = p_lease_id
      and l.job_id = v_job.id
      and l.claim_token = v_job.claim_token
      and l.story_id = v_job.story_id
      and l.chapter_number = v_job.chapter_number
      and l.holder = v_job.worker_id
      and l.status = 'RELEASED'
  ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  -- Canon revision increment (last mutation; everything above rolls back on
  -- any failure — the increment and the commit are one atomic unit).
  update public.stories
  set canon_state_revision = v_committed_canon_revision
  where id = v_job.story_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_REVISION_INCREMENT_FAILED';
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_generation_job_chapter_v5(
  uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text
) from public, anon, authenticated;
grant execute on function public.publish_generation_job_chapter_v5(
  uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text
) to service_role;

comment on function public.publish_generation_job_chapter_v5(
  uuid,text,uuid,uuid,text,integer,text,jsonb,jsonb,text,text
) is
  'Living-canon worker publisher (outer authority — service_role only; v1 stories only; LIVING_CANON_NOT_ACTIVE on v0). Canonical state from the locked schema-3 checkpoint; caller supplies only choice/ending UI payload. Shared applier + commit ledger + revision increment; 13-field replay; exact V4 terminalization order.';
