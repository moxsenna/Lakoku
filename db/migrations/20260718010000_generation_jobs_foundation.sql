create table public.generation_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  story_id text not null references public.stories(id) on delete cascade,
  chapter_number integer not null check (chapter_number between 1 and 50),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_kind text not null check (generation_kind in ('standard', 'personalized')),
  trigger_choice_id text,
  status text not null check (status in ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 20),
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  deadline_at timestamptz not null,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  worker_id text,
  claim_token uuid,
  correlation_id uuid not null default pg_catalog.gen_random_uuid(),
  last_error_code text,
  last_error_class text,
  last_error_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  publication_idempotency_key text not null,
  publication_result jsonb,
  constraint generation_jobs_attempt_budget_check check (attempt_count <= max_attempts),
  constraint generation_jobs_deadline_check check (deadline_at > created_at),
  constraint generation_jobs_publication_key_check check (
    publication_idempotency_key = 'generation-job:' || id::text || ':publish:' || chapter_number::text
  )
);

create unique index generation_jobs_one_active_target_idx
on public.generation_jobs(story_id, chapter_number)
where status in ('QUEUED', 'RUNNING', 'RETRY_WAIT');

create index generation_jobs_claim_idx
on public.generation_jobs(available_at, created_at)
where status in ('QUEUED', 'RETRY_WAIT');

create index generation_jobs_stale_idx
on public.generation_jobs(heartbeat_at)
where status = 'RUNNING';

