-- 20260805020000_story_creation_request_job_binding.sql
-- Add generation_job_id to story_creation_requests for atomic Bab 1 job binding.

alter table public.story_creation_requests
  add column if not exists generation_job_id uuid null references public.generation_jobs(id) on delete set null;

create unique index if not exists story_creation_requests_job_idx
  on public.story_creation_requests(generation_job_id)
  where generation_job_id is not null;

-- DB-authoritative binding primitive for Story Start Bab 1
create or replace function public.bind_story_creation_request_job_v1(
  p_owner_user_id uuid,
  p_story_id text,
  p_generation_job_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_req public.story_creation_requests%rowtype;
  v_job public.generation_jobs%rowtype;
begin
  select j.* into v_job
  from public.generation_jobs j
  where j.id = p_generation_job_id;

  if not found or v_job.user_id is distinct from p_owner_user_id or v_job.story_id is distinct from p_story_id or v_job.chapter_number <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'JOB_PROVENANCE_MISMATCH');
  end if;

  select r.* into v_req
  from public.story_creation_requests r
  where r.owner_user_id = p_owner_user_id
    and r.story_id = p_story_id
    and r.status = 'RESERVED'
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_NOT_FOUND_OR_NOT_RESERVED');
  end if;

  if v_req.generation_job_id is not null and v_req.generation_job_id <> p_generation_job_id then
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'CREATION_REQUEST_ALREADY_BOUND');
  end if;

  update public.story_creation_requests
    set generation_job_id = p_generation_job_id, updated_at = pg_catalog.clock_timestamp()
    where owner_user_id = p_owner_user_id and story_id = p_story_id and status = 'RESERVED';

  return pg_catalog.jsonb_build_object('ok', true, 'story_id', p_story_id, 'job_id', p_generation_job_id);
end;
$$;

revoke all on function public.bind_story_creation_request_job_v1(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.bind_story_creation_request_job_v1(uuid, text, uuid) to service_role;
