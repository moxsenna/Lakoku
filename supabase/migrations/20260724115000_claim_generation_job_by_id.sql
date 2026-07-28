-- Claim a specific generation job by id (targeted claim).
--
-- claim_generation_job_v1 is a GLOBAL pop (order by available_at, limit 1),
-- used by the recovery worker which does not know which job id to run.
-- This variant lets the request path (next/server after()) claim exactly the
-- job it just enqueued, so request A never accidentally claims request B's job.
--
-- Atomic: locks the target row (for update skip locked) and only transitions to
-- RUNNING when the job is genuinely claimable (QUEUED/RETRY_WAIT, available,
-- within deadline, attempt budget remaining). Returns the same job shape as
-- claim_generation_job_v1, including a fresh claim_token used for fencing.

create function public.claim_generation_job_by_id_v1(
  p_job_id uuid,
  p_worker_id text
)
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
  if p_job_id is null then
    raise exception using errcode = '22023', message = 'INVALID_JOB_ID';
  end if;

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
  where j.id = p_job_id
    and j.status in ('QUEUED', 'RETRY_WAIT')
    and j.available_at <= v_now
    and j.deadline_at > v_now
    and j.attempt_count < j.max_attempts
  for update skip locked;

  if not found then
    -- Not claimable: wrong id, terminal, not yet available, past deadline,
    -- retries exhausted, or currently locked/RUNNING by another worker.
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

-- Worker-only surface: service role invokes this from trusted server code.
revoke all on function public.claim_generation_job_by_id_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_generation_job_by_id_v1(uuid, text)
  to service_role;