create table public.generation_job_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  correlation_id uuid not null,
  story_id text not null,
  chapter_number integer not null,
  attempt_number integer not null check (attempt_number >= 1),
  workflow_phase text not null check (
    pg_catalog.length(workflow_phase) between 1 and 100
    and workflow_phase !~ '[[:cntrl:]]'
  ),
  provider_id text check (
    provider_id is null or (
      pg_catalog.length(provider_id) between 1 and 200
      and provider_id !~ '[[:cntrl:]]'
    )
  ),
  model_id text check (
    model_id is null or (
      pg_catalog.length(model_id) between 1 and 200
      and model_id !~ '[[:cntrl:]]'
    )
  ),
  started_at timestamptz not null,
  ended_at timestamptz,
  elapsed_ms bigint,
  lease_age_ms bigint,
  lease_remaining_ms bigint,
  retry_decision text check (
    retry_decision is null or (
      pg_catalog.length(retry_decision) between 1 and 200
      and retry_decision !~ '[[:cntrl:]]'
    )
  ),
  error_code text check (
    error_code is null or (
      pg_catalog.length(error_code) between 1 and 200
      and error_code !~ '[[:cntrl:]]'
    )
  ),
  worker_id text check (
    worker_id is null or (
      pg_catalog.length(worker_id) between 1 and 200
      and worker_id !~ '[[:cntrl:]]'
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint generation_job_attempts_end_check check (ended_at is null or ended_at >= started_at),
  constraint generation_job_attempts_elapsed_check check (elapsed_ms is null or elapsed_ms >= 0),
  constraint generation_job_attempts_lease_age_check check (lease_age_ms is null or lease_age_ms >= 0),
  constraint generation_job_attempts_lease_remaining_check check (lease_remaining_ms is null or lease_remaining_ms >= 0),
  constraint generation_job_attempts_identity_key unique(job_id, attempt_number, workflow_phase, started_at)
);

create function public.generation_jobs_enforce_state_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_entering_running boolean;
begin
  if tg_op = 'UPDATE' then
    if old.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_TERMINAL';
    end if;

    if new.id is distinct from old.id
      or new.story_id is distinct from old.story_id
      or new.chapter_number is distinct from old.chapter_number
      or new.user_id is distinct from old.user_id
      or new.generation_kind is distinct from old.generation_kind
      or new.trigger_choice_id is distinct from old.trigger_choice_id
      or new.max_attempts is distinct from old.max_attempts
      or new.deadline_at is distinct from old.deadline_at
      or new.correlation_id is distinct from old.correlation_id
      or new.created_at is distinct from old.created_at
      or new.publication_idempotency_key is distinct from old.publication_idempotency_key then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE_GENERATION_JOB_IDENTITY';
    end if;

    if not (
      (old.status = 'QUEUED' and new.status in ('QUEUED', 'RUNNING', 'CANCELLED'))
      or (old.status = 'RUNNING' and new.status in ('RUNNING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'CANCELLED'))
      or (old.status = 'RETRY_WAIT' and new.status in ('RETRY_WAIT', 'RUNNING', 'CANCELLED'))
      or (
        old.status in ('QUEUED', 'RETRY_WAIT')
        and new.status = 'FAILED'
        and old.deadline_at <= v_now
        and new.last_error_code = 'GENERATION_DEADLINE_EXCEEDED'
      )
    ) then
      raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_TRANSITION';
    end if;

    v_entering_running := old.status in ('QUEUED', 'RETRY_WAIT') and new.status = 'RUNNING';
    if new.attempt_count < old.attempt_count
      or (v_entering_running and new.attempt_count <> old.attempt_count + 1)
      or (not v_entering_running and new.attempt_count <> old.attempt_count) then
      raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_ATTEMPT_COUNT';
    end if;

    if new.status = 'RUNNING' and (
      new.worker_id is null or pg_catalog.btrim(new.worker_id) = ''
      or new.claim_token is null
      or new.claimed_at is null
      or new.heartbeat_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_RUNNING_OWNERSHIP_REQUIRED';
    end if;

    if old.status = 'RUNNING' and new.status = 'RETRY_WAIT'
      and new.attempt_count >= new.max_attempts then
      raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_ATTEMPT_COUNT';
    end if;

    if old.status = 'RUNNING' and new.status = 'RUNNING' then
      if new.worker_id is distinct from old.worker_id
        or new.claim_token is distinct from old.claim_token
        or new.claimed_at is distinct from old.claimed_at then
        raise exception using errcode = 'P0001', message = 'IMMUTABLE_GENERATION_JOB_OWNERSHIP';
      end if;
      if new.claimed_at > new.heartbeat_at then
        raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_OWNERSHIP_CHRONOLOGY';
      end if;
      if new.heartbeat_at < old.heartbeat_at then
        raise exception using errcode = 'P0001', message = 'GENERATION_JOB_HEARTBEAT_MOVED_BACKWARD';
      end if;
      if new.heartbeat_at > v_now then
        raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_OWNERSHIP_CHRONOLOGY';
      end if;
    end if;

    if new.publication_result is not null
      and not (old.status = 'RUNNING' and new.status = 'SUCCEEDED') then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_PUBLICATION_RESULT_INVALID';
    end if;
    if old.status = 'RUNNING' and new.status = 'SUCCEEDED' and new.publication_result is null then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_PUBLICATION_RESULT_REQUIRED';
    end if;
  else
    if new.status <> 'QUEUED'
      or new.attempt_count <> 0
      or new.claimed_at is not null
      or new.heartbeat_at is not null
      or new.worker_id is not null
      or new.claim_token is not null
      or new.completed_at is not null
      or new.publication_result is not null
      or new.last_error_code is not null
      or new.last_error_class is not null
      or new.last_error_at is not null then
      raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_INITIAL_STATE';
    end if;
  end if;

  if new.status = 'RUNNING' then
    if new.worker_id is null or pg_catalog.btrim(new.worker_id) = ''
      or new.claim_token is null
      or new.claimed_at is null
      or new.heartbeat_at is null then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_RUNNING_OWNERSHIP_REQUIRED';
    end if;
    if new.claimed_at > new.heartbeat_at or new.heartbeat_at > v_now then
      raise exception using errcode = 'P0001', message = 'INVALID_GENERATION_JOB_OWNERSHIP_CHRONOLOGY';
    end if;
    new.completed_at := null;
  else
    new.worker_id := null;
    new.claim_token := null;
    new.claimed_at := null;
    new.heartbeat_at := null;
    if new.status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
      new.completed_at := v_now;
    else
      new.completed_at := null;
    end if;
  end if;

  if new.status <> 'SUCCEEDED' and new.publication_result is not null then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_PUBLICATION_RESULT_INVALID';
  end if;

  new.updated_at := v_now;
  return new;
end;
$$;

create trigger generation_jobs_enforce_state_v1_trigger
before insert or update on public.generation_jobs
for each row execute function public.generation_jobs_enforce_state_v1();

create function public.generation_job_attempts_enforce_identity_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent public.generation_jobs%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.job_id is distinct from old.job_id
    or new.correlation_id is distinct from old.correlation_id
    or new.story_id is distinct from old.story_id
    or new.chapter_number is distinct from old.chapter_number
    or new.attempt_number is distinct from old.attempt_number
    or new.workflow_phase is distinct from old.workflow_phase
    or new.started_at is distinct from old.started_at
  ) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_GENERATION_JOB_ATTEMPT_IDENTITY';
  end if;

  select j.*
  into v_parent
  from public.generation_jobs j
  where j.id = new.job_id;

  if not found then
    return new;
  end if;

  if new.correlation_id is distinct from v_parent.correlation_id
    or new.story_id is distinct from v_parent.story_id
    or new.chapter_number is distinct from v_parent.chapter_number then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_ATTEMPT_IDENTITY_MISMATCH';
  end if;

  if new.attempt_number > v_parent.attempt_count then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_ATTEMPT_NUMBER_INVALID';
  end if;

  return new;
end;
$$;

create trigger generation_job_attempts_enforce_identity_v1_trigger
before insert or update on public.generation_job_attempts
for each row execute function public.generation_job_attempts_enforce_identity_v1();

alter table public.generation_jobs enable row level security;
alter table public.generation_job_attempts enable row level security;

revoke all on table public.generation_jobs from public, anon, authenticated, service_role;
revoke all on table public.generation_job_attempts from public, anon, authenticated, service_role;
grant select, insert, update on table public.generation_jobs to service_role;
grant select, insert on table public.generation_job_attempts to service_role;

revoke all on function public.generation_jobs_enforce_state_v1() from public, anon, authenticated;
revoke all on function public.generation_job_attempts_enforce_identity_v1() from public, anon, authenticated;
