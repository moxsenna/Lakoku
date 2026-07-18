alter table public.generation_leases
  add column if not exists job_id uuid references public.generation_jobs(id),
  add column if not exists claim_token uuid;

create index if not exists generation_leases_job_claim_idx
on public.generation_leases(job_id, claim_token)
where status = 'ACTIVE';

create function public.claim_generation_job_v1(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_job public.generation_jobs%rowtype;
  v_claim_token uuid := pg_catalog.gen_random_uuid();
begin
  if p_worker_id is null
    or p_worker_id = ''
    or p_worker_id <> pg_catalog.btrim(p_worker_id)
    or pg_catalog.char_length(p_worker_id) > 200
    or p_worker_id ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_ID';
  end if;

  select j.*
  into v_job
  from public.generation_jobs j
  where j.status in ('QUEUED', 'RETRY_WAIT')
    and j.available_at <= v_now
    and j.deadline_at > v_now
    and j.attempt_count < j.max_attempts
  order by j.available_at, j.created_at
  for update skip locked
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('claimed', false);
  end if;

  update public.generation_jobs j
  set status = 'RUNNING',
      attempt_count = j.attempt_count + 1,
      claimed_at = v_now,
      heartbeat_at = v_now,
      worker_id = p_worker_id,
      claim_token = v_claim_token
  where j.id = v_job.id
  returning j.* into v_job;

  return pg_catalog.jsonb_build_object(
    'claimed', true,
    'job', pg_catalog.jsonb_build_object(
      'id', v_job.id,
      'story_id', v_job.story_id,
      'chapter_number', v_job.chapter_number,
      'user_id', v_job.user_id,
      'generation_kind', v_job.generation_kind,
      'trigger_choice_id', v_job.trigger_choice_id,
      'attempt_count', v_job.attempt_count,
      'max_attempts', v_job.max_attempts,
      'deadline_at', v_job.deadline_at,
      'correlation_id', v_job.correlation_id,
      'worker_id', v_job.worker_id,
      'claim_token', v_job.claim_token
    )
  );
end;
$$;

create function public.acquire_generation_job_lease_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_lease_id uuid;
  v_now timestamptz;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 30 or p_ttl_seconds > 600 then
    raise exception using errcode = '22023', message = 'INVALID_LEASE_TTL';
  end if;

  if p_worker_id is null
    or p_worker_id = ''
    or p_worker_id <> pg_catalog.btrim(p_worker_id)
    or pg_catalog.char_length(p_worker_id) > 200
    or p_worker_id ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_ID';
  end if;

  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found
    or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'OWNERSHIP_LOST');
  end if;

  update public.generation_leases l
  set status = 'EXPIRED'
  where l.story_id = v_job.story_id
    and l.status = 'ACTIVE'
    and l.expires_at <= pg_catalog.clock_timestamp();

  update public.generation_leases l
  set expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl_seconds)
  where l.job_id = v_job.id
    and l.claim_token = p_claim_token
    and l.story_id = v_job.story_id
    and l.chapter_number = v_job.chapter_number
    and l.holder = p_worker_id
    and l.status = 'ACTIVE'
    and l.expires_at > pg_catalog.clock_timestamp()
  returning l.id into v_lease_id;

  if found then
    return pg_catalog.jsonb_build_object('ok', true, 'lease_id', v_lease_id);
  end if;

  v_now := pg_catalog.clock_timestamp();
  begin
    insert into public.generation_leases (
      story_id, chapter_number, status, holder, expires_at, job_id, claim_token
    ) values (
      v_job.story_id, v_job.chapter_number, 'ACTIVE', p_worker_id,
      v_now + pg_catalog.make_interval(secs => p_ttl_seconds), v_job.id, p_claim_token
    ) returning id into v_lease_id;
  exception when unique_violation then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'LEASE_HELD');
  end;

  return pg_catalog.jsonb_build_object('ok', true, 'lease_id', v_lease_id);
end;
$$;

create function public.heartbeat_generation_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_lease_id uuid,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 30 or p_ttl_seconds > 600 then
    raise exception using errcode = '22023', message = 'INVALID_LEASE_TTL';
  end if;

  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found
    or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'OWNERSHIP_LOST');
  end if;

  update public.generation_leases l
  set expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl_seconds)
  where l.id = p_lease_id
    and l.job_id = p_job_id
    and l.claim_token = p_claim_token
    and l.story_id = v_job.story_id
    and l.chapter_number = v_job.chapter_number
    and l.holder = p_worker_id
    and l.status = 'ACTIVE'
    and l.expires_at > pg_catalog.clock_timestamp();

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'OWNERSHIP_LOST');
  end if;

  update public.generation_jobs
  set heartbeat_at = pg_catalog.clock_timestamp()
  where id = p_job_id;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

