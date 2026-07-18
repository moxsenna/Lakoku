create function public.enqueue_generation_job_v1(
  p_story_id text,
  p_chapter_number integer,
  p_generation_kind text,
  p_trigger_choice_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_story public.stories%rowtype;
  v_active public.generation_jobs%rowtype;
  v_job_id uuid;
  v_correlation_id uuid;
  v_now timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if p_story_id is null
    or p_story_id = ''
    or p_story_id <> pg_catalog.btrim(p_story_id)
    or pg_catalog.char_length(p_story_id) > 200
    or p_story_id ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_STORY_ID';
  end if;

  if p_chapter_number is null
    or p_chapter_number < 1
    or p_chapter_number > 50 then
    raise exception using errcode = '22023', message = 'INVALID_CHAPTER_NUMBER';
  end if;

  if p_generation_kind is null
    or p_generation_kind not in ('standard', 'personalized') then
    raise exception using errcode = '22023', message = 'INVALID_GENERATION_KIND';
  end if;

  if p_trigger_choice_id is not null and (
    p_trigger_choice_id = ''
    or p_trigger_choice_id <> pg_catalog.btrim(p_trigger_choice_id)
    or pg_catalog.char_length(p_trigger_choice_id) > 200
    or p_trigger_choice_id ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_TRIGGER_CHOICE_ID';
  end if;

  select s.*
  into v_story
  from public.stories as s
  where s.id = p_story_id
    and (
      s.owner_user_id = v_user_id
      or (
        p_generation_kind = 'standard'
        and s.visibility = 'public'
        and exists (
          select 1
          from public.reader_states as rs
          where rs.user_id = v_user_id
            and rs.story_id = s.id
        )
      )
    );

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if (
    p_generation_kind = 'standard'
    and v_story.story_mode is distinct from 'standard'
  ) or (
    p_generation_kind = 'personalized'
    and (
      v_story.owner_user_id is distinct from v_user_id
      or v_story.visibility is distinct from 'private'
      or v_story.story_mode not in ('personalized_ai', 'premium_instance')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_CONFLICT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_story_id, 120712)
  );

  -- Reauthorize after waiting. Unauthorized and deleted stories remain indistinguishable.
  select s.*
  into v_story
  from public.stories as s
  where s.id = p_story_id
    and (
      s.owner_user_id = v_user_id
      or (
        p_generation_kind = 'standard'
        and s.visibility = 'public'
        and exists (
          select 1
          from public.reader_states as rs
          where rs.user_id = v_user_id
            and rs.story_id = s.id
        )
      )
    );

  if not found then
    raise exception using errcode = 'P0001', message = 'STORY_NOT_FOUND';
  end if;

  if (
    p_generation_kind = 'standard'
    and v_story.story_mode is distinct from 'standard'
  ) or (
    p_generation_kind = 'personalized'
    and (
      v_story.owner_user_id is distinct from v_user_id
      or v_story.visibility is distinct from 'private'
      or v_story.story_mode not in ('personalized_ai', 'premium_instance')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'GENERATION_JOB_CONFLICT';
  end if;

  if exists (
    select 1
    from public.chapters as c
    where c.story_id = p_story_id
      and c.number = p_chapter_number
  ) then
    return pg_catalog.jsonb_build_object(
      'alreadyComplete', true,
      'jobId', null,
      'correlationId', null,
      'status', 'SUCCEEDED'
    );
  end if;

  select j.*
  into v_active
  from public.generation_jobs as j
  where j.story_id = p_story_id
    and j.chapter_number = p_chapter_number
    and j.status in ('QUEUED', 'RUNNING', 'RETRY_WAIT')
  for update;

  if found then
    if v_active.user_id is distinct from v_user_id
      or v_active.generation_kind is distinct from p_generation_kind
      or v_active.trigger_choice_id is distinct from p_trigger_choice_id then
      raise exception using errcode = 'P0001', message = 'GENERATION_JOB_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'alreadyComplete', false,
      'jobId', v_active.id,
      'correlationId', v_active.correlation_id,
      'status', v_active.status
    );
  end if;

  v_job_id := pg_catalog.gen_random_uuid();
  v_correlation_id := pg_catalog.gen_random_uuid();
  v_now := pg_catalog.clock_timestamp();

  insert into public.generation_jobs (
    id,
    story_id,
    chapter_number,
    user_id,
    generation_kind,
    trigger_choice_id,
    status,
    attempt_count,
    max_attempts,
    available_at,
    deadline_at,
    correlation_id,
    created_at,
    updated_at,
    publication_idempotency_key
  ) values (
    v_job_id,
    p_story_id,
    p_chapter_number,
    v_user_id,
    p_generation_kind,
    p_trigger_choice_id,
    'QUEUED',
    0,
    4,
    v_now,
    v_now + interval '20 minutes',
    v_correlation_id,
    v_now,
    v_now,
    'generation-job:' || v_job_id::text || ':publish:' || p_chapter_number::text
  );

  return pg_catalog.jsonb_build_object(
    'alreadyComplete', false,
    'jobId', v_job_id,
    'correlationId', v_correlation_id,
    'status', 'QUEUED'
  );
end;
$$;

revoke all on function public.enqueue_generation_job_v1(text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_generation_job_v1(text, integer, text, text)
  to authenticated;
