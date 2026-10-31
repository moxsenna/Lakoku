-- Align generation publication with global ending, reader, story, job, and lease lock order.

create or replace function public.publish_generation_job_chapter_v2(
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
  p_outcomes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preflight public.generation_jobs%rowtype;
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
  v_expected_key text;
  v_expected_scope text;
  v_publisher_result jsonb;
  v_proof_result jsonb;
  v_proof_valid boolean := false;
  v_result jsonb;
  v_now timestamptz;
  v_started_at timestamptz;
  v_elapsed_ms bigint;
begin
  -- Unlocked preflight discovers only target identity and an exact completed replay.
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

  if v_preflight.status = 'SUCCEEDED' and v_preflight.publication_result is not null then
    return v_preflight.publication_result;
  end if;

  -- Global publication order is story, job, lease. publish_chapter_v2 reacquires story reentrantly.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_preflight.story_id, 120712)
  );

  select j.*
  into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
  end if;

  v_expected_key := 'generation-job:' || v_job.id::text || ':publish:' || v_job.chapter_number::text;
  if v_job.publication_idempotency_key is distinct from v_expected_key then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

  if v_job.status = 'SUCCEEDED' and v_job.publication_result is not null then
    return v_job.publication_result;
  end if;

  if v_job.status <> 'RUNNING' then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_RUNNING';
  end if;
  if v_job.story_id is distinct from v_preflight.story_id
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

  select l.*
  into v_lease
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
    or v_lease.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  v_publisher_result := public.publish_chapter_v2(
    v_job.story_id,
    v_job.chapter_number,
    p_title,
    p_paragraphs,
    p_choice_prompt,
    p_choices,
    p_outcomes,
    p_lease_id,
    v_job.publication_idempotency_key
  );

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
      select 1
      from public.chapters c
      where c.story_id = v_job.story_id
        and c.number = v_job.chapter_number
    ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

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
    select 1
    from public.generation_leases l
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

  return v_result;
end;
$$;

create or replace function public.publish_generation_job_chapter_v3(
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
  p_ending_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preflight public.generation_jobs%rowtype;
  v_job public.generation_jobs%rowtype;
  v_lease public.generation_leases%rowtype;
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
begin
  -- Unlocked preflight discovers target identity. Mutable non-success state is revalidated later.
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

  -- Exact completed replay precedes target, payload, ownership, and lease validation.
  if v_preflight.status = 'SUCCEEDED' and v_preflight.publication_result is not null then
    return v_preflight.publication_result;
  end if;

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

    -- Ending path order is ending advisory, reader, contract, story, job, lease.
    -- Nested block rolls early ending writes back when a concurrent publisher already succeeded.
    begin
      perform public.persist_ending_lock_v1(
        v_preflight.user_id,
        v_preflight.story_id,
        p_ending_key,
        p_ending_name,
        v_preflight.chapter_number
      );

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_preflight.story_id, 120712)
      );

      select j.*
      into v_job
      from public.generation_jobs j
      where j.id = p_job_id
      for update;

      if not found then
        raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
      end if;

      if v_job.status = 'SUCCEEDED' and v_job.publication_result is not null then
        v_replay_result := v_job.publication_result;
        raise exception using errcode = 'ZP001', message = 'GENERATION_PUBLICATION_REPLAY';
      end if;
    exception
      when sqlstate 'ZP001' then
        return v_replay_result;
    end;
  else
    -- Null-ending path uses story, job, lease order.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_preflight.story_id, 120712)
    );

    select j.*
    into v_job
    from public.generation_jobs j
    where j.id = p_job_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_NOT_FOUND';
    end if;

    if v_job.status = 'SUCCEEDED' and v_job.publication_result is not null then
      return v_job.publication_result;
    end if;
  end if;

  -- Full validation trusts only row state reread under the job lock.
  v_expected_key := 'generation-job:' || v_job.id::text || ':publish:' || v_job.chapter_number::text;
  if v_job.publication_idempotency_key is distinct from v_expected_key then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

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

  select l.*
  into v_lease
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
    or v_lease.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_LEASE_INVALID';
  end if;

  v_publisher_result := public.publish_chapter_v2(
    v_job.story_id,
    v_job.chapter_number,
    p_title,
    p_paragraphs,
    p_choice_prompt,
    p_choices,
    p_outcomes,
    p_lease_id,
    v_job.publication_idempotency_key
  );

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
      select 1
      from public.chapters c
      where c.story_id = v_job.story_id
        and c.number = v_job.chapter_number
    ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_PUBLICATION_CONFLICT';
  end if;

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
    select 1
    from public.generation_leases l
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

  return v_result;
end;
$$;

revoke all on function public.publish_generation_job_chapter_v2(
  uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.publish_generation_job_chapter_v2(
  uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb
) to service_role;

revoke all on function public.publish_generation_job_chapter_v3(
  uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.publish_generation_job_chapter_v3(
  uuid, text, uuid, uuid, text, integer, text, jsonb, text, jsonb, jsonb, text, text
) to service_role;