create function public.finish_generation_job_attempt_v1(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_outcome text,
  p_available_at timestamptz,
  p_error_code text,
  p_error_class text,
  p_workflow_phase text,
  p_provider_id text,
  p_model_id text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_elapsed_ms bigint,
  p_lease_age_ms bigint,
  p_lease_remaining_ms bigint,
  p_retry_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outcome text := p_outcome;
  v_error_code text := p_error_code;
  v_error_class text := p_error_class;
  v_old_claim_token uuid;
begin
  if p_outcome not in ('RETRY_WAIT', 'FAILED', 'CANCELLED') then
    raise exception using errcode = '22023', message = 'INVALID_FINISH_OUTCOME';
  end if;

  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found
    or v_job.status <> 'RUNNING'
    or v_job.worker_id is distinct from p_worker_id
    or v_job.claim_token is distinct from p_claim_token then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'OWNERSHIP_LOST');
  end if;

  if p_started_at is null then
    raise exception using errcode = '22023', message = 'INVALID_ATTEMPT_STARTED_AT';
  end if;
  if p_workflow_phase is null
    or p_workflow_phase = ''
    or p_workflow_phase <> pg_catalog.btrim(p_workflow_phase)
    or pg_catalog.char_length(p_workflow_phase) > 100
    or p_workflow_phase ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_WORKFLOW_PHASE';
  end if;
  if p_provider_id is not null and (
    p_provider_id = ''
    or p_provider_id <> pg_catalog.btrim(p_provider_id)
    or pg_catalog.char_length(p_provider_id) > 200
    or p_provider_id ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_ID';
  end if;
  if p_model_id is not null and (
    p_model_id = ''
    or p_model_id <> pg_catalog.btrim(p_model_id)
    or pg_catalog.char_length(p_model_id) > 200
    or p_model_id ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_MODEL_ID';
  end if;
  if p_error_code is not null and (
    p_error_code = ''
    or p_error_code <> pg_catalog.btrim(p_error_code)
    or pg_catalog.char_length(p_error_code) > 200
    or p_error_code ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ERROR_CODE';
  end if;
  if p_error_class is not null and (
    p_error_class = ''
    or p_error_class <> pg_catalog.btrim(p_error_class)
    or pg_catalog.char_length(p_error_class) > 200
    or p_error_class ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ERROR_CLASS';
  end if;
  if p_retry_decision is not null and (
    p_retry_decision = ''
    or p_retry_decision <> pg_catalog.btrim(p_retry_decision)
    or pg_catalog.char_length(p_retry_decision) > 200
    or p_retry_decision ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_RETRY_DECISION';
  end if;
  if p_ended_at is not null and p_ended_at < p_started_at then
    raise exception using errcode = '22023', message = 'INVALID_ATTEMPT_ENDED_AT';
  end if;
  if p_elapsed_ms is not null and p_elapsed_ms < 0 then
    raise exception using errcode = '22023', message = 'INVALID_ELAPSED_MS';
  end if;
  if p_lease_age_ms is not null and p_lease_age_ms < 0 then
    raise exception using errcode = '22023', message = 'INVALID_LEASE_AGE_MS';
  end if;
  if p_lease_remaining_ms is not null and p_lease_remaining_ms < 0 then
    raise exception using errcode = '22023', message = 'INVALID_LEASE_REMAINING_MS';
  end if;

  if v_outcome = 'RETRY_WAIT' then
    if v_job.deadline_at <= v_now then
      v_outcome := 'FAILED';
      v_error_code := 'GENERATION_DEADLINE_EXCEEDED';
      v_error_class := 'TERMINAL';
    elsif v_job.attempt_count >= v_job.max_attempts then
      v_outcome := 'FAILED';
      v_error_code := 'GENERATION_RETRY_EXHAUSTED';
      v_error_class := 'TERMINAL';
    elsif p_available_at is null or p_available_at < v_now then
      raise exception using errcode = '22023', message = 'INVALID_RETRY_AVAILABLE_AT';
    end if;
  end if;

  insert into public.generation_job_attempts (
    job_id, correlation_id, story_id, chapter_number, attempt_number,
    workflow_phase, provider_id, model_id, started_at, ended_at,
    elapsed_ms, lease_age_ms, lease_remaining_ms, retry_decision,
    error_code, worker_id
  ) values (
    v_job.id, v_job.correlation_id, v_job.story_id, v_job.chapter_number,
    v_job.attempt_count, p_workflow_phase, p_provider_id, p_model_id,
    p_started_at, p_ended_at, p_elapsed_ms, p_lease_age_ms,
    p_lease_remaining_ms, p_retry_decision, v_error_code, v_job.worker_id
  );

  v_old_claim_token := v_job.claim_token;

  update public.generation_jobs
  set status = v_outcome,
      available_at = case when v_outcome = 'RETRY_WAIT' then p_available_at else available_at end,
      last_error_code = case when v_outcome = 'CANCELLED' then 'GENERATION_CANCELLED' else v_error_code end,
      last_error_class = v_error_class,
      last_error_at = case when coalesce(v_error_code, v_error_class) is not null or v_outcome = 'CANCELLED' then v_now else null end
  where id = v_job.id;

  update public.generation_leases l
  set status = 'RELEASED'
  where l.job_id = v_job.id
    and l.claim_token = v_old_claim_token
    and l.status = 'ACTIVE';

  return pg_catalog.jsonb_build_object('ok', true, 'status', v_outcome);
end;
$$;

create function public.cancel_generation_job_v1(
  p_job_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_old_claim_token uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_reason is null
    or p_reason = ''
    or p_reason <> pg_catalog.btrim(p_reason)
    or pg_catalog.char_length(p_reason) > 200
    or p_reason ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_CANCEL_REASON';
  end if;

  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_job.status not in ('QUEUED', 'RETRY_WAIT', 'RUNNING') then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'NOT_CANCELLABLE');
  end if;

  v_old_claim_token := v_job.claim_token;
  update public.generation_jobs
  set status = 'CANCELLED',
      last_error_code = 'GENERATION_CANCELLED',
      last_error_class = p_reason,
      last_error_at = v_now
  where id = v_job.id;

  if v_old_claim_token is not null then
    update public.generation_leases l
    set status = 'EXPIRED'
    where l.job_id = v_job.id
      and l.claim_token = v_old_claim_token
      and l.status = 'ACTIVE';
  end if;

  return pg_catalog.jsonb_build_object('ok', true, 'status', 'CANCELLED');
end;
$$;

create function public.recover_stale_generation_jobs_v1(p_batch_size integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_scan_now timestamptz := pg_catalog.clock_timestamp();
  v_now timestamptz;
  v_old_claim_token uuid;
  v_old_worker_id text;
  v_old_claimed_at timestamptz;
  v_old_heartbeat_at timestamptz;
  v_recovered_count integer := 0;
  v_publication_result jsonb;
  v_publication_proven boolean;
  v_outcome text;
  v_error_code text;
  v_retry_decision text;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    return pg_catalog.jsonb_build_object('recovered_count', 0);
  end if;

  for v_job in
    select j.*
    from public.generation_jobs j
    where (
      j.status = 'RUNNING'
      and (
        j.heartbeat_at < v_scan_now - pg_catalog.make_interval(secs => 75)
        or j.deadline_at <= v_scan_now
      )
    ) or (
      j.status in ('QUEUED', 'RETRY_WAIT')
      and j.deadline_at <= v_scan_now
    )
    order by coalesce(j.heartbeat_at, j.available_at), j.created_at, j.id
    for update of j skip locked
    limit p_batch_size
  loop
    v_now := pg_catalog.clock_timestamp();
    if v_job.status = 'RUNNING'
      and v_job.heartbeat_at >= v_now - pg_catalog.make_interval(secs => 75)
      and v_job.deadline_at > v_now then
      continue;
    end if;

    v_old_claim_token := v_job.claim_token;
    v_old_worker_id := v_job.worker_id;
    v_old_claimed_at := v_job.claimed_at;
    v_old_heartbeat_at := v_job.heartbeat_at;
    v_publication_result := null;
    v_publication_proven := false;
    v_outcome := null;
    v_error_code := null;
    v_retry_decision := null;

    if v_job.status = 'RUNNING' and exists (
      select 1
      from public.chapters c
      where c.story_id = v_job.story_id
        and c.number = v_job.chapter_number
    ) then
      select i.result,
             i.story_id = v_job.story_id
               and i.scope in (
                 'publish_chapter',
                 'publish_chapter_v2:' || v_job.chapter_number::text
               )
               and pg_catalog.jsonb_typeof(i.result) = 'object'
               and i.result @> '{"ok":true}'::jsonb
               and pg_catalog.jsonb_typeof(i.result->'chapter_number') = 'number'
               and (i.result->>'chapter_number')::numeric = v_job.chapter_number
      into v_publication_result, v_publication_proven
      from public.idempotency_keys i
      where i.key = v_job.publication_idempotency_key;

      if coalesce(v_publication_proven, false) then
        v_outcome := 'SUCCEEDED';
        update public.generation_jobs
        set status = v_outcome,
            publication_result = v_publication_result
        where id = v_job.id;
      else
        v_outcome := 'FAILED';
        v_error_code := 'GENERATION_PUBLICATION_CONFLICT';
        update public.generation_jobs
        set status = v_outcome,
            last_error_code = v_error_code,
            last_error_class = 'TERMINAL',
            last_error_at = v_now
        where id = v_job.id;
      end if;
    elsif v_job.deadline_at <= v_now then
      v_outcome := 'FAILED';
      v_error_code := 'GENERATION_DEADLINE_EXCEEDED';
      update public.generation_jobs
      set status = v_outcome,
          last_error_code = v_error_code,
          last_error_class = 'TERMINAL',
          last_error_at = v_now
      where id = v_job.id;
    elsif v_job.attempt_count >= v_job.max_attempts then
      v_outcome := 'FAILED';
      v_error_code := 'GENERATION_RETRY_EXHAUSTED';
      update public.generation_jobs
      set status = v_outcome,
          last_error_code = v_error_code,
          last_error_class = 'TERMINAL',
          last_error_at = v_now
      where id = v_job.id;
    else
      v_outcome := 'RETRY_WAIT';
      v_error_code := 'WORKER_ATTEMPT_INTERRUPTED';
      v_retry_decision := 'RETRY_IMMEDIATE';
      update public.generation_jobs
      set status = v_outcome,
          available_at = v_now,
          last_error_code = v_error_code,
          last_error_class = 'TRANSIENT',
          last_error_at = v_now
      where id = v_job.id;
    end if;

    if v_job.status = 'RUNNING' then
      insert into public.generation_job_attempts (
        job_id, correlation_id, story_id, chapter_number, attempt_number,
        workflow_phase, started_at, ended_at, elapsed_ms, retry_decision,
        error_code, worker_id
      ) values (
        v_job.id, v_job.correlation_id, v_job.story_id, v_job.chapter_number,
        v_job.attempt_count, 'WORKER_ATTEMPT_INTERRUPTED',
        coalesce(v_old_claimed_at, v_old_heartbeat_at, v_job.created_at), v_now,
        greatest(
          0,
          pg_catalog.floor(
            extract(epoch from (
              v_now - coalesce(v_old_claimed_at, v_old_heartbeat_at, v_job.created_at)
            )) * 1000
          )::bigint
        ),
        v_retry_decision, v_error_code, v_old_worker_id
      ) on conflict (job_id, attempt_number, workflow_phase, started_at) do nothing;
    end if;

    if v_job.status = 'RUNNING' and v_old_claim_token is not null then
      update public.generation_leases l
      set status = 'EXPIRED'
      where l.job_id = v_job.id
        and l.claim_token = v_old_claim_token
        and l.status = 'ACTIVE';
    end if;

    v_recovered_count := v_recovered_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object('recovered_count', v_recovered_count);
end;
$$;

revoke all on function public.claim_generation_job_v1(text) from public, anon, authenticated;
revoke all on function public.acquire_generation_job_lease_v1(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_generation_job_v1(uuid, text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_generation_job_attempt_v1(uuid, text, uuid, text, timestamptz, text, text, text, text, text, timestamptz, timestamptz, bigint, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.cancel_generation_job_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.recover_stale_generation_jobs_v1(integer) from public, anon, authenticated;

grant execute on function public.claim_generation_job_v1(text) to service_role;
grant execute on function public.acquire_generation_job_lease_v1(uuid, text, uuid, integer) to service_role;
grant execute on function public.heartbeat_generation_job_v1(uuid, text, uuid, uuid, integer) to service_role;
grant execute on function public.finish_generation_job_attempt_v1(uuid, text, uuid, text, timestamptz, text, text, text, text, text, timestamptz, timestamptz, bigint, bigint, bigint, text) to service_role;
grant execute on function public.cancel_generation_job_v1(uuid, text) to service_role;
grant execute on function public.recover_stale_generation_jobs_v1(integer) to service_role;
