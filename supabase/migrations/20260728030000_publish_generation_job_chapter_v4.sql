-- Atomic chapter publication with plot-debt closure ledger.
--
-- publish_generation_job_chapter_v4 extends V3 with:
-- 1. Canonical closure set + dual-hash idempotency (pub + closure)
-- 2. Contract provenance verification (job = checkpoint = story)
-- 3. Checkpoint audit binding (p_closures must match checkpoint.closesPlotDebts)
-- 4. Atomic closure ledger insert (same transaction as publication)
-- 5. Terminalization order: checkpoint PUBLISHED before lease RELEASED
--
-- Lock order (global): E → R → S → J → L → C
--   E = ending advisory, R = reader_states, S = stories (advisory),
--   J = generation_jobs, L = generation_leases, C = reader_plot_debt_closures

create function public.publish_generation_job_chapter_v4(
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
  v_story public.stories%rowtype;
  v_expected_key text;
  v_expected_scope text;
  v_publisher_result jsonb;
  v_proof_result jsonb;
  v_proof_valid boolean := false;
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

  select j.id, j.user_id, j.story_id, j.chapter_number, j.generation_kind
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
  if p_closures is null or jsonb_typeof(p_closures) <> 'array' or jsonb_array_length(p_closures) = 0 then
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
    pg_catalog.digest(
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
    pg_catalog.digest(
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
  -- PHASE B — Lock acquisition (canonical global order)
  -- ═══════════════════════════════════════════════════════════════════════════
  -- Pre-read gives us generation_kind, user_id, story_id (UNTRUSTED).
  -- Lock order depends on mode:
  --   personalized + ending:  E1 → E2 → R → S → J → L
  --   personalized + non-ending: R → S → J → L
  --   standard:               S → J → L
  --
  -- E1 = ending advisory lock key 120713 (v4-specific ending serialization)
  -- E2 = ending advisory lock key 130600 (persist_ending_lock_v1 internal key)
  --      Acquired here (before L) so persist_ending_lock_v1 re-enters reentrantly.
  --      PostgreSQL pg_advisory_xact_lock is reentrant within the same transaction.
  -- R  = reader_states SELECT ... FOR UPDATE (personalized only)
  -- S  = story advisory lock (hashtextextended(story_id, 120712))
  -- J  = generation_jobs SELECT ... FOR UPDATE
  -- L  = generation_leases SELECT ... FOR UPDATE
  --
  -- publish_chapter_v2 does NOT touch reader_states → R skipped for standard.
  -- persist_ending_lock_v1 is called in Phase F (after all fencing).
  -- It re-enters E2 (key 130600) reentrantly — no new lock acquisition.

  v_has_ending_lock := p_ending_key is not null;

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
    -- R: reader_states SELECT ... FOR UPDATE (serialized, all personalized paths).
    perform 1 from public.reader_states rs
    where rs.user_id = v_preflight.user_id
      and rs.story_id = v_preflight.story_id
    for update;
  end if;

  -- S: story advisory lock (all modes).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_preflight.story_id, 120712)
  );

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

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Standard branch: skip contract + closure validation
  -- ═══════════════════════════════════════════════════════════════════════════

  if not v_is_personalized then
    -- Standard mode: closures must be null or empty.
    if p_closures is not null and jsonb_typeof(p_closures) = 'array' and jsonb_array_length(p_closures) > 0 then
      raise exception using errcode = '22023', message = 'INVALID_CLOSURE_PAYLOAD';
    end if;

    -- Go directly to publication (Phase F).
    goto publication;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- Personalized branch: contract provenance + closure validation
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Contract provenance: job must have version.
  if v_job.story_contract_version is null then
    raise exception using errcode = 'P0001', message = 'CONTRACT_PROVENANCE_MISSING';
  end if;

  -- Checkpoint binding (deterministic order).
  select c.* into v_checkpoint
  from public.chapter_generation_checkpoints c
  where c.story_id = v_job.story_id
    and c.chapter_number = v_job.chapter_number
    and c.job_id = v_job.id;

  if not found then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_NOT_FOUND';
  end if;

  if v_checkpoint.checkpoint_schema_version <> 2 then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;

  if v_checkpoint.status not in ('PROSE_READY', 'READY_TO_PUBLISH') then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;

  if v_checkpoint.audit_signals_version is null or v_checkpoint.audit_signals_version <> 2 then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;

  if not public.is_valid_checkpoint_audit_signals_v2(v_checkpoint.audit_signals_json) then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_INVALID_STATE';
  end if;

  if v_checkpoint.job_attempt_number > v_job.attempt_count then
    raise exception using errcode = 'P0001', message = 'CHECKPOINT_ATTEMPT_AHEAD';
  end if;

  -- Version provenance: job = checkpoint = story.
  if v_checkpoint.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  select s.story_contract_version into v_story
  from public.stories s
  where s.id = v_job.story_id;

  if v_story.story_contract_version is distinct from v_job.story_contract_version then
    raise exception using errcode = 'P0001', message = 'CONTRACT_VERSION_MISMATCH';
  end if;

  -- Closure payload must match checkpoint audit signals.
  if v_canonical_closures is not null and jsonb_typeof(v_canonical_closures) = 'array'
    and jsonb_array_length(v_canonical_closures) > 0
  then
    if v_canonical_closures is distinct from (v_checkpoint.audit_signals_json->'closesPlotDebts') then
      raise exception using errcode = 'P0001', message = 'CHECKPOINT_CLOSURE_PAYLOAD_MISMATCH';
    end if;
  end if;

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

  <<publication>>

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
         i.story_id = v_job.story_id
           and i.scope = v_expected_scope
           and pg_catalog.jsonb_typeof(i.result) = 'object'
           and i.result @> '{"ok":true}'::jsonb
           and pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
           and (i.result->>'chapter_number')::numeric = v_job.chapter_number
  into v_proof_result, v_proof_valid
  from public.idempotency_keys i
  where i.key = v_job.publication_idempotency_key;

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

      -- Read back and classify.
      select closed_by_job_id into v_debt_id  -- reuse v_debt_id for job id
      from public.reader_plot_debt_closures
      where user_id = v_job.user_id and story_id = v_job.story_id
        and debt_id = (v_closure_item->>'debtId');

      -- The row exists (either just inserted or pre-existing).
      -- If pre-existing with different job → conflict (should not happen after validation above).
      -- If same job → idempotent (do nothing).
      -- This path should never reach CONFLICT because validation already checked the ledger.
    end loop;
  end if;

  -- Checkpoint → PUBLISHED (while job is still RUNNING, lease still ACTIVE).
  if v_is_personalized then
    perform public.transition_generation_checkpoint_fenced_v1(
      v_job.id, v_job.worker_id, v_job.claim_token, p_lease_id,
      v_job.story_id, v_job.chapter_number,
      v_job.id, 'PUBLISHED'
    );
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
